import { feedLabel, limitParsedEntries, normalizeFeedUrl, type ParsedFeed } from "./feeds";
import type { Feed, FeedsApi } from "./feedsApi";
import * as feedsRepo from "./feedsRepo";

/**
 * The RSS Reader's subscriptions and entries, kept in the notes database. Nothing here touches the network: fetching and
 * parsing happen in the desktop app's main process, which hands the result to `subscribe` and `applyFetch`. So
 * `subscribeFeed`, `refreshFeed` and `refreshAllFeeds` are not here.
 */
export type FeedsService = Omit<FeedsApi, "subscribeFeed" | "refreshFeed" | "refreshAllFeeds">;

/** What a fetch of a feed came back with. */
export type FetchOutcome =
  | { kind: "ok"; feed: ParsedFeed; etag: string; lastModified: string }
  | { kind: "notModified" }
  | { kind: "error"; message: string };

export const listFeeds: FeedsService["listFeeds"] = async () => feedsRepo.listFeeds();

export const unsubscribeFeed: FeedsService["unsubscribeFeed"] = async (id) => {
  feedsRepo.deleteFeed(id);
};

export const listFeedEntries: FeedsService["listFeedEntries"] = async (feedId) => feedsRepo.listEntries(feedId);

export const setFeedEntryRead: FeedsService["setFeedEntryRead"] = async (id, read) => {
  const entry = feedsRepo.setEntryRead(id, read);
  if (!entry) throw new Error("That entry is no longer there.");
  return entry;
};

export const markFeedRead: FeedsService["markFeedRead"] = async (feedId) => {
  feedsRepo.markRead(feedId);
};

/** The address to fetch for a feed, with what the server told us last time; null when the feed is gone. */
export function getFetchState(id: number) {
  return feedsRepo.getFetchState(id);
}

/** Refuses an address that is not a feed address, or one already subscribed to; returns the address as it is stored. */
export function checkNewFeedUrl(input: string): string {
  const { url, error } = normalizeFeedUrl(input);
  if (error !== undefined) throw new Error(error);
  const existing = feedsRepo.findFeedByUrl(url);
  if (existing) throw new Error(`You are already subscribed to that feed: ${feedLabel(existing)}.`);
  return url;
}

/** Subscribes to a feed that has already been fetched and parsed, and stores its entries. */
export function subscribe(url: string, outcome: Extract<FetchOutcome, { kind: "ok" }>): Feed {
  checkNewFeedUrl(url);
  const feed = feedsRepo.addFeed(url);
  try {
    applyFetch(feed.id, outcome);
  } catch (error) {
    feedsRepo.deleteFeed(feed.id);
    throw error;
  }
  return feedsRepo.getFeed(feed.id) ?? feed;
}

/**
 * Stores what a fetch found. A good fetch updates the feed and its entries; "not modified" only counts as fetched; an
 * error is recorded on the feed and nothing else changes, so the entries already there stay. Does nothing for a feed that
 * was unsubscribed while the fetch was out. Returns the feed as it is now, or null if it is gone.
 */
export function applyFetch(id: number, outcome: FetchOutcome): Feed | null {
  if (!feedsRepo.getFeed(id)) return null;
  if (outcome.kind === "error") feedsRepo.recordError(id, outcome.message);
  else if (outcome.kind === "notModified") feedsRepo.recordNotModified(id);
  else {
    feedsRepo.upsertEntries(id, limitParsedEntries(outcome.feed.entries));
    feedsRepo.pruneEntries(id);
    feedsRepo.recordFetch(id, { title: outcome.feed.title, siteUrl: outcome.feed.siteUrl, etag: outcome.etag, lastModified: outcome.lastModified });
  }
  return feedsRepo.getFeed(id);
}
