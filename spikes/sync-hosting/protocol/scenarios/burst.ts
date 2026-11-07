// A burst of 500 edits over 100 notes in about 5 seconds: the outbox is keyed by record, so edits that land
// while a push is in flight coalesce. Measures how long until B has the last value of every note, how many
// requests that took, and push latency under load.

import { mulberry32, newUuid, sleep } from "../client/bytes.ts";
import { check, newResult, nowMs, summarize, waitFor, type Context, type Result } from "./common.ts";
import { editIdOf, makePayload } from "./edits.ts";

export async function burst(ctx: Context): Promise<Result> {
  const edits = ctx.num("edits", 500);
  const notes = ctx.num("notes", 100);
  const spacing = ctx.num("spacing", 10);
  const result = newResult(ctx, "burst", { edits, notes, spacingMs: spacing, payloadBytes: 4096 });
  const rng = mulberry32(11);
  const user = "s-burst";
  await ctx.reset(user);

  const acks: number[] = [];
  const bHas = new Map<string, number>(); // uuid -> latest edit id B holds
  const bAt = new Map<string, number>(); // uuid -> when B got it
  const a = await ctx.device(user, "a", { device: { onAck: (e) => acks.push(e.ms) } });
  const b = await ctx.device(user, "b", { device: { onRemote: (e) => { const u = e.key.split("/")[1]!; bHas.set(u, editIdOf(e.payload)); bAt.set(u, e.at); } } });
  await Promise.all([a.syncNow(), b.syncNow()]);

  const uuids = Array.from({ length: notes }, () => newUuid());
  const expected = new Map<string, number>();
  const t0 = nowMs();
  let lastEditAt = t0;
  for (let i = 1; i <= edits; i++) {
    const uuid = uuids[Math.floor(rng() * notes)]!;
    expected.set(uuid, i);
    a.edit("note", uuid, makePayload(i, 4096, rng));
    lastEditAt = nowMs();
    if (spacing > 0) await sleep(spacing);
  }
  let convergedMs = NaN;
  try {
    await waitFor(() => [...expected].every(([u, id]) => bHas.get(u) === id), 120_000, "device B to hold every note's last edit");
    convergedMs = Math.max(0, Math.max(...[...expected.keys()].map((u) => bAt.get(u) ?? 0)) - lastEditAt);
  } catch (e) {
    result.notes.push(String(e));
  }
  await Promise.all([a.syncNow(), b.syncNow()]);
  const mismatched = [...expected].filter(([u, id]) => bHas.get(u) !== id).length;

  result.metrics = {
    editPhaseMs: Math.round(lastEditAt - t0),
    lastEditToConvergedMs: Math.round(convergedMs),
    pushes: a.stats.pushes,
    editsPerPush: Math.round((edits / Math.max(1, a.stats.pushes)) * 10) / 10,
    requestsFromA: a.transportStats.requests,
    pushAckMs: summarize(acks),
    conflicts: a.stats.conflicts + b.stats.conflicts,
    retries: a.stats.retries + b.stats.retries,
    failures: a.stats.failures.length,
  };
  check(result, "B holds the last edit of every note", mismatched === 0, `${mismatched} of ${expected.size} differ`);
  check(result, "no conflicts and no retries", a.stats.conflicts + b.stats.conflicts + a.stats.retries === 0);
  return result;
}
