import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, startFakeOllama, type FakeOllama } from "@/lib/composition/assistant/fakeOllama.test.helper";
import type { ChatEvent } from "@/lib/composition/assistant/types";
import { ASSISTANT_HEADER } from "@/lib/composition/uploadGuard";

let home: string;
let server: FakeOllama | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-route-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const body = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };
const showLocal = { body: { capabilities: ["completion"], model_info: {} } };

function post(payload: unknown, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  return new Request("http://localhost:3000/api/assistant/chat", {
    method: "POST",
    headers: { [ASSISTANT_HEADER]: "1", host: "localhost:3000", "content-type": "application/json", ...init.headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    signal: init.signal,
  });
}

async function route(serverUrl?: string) {
  const { saveAssistantSettings } = await import("@/lib/composition/assistantService");
  if (serverUrl) await saveAssistantSettings({ serverUrl, contextTokens: 8192 });
  return (await import("./route")).POST;
}

async function eventsOf(response: Response): Promise<ChatEvent[]> {
  return (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as ChatEvent);
}

describe("POST /api/assistant/chat", () => {
  it("refuses a request that is not from the app, before reading it", async () => {
    const POST = await route();
    const noHeader = await POST(post(body, { headers: { [ASSISTANT_HEADER]: "0" } }));
    const otherSite = await POST(post(body, { headers: { origin: "https://evil.example" } }));
    expect(noHeader.status).toBe(403);
    expect(otherSite.status).toBe(403);
  });

  it.each([
    ["not JSON", "{nope"],
    ["no messages", { ...body, messages: [] }],
    ["a cloud model", { ...body, model: "gpt-oss:20b:cloud" }],
    ["a bad context size", { ...body, numCtx: 5 }],
  ])("answers 400 with a reason for %s, and never contacts the server", async (_name, payload) => {
    server = await startFakeOllama({ "POST /api/chat": { body: fixture("chat-plain.ndjson") } });
    const POST = await route(server.url);

    const response = await POST(post(payload));

    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
    expect(server.requests).toHaveLength(0);
  });

  it("answers 413 for a body far too large to be a note", async () => {
    const POST = await route();
    const response = await POST(post(body, { headers: { "content-length": String(50_000_000) } }));
    expect(response.status).toBe(413);
  });

  it("streams the reply as one JSON event per line, uncached", async () => {
    server = await startFakeOllama({ "POST /api/show": showLocal, "POST /api/chat": { body: fixture("chat-plain.ndjson"), chunkBytes: 40 } });
    const POST = await route(server.url);

    const response = await POST(post(body));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    const events = await eventsOf(response);
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("Hello! How can I assist you today?");
    expect(events.slice(-2)).toEqual([{ type: "usage", promptTokens: 22, outputTokens: 10 }, { type: "done" }]);
  });

  it("hands over each piece as it arrives, not when the answer is finished", async () => {
    const firstLines = fixture("chat-plain.ndjson").split("\n").slice(0, 3).join("\n") + "\n";
    server = await startFakeOllama({ "POST /api/show": showLocal, "POST /api/chat": { body: firstLines, holdOpen: true } });
    const POST = await route(server.url);
    const controller = new AbortController();

    const response = await POST(post(body, { signal: controller.signal }));
    const reader = response.body!.getReader();
    const first = await reader.read(); // would hang until the test times out if the route buffered the whole answer

    expect(new TextDecoder().decode(first.value)).toContain('"type":"delta"');
    await reader.cancel();
    // Cancelling the response closes the connection to Ollama.
    await server.clientAborted;
  });

  it("reports a server that is not running as an error event, not an error status", async () => {
    const { closedAddress } = await import("@/lib/composition/assistant/fakeOllama.test.helper");
    const POST = await route(await closedAddress());

    const response = await POST(post(body));

    expect(response.status).toBe(200);
    expect(await eventsOf(response)).toEqual([{ type: "error", kind: "unreachable", message: expect.any(String) }]);
  });
});
