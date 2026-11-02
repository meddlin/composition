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

describe("an alternate address", () => {
  const version = { body: { version: "0.40.13" } };
  const tags = { body: { models: [] } };
  const showLocal = { body: { capabilities: ["completion"], model_info: {} } };
  const request: ChatRequest = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };
  let other: FakeOllama | undefined;

  afterEach(async () => {
    await other?.close();
    other = undefined;
  });

  const saved = async (serverUrl: string, alternateUrl: string) => {
    const tools = await load();
    await tools.saveAssistantSettings({ serverUrl, alternateUrl, contextTokens: 8192 });
    return tools;
  };

  async function chat(tools: Awaited<ReturnType<typeof load>>) {
    const events: ChatEvent[] = [];
    for await (const event of tools.streamAssistantChat(request)) events.push(event);
    return events;
  }

  it("is saved with the other settings, and cleared by saving it blank", async () => {
    const { saveAssistantSettings, loadWebSettings } = await load();

    expect(await saveAssistantSettings({ serverUrl: "nas:11434", alternateUrl: "100.64.0.9:11434/", contextTokens: 8192 })).toEqual({
      settings: { serverUrl: "http://nas:11434", alternateUrl: "http://100.64.0.9:11434", contextTokens: 8192 },
    });
    expect(loadWebSettings().assistant?.alternateUrl).toBe("http://100.64.0.9:11434");

    await saveAssistantSettings({ serverUrl: "nas:11434", alternateUrl: "  ", contextTokens: 8192 });
    expect(loadWebSettings().assistant).toEqual({ serverUrl: "http://nas:11434", contextTokens: 8192 });
  });

  it("uses the first address when it answers, and never contacts the alternate", async () => {
    server = await startFakeOllama({ "GET /api/version": version, "GET /api/tags": tags });
    other = await startFakeOllama({ "GET /api/version": version, "GET /api/tags": tags });
    const { listAssistantModels } = await saved(server.url, other.url);

    const result = await listAssistantModels();

    expect(result).toMatchObject({ serverUrl: server.url, viaAlternate: false, local: true });
    expect(other.requests).toHaveLength(0);
  });

  it("uses the alternate when the first address does not answer, and says so", async () => {
    other = await startFakeOllama({ "GET /api/version": version, "GET /api/tags": tags });
    const { listAssistantModels } = await saved(await closedAddress(), other.url);

    const result = await listAssistantModels();

    expect(result).toMatchObject({ serverUrl: other.url, viaAlternate: true });
    expect(result.error).toBeUndefined();
  });

  it("treats a first address that answers with something other than Ollama as not answering", async () => {
    server = await startFakeOllama({ "GET /api/version": { contentType: "text/html", body: "<html>router login</html>" as never } });
    other = await startFakeOllama({ "GET /api/version": version, "GET /api/tags": tags });
    const { listAssistantModels } = await saved(server.url, other.url);

    expect(await listAssistantModels()).toMatchObject({ serverUrl: other.url, viaAlternate: true });
  });

  it("sends the chat to the alternate when the first address does not answer", async () => {
    other = await startFakeOllama({
      "GET /api/version": version,
      "POST /api/show": showLocal,
      "POST /api/chat": { body: fixture("chat-plain.ndjson") },
    });
    const tools = await saved(await closedAddress(), other.url);

    const events = await chat(tools);

    expect(events[events.length - 1]).toEqual({ type: "done" });
    expect(other.requests.some((r) => r.path === "/api/chat")).toBe(true);
  });

  it("names both addresses when neither answers", async () => {
    const first = await closedAddress();
    const second = await closedAddress();
    const tools = await saved(first, second);

    const listed = await tools.listAssistantModels();
    expect(listed.error).toMatchObject({ kind: "unreachable", message: expect.stringContaining(first) });
    expect(listed.error?.message).toContain(second);

    expect(await chat(tools)).toEqual([{ type: "error", kind: "unreachable", message: expect.stringContaining(second) }]);
  });

  it("switches when the chosen address stops answering, without a second attempt from the user", async () => {
    server = await startFakeOllama({ "GET /api/version": version, "GET /api/tags": tags });
    other = await startFakeOllama({ "GET /api/version": version, "GET /api/tags": tags });
    const { listAssistantModels } = await saved(server.url, other.url);
    expect((await listAssistantModels()).viaAlternate).toBe(false);

    // The first address goes away (the laptop left the network) within the time a choice is remembered.
    await server.close();
    server = undefined;

    expect(await listAssistantModels()).toMatchObject({ serverUrl: other.url, viaAlternate: true });
  });
});

describe("ChatGPT", () => {
  const request: ChatRequest = { provider: "chatgpt", model: "gpt-6.1-sol", messages: [{ role: "user", content: "hi" }], numCtx: 128_000 };

  /** An account that is signed in, as the sign-in would have left it beside the settings file. */
  const signedIn = (over: object = {}) => {
    const dir = path.join(home, ".composition-web");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "chatgpt-auth.json"),
      JSON.stringify({ clientId: "oaiapp_1", hostId: "urn:uuid:h", accessToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3_600_000, ...over }),
    );
  };

  /** Answers OpenAI's addresses itself and leaves everything else (the fake Ollama) to the real `fetch`. */
  function stubOpenAi(routes: Record<string, () => Response>) {
    const realFetch = fetch;
    const asked: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.openai.com/")) {
        asked.push({ url, init });
        return (routes[url] ?? (() => new Response("", { status: 500 })))();
      }
      return realFetch(input, init);
    });
    return asked;
  }

  const sse = (...events: object[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));

  async function run(req: ChatRequest = request) {
    const { streamAssistantChat } = await load();
    const events: ChatEvent[] = [];
    for await (const event of streamAssistantChat(req)) events.push(event);
    return events;
  }

  it("tells a signed-out user to sign in, without contacting anyone", async () => {
    const asked = stubOpenAi({});
    const events = await run();
    expect(events).toEqual([{ type: "error", kind: "auth", message: expect.stringMatching(/not signed in/i) }]);
    expect(asked).toEqual([]);
  });

  it("streams the answer with the saved token, and never touches the Ollama server", async () => {
    signedIn();
    server = await startFakeOllama({});
    const tools = await load();
    await tools.saveAssistantSettings({ serverUrl: server.url, contextTokens: 8192 });
    const asked = stubOpenAi({
      "https://api.openai.com/v1/responses": () => sse({ type: "response.output_text.delta", delta: "Hi!" }, { type: "response.completed", response: {} }),
    });

    const events = await run();

    expect(events).toEqual([{ type: "delta", text: "Hi!" }, { type: "done" }]);
    expect((asked[0].init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(server.requests).toEqual([]);
  });

  it("does not apply Ollama's cloud-name rule to a ChatGPT model", async () => {
    signedIn();
    stubOpenAi({ "https://api.openai.com/v1/responses": () => sse({ type: "response.completed", response: {} }) });
    expect(await run({ ...request, model: "gpt:cloud" })).toEqual([{ type: "done" }]);
  });

  it("lists the signed-in account's models next to the server's, even when the server is down", async () => {
    signedIn();
    stubOpenAi({
      "https://api.openai.com/v1/models": () => Response.json({ models: [{ slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list" }] }),
    });
    const { saveAssistantSettings, listAssistantModels } = await load();
    await saveAssistantSettings({ serverUrl: await closedAddress(), contextTokens: 8192 });

    const result = await listAssistantModels();

    expect(result.error).toMatchObject({ kind: "unreachable" });
    expect(result.chatgpt).toEqual({ signedIn: true, models: [expect.objectContaining({ name: "gpt-6.1-sol", label: "GPT-6.1-Sol" })] });
  });

  it("offers no ChatGPT models, and asks OpenAI nothing, when signed out", async () => {
    const asked = stubOpenAi({});
    server = await startFakeOllama({ "GET /api/tags": { body: { models: [] } } });
    const { saveAssistantSettings, listAssistantModels } = await load();
    await saveAssistantSettings({ serverUrl: server.url, contextTokens: 8192 });

    expect((await listAssistantModels()).chatgpt).toEqual({ signedIn: false, models: [] });
    expect(asked).toEqual([]);
  });

  it("reports the account, and forgets it on sign-out", async () => {
    signedIn({ email: "me@example.com" });
    const { chatGptStatus, signOutChatGpt } = await import("./assistantService");
    expect(await chatGptStatus()).toEqual({ state: "signed-in", email: "me@example.com" });
    await signOutChatGpt();
    expect(await chatGptStatus()).toEqual({ state: "signed-out" });
  });
});
