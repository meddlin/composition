import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closedAddress, fixture, fixtureJson, startFakeOllama, type FakeOllama } from "./assistant/fakeOllama.test.helper";
import type { ChatEvent, ChatRequest } from "./assistant/types";

// The settings file lives under the home directory, fixed when webSettings is first imported, so every test
// points HOME at a temp dir and imports fresh copies of the modules.
let home: string;
let server: FakeOllama | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-assistant-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

const load = async () => {
  const [{ saveAssistantSettings, listAssistantModels, streamAssistantChat }, { loadWebSettings, saveWebSettings }] =
    await Promise.all([import("./assistantService"), import("./webSettings")]);
  return { saveAssistantSettings, listAssistantModels, streamAssistantChat, loadWebSettings, saveWebSettings };
};

describe("saveAssistantSettings", () => {
  it("saves the server address and context size, normalized, and gives back what it saved", async () => {
    const { saveAssistantSettings, loadWebSettings } = await load();

    const result = await saveAssistantSettings({ serverUrl: "NAS.local:11434/", contextTokens: 16384 });

    expect(result).toEqual({ settings: { serverUrl: "http://nas.local:11434", contextTokens: 16384 } });
    expect(loadWebSettings().assistant).toEqual({ serverUrl: "http://nas.local:11434", contextTokens: 16384 });
  });

  it("leaves every other setting as it was", async () => {
    const { saveAssistantSettings, loadWebSettings, saveWebSettings } = await load();
    saveWebSettings({ ...loadWebSettings(), theme: "forest", previewFont: "lora", sidebarWidth: 320 });

    await saveAssistantSettings({ serverUrl: "", contextTokens: 8192 });

    expect(loadWebSettings()).toMatchObject({ theme: "forest", previewFont: "lora", sidebarWidth: 320 });
  });

  it("says what is wrong with an address or a window that cannot be used, and saves nothing", async () => {
    const { saveAssistantSettings, loadWebSettings } = await load();

    expect((await saveAssistantSettings({ serverUrl: "ftp://nas", contextTokens: 8192 })).error).toMatch(/http/i);
    expect((await saveAssistantSettings({ serverUrl: "http://nas:22", contextTokens: 8192 })).error).toMatch(/port 22/i);
    expect((await saveAssistantSettings({ serverUrl: "", contextTokens: 12 })).error).toMatch(/1,024/);
    expect(loadWebSettings().assistant).toBeUndefined();
  });
});

describe("listAssistantModels", () => {
  const savedTo = async (url: string) => {
    const tools = await load();
    await tools.saveAssistantSettings({ serverUrl: url, contextTokens: 8192 });
    return tools;
  };

  it("lists the models on the saved server and says whether that server is this machine", async () => {
    server = await startFakeOllama({
      "GET /api/tags": { body: fixtureJson("tags.json") as object },
      "POST /api/show": (request) => {
        const model = (request.json as { model: string }).model;
        const files: Record<string, string> = {
          "qwen3:0.6b": "show-qwen3-0.6b.json",
          "nomic-embed-text:latest": "show-nomic-embed-text.json",
          "qwen2.5-coder:1.5b-base": "show-qwen2.5-coder-1.5b-base.json",
        };
        return { body: fixtureJson(files[model]) as object };
      },
    });
    const { listAssistantModels } = await savedTo(server.url);

    const result = await listAssistantModels();

    expect(result.serverUrl).toBe(server.url);
    expect(result.local).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.models.map((m) => m.name)).toEqual(["qwen3:0.6b", "qwen2.5-coder:1.5b-base"]);
    expect(result.hiddenCloud).toBe(1);
  });

  it("also says what context size the helper will ask for, saved or not", async () => {
    server = await startFakeOllama({ "GET /api/tags": { body: { models: [] } } });
    const { listAssistantModels, saveAssistantSettings } = await load();
    // Nothing saved yet: the default. The default address must not reach a real Ollama on this machine.
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect((await listAssistantModels()).contextTokens).toBe(8192);
    vi.unstubAllGlobals();
    await saveAssistantSettings({ serverUrl: server.url, contextTokens: 32768 });
    expect((await listAssistantModels()).contextTokens).toBe(32768);
  });

  it("asks Ollama's own address when nothing has been saved", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      throw new TypeError("fetch failed");
    });
    const { listAssistantModels } = await load();

    await listAssistantModels();

    expect(asked).toEqual(["http://127.0.0.1:11434/api/tags"]);
  });

  it("reports a server that is not running, with no models", async () => {
    const { listAssistantModels } = await savedTo(await closedAddress());

    const result = await listAssistantModels();

    expect(result.models).toEqual([]);
    expect(result.error).toMatchObject({ kind: "unreachable" });
    expect(result.error?.message).toContain(result.serverUrl);
  });

  it("gives up on a server that never answers", async () => {
    server = await startFakeOllama({ "GET /api/tags": { body: "", holdOpen: true } });
    const { listAssistantModels } = await savedTo(server.url);

    const result = await listAssistantModels(50);

    expect(result.error).toMatchObject({ kind: "unreachable" });
    expect(result.error?.message).toMatch(/timed out/i);
  });
});

describe("streamAssistantChat", () => {
  const request: ChatRequest = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };
  const showLocal = { body: { capabilities: ["completion"], model_info: {} } };

  async function run(signal?: AbortSignal, req = request, tools?: Awaited<ReturnType<typeof load>>) {
    const { streamAssistantChat } = tools ?? (await load());
    const events: ChatEvent[] = [];
    for await (const event of streamAssistantChat(req, signal)) events.push(event);
    return events;
  }

  const savedTo = async (url: string) => {
    const tools = await load();
    await tools.saveAssistantSettings({ serverUrl: url, contextTokens: 8192 });
    return tools;
  };

  it("streams a reply from the saved server", async () => {
    server = await startFakeOllama({ "POST /api/show": showLocal, "POST /api/chat": { body: fixture("chat-plain.ndjson"), chunkBytes: 50 } });
    const tools = await savedTo(server.url);

    const events = await run(undefined, request, tools);

    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("Hello! How can I assist you today?");
    expect(events[events.length - 1]).toEqual({ type: "done" });
    expect(server.requests.find((r) => r.path === "/api/chat")?.json).toMatchObject({ model: "qwen3:0.6b", options: { num_ctx: 8192 } });
  });

  it("refuses a cloud model by name without contacting the server at all", async () => {
    server = await startFakeOllama({ "POST /api/show": showLocal, "POST /api/chat": { body: fixture("chat-plain.ndjson") } });
    const tools = await savedTo(server.url);

    const events = await run(undefined, { ...request, model: "gpt-oss:20b:cloud" }, tools);

    expect(events).toEqual([{ type: "error", kind: "refused", message: expect.stringMatching(/ollama\.com/) }]);
    expect(server.requests).toHaveLength(0);
  });

  it("refuses a model the server would run elsewhere, before any of the conversation is sent", async () => {
    server = await startFakeOllama({
      "POST /api/show": { body: { capabilities: ["completion"], remote_host: "https://ollama.com:443", remote_model: "x" } },
      "POST /api/chat": { body: fixture("chat-plain.ndjson") },
    });
    const tools = await savedTo(server.url);

    const events = await run(undefined, { ...request, model: "stub:latest" }, tools);

    expect(events).toEqual([{ type: "error", kind: "refused", message: expect.stringMatching(/ollama\.com|another/i) }]);
    expect(server.requests.some((r) => r.path === "/api/chat")).toBe(false);
  });

  it("says a model is not installed, from the check before the chat", async () => {
    server = await startFakeOllama({ "POST /api/show": { status: 404, body: { error: "model 'qwen3:0.6b' not found" } } });
    const tools = await savedTo(server.url);

    const events = await run(undefined, request, tools);

    expect(events).toEqual([{ type: "error", kind: "model-missing", message: expect.stringContaining("ollama pull qwen3:0.6b") }]);
  });

  it("reports a server that is not running", async () => {
    const tools = await savedTo(await closedAddress());
    expect(await run(undefined, request, tools)).toEqual([{ type: "error", kind: "unreachable", message: expect.any(String) }]);
  });

  it("stops when aborted, and the server sees the connection drop", async () => {
    const lines = fixture("chat-plain.ndjson").split("\n").slice(0, 3).join("\n") + "\n";
    server = await startFakeOllama({ "POST /api/show": showLocal, "POST /api/chat": { body: lines, holdOpen: true } });
    const tools = await savedTo(server.url);
    const controller = new AbortController();

    const events: ChatEvent[] = [];
    for await (const event of tools.streamAssistantChat(request, controller.signal)) {
      events.push(event);
      if (event.type === "delta" && events.length === 2) controller.abort();
    }

    expect(events[events.length - 1]).toMatchObject({ type: "error", kind: "aborted" });
    await server.clientAborted;
  });
});
