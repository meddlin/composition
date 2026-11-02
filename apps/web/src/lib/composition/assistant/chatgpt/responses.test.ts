import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatRequest } from "../types";
import { listChatGptModels, streamChat, toResponsesInput } from "./responses";

const encoder = new TextEncoder();

const sse = (...events: object[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`event: x\ndata: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );

const request: ChatRequest = {
  provider: "chatgpt",
  model: "gpt-6.1-sol",
  numCtx: 128_000,
  messages: [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" },
    { role: "user", content: "Again" },
  ],
};

async function run(response: Response | Error, req: ChatRequest = request) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  const events: ChatEvent[] = [];
  for await (const event of streamChat("token", req, undefined, fetchImpl)) events.push(event);
  return { events, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

describe("toResponsesInput", () => {
  it("moves system text into instructions and keeps the rest in order", () => {
    expect(toResponsesInput(request.messages)).toEqual({
      instructions: "Be brief.",
      input: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Again" },
      ],
    });
  });

  it("has no instructions when there is no system message", () => {
    expect(toResponsesInput([{ role: "user", content: "x" }]).instructions).toBeUndefined();
  });
});

describe("streamChat (ChatGPT)", () => {
  it("sends only the fields the preview accepts, with the bearer token", async () => {
    const { fetchImpl } = await run(sse({ type: "response.completed", response: {} }));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.authorization).toBe("Bearer token");
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["input", "instructions", "model", "store", "stream"]);
    expect(body).toMatchObject({ model: "gpt-6.1-sol", store: false, stream: true, instructions: "Be brief." });
    expect(body.input.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });

  it("asks for the reasoning level only when one is given", async () => {
    const { fetchImpl } = await run(sse({ type: "response.completed", response: {} }), { ...request, effort: "high" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).reasoning).toEqual({ effort: "high" });
  });

  it("streams the text, then usage and done", async () => {
    const { events } = await run(
      sse(
        { type: "response.created" },
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.output_text.delta", delta: "lo" },
        { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 3 } } },
      ),
    );
    expect(events).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "usage", promptTokens: 12, outputTokens: 3 },
      { type: "done" },
    ]);
  });

  it("says once that the model is reasoning", async () => {
    const { events } = await run(
      sse(
        { type: "response.reasoning_summary_text.delta", delta: "a" },
        { type: "response.reasoning_summary_text.delta", delta: "b" },
        { type: "response.output_text.delta", delta: "x" },
        { type: "response.completed", response: {} },
      ),
    );
    expect(events.map((e) => e.type)).toEqual(["thinking", "delta", "done"]);
  });

  it("explains a usage limit reached mid-stream", async () => {
    const { events } = await run(
      sse(
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "x" } } },
      ),
    );
    expect(events[1]).toMatchObject({ type: "error", kind: "server" });
    expect((events[1] as { message: string }).message).toMatch(/usage limit/);
  });

  it("is an error, not a success, when the stream ends without completing", async () => {
    const { events } = await run(sse({ type: "response.output_text.delta", delta: "Hel" }));
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "unreachable" });
  });

  it("reports an incomplete answer", async () => {
    const { events } = await run(sse({ type: "response.incomplete", response: { incomplete_details: { reason: "max_tokens" } } }));
    expect(events[0]).toMatchObject({ type: "error" });
    expect((events[0] as { message: string }).message).toMatch(/max_tokens/);
  });

  it("asks to sign in again on a 401", async () => {
    const { events } = await run(Response.json({ error: { message: "bad" } }, { status: 401 }));
    expect(events).toEqual([{ type: "error", kind: "auth", message: expect.stringMatching(/Sign in again/) }]);
  });

  it("explains a usage limit that is refused up front", async () => {
    const { events } = await run(Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded" } }, { status: 429 }));
    expect((events[0] as { message: string }).message).toMatch(/usage limit/);
  });

  it("names the model when ChatGPT will not use it", async () => {
    const { events } = await run(Response.json({ error: { message: "no such model" } }, { status: 404 }));
    expect(events[0]).toMatchObject({ type: "error", kind: "model-missing" });
    expect((events[0] as { message: string }).message).toContain("gpt-6.1-sol");
  });

  it("reports an unreachable network and a stopped turn", async () => {
    expect((await run(new TypeError("fetch failed"))).events[0]).toMatchObject({ kind: "unreachable" });
    const stopped = Object.assign(new Error("x"), { name: "AbortError" });
    expect((await run(stopped)).events[0]).toMatchObject({ kind: "aborted" });
  });

  it("sends nothing for an empty conversation", async () => {
    const { events, fetchImpl } = await run(sse(), { ...request, messages: [] });
    expect(events[0]).toMatchObject({ kind: "invalid-request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("listChatGptModels", () => {
  const list = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;

  it("keeps the models the catalog lists, by display name", async () => {
    const result = await listChatGptModels(
      "token",
      undefined,
      list({
        models: [
          { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list", context_window: 200000 },
          { slug: "hidden-one", visibility: "hide" },
          { slug: "plain" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      models: [
        { name: "gpt-6.1-sol", label: "GPT-6.1-Sol (Medium)", parameterSize: "", contextLength: 200000, capabilities: ["completion"] },
        { name: "plain", label: "plain", parameterSize: "", contextLength: undefined, capabilities: ["completion"] },
      ],
    });
  });

  it("adds a size to the name, and lists the reasoning levels with the default", async () => {
    const levels = [{ effort: "low", description: "Fast" }, { effort: "high", description: "Deep" }, { effort: "bad level!" }];
    const result = await listChatGptModels(
      "token",
      undefined,
      list({
        models: [
          { slug: "gpt-6-astra", display_name: "GPT-6-Astra", supported_reasoning_levels: levels, default_reasoning_level: "low" },
          { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol" },
          { slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra" },
          { slug: "gpt-6-luna", display_name: "GPT-6-Luna", default_reasoning_level: "nope" },
        ],
      }),
    );
    expect(result.ok && result.models.map((m) => m.label)).toEqual(["GPT-6-Astra (Large)", "GPT-6.1 Sol (Medium)", "GPT-5.6-Terra (Small)", "GPT-6-Luna (Mini)"]);
    expect(result.ok && result.models[0]).toMatchObject({
      efforts: [{ effort: "low", description: "Fast" }, { effort: "high", description: "Deep" }],
      defaultEffort: "low",
    });
    expect(result.ok && result.models[3]).not.toHaveProperty("defaultEffort");
    expect(result.ok && result.models[1]).not.toHaveProperty("efforts");
  });

  it("asks to sign in again on a 401", async () => {
    expect(await listChatGptModels("t", undefined, list({}, 401))).toMatchObject({ ok: false, kind: "auth" });
  });

  it("rejects a list that is not one", async () => {
    expect(await listChatGptModels("t", undefined, list({ nope: 1 }))).toMatchObject({ ok: false, kind: "bad-response" });
  });
});
