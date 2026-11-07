// The sync operations as Convex functions: a second implementation of the same contract the Node core
// implements over SQLite and Postgres. Version assignment happens inside one mutation. Convex documents its
// transactions as serializable with optimistic concurrency control: two pushes from one user both read and
// write that user's `userSeq` row, so one commits and the other is re-run automatically (see FINDINGS.md).

import { v } from "convex/values";
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { encodeBase64 } from "../../protocol/b64.ts";
import type { Applied, Conflict, PushResult } from "../../protocol/types.ts";
import { identify } from "./auth.ts";

const BATCH_RETENTION_MS = 24 * 60 * 60 * 1000;

async function readEpoch(ctx: QueryCtx): Promise<string | null> {
  const row = await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", "epoch")).unique();
  return row?.value ?? null;
}

async function readHead(ctx: QueryCtx, userId: string): Promise<number> {
  const seq = await ctx.db.query("userSeq").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  return seq?.head ?? 0;
}

function newEpoch(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureEpoch(ctx: MutationCtx): Promise<string> {
  const existing = await readEpoch(ctx);
  if (existing) return existing;
  const epoch = newEpoch();
  await ctx.db.insert("meta", { key: "epoch", value: epoch });
  return epoch;
}

/** The change hint: a live query on the user's head. Clients subscribe over the Convex WebSocket. */
export const head = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const id = identify(token);
    if (!id) throw new Error("unauthorized");
    return { head: await readHead(ctx, id.user), epoch: (await readEpoch(ctx)) ?? "" };
  },
});

export const epoch = internalQuery({
  args: {},
  handler: async (ctx) => readEpoch(ctx),
});

export const init = internalMutation({
  args: {},
  handler: async (ctx) => ensureEpoch(ctx),
});

export const rotateEpoch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const next = newEpoch();
    const row = await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", "epoch")).unique();
    if (row) await ctx.db.patch(row._id, { value: next });
    else await ctx.db.insert("meta", { key: "epoch", value: next });
    return next;
  },
});

const changeValidator = v.object({
  entity: v.string(),
  uuid: v.string(),
  baseVersion: v.number(),
  deleted: v.boolean(),
  schemaVersion: v.number(),
  payload: v.bytes(),
});

/** Push: check each baseVersion, hand out consecutive versions, store the result under batchId. */
export const push = internalMutation({
  args: {
    userId: v.string(),
    batchId: v.string(),
    cursor: v.number(),
    epoch: v.optional(v.string()),
    changes: v.array(changeValidator),
  },
  handler: async (ctx, a) => {
    const serverEpoch = await ensureEpoch(ctx);
    const seq = await ctx.db.query("userSeq").withIndex("by_user", (q) => q.eq("userId", a.userId)).unique();
    let head = seq?.head ?? 0;
    if (a.epoch !== undefined && a.epoch !== serverEpoch) return { epoch: serverEpoch, head, resync: "epoch" as const };
    if (a.cursor > head) return { epoch: serverEpoch, head, resync: "cursor_ahead" as const };

    const prior = await ctx.db
      .query("batches")
      .withIndex("by_user_batch", (q) => q.eq("userId", a.userId).eq("batchId", a.batchId))
      .unique();
    if (prior) return { epoch: serverEpoch, ...(JSON.parse(prior.response) as PushResult), replayed: true };

    const applied: Applied[] = [];
    const conflicts: Conflict[] = [];
    for (const change of a.changes) {
      const current = await ctx.db
        .query("records")
        .withIndex("by_user_record", (q) => q.eq("userId", a.userId).eq("entity", change.entity).eq("uuid", change.uuid))
        .unique();
      if (change.baseVersion !== (current?.version ?? 0)) {
        conflicts.push({
          entity: change.entity,
          uuid: change.uuid,
          current: current
            ? {
                entity: current.entity,
                uuid: current.uuid,
                version: current.version,
                deleted: current.deleted,
                schemaVersion: current.schemaVersion,
                payload: encodeBase64(new Uint8Array(current.payload)),
              }
            : null,
        });
        continue;
      }
      head += 1;
      const doc = {
        userId: a.userId,
        entity: change.entity,
        uuid: change.uuid,
        version: head,
        deleted: change.deleted,
        schemaVersion: change.schemaVersion,
        payload: change.payload,
      };
      if (current) await ctx.db.replace(current._id, doc);
      else await ctx.db.insert("records", doc);
      applied.push({ entity: change.entity, uuid: change.uuid, version: head });
    }

    if (applied.length > 0) {
      if (seq) await ctx.db.patch(seq._id, { head });
      else await ctx.db.insert("userSeq", { userId: a.userId, head });
    }
    const result: PushResult = { applied, conflicts, head };
    await ctx.db.insert("batches", { userId: a.userId, batchId: a.batchId, response: JSON.stringify(result), createdAt: Date.now() });
    return { epoch: serverEpoch, ...result, replayed: false };
  },
});

/** Pull: records after the cursor, with the epoch and cursor checks, in one consistent snapshot. */
export const pull = internalQuery({
  args: {
    userId: v.string(),
    cursor: v.number(),
    epoch: v.optional(v.string()),
    limit: v.number(),
    maxBytes: v.number(),
  },
  handler: async (ctx, a) => {
    const serverEpoch = await readEpoch(ctx);
    const head = await readHead(ctx, a.userId);
    if (serverEpoch === null) return { epoch: null, head, records: [], more: false };
    if (a.epoch !== undefined && a.epoch !== serverEpoch) return { epoch: serverEpoch, head, resync: "epoch" as const, records: [], more: false };
    if (a.cursor > head) return { epoch: serverEpoch, head, resync: "cursor_ahead" as const, records: [], more: false };

    const rows = ctx.db
      .query("records")
      .withIndex("by_user_version", (q) => q.eq("userId", a.userId).gt("version", a.cursor));
    const records: { entity: string; uuid: string; version: number; deleted: boolean; schemaVersion: number; payload: ArrayBuffer }[] = [];
    let bytes = 0;
    let more = false;
    for await (const r of rows) {
      if (records.length >= a.limit || (records.length > 0 && bytes + r.payload.byteLength > a.maxBytes)) {
        more = true;
        break;
      }
      records.push({ entity: r.entity, uuid: r.uuid, version: r.version, deleted: r.deleted, schemaVersion: r.schemaVersion, payload: r.payload });
      bytes += r.payload.byteLength;
    }
    return { epoch: serverEpoch, head, records, more };
  },
});

/** Dev only: delete up to a page of one user's data; the caller loops until `done`. */
export const resetUserPage = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const page = await ctx.db.query("records").withIndex("by_user_version", (q) => q.eq("userId", userId)).take(100);
    for (const r of page) await ctx.db.delete(r._id);
    if (page.length === 100) return { done: false };
    const seq = await ctx.db.query("userSeq").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (seq) await ctx.db.delete(seq._id);
    const batches = await ctx.db.query("batches").withIndex("by_user_batch", (q) => q.eq("userId", userId)).take(500);
    for (const b of batches) await ctx.db.delete(b._id);
    return { done: batches.length < 500 };
  },
});

/** Retry records older than a day. Run from a cron or by hand; the spike does not schedule it. */
export const purgeBatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("batches").withIndex("by_created", (q) => q.lt("createdAt", Date.now() - BATCH_RETENTION_MS)).take(500);
    for (const b of old) await ctx.db.delete(b._id);
    return old.length;
  },
});
