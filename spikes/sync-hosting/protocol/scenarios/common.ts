// Shared plumbing for the scenarios: a context that builds devices against one candidate, timing
// summaries, and the result format written under results/.

import { execFile } from "node:child_process";
import { Device, type DeviceOptions } from "../client/device.ts";
import { adminToken, resolveBaseUrl, tokenFor, type CandidateName } from "../client/env.ts";
import { FaultyTransport, type FaultPlan } from "../client/faults.ts";
import { mulberry32, percentile, sleep } from "../client/bytes.ts";
import { openHints, pollHints, type HintSource } from "../client/hints.ts";
import { HttpTransport, type Transport } from "../client/transport.ts";
import type { InfoResponse } from "../types.ts";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Result {
  scenario: string;
  candidate: string;
  baseUrl: string;
  where: "local" | "real";
  serverKind: string;
  startedAt: string;
  finishedAt: string;
  params: Record<string, unknown>;
  metrics: Record<string, unknown>;
  checks: Check[];
  notes: string[];
}

export interface TimingSummary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function summarize(values: number[]): TimingSummary {
  const s = [...values].sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
  return { n: s.length, min: r(s[0] ?? NaN), p50: r(percentile(s, 50)), p95: r(percentile(s, 95)), p99: r(percentile(s, 99)), max: r(s.at(-1) ?? NaN), mean: r(mean) };
}

export type HintMode = "native" | "poll" | "none";

export interface DeviceSpec {
  hints?: HintMode;
  pollMs?: number;
  faults?: FaultPlan;
  seed?: number;
  device?: Partial<DeviceOptions>;
}

export class Context {
  readonly candidate: CandidateName | "custom";
  readonly baseUrl: string;
  readonly where: "local" | "real";
  info!: InfoResponse;
  readonly args: Record<string, string | boolean | undefined>;
  private readonly cleanups: (() => void)[] = [];

  constructor(args: Record<string, string | boolean | undefined>) {
    const target = resolveBaseUrl(typeof args.candidate === "string" ? args.candidate : undefined);
    this.candidate = target.name;
    this.baseUrl = target.url;
    this.args = args;
    this.where = /\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(this.baseUrl + "/") ? "local" : "real";
  }

  async init(): Promise<void> {
    const res = await fetch(this.baseUrl + "/v1/info", { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${this.baseUrl}/v1/info answered ${res.status}`);
    this.info = (await res.json()) as InfoResponse;
  }

  num(name: string, fallback: number): number {
    const v = this.args[name];
    return typeof v === "string" ? Number(v) : fallback;
  }

  str(name: string): string | undefined {
    const v = this.args[name];
    return typeof v === "string" ? v : undefined;
  }

  transport(user: string, device: string): HttpTransport {
    return new HttpTransport(this.baseUrl, tokenFor(user, device), this.num("timeout", 45) * 1000);
  }

  /** A device with its own transport, optional fault injection, and a hint stream (the server's own by default). */
  async device(user: string, name: string, spec: DeviceSpec = {}): Promise<Device> {
    let transport: Transport = this.transport(user, name);
    if (spec.faults) transport = new FaultyTransport(transport, spec.faults, mulberry32(spec.seed ?? 1));
    const dev = new Device({ name, transport, ...spec.device });
    const mode = spec.hints ?? "native";
    let source: HintSource | undefined;
    if (mode === "native") {
      source = await openHints(this.baseUrl, this.info, tokenFor(user, name), (h) => dev.onHint(h));
      await Promise.race([source.ready, sleep(30_000).then(() => Promise.reject(new Error(`${name}: hint stream not ready in 30 s`)))]);
    } else if (mode === "poll") {
      source = pollHints(spec.pollMs ?? 5000, (h) => dev.onHint(h));
    }
    if (source) dev.attachHints(source);
    this.cleanups.push(() => dev.stop());
    return dev;
  }

  async admin(path: string, body: unknown): Promise<unknown> {
    const token = adminToken();
    if (!token) throw new Error("SYNC_ADMIN_TOKEN is not set");
    const res = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async reset(user: string): Promise<void> {
    await this.admin("/v1/admin/reset", { user });
  }

  async epoch(): Promise<string> {
    const res = await fetch(this.baseUrl + "/v1/info", { signal: AbortSignal.timeout(30_000) });
    return ((await res.json()) as InfoResponse).epoch;
  }

  finish(): void {
    for (const c of this.cleanups.splice(0)) c();
  }
}

export function newResult(ctx: Context, scenario: string, params: Record<string, unknown>): Result {
  return {
    scenario,
    candidate: ctx.candidate,
    baseUrl: ctx.baseUrl,
    where: ctx.where,
    serverKind: ctx.info.server,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    params,
    metrics: {},
    checks: [],
    notes: [],
  };
}

export function check(result: Result, name: string, ok: boolean, detail?: string): void {
  result.checks.push({ name, ok, detail });
}

/** Run a shell command (the per-candidate drill scripts), returning how long it took and what it printed. */
export function sh(command: string, env: Record<string, string> = {}): Promise<{ ms: number; stdout: string; code: number }> {
  const started = performance.now();
  return new Promise((resolve) => {
    execFile("bash", ["-c", command], { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      resolve({ ms: performance.now() - started, stdout: stdout.trim(), code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
    });
  });
}

export const nowMs = () => performance.now();

/** Wait until `pred` is true, polling, or throw after timeoutMs. Returns how long it took. */
export async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs: number, what: string, everyMs = 25): Promise<number> {
  const started = performance.now();
  while (!(await pred())) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(everyMs);
  }
  return performance.now() - started;
}
