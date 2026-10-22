import { afterEach, describe, expect, it } from "vitest";
import { closedAddress, fixtureJson, startFakeOllama, type FakeOllama, type FakeReply } from "./fakeOllama.test.helper";
import { isCloudModelName, listModels, modelInfo } from "./models";

let server: FakeOllama | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Answers `/api/show` from the recorded fixtures, by model name. */
const SHOW_FIXTURES: Record<string, string> = {
  "qwen3:0.6b": "show-qwen3-0.6b.json",
  "nomic-embed-text:latest": "show-nomic-embed-text.json",
  "qwen2.5-coder:1.5b-base": "show-qwen2.5-coder-1.5b-base.json",
};
const showFromFixtures = (request: { json: unknown }): FakeReply => {
  const model = (request.json as { model: string }).model;
  return { body: fixtureJson(SHOW_FIXTURES[model]) as object };
};

describe("isCloudModelName", () => {
  // The rule Ollama v0.40.4 applies (internal/modelref): the text after the last colon, trimmed and
  // lowercased, is `cloud`, or has no slash and ends `-cloud`. A request for such a name goes to ollama.com
  // whether or not the model is installed locally.
  it.each(["gpt-oss:20b:cloud", "gemma4:cloud", "gpt-oss:120b-cloud", " gemma4:CLOUD ", "x:Big-Cloud"])(
    "recognizes %j as a cloud model",
    (name) => {
      expect(isCloudModelName(name)).toBe(true);
    },
  );

  it.each(["qwen3:0.6b", "llama3.1:8b", "cloud:latest", "mycloud:7b", "foo-cloud", "registry.example.com:5000/model", "x:local"])(
    "recognizes %j as a local model",
    (name) => {
      expect(isCloudModelName(name)).toBe(false);
    },
  );
});

describe("listModels", () => {
  it("offers the installed models that can chat, with their size and window, and says how many cloud models it hid", async () => {
    server = await startFakeOllama({
      "GET /api/tags": { body: fixtureJson("tags.json") as object },
      "POST /api/show": showFromFixtures,
    });

    const result = await listModels(server.url);

    expect(result).toEqual({
      ok: true,
      hiddenCloud: 1,
      models: [
        { name: "qwen3:0.6b", parameterSize: "751.63M", contextLength: 40960, capabilities: ["completion", "tools", "thinking"] },
        { name: "qwen2.5-coder:1.5b-base", parameterSize: "1.5B", contextLength: 32768, capabilities: ["completion", "insert"] },
      ],
    });
    // The embedding model is left out, and nothing was asked about the cloud one.
    const asked = server.requests.filter((r) => r.path === "/api/show").map((r) => (r.json as { model: string }).model);
    expect(asked).not.toContain("example-model:cloud");
  });

  it("reports a server that is not running, naming the address", async () => {
    const url = await closedAddress();
    const result = await listModels(url);
    expect(result).toMatchObject({ ok: false, kind: "unreachable" });
    expect(result.ok === false && result.message).toContain(url);
  });

  it("passes on an error the server gives, in its own words", async () => {
    server = await startFakeOllama({ "GET /api/tags": { status: 500, body: { error: "disk on fire" } } });
    const result = await listModels(server.url);
    expect(result).toMatchObject({ ok: false, kind: "server" });
    expect(result.ok === false && result.message).toContain("disk on fire");
  });

  it.each([401, 403])("says plainly that a %i means the server wants credentials", async (status) => {
    server = await startFakeOllama({ "GET /api/tags": { status, contentType: "text/html", body: "<h1>Forbidden</h1>" } });
    const result = await listModels(server.url);
    expect(result).toMatchObject({ ok: false, kind: "auth" });
    expect(result.ok === false && result.message).toMatch(/credentials/i);
  });

  it("does not take a server that is not Ollama for Ollama", async () => {
    server = await startFakeOllama({ "GET /api/tags": { contentType: "text/html", body: "<html>Welcome to nginx</html>" } });
    const result = await listModels(server.url);
    expect(result).toMatchObject({ ok: false, kind: "bad-response" });
    expect(result.ok === false && result.message).toMatch(/Ollama/);
  });

  it("answers an unknown path as 'not an Ollama server'", async () => {
    server = await startFakeOllama({});
    expect(await listModels(server.url)).toMatchObject({ ok: false, kind: "bad-response" });
  });

  it("leaves out a model whose details could not be read, and still lists the rest", async () => {
    server = await startFakeOllama({
      "GET /api/tags": { body: fixtureJson("tags.json") as object },
      "POST /api/show": (request) =>
        (request.json as { model: string }).model === "qwen3:0.6b"
          ? { status: 500, body: { error: "model is corrupt" } }
          : showFromFixtures(request),
    });
    const result = await listModels(server.url);
    expect(result.ok && result.models.map((m) => m.name)).toEqual(["qwen2.5-coder:1.5b-base"]);
  });

  it("keeps the server's order even when it asks about many models at once", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `model-${String(i).padStart(2, "0")}:latest`);
    server = await startFakeOllama({
      "GET /api/tags": { body: { models: names.map((name) => ({ name, details: { parameter_size: "1B" } })) } },
      "POST /api/show": (request) => ({
        body: { capabilities: ["completion"], model_info: { "general.architecture": "x", "x.context_length": 4096 }, _for: (request.json as { model: string }).model },
      }),
    });
    const result = await listModels(server.url);
    expect(result.ok && result.models.map((m) => m.name)).toEqual(names);
  });

  it("reports that it was stopped when the caller aborts", async () => {
    server = await startFakeOllama({ "GET /api/tags": { body: { models: [] }, holdOpen: true, chunkBytes: 1 } });
    const controller = new AbortController();
    const pending = listModels(server.url, controller.signal);
    setTimeout(() => controller.abort(), 20);
    expect(await pending).toMatchObject({ ok: false, kind: "aborted" });
  });
});

describe("modelInfo", () => {
  it("gives a local model's window and what it can do", async () => {
    server = await startFakeOllama({ "POST /api/show": showFromFixtures });
    expect(await modelInfo(server.url, "qwen3:0.6b")).toEqual({
      ok: true,
      remote: false,
      contextLength: 40960,
      capabilities: ["completion", "tools", "thinking"],
    });
  });

  it("finds the window under whatever architecture the model has", async () => {
    server = await startFakeOllama({ "POST /api/show": showFromFixtures });
    const info = await modelInfo(server.url, "nomic-embed-text:latest");
    expect(info).toMatchObject({ ok: true, contextLength: 2048, capabilities: ["embedding"] });
  });

  it("says when a locally listed model really runs somewhere else", async () => {
    // Synthetic: the fields Ollama's /api/show sets for a cloud stub (server/routes.go, ShowHandler).
    server = await startFakeOllama({
      "POST /api/show": { body: { capabilities: ["completion"], remote_host: "https://ollama.com:443", remote_model: "example-model" } },
    });
    expect(await modelInfo(server.url, "stub:latest")).toMatchObject({ ok: true, remote: true });
  });

  it("does not ask about a cloud name at all, because asking would send the request to ollama.com", async () => {
    server = await startFakeOllama({ "POST /api/show": showFromFixtures });
    expect(await modelInfo(server.url, "gpt-oss:20b:cloud")).toMatchObject({ ok: true, remote: true });
    expect(server.requests).toHaveLength(0);
  });

  it("says a model is not installed, and how to install it", async () => {
    server = await startFakeOllama({ "POST /api/show": { status: 404, body: { error: "model 'nope:1b' not found" } } });
    const info = await modelInfo(server.url, "nope:1b");
    expect(info).toMatchObject({ ok: false, kind: "model-missing" });
    expect(info.ok === false && info.message).toContain("ollama pull nope:1b");
  });

  it("reports a server that is not running", async () => {
    expect(await modelInfo(await closedAddress(), "qwen3:0.6b")).toMatchObject({ ok: false, kind: "unreachable" });
  });
});
