import { describe, expect, it, vi } from "vitest";
import { decodeFeedBody, FeedFetchError, fetchFeedText, isPrivateAddress, type FeedFetchDeps } from "./feedFetcher";

const publicLookup = async () => ["93.184.216.34"];

function deps(answers: Record<string, Response | (() => Response)>, extra: Partial<FeedFetchDeps> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const answer = answers[url];
    if (!answer) throw new TypeError("fetch failed");
    return typeof answer === "function" ? answer() : answer;
  });
  return { calls, deps: { fetch: fetchMock as unknown as typeof fetch, lookup: publicLookup, ...extra } satisfies FeedFetchDeps };
}

const xml = (body = "<rss/>", headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { "content-type": "application/rss+xml", ...headers } });

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "127.8.8.8", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "::127.0.0.1",
  ])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.255.255", "100.63.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2001:db8::1"])("treats %s as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("treats what it cannot read as private", () => {
    expect(isPrivateAddress("not an ip")).toBe(true);
  });
});

describe("fetchFeedText: where it will go", () => {
  it.each([
    ["http://127.0.0.1:7700/feed"],
    ["http://localhost/feed"],
    ["http://[::1]/feed"],
    ["http://2130706433/feed"], // 127.0.0.1 written as one number; the URL parser turns it into 127.0.0.1
    ["http://printer.local/feed"],
    ["http://nas.internal/feed"],
  ])("refuses %s without asking the network", async (address) => {
    const { deps: d, calls } = deps({});
    await expect(fetchFeedText(address, null, d)).rejects.toThrow(/private network/);
    expect(calls).toEqual([]);
  });

  it("refuses a name that resolves to a private address, even if only one of several does", async () => {
    const { deps: d, calls } = deps({}, { lookup: async () => ["93.184.216.34", "10.0.0.7"] });
    await expect(fetchFeedText("https://sneaky.example/feed", null, d)).rejects.toThrow(/private network/);
    expect(calls).toEqual([]);
  });

  it("says so when the name cannot be found", async () => {
    const { deps: d } = deps({}, { lookup: async () => { throw new Error("ENOTFOUND"); } });
    await expect(fetchFeedText("https://nowhere.example/feed", null, d)).rejects.toThrow(/Could not find nowhere\.example/);
  });

  it("lets a private address through only when told to (tests)", async () => {
    const { deps: d } = deps({ "http://127.0.0.1:9/feed": xml("<rss>ok</rss>") }, { allowPrivate: true });
    await expect(fetchFeedText("http://127.0.0.1:9/feed", null, d)).resolves.toMatchObject({ kind: "ok", text: "<rss>ok</rss>" });
  });

  it.each([["file:///etc/passwd"], ["app://index.html"], ["javascript:alert(1)"], ["ftp://example.com/feed"]])("refuses %s", async (address) => {
    const { deps: d, calls } = deps({});
    await expect(fetchFeedText(address, null, d)).rejects.toBeInstanceOf(FeedFetchError);
    expect(calls).toEqual([]);
  });
});

describe("fetchFeedText: redirects", () => {
  it("follows a redirect and checks the new address", async () => {
    const { deps: d, calls } = deps({
      "https://a.example/feed": new Response(null, { status: 301, headers: { location: "/new" } }),
      "https://a.example/new": xml("<rss>moved</rss>"),
    });
    await expect(fetchFeedText("https://a.example/feed", null, d)).resolves.toMatchObject({ text: "<rss>moved</rss>" });
    expect(calls.map((c) => c.url)).toEqual(["https://a.example/feed", "https://a.example/new"]);
  });

  it("refuses a redirect to a private address or another scheme", async () => {
    for (const location of ["http://169.254.169.254/latest/meta-data", "http://localhost:7700/", "file:///etc/passwd"]) {
      const { deps: d } = deps({ "https://a.example/feed": new Response(null, { status: 302, headers: { location } }) });
      await expect(fetchFeedText("https://a.example/feed", null, d)).rejects.toBeInstanceOf(FeedFetchError);
    }
  });

  it("gives up on a redirect loop", async () => {
    const { deps: d } = deps({ "https://a.example/feed": () => new Response(null, { status: 302, headers: { location: "https://a.example/feed" } }) });
    await expect(fetchFeedText("https://a.example/feed", null, d)).rejects.toThrow(/too many times/);
  });

  it("refuses a redirect that does not say where", async () => {
    const { deps: d } = deps({ "https://a.example/feed": new Response(null, { status: 302 }) });
    await expect(fetchFeedText("https://a.example/feed", null, d)).rejects.toThrow(/without saying where/);
  });
});

describe("fetchFeedText: the answer", () => {
  it("sends the validators it was given, and keeps the ones it gets", async () => {
    const { deps: d, calls } = deps({ "https://a.example/feed": xml("<rss/>", { etag: '"v2"', "last-modified": "Tue, 27 Oct 2026 10:00:00 GMT" }) });
    const result = await fetchFeedText("https://a.example/feed", { etag: '"v1"', lastModified: "Mon, 26 Oct 2026 10:00:00 GMT" }, d);

    expect(result).toEqual({ kind: "ok", text: "<rss/>", etag: '"v2"', lastModified: "Tue, 27 Oct 2026 10:00:00 GMT" });
    expect(calls[0].headers).toMatchObject({ "If-None-Match": '"v1"', "If-Modified-Since": "Mon, 26 Oct 2026 10:00:00 GMT", "User-Agent": "Composition" });
  });

  it("sends no validators the first time", async () => {
    const { deps: d, calls } = deps({ "https://a.example/feed": xml() });
    await fetchFeedText("https://a.example/feed", { etag: "", lastModified: "" }, d);
    expect(Object.keys(calls[0].headers)).not.toContain("If-None-Match");
  });

  it("reports 'not modified' for a 304", async () => {
    const { deps: d } = deps({ "https://a.example/feed": new Response(null, { status: 304 }) });
    await expect(fetchFeedText("https://a.example/feed", { etag: '"v1"', lastModified: "" }, d)).resolves.toEqual({ kind: "notModified" });
  });

  it("names a failed status", async () => {
    const { deps: d } = deps({ "https://a.example/feed": new Response("nope", { status: 404 }) });
    await expect(fetchFeedText("https://a.example/feed", null, d)).rejects.toThrow("The server answered 404.");
  });

  it("does not repeat a network error's details, only where it could not reach", async () => {
    const { deps: d } = deps({});
    await expect(fetchFeedText("https://a.example/feed", null, d)).rejects.toThrow("Could not reach a.example. Check the address and your connection.");
  });

  it("gives up on a server that never answers", async () => {
    const hang = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    await expect(fetchFeedText("https://a.example/feed", null, { fetch: hang as unknown as typeof fetch, lookup: publicLookup, timeoutMs: 20 })).rejects.toThrow("took too long");
  });
});

describe("fetchFeedText: the size cap", () => {
  it("refuses a body that says it is too big, without reading it", async () => {
    const { deps: d } = deps({ "https://a.example/feed": xml("x", { "content-length": "999999" }) }, { maxBytes: 1000 });
    await expect(fetchFeedText("https://a.example/feed", null, d)).rejects.toThrow(/larger than/);
  });

  it("stops reading a body that grows past the cap, whatever it claims", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(400));
      },
    });
    const { deps: d } = deps({ "https://a.example/feed": new Response(endless, { status: 200 }) }, { maxBytes: 1000 });
    await expect(fetchFeedText("https://a.example/feed", null, d)).rejects.toThrow(/larger than/);
    expect(pulled).toBeLessThan(10);
  });
});

describe("decodeFeedBody", () => {
  const latin1 = new Uint8Array([...Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><t>caf'), 0xe9, ...Buffer.from("</t>")]);

  it("reads UTF-8 by default", () => {
    expect(decodeFeedBody(new TextEncoder().encode("<t>café</t>"), "application/rss+xml")).toBe("<t>café</t>");
  });

  it("follows the charset the server names, else the one the XML declares", () => {
    expect(decodeFeedBody(latin1, "text/xml; charset=ISO-8859-1")).toContain("café");
    expect(decodeFeedBody(latin1, "application/rss+xml")).toContain("café");
  });

  it("falls back to UTF-8 for a charset it does not know", () => {
    expect(decodeFeedBody(new TextEncoder().encode("<t>x</t>"), "text/xml; charset=nonsense-9")).toBe("<t>x</t>");
  });
});
