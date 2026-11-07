import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The same four tables as the SQL candidates. `records` holds the latest state only; `userSeq` is the
// per-user counter every push reads and writes, which is what makes Convex's optimistic concurrency
// control serialize one user's pushes.
export default defineSchema({
  meta: defineTable({ key: v.string(), value: v.string() }).index("by_key", ["key"]),
  userSeq: defineTable({ userId: v.string(), head: v.number() }).index("by_user", ["userId"]),
  records: defineTable({
    userId: v.string(),
    entity: v.string(),
    uuid: v.string(),
    version: v.number(),
    deleted: v.boolean(),
    schemaVersion: v.number(),
    payload: v.bytes(),
  })
    .index("by_user_record", ["userId", "entity", "uuid"])
    .index("by_user_version", ["userId", "version"]),
  batches: defineTable({
    userId: v.string(),
    batchId: v.string(),
    response: v.string(),
    createdAt: v.number(),
  })
    .index("by_user_batch", ["userId", "batchId"])
    .index("by_created", ["createdAt"]),
});
