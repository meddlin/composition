import { MAX_FEED_SUMMARY_LENGTH, MAX_FEED_TITLE_LENGTH, MAX_FEED_URL_LENGTH, MAX_FEED_ENTRIES, type Feed, type FeedEntry } from "./feedsApi";

/** What the parser hands over for one entry, already cleaned: the service stores it as it is. */
export type ParsedEntry = {
  /** What tells the entry apart from the feed's others: the feed's own id, else the link. Never empty. */
  guid: string;
  /** An `http(s)` address, or empty. */
  url: string;
  title: string;
  /** Plain text. */
  summary: string;
  /** ISO time, or null when the feed gave none (the service then uses the time it first saw the entry). */
  publishedAt: string | null;
};

/** What the parser hands over for a feed. */
export type ParsedFeed = {
  title: string;
  /** An `http(s)` address, or empty. */
  siteUrl: string;
  entries: ParsedEntry[];
};

/** The schemes that are named without `//`, which the "no scheme, so add https://" rule must not mistake for a host and port. */
const OPAQUE_SCHEME = /^(javascript|data|file|blob|about|mailto|tel|vbscript|view-source|chrome|devtools|app|feed):/i;
const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * A feed address as it is stored: trimmed, `https://` added when there is no scheme, the fragment dropped. Only `http:` and
 * `https:` pass. The panel, the bridge validator and the service all use it, so none can let through what another refuses.
 */
export function normalizeFeedUrl(input: string): { url: string; error?: undefined } | { url?: undefined; error: string } {
  const text = input.trim();
  if (text === "") return { error: "Paste the address of a feed to subscribe." };
  if (text.length > MAX_FEED_URL_LENGTH) return { error: "That address is too long." };
  if (OPAQUE_SCHEME.test(text)) return { error: "Only web addresses (http or https) can be subscribed to." };
  let parsed: URL;
  try {
    parsed = new URL(SCHEME_WITH_SLASHES.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "That does not look like an address." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "Only web addresses (http or https) can be subscribed to." };
  if (parsed.hostname === "") return { error: "That does not look like an address." };
  if (parsed.username !== "" || parsed.password !== "") return { error: "Remove the user name and password from the address." };
  parsed.hash = "";
  return { url: parsed.href };
}

/** An address as an entry or site link: kept only when it is a web address, else empty. */
export function webLink(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_FEED_URL_LENGTH) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Markup turned into the text a reader would see: script and style dropped, tags removed (block ends become a space),
 * the common entities decoded, white space collapsed, cut at `max` characters. The result is only ever shown as text.
 */
export function plainText(html: string, max: number): string {
  const withoutCode = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const spaced = withoutCode.replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|blockquote|pre|figure|table)\b[^>]*>/gi, " ");
  const text = decodeEntities(spaced.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A feed or entry title as it is stored: plain text on one line, cut at the limit. */
export function cleanFeedTitle(title: string): string {
  return plainText(title, MAX_FEED_TITLE_LENGTH);
}

/** An excerpt as it is stored. */
export function cleanFeedSummary(summary: string): string {
  return plainText(summary, MAX_FEED_SUMMARY_LENGTH);
}

/** What a feed is called until its first fetch has said: the host name, without a leading `www.`. */
export function feedHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

/** What a row is called: the feed's own title when it has one, else the host. */
export function feedLabel(feed: Pick<Feed, "url" | "title">): string {
  return feed.title === "" ? feedHostLabel(feed.url) : feed.title;
}

/** What tells an entry apart within its feed: the feed's own id, else the link, else the title. Empty only when there is nothing at all. */
export function entryKey(entry: { id?: string | null; url?: string | null; title?: string | null }): string {
  return (entry.id?.trim() || entry.url?.trim() || entry.title?.trim() || "").slice(0, MAX_FEED_URL_LENGTH);
}

/** The entries to keep from one fetch: newest first, no repeated key, at most MAX_FEED_ENTRIES. An undated entry sorts as the oldest. */
export function limitParsedEntries(entries: readonly ParsedEntry[]): ParsedEntry[] {
  const seen = new Set<string>();
  const unique = entries.filter((entry) => entry.guid !== "" && !seen.has(entry.guid) && (seen.add(entry.guid), true));
  const time = (entry: ParsedEntry) => (entry.publishedAt === null ? 0 : Date.parse(entry.publishedAt) || 0);
  return unique.sort((a, b) => time(b) - time(a)).slice(0, MAX_FEED_ENTRIES);
}

/** Entries as they are shown: the order the backend sends them in (newest first, unread or not). Kept as a function so the panel and tests share it. */
export function sortFeedEntries(entries: readonly FeedEntry[]): FeedEntry[] {
  return [...entries].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id);
}

/** How old a feed's last good fetch may be before opening a panel fetches it again. */
export const FEED_STALE_AFTER_MS = 10 * 60 * 1000;

/** Whether any feed has never been fetched, or not lately: then a panel that opens fetches them. */
export function feedsNeedRefresh(feeds: readonly Pick<Feed, "lastFetchedAt">[], now: number, maxAgeMs: number = FEED_STALE_AFTER_MS): boolean {
  return feeds.some((feed) => feed.lastFetchedAt === null || !(now - Date.parse(feed.lastFetchedAt) < maxAgeMs));
}

/** Electron puts "Error invoking remote method 'channel': Error: " in front of what the main process threw; the person should read only the reason. */
export function stripIpcPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}
