import { afterEach, describe, expect, it } from "vitest";
import { closedAddress, fixture, recordedError, startFakeOllama, type FakeOllama, type FakeReply } from "./fakeOllama.test.helper";
import { streamChat } from "./ollama";
import type { ChatEvent, ChatRequest } from "./types";

let server: FakeOllama | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const request: ChatRequest = {
  model: "qwen3:0.6b",
  messages: [{ role: "user", content: "Say hello in five words." }],
  numCtx: 2048,
};

async function collect(baseUrl: string, req: ChatRequest = request, signal?: AbortSignal): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of streamChat(baseUrl, req, signal)) events.push(event);
  return events;
}

/** Replays a recorded stream, cut into small pieces so that lines and characters arrive split. */
const replay = (name: string, chunkBytes = 7): FakeReply => ({ body: fixture(name), chunkBytes });

const textOf = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");

describe("streamChat", () => {
  it("streams the answer, then the token counts, then done", async () => {
    server = await startFakeOllama({ "POST /api/chat": replay("chat-plain.ndjson") });

    const events = await collect(server.url);

    expect(textOf(events)).toBe("Hello! How can I assist you today?");
    expect(events.filter((e) => e.type === "delta")).toHaveLength(9);
    expect(events.slice(-2)).toEqual([{ type: "usage", promptTokens: 22, outputTokens: 10 }, { type: "done" }]);
  });

  it("asks for a stream with the context size, and sends nothing else", async () => {
    server = await startFakeOllama({ "POST /api/chat": replay("chat-plain.ndjson") });

    await collect(server.url);

    expect(server.requests).toHaveLength(1);
    const sent = server.requests[0];
    expect(sent.json).toEqual({
      model: "qwen3:0.6b",
      messages: [{ role: "user", content: "Say hello in five words." }],
      stream: true,
      options: { num_ctx: 2048 },
    });
    expect(sent.headers.authorization).toBeUndefined();
  });

  it("says the model is thinking, once, without passing its reasoning on", async () => {
    server = await startFakeOllama({ "POST /api/chat": replay("chat-thinking.ndjson", 97) });

    const events = await collect(server.url);

    expect(events.filter((e) => e.type === "thinking")).toHaveLength(1);
    expect(events[0]).toEqual({ type: "thinking" });
    expect(textOf(events)).toBe("2 + 2 = 4.");
    expect(events.slice(-2)).toEqual([{ type: "usage", promptTokens: 20, outputTokens: 120 }, { type: "done" }]);
  });

  describe("when the server refuses before streaming", () => {
    const errorOf = (events: ChatEvent[]) => {
      expect(events).toHaveLength(1);
      const [event] = events;
      if (event.type !== "error") throw new Error(`expected an error event, got ${event.type}`);
      return event;
    };

    it("says a model is not installed, and how to install it", async () => {
      server = await startFakeOllama({ "POST /api/chat": recordedError("missingModel") });
      const error = errorOf(await collect(server.url, { ...request, model: "nope:1b" }));
      expect(error.kind).toBe("model-missing");
      expect(error.message).toContain("ollama pull nope:1b");
    });

    it("passes on a refusal in the server's words, such as a model that cannot chat", async () => {
      server = await startFakeOllama({ "POST /api/chat": recordedError("modelCannotChat") });
      const error = errorOf(await collect(server.url));
      expect(error.kind).toBe("server");
      expect(error.message).toContain('"nomic-embed-text" does not support chat');
    });

    it.each([401, 403])("says plainly that a %i means the server wants credentials", async (status) => {
      server = await startFakeOllama({ "POST /api/chat": { status, contentType: "text/html", body: "<h1>Denied</h1>" } });
      const error = errorOf(await collect(server.url));
      expect(error.kind).toBe("auth");
      expect(error.message).toMatch(/credentials/i);
    });

    it("reports a proxy's error page as a server error", async () => {
      server = await startFakeOllama({
        "POST /api/chat": { status: 502, contentType: "text/html", body: "<html>502 Bad Gateway</html>" },
      });
      expect(errorOf(await collect(server.url)).kind).toBe("server");
    });

    it("does not take a 200 that is not a stream of JSON for an answer", async () => {
      server = await startFakeOllama({
        "POST /api/chat": { contentType: "text/html", body: "<html>Welcome to nginx</html>" },
      });
      const error = errorOf(await collect(server.url));
      expect(error.kind).toBe("bad-response");
      expect(error.message).toMatch(/Ollama/);
    });

    it("reports a server that is not running, naming the address", async () => {
      const url = await closedAddress();
      const error = errorOf(await collect(url));
      expect(error.kind).toBe("unreachable");
      expect(error.message).toContain(url);
    });
  });

  it("refuses to send an empty conversation, which the server would treat as 'just load the model'", async () => {
    server = await startFakeOllama({ "POST /api/chat": replay("chat-plain.ndjson") });
    const events = await collect(server.url, { ...request, messages: [] });
    expect(events).toEqual([{ type: "error", kind: "invalid-request", message: expect.stringMatching(/empty|nothing/i) }]);
    expect(server.requests).toHaveLength(0);
  });

  describe("when a stream goes wrong after it started", () => {
    it("ends with the error the server sent as a line of the stream", async () => {
      server = await startFakeOllama({ "POST /api/chat": replay("chat-error-midstream.ndjson") });

      const events = await collect(server.url);

      expect(textOf(events)).toBe("Hello!");
      const last = events[events.length - 1];
      expect(last).toMatchObject({ type: "error", kind: "server" });
      expect(last.type === "error" && last.message).toContain("unexpected EOF");
      expect(events.some((e) => e.type === "done")).toBe(false);
    });

    it("reports a connection that closed before the answer was finished", async () => {
      const firstThreeLines = fixture("chat-plain.ndjson").split("\n").slice(0, 3).join("\n") + "\n";
      server = await startFakeOllama({ "POST /api/chat": { body: firstThreeLines } });

      const events = await collect(server.url);

      expect(textOf(events)).toBe("Hello! How");
      const last = events[events.length - 1];
      expect(last).toMatchObject({ type: "error", kind: "unreachable" });
      expect(last.type === "error" && last.message).toMatch(/closed before/i);
      expect(events.some((e) => e.type === "done")).toBe(false);
    });

    it("stops when the caller aborts, and the server sees the connection drop", async () => {
      const firstThreeLines = fixture("chat-plain.ndjson").split("\n").slice(0, 3).join("\n") + "\n";
      server = await startFakeOllama({ "POST /api/chat": { body: firstThreeLines, holdOpen: true } });
      const controller = new AbortController();

      const events: ChatEvent[] = [];
      for await (const event of streamChat(server.url, request, controller.signal)) {
        events.push(event);
        if (textOf(events) === "Hello! How") controller.abort();
      }

      expect(events[events.length - 1]).toMatchObject({ type: "error", kind: "aborted" });
      await server.clientAborted;
    });
  });

  it("reports how many prompt tokens the model actually read, which can be fewer than were sent", async () => {
    // Recorded: about 3,000 tokens sent with a 512-token window. The server dropped the oldest and answered anyway.
    server = await startFakeOllama({ "POST /api/chat": replay("chat-truncated-prompt.ndjson", 61) });
    const events = await collect(server.url);
    expect(events.find((e) => e.type === "usage")).toEqual({ type: "usage", promptTokens: 35, outputTokens: 12 });
  });

  it("leaves out the token counts when the server sends none", async () => {
    server = await startFakeOllama({
      "POST /api/chat": {
        body: '{"message":{"role":"assistant","content":"Hi"},"done":false}\n{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n',
      },
    });
    expect(await collect(server.url)).toEqual([{ type: "delta", text: "Hi" }, { type: "done" }]);
  });
});
