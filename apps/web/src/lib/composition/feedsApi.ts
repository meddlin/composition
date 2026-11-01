/**
 * What the RSS Reader panel exchanges with the backend. Types only, apart from FEED_METHODS and the limits, so it is safe
 * to import anywhere (renderer, preload, main). Desktop only, like the panel that shows it.
 */

/** The longest a feed address may be. The panel limits its input to this; the backend refuses more. */
export const MAX_FEED_URL_LENGTH = 2048;

/** The longest a stored title (of a feed or an entry) may be; a longer one is cut. */
export const MAX_FEED_TITLE_LENGTH = 300;

/** The longest an entry's excerpt may be; a longer one is cut. */
export const MAX_FEED_SUMMARY_LENGTH = 1000;

/** How many entries of a feed are kept besides the unread ones. */
export const MAX_FEED_ENTRIES = 200;

/** One feed the user is subscribed to. `title` is empty until the first fetch has said what it is called. */
export type Feed = {
  id: number;
  /** Always an absolute `http:` or `https:` address, as `normalizeFeedUrl` writes it. */
  url: string;
  title: string;
  /** The web page the feed is for; empty when the feed did not say, otherwise an `http(s)` address. */
  siteUrl: string;
  /** When the feed was last fetched without error; null before the first fetch. */
  lastFetchedAt: string | null;
  /** Why the last refresh failed; empty when it did not. */
  lastError: string;
  unread: number;
  createdAt: string;
};

/** One entry of a feed. `summary` is plain text, never markup. */
export type FeedEntry = {
  id: number;
  feedId: number;
  /** The entry's page: an `http(s)` address, or empty when the feed gave none. */
  url: string;
  title: string;
  summary: string;
  publishedAt: string;
  read: boolean;
};

export interface FeedsApi {
  /** Every feed, with its unread count, in the order they were subscribed to. */
  listFeeds(): Promise<Feed[]>;
  /** Fetches the feed, and subscribes only if it is one. Rejects a bad address, a duplicate, or a page that is not a feed. */
  subscribeFeed(url: string): Promise<Feed>;
  /** Removes the feed and all its entries, for good. One that is already gone is not an error. */
  unsubscribeFeed(id: number): Promise<void>;
  /** The newest entries first. `null` means the entries of every feed. */
  listFeedEntries(feedId: number | null): Promise<FeedEntry[]>;
  /** Fetches the feed again. A failure is recorded on the feed (`lastError`), not thrown; only a missing feed rejects. */
  refreshFeed(id: number): Promise<Feed>;
  /** Refreshes every feed, one at a time. */
  refreshAllFeeds(): Promise<Feed[]>;
  /** Marks an entry read or unread. Rejects a missing entry. */
  setFeedEntryRead(id: number, read: boolean): Promise<FeedEntry>;
  /** Marks every entry of the feed read, or of every feed when `feedId` is null. */
  markFeedRead(feedId: number | null): Promise<void>;
}

/** Every method of FeedsApi, as data, so the preload script and the main process can't drift from it. */
export const FEED_METHODS = [
  "listFeeds",
  "subscribeFeed",
  "unsubscribeFeed",
  "listFeedEntries",
  "refreshFeed",
  "refreshAllFeeds",
  "setFeedEntryRead",
  "markFeedRead",
] as const satisfies readonly (keyof FeedsApi)[];

export type FeedMethod = (typeof FEED_METHODS)[number];

type MissingFromFeedMethods = Exclude<keyof FeedsApi, FeedMethod>;
const _everyMethodListed: [MissingFromFeedMethods] extends [never] ? true : never = true;
void _everyMethodListed;
