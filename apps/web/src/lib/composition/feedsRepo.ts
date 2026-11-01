import { getDb } from "./db";
import type { ParsedEntry } from "./feeds";
import { MAX_FEED_ENTRIES, type Feed, type FeedEntry } from "./feedsApi";

type FeedRow = {
  id: number;
  url: string;
  title: string;
  site_url: string;
  etag: string;
  last_modified: string;
  last_fetched_at: string | null;
  last_error: string;
  created_at: string;
  unread: number;
};

type EntryRow = {
  id: number;
  feed_id: number;
  url: string;
  title: string;
  summary: string;
  published_at: string;
  read: number;
};

const FEED_SELECT = `SELECT feeds.*, (SELECT COUNT(*) FROM feed_items WHERE feed_items.feed_id = feeds.id AND feed_items.read = 0) AS unread FROM feeds`;

function feedFromRow(row: FeedRow): Feed {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    siteUrl: row.site_url,
    lastFetchedAt: row.last_fetched_at,
    lastError: row.last_error,
    unread: row.unread,
    createdAt: row.created_at,
  };
}

function entryFromRow(row: EntryRow): FeedEntry {
  return { id: row.id, feedId: row.feed_id, url: row.url, title: row.title, summary: row.summary, publishedAt: row.published_at, read: row.read === 1 };
}

export function listFeeds(): Feed[] {
  return (getDb().prepare(`${FEED_SELECT} ORDER BY feeds.id`).all() as FeedRow[]).map(feedFromRow);
}

export function getFeed(id: number): Feed | null {
  const row = getDb().prepare(`${FEED_SELECT} WHERE feeds.id = ?`).get(id) as FeedRow | undefined;
  return row ? feedFromRow(row) : null;
}

export function findFeedByUrl(url: string): Feed | null {
  const row = getDb().prepare(`${FEED_SELECT} WHERE feeds.url = ?`).get(url) as FeedRow | undefined;
  return row ? feedFromRow(row) : null;
}

/** What a conditional request needs: the address and the validators the server gave last time. Null when the feed is gone. */
export function getFetchState(id: number): { url: string; etag: string; lastModified: string } | null {
  const row = getDb().prepare("SELECT url, etag, last_modified FROM feeds WHERE id = ?").get(id) as { url: string; etag: string; last_modified: string } | undefined;
  return row ? { url: row.url, etag: row.etag, lastModified: row.last_modified } : null;
}

export function addFeed(url: string): Feed {
  const result = getDb().prepare("INSERT INTO feeds (url, created_at) VALUES (?, ?)").run(url, new Date().toISOString());
  const feed = getFeed(Number(result.lastInsertRowid));
  if (!feed) throw new Error("Failed to read back the feed that was just added");
  return feed;
}

/** Removes the feed and its entries together, so no entry is left behind. */
export function deleteFeed(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM feed_items WHERE feed_id = ?").run(id);
    db.prepare("DELETE FROM feeds WHERE id = ?").run(id);
  })();
}

/** Records a good fetch: the feed's own details, the validators for next time, and no error. */
export function recordFetch(id: number, details: { title: string; siteUrl: string; etag: string; lastModified: string }): void {
  getDb()
    .prepare("UPDATE feeds SET title = ?, site_url = ?, etag = ?, last_modified = ?, last_fetched_at = ?, last_error = '' WHERE id = ?")
    .run(details.title, details.siteUrl, details.etag, details.lastModified, new Date().toISOString(), id);
}

/** Records a fetch that found nothing new (the server said "not modified"): counts as fetched, clears the error. */
export function recordNotModified(id: number): void {
  getDb().prepare("UPDATE feeds SET last_fetched_at = ?, last_error = '' WHERE id = ?").run(new Date().toISOString(), id);
}

export function recordError(id: number, message: string): void {
  getDb().prepare("UPDATE feeds SET last_error = ? WHERE id = ?").run(message, id);
}

/**
 * Adds the entries a fetch found and updates those it already knew (title, excerpt, link), keeping whether they were read and
 * when they were first dated. An entry with no date is dated with the time it was first seen.
 */
export function upsertEntries(feedId: number, entries: readonly ParsedEntry[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const statement = db.prepare(
    `INSERT INTO feed_items (feed_id, guid, url, title, summary, published_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (feed_id, guid) DO UPDATE SET url = excluded.url, title = excluded.title, summary = excluded.summary`,
  );
  db.transaction(() => {
    for (const entry of entries) statement.run(feedId, entry.guid, entry.url, entry.title, entry.summary, entry.publishedAt ?? now);
  })();
}

/** Drops read entries beyond the newest MAX_FEED_ENTRIES of the feed. Unread ones are always kept. */
export function pruneEntries(feedId: number): void {
  getDb()
    .prepare(
      `DELETE FROM feed_items WHERE feed_id = ? AND read = 1 AND id NOT IN
         (SELECT id FROM feed_items WHERE feed_id = ? ORDER BY published_at DESC, id DESC LIMIT ?)`,
    )
    .run(feedId, feedId, MAX_FEED_ENTRIES);
}

export function listEntries(feedId: number | null): FeedEntry[] {
  const db = getDb();
  const rows =
    feedId === null
      ? db.prepare("SELECT * FROM feed_items ORDER BY published_at DESC, id DESC").all()
      : db.prepare("SELECT * FROM feed_items WHERE feed_id = ? ORDER BY published_at DESC, id DESC").all(feedId);
  return (rows as EntryRow[]).map(entryFromRow);
}

export function getEntry(id: number): FeedEntry | null {
  const row = getDb().prepare("SELECT * FROM feed_items WHERE id = ?").get(id) as EntryRow | undefined;
  return row ? entryFromRow(row) : null;
}

/** Null when the entry is gone. */
export function setEntryRead(id: number, read: boolean): FeedEntry | null {
  getDb().prepare("UPDATE feed_items SET read = ? WHERE id = ?").run(read ? 1 : 0, id);
  return getEntry(id);
}

export function markRead(feedId: number | null): void {
  const db = getDb();
  if (feedId === null) db.prepare("UPDATE feed_items SET read = 1 WHERE read = 0").run();
  else db.prepare("UPDATE feed_items SET read = 1 WHERE feed_id = ? AND read = 0").run(feedId);
}
