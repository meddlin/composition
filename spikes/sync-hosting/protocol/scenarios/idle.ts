// First sync after idle. Warm the path with a few pushes, leave everything alone, then push again.
// With the single-process design the API answers "anything new?" from memory, so an idle service never
// touches its database; the first push after the pause is where a sleeping database (Neon) or a cold
// machine would show.

import { mulberry32, newUuid, sleep } from "../client/bytes.ts";
import { check, newResult, nowMs, summarize, type Context, type Result } from "./common.ts";
import { editIdOf, makePayload } from "./edits.ts";

export async function idle(ctx: Context): Promise<Result> {
  const idleSeconds = ctx.num("idle-seconds", 600);
  const result = newResult(ctx, "idle", { idleSeconds, warmPushes: 5, payloadBytes: 4096 });
  const rng = mulberry32(17);
  const user = "s-idle";
  await ctx.reset(user);

  let ackWaiter: ((e: { ms: number; at: number }) => void) | null = null;
  const got = new Map<number, number>();
  const a = await ctx.device(user, "a", { device: { onAck: (e) => ackWaiter?.(e) } });
  const b = await ctx.device(user, "b", { device: { onRemote: (e) => got.set(editIdOf(e.payload), e.at) } });
  await Promise.all([a.syncNow(), b.syncNow()]);

  async function oneEdit(id: number): Promise<{ ackMs: number; propMs: number }> {
    const acked = new Promise<{ ms: number; at: number }>((res) => (ackWaiter = res));
    const t0 = nowMs();
    a.edit("note", newUuid(), makePayload(id, 4096, rng));
    const ack = await acked;
    while (!got.has(id) && nowMs() - t0 < 120_000) await sleep(2);
    return { ackMs: ack.at - t0, propMs: (got.get(id) ?? NaN) - t0 };
  }

  const warm: number[] = [];
  const warmProp: number[] = [];
  for (let i = 1; i <= 5; i++) {
    const r = await oneEdit(i);
    warm.push(r.ackMs);
    warmProp.push(r.propMs);
    await sleep(500);
  }
  console.log(`  idle for ${idleSeconds} s ...`);
  await sleep(idleSeconds * 1000);
  const cold = await oneEdit(100);
  const second = await oneEdit(101);

  result.metrics = {
    warmAckMs: summarize(warm),
    warmPropagationMs: summarize(warmProp),
    afterIdle: { ackMs: Math.round(cold.ackMs), propagationMs: Math.round(cold.propMs) },
    secondAfterIdle: { ackMs: Math.round(second.ackMs), propagationMs: Math.round(second.propMs) },
    afterIdleVsWarmMedian: Math.round((cold.ackMs / summarize(warm).p50) * 10) / 10,
  };
  check(result, "the push after idle arrived on B", Number.isFinite(cold.propMs));
  return result;
}
