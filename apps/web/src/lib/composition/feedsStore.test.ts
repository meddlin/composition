import { describe, expect, it, vi } from "vitest";
import type { Feed, FeedEntry, FeedsApi } from "./feedsApi";
import { createFeedsStore, unavailableFeeds } from "./feedsStore";

const feed = (id: number, extra: Partial<Feed> = {}): Feed => ({ id, url: `https://f${id}.example/feed`, title: `Feed ${id}`, siteUrl: "", lastFetchedAt: null, lastError: "", unread: 99, createdAt: "", ...extra });
const entry = (id: number, feedId: number, read = false): FeedEntry => ({ id, feedId, url: "", title: `E${id}`, summary: "", publishedAt: `2026-10-0${id}T00:00:00.000Z`, read });

function backend(initial: { feeds?: Feed[]; entries?: FeedEntry[] } = {}) {
  const data = { feeds: initial.feeds ?? [feed(1), feed(2)], entries: initial.entries ?? [entry(1, 1), entry(2, 1), entry(3, 2)] };
  const api = {
    listFeeds: vi.fn(async () => data.feeds),
    listFeedEntries: vi.fn(async () => data.entries),
    subscribeFeed: vi.fn(async (url: string) => {
      const added = feed(7, { url, title: "New" });
      data.feeds = [...data.feeds, added];
      data.entries = [...data.entries, entry(7, 7)];
      return added;
    }),
    unsubscribeFeed: vi.fn(async (id: number) => {
      data.feeds = data.feeds.filter((f) => f.id !== id);
      data.entries = data.entries.filter((e) => e.feedId !== id);
    }),
    refreshFeed: vi.fn(async (id: number) => data.feeds.find((f) => f.id === id)!),
    refreshAllFeeds: vi.fn(async () => data.feeds),
    setFeedEntryRead: vi.fn(async (id: number, read: boolean) => ({ ...data.entries.find((e) => e.id === id)!, read })),
    markFeedRead: vi.fn(async () => {}),
  } satisfies FeedsApi;
  return { api, data };
}

describe("the feeds store", () => {
  it("loads once, working out each feed's unread count from its entries", async () => {
    const { api } = backend();
    const store = createFeedsStore(api);

    await store.load();
    await store.load();

    expect(api.listFeeds).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(store.getSnapshot().feeds.map((f) => f.unread)).toEqual([2, 1]);
  });

  it("reports a failed load, and tries again on the next", async () => {
    const { api } = backend();
    api.listFeeds.mockRejectedValueOnce(new Error("Disk is full."));
    const store = createFeedsStore(api);

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", error: "Disk is full." });

    await store.load();
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("reloads what the app fetched in the background, and keeps what it shows if that fails", async () => {
    const { api, data } = backend();
    const store = createFeedsStore(api);
    await store.load();

    data.entries = [...data.entries, entry(4, 2)];
    await store.reload();
    expect(store.getSnapshot().feeds.map((f) => f.unread)).toEqual([2, 2]);

    api.listFeeds.mockRejectedValueOnce(new Error("x"));
    await store.reload();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(store.getSnapshot().entries).toHaveLength(4);
  });

  describe("subscribing", () => {
    it("refuses a bad address, and one already subscribed to, without asking the backend", async () => {
      const { api } = backend();
      const store = createFeedsStore(api);
      await store.load();

      expect((await store.addFeed("javascript:alert(1)")).error).toMatch(/web addresses/);
      expect(await store.addFeed("f1.example/feed")).toEqual({ error: "You are already subscribed to that feed: Feed 1.", existingId: 1 });
      expect(api.subscribeFeed).not.toHaveBeenCalled();
    });

    it("adds the feed and its entries, and says while it is fetching", async () => {
      const { api } = backend();
      const store = createFeedsStore(api);
      await store.load();
      const seen: boolean[] = [];
      store.subscribe(() => seen.push(store.getSnapshot().subscribing));

      const result = await store.addFeed("example.com/rss");

      expect(result.feed).toMatchObject({ id: 7, url: "https://example.com/rss" });
      expect(seen[0]).toBe(true);
      expect(store.getSnapshot()).toMatchObject({ subscribing: false, error: null });
      expect(store.getSnapshot().feeds.map((f) => [f.id, f.unread])).toEqual([[1, 2], [2, 1], [7, 1]]);
    });

    it("hands the reason to the caller when the feed cannot be read, and changes nothing", async () => {
      const { api } = backend();
      api.subscribeFeed.mockRejectedValueOnce(new Error("That address is not an RSS or Atom feed."));
      const store = createFeedsStore(api);
      await store.load();

      expect(await store.addFeed("example.com/page")).toEqual({ error: "That address is not an RSS or Atom feed." });
      expect(store.getSnapshot()).toMatchObject({ subscribing: false, error: null });
      expect(store.getSnapshot().feeds).toHaveLength(2);
    });
  });

  describe("unsubscribing", () => {
    it("removes the feed and its entries at once, and sends it", async () => {
      const { api } = backend();
      const store = createFeedsStore(api);
      await store.load();

      const done = store.removeFeed(1);
      expect(store.getSnapshot().feeds.map((f) => f.id)).toEqual([2]);
      expect(store.getSnapshot().entries.map((e) => e.feedId)).toEqual([2]);
      await done;

      expect(api.unsubscribeFeed).toHaveBeenCalledWith(1);
    });

    it("puts everything back and says why when the backend refuses", async () => {
      const { api } = backend();
      api.unsubscribeFeed.mockRejectedValueOnce(new Error("Disk is full."));
      const store = createFeedsStore(api);
      await store.load();

      expect(await store.removeFeed(1)).toEqual({ error: "Disk is full." });

      expect(store.getSnapshot().feeds.map((f) => f.id)).toEqual([1, 2]);
      expect(store.getSnapshot()).toMatchObject({ error: "Disk is full." });
    });
  });

  describe("reading", () => {
    it("marks an entry read at once, which lowers its feed's count", async () => {
      const { api } = backend();
      const store = createFeedsStore(api);
      await store.load();

      const done = store.setEntryRead(1, true);
      expect(store.getSnapshot().feeds[0].unread).toBe(1);
      await done;

      expect(api.setFeedEntryRead).toHaveBeenCalledWith(1, true);
    });

    it("marks one feed's entries read, or all", async () => {
      const { api } = backend();
      const store = createFeedsStore(api);
      await store.load();

      await store.markRead(1);
      expect(store.getSnapshot().feeds.map((f) => f.unread)).toEqual([0, 1]);
      await store.markRead(null);
      expect(store.getSnapshot().feeds.map((f) => f.unread)).toEqual([0, 0]);
      expect(api.markFeedRead).toHaveBeenNthCalledWith(1, 1);
      expect(api.markFeedRead).toHaveBeenNthCalledWith(2, null);
    });

    it("puts the read mark back when the backend refuses", async () => {
      const { api } = backend();
      api.setFeedEntryRead.mockRejectedValueOnce(new Error("That entry is no longer there."));
      const store = createFeedsStore(api);
      await store.load();

      await store.setEntryRead(1, true);

      expect(store.getSnapshot().feeds[0].unread).toBe(2);
      expect(store.getSnapshot().error).toBe("That entry is no longer there.");
    });
  });

  describe("refreshing", () => {
    it("marks the feed as being fetched, then shows what came of it", async () => {
      const { api, data } = backend();
      const store = createFeedsStore(api);
      await store.load();
      const during: number[][] = [];
      store.subscribe(() => during.push(store.getSnapshot().refreshing));
      api.refreshFeed.mockImplementationOnce(async (id) => {
        data.entries = [...data.entries, entry(4, 2)];
        return data.feeds.find((f) => f.id === id)!;
      });

      await store.refresh(2);

      expect(during[0]).toEqual([2]);
      expect(store.getSnapshot().refreshing).toEqual([]);
      expect(store.getSnapshot().feeds[1].unread).toBe(2);
    });

    it("does not start a second fetch of a feed already being fetched", async () => {
      const { api } = backend();
      let release: () => void = () => {};
      api.refreshFeed.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(feed(1)))));
      const store = createFeedsStore(api);
      await store.load();

      const first = store.refresh(1);
      await store.refresh(1);
      release();
      await first;

      expect(api.refreshFeed).toHaveBeenCalledTimes(1);
    });

    it("refreshes every feed", async () => {
      const { api } = backend();
      const store = createFeedsStore(api);
      await store.load();

      await store.refreshAll();

      expect(api.refreshAllFeeds).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().refreshing).toEqual([]);
    });

    it("says why when the plugin is off", async () => {
      const { api } = backend();
      api.refreshAllFeeds.mockRejectedValueOnce(new Error("The RSS Reader plugin is turned off."));
      const store = createFeedsStore(api);
      await store.load();

      expect((await store.refreshAll()).error).toMatch(/turned off/);
      expect(store.getSnapshot().refreshing).toEqual([]);
    });
  });

  it("reports that it is unavailable where there is no backend", async () => {
    const store = createFeedsStore(unavailableFeeds);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", error: "The RSS Reader is only available in the desktop app." });
  });
});
