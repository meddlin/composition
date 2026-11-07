// The HTTP app shared by the lean and Postgres candidates: auth, routing, the /v1/sync orchestration and
// SSE hints. It knows nothing about SQLite or Postgres; everything durable goes through SyncStorage.
// Plain node:http on purpose: the whole server is a few hundred lines and the spike should stay readable.

import http from "node:http";
import { encodeBase64 } from "../protocol/b64.ts";
import {
  LIMITS,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type ErrorBody,
  type Hint,
  type InfoResponse,
  type ServerKind,
  type StoredRecord,
  type SyncResponse,
  type WireRecord,
} from "../protocol/types.ts";
import { ProtocolError, parseSyncRequest } from "../protocol/validate.ts";
import { HintHub } from "./hub.ts";
import type { SyncStorage } from "./storage.ts";

export interface Identity {
  user: string;
  device: string;
}

export interface AppOptions {
  kind: ServerKind;
  storage: SyncStorage;
  /** token -> identity. Static dev tokens; sign-in is spike S4. */
  tokens: Record<string, Identity>;
  adminToken?: string;
  log?: (line: Record<string, unknown>) => void;
  heartbeatMs?: number;
}

export function parseTokens(json: string | undefined): Record<string, Identity> {
  if (!json) throw new Error("SYNC_DEV_TOKENS is not set (run `pnpm gen-tokens`)");
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) throw new Error("SYNC_DEV_TOKENS must be a JSON object");
  return parsed as Record<string, Identity>;
}

export function toWire(r: StoredRecord): WireRecord {
  return {
    entity: r.entity,
    uuid: r.uuid,
    version: r.version,
    deleted: r.deleted,
    schemaVersion: r.schemaVersion,
    payload: encodeBase64(r.payload),
  };
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string, headers?: Record<string, string>): void {
  const body: ErrorBody = { error: { code, message } };
  send(res, status, body, headers);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > LIMITS.maxBodyBytes) throw new ProtocolError(413, "body_too_large", `body may be at most ${LIMITS.maxBodyBytes} bytes`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface App {
  server: http.Server;
  hub: HintHub;
  /** Stop SSE streams and close the listener. */
  shutdown(): Promise<void>;
}

export async function createApp(opts: AppOptions): Promise<App> {
  const { storage, kind } = opts;
  const hub = new HintHub();
  const log = opts.log ?? (() => {});
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  let epoch = await storage.epoch();
  const streams = new Set<http.ServerResponse>();

  function identify(req: http.IncomingMessage): Identity {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer (.+)$/.exec(header);
    const id = m ? opts.tokens[m[1]!] : undefined;
    if (!id) throw new ProtocolError(401, "unauthorized", "missing or unknown token");
    return id;
  }

  function requireAdmin(req: http.IncomingMessage): void {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!opts.adminToken || !m || m[1] !== opts.adminToken) throw new ProtocolError(401, "unauthorized", "admin token required");
  }

  /** The head for a user, from memory if this process has seen it, else one read that seeds the memory. */
  async function headFor(user: string): Promise<number> {
    const known = hub.knownHead(user);
    if (known !== undefined) return known;
    const head = await storage.head(user);
    hub.publish(user, head, epoch);
    return head;
  }

  function info(): InfoResponse {
    return {
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_PROTOCOL_VERSION,
      draft: true,
      server: kind,
      epoch,
      limits: LIMITS,
      hint: { kind: "sse", path: "/v1/events" },
    };
  }

  function emptyResponse(head: number, resync: SyncResponse["resync"]): SyncResponse {
    return { protocolVersion: PROTOCOL_VERSION, epoch, head, applied: [], conflicts: [], changes: [], cursor: 0, more: false, resync };
  }

  async function handleSync(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const id = identify(req);
    const started = performance.now();
    let json: unknown;
    try {
      json = JSON.parse(await readBody(req));
    } catch (err) {
      if (err instanceof ProtocolError) throw err;
      throw new ProtocolError(400, "invalid_json", "body is not valid JSON");
    }
    const parsed = parseSyncRequest(json);

    let head = await headFor(id.user);
    if (parsed.epoch !== undefined && parsed.epoch !== epoch) {
      log({ ev: "resync", user: id.user, device: id.device, reason: "epoch" });
      return send(res, 200, emptyResponse(head, "epoch"));
    }
    if (parsed.cursor > head) {
      log({ ev: "resync", user: id.user, device: id.device, reason: "cursor_ahead", cursor: parsed.cursor, head });
      return send(res, 200, emptyResponse(head, "cursor_ahead"));
    }

    let applied: SyncResponse["applied"] = [];
    let conflicts: SyncResponse["conflicts"] = [];
    let replayed = false;
    if (parsed.changes.length > 0) {
      const result = await storage.applyBatch(id.user, parsed.batchId, parsed.changes);
      applied = result.applied;
      conflicts = result.conflicts;
      replayed = result.replayed;
      if (!replayed && applied.length > 0) {
        hub.publish(id.user, result.head, epoch);
      }
      head = hub.knownHead(id.user) ?? result.head;
    }

    let changes: WireRecord[] = [];
    let cursor = parsed.cursor;
    let more = false;
    if (parsed.pullLimit > 0) {
      const page = await storage.pull(id.user, parsed.cursor, parsed.pullLimit, LIMITS.maxPullBytes);
      changes = page.records.map(toWire);
      const last = page.records.at(-1);
      more = page.more;
      cursor = more ? last!.version : Math.max(parsed.cursor, page.head, last?.version ?? 0);
    }

    const body: SyncResponse = { protocolVersion: PROTOCOL_VERSION, epoch, head, applied, conflicts, changes, cursor, more };
    log({
      ev: "sync",
      user: id.user,
      device: id.device,
      pushed: parsed.changes.length,
      applied: applied.length,
      conflicts: conflicts.length,
      replayed,
      pulled: changes.length,
      ms: Math.round(performance.now() - started),
    });
    send(res, 200, body);
  }

  async function handleEvents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const id = identify(req);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const writeHint = (hint: Hint) => res.write(`event: hint\ndata: ${JSON.stringify(hint)}\n\n`);
    streams.add(res);
    const unsubscribe = hub.subscribe(id.user, writeHint);
    const beat = setInterval(() => res.write(": hb\n\n"), heartbeatMs);
    const cleanup = () => {
      clearInterval(beat);
      unsubscribe();
      streams.delete(res);
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    log({ ev: "events-open", user: id.user, device: id.device });
    // Tell the device where the head is now, so a hint missed while it was disconnected costs nothing.
    writeHint({ head: await headFor(id.user), epoch });
  }

  async function handleAdmin(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<void> {
    requireAdmin(req);
    if (path === "/v1/admin/reset") {
      const body = JSON.parse(await readBody(req)) as { user?: unknown };
      if (typeof body.user !== "string" || !body.user) throw new ProtocolError(400, "invalid_request", "user is required");
      await storage.resetUser(body.user);
      hub.forget(body.user);
      return send(res, 200, { ok: true });
    }
    if (path === "/v1/admin/rotate-epoch") {
      epoch = await storage.rotateEpoch();
      // Remembered heads may belong to the old history. Re-read each connected user's head and tell them.
      const users = hub.connectedUsers();
      hub.forget();
      for (const user of users) hub.emit(user, { head: await headFor(user), epoch });
      log({ ev: "epoch-rotated" });
      return send(res, 200, { epoch });
    }
    throw new ProtocolError(404, "not_found", "no such admin route");
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const route = `${req.method} ${url.pathname}`;
    const run = async () => {
      if (route === "GET /healthz") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      if (route === "GET /v1/info") return send(res, 200, info());
      if (route === "POST /v1/sync") return handleSync(req, res);
      if (route === "GET /v1/events") return handleEvents(req, res);
      if (route.startsWith("POST /v1/admin/")) return handleAdmin(req, res, url.pathname);
      throw new ProtocolError(404, "not_found", "no such route");
    };
    run().catch((err: unknown) => {
      if (res.headersSent) return void res.end();
      if (err instanceof ProtocolError) return sendError(res, err.status, err.code, err.message);
      // Anything else is a storage or code failure. Say "retry" and keep the detail (never payloads) in the log.
      log({ ev: "error", route, message: err instanceof Error ? err.message : String(err) });
      sendError(res, 503, "storage_unavailable", "the server could not complete the request; retry", { "retry-after": "1" });
    });
  });

  return {
    server,
    hub,
    async shutdown() {
      for (const res of streams) res.end();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
