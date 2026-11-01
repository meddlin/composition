import { describe, expect, it } from "vitest";
import { NotAFeedError, parseFeedText } from "./feedParse";

const rss = (items: string, channel = "<title>T &amp; Co</title><link>https://ex.com/</link>") => `<?xml version="1.0"?><rss version="2.0"><channel>${channel}${items}</channel></rss>`;

describe("parseFeedText", () => {
  it("reads an RSS feed into plain text, absolute links and ISO dates", () => {
    const feed = parseFeedText(
      rss(`<item><title><![CDATA[Hello <b>x</b>]]></title><link>/a</link><guid>g1</guid><description>&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;</description><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate></item>`),
    );

    expect(feed).toEqual({
      title: "T & Co",
      siteUrl: "https://ex.com/",
      entries: [{ guid: "g1", url: "https://ex.com/a", title: "Hello x", summary: "Hi & bye", publishedAt: "2026-10-26T10:00:00.000Z" }],
    });
  });

  it("reads an Atom feed, dating an entry by `updated` when it has no `published`", () => {
    const feed = parseFeedText(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><link href="https://a.com/"/><entry><id>tag:a,1</id><title>E</title><link href="https://a.com/e"/><updated>2026-10-01T00:00:00Z</updated><summary>s</summary></entry></feed>`,
    );

    expect(feed.entries).toEqual([{ guid: "tag:a,1", url: "https://a.com/e", title: "E", summary: "s", publishedAt: "2026-10-01T00:00:00.000Z" }]);
  });

  it("keys an entry with no id by its link, and leaves its date empty", () => {
    const feed = parseFeedText(rss(`<item><title>No guid</title><link>https://ex.com/b</link></item>`));

    expect(feed.entries).toEqual([{ guid: "https://ex.com/b", url: "https://ex.com/b", title: "No guid", summary: "", publishedAt: null }]);
  });

  it("keeps only web links", () => {
    const feed = parseFeedText(rss(`<item><title>Bad</title><link>javascript:alert(1)</link></item>`, "<title>T</title><link>file:///etc/passwd</link>"));

    expect(feed.siteUrl).toBe("");
    expect(feed.entries[0]).toMatchObject({ url: "", guid: "Bad" });
  });

  it("drops an entry with nothing to tell it apart", () => {
    expect(parseFeedText(rss(`<item><description>just text</description></item>`)).entries).toEqual([]);
  });

  it("does not run scripts or keep markup in an excerpt", () => {
    const feed = parseFeedText(rss(`<item><title>t</title><link>https://ex.com/s</link><description>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;ok</description></item>`));

    expect(feed.entries[0].summary).toBe("ok");
  });

  it.each([
    ["an HTML page", "<html><body>hi</body></html>"],
    ["JSON Feed", '{"version":"https://jsonfeed.org/version/1.1","title":"j","items":[]}'],
    ["nothing", ""],
    ["a document nested far too deep", `<rss><channel>${"<a>".repeat(20000)}</channel></rss>`],
  ])("refuses %s", (_name, body) => {
    expect(() => parseFeedText(body)).toThrow(NotAFeedError);
  });

  it("does not expand entities defined by the document", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><rss version="2.0"><channel><title>&b;</title><item><title>x</title></item></channel></rss>`;

    expect(parseFeedText(bomb).title).not.toContain("aaaaaaaaaa");
  });
});
