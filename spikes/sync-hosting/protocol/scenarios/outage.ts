// Kill the API (or the database): device A edits once a second while a drill script takes the target down
// and brings it back. Measures what devices see, how long until they recover, and whether any edit was lost.
//   --down-cmd "<shell>"   takes it down     --up-cmd "<shell>"   brings it back (runs after --down-seconds)

import { mulberry32, newUuid, sleep } from "../client/bytes.ts";
import { settle } from "../client/device.ts";
import { check, newResult, nowMs, sh, waitFor, type Context, type Result } from "./common.ts";
import { editIdOf, makePayload } from "./edits.ts";
import { readServerState } from "./faults.ts";

export async function outage(ctx: Context): Promise<Result> {
  const what = ctx.str("what") ?? "api";
  const downCmd = ctx.str("down-cmd");
  const upCmd = ctx.str("up-cmd");
  const downSeconds = ctx.num("down-seconds", 10);
  const result = newResult(ctx, `outage-${what}`, { what, downSeconds, editEveryMs: 1000, downCmd: downCmd ? "(script)" : null });
  if (!downCmd) {
    result.notes.push(ctx.str("skip-reason") ?? "no --down-cmd given: this candidate cannot be taken down from outside");
    result.metrics = { skipped: true };
    return result;
  }
  const rng = mulberry32(31);
  const user = "s-drill";
  await ctx.reset(user);

  const received = new Map<string, number>();
  const a = await ctx.device(user, "a", { device: { retry: { baseMs: 200, maxMs: 2000 } } });
  const b = await ctx.device(user, "b", { device: { onRemote: (e) => received.set(e.key.split("/")[1]!, editIdOf(e.payload)), retry: { baseMs: 200, maxMs: 2000 } } });
  await Promise.all([a.syncNow(), b.syncNow()]);

  const uuids = Array.from({ length: 10 }, () => newUuid());
  const expected = new Map<string, number>();
  let editId = 0;
  let editing = true;
  const editor = (async () => {
    while (editing) {
      editId += 1;
      const uuid = uuids[editId % uuids.length]!;
      expected.set(uuid, editId);
      a.edit("note", uuid, makePayload(editId, 2048, rng));
      await sleep(1000);
    }
  })();

  await sleep(5000);
  const failuresBefore = a.stats.failures.length;
  const tDown = nowMs();
  const down = await sh(downCmd);
  const tDownEnd = nowMs();
  await sleep(Math.max(0, downSeconds * 1000 - (tDownEnd - tDown)));
  const tUp = nowMs();
  const up = upCmd ? await sh(upCmd) : { ms: 0, stdout: "", code: 0 };
  const tUpEnd = nowMs();

  // Recovery as the device sees it: the first success after the failures that began with the outage.
  let recoveredAt = NaN;
  try {
    await waitFor(() => a.stats.recoveries.some((r) => r.at > tDown) || a.stats.failures.length === failuresBefore, 180_000, "device A to recover", 100);
    recoveredAt = a.stats.recoveries.filter((r) => r.at > tDown).at(0)?.at ?? NaN;
  } catch (e) {
    result.notes.push(String(e));
  }
  await sleep(8000);
  editing = false;
  await editor;
  await settle([a, b], 120_000);
  await waitFor(() => [...expected].every(([u, id]) => received.get(u) === id), 60_000, "B to hold every note's last edit").catch((e) => result.notes.push(String(e)));

  const server = await readServerState(ctx, user, "a");
  const lost = [...expected].filter(([u, id]) => editIdOf(server.records.get(`note/${u}`)?.payload ?? new Uint8Array(4)) !== id).length;
  const firstFailure = a.stats.failures.at(failuresBefore);
  const failureKinds = [...new Set(a.stats.failures.slice(failuresBefore).map((f) => f.message.replace(/\d{4,}/g, "N").slice(0, 80)))].slice(0, 6);
  result.metrics = {
    downCommandMs: Math.round(down.ms),
    upCommandMs: Math.round(up.ms),
    deviceFirstFailureAfterDownMs: firstFailure ? Math.round(firstFailure.at - tDown) : null,
    deviceRecoveredAfterUpCommandEndedMs: Number.isNaN(recoveredAt) ? null : Math.round(recoveredAt - tUpEnd),
    outageSeenByDeviceMs: firstFailure && !Number.isNaN(recoveredAt) ? Math.round(recoveredAt - firstFailure.at) : null,
    retriesDuringOutage: a.stats.failures.length - failuresBefore,
    editsMade: editId,
    editsLost: lost,
    whatTheDeviceSaw: failureKinds,
    upCommandSecondsFromDown: Math.round((tUp - tDown) / 100) / 10,
  };
  check(result, "down command succeeded", down.code === 0, `exit ${down.code}`);
  check(result, "no edit was lost: the server holds the last text of every note", lost === 0, `${lost} lost`);
  check(result, "the device noticed the outage and recovered", Boolean(firstFailure) && !Number.isNaN(recoveredAt));
  return result;
}
