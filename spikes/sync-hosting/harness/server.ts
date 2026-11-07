// A tiny two-device harness: edit a note on device A, watch device B, with a timing readout and a switch for
// which candidate both talk to. Local page on http://127.0.0.1:8799.
//
// It is NOT the desktop app: the app's server-address setting and the real sync engine do not exist yet. The two
// "devices" are the simulated clients from protocol/client, the note text is plain UTF-8 bytes (no encryption,
// that is spike S5) and they sign in with static dev tokens (no Clerk, that is spike S4).

import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Device } from "../protocol/client/device.ts";
import { CANDIDATES, resolveBaseUrl, tokenFor, type CandidateName } from "../protocol/client/env.ts";
import { openHints, pollHints, type HintSource } from "../protocol/client/hints.ts";
import { HttpTransport, TransportError, type Transport, type TransportStats } from "../protocol/client/transport.ts";
import type { InfoResponse, SyncRequest, SyncResponse } from "../protocol/types.ts";

const PORT = Number(process.env.HARNESS_PORT ?? 8799);
const USER = "harness";
const MAIN = "00000000000000000000000000000001"; // the one note both devices edit
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "page.html"), "utf8");
const enc = new TextEncoder();
const dec = new TextDecoder();

/** A transport that can be switched off, to edit "offline" and watch the outbox flush. */
class SwitchTransport implements Transport {
  offline = false;
  private readonly inner: Transport;
  constructor(inner: Transport) {
    this.inner = inner;
  }
  get stats(): TransportStats {
    return this.inner.stats;
  }
  info(): Promise<InfoResponse> {
    return this.inner.info();
  }
  async sync(req: SyncRequest): Promise<SyncResponse> {
    if (this.offline) throw new TransportError("offline", true);
    return this.inner.sync(req);
  }
}

interface Side {
  device: Device;
  net: SwitchTransport;
  hints: HintSource | undefined;
}

let sides: Record<"a" | "b", Side> | null = null;
let candidate: CandidateName = "lean";
let debounceMs = 2000;
let hintMode: "native" | "poll" = "native";
let pending: { from: "a" | "b"; t0: number; text: string; ackMs?: number }[] = [];
const timings: { from: string; to: string; totalMs: number; ackMs: number | null; debounceMs: number; at: string }[] = [];
const streams = new Set<http.ServerResponse>();

const emit = (event: string, data: unknown) => {
  for (const res of streams) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

function snapshot(name: "a" | "b") {
  const s = sides![name];
  const rec = s.device.get("note", MAIN);
  const copies = [...s.device.records.values()].filter((r) => r.uuid !== MAIN && !r.deleted).map((r) => ({ uuid: r.uuid, text: dec.decode(r.payload) }));
  return {
    device: name,
    text: rec ? dec.decode(rec.payload) : "",
    version: rec?.version ?? 0,
    dirty: s.device.dirtyCount() > 0,
    offline: s.net.offline,
    cursor: s.device.cursor,
    epoch: s.device.epoch ?? null,
    conflicts: s.device.stats.conflicts,
    copies,
    retries: s.device.stats.retries,
  };
}

async function connect(next: CandidateName): Promise<void> {
  emit("status", { kind: "info", text: `Connecting to ${next}…` });
  const { url } = resolveBaseUrl(next);
  const old = sides;
  try {
    const info = (await (await fetch(url + "/v1/info", { signal: AbortSignal.timeout(15_000) })).json()) as InfoResponse;
    const make = async (name: "a" | "b"): Promise<Side> => {
      const net = new SwitchTransport(new HttpTransport(url, tokenFor(USER, name)));
      const device = new Device({
        name,
        transport: net,
        pushDebounceMs: debounceMs,
        onAck: (e) => {
          const p = pending.find((x) => x.from === name && x.ackMs === undefined);
          if (p) p.ackMs = e.at - p.t0;
          emit("state", snapshot(name));
        },
        onRemote: (e) => {
          if (!e.key.endsWith(MAIN)) return;
          const text = dec.decode(e.payload);
          const idx = pending.findIndex((x) => x.from !== name && x.text === text);
          if (idx >= 0) {
            const p = pending.splice(idx, 1)[0]!;
            const t = { from: p.from.toUpperCase(), to: name.toUpperCase(), totalMs: Math.round(e.at - p.t0), ackMs: p.ackMs === undefined ? null : Math.round(p.ackMs), debounceMs, at: new Date().toLocaleTimeString() };
            timings.unshift(t);
            timings.length = Math.min(timings.length, 50);
            emit("timing", { latest: t, all: timings });
          }
          emit("state", snapshot(name));
        },
      });
      const source = hintMode === "poll" ? pollHints(5000, (h) => device.onHint(h)) : await openHints(url, info, tokenFor(USER, name), (h) => device.onHint(h));
      device.attachHints(source);
      return { device, net, hints: source };
    };
    const fresh = { a: await make("a"), b: await make("b") };
    // Swap first so the new devices' callbacks read their own state, and put the old pair back if the first sync fails.
    sides = fresh;
    try {
      await Promise.all([fresh.a.device.syncNow(), fresh.b.device.syncNow()]);
    } catch (err) {
      fresh.a.device.stop();
      fresh.b.device.stop();
      sides = old;
      throw err;
    }
    if (old) for (const side of Object.values(old)) side.device.stop();
    candidate = next;
    pending = [];
    emit("state", snapshot("a"));
    emit("state", snapshot("b"));
    emit("status", { kind: "ok", text: `Connected to ${next} (${url}).` });
  } catch (err) {
    const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    emit("status", { kind: "error", text: `Could not connect to ${next} at ${url}: ${reason}. ${old ? "Still on the previous candidate." : "Start that candidate first (see the README)."}` });
    throw err;
  }
}

async function candidates() {
  return Promise.all(
    CANDIDATES.map(async (name) => {
      const { url } = resolveBaseUrl(name);
      try {
        const r = await fetch(url + "/v1/info", { signal: AbortSignal.timeout(4000) });
        const info = (await r.json()) as InfoResponse;
        return { name, url, ok: r.ok, hint: info.hint.kind, where: /127\.0\.0\.1|localhost/.test(url) ? "local" : "deployed" };
      } catch {
        return { name, url, ok: false, hint: null, where: /127\.0\.0\.1|localhost/.test(url) ? "local" : "deployed" };
      }
    }),
  );
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readJson = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(page);
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      streams.add(res);
      req.on("close", () => streams.delete(res));
      res.write(`event: config\ndata: ${JSON.stringify({ candidate, debounceMs, hintMode, candidates: await candidates() })}\n\n`);
      if (sides) {
        res.write(`event: state\ndata: ${JSON.stringify(snapshot("a"))}\n\n`);
        res.write(`event: state\ndata: ${JSON.stringify(snapshot("b"))}\n\n`);
        res.write(`event: timing\ndata: ${JSON.stringify({ latest: null, all: timings })}\n\n`);
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/connect") {
      const body = await readJson(req);
      if (typeof body.debounceMs === "number") debounceMs = body.debounceMs;
      if (body.hintMode === "poll" || body.hintMode === "native") hintMode = body.hintMode;
      await connect(CANDIDATES.includes(body.candidate as CandidateName) ? (body.candidate as CandidateName) : candidate);
      emit("config", { candidate, debounceMs, hintMode, candidates: await candidates() });
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/edit") {
      if (!sides) return json(res, 409, { error: "not connected" });
      const body = await readJson(req);
      const name = body.device === "b" ? "b" : "a";
      const text = String(body.text ?? "");
      pending = pending.filter((p) => !(p.from === name));
      pending.push({ from: name, t0: performance.now(), text });
      sides[name].device.edit("note", MAIN, enc.encode(text));
      emit("state", snapshot(name));
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/offline") {
      if (!sides) return json(res, 409, { error: "not connected" });
      const body = await readJson(req);
      const name = body.device === "b" ? "b" : "a";
      sides[name].net.offline = body.offline === true;
      if (!sides[name].net.offline) sides[name].device.kick(true);
      emit("state", snapshot(name));
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

setInterval(() => {
  if (streams.size > 0) void candidates().then((list) => emit("candidates", { candidate, list }));
}, 5000).unref();

setInterval(() => {
  if (sides) {
    emit("state", snapshot("a"));
    emit("state", snapshot("b"));
  }
}, 1000).unref();

server.listen(PORT, "127.0.0.1", () => {
  console.log(`harness on http://127.0.0.1:${PORT}  (two simulated devices; not the desktop app)`);
  const first = (process.env.CANDIDATE as CandidateName | undefined) ?? "lean";
  connect(CANDIDATES.includes(first) ? first : "lean").catch((e) => console.log(`not connected yet: ${e instanceof Error ? e.message : e}`));
});
