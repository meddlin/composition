import { describe, expect, it, vi } from "vitest";
import { answers, createEndpointResolver } from "./endpoint";
import { closedAddress, startFakeOllama } from "./fakeOllama.test.helper";

const addresses = { serverUrl: "http://home:11434", alternateUrl: "http://tail:11434" };

/** A probe that says yes only for the addresses given, and remembers what it was asked. */
function probeOf(up: string[]) {
  const asked: string[] = [];
  const probe = vi.fn(async (url: string) => {
    asked.push(url);
    return up.includes(url);
  });
  return { probe, asked };
}

describe("createEndpointResolver", () => {
  it("returns the first address without any request when there is no alternate", async () => {
    const { probe } = probeOf([]);
    const { resolve } = createEndpointResolver(probe);

    expect(await resolve({ serverUrl: "http://home:11434" })).toEqual({ ok: true, url: "http://home:11434", alternate: false });
    expect(probe).not.toHaveBeenCalled();
  });

  it("prefers the first address, and does not ask the alternate when it answers", async () => {
    const { probe, asked } = probeOf(["http://home:11434", "http://tail:11434"]);
    const { resolve } = createEndpointResolver(probe);

    expect(await resolve(addresses)).toEqual({ ok: true, url: "http://home:11434", alternate: false });
    expect(asked).toEqual(["http://home:11434"]);
  });

  it("falls back to the alternate when the first does not answer", async () => {
    const { resolve } = createEndpointResolver(probeOf(["http://tail:11434"]).probe);
    expect(await resolve(addresses)).toEqual({ ok: true, url: "http://tail:11434", alternate: true });
  });

  it("fails naming both addresses when neither answers", async () => {
    const { resolve } = createEndpointResolver(probeOf([]).probe);
    const result = await resolve(addresses);
    expect(result).toMatchObject({ ok: false, failure: { kind: "unreachable" } });
    expect(!result.ok && result.failure.message).toContain("http://home:11434");
    expect(!result.ok && result.failure.message).toContain("http://tail:11434");
  });

  it("remembers a choice for a few seconds, then asks again, so it moves back to the first address", async () => {
    let clock = 0;
    let homeIsUp = false;
    const probe = vi.fn(async (url: string) => (url === "http://home:11434" ? homeIsUp : true));
    const { resolve } = createEndpointResolver(probe, () => clock);

    expect(await resolve(addresses)).toMatchObject({ url: "http://tail:11434" });
    homeIsUp = true;
    clock = 5_000;
    expect(await resolve(addresses)).toMatchObject({ url: "http://tail:11434" });
    expect(probe).toHaveBeenCalledTimes(2);

    clock = 60_000;
    expect(await resolve(addresses)).toMatchObject({ url: "http://home:11434", alternate: false });
  });

  it("asks again after `forget`", async () => {
    const { probe } = probeOf(["http://home:11434"]);
    const { resolve, forget } = createEndpointResolver(probe);
    await resolve(addresses);
    await resolve(addresses);
    expect(probe).toHaveBeenCalledTimes(1);

    forget();
    await resolve(addresses);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a choice made for other addresses", async () => {
    const { probe } = probeOf(["http://home:11434", "http://other:11434"]);
    const { resolve } = createEndpointResolver(probe);
    await resolve(addresses);

    expect(await resolve({ serverUrl: "http://nope:11434", alternateUrl: "http://other:11434" })).toMatchObject({ url: "http://other:11434" });
  });

  it("shares one probe between callers that ask at the same time", async () => {
    const { probe } = probeOf(["http://home:11434"]);
    const { resolve } = createEndpointResolver(probe);

    const [a, b] = await Promise.all([resolve(addresses), resolve(addresses)]);

    expect(a).toEqual(b);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("reports a stop as a stop, not as the servers being down", async () => {
    const controller = new AbortController();
    const probe = vi.fn(async () => {
      controller.abort();
      return false;
    });
    const { resolve } = createEndpointResolver(probe);

    expect(await resolve(addresses, controller.signal)).toEqual({ ok: false, failure: { kind: "aborted", message: "Stopped." } });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("answers", () => {
  it("is true for an Ollama that reports its version", async () => {
    const server = await startFakeOllama({ "GET /api/version": { body: { version: "0.40.13" } } });
    try {
      expect(await answers(server.url, 1000)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it.each([
    ["an error status", { status: 500, body: { error: "x" } }],
    ["a body that is not JSON", { contentType: "text/html", body: "<html></html>" as never }],
    ["JSON that is not a version", { body: { hello: "world" } }],
  ])("is false for %s", async (_name, reply) => {
    const server = await startFakeOllama({ "GET /api/version": reply });
    try {
      expect(await answers(server.url, 1000)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("is false when nothing is listening, and when the server never answers within the time", async () => {
    expect(await answers(await closedAddress(), 1000)).toBe(false);
    const slow = await startFakeOllama({ "GET /api/version": { body: "", holdOpen: true } });
    try {
      expect(await answers(slow.url, 50)).toBe(false);
    } finally {
      await slow.close();
    }
  });
});
