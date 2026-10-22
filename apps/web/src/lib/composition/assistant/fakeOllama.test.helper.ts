/**
 * A stand-in Ollama for the tests: a real HTTP server on a free local port that answers each route with a canned
 * reply, usually a recorded fixture, and remembers what it was sent. Tests talk to it through the module under
 * test and a real `fetch`, so nothing inside the module is mocked.
 *
 * Named `*.test.helper.ts` so that Vitest does not run it as a test file (it only collects `*.test.ts`) while
 * the repo's Opengrep scan still treats it as test code (it skips `*.test.*`).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type FakeReply = {
  status?: number;
  /** Defaults to JSON for an object body and NDJSON for a string. */
  contentType?: string;
  body: string | object;
  /** Send the body in pieces of this many bytes, a tick apart, so that lines and characters get cut. */
  chunkBytes?: number;
  /** Keep the response open after the body, as a server that is still generating would. */
  holdOpen?: boolean;
};

export type RecordedRequest = {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  /** The body parsed as JSON, or undefined when there was none or it was not JSON. */
  json: unknown;
};

type Route = FakeReply | ((request: RecordedRequest) => FakeReply);

export type FakeOllama = {
  /** `http://127.0.0.1:<port>` */
  url: string;
  requests: RecordedRequest[];
  /** Resolves when a client has dropped a response before the server finished it. */
  clientAborted: Promise<void>;
  close(): Promise<void>;
};

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

export const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf-8");

export const fixtureJson = <T = unknown>(name: string): T => JSON.parse(fixture(name)) as T;

/** A recorded error reply from `errors.json`, in the shape the server replays. */
export function recordedError(key: string): FakeReply {
  const entry = fixtureJson<{ responses: Record<string, { status: number; contentType: string; body: unknown }> }>(
    "errors.json",
  ).responses[key];
  return { status: entry.status, contentType: entry.contentType, body: entry.body as object };
}

/** Routes are keyed like `"POST /api/chat"`. Anything else is a 404 with a plain-text body. */
export async function startFakeOllama(routes: Record<string, Route>): Promise<FakeOllama> {
  const requests: RecordedRequest[] = [];
  let notifyAborted: () => void = () => {};
  const clientAborted = new Promise<void>((resolve) => (notifyAborted = resolve));

  const server = http.createServer((req, res) => {
    const received: Buffer[] = [];
    req.on("data", (piece: Buffer) => received.push(piece));
    req.on("end", () => {
      const text = Buffer.concat(received).toString("utf-8");
      let json: unknown;
      try {
        json = text === "" ? undefined : JSON.parse(text);
      } catch {
        json = undefined;
      }
      const recorded: RecordedRequest = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, json };
      requests.push(recorded);

      const route = routes[`${recorded.method} ${recorded.path}`];
      if (route === undefined) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      void reply(res, typeof route === "function" ? route(recorded) : route);
    });
    res.on("close", () => {
      if (!res.writableEnded) notifyAborted();
    });
  });

  async function reply(res: http.ServerResponse, spec: FakeReply): Promise<void> {
    const isObject = typeof spec.body === "object";
    const contentType = spec.contentType ?? (isObject ? "application/json" : "application/x-ndjson");
    const bytes = Buffer.from(isObject ? JSON.stringify(spec.body) : (spec.body as string), "utf-8");
    res.writeHead(spec.status ?? 200, { "content-type": contentType });
    const size = spec.chunkBytes ?? (bytes.length || 1);
    for (let at = 0; at < bytes.length; at += size) {
      if (res.destroyed) return;
      res.write(bytes.subarray(at, at + size));
      if (spec.chunkBytes !== undefined) await new Promise((resolve) => setTimeout(resolve, 1));
    }
    if (!spec.holdOpen) res.end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    clientAborted,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** An address on this machine where nothing is listening (a port that was just free), for "not running". */
export async function closedAddress(): Promise<string> {
  const server = await startFakeOllama({});
  const { url } = server;
  await server.close();
  return url;
}
