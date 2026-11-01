import { feedLabel, normalizeFeedUrl } from "./feeds";
import type { Feed, FeedEntry, FeedsApi } from "./feedsApi";

/** What the store reaches outside for: the RSS Reader's backend. */
export type FeedsDeps = FeedsApi;

export type FeedsSnapshot = {
  /** `idle` until the first `load`; `error` if that failed (the feeds are then unknown, not empty). */
  status: "idle" | "loading" | "ready" | "error";
  feeds: Feed[];
  /** The entries of every feed, newest first. The panels pick out the ones they show. */
  entries: FeedEntry[];
  /** The feeds being fetched now. */
  refreshing: number[];
  /** Whether a subscription is being fetched (it can take a few seconds, since the feed is read before it is kept). */
  subscribing: boolean;
  /** Why the last load or change failed, until the next one succeeds. */
  error: string | null;
};

/** What a change that can be refused reports: the reason, or nothing when it went through. A feed already subscribed to also says which. */
export type FeedResult = { error?: string; existingId?: number };

export type FeedsStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FeedsSnapshot;
  /** Reads the feeds and entries. Does nothing once they are loaded (or while they load); after a failure it tries again. */
  load(): Promise<void>;
  /** Reads them again whatever the state, because the app may have fetched in the background. Keeps showing what it has meanwhile. */
  reload(): Promise<void>;
  /** Fetches the address and, if it is a feed, subscribes; `feed` is the new subscription. A bad address, a page that is not a feed, or a feed already subscribed to (then `existingId`) is refused. */
  addFeed(url: string): Promise<FeedResult & { feed?: Feed }>;
  /** Removes the feed and its entries at once, for good. */
  removeFeed(id: number): Promise<FeedResult>;
  /** Fetches one feed again. A failure to fetch shows on the feed (`lastError`); it is not a refusal. */
  refresh(id: number): Promise<FeedResult>;
  refreshAll(): Promise<FeedResult>;
  /** Shows the change at once. */
  setEntryRead(id: number, read: boolean): Promise<FeedResult>;
  /** Marks every entry of the feed read at once, or of every feed when `feedId` is null. */
  markRead(feedId: number | null): Promise<FeedResult>;
};

export const NO_FEEDS: FeedsSnapshot = { status: "idle", feeds: [], entries: [], refreshing: [], subscribing: false, error: null };

const reason = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/** The feeds with their unread counts worked out from the entries, so a change to an entry shows in the count at once. */
function withUnread(feeds: readonly Feed[], entries: readonly FeedEntry[]): Feed[] {
  const unread = new Map<number, number>();
  for (const entry of entries) if (!entry.read) unread.set(entry.feedId, (unread.get(entry.feedId) ?? 0) + 1);
  return feeds.map((feed) => ({ ...feed, unread: unread.get(feed.id) ?? 0 }));
}

/**
 * The RSS Reader's feeds and entries, with no React in it, so every panel showing them (in any window) sees the same ones. A
 * change shows at once and is sent to the backend; if the backend refuses it, everything is read again so the screen shows
 * what is really stored.
 */
export function createFeedsStore(deps: FeedsDeps): FeedsStore {
  let state: FeedsSnapshot = NO_FEEDS;
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  function set(next: Partial<FeedsSnapshot>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  /** Puts in what the backend has now. */
  async function read(): Promise<void> {
    const [feeds, entries] = await Promise.all([deps.listFeeds(), deps.listFeedEntries(null)]);
    set({ status: "ready", feeds: withUnread(feeds, entries), entries, error: null });
  }

  function load(): Promise<void> {
    if (state.status === "ready") return Promise.resolve();
    if (loading) return loading;
    set({ status: "loading", error: null });
    loading = read()
      .catch((error) => set({ status: "error", error: reason(error) }))
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  async function reload(): Promise<void> {
    if (state.status !== "ready") return load();
    try {
      await read();
    } catch {
      // What is shown is still right as far as it goes; the next change or reload tries again.
    }
  }

  /** A change the backend turned down (or failed): shows why, and puts back what is really stored. */
  async function undo(error: unknown): Promise<FeedResult> {
    const message = reason(error);
    try {
      await read();
      set({ error: message });
    } catch {
      set({ error: message });
    }
    return { error: message };
  }

  const setEntries = (entries: FeedEntry[], extra: Partial<FeedsSnapshot> = {}) => set({ entries, feeds: withUnread(state.feeds, entries), ...extra });

  async function addFeed(input: string) {
    const { url, error } = normalizeFeedUrl(input);
    if (error !== undefined) return { error };
    const existing = state.feeds.find((f) => f.url === url);
    if (existing) return { error: `You are already subscribed to that feed: ${feedLabel(existing)}.`, existingId: existing.id };
    set({ subscribing: true, error: null });
    try {
      const feed = await deps.subscribeFeed(url);
      // The new feed's entries came with it; read them rather than guess.
      const entries = await deps.listFeedEntries(null);
      set({ subscribing: false, feeds: withUnread([...state.feeds.filter((f) => f.id !== feed.id), feed], entries), entries });
      return { feed };
    } catch (failure) {
      // Nothing was stored, so there is nothing to put back; the reason is for the box that asked, not the whole panel.
      set({ subscribing: false });
      return { error: reason(failure) };
    }
  }

  async function removeFeed(id: number): Promise<FeedResult> {
    set({ feeds: state.feeds.filter((f) => f.id !== id), entries: state.entries.filter((e) => e.feedId !== id), error: null });
    try {
      await deps.unsubscribeFeed(id);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function refresh(id: number): Promise<FeedResult> {
    if (state.refreshing.includes(id)) return {};
    set({ refreshing: [...state.refreshing, id], error: null });
    try {
      await deps.refreshFeed(id);
      await read();
      return {};
    } catch (error) {
      return undo(error);
    } finally {
      set({ refreshing: state.refreshing.filter((r) => r !== id) });
    }
  }

  async function refreshAll(): Promise<FeedResult> {
    const ids = state.feeds.map((f) => f.id);
    set({ refreshing: ids, error: null });
    try {
      await deps.refreshAllFeeds();
      await read();
      return {};
    } catch (error) {
      return undo(error);
    } finally {
      set({ refreshing: [] });
    }
  }

  async function setEntryRead(id: number, read: boolean): Promise<FeedResult> {
    setEntries(state.entries.map((e) => (e.id === id ? { ...e, read } : e)), { error: null });
    try {
      await deps.setFeedEntryRead(id, read);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function markRead(feedId: number | null): Promise<FeedResult> {
    setEntries(state.entries.map((e) => (feedId === null || e.feedId === feedId ? { ...e, read: true } : e)), { error: null });
    try {
      await deps.markFeedRead(feedId);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    load,
    reload,
    addFeed,
    removeFeed,
    refresh,
    refreshAll,
    setEntryRead,
    markRead,
  };
}

const UNAVAILABLE = "The RSS Reader is only available in the desktop app.";

/** For a workspace with no RSS Reader backend (the web app has no RSS panel): loading it reports that. */
export const unavailableFeeds: FeedsDeps = {
  listFeeds: () => Promise.reject(new Error(UNAVAILABLE)),
  subscribeFeed: () => Promise.reject(new Error(UNAVAILABLE)),
  unsubscribeFeed: () => Promise.reject(new Error(UNAVAILABLE)),
  listFeedEntries: () => Promise.reject(new Error(UNAVAILABLE)),
  refreshFeed: () => Promise.reject(new Error(UNAVAILABLE)),
  refreshAllFeeds: () => Promise.reject(new Error(UNAVAILABLE)),
  setFeedEntryRead: () => Promise.reject(new Error(UNAVAILABLE)),
  markFeedRead: () => Promise.reject(new Error(UNAVAILABLE)),
};
