// The contract suite: every candidate must pass it, over HTTP, from outside.
//   pnpm contract                              # local lean on :8787 (CANDIDATE=lean)
//   CANDIDATE=postgres pnpm contract           # local Postgres candidate on :8788
//   CANDIDATE=convex pnpm contract             # SYNC_URL_CONVEX (or the local Convex site on :3211)
//   BASE_URL=https://example.fly.dev pnpm contract
//
// Nothing here knows which candidate it is talking to. Tests are relative to the user's current head, so
// the suite can be re-run against a server that already holds data. Admin tests run only when
// SYNC_ADMIN_TOKEN is set, and run last because rotating the epoch invalidates every device's epoch.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeBase64 } from "../b64.ts";
import { adminToken, resolveBaseUrl, tokenFor } from "../client/env.ts";
import { equalBytes, newBatchId, newUuid, randomPayload } from "../client/bytes.ts";
import { openHints, type HintSource } from "../client/hints.ts";
import { LIMITS, PROTOCOL_VERSION, type InfoResponse, type SyncResponse, type WireChange } from "../types.ts";
import { decodeBase64 } from "../b64.ts";

const target = resolveBaseUrl();
const BASE = target.url;

interface Reply<T = SyncResponse> {
  status: number;
  body: T;
}

async function call<T = SyncResponse>(token: string | null, method: string, path: string, body?: unknown): Promise<Reply<T>> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T };
}

class Dev {
  readonly user: string;
  readonly device: string;
  readonly token: string;
  constructor(user: string, device: string) {
    this.user = user;
    this.device = device;
    this.token = tokenFor(user, device);
  }
  /** One /v1/sync call with sensible defaults. */
  async sync(over: Record<string, unknown> = {}): Promise<Reply> {
    return call(this.token, "POST", "/v1/sync", {
      protocolVersion: PROTOCOL_VERSION,
      batchId: newBatchId(),
      cursor: 0,
      changes: [],
      ...over,
    });
  }
  async head(): Promise<number> {
    const r = await this.sync({ pullLimit: 0 });
    assert.equal(r.status, 200);
    return r.body.head;
  }
  /** Pull everything after `cursor`, following `more`. */
  async pullAll(cursor = 0, pullLimit = 200): Promise<SyncResponse["changes"]> {
    const out: SyncResponse["changes"] = [];
    for (let guard = 0; guard < 1000; guard++) {
      const r = await this.sync({ cursor, pullLimit });
      assert.equal(r.status, 200);
      out.push(...r.body.changes);
      cursor = r.body.cursor;
      if (!r.body.more) return out;
    }
    throw new Error("pull did not terminate");
  }
}

function change(over: Partial<WireChange> = {}, size = 64): WireChange {
  return {
    entity: "note",
    uuid: newUuid(),
    baseVersion: 0,
    deleted: false,
    schemaVersion: 1,
    payload: encodeBase64(randomPayload(size)),
    ...over,
  };
}

const sameBytes = (b64: string, bytes: Uint8Array) => {
  const decoded = decodeBase64(b64);
  return decoded !== null && equalBytes(decoded, bytes);
};

let a: Dev, b: Dev, c: Dev, d: Dev, bob: Dev;
let info: InfoResponse;

before(async () => {
  a = new Dev("ct-alice", "a");
  b = new Dev("ct-alice", "b");
  c = new Dev("ct-alice", "c");
  d = new Dev("ct-alice", "d");
  bob = new Dev("ct-bob", "a");
  const r = await call<InfoResponse>(null, "GET", "/v1/info");
  assert.equal(r.status, 200, `cannot reach ${BASE}/v1/info`);
  info = r.body;
});

describe(`contract against ${target.name} ${BASE}`, () => {
  describe("info and auth", () => {
    test("GET /v1/info is open and describes the server", () => {
      assert.equal(info.protocolVersion, PROTOCOL_VERSION);
      assert.equal(info.draft, true);
      assert.match(info.epoch, /^[A-Za-z0-9_-]{8,64}$/);
      assert.deepEqual(info.limits, LIMITS);
      assert.ok(["sse", "convex-query"].includes(info.hint.kind));
      assert.ok(["lean", "postgres", "convex"].includes(info.server));
    });

    test("/v1/sync without a token, or with a wrong one, is 401", async () => {
      assert.equal((await call(null, "POST", "/v1/sync", { protocolVersion: 1 })).status, 401);
      assert.equal((await call("tok_nope", "POST", "/v1/sync", { protocolVersion: 1 })).status, 401);
    });
  });

  describe("push", () => {
    test("a new record gets the next version and round-trips every byte value", async () => {
      const h0 = await a.head();
      const payload = Uint8Array.from({ length: 256 }, (_, i) => i);
      const ch = change({ payload: encodeBase64(payload) });
      const r = await a.sync({ cursor: h0, changes: [ch] });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.applied, [{ entity: "note", uuid: ch.uuid, version: h0 + 1 }]);
      assert.equal(r.body.head, h0 + 1);
      assert.deepEqual(r.body.conflicts, []);
      const pulled = await b.pullAll(h0);
      assert.equal(pulled.length, 1);
      assert.ok(sameBytes(pulled[0]!.payload, payload));
      assert.equal(pulled[0]!.version, h0 + 1);
      assert.equal(pulled[0]!.deleted, false);
    });

    test("a batch gets consecutive versions in order, with no gaps", async () => {
      const h0 = await a.head();
      const changes = Array.from({ length: 5 }, () => change());
      const r = await a.sync({ cursor: h0, changes, pullLimit: 0 });
      assert.deepEqual(
        r.body.applied.map((x) => x.version),
        [h0 + 1, h0 + 2, h0 + 3, h0 + 4, h0 + 5],
      );
      assert.deepEqual(
        r.body.applied.map((x) => x.uuid),
        changes.map((x) => x.uuid),
      );
      assert.equal(r.body.head, h0 + 5);
    });

    test("an update with the right baseVersion replaces the record; pull shows only the latest", async () => {
      const ch = change();
      const first = await a.sync({ changes: [ch], pullLimit: 0 });
      const v1 = first.body.applied[0]!.version;
      const next = encodeBase64(randomPayload(80));
      const second = await a.sync({ changes: [{ ...ch, baseVersion: v1, payload: next }], pullLimit: 0 });
      assert.equal(second.body.applied.length, 1);
      assert.ok(second.body.applied[0]!.version > v1);
      const all = (await b.pullAll(0)).filter((r) => r.uuid === ch.uuid);
      assert.equal(all.length, 1, "latest state only");
      assert.equal(all[0]!.payload, next);
    });

    test("a stale baseVersion is a conflict that returns the current record and consumes no version", async () => {
      const ch = change();
      const created = await a.sync({ changes: [ch], pullLimit: 0 });
      const v1 = created.body.applied[0]!.version;
      const won = encodeBase64(randomPayload(50));
      const mine = await a.sync({ changes: [{ ...ch, baseVersion: v1, payload: won }], pullLimit: 0 });
      const v2 = mine.body.applied[0]!.version;
      const h = await a.head();

      const late = await b.sync({ changes: [{ ...ch, baseVersion: v1, payload: encodeBase64(randomPayload(50)) }], pullLimit: 0 });
      assert.deepEqual(late.body.applied, []);
      assert.equal(late.body.conflicts.length, 1);
      assert.equal(late.body.conflicts[0]!.current?.version, v2);
      assert.equal(late.body.conflicts[0]!.current?.payload, won);
      assert.equal(await a.head(), h, "a conflict must not consume a version");
    });

    test("baseVersion 0 for a record that exists is a conflict; a nonzero baseVersion for one that does not has current null", async () => {
      const ch = change();
      await a.sync({ changes: [ch], pullLimit: 0 });
      const dup = await b.sync({ changes: [{ ...ch }], pullLimit: 0 });
      assert.equal(dup.body.conflicts.length, 1);
      assert.notEqual(dup.body.conflicts[0]!.current, null);
      const ghost = await b.sync({ changes: [change({ baseVersion: 7 })], pullLimit: 0 });
      assert.equal(ghost.body.conflicts.length, 1);
      assert.equal(ghost.body.conflicts[0]!.current, null);
    });

    test("in a mixed batch only accepted changes consume versions", async () => {
      const taken = change();
      const created = await a.sync({ changes: [taken], pullLimit: 0 });
      const h0 = created.body.head;
      const fresh1 = change();
      const fresh2 = change();
      const r = await b.sync({ cursor: h0, changes: [fresh1, { ...taken, baseVersion: 0 }, fresh2], pullLimit: 0 });
      assert.deepEqual(
        r.body.applied.map((x) => x.version),
        [h0 + 1, h0 + 2],
      );
      assert.equal(r.body.conflicts.length, 1);
      assert.equal(r.body.head, h0 + 2);
    });

    test("a tombstone is pulled as deleted; recreating needs the tombstone's version", async () => {
      const ch = change();
      const v1 = (await a.sync({ changes: [ch], pullLimit: 0 })).body.applied[0]!.version;
      const del = await a.sync({ changes: [{ ...ch, baseVersion: v1, deleted: true, payload: "" }], pullLimit: 0 });
      const tomb = del.body.applied[0]!.version;
      const seen = (await b.pullAll(0)).find((r) => r.uuid === ch.uuid);
      assert.equal(seen?.deleted, true);
      assert.equal(seen?.version, tomb);

      const wrong = await a.sync({ changes: [{ ...ch, baseVersion: 0 }], pullLimit: 0 });
      assert.equal(wrong.body.conflicts.length, 1, "baseVersion 0 against a tombstone is a conflict");
      const undelete = await a.sync({ changes: [{ ...ch, baseVersion: tomb, payload: encodeBase64(randomPayload(30)) }], pullLimit: 0 });
      assert.equal(undelete.body.applied.length, 1);
      const back = (await b.pullAll(0)).find((r) => r.uuid === ch.uuid);
      assert.equal(back?.deleted, false);
    });

    test("a retry with the same batchId returns the same answer and applies nothing twice", async () => {
      const h0 = await a.head();
      const ch = change();
      const batchId = newBatchId();
      const first = await a.sync({ batchId, cursor: h0, changes: [ch], pullLimit: 0 });
      const again = await a.sync({ batchId, cursor: h0, changes: [ch], pullLimit: 0 });
      assert.deepEqual(again.body.applied, first.body.applied);
      assert.deepEqual(again.body.conflicts, first.body.conflicts);
      assert.equal(await a.head(), h0 + 1);

      // Even after someone else has moved the record on, the retry still gets the original answer.
      const moved = await b.sync({
        changes: [{ ...ch, baseVersion: first.body.applied[0]!.version, payload: encodeBase64(randomPayload(20)) }],
        pullLimit: 0,
      });
      assert.equal(moved.body.applied.length, 1);
      const late = await a.sync({ batchId, cursor: h0, changes: [ch], pullLimit: 0 });
      assert.deepEqual(late.body.applied, first.body.applied);
      assert.equal(await a.head(), h0 + 2);
    });
  });

  describe("pull", () => {
    test("returns records after the cursor, in version order, and the cursor reaches the head", async () => {
      const h0 = await a.head();
      const changes = Array.from({ length: 5 }, () => change());
      await a.sync({ cursor: h0, changes, pullLimit: 0 });
      const r = await b.sync({ cursor: h0 });
      assert.deepEqual(
        r.body.changes.map((x) => x.version),
        [h0 + 1, h0 + 2, h0 + 3, h0 + 4, h0 + 5],
      );
      assert.equal(r.body.more, false);
      assert.equal(r.body.cursor, h0 + 5);
      const quiet = await b.sync({ cursor: r.body.cursor });
      assert.deepEqual(quiet.body.changes, []);
      assert.equal(quiet.body.cursor, h0 + 5);
    });

    test("pullLimit 0 is push only: no records, cursor unchanged", async () => {
      const h0 = await a.head();
      const r = await a.sync({ cursor: h0, changes: [change()], pullLimit: 0 });
      assert.deepEqual(r.body.changes, []);
      assert.equal(r.body.cursor, h0);
      assert.equal(r.body.more, false);
    });

    test("pages by record count with no record skipped or repeated", async () => {
      const h0 = await a.head();
      const all: WireChange[] = Array.from({ length: 120 }, () => change({}, 32));
      await a.sync({ cursor: h0, changes: all.slice(0, 60), pullLimit: 0 });
      await a.sync({ cursor: h0, changes: all.slice(60), pullLimit: 0 });
      const seen: number[] = [];
      let cursor = h0;
      let pages = 0;
      for (;;) {
        const r = await b.sync({ cursor, pullLimit: 50 });
        pages += 1;
        assert.ok(r.body.changes.length <= 50);
        seen.push(...r.body.changes.map((x) => x.version));
        assert.ok(r.body.cursor >= cursor);
        cursor = r.body.cursor;
        if (!r.body.more) break;
        assert.ok(pages < 20);
      }
      assert.equal(pages, 3);
      assert.deepEqual(seen, Array.from({ length: 120 }, (_, i) => h0 + 1 + i));
    });

    test("pages by payload bytes: big records never overrun the byte cap, and nothing is lost", async () => {
      const h0 = await a.head();
      const big = Array.from({ length: 6 }, () => change({}, 400_000));
      await a.sync({ cursor: h0, changes: big.slice(0, 3), pullLimit: 0 });
      await a.sync({ cursor: h0, changes: big.slice(3), pullLimit: 0 });
      let cursor = h0;
      const seen: string[] = [];
      let pages = 0;
      for (;;) {
        const r = await b.sync({ cursor, pullLimit: 500 });
        pages += 1;
        const bytes = r.body.changes.reduce((n, x) => n + (decodeBase64(x.payload)?.length ?? 0), 0);
        assert.ok(r.body.changes.length >= 1 || !r.body.more);
        assert.ok(r.body.changes.length === 1 || bytes <= LIMITS.maxPullBytes, "page exceeded the byte cap");
        seen.push(...r.body.changes.map((x) => x.uuid));
        cursor = r.body.cursor;
        if (!r.body.more) break;
        assert.ok(pages < 20);
      }
      assert.deepEqual(seen, big.map((x) => x.uuid));
      assert.ok(pages >= 3, `6 x 400 KB should take at least 3 pages of 1 MiB, took ${pages}`);
    });

    test("a push response also carries the pull, including the device's own writes", async () => {
      const h0 = await a.head();
      const ch = change();
      const r = await a.sync({ cursor: h0, changes: [ch] });
      assert.deepEqual(
        r.body.changes.map((x) => x.uuid),
        [ch.uuid],
      );
      assert.equal(r.body.cursor, h0 + 1);
    });
  });

  describe("isolation", () => {
    test("one user never sees another's records, and their version counters are independent", async () => {
      const mine = change();
      await a.sync({ changes: [mine], pullLimit: 0 });
      const bobHead = await bob.head();
      const theirs = change();
      const r = await bob.sync({ cursor: bobHead, changes: [theirs] });
      assert.equal(r.body.applied[0]!.version, bobHead + 1);
      const bobAll = await bob.pullAll(0);
      assert.ok(!bobAll.some((x) => x.uuid === mine.uuid));
      const aliceAll = await a.pullAll(0);
      assert.ok(!aliceAll.some((x) => x.uuid === theirs.uuid));
      // The same uuid under two users is two records.
      const shared = change();
      assert.equal((await a.sync({ changes: [shared], pullLimit: 0 })).body.applied.length, 1);
      assert.equal((await bob.sync({ changes: [shared], pullLimit: 0 })).body.applied.length, 1);
    });
  });

  describe("validation", () => {
    const reject = async (status: number, over: Record<string, unknown>, label: string) => {
      const h0 = await a.head();
      const r = await a.sync(over);
      assert.equal(r.status, status, `${label}: expected ${status}, got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      assert.equal(await a.head(), h0, `${label}: a rejected push must apply nothing`);
    };

    test("rejects malformed input with 4xx and applies nothing", async () => {
      await reject(400, { changes: [change({ uuid: "not-a-uuid" })] }, "bad uuid");
      await reject(400, { changes: [change({ entity: "Bad Entity" })] }, "bad entity");
      await reject(400, { changes: [change({ payload: "***" })] }, "bad base64");
      await reject(400, { changes: [change({ baseVersion: -1 })] }, "negative baseVersion");
      await reject(400, { changes: [change({ schemaVersion: 0 })] }, "schemaVersion 0");
      await reject(400, { batchId: "x" }, "short batchId");
      await reject(400, { cursor: -5 }, "negative cursor");
      await reject(426, { protocolVersion: 0 }, "protocol too old");
      const dup = change();
      await reject(400, { changes: [change(), dup, { ...dup }] }, "duplicate in one batch (the valid first change must not apply)");
    });

    test("rejects unparseable bodies", async () => {
      assert.equal((await call(a.token, "POST", "/v1/sync", "{nope")).status, 400);
      assert.equal((await call(a.token, "POST", "/v1/sync", "[]")).status, 400);
    });

    test("enforces the size limits", async () => {
      await reject(413, { changes: Array.from({ length: LIMITS.maxBatchRecords + 1 }, () => change({}, 8)) }, "too many records");
      await reject(413, { changes: [change({}, LIMITS.maxRecordBytes + 1)] }, "record too large");
      await reject(
        413,
        { changes: Array.from({ length: 5 }, () => change({}, LIMITS.maxRecordBytes)) },
        "batch bytes",
      );
      const huge = JSON.stringify({ protocolVersion: 1, batchId: newBatchId(), cursor: 0, changes: [], pad: "x".repeat(LIMITS.maxBodyBytes + 1024) });
      assert.equal((await call(a.token, "POST", "/v1/sync", huge)).status, 413);
    });

    test("accepts a record exactly at the size limit", async () => {
      const r = await a.sync({ changes: [change({}, LIMITS.maxRecordBytes)], pullLimit: 0 });
      assert.equal(r.status, 200);
      assert.equal(r.body.applied.length, 1);
    });
  });

  describe("epoch and resync", () => {
    test("every response carries the server's epoch", async () => {
      const r = await a.sync({ pullLimit: 0 });
      assert.equal(r.body.epoch, info.epoch);
    });

    test("a request under a different epoch gets resync and nothing is applied", async () => {
      const h0 = await a.head();
      const r = await a.sync({ epoch: "someOtherEpochId", cursor: h0, changes: [change()] });
      assert.equal(r.status, 200);
      assert.equal(r.body.resync, "epoch");
      assert.deepEqual(r.body.applied, []);
      assert.deepEqual(r.body.changes, []);
      assert.equal(r.body.epoch, info.epoch);
      assert.equal(await a.head(), h0);
    });

    test("a cursor ahead of the server's head gets resync and nothing is applied", async () => {
      const h0 = await a.head();
      const r = await a.sync({ cursor: h0 + 1000, changes: [change()] });
      assert.equal(r.body.resync, "cursor_ahead");
      assert.deepEqual(r.body.applied, []);
      assert.equal(await a.head(), h0);
    });
  });

  describe("concurrency", () => {
    test("concurrent pushes from four devices leave versions gap-free with no duplicates", async () => {
      const h0 = await a.head();
      const devices = [a, b, c, d];
      const ROUNDS = 10;
      const PER_PUSH = 3;
      const applied: number[] = [];
      await Promise.all(
        devices.map(async (dev) => {
          for (let i = 0; i < ROUNDS; i++) {
            const r = await dev.sync({ changes: Array.from({ length: PER_PUSH }, () => change({}, 48)), pullLimit: 0 });
            assert.equal(r.status, 200);
            assert.equal(r.body.conflicts.length, 0);
            // Within one push the versions are consecutive: nobody else interleaved inside the transaction.
            const vs = r.body.applied.map((x) => x.version);
            assert.deepEqual(vs, [vs[0]!, vs[0]! + 1, vs[0]! + 2]);
            applied.push(...vs);
          }
        }),
      );
      applied.sort((x, y) => x - y);
      const total = devices.length * ROUNDS * PER_PUSH;
      assert.deepEqual(applied, Array.from({ length: total }, (_, i) => h0 + 1 + i), "versions must be exactly h0+1..h0+N");
      assert.equal(await a.head(), h0 + total);
    });

    test("racing to create one record: exactly one wins, the rest conflict", async () => {
      const h0 = await a.head();
      const ch = change();
      const results = await Promise.all([a, b, c, d].map((dev) => dev.sync({ changes: [{ ...ch, payload: encodeBase64(randomPayload(40)) }], pullLimit: 0 })));
      assert.equal(results.reduce((n, r) => n + r.body.applied.length, 0), 1);
      assert.equal(results.reduce((n, r) => n + r.body.conflicts.length, 0), 3);
      assert.equal(await a.head(), h0 + 1);
    });

    test("racing to update one record from the same base: exactly one winner per round", async () => {
      const ch = change();
      let version = (await a.sync({ changes: [ch], pullLimit: 0 })).body.applied[0]!.version;
      for (let round = 0; round < 5; round++) {
        const h = await a.head();
        const rs = await Promise.all(
          [a, b, c, d].map((dev) => dev.sync({ changes: [{ ...ch, baseVersion: version, payload: encodeBase64(randomPayload(40)) }], pullLimit: 0 })),
        );
        const winners = rs.filter((r) => r.body.applied.length === 1);
        assert.equal(winners.length, 1, `round ${round}`);
        assert.equal(rs.filter((r) => r.body.conflicts.length === 1).length, 3);
        version = winners[0]!.body.applied[0]!.version;
        assert.equal(version, h + 1);
      }
    });
  });

  describe("hints", () => {
    const sources: HintSource[] = [];
    after(() => sources.forEach((s) => s.close()));

    test("a hint reaches another device of the same user soon after a push, and never another user", async (t) => {
      const seen: { head: number; epoch: string; at: number }[] = [];
      const bobSeen: unknown[] = [];
      const bobSource = await openHints(BASE, info, bob.token, (h) => h && bobSeen.push(h));
      const source = await openHints(BASE, info, b.token, (h) => h && seen.push({ ...h, at: performance.now() }));
      sources.push(bobSource, source);
      await Promise.race([source.ready, new Promise((_, rej) => setTimeout(() => rej(new Error("no initial hint within 15 s")), 15_000))]);
      await bobSource.ready;
      const before = seen.length;
      const bobBefore = bobSeen.length;
      const h0 = await a.head();

      const sent = performance.now();
      const r = await a.sync({ cursor: h0, changes: [change()], pullLimit: 0 });
      const target = r.body.applied[0]!.version;
      const deadline = performance.now() + 10_000;
      while (!seen.slice(before).some((h) => h.head >= target) && performance.now() < deadline) {
        await new Promise((res) => setTimeout(res, 20));
      }
      const hit = seen.slice(before).find((h) => h.head >= target);
      assert.ok(hit, "no hint within 10 s of a push");
      assert.equal(hit.epoch, info.epoch);
      t.diagnostic(`hint arrived ${Math.round(hit.at - sent)} ms after the push was sent (${info.hint.kind})`);

      await new Promise((res) => setTimeout(res, 1000));
      assert.equal(bobSeen.length, bobBefore, "another user must not be hinted");
    });
  });

  describe("admin (needs SYNC_ADMIN_TOKEN)", { skip: adminToken() ? false : "SYNC_ADMIN_TOKEN is not set" }, () => {
    test("reset empties one user and no one else", async () => {
      await bob.sync({ changes: [change()], pullLimit: 0 });
      const aliceHead = await a.head();
      const res = await call(adminToken()!, "POST", "/v1/admin/reset", { user: "ct-bob" });
      assert.equal(res.status, 200);
      assert.equal(await bob.head(), 0);
      assert.deepEqual(await bob.pullAll(0), []);
      assert.equal(await a.head(), aliceHead);
    });

    test("admin routes refuse a device token", async () => {
      assert.equal((await call(a.token, "POST", "/v1/admin/reset", { user: "ct-bob" })).status, 401);
      assert.equal((await call(a.token, "POST", "/v1/admin/rotate-epoch", {})).status, 401);
    });

    test("rotating the epoch changes it, and devices on the old one are told to resync", async () => {
      const before = (await call<InfoResponse>(null, "GET", "/v1/info")).body.epoch;
      const rot = await call<{ epoch: string }>(adminToken()!, "POST", "/v1/admin/rotate-epoch", {});
      assert.equal(rot.status, 200);
      assert.notEqual(rot.body.epoch, before);
      assert.equal((await call<InfoResponse>(null, "GET", "/v1/info")).body.epoch, rot.body.epoch);
      const stale = await a.sync({ epoch: before });
      assert.equal(stale.body.resync, "epoch");
      assert.equal(stale.body.epoch, rot.body.epoch);
      // Data survives a rotation: only devices' trust in their cursors is reset.
      const fresh = await a.sync({ epoch: rot.body.epoch, cursor: 0 });
      assert.equal(fresh.body.resync, undefined);
      assert.ok(fresh.body.changes.length > 0);
    });
  });
});
