import { describe, expect, it, vi } from "vitest";
import type { Feed } from "../../../web/src/lib/composition/feedsApi";
import { FeedFetchError, type FetchedFeed } from "./feedFetcher";
import { createFeedsController, type FeedsStore } from "./feedsController";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title><link>https://ex.com/</link><item><title>One</title><link>https://ex.com/1</link><guid>g1</guid></item></channel></rss>`;
const ok = (text = RSS): FetchedFeed => ({ kind: "ok", text, etag: '"e"', lastModified: "" });
const feed = (id: number): Feed => ({ id, url: `https://f${id}.example/feed`, title: "", siteUrl: "", lastFetchedAt: null, lastError: "", unread: 0, createdAt: "" });

function setup(fetchFeed: (url: string) => Promise<FetchedFeed>, { on = true }: { on?: boolean } = {}) {
  const store = {
    listFeeds: vi.fn(async () => [feed(1), feed(2)]),
    unsubscribeFeed: vi.fn(),
    listFeedEntries: vi.fn(),
    setFeedEntryRead: vi.fn(),
    markFeedRead: vi.fn(),
    checkNewFeedUrl: vi.fn((input: string) => input),
    subscribe: vi.fn((url: string) => ({ ...feed(9), url })),
    applyFetch: vi.fn((id: number) => feed(id)),
    getFetchState: vi.fn((id: number) => ({ url: `https://f${id}.example/feed`, etag: '"old"', lastModified: "" })),
  };
  const state = { on };
  const controller = createFeedsController({ store: store as unknown as FeedsStore, fetchFeed: vi.fn(fetchFeed), pluginEnabled: () => state.on });
  return { store, controller, state };
}

describe("the feeds controller", () => {
  it("subscribes to a feed it could fetch and read", async () => {
    const { controller, store } = setup(async () => ok());

    const result = await controller.subscribeFeed("https://ex.com/feed");

    expect(result.url).toBe("https://ex.com/feed");
    expect(store.subscribe).toHaveBeenCalledWith("https://ex.com/feed", expect.objectContaining({ kind: "ok", etag: '"e"', feed: expect.objectContaining({ title: "Example" }) }));
  });

  it("does not subscribe to what is not a feed, and says why", async () => {
    const { controller, store } = setup(async () => ok("<html>hi</html>"));

    await expect(controller.subscribeFeed("https://ex.com/page")).rejects.toThrow("That address is not an RSS or Atom feed.");
    expect(store.subscribe).not.toHaveBeenCalled();
  });

  it("does not subscribe when the fetch is refused, and passes the reason on", async () => {
    const { controller, store } = setup(async () => {
      throw new FeedFetchError("The server answered 404.");
    });

    await expect(controller.subscribeFeed("https://ex.com/feed")).rejects.toThrow("The server answered 404.");
    expect(store.subscribe).not.toHaveBeenCalled();
  });

  it("does not show an unexpected error's details", async () => {
    const { controller } = setup(async () => {
      throw new Error("/Users/someone/secret/path exploded");
    });

    await expect(controller.subscribeFeed("https://ex.com/feed")).rejects.toThrow("Something went wrong reading that feed.");
  });

  it("refuses a duplicate or bad address before fetching", async () => {
    const fetchFeed = vi.fn(async () => ok());
    const { controller, store } = setup(fetchFeed);
    store.checkNewFeedUrl.mockImplementation(() => {
      throw new Error("You are already subscribed to that feed: Example.");
    });

    await expect(controller.subscribeFeed("https://ex.com/feed")).rejects.toThrow(/already subscribed/);
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it("refreshes with what the server said last time, and stores the entries", async () => {
    const seen: unknown[] = [];
    const { controller, store } = setup(async (url) => (seen.push(url), ok()));

    await controller.refreshFeed(1);

    expect(store.applyFetch).toHaveBeenCalledWith(1, expect.objectContaining({ kind: "ok" }));
    expect(seen).toEqual(["https://f1.example/feed"]);
  });

  it("records a failed refresh on the feed instead of throwing", async () => {
    const { controller, store } = setup(async () => {
      throw new FeedFetchError("The server took too long to answer.");
    });

    await expect(controller.refreshFeed(1)).resolves.toBeDefined();
    expect(store.applyFetch).toHaveBeenCalledWith(1, { kind: "error", message: "The server took too long to answer." });
  });

  it("records 'not modified' as such", async () => {
    const { controller, store } = setup(async () => ({ kind: "notModified" }));

    await controller.refreshFeed(1);

    expect(store.applyFetch).toHaveBeenCalledWith(1, { kind: "notModified" });
  });

  it("rejects a refresh of a feed that is gone", async () => {
    const { controller, store } = setup(async () => ok());
    store.getFetchState.mockReturnValue(null as never);

    await expect(controller.refreshFeed(5)).rejects.toThrow(/no longer there/);
  });

  it("lets a second request for a feed already being fetched join the first", async () => {
    let release: (value: FetchedFeed) => void = () => {};
    const fetchFeed = vi.fn(() => new Promise<FetchedFeed>((resolve) => (release = resolve)));
    const { controller } = setup(fetchFeed);

    const first = controller.refreshFeed(1);
    const second = controller.refreshFeed(1);
    release(ok());
    await Promise.all([first, second]);

    expect(fetchFeed).toHaveBeenCalledTimes(1);
  });

  it("refreshes every feed one after another, and goes on when one fails", async () => {
    const order: string[] = [];
    const { controller } = setup(async (url) => {
      order.push(url);
      if (url.includes("f1")) throw new FeedFetchError("down");
      return ok();
    });

    await controller.refreshAllFeeds();

    expect(order).toEqual(["https://f1.example/feed", "https://f2.example/feed"]);
  });

  describe("with the plugin off", () => {
    it("fetches nothing: not to subscribe, not to refresh", async () => {
      const fetchFeed = vi.fn(async () => ok());
      const { controller } = setup(fetchFeed, { on: false });

      await expect(controller.subscribeFeed("https://ex.com/feed")).rejects.toThrow(/turned off/);
      await expect(controller.refreshFeed(1)).rejects.toThrow(/turned off/);
      await expect(controller.refreshAllFeeds()).rejects.toThrow(/turned off/);
      expect(fetchFeed).not.toHaveBeenCalled();
    });

    it("still lets the stored feeds be read, and unsubscribed from", async () => {
      const { controller, store } = setup(async () => ok(), { on: false });

      await controller.listFeeds();
      await controller.unsubscribeFeed(1);

      expect(store.listFeeds).toHaveBeenCalled();
      expect(store.unsubscribeFeed).toHaveBeenCalledWith(1);
    });

    it("notices the plugin being turned off between calls", async () => {
      const fetchFeed = vi.fn(async () => ok());
      const { controller, state } = setup(fetchFeed);

      await controller.refreshFeed(1);
      state.on = false;
      await expect(controller.refreshFeed(1)).rejects.toThrow(/turned off/);
      expect(fetchFeed).toHaveBeenCalledTimes(1);
    });
  });
});
