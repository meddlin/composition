// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Feed, FeedEntry, FeedsApi } from "@/lib/composition/feedsApi";
import { createFeedsStore } from "@/lib/composition/feedsStore";
import { createPluginsStore } from "@/lib/composition/pluginsStore";
import { createReadingListStore } from "@/lib/composition/readingListStore";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { KINDS, type RssPanelState } from "./kinds";
import { RssPanel, RSS_SIDE_BY_SIDE_MIN_WIDTH } from "./RssPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does no layout, so the width the panel measures is whatever the test says.
let containerWidth = 1000;
beforeEach(() => {
  containerWidth = 1000;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: containerWidth, height: 600, x: 0, y: 0, top: 0, left: 0, right: containerWidth, bottom: 600, toJSON() {} }));
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const justNow = () => new Date().toISOString();
const feed = (id: number, over: Partial<Feed> = {}): Feed => ({ id, url: `https://f${id}.example/feed`, title: `Feed ${id}`, siteUrl: `https://f${id}.example/`, lastFetchedAt: justNow(), lastError: "", unread: 0, createdAt: "", ...over });
const entry = (id: number, feedId: number, over: Partial<FeedEntry> = {}): FeedEntry => ({
  id,
  feedId,
  url: `https://f${feedId}.example/${id}`,
  title: `Entry ${id}`,
  summary: `About entry ${id}`,
  publishedAt: `2026-10-${String(10 + id).padStart(2, "0")}T00:00:00.000Z`,
  read: false,
  ...over,
});

/** A backend that keeps its feeds and entries in memory. */
function backend(initial: { feeds?: Feed[]; entries?: FeedEntry[] } = {}) {
  const data = { feeds: [...(initial.feeds ?? [])], entries: [...(initial.entries ?? [])] };
  const api = {
    listFeeds: vi.fn(async () => data.feeds),
    listFeedEntries: vi.fn(async (feedId: number | null) => data.entries.filter((e) => feedId === null || e.feedId === feedId).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))),
    subscribeFeed: vi.fn(async (url: string) => {
      const added = feed(50, { url, title: "Fresh feed" });
      data.feeds = [...data.feeds, added];
      data.entries = [...data.entries, entry(90, 50)];
      return added;
    }),
    unsubscribeFeed: vi.fn(async (id: number) => {
      data.feeds = data.feeds.filter((f) => f.id !== id);
      data.entries = data.entries.filter((e) => e.feedId !== id);
    }),
    refreshFeed: vi.fn(async (id: number) => data.feeds.find((f) => f.id === id)!),
    refreshAllFeeds: vi.fn(async () => data.feeds),
    setFeedEntryRead: vi.fn(async (id: number, read: boolean) => {
      data.entries = data.entries.map((e) => (e.id === id ? { ...e, read } : e));
      return data.entries.find((e) => e.id === id)!;
    }),
    markFeedRead: vi.fn(async (feedId: number | null) => {
      data.entries = data.entries.map((e) => (feedId === null || e.feedId === feedId ? { ...e, read: true } : e));
    }),
  } satisfies FeedsApi;
  return api;
}

function setup(
  initial: { feeds?: Feed[]; entries?: FeedEntry[] } = {},
  start: RssPanelState = { selectedFeedId: null, selectedEntryId: null },
  { readingListOn = true }: { readingListOn?: boolean } = {},
) {
  const api = backend(initial);
  const readingListApi = {
    listReadingItems: vi.fn(async () => []),
    addReadingItem: vi.fn(async (url: string) => ({ id: 1, url, title: "", read: false, createdAt: "", updatedAt: "" })),
    setReadingItemTitle: vi.fn(),
    setReadingItemRead: vi.fn(),
    deleteReadingItem: vi.fn(),
    clearReadingData: vi.fn(),
  };
  const feeds = createFeedsStore(api);
  const readingList = createReadingListStore(readingListApi);
  const plugins = createPluginsStore({ savePluginSettings: vi.fn(async () => ({})) }, { todo: true, "reading-list": readingListOn, rss: true, contacts: true });
  let state = start;
  const setPanelState = vi.fn((_id: string, next: unknown) => {
    state = next as RssPanelState;
    view.rerender(<RssPanel store={store} panelId="p1" state={state} />);
  });
  const store = { feeds, readingList, plugins, setPanelState } as unknown as WorkspaceStore;
  const view = render(<RssPanel store={store} panelId="p1" state={state} />);
  return { api, readingListApi, setPanelState, feeds };
}

const paste = (value: string) => {
  const box = screen.getByRole("textbox", { name: "Add a feed" });
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: "Enter" });
};

const entryNames = () => within(screen.getByRole("list", { name: "Entries" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

const two = () =>
  setup({
    feeds: [feed(1, { title: "Alpha", unread: 2 }), feed(2, { title: "Beta", unread: 1 })],
    entries: [entry(1, 1), entry(2, 1), entry(3, 2)],
  });

describe("the RSS Reader panel", () => {
  it("says so when there are no feeds yet", async () => {
    setup();
    expect(await screen.findByText(/No feeds yet/)).toBeTruthy();
    expect(screen.getByText(/Subscribe to a feed to see its entries here/)).toBeTruthy();
  });

  it("lists the feeds with their unread counts, and every entry newest first with the feed it came from", async () => {
    two();

    expect(await screen.findByRole("button", { name: "Alpha, 2 unread" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Beta, 1 unread" })).toBeTruthy();
    expect(entryNames()).toEqual(["Entry 3", "Entry 2", "Entry 1"]);
    expect(within(screen.getByRole("list", { name: "Entries" })).getAllByText(/Beta|Alpha/).length).toBe(3);
  });

  it("shows only the picked feed's entries and remembers the pick", async () => {
    const { setPanelState } = two();

    fireEvent.click(await screen.findByRole("button", { name: "Alpha, 2 unread" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { selectedFeedId: 1, selectedEntryId: null });
    expect(entryNames()).toEqual(["Entry 2", "Entry 1"]);
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
  });

  it("falls back to every entry when the saved feed is gone", async () => {
    setup({ feeds: [feed(1, { title: "Alpha", unread: 1 })], entries: [entry(1, 1)] }, { selectedFeedId: 99, selectedEntryId: 5 });

    expect(await screen.findByRole("heading", { name: "All entries" })).toBeTruthy();
    expect(entryNames()).toEqual(["Entry 1"]);
  });

  it("shows why a feed could not be fetched, and keeps its old entries", async () => {
    setup({ feeds: [feed(1, { title: "Alpha", lastError: "The server answered 500." })], entries: [entry(1, 1)] }, { selectedFeedId: 1, selectedEntryId: null });

    expect((await screen.findByRole("alert")).textContent).toMatch(/The server answered 500/);
    expect(entryNames()).toEqual(["Entry 1"]);
    expect(screen.getByRole("button", { name: /^Alpha.*could not be fetched/ })).toBeTruthy();
  });

  describe("subscribing", () => {
    it("adds a feed, clears the box and opens the feed", async () => {
      const { api, setPanelState } = setup();
      await screen.findByText(/No feeds yet/);

      paste("www.example.com/rss");

      expect(await screen.findByRole("button", { name: "Fresh feed, 1 unread" })).toBeTruthy();
      expect(api.subscribeFeed).toHaveBeenCalledWith("https://www.example.com/rss");
      expect((screen.getByRole("textbox", { name: "Add a feed" }) as HTMLInputElement).value).toBe("");
      expect(setPanelState).toHaveBeenCalledWith("p1", { selectedFeedId: 50, selectedEntryId: null });
    });

    it("keeps what was typed and says why when the address is not a web address", async () => {
      const { api } = setup();
      await screen.findByText(/No feeds yet/);

      paste("javascript:alert(1)");

      expect((await screen.findByRole("alert")).textContent).toMatch(/web addresses/);
      expect((screen.getByRole("textbox", { name: "Add a feed" }) as HTMLInputElement).value).toBe("javascript:alert(1)");
      expect(api.subscribeFeed).not.toHaveBeenCalled();
    });

    it("keeps what was typed and says why when the page is not a feed", async () => {
      const { api } = setup();
      api.subscribeFeed.mockRejectedValueOnce(new Error("That address is not an RSS or Atom feed."));
      await screen.findByText(/No feeds yet/);

      paste("example.com/about");

      expect((await screen.findByRole("alert")).textContent).toMatch(/not an RSS or Atom feed/);
      expect((screen.getByRole("textbox", { name: "Add a feed" }) as HTMLInputElement).value).toBe("example.com/about");
    });

    it("shows the feed that is already there instead of subscribing twice", async () => {
      const { api, setPanelState } = setup({ feeds: [feed(1, { title: "Alpha" })] });
      await screen.findByRole("button", { name: "Alpha" });

      paste("f1.example/feed");

      expect((await screen.findByRole("alert")).textContent).toMatch(/already subscribed to that feed: Alpha/);
      expect(api.subscribeFeed).not.toHaveBeenCalled();
      expect(setPanelState).toHaveBeenCalledWith("p1", { selectedFeedId: 1, selectedEntryId: null });
    });
  });

  describe("unsubscribing", () => {
    async function openRowMenu(name: string) {
      const options = await screen.findByRole("button", { name: `Options for ${name}` });
      fireEvent.pointerDown(options, { button: 0, ctrlKey: false });
      fireEvent.click(options);
      return screen.findByRole("menuitem", { name: /Unsubscribe/ });
    }

    it("asks first, names the feed, and sends nothing until it is confirmed", async () => {
      const { api } = two();

      fireEvent.click(await openRowMenu("Alpha"));

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toMatch(/Alpha/);
      expect(dialog.textContent).toMatch(/not sent to the Trash Can/);
      expect(api.unsubscribeFeed).not.toHaveBeenCalled();
      // A stray Enter backs out: Cancel holds the focus.
      expect(document.activeElement?.textContent).toBe("Cancel");
    });

    it("unsubscribes from nothing on Cancel", async () => {
      const { api } = two();
      fireEvent.click(await openRowMenu("Alpha"));

      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(api.unsubscribeFeed).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Alpha, 2 unread" })).toBeTruthy();
    });

    it("unsubscribes from nothing on Escape", async () => {
      const { api } = two();
      fireEvent.click(await openRowMenu("Alpha"));
      await screen.findByRole("alertdialog");

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(api.unsubscribeFeed).not.toHaveBeenCalled();
    });

    it("removes the feed and its entries only when confirmed, and the panel goes back to all entries", async () => {
      const { api, setPanelState } = setup(
        { feeds: [feed(1, { title: "Alpha", unread: 2 }), feed(2, { title: "Beta", unread: 1 })], entries: [entry(1, 1), entry(2, 1), entry(3, 2)] },
        { selectedFeedId: 1, selectedEntryId: null },
      );
      fireEvent.click(await openRowMenu("Alpha"));

      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unsubscribe" }));

      await waitFor(() => expect(api.unsubscribeFeed).toHaveBeenCalledWith(1));
      await waitFor(() => expect(screen.queryByRole("button", { name: /^Alpha/ })).toBeNull());
      expect(setPanelState).toHaveBeenCalledWith("p1", { selectedFeedId: null, selectedEntryId: null });
      expect(entryNames()).toEqual(["Entry 3"]);
    });
  });

  describe("reading an entry", () => {
    it("shows its excerpt, and marking it read lowers the count", async () => {
      const { api } = two();
      fireEvent.click(await screen.findByRole("button", { name: "Entry 3" }));
      // The panel remembers the entry it has open; the test's stand-in store has already re-rendered with it.
      const detail = await screen.findByRole("region", { name: "Entry" });
      expect(detail.textContent).toMatch(/About entry 3/);

      fireEvent.click(within(detail).getByRole("button", { name: /Mark read/ }));

      await waitFor(() => expect(api.setFeedEntryRead).toHaveBeenCalledWith(3, true));
      expect(await screen.findByRole("button", { name: "Beta" })).toBeTruthy();
    });

    it("opens the entry in the browser and counts that as reading it", async () => {
      const { api } = two();
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      fireEvent.click(await screen.findByRole("button", { name: "Entry 3" }));

      fireEvent.click(within(await screen.findByRole("region", { name: "Entry" })).getByRole("button", { name: /Open in browser/ }));

      expect(open).toHaveBeenCalledWith("https://f2.example/3", "_blank", "noopener");
      await waitFor(() => expect(api.setFeedEntryRead).toHaveBeenCalledWith(3, true));
    });

    it("sends the entry's link to the Reading List when that plugin is on", async () => {
      const { readingListApi } = two();
      fireEvent.click(await screen.findByRole("button", { name: "Entry 3" }));

      fireEvent.click(within(await screen.findByRole("region", { name: "Entry" })).getByRole("button", { name: /Send to Reading List/ }));

      await waitFor(() => expect(readingListApi.addReadingItem).toHaveBeenCalledWith("https://f2.example/3"));
      expect((await screen.findByRole("status")).textContent).toMatch(/Added to your Reading List/);
    });

    it("does not offer the Reading List when that plugin is off", async () => {
      setup({ feeds: [feed(1)], entries: [entry(1, 1)] }, { selectedFeedId: null, selectedEntryId: 1 }, { readingListOn: false });

      const detail = await screen.findByRole("region", { name: "Entry" });

      expect(within(detail).queryByRole("button", { name: /Send to Reading List/ })).toBeNull();
    });

    it("never shows an entry's markup as anything but text, and has no link to open when the feed gave none", async () => {
      setup(
        { feeds: [feed(1)], entries: [entry(1, 1, { url: "", summary: "<img src=x onerror=alert(1)>" })] },
        { selectedFeedId: null, selectedEntryId: 1 },
      );

      const detail = await screen.findByRole("region", { name: "Entry" });

      expect(detail.querySelector("img")).toBeNull();
      expect((within(detail).getByRole("button", { name: /Open in browser/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("marks every entry of a feed read", async () => {
      const { api } = two();
      fireEvent.click(await screen.findByRole("button", { name: "Alpha, 2 unread" }));

      fireEvent.click(screen.getByRole("button", { name: /Mark all read/ }));

      await waitFor(() => expect(api.markFeedRead).toHaveBeenCalledWith(1));
      expect(await screen.findByRole("button", { name: "Alpha" })).toBeTruthy();
    });
  });

  describe("refreshing", () => {
    it("fetches the feeds on opening when one has not been fetched lately", async () => {
      const { api } = setup({ feeds: [feed(1, { lastFetchedAt: null })], entries: [] });

      await waitFor(() => expect(api.refreshAllFeeds).toHaveBeenCalledTimes(1));
    });

    it("does not fetch on opening when every feed is fresh", async () => {
      const { api } = setup({ feeds: [feed(1)], entries: [] });
      await screen.findByRole("button", { name: "Feed 1" });

      expect(api.refreshAllFeeds).not.toHaveBeenCalled();
    });

    it("refreshes the picked feed by hand", async () => {
      const { api } = two();
      fireEvent.click(await screen.findByRole("button", { name: "Beta, 1 unread" }));

      fireEvent.click(screen.getByRole("button", { name: /^Refresh/ }));

      await waitFor(() => expect(api.refreshFeed).toHaveBeenCalledWith(2));
    });

    it("reads the feeds again when the window regains focus, in case the app fetched meanwhile", async () => {
      const { api } = two();
      await screen.findByRole("button", { name: "Alpha, 2 unread" });
      const before = api.listFeeds.mock.calls.length;

      act(() => void window.dispatchEvent(new Event("focus")));

      await waitFor(() => expect(api.listFeeds.mock.calls.length).toBeGreaterThan(before));
    });
  });

  describe("in a narrow panel", () => {
    it("shows the feeds, then the entries, then one entry, with a way back at each step", async () => {
      containerWidth = RSS_SIDE_BY_SIDE_MIN_WIDTH - 1;
      two();

      fireEvent.click(await screen.findByRole("button", { name: "Alpha, 2 unread" }));
      expect(screen.queryByRole("textbox", { name: "Add a feed" })).toBeNull();
      fireEvent.click(await screen.findByRole("button", { name: "Entry 2" }));
      expect(await screen.findByRole("region", { name: "Entry" })).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Entries" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /Back to entries/ }));
      expect(await screen.findByRole("list", { name: "Entries" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /Back to feeds/ }));
      expect(await screen.findByRole("textbox", { name: "Add a feed" })).toBeTruthy();
    });
  });
});

describe("the RSS Reader panel kind", () => {
  it("belongs to the rss plugin and starts on all entries", () => {
    expect(KINDS.rss.plugin).toBe("rss");
    expect(KINDS.rss.initialState()).toEqual({ selectedFeedId: null, selectedEntryId: null });
  });

  it("reads back what it saved, and starts over from anything else", () => {
    const context = { hasNote: () => false, hasNotebook: () => false };
    expect(KINDS.rss.restore({ selectedFeedId: 3, selectedEntryId: 9 }, context)).toEqual({ selectedFeedId: 3, selectedEntryId: 9 });
    expect(KINDS.rss.restore({ selectedFeedId: "3", selectedEntryId: 1.5 }, context)).toEqual({ selectedFeedId: null, selectedEntryId: null });
    expect(KINDS.rss.restore({}, context)).toEqual({ selectedFeedId: null, selectedEntryId: null });
    expect(KINDS.rss.restore(null, context)).toBeNull();
    expect(KINDS.rss.restore("x", context)).toBeNull();
  });
});
