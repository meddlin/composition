// First sync of a 10 MB library. Phase 1: a device that already holds the library signs in and uploads it
// (paged pushes). Phase 2: an empty device signs in and pulls everything from cursor 0 (paged pulls).

import { newUuid, mulberry32, sha256, randomPayload } from "../client/bytes.ts";
import type { Device } from "../client/device.ts";
import { check, newResult, nowMs, type Context, type Result } from "./common.ts";

function digest(d: Device): string {
  const lines = [...d.records.entries()]
    .filter(([, r]) => !r.deleted)
    .map(([k, r]) => `${k}:${sha256(r.payload)}`)
    .sort();
  return sha256(new TextEncoder().encode(lines.join("\n")));
}

export async function library(ctx: Context): Promise<Result> {
  const targetBytes = ctx.num("mb", 10) * 1024 * 1024;
  const result = newResult(ctx, "library", { targetBytes, noteBytes: "2-8 KiB, uniform", placementBytes: 120 });
  const rng = mulberry32(13);
  const user = "s-library";
  await ctx.reset(user);

  const a = await ctx.device(user, "a", { hints: "none" });
  let bytes = 0;
  let notes = 0;
  while (bytes < targetBytes) {
    const size = 2048 + Math.floor(rng() * 6144);
    const uuid = newUuid();
    a.edit("note", uuid, randomPayload(size, rng));
    a.edit("placement", uuid, randomPayload(120, rng));
    bytes += size + 120;
    notes += 1;
  }

  const up0 = nowMs();
  await a.syncNow();
  const uploadMs = nowMs() - up0;
  const aStats = a.transportStats;

  const b = await ctx.device(user, "b", { hints: "none" });
  const down0 = nowMs();
  await b.syncNow();
  const downloadMs = nowMs() - down0;
  const bStats = b.transportStats;

  const mb = bytes / 1024 / 1024;
  result.metrics = {
    notes,
    records: notes * 2,
    payloadMB: Math.round(mb * 100) / 100,
    upload: { ms: Math.round(uploadMs), requests: aStats.requests, wireMBUp: Math.round((aStats.bytesUp / 1e6) * 10) / 10, MBps: Math.round((mb / (uploadMs / 1000)) * 10) / 10 },
    initialPull: { ms: Math.round(downloadMs), requests: bStats.requests, wireMBDown: Math.round((bStats.bytesDown / 1e6) * 10) / 10, MBps: Math.round((mb / (downloadMs / 1000)) * 10) / 10 },
    retries: a.stats.retries + b.stats.retries,
  };
  check(result, "uploader pushed everything without conflicts", a.dirtyCount() === 0 && a.stats.conflicts === 0);
  check(result, "the new device holds every record", b.records.size === a.records.size, `${b.records.size} vs ${a.records.size}`);
  check(result, "payloads are byte-identical on both devices", digest(a) === digest(b));
  return result;
}
