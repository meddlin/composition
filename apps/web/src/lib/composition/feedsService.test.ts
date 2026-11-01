import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedEntry, ParsedFeed } from "./feeds";
import { MAX_FEED_ENTRIES } from "./feedsApi";

// Meilisearch isn't running in tests; indexing is best-effort, so a stub keeps the suite quiet.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "Search is unavailable.",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-feeds-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const entry = (guid: string, publishedAt: string | null = "2026-10-01T00:00:00.000Z", extra: Partial<ParsedEntry> = {}): ParsedEntry => ({
  guid,
  url: `https://example.com/${guid}`,
  title: `Title ${guid}`,
  summary: `About ${guid}`,
  publishedAt,
  ...extra,
});

const parsed = (entries: ParsedEntry[], title = "Example"): ParsedFeed => ({ title, siteUrl: "https://example.com/", entries });
const ok = (feed: ParsedFeed, etag = "") => ({ kind: "ok" as const, feed, etag, lastModified: "" });

describe("the RSS Reader service", () => {
  it("starts with no feeds", async () => {
    const { listFeeds, listFeedEntries } = await import("./feedsService");

    expect(await listFeeds()).toEqual([]);
    expect(await listFeedEntries(null)).toEqual([]);
  });

  it("subscribes with the fetched feed and lists it with its unread count", async () => {
    const { subscribe, listFeeds, listFeedEntries } = await import("./feedsService");

    const feed = subscribe("https://example.com/feed.xml", ok(parsed([entry("a"), entry("b", "2026-10-02T00:00:00.000Z")]), '"v1"'));

    expect(feed).toMatchObject({ url: "https://example.com/feed.xml", title: "Example", siteUrl: "https://example.com/", unread: 2, lastError: "" });
    expect(feed.lastFetchedAt).not.toBeNull();
    expect(await listFeeds()).toEqual([feed]);
    expect((await listFeedEntries(feed.id)).map((e) => e.title)).toEqual(["Title b", "Title a"]);
  });

  it("refuses a bad address and a feed it already has", async () => {
    const { subscribe, checkNewFeedUrl } = await import("./feedsService");

    expect(() => checkNewFeedUrl("javascript:alert(1)")).toThrow(/web addresses/);
    subscribe("https://example.com/feed.xml", ok(parsed([])));
    expect(() => checkNewFeedUrl("example.com/feed.xml")).toThrow(/already subscribed to that feed: Example/);
  });

  it("keeps what the server told it for the next, conditional, request", async () => {
    const { subscribe, getFetchState } = await import("./feedsService");

    const feed = subscribe("https://example.com/feed.xml", { kind: "ok", feed: parsed([]), etag: '"abc"', lastModified: "Mon, 26 Oct 2026 10:00:00 GMT" });

    expect(getFetchState(feed.id)).toEqual({ url: "https://example.com/feed.xml", etag: '"abc"', lastModified: "Mon, 26 Oct 2026 10:00:00 GMT" });
    expect(getFetchState(feed.id + 1)).toBeNull();
  });

  describe("refreshing", () => {
    it("adds new entries, updates known ones, and keeps their read mark and date", async () => {
      const { subscribe, applyFetch, listFeedEntries, setFeedEntryRead } = await import("./feedsService");
      const feed = subscribe("https://example.com/feed.xml", ok(parsed([entry("a")])));
      const [first] = await listFeedEntries(feed.id);
      await setFeedEntryRead(first.id, true);

      const after = applyFetch(feed.id, ok(parsed([entry("a", "2030-01-01T00:00:00.000Z", { title: "Renamed" }), entry("b")], "Example 2")));

      const entries = await listFeedEntries(feed.id);
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.id === first.id)).toMatchObject({ title: "Renamed", read: true, publishedAt: "2026-10-01T00:00:00.000Z" });
      expect(after).toMatchObject({ title: "Example 2", unread: 1 });
    });

    it("dates an undated entry with the time it was first seen, and keeps that date", async () => {
      const { subscribe, applyFetch, listFeedEntries } = await import("./feedsService");
      const feed = subscribe("https://example.com/feed.xml", ok(parsed([entry("a", null)])));
      const [first] = await listFeedEntries(feed.id);
      expect(Date.parse(first.publishedAt)).not.toBeNaN();

      applyFetch(feed.id, ok(parsed([entry("a", null)])));

      expect((await listFeedEntries(feed.id))[0].publishedAt).toBe(first.publishedAt);
    });

    it("records an error on the feed and leaves its entries alone", async () => {
      const { subscribe, applyFetch, listFeedEntries, listFeeds } = await import("./feedsService");
      const feed = subscribe("https://example.com/feed.xml", ok(parsed([entry("a")])));

      applyFetch(feed.id, { kind: "error", message: "The server answered 500." });

      expect((await listFeeds())[0]).toMatchObject({ lastError: "The server answered 500.", unread: 1 });
      expect(await listFeedEntries(feed.id)).toHaveLength(1);

      applyFetch(feed.id, { kind: "notModified" });
      expect((await listFeeds())[0].lastError).toBe("");
    });

    it("does nothing for a feed that was unsubscribed while the fetch was out", async () => {
      const { subscribe, applyFetch, unsubscribeFeed, listFeedEntries } = await import("./feedsService");
      const feed = subscribe("https://example.com/feed.xml", ok(parsed([entry("a")])));
      await unsubscribeFeed(feed.id);

      expect(applyFetch(feed.id, ok(parsed([entry("b")])))).toBeNull();
      expect(await listFeedEntries(null)).toEqual([]);
    });

    it("keeps the newest MAX_FEED_ENTRIES read entries and every unread one", async () => {
      const { subscribe, applyFetch, listFeedEntries, markFeedRead, setFeedEntryRead } = await import("./feedsService");
      const total = MAX_FEED_ENTRIES + 20;
      const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      const feed = subscribe("https://example.com/feed.xml", ok(parsed(Array.from({ length: MAX_FEED_ENTRIES }, (_, i) => entry(`e${i}`, stamp(i))))));
      await markFeedRead(feed.id);
      // The oldest one is unread again; it must survive the pruning that the 20 newer entries bring.
      const oldest = (await listFeedEntries(feed.id)).at(-1)!;
      await setFeedEntryRead(oldest.id, false);

      applyFetch(feed.id, ok(parsed(Array.from({ length: total }, (_, i) => entry(`e${i}`, stamp(i))))));

      const entries = await listFeedEntries(feed.id);
      expect(entries.some((e) => e.id === oldest.id)).toBe(true);
      expect(entries.length).toBeLessThanOrEqual(MAX_FEED_ENTRIES + 1 + 20);
      expect(entries.filter((e) => e.read).length).toBeLessThanOrEqual(MAX_FEED_ENTRIES);
    });
  });

  describe("reading and unsubscribing", () => {
    it("marks an entry read and unread, and refuses a missing one", async () => {
      const { subscribe, listFeedEntries, setFeedEntryRead, listFeeds } = await import("./feedsService");
      const feed = subscribe("https://example.com/feed.xml", ok(parsed([entry("a")])));
      const [first] = await listFeedEntries(feed.id);

      expect(await setFeedEntryRead(first.id, true)).toMatchObject({ read: true });
      expect((await listFeeds())[0].unread).toBe(0);
      expect(await setFeedEntryRead(first.id, false)).toMatchObject({ read: false });
      await expect(setFeedEntryRead(first.id + 99, true)).rejects.toThrow(/no longer there/);
    });

    it("marks one feed's entries read, or every feed's", async () => {
      const { subscribe, markFeedRead, listFeeds } = await import("./feedsService");
      const a = subscribe("https://a.example/feed", ok(parsed([entry("a1"), entry("a2")], "A")));
      subscribe("https://b.example/feed", ok(parsed([entry("b1")], "B")));

      await markFeedRead(a.id);
      expect((await listFeeds()).map((f) => f.unread)).toEqual([0, 1]);
      await markFeedRead(null);
      expect((await listFeeds()).map((f) => f.unread)).toEqual([0, 0]);
    });

    it("unsubscribing removes the feed and all its entries, and only its own", async () => {
      const { subscribe, unsubscribeFeed, listFeeds, listFeedEntries } = await import("./feedsService");
      const a = subscribe("https://a.example/feed", ok(parsed([entry("a1"), entry("a2")], "A")));
      const b = subscribe("https://b.example/feed", ok(parsed([entry("a1")], "B")));

      await unsubscribeFeed(a.id);

      expect((await listFeeds()).map((f) => f.id)).toEqual([b.id]);
      expect((await listFeedEntries(null)).map((e) => e.feedId)).toEqual([b.id]);
      await expect(unsubscribeFeed(a.id)).resolves.toBeUndefined();
    });

    it("lets a feed be subscribed to again after unsubscribing", async () => {
      const { subscribe, unsubscribeFeed, checkNewFeedUrl } = await import("./feedsService");
      const feed = subscribe("https://example.com/feed.xml", ok(parsed([])));
      await unsubscribeFeed(feed.id);

      expect(checkNewFeedUrl("https://example.com/feed.xml")).toBe("https://example.com/feed.xml");
    });
  });
});
