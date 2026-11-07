// Restore from backup and let the epoch heal the devices.
//   --devices offline (default)  the devices are switched off during the incident and come back afterwards, so the
//                                server's loss is measured before anything can heal it
//   --devices live               they stay connected and notice by themselves (hint reconnect or poll)
//   1. A and B sync 100 notes.      2. --backup-cmd marks a restore point (or we note the time).
//   3. A writes 70 more records, B receives them.     4. --restore-cmd puts the server back to the point.
//   5. Count what the server lost.  6. Rotate the epoch if the candidate did not (the step is recorded).
//   7. Devices find out on their own (hint or poll) and re-push; a brand-new device must see everything.

import { mulberry32, newUuid, sha256, sleep } from "../client/bytes.ts";
import { check, newResult, nowMs, sh, waitFor, type Context, type Result } from "./common.ts";
import { makePayload } from "./edits.ts";
import { readServerState } from "./faults.ts";

export async function restore(ctx: Context): Promise<Result> {
  const restoreCmd = ctx.str("restore-cmd");
  const backupCmd = ctx.str("backup-cmd");
  const settleMs = ctx.num("settle-ms", 3000);
  const devicesMode = ctx.str("devices") ?? "offline";
  const rotate = ctx.str("rotate") ?? "if-needed";
  const result = newResult(ctx, "restore", { before: 100, after: 70, settleMs, rotate, devices: devicesMode, backupCmd: backupCmd ? "(script)" : null });
  if (!restoreCmd) {
    result.notes.push("no --restore-cmd given");
    result.metrics = { skipped: true };
    return result;
  }
  const rng = mulberry32(41);
  const user = "s-drill";
  await ctx.reset(user);

  const retry = { baseMs: 200, maxMs: 2000 };
  let a = await ctx.device(user, "a", { device: { retry } });
  let b = await ctx.device(user, "b", { device: { retry } });
  const uuids: string[] = [];
  for (let i = 0; i < 100; i++) {
    uuids.push(newUuid());
    a.edit("note", uuids[i]!, makePayload(i + 1, 2048, rng));
  }
  await a.syncNow();
  await waitFor(() => b.records.size >= 100, 60_000, "B to receive the first 100 notes");

  const point = backupCmd ? (await sh(backupCmd)).stdout : new Date().toISOString();
  await sleep(2000); // keep a timestamp-based restore point strictly before the next writes

  for (let i = 0; i < 50; i++) {
    uuids.push(newUuid());
    a.edit("note", uuids[uuids.length - 1]!, makePayload(1000 + i, 2048, rng));
  }
  for (let i = 0; i < 20; i++) a.edit("note", uuids[i]!, makePayload(2000 + i, 2048, rng)); // edits to existing notes
  await a.syncNow();
  await waitFor(() => b.records.size >= 150, 60_000, "B to receive the next 70 writes");
  const expected = new Map([...a.records].map(([k, r]) => [k, sha256(r.payload)]));
  await sleep(settleMs);

  const epochBefore = await ctx.epoch();
  const offline = devicesMode === "offline";
  const savedA = a.exportState();
  const savedB = b.exportState();
  if (offline) {
    a.stop();
    b.stop();
  }
  const tRestore = nowMs();
  const r = await sh(restoreCmd, { RESTORE_POINT: point, BASE_URL: ctx.baseUrl });
  // The script should return once the server answers again; make sure.
  await waitFor(async () => (await fetch(ctx.baseUrl + "/v1/info", { signal: AbortSignal.timeout(5000) }).then((x) => x.ok).catch(() => false)), 600_000, "the server to answer after the restore", 500);
  const tServing = nowMs();
  let epochAfter = await ctx.epoch();

  const afterRestore = await readServerState(ctx, user, "c");
  const onServer = [...expected].filter(([k, h]) => afterRestore.records.has(k) && sha256(afterRestore.records.get(k)!.payload) === h).length;
  let rotatedByHand = false;
  if (epochAfter === epochBefore && rotate !== "never") {
    await ctx.admin("/v1/admin/rotate-epoch", {});
    rotatedByHand = true;
    epochAfter = await ctx.epoch();
  }
  if (offline) {
    // The devices come back, with the state they had when they went away.
    a = await ctx.device(user, "a", { device: { retry, initial: savedA } });
    b = await ctx.device(user, "b", { device: { retry, initial: savedB } });
  }
  const tRotated = nowMs();

  // The devices find out by themselves: their hint stream reconnects (or their poll fires), they send the old
  // epoch, the server answers resync, and they compare and re-push. Wait for that, not just for the server.
  let noticedMs = NaN;
  let healMs = NaN;
  try {
    await waitFor(() => a.epoch === epochAfter && b.epoch === epochAfter, 180_000, "both devices to move to the new epoch", 100);
    noticedMs = nowMs() - tRotated;
    await waitFor(async () => {
      if (a.dirtyCount() > 0 || b.dirtyCount() > 0) return false;
      const s = await readServerState(ctx, user, "c");
      return [...expected].every(([k, h]) => s.records.has(k) && sha256(s.records.get(k)!.payload) === h);
    }, 180_000, "the devices to re-push what the server lacked", 250);
    healMs = nowMs() - tRotated;
  } catch (e) {
    result.notes.push(String(e));
    result.notes.push(`devices: a.epoch=${a.epoch} b.epoch=${b.epoch} want=${epochAfter} a.dirty=${a.dirtyCount()} b.dirty=${b.dirtyCount()}`);
  }

  const fresh = await ctx.device(user, "c", { hints: "none" });
  await fresh.syncNow();
  const freshHolds = [...expected].filter(([k, h]) => fresh.records.has(k) && sha256(fresh.records.get(k)!.payload) === h).length;

  result.metrics = {
    restorePoint: point,
    restoreCommandMs: Math.round(r.ms),
    serverServingAgainAfterMs: Math.round(tServing - tRestore),
    epochChangedByRestore: epochAfter !== epochBefore && !rotatedByHand,
    epochRotatedByHandStep: rotatedByHand,
    recordsExpected: expected.size,
    recordsOnServerRightAfterRestore: onServer,
    recordsLostByServerInRestore: expected.size - onServer, // exact in offline mode; in live mode devices may have healed first
    devicesNoticedNewEpochAfterMs: Number.isNaN(noticedMs) ? null : Math.round(noticedMs),
    healedAfterMs: Number.isNaN(healMs) ? null : Math.round(healMs),
    resyncs: { a: a.stats.resyncs, b: b.stats.resyncs },
    repushed: { a: a.stats.repushed, b: b.stats.repushed },
    recordsLostPermanently: [...expected].filter(([k, h]) => !(afterRestore.records.get(k) && sha256(afterRestore.records.get(k)!.payload) === h) && !(fresh.records.has(k) && sha256(fresh.records.get(k)!.payload) === h)).length,
    freshDeviceHolds: `${freshHolds}/${expected.size}`,
  };
  check(result, "restore command succeeded", r.code === 0, `exit ${r.code}`);
  check(result, "the epoch changed (by the restore or by the hand step)", epochAfter !== epochBefore);
  check(result, "both devices noticed the new epoch on their own and resynced", !Number.isNaN(noticedMs) && a.stats.resyncs >= 1 && b.stats.resyncs >= 1, `resyncs a=${a.stats.resyncs} b=${b.stats.resyncs}`);
  check(result, "devices healed the server: it holds every record again", !Number.isNaN(healMs));
  check(result, "a brand-new device sees everything", freshHolds === expected.size, `${freshHolds}/${expected.size}`);
  return result;
}
