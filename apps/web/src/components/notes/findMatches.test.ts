// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findMatches, findRanges, markMatches, MAX_MATCHES } from "./findMatches";
import { tokenizeMarkdown } from "./markdownTokens";

const loose = { matchCase: false, wholeWord: false };

describe("findMatches", () => {
  it("finds every occurrence, ignoring case unless asked not to", () => {
    expect(findMatches("Cat cat CAT", "cat", loose)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
    expect(findMatches("Cat cat CAT", "cat", { ...loose, matchCase: true })).toEqual([{ start: 4, end: 7 }]);
  });

  it("matches a phrase as typed, never as a pattern", () => {
    expect(findMatches("a.b axb (a+b) a+b", "a.b", loose)).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches("(a+b) and a+b", "a+b", loose)).toHaveLength(2);
    expect(findMatches("the quick  brown fox, the quick brown", "quick brown", loose)).toEqual([{ start: 26, end: 37 }]);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa", loose)).toHaveLength(2);
  });

  it("can require whole words", () => {
    const whole = { ...loose, wholeWord: true };
    expect(findMatches("cat concat cats cat_ cat.", "cat", whole)).toEqual([
      { start: 0, end: 3 },
      { start: 21, end: 24 },
    ]);
    // An end that is not a word character has no word to bound.
    expect(findMatches("c++ and c++11", "c++", whole)).toEqual([{ start: 0, end: 3 }, { start: 8, end: 11 }]);
    expect(findMatches("naïve naive", "naive", whole)).toEqual([{ start: 6, end: 11 }]);
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches("abc", "", loose)).toEqual([]);
  });

  it("stops at the cap", () => {
    expect(findMatches("a".repeat(MAX_MATCHES + 10), "a", loose)).toHaveLength(MAX_MATCHES);
  });
});

describe("markMatches", () => {
  it("cuts coloured runs at match edges without changing the text", () => {
    const text = "# Title\n\nsome **bold title** here\n";
    const matches = findMatches(text, "title", loose);
    const marked = markMatches(tokenizeMarkdown(text), matches, 1);

    expect(marked.map((m) => m.text).join("")).toBe(text);
    expect(marked.filter((m) => m.match).map((m) => [m.text, m.kind, m.match])).toEqual([
      ["Title", "heading", "match"],
      ["title", "strong", "current"],
    ]);
  });

  it("leaves the runs alone when nothing matched", () => {
    const segments = tokenizeMarkdown("plain **bold**");
    expect(markMatches(segments, [], 0).every((m) => m.match === null)).toBe(true);
  });
});

describe("findRanges", () => {
  const html = (markup: string) => {
    const root = document.createElement("div");
    root.innerHTML = markup;
    return root;
  };
  const texts = (ranges: Range[]) => ranges.map((r) => r.toString());

  it("finds a phrase that runs across inline markup", () => {
    const root = html("<p>say <strong>hello</strong> world today</p>");
    expect(texts(findRanges(root, "hello world", loose))).toEqual(["hello world"]);
  });

  it("does not match across paragraphs or list items", () => {
    const root = html("<p>foo</p><p>bar</p><ul><li>baz</li><li>qux</li></ul>");
    expect(findRanges(root, "foobar", loose)).toEqual([]);
    expect(findRanges(root, "bazqux", loose)).toEqual([]);
    expect(texts(findRanges(root, "ba", loose))).toEqual(["ba", "ba"]);
  });

  it("finds repeated matches within one text node", () => {
    const root = html("<p>to be or not to be</p>");
    const ranges = findRanges(root, "be", loose);
    expect(texts(ranges)).toEqual(["be", "be"]);
    expect(ranges.map((r) => r.startOffset)).toEqual([3, 16]);
  });

  it("ignores script and style text", () => {
    expect(findRanges(html("<style>.cat{}</style><p>cat</p>"), "cat", loose)).toHaveLength(1);
  });
});
