// Concurrent pushes from 8 devices of one user, no engine in the way: raw requests, each device looping.
// Every device pushes 5 fresh records plus an update of one of 4 shared, contended records per round.
// Checks the property the whole design leans on: the versions handed out are exactly 1..head, each once.

import { encodeBase64 } from "../b64.ts";
import { newBatchId, newUuid, mulberry32, randomPayload, sleep } from "../client/bytes.ts";
import { TransportError } from "../client/transport.ts";
import { PROTOCOL_VERSION, type WireChange } from "../types.ts";
import { check, newResult, nowMs, summarize, type Context, type Result } from "./common.ts";

export async function concurrent(ctx: Context): Promise<Result> {
  const devices = ctx.num("devices", 8);
  const rounds = ctx.num("rounds", 40);
  const result = newResult(ctx, "concurrent", { devices, rounds, freshPerPush: 5, sharedRecords: 4, payloadBytes: 1024 });
  const user = "s-concurrent";
  await ctx.reset(user);

  const names = "abcdefgh".split("").slice(0, devices);
  const shared = Array.from({ length: 4 }, () => newUuid());
  const appliedVersions: number[] = [];
  const latencies: number[] = [];
  let conflicts = 0;
  let retries = 0;
  let failures = 0;
  const errorSamples = new Set<string>();

  await Promise.all(
    names.map(async (name, di) => {
      const tx = ctx.transport(user, name);
      const rng = mulberry32(100 + di);
      const known = new Map<string, number>(shared.map((u) => [u, 0]));
      for (let round = 0; round < rounds; round++) {
        const target = shared[Math.floor(rng() * shared.length)]!;
        const changes: WireChange[] = [
          ...Array.from({ length: 5 }, () => ({
            entity: "note", uuid: newUuid(), baseVersion: 0, deleted: false, schemaVersion: 1, payload: encodeBase64(randomPayload(1024, rng)),
          })),
          { entity: "note", uuid: target, baseVersion: known.get(target)!, deleted: false, schemaVersion: 1, payload: encodeBase64(randomPayload(1024, rng)) },
        ];
        const req = { protocolVersion: PROTOCOL_VERSION, deviceId: name, batchId: newBatchId(), cursor: 0, changes, pullLimit: 0 };
        const t0 = nowMs();
        let delay = 100;
        for (let attempt = 1; ; attempt++) {
          try {
            const resp = await tx.sync(req);
            latencies.push(nowMs() - t0);
            for (const ap of resp.applied) {
              appliedVersions.push(ap.version);
              if (ap.uuid === target) known.set(target, ap.version);
            }
            for (const c of resp.conflicts) {
              conflicts += 1;
              if (c.current) known.set(c.uuid, c.current.version);
            }
            break;
          } catch (err) {
            if (!(err instanceof TransportError) || !err.retryable || attempt >= 8) {
              failures += 1;
              errorSamples.add(err instanceof Error ? err.message.slice(0, 120) : String(err));
              break;
            }
            retries += 1;
            errorSamples.add(err.message.slice(0, 120));
            await sleep(delay);
            delay = Math.min(delay * 2, 2000);
          }
        }
      }
    }),
  );

  const head = (await ctx.transport(user, "a").sync({ protocolVersion: PROTOCOL_VERSION, batchId: newBatchId(), cursor: 0, changes: [], pullLimit: 0 })).head;
  const sorted = [...appliedVersions].sort((x, y) => x - y);
  const dups = sorted.length - new Set(sorted).size;
  const gaps = sorted.filter((v, i) => v !== i + 1).length;
  result.metrics = {
    pushes: names.length * rounds,
    appliedRecords: sorted.length,
    head,
    duplicateVersions: dups,
    versionsOutOfPlace: gaps,
    conflictsOnSharedRecords: conflicts,
    retriesOn5xxOrNetwork: retries,
    pushesGivenUp: failures,
    latencyMs: summarize(latencies),
    errorSamples: [...errorSamples],
  };
  check(result, "versions handed out are exactly 1..head with none repeated", dups === 0 && gaps === 0 && sorted.length === head, `applied ${sorted.length}, head ${head}, dups ${dups}, out of place ${gaps}`);
  check(result, "no push was given up on", failures === 0, `${failures} given up after retries`);
  return result;
}
