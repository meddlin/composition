// Normal edits: device A edits one note at a time; device B is told by a hint and pulls.
// Measures what the infrastructure adds to the design's 3-4 s budget: the push is immediate here (the app
// adds a 2 s debounce), so "ack" is request + server write + response, and "propagation" is edit -> B has it.

import { mulberry32, newUuid, sleep } from "../client/bytes.ts";
import { check, newResult, nowMs, summarize, type Context, type HintMode, type Result } from "./common.ts";
import { editIdOf, makePayload } from "./edits.ts";

export async function normal(ctx: Context): Promise<Result> {
  const edits = ctx.num("edits", 30);
  const gap = ctx.num("gap", 1500);
  const hints = (ctx.str("hints") ?? "native") as HintMode;
  const pollMs = ctx.num("poll-ms", 5000);
  const result = newResult(ctx, "normal", { edits, gapMs: gap, hints, pollMs: hints === "poll" ? pollMs : undefined, notes: 20, payloadBytes: 4096 });
  const rng = mulberry32(7);
  const user = "s-normal";
  await ctx.reset(user);

  const gotB = new Map<number, number>();
  let ackWaiter: ((at: number) => void) | null = null;
  const a = await ctx.device(user, "a", { hints, pollMs, device: { onAck: (e) => ackWaiter?.(e.at) } });
  const b = await ctx.device(user, "b", {
    hints,
    pollMs,
    device: { onRemote: (e) => gotB.set(editIdOf(e.payload), e.at) },
  });
  await Promise.all([a.syncNow(), b.syncNow()]);

  const uuids = Array.from({ length: 20 }, () => newUuid());
  const ack: number[] = [];
  const prop: number[] = [];
  let missed = 0;
  for (let i = 1; i <= edits + 3; i++) {
    const warm = i <= 3; // the first three edits warm connections and are not counted
    const acked = new Promise<number>((res) => (ackWaiter = res));
    const t0 = nowMs();
    a.edit("note", uuids[i % uuids.length]!, makePayload(i, 4096, rng));
    const tAck = await Promise.race([acked, sleep(60_000).then(() => NaN)]);
    const deadline = nowMs() + 60_000;
    while (!gotB.has(i) && nowMs() < deadline) await sleep(2);
    const tB = gotB.get(i);
    if (!warm) {
      if (Number.isNaN(tAck) || tB === undefined) missed += 1;
      else {
        ack.push(tAck - t0);
        prop.push(tB - t0);
      }
    }
    await sleep(gap);
  }
  result.metrics = { ackMs: summarize(ack), propagationMs: summarize(prop), missedEdits: missed, requestsFromA: a.transportStats.requests, deviceAErrors: a.stats.failures.length };
  check(result, "every edit reached device B", missed === 0, `${missed} missed`);
  check(result, "no conflicts with one writer", a.stats.conflicts + b.stats.conflicts === 0);
  const p95 = (result.metrics.propagationMs as { p95: number }).p95;
  check(result, "propagation p95 within the design's 10 s target", p95 <= 10_000, `p95 ${p95} ms (excludes the app's 2 s push debounce)`);
  return result;
}
