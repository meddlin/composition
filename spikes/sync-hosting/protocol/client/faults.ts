// Fault injection around any Transport. Each fault is drawn from a seeded PRNG so a run can be replayed.
//   dropRequest   the request never reaches the server (the engine must resend)
//   dropResponse  the server applied the push but the device never hears (the retry must be idempotent)
//   duplicate     the server receives the same request twice
//   http503       the server answers 503
//   delayMs       added latency, uniform in [min, max]

import type { InfoResponse, SyncRequest, SyncResponse } from "../types.ts";
import { sleep } from "./bytes.ts";
import { TransportError, type Transport, type TransportStats } from "./transport.ts";

export interface FaultPlan {
  dropRequest?: number;
  dropResponse?: number;
  duplicate?: number;
  http503?: number;
  delayMs?: [number, number];
}

export class FaultyTransport implements Transport {
  readonly injected = { dropRequest: 0, dropResponse: 0, duplicate: 0, http503: 0, delayed: 0 };
  private readonly inner: Transport;
  private readonly plan: FaultPlan;
  private readonly rng: () => number;

  constructor(inner: Transport, plan: FaultPlan, rng: () => number) {
    this.inner = inner;
    this.plan = plan;
    this.rng = rng;
  }

  get stats(): TransportStats {
    return this.inner.stats;
  }

  info(): Promise<InfoResponse> {
    return this.inner.info();
  }

  async sync(req: SyncRequest): Promise<SyncResponse> {
    const { plan, rng } = this;
    if (plan.delayMs) {
      const [lo, hi] = plan.delayMs;
      this.injected.delayed += 1;
      await sleep(lo + rng() * (hi - lo));
    }
    if (rng() < (plan.dropRequest ?? 0)) {
      this.injected.dropRequest += 1;
      throw new TransportError("injected: request dropped", true);
    }
    if (rng() < (plan.http503 ?? 0)) {
      this.injected.http503 += 1;
      throw new TransportError("injected: HTTP 503", true, 503);
    }
    const response = await this.inner.sync(req);
    if (rng() < (plan.duplicate ?? 0)) {
      this.injected.duplicate += 1;
      await this.inner.sync(req).catch(() => {});
    }
    if (rng() < (plan.dropResponse ?? 0)) {
      this.injected.dropResponse += 1;
      throw new TransportError("injected: response dropped", true);
    }
    return response;
  }
}
