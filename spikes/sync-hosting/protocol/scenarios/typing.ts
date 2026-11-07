// A person typing on the iPad on a mobile hotspot, and what that costs in requests.
//
// The iPad (device A) autosaves every 500 ms while typing, in bursts of 10-25 s with 4-10 s thinking pauses,
// and pushes with the design's 2 s debounce. The desktop (device B) is idle and is told by hints. The link
// is a simulated hotspot: 100-300 ms added to every request, 1% of requests and 1% of responses lost.
// Counted from what the engine put on the wire, retries included, by kind:
//   push      carries changes          pull-only  carries none and returns records
//   wasted    carries none and returns none (the engine asked a question it could have answered itself)

import { mulberry32, newUuid, sleep } from "../client/bytes.ts";
import type { SyncRequest, SyncResponse, InfoResponse } from "../types.ts";
import type { Transport, TransportStats } from "../client/transport.ts";
import { check, newResult, nowMs, summarize, waitFor, type Context, type Result } from "./common.ts";
import { editIdOf, makePayload } from "./edits.ts";

class CountingTransport implements Transport {
  readonly kinds = { push: 0, pullOnly: 0, wasted: 0, resync: 0 };
  private readonly inner: Transport;
  constructor(inner: Transport) {
    this.inner = inner;
  }
  get stats(): TransportStats {
    return this.inner.stats;
  }
  info(): Promise<InfoResponse> {
    return this.inner.info();
  }
  async sync(req: SyncRequest): Promise<SyncResponse> {
    const resp = await this.inner.sync(req);
    if (resp.resync) this.kinds.resync += 1;
    else if (req.changes.length > 0) this.kinds.push += 1;
    else if (resp.changes.length > 0) this.kinds.pullOnly += 1;
    else this.kinds.wasted += 1;
    return resp;
  }
}

export async function typing(ctx: Context): Promise<Result> {
  const seconds = ctx.num("seconds", 90);
  const noteBytes = ctx.num("note-bytes", 8192);
  // --no-hotspot leaves the link as it is (use it on real hosts if you want only the real network).
  const plan = ctx.args["no-hotspot"] ? {} : { delayMs: [100, 300] as [number, number], dropRequest: 0.01, dropResponse: 0.01 };
  const result = newResult(ctx, ctx.str("name") ?? "typing", { seconds, autosaveMs: 500, pushDebounceMs: 2000, burstSeconds: "10-25", pauseSeconds: "4-10", noteBytes, hotspot: plan });
  const rng = mulberry32(51);
  const user = "s-normal";
  await ctx.reset(user);

  const countA = { t: null as CountingTransport | null };
  const countB = { t: null as CountingTransport | null };
  const got = new Map<number, number>();
  const a = await ctx.device(user, "a", {
    faults: plan, seed: 3, wrap: (t) => (countA.t = new CountingTransport(t)),
    device: { pushDebounceMs: 2000, retry: { baseMs: 300, maxMs: 3000 } },
  });
  const b = await ctx.device(user, "b", {
    faults: plan, seed: 4, wrap: (t) => (countB.t = new CountingTransport(t)),
    device: { retry: { baseMs: 300, maxMs: 3000 }, onRemote: (e) => got.set(editIdOf(e.payload), e.at) },
  });
  await Promise.all([a.syncNow(), b.syncNow()]);
  for (const c of [countA.t!, countB.t!]) for (const k of Object.keys(c.kinds) as (keyof typeof c.kinds)[]) c.kinds[k] = 0;
  const a0 = { ...a.transportStats };
  const b0 = { ...b.transportStats };

  const note = newUuid();
  const settle: number[] = [];
  const start = nowMs();
  let id = 0;
  let bursts = 0;
  while (nowMs() - start < seconds * 1000) {
    const burstEnd = nowMs() + (10 + rng() * 15) * 1000;
    let lastEditAt = nowMs();
    while (nowMs() < burstEnd && nowMs() - start < seconds * 1000) {
      id += 1;
      a.edit("note", note, makePayload(id, noteBytes, rng));
      lastEditAt = nowMs();
      await sleep(500);
    }
    bursts += 1;
    // Thinking pause: how long after the last autosave until the desktop holds that text?
    const lastId = id;
    await waitFor(() => got.has(lastId), 60_000, `the desktop to hold edit ${lastId}`, 20).catch((e) => result.notes.push(String(e)));
    if (got.has(lastId)) settle.push(got.get(lastId)! - lastEditAt);
    await sleep(Math.max(0, (4 + rng() * 6) * 1000 - (nowMs() - lastEditAt)));
  }
  const elapsed = (nowMs() - start) / 1000;
  // Snapshot before the final forced sync below, which is the scenario's own check and not part of the session.
  const A = { ...countA.t!.kinds };
  const B = { ...countB.t!.kinds };
  const aEnd = { ...a.transportStats };
  const bEnd = { ...b.transportStats };
  await Promise.all([a.syncNow(), b.syncNow()]);

  const requestsA = A.push + A.pullOnly + A.wasted + A.resync;
  result.metrics = {
    elapsedS: Math.round(elapsed),
    autosaves: id,
    bursts,
    ipad: {
      requests: requestsA,
      perMinute: Math.round((requestsA / elapsed) * 60 * 10) / 10,
      ...A,
      bytesUpKB: Math.round((aEnd.bytesUp - a0.bytesUp) / 102.4) / 10,
      bytesDownKB: Math.round((aEnd.bytesDown - a0.bytesDown) / 102.4) / 10,
      retries: a.stats.retries,
    },
    desktop: { requests: bEnd.requests - b0.requests, ...B, bytesDownKB: Math.round((bEnd.bytesDown - b0.bytesDown) / 102.4) / 10 },
    lastKeystrokeToDesktopMs: summarize(settle),
  };
  check(result, "the desktop ended up with the last text typed", got.has(id));
  check(result, "no conflicts with one writer", a.stats.conflicts + b.stats.conflicts === 0);
  return result;
}
