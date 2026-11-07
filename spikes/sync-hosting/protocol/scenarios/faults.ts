// Fault injection with three devices: dropped requests, dropped responses (the server applied the push
// but the device never heard), duplicated deliveries, 503s and delays, from a seeded generator.
//
// Phase 1 (solo): one device under duplicate and dropped-response faults must never see a conflict. A server
// that is not idempotent fails here, because the second delivery of the same push would conflict with the first.
// Phase 2 (rounds): three devices edit overlapping notes, then sync concurrently through faulty transports.
// After each round every device and the server must agree, and the last text each device wrote to each note
// must still exist somewhere on the server, as the winner or as a conflict copy.

import { mulberry32, newUuid, sha256 } from "../client/bytes.ts";
import { settle, type Device } from "../client/device.ts";
import { FaultyTransport, type FaultPlan } from "../client/faults.ts";
import { PROTOCOL_VERSION } from "../types.ts";
import { decodeBase64 } from "../b64.ts";
import { newBatchId } from "../client/bytes.ts";
import { check, newResult, type Context, type Result } from "./common.ts";
import { editIdOf, makePayload } from "./edits.ts";

export interface ServerRecord {
  deleted: boolean;
  version: number;
  payload: Uint8Array;
}

/** Everything the server holds for a user, read with a plain transport. */
export async function readServerState(ctx: Context, user: string, device: string): Promise<{ records: Map<string, ServerRecord>; head: number }> {
  const tx = ctx.transport(user, device);
  const records = new Map<string, ServerRecord>();
  let cursor = 0;
  let head = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    const r = await tx.sync({ protocolVersion: PROTOCOL_VERSION, batchId: newBatchId(), cursor, changes: [], pullLimit: 200 });
    head = r.head;
    for (const rec of r.changes) {
      records.set(`${rec.entity}/${rec.uuid}`, { deleted: rec.deleted, version: rec.version, payload: decodeBase64(rec.payload) ?? new Uint8Array(0) });
    }
    cursor = r.cursor;
    if (!r.more) return { records, head };
  }
  throw new Error("server state did not terminate");
}

export async function faults(ctx: Context): Promise<Result> {
  const rounds = ctx.num("rounds", 25);
  const plan: FaultPlan = { dropRequest: 0.1, dropResponse: 0.15, duplicate: 0.1, http503: 0.05, delayMs: [0, 150] };
  const result = newResult(ctx, "faults", { rounds, devices: 3, notes: 30, plan, seed: 1 });
  const rng = mulberry32(21);
  const user = "s-fault";
  await ctx.reset(user);
  const retry = { baseMs: 20, maxMs: 300 };

  // Phase 1: solo, duplicates and lost responses only.
  const solo = await ctx.device(user, "c", { hints: "none", faults: { duplicate: 0.3, dropResponse: 0.3 }, seed: 5, device: { retry } });
  for (let i = 1; i <= 40; i++) {
    solo.edit("note", newUuid(), makePayload(i, 512, rng));
    await solo.syncNow();
  }
  check(result, "solo device under duplicate and lost-response faults saw zero conflicts (idempotent retry)", solo.stats.conflicts === 0, `${solo.stats.conflicts} conflicts, ${solo.stats.retries} retries`);
  solo.stop();

  // Phase 2: three devices, overlapping notes.
  await ctx.reset(user);
  const devs: Device[] = [];
  for (const [i, name] of ["a", "b", "c"].entries()) {
    devs.push(await ctx.device(user, name, { hints: "none", faults: plan, seed: 10 + i, device: { retry } }));
  }
  const keys = Array.from({ length: 30 }, () => newUuid());
  let editId = 0;
  let lostEdits = 0;
  let divergences = 0;
  let maxHead = 0;

  for (let round = 1; round <= rounds; round++) {
    const required = new Set<number>(); // last edit id per (device, note) this round
    for (const dev of devs) {
      const last = new Map<string, number>();
      for (let k = 1 + Math.floor(rng() * 3); k > 0; k--) {
        const uuid = keys[Math.floor(rng() * keys.length)]!;
        const existing = dev.get("note", uuid);
        if (existing && !existing.deleted && rng() < 0.1) {
          dev.remove("note", uuid);
          last.delete(uuid);
        } else {
          editId += 1;
          dev.edit("note", uuid, makePayload(editId, 256 + Math.floor(rng() * 1024), rng));
          last.set(uuid, editId);
        }
      }
      for (const id of last.values()) required.add(id);
    }
    // Everyone syncs at once, then keep going until nothing is dirty and every device is at the head.
    await Promise.all(devs.map((d) => d.syncNow()));
    for (let pass = 0; pass < 20; pass++) {
      await settle(devs, 60_000);
      const { head } = await readServerState(ctx, user, "a");
      maxHead = head;
      if (devs.every((d) => d.cursor >= head && d.dirtyCount() === 0)) break;
    }

    const server = await readServerState(ctx, user, "a");
    const present = new Set<number>();
    for (const r of server.records.values()) if (!r.deleted) present.add(editIdOf(r.payload));
    for (const id of required) if (!present.has(id)) lostEdits += 1;
    for (const dev of devs) {
      for (const [k, rec] of server.records) {
        const mine = dev.records.get(k);
        if (!mine || mine.deleted !== rec.deleted || (!rec.deleted && sha256(mine.payload) !== sha256(rec.payload))) divergences += 1;
      }
      for (const [k, mine] of dev.records) if (!mine.deleted && !server.records.has(k)) divergences += 1;
    }
  }

  const injected = devs.reduce(
    (acc, d) => {
      const t = d.transport as FaultyTransport;
      for (const key of Object.keys(acc) as (keyof typeof acc)[]) acc[key] += t.injected[key];
      return acc;
    },
    { dropRequest: 0, dropResponse: 0, duplicate: 0, http503: 0, delayed: 0 },
  );
  result.metrics = {
    editsMade: editId,
    serverHead: maxHead,
    faultsInjected: injected,
    retries: devs.reduce((n, d) => n + d.stats.retries, 0),
    conflicts: devs.reduce((n, d) => n + d.stats.conflicts, 0),
    conflictCopies: devs.reduce((n, d) => n + d.stats.conflictCopies, 0),
    lostEdits,
    divergences,
  };
  check(result, "no device's last text for a note was lost: each survives as the winner or a conflict copy", lostEdits === 0, `${lostEdits} lost`);
  check(result, "after every round all devices and the server agree", divergences === 0, `${divergences} differences`);
  return result;
}
