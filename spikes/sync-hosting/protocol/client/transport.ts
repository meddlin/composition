// The device's view of a server: two calls. HttpTransport speaks the HTTP contract that all three
// candidates expose; FaultyTransport (faults.ts) wraps any Transport to inject failures.

import type { InfoResponse, SyncRequest, SyncResponse } from "../types.ts";

export class TransportError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

export interface TransportStats {
  requests: number;
  bytesUp: number;
  bytesDown: number;
}

export interface Transport {
  info(): Promise<InfoResponse>;
  sync(req: SyncRequest): Promise<SyncResponse>;
  readonly stats: TransportStats;
}

export class HttpTransport implements Transport {
  readonly stats: TransportStats = { requests: 0, bytesUp: 0, bytesDown: 0 };
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, token: string, timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async info(): Promise<InfoResponse> {
    const res = await this.fetchJson("GET", "/v1/info");
    return res as InfoResponse;
  }

  async sync(req: SyncRequest): Promise<SyncResponse> {
    return (await this.fetchJson("POST", "/v1/sync", JSON.stringify(req))) as SyncResponse;
  }

  private async fetchJson(method: string, path: string, body?: string): Promise<unknown> {
    this.stats.requests += 1;
    if (body) this.stats.bytesUp += body.length;
    let res: Response;
    let text: string;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      // Connection refused, reset, DNS, timeout: the request may or may not have reached the server.
      throw new TransportError(`network: ${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)}`, true);
    }
    this.stats.bytesDown += text.length;
    if (res.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw new TransportError(`bad JSON in a ${res.status} response`, true, res.status);
      }
    }
    const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
    throw new TransportError(`HTTP ${res.status}: ${text.slice(0, 200)}`, retryable, res.status);
  }
}
