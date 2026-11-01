import type { FeedsService, FetchOutcome } from "../../../web/src/lib/composition/feedsService";
import type { Feed, FeedsApi } from "../../../web/src/lib/composition/feedsApi";
import { FeedFetchError, type FeedValidators, type FetchedFeed } from "./feedFetcher";
import { NotAFeedError, parseFeedText } from "./feedParse";

/** The parts of the service the controller uses besides the plain methods it passes through. */
export type FeedsStore = FeedsService & {
  checkNewFeedUrl(input: string): string;
  subscribe(url: string, outcome: Extract<FetchOutcome, { kind: "ok" }>): Feed;
  applyFetch(id: number, outcome: FetchOutcome): Feed | null;
  getFetchState(id: number): ({ url: string } & FeedValidators) | null;
};

export type FeedsControllerDeps = {
  store: FeedsStore;
  fetchFeed: (url: string, validators: FeedValidators | null) => Promise<FetchedFeed>;
  /** Whether the RSS Reader plugin is on now. Read at each fetch, so turning it off takes effect at once. */
  pluginEnabled: () => boolean;
};

const OFF_MESSAGE = "The RSS Reader plugin is turned off. Turn it on in Settings > Plugins to fetch feeds.";

/** What goes on the feed when a refresh fails: the message of the errors that are fit to show, else a plain one. */
function messageFor(error: unknown): string {
  return error instanceof FeedFetchError || error instanceof NotAFeedError ? error.message : "Something went wrong reading that feed.";
}

/**
 * The RSS Reader's side of the bridge in the main process: the service's storage joined to the fetcher and the parser, and
 * the one place that checks the plugin is on before the network is touched. A refresh that fails is recorded on the feed and
 * not thrown (the panel shows it on the row); subscribing, which has no row yet, throws.
 */
export function createFeedsController({ store, fetchFeed, pluginEnabled }: FeedsControllerDeps): FeedsApi {
  /** One fetch per feed at a time: a second request for a feed already out joins it. */
  const inFlight = new Map<number, Promise<Feed>>();

  const requireOn = () => {
    if (!pluginEnabled()) throw new Error(OFF_MESSAGE);
  };

  async function fetchAndParse(url: string, validators: FeedValidators | null): Promise<FetchOutcome> {
    const fetched = await fetchFeed(url, validators);
    if (fetched.kind === "notModified") return { kind: "notModified" };
    return { kind: "ok", feed: parseFeedText(fetched.text), etag: fetched.etag, lastModified: fetched.lastModified };
  }

  async function refresh(id: number): Promise<Feed> {
    const state = store.getFetchState(id);
    if (!state) throw new Error("That feed is no longer there.");
    let outcome: FetchOutcome;
    try {
      outcome = await fetchAndParse(state.url, { etag: state.etag, lastModified: state.lastModified });
    } catch (error) {
      outcome = { kind: "error", message: messageFor(error) };
    }
    const feed = store.applyFetch(id, outcome);
    if (!feed) throw new Error("That feed is no longer there.");
    return feed;
  }

  return {
    listFeeds: store.listFeeds,
    unsubscribeFeed: store.unsubscribeFeed,
    listFeedEntries: store.listFeedEntries,
    setFeedEntryRead: store.setFeedEntryRead,
    markFeedRead: store.markFeedRead,

    async subscribeFeed(input) {
      requireOn();
      const url = store.checkNewFeedUrl(input);
      let outcome: FetchOutcome;
      try {
        outcome = await fetchAndParse(url, null);
      } catch (error) {
        throw new Error(messageFor(error));
      }
      if (outcome.kind !== "ok") throw new Error("That address did not send a feed.");
      return store.subscribe(url, outcome);
    },

    async refreshFeed(id) {
      requireOn();
      const running = inFlight.get(id);
      if (running) return running;
      const started = refresh(id).finally(() => inFlight.delete(id));
      inFlight.set(id, started);
      return started;
    },

    async refreshAllFeeds() {
      requireOn();
      for (const feed of await store.listFeeds()) {
        try {
          await this.refreshFeed(feed.id);
        } catch {
          // The feed was unsubscribed while the others were being fetched; the rest go on.
        }
      }
      return store.listFeeds();
    },
  };
}
