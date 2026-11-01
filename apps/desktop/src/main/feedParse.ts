import { parseFeed } from "@rowanmanning/feed-parser";
import { cleanFeedSummary, cleanFeedTitle, entryKey, webLink, type ParsedFeed } from "../../../web/src/lib/composition/feeds";

/** Why a body could not be read as a feed. Its message is shown to the user. */
export class NotAFeedError extends Error {
  constructor() {
    super("That address is not an RSS or Atom feed.");
  }
}

const isoOrNull = (date: Date | null | undefined): string | null => (date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null);

/**
 * Reads an RSS or Atom document into the shape the service stores. Everything that comes out is cleaned here: titles and
 * excerpts are plain text and cut, links are kept only when they are web addresses, an entry with nothing to tell it apart
 * is dropped. Throws `NotAFeedError` for anything else (HTML, JSON Feed, an empty or hostile document).
 */
export function parseFeedText(xml: string): ParsedFeed {
  let feed: ReturnType<typeof parseFeed>;
  try {
    feed = parseFeed(xml);
  } catch {
    throw new NotAFeedError();
  }
  const entries = [];
  for (const item of feed.items) {
    const url = webLink(item.url);
    const guid = entryKey({ id: item.id, url, title: item.title });
    if (guid === "") continue;
    entries.push({
      guid,
      url,
      title: cleanFeedTitle(item.title ?? ""),
      summary: cleanFeedSummary(item.description ?? item.content ?? ""),
      publishedAt: isoOrNull(item.published) ?? isoOrNull(item.updated),
    });
  }
  return { title: cleanFeedTitle(feed.title ?? ""), siteUrl: webLink(feed.url), entries };
}
