import { describe, expect, it } from "vitest";
import { cleanFeedTitle, entryKey, feedsNeedRefresh, stripIpcPrefix, feedLabel, limitParsedEntries, normalizeFeedUrl, plainText, sortFeedEntries, webLink, type ParsedEntry } from "./feeds";
import { MAX_FEED_ENTRIES, MAX_FEED_URL_LENGTH } from "./feedsApi";

describe("normalizeFeedUrl", () => {
  it.each([
    ["https://example.com/feed.xml", "https://example.com/feed.xml"],
    ["  example.com/rss  ", "https://example.com/rss"],
    ["http://example.com/atom#frag", "http://example.com/atom"],
    ["localhost:8080/feed", "https://localhost:8080/feed"],
  ])("accepts %j", (input, url) => {
    expect(normalizeFeedUrl(input)).toEqual({ url });
  });

  it.each([
    [""],
    ["   "],
    ["javascript:alert(1)"],
    ["file:///etc/passwd"],
    ["app://index.html"],
    ["data:text/xml,<rss/>"],
    ["ftp://example.com/feed"],
    ["feed:https://example.com/feed"],
    ["https://user:pw@example.com/feed"],
    ["https://"],
    ["a".repeat(MAX_FEED_URL_LENGTH + 1)],
  ])("refuses %j", (input) => {
    expect(normalizeFeedUrl(input).error).toEqual(expect.any(String));
  });
});

describe("webLink", () => {
  it("keeps web addresses and drops everything else", () => {
    expect(webLink("https://example.com/a")).toBe("https://example.com/a");
    expect(webLink("javascript:alert(1)")).toBe("");
    expect(webLink("mailto:a@b.c")).toBe("");
    expect(webLink("/relative")).toBe("");
    expect(webLink(null)).toBe("");
  });
});

describe("plainText", () => {
  it("strips tags and decodes entities", () => {
    expect(plainText("<p>Hi &amp; <b>bye</b></p><p>Next&nbsp;one</p>", 100)).toBe("Hi & bye Next one");
    expect(plainText("a &#39;quote&#39; &#x41; &unknown;", 100)).toBe("a 'quote' A &unknown;");
  });

  it("drops script, style and comments with their content", () => {
    expect(plainText("x<script>alert(1)</script><style>p{}</style><!-- c -->y", 100)).toBe("x y");
  });

  it("collapses white space and cuts at the limit", () => {
    expect(plainText("a \n\t b", 100)).toBe("a b");
    expect(plainText("abcdefghij", 5)).toBe("abcd…");
  });

  it("leaves text that merely looks like markup after decoding as text", () => {
    expect(plainText("&lt;script&gt;x&lt;/script&gt;", 100)).toBe("<script>x</script>");
  });

  it("does not choke on an unclosed tag", () => {
    expect(plainText("hello <b", 100)).toBe("hello <b");
  });
});

describe("cleanFeedTitle and feedLabel", () => {
  it("puts a title on one line without markup", () => {
    expect(cleanFeedTitle("Hello <b>x</b>\n there")).toBe("Hello x there");
  });

  it("labels an untitled feed by its host", () => {
    expect(feedLabel({ url: "https://www.example.com/feed", title: "" })).toBe("example.com");
    expect(feedLabel({ url: "https://example.com/feed", title: "Example" })).toBe("Example");
  });
});

describe("entryKey", () => {
  it("prefers the id, then the link, then the title", () => {
    expect(entryKey({ id: " tag:1 ", url: "https://x/a", title: "T" })).toBe("tag:1");
    expect(entryKey({ id: null, url: "https://x/a", title: "T" })).toBe("https://x/a");
    expect(entryKey({ id: "", url: "", title: "T" })).toBe("T");
    expect(entryKey({})).toBe("");
  });
});

describe("limitParsedEntries", () => {
  const entry = (guid: string, publishedAt: string | null): ParsedEntry => ({ guid, url: "", title: guid, summary: "", publishedAt });

  it("sorts newest first, undated last, and drops repeats and empty keys", () => {
    const result = limitParsedEntries([entry("old", "2026-01-01T00:00:00Z"), entry("none", null), entry("new", "2026-03-01T00:00:00Z"), entry("new", "2026-04-01T00:00:00Z"), entry("", "2026-05-01T00:00:00Z")]);
    expect(result.map((e) => e.guid)).toEqual(["new", "old", "none"]);
  });

  it("keeps at most MAX_FEED_ENTRIES", () => {
    const many = Array.from({ length: MAX_FEED_ENTRIES + 50 }, (_, i) => entry(`e${i}`, new Date(2026, 0, 1, 0, i).toISOString()));
    const result = limitParsedEntries(many);
    expect(result).toHaveLength(MAX_FEED_ENTRIES);
    expect(result[0].guid).toBe(`e${MAX_FEED_ENTRIES + 49}`);
  });
});

describe("sortFeedEntries", () => {
  it("puts the newest first and breaks ties by id", () => {
    const base = { feedId: 1, url: "", title: "", summary: "", read: false };
    const sorted = sortFeedEntries([
      { ...base, id: 1, publishedAt: "2026-01-01T00:00:00.000Z" },
      { ...base, id: 3, publishedAt: "2026-02-01T00:00:00.000Z" },
      { ...base, id: 2, publishedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    expect(sorted.map((e) => e.id)).toEqual([3, 2, 1]);
  });
});

describe("feedsNeedRefresh", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");

  it("is false with no feeds, or when every feed was fetched lately", () => {
    expect(feedsNeedRefresh([], now)).toBe(false);
    expect(feedsNeedRefresh([{ lastFetchedAt: "2026-10-30T11:55:00.000Z" }], now)).toBe(false);
  });

  it("is true when a feed was never fetched, or not for a while, or its time cannot be read", () => {
    expect(feedsNeedRefresh([{ lastFetchedAt: null }], now)).toBe(true);
    expect(feedsNeedRefresh([{ lastFetchedAt: "2026-10-30T11:00:00.000Z" }], now)).toBe(true);
    expect(feedsNeedRefresh([{ lastFetchedAt: "garbage" }], now)).toBe(true);
  });
});

describe("stripIpcPrefix", () => {
  it("leaves only the reason the main process gave", () => {
    expect(stripIpcPrefix("Error invoking remote method 'composition:subscribeFeed': Error: That address is not an RSS or Atom feed.")).toBe("That address is not an RSS or Atom feed.");
    expect(stripIpcPrefix("Error invoking remote method 'composition:x': boom")).toBe("boom");
  });

  it("leaves any other message alone", () => {
    expect(stripIpcPrefix("The server answered 404.")).toBe("The server answered 404.");
  });
});
