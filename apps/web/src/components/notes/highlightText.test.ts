import { describe, expect, it } from "vitest";
import { highlightAt, highlightRange, removeHighlight } from "./highlightText";

/** The range of the first `needle` in `text`. */
const find = (text: string, needle: string, from = 0) => {
  const start = text.indexOf(needle, from);
  if (start === -1) throw new Error(`${needle} is not in ${text}`);
  return { start, end: start + needle.length };
};

const Y = (inner: string) => `<Mark color="yellow">${inner}</Mark>`;
const G = (inner: string) => `<Mark color="green">${inner}</Mark>`;

/** Highlights `needle` and returns the new text, failing the test if that was refused. */
function highlighted(text: string, needle: string, color: "yellow" | "green" = "yellow") {
  const result = highlightRange(text, find(text, needle), color);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

/** The text with every <Mark> tag taken out: highlighting must never change what the note says. */
const withoutTags = (text: string) => text.replace(/<\/?Mark[^>]*>/g, "");

describe("highlightRange", () => {
  it("wraps the selected words and selects them again", () => {
    const result = highlighted("hello big world", "big");

    expect(result.text).toBe(`hello ${Y("big")} world`);
    expect(result.text.slice(result.selection.start, result.selection.end)).toBe("big");
  });

  it("keeps the spaces around a selection outside the tags", () => {
    expect(highlighted("hello big world", " big ").text).toBe(`hello ${Y("big")} world`);
  });

  it("uses the colour it is given", () => {
    expect(highlighted("hello", "hello", "green").text).toBe(G("hello"));
  });

  it("wraps each piece of text separately, so formatting is never cut across", () => {
    const text = "a **bold** text";

    expect(highlighted(text, text).text).toBe(`${Y("a")} **${Y("bold")}** ${Y("text")}`);
  });

  it("highlights part of a word inside bold", () => {
    expect(highlighted("**bold** text", "ld** te").text).toBe(`**bo${Y("ld")}** ${Y("te")}xt`);
  });

  it("highlights link text but not the address", () => {
    expect(highlighted("see [the docs](https://example.com) now", "the docs").text).toBe(
      `see [${Y("the docs")}](https://example.com) now`,
    );
  });

  it("leaves a bare web address as it is, which would stop being a link", () => {
    const text = "see https://example.com now";

    expect(highlighted(text, text).text).toBe(`${Y("see")} https://example.com ${Y("now")}`);
  });

  it("wraps each paragraph of a selection spanning several", () => {
    const text = "first one\n\nsecond one";

    expect(highlighted(text, text).text).toBe(`${Y("first one")}\n\n${Y("second one")}`);
  });

  it("works in headings, list items, quotes and table cells", () => {
    const text = "# Title\n\n- item\n\n> quote\n\n| a | b |\n| - | - |\n| c | d |";

    expect(highlighted(text, "Title").text).toContain(`# ${Y("Title")}`);
    expect(highlighted(text, "item").text).toContain(`- ${Y("item")}`);
    expect(highlighted(text, "quote").text).toContain(`> ${Y("quote")}`);
    expect(highlighted(text, "d |", "green").text).toContain(`| ${G("d")} |`);
  });

  it("can span the lines of a quote", () => {
    const text = "> one\n> two";
    const result = highlighted(text, "one\n> two");

    expect(result.text).toBe(`> ${Y("one\n> two")}`);
  });

  it("works inside a component", () => {
    const text = "<Info>\n\nwatch out\n\n</Info>";

    expect(highlighted(text, "watch").text).toBe(`<Info>\n\n${Y("watch")} out\n\n</Info>`);
  });

  it("skips code, and says so when there is nothing else", () => {
    const text = "run `npm test` now\n\n```\nnpm test\n```";

    expect(highlighted(text, "run `npm test` now").text).toBe(`${Y("run")} \`npm test\` ${Y("now")}\n\n\`\`\`\nnpm test\n\`\`\``);

    const refused = highlightRange(text, find(text, "npm test", text.indexOf("```")), "yellow");
    expect(refused).toEqual({ ok: false, reason: expect.stringContaining("code") });
  });

  it("keeps the tags clear of a quote's > when the selection starts or ends on a line break", () => {
    const text = "> one\n> two\n> three";
    const result = highlightRange(text, { start: text.indexOf("\n"), end: text.indexOf("\n", text.indexOf("two")) + 1 }, "yellow");

    expect(result).toMatchObject({ ok: true, text: `> one\n> ${Y("two")}\n> three` });
  });

  it("keeps the tags clear of a list item's indent in the same way", () => {
    const text = "- one\n  two\n- three";

    expect(highlightRange(text, { start: 0, end: text.indexOf("\n", 6) }, "yellow")).toMatchObject({
      ok: true,
      text: `- ${Y("one\n  two")}\n- three`,
    });
  });

  it("highlights around an indented code block, which stays code", () => {
    const text = "before text\n\n    indented code\n\nafter text";

    expect(highlighted(text, "before").text).toBe(`${Y("before")} text\n\n    indented code\n\nafter text`);
    expect(highlighted(text, "after").text).toBe(`before text\n\n    indented code\n\n${Y("after")} text`);
    expect(highlighted(text, text).text).toBe(`${Y("before text")}\n\n    indented code\n\n${Y("after text")}`);
  });

  it("does not highlight inside indented code", () => {
    const text = "before\n\n    indented code\n\nafter";

    expect(highlightRange(text, find(text, "indented"), "yellow")).toEqual({ ok: false, reason: expect.stringContaining("code") });
  });

  it("refuses an empty selection", () => {
    expect(highlightRange("hello", { start: 2, end: 2 }, "yellow")).toEqual({ ok: false, reason: expect.stringContaining("Select") });
    expect(highlightRange("hello  world", find("hello  world", "  "), "yellow").ok).toBe(false);
  });

  it("counts offsets from the start of the note, frontmatter included", () => {
    const text = "---\ntitle: Hi\n---\nhello world";
    const result = highlighted(text, "world");

    expect(result.text).toBe(`---\ntitle: Hi\n---\nhello ${Y("world")}`);
    expect(result.text.slice(result.selection.start, result.selection.end)).toBe("world");
  });

  it("leaves frontmatter alone, even when the selection starts in it", () => {
    const text = "---\ntitle: Hi\n---\nhello";

    expect(highlighted(text, "Hi\n---\nhel").text).toBe(`---\ntitle: Hi\n---\n${Y("hel")}lo`);
    expect(highlightRange(text, find(text, "title"), "yellow").ok).toBe(false);
  });

  it("does not cut an escape in two", () => {
    const text = String.raw`1 \* 2 and 3`;
    const star = text.indexOf("*");

    expect(highlightRange(text, { start: star, end: star + 3 }, "yellow")).toMatchObject({
      ok: true,
      text: String.raw`1 ${Y(String.raw`\* 2`)} and 3`,
    });
  });

  it("does not cut an entity in two", () => {
    const text = "fish &amp; chips";
    const amp = text.indexOf("amp");

    expect(highlightRange(text, { start: amp, end: text.length }, "yellow")).toMatchObject({
      ok: true,
      text: `fish ${Y("&amp; chips")}`,
    });
  });

  it("recolours a highlight it lands on instead of nesting", () => {
    const text = `a ${Y("b c")} d`;

    expect(highlighted(text, "b c", "green").text).toBe(`a ${G("b c")} d`);
    expect(highlighted(text, "c", "green").text).toBe(`a ${G("b c")} d`);
  });

  it("leaves a highlight of the same colour as it is", () => {
    const text = `a ${Y("b")} d`;

    expect(highlighted(text, "b").text).toBe(text);
  });

  it("highlights what is plain and recolours what is already highlighted, in one selection", () => {
    const text = `x ${Y("y")} z`;

    expect(highlighted(text, text, "green").text).toBe(`${G("x")} ${G("y")} ${G("z")}`);
  });

  it("never changes what the note says", () => {
    const text = "# Head\n\nSome *emphasis* and **strong** and [a link](https://x.y) in `code`.\n\n- one\n- two";

    expect(withoutTags(highlighted(text, text).text)).toBe(text);
  });

  it("refuses when the tags would change the formatting around them", () => {
    // `foo**<Mark>bar</Mark>**baz` no longer reads as bold.
    expect(highlightRange("foo**bar**baz", find("foo**bar**baz", "bar"), "yellow")).toEqual({
      ok: false,
      reason: expect.stringContaining("part of a word"),
    });
  });

  it.each([
    ["a stray brace", "the set {a, b} is small"],
    ["html", "line one<br>line two"],
    ["a half-typed tag", "text <Info> never closed"],
  ])("refuses a note MDX can't read: %s", (_name, text) => {
    const result = highlightRange(text, { start: 0, end: 3 }, "yellow");

    expect(result).toEqual({ ok: false, reason: expect.stringContaining("MDX") });
  });
});

describe("removeHighlight", () => {
  it("takes the tags off the highlight the selection touches", () => {
    const text = `one ${Y("two")} three`;
    const result = removeHighlight(text, find(text, "two"));

    expect(result).toMatchObject({ ok: true, text: "one two three" });
  });

  it("works from a caret inside the highlight", () => {
    const text = `one ${Y("two")} three`;
    const caret = text.indexOf("wo");

    expect(removeHighlight(text, { start: caret, end: caret })).toMatchObject({ ok: true, text: "one two three" });
  });

  it("removes every highlight in the selection, whatever its colour", () => {
    const text = `${Y("a")} b ${G("c")} d`;

    expect(removeHighlight(text, { start: 0, end: text.length })).toMatchObject({ ok: true, text: "a b c d" });
  });

  it("selects the text that was highlighted", () => {
    const text = `one ${Y("two")} three`;
    const result = removeHighlight(text, find(text, "two"));

    expect(result.ok && result.text.slice(result.selection.start, result.selection.end)).toBe("two");
  });

  it("says when there is nothing to remove", () => {
    expect(removeHighlight("plain", { start: 0, end: 5 })).toEqual({ ok: false, reason: expect.stringContaining("no highlight") });
  });
});

describe("highlightAt", () => {
  it("finds the highlight around an offset", () => {
    const text = `---\ntitle: Hi\n---\none ${G("two")} three`;
    const at = text.indexOf("wo");

    expect(highlightAt(text, at)).toEqual({ color: "green", ...find(text, G("two")) });
  });

  it("is null outside a highlight, and for a note MDX can't read", () => {
    const text = `one ${Y("two")} three`;

    expect(highlightAt(text, 1)).toBeNull();
    expect(highlightAt(text, text.indexOf("three"))).toBeNull();
    expect(highlightAt("{ broken", 1)).toBeNull();
  });
});
