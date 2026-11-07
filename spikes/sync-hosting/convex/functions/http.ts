// The same HTTP surface as the Node core (/v1/info, /v1/sync, /v1/admin/*), as Convex HTTP actions, so the
// contract suite and the scripted client run unchanged. Each action validates with the shared parser, then
// calls the mutation and query in sync.ts. There is no /v1/events: a Convex HTTP action cannot hold a
// stream open without paying for a function call per tick, so /v1/info advertises a live query instead.

import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { encodeBase64 } from "../../protocol/b64.ts";
import {
  LIMITS,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type InfoResponse,
  type SyncResponse,
  type WireRecord,
} from "../../protocol/types.ts";
import { ProtocolError, parseSyncRequest } from "../../protocol/validate.ts";
import { identify, isAdmin } from "./auth.ts";

const bearer = (request: Request): string | undefined => /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function fail(err: unknown): Response {
  if (err instanceof ProtocolError) return json(err.status, { error: { code: err.code, message: err.message } });
  // Convex surfaces its own errors (including exhausted optimistic-concurrency retries) as exceptions.
  console.log("error", err instanceof Error ? err.message.split("\n")[0] : String(err));
  return json(503, { error: { code: "storage_unavailable", message: "the server could not complete the request; retry" } }, { "retry-after": "1" });
}

async function epochOf(ctx: ActionCtx): Promise<string> {
  return (await ctx.runQuery(internal.sync.epoch, {})) ?? (await ctx.runMutation(internal.sync.init, {}));
}

const http = httpRouter();

http.route({
  path: "/v1/info",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const body: InfoResponse = {
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_PROTOCOL_VERSION,
      draft: true,
      server: "convex",
      epoch: await epochOf(ctx),
      limits: LIMITS,
      hint: { kind: "convex-query", deploymentUrl: process.env.CONVEX_CLOUD_URL ?? "", query: "sync:head" },
    };
    return json(200, body);
  }),
});

http.route({
  path: "/v1/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const id = identify(bearer(request));
      if (!id) throw new ProtocolError(401, "unauthorized", "missing or unknown token");
      const text = await request.text();
      if (text.length > LIMITS.maxBodyBytes) throw new ProtocolError(413, "body_too_large", `body may be at most ${LIMITS.maxBodyBytes} bytes`);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        throw new ProtocolError(400, "invalid_json", "body is not valid JSON");
      }
      const req = parseSyncRequest(parsedJson);

      let applied: SyncResponse["applied"] = [];
      let conflicts: SyncResponse["conflicts"] = [];
      let head = 0;
      let epoch = "";
      if (req.changes.length > 0) {
        const r = await ctx.runMutation(internal.sync.push, {
          userId: id.user,
          batchId: req.batchId,
          cursor: req.cursor,
          epoch: req.epoch,
          changes: req.changes.map((c) => ({ ...c, payload: c.payload.buffer.slice(c.payload.byteOffset, c.payload.byteOffset + c.payload.byteLength) as ArrayBuffer })),
        });
        epoch = r.epoch;
        head = r.head;
        if ("resync" in r && r.resync) {
          return json(200, { protocolVersion: PROTOCOL_VERSION, epoch, head, applied: [], conflicts: [], changes: [], cursor: 0, more: false, resync: r.resync } satisfies SyncResponse);
        }
        applied = "applied" in r ? r.applied : [];
        conflicts = "conflicts" in r ? r.conflicts : [];
      }

      let changes: WireRecord[] = [];
      let cursor = req.cursor;
      let more = false;
      if (req.pullLimit > 0 || req.changes.length === 0) {
        // A request with no changes always needs the query: it carries the epoch and cursor checks too.
        const p = await ctx.runQuery(internal.sync.pull, {
          userId: id.user,
          cursor: req.cursor,
          epoch: req.epoch,
          limit: Math.max(req.pullLimit, 0),
          maxBytes: LIMITS.maxPullBytes,
        });
        if (p.epoch === null) {
          await ctx.runMutation(internal.sync.init, {});
          return json(503, { error: { code: "storage_unavailable", message: "initializing; retry" } }, { "retry-after": "1" });
        }
        epoch = p.epoch;
        if ("resync" in p && p.resync) {
          return json(200, { protocolVersion: PROTOCOL_VERSION, epoch, head: p.head, applied: [], conflicts: [], changes: [], cursor: 0, more: false, resync: p.resync } satisfies SyncResponse);
        }
        head = Math.max(head, p.head);
        if (req.pullLimit > 0) {
          changes = p.records.map((r) => ({
            entity: r.entity,
            uuid: r.uuid,
            version: r.version,
            deleted: r.deleted,
            schemaVersion: r.schemaVersion,
            payload: encodeBase64(new Uint8Array(r.payload)),
          }));
          const last = p.records.at(-1);
          more = p.more;
          cursor = more ? last!.version : Math.max(req.cursor, p.head, last?.version ?? 0);
        }
      }
      return json(200, { protocolVersion: PROTOCOL_VERSION, epoch, head, applied, conflicts, changes, cursor, more } satisfies SyncResponse);
    } catch (err) {
      return fail(err);
    }
  }),
});

http.route({
  path: "/v1/admin/reset",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      if (!isAdmin(bearer(request))) throw new ProtocolError(401, "unauthorized", "admin token required");
      const body = (await request.json()) as { user?: unknown };
      if (typeof body.user !== "string" || !body.user) throw new ProtocolError(400, "invalid_request", "user is required");
      for (let i = 0; i < 1000; i++) {
        const { done } = await ctx.runMutation(internal.sync.resetUserPage, { userId: body.user });
        if (done) return json(200, { ok: true });
      }
      throw new Error("reset did not finish");
    } catch (err) {
      return fail(err);
    }
  }),
});

http.route({
  path: "/v1/admin/rotate-epoch",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      if (!isAdmin(bearer(request))) throw new ProtocolError(401, "unauthorized", "admin token required");
      return json(200, { epoch: await ctx.runMutation(internal.sync.rotateEpoch, {}) });
    } catch (err) {
      return fail(err);
    }
  }),
});

export default http;
