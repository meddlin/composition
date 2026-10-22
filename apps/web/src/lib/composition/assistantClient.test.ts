import { afterEach, describe, expect, it } from "vitest";
import { closedAddress, startFakeOllama, type FakeOllama } from "./assistant/fakeOllama.test.helper";
import type { ChatEvent, ChatRequest } from "./assistant/types";
import { streamChat } from "./assistantClient";
import { ASSISTANT_HEADER } from "./uploadGuard";

// The fake server stands in for the app's own route (`/api/assistant/chat`), which has its own tests.
let server: FakeOllama | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const request: ChatRequest = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };
const ENDPOINT = "/api/assistant/chat";
const lines = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

async function collect(endpoint: string, signal?: AbortSignal): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of streamChat(request, signal, endpoint)) events.push(event);
  return events;
}

describe("streamChat (web)", () => {
  it("posts the request with the app's header and yields the events it is sent", async () => {
    const sent: ChatEvent[] = [{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }, { type: "usage", promptTokens: 3, outputTokens: 2 }, { type: "done" }];
    server = await startFakeOllama({ [`POST ${ENDPOINT}`]: { body: lines(...sent), chunkBytes: 9 } });

    const events = await collect(server.url + ENDPOINT);

    expect(events).toEqual(sent);
    expect(server.requests[0].json).toEqual(request);
    expect(server.requests[0].headers[ASSISTANT_HEADER]).toBe("1");
  });

  it.each([
    [403, "refused", "Questions must come from the Composition app."],
    [400, "invalid-request", "The model name is missing or invalid."],
    [413, "invalid-request", "The conversation is too large to send."],
    [500, "server", "boom"],
  ])("turns a %i reply into an error event carrying the reason", async (status, kind, message) => {
    server = await startFakeOllama({ [`POST ${ENDPOINT}`]: { status, body: { error: message } } });
    expect(await collect(server.url + ENDPOINT)).toEqual([{ type: "error", kind, message: expect.stringContaining(message) }]);
  });

  it("turns an error page with no JSON into a server error", async () => {
    server = await startFakeOllama({ [`POST ${ENDPOINT}`]: { status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" } });
    expect(await collect(server.url + ENDPOINT)).toEqual([{ type: "error", kind: "server", message: expect.any(String) }]);
  });

  it("says the app's own server can't be reached, rather than throwing", async () => {
    const events = await collect((await closedAddress()) + ENDPOINT);
    expect(events).toEqual([{ type: "error", kind: "unreachable", message: expect.stringMatching(/Composition/) }]);
  });

  it("reports a stream that ends before the turn did", async () => {
    server = await startFakeOllama({ [`POST ${ENDPOINT}`]: { body: lines({ type: "delta", text: "Hi" }) } });
    const events = await collect(server.url + ENDPOINT);
    expect(events[0]).toEqual({ type: "delta", text: "Hi" });
    expect(events[1]).toMatchObject({ type: "error", kind: "unreachable", message: expect.stringMatching(/closed before/i) });
  });

  it("does not trust a line that is not an event", async () => {
    server = await startFakeOllama({ [`POST ${ENDPOINT}`]: { body: lines({ type: "delta", text: "Hi" }, { type: "explode" }, { type: "done" }) } });
    const events = await collect(server.url + ENDPOINT);
    expect(events.map((e) => e.type)).toEqual(["delta", "error"]);
    expect(events[1]).toMatchObject({ kind: "bad-response" });
  });

  it("stops at the first event that ends the turn", async () => {
    server = await startFakeOllama({ [`POST ${ENDPOINT}`]: { body: lines({ type: "done" }, { type: "delta", text: "late" }) } });
    expect(await collect(server.url + ENDPOINT)).toEqual([{ type: "done" }]);
  });

  it("ends with an aborted event when the caller stops, and the connection is dropped", async () => {
    server = await startFakeOllama({ [`POST ${ENDPOINT}`]: { body: lines({ type: "delta", text: "Hi" }), holdOpen: true } });
    const controller = new AbortController();

    const events: ChatEvent[] = [];
    for await (const event of streamChat(request, controller.signal, server.url + ENDPOINT)) {
      events.push(event);
      controller.abort();
    }

    expect(events[events.length - 1]).toMatchObject({ type: "error", kind: "aborted" });
    await server.clientAborted;
  });
});
