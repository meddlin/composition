import { describe, expect, it } from "vitest";
import { markElements, markTints, tintSegments } from "./markTints";
import { tokenizeMarkdown } from "./markdownTokens";

const tints = (text: string) => markTints(text, tokenizeMarkdown(text));
/** What each tint covers, as text. */
const covered = (text: string) => tints(text).map((t) => [text.slice(t.start, t.end), t.color]);

describe("markTints", () => {
  it("covers the text between a pair of tags, tags excluded", () => {
    expect(covered('a <Mark color="green">b c</Mark> d')).toEqual([["b c", "green"]]);
  });

  it("is empty for a note with no highlights", () => {
    expect(tints("plain **text** and <Info>x</Info>")).toEqual([]);
  });

  it("lets the inner highlight win where they nest, leaving the outer one around it", () => {
    const text = '<Mark color="green">a <Mark color="pink">b</Mark> c</Mark>';

    expect(covered(text)).toEqual([
      ["a ", "green"],
      ["b", "pink"],
      [" c", "green"],
    ]);
  });

  it("finds highlights inside bold and links, where the colouring treats the tags as part of the construct", () => {
    expect(covered('**<Mark color="blue">b</Mark>** [<Mark color="orange">c</Mark>](https://x.y)')).toEqual([
      ["b", "blue"],
      ["c", "orange"],
    ]);
  });

  it("runs across lines", () => {
    expect(covered('> <Mark color="yellow">one\n> two</Mark>')).toEqual([["one\n> two", "yellow"]]);
  });

  it("ignores tags in code, fenced or inline, and in frontmatter", () => {
    expect(tints('`<Mark color="green">x</Mark>`')).toEqual([]);
    expect(tints('```\n<Mark color="green">x</Mark>\n```')).toEqual([]);
    expect(tints('---\nt: <Mark color="green">x</Mark>\n---\n')).toEqual([]);
  });

  it("ignores an opening tag with no closing one, and a closing tag with no opening one", () => {
    expect(tints('<Mark color="green">never closed')).toEqual([]);
    expect(tints("stray </Mark> here")).toEqual([]);
    expect(covered('<Mark color="green">a <Mark color="pink">b</Mark> unclosed outer')).toEqual([["b", "pink"]]);
  });

  it("uses yellow for a missing or unknown colour", () => {
    expect(covered("<Mark>a</Mark> <Mark color=\"mauve\">b</Mark>")).toEqual([
      ["a", "yellow"],
      ["b", "yellow"],
    ]);
  });

  it("leaves a self-closing tag out", () => {
    expect(tints('<Mark color="green" /> text </Mark>')).toEqual([]);
  });
});

/** The text of each element's opening and closing tag. */
const tags = (text: string) =>
  markElements(text, tokenizeMarkdown(text)).map(({ open, close }) => [text.slice(open.start, open.end), text.slice(close.start, close.end)]);

describe("markElements", () => {
  it("gives the opening and closing tag of each pair", () => {
    expect(tags('a <Mark color="green">b</Mark> c <Mark>d</Mark>')).toEqual([
      ['<Mark color="green">', "</Mark>"],
      ["<Mark>", "</Mark>"],
    ]);
  });

  it("pairs nested ones inner with inner, and lists them in the order they open", () => {
    const text = '<Mark color="yellow">a <Mark color="green">b</Mark> c</Mark>';
    const elements = markElements(text, tokenizeMarkdown(text));

    expect(elements).toHaveLength(2);
    expect(text.slice(elements[0].open.start, elements[0].open.end)).toBe('<Mark color="yellow">');
    expect(elements[0].close.start).toBeGreaterThan(elements[1].close.start);
    expect(text.slice(elements[1].open.start, elements[1].open.end)).toBe('<Mark color="green">');
  });

  it("finds tags inside bold and links, which the colouring takes as one run", () => {
    expect(tags("**<Mark>b</Mark>** and [<Mark>c</Mark>](url)")).toHaveLength(2);
  });

  it("ignores what markTints ignores: code, frontmatter, tags left open or closed twice, self-closing tags", () => {
    expect(tags("run `<Mark>x</Mark>` now")).toEqual([]);
    expect(tags('---\ntitle: "<Mark>x</Mark>"\n---\nbody')).toEqual([]);
    expect(tags("<Mark>open")).toEqual([]);
    expect(tags("close</Mark>")).toEqual([]);
    expect(tags("<Mark>a</Mark></Mark>")).toEqual([["<Mark>", "</Mark>"]]);
    expect(tags('<Mark color="blue" /> text')).toEqual([]);
  });

  it("is empty for a note with no highlights", () => {
    expect(tags("nothing here")).toEqual([]);
  });

  it("pairs up the same tags as markTints does, so the tint and the tags never disagree", () => {
    const text = 'x <Mark color="pink">a <Mark>b</Mark> c</Mark> <Mark>stray y';

    expect(tags(text)).toHaveLength(2);
    expect(markTints(text, tokenizeMarkdown(text)).map((t) => text.slice(t.start, t.end))).toEqual(["a ", "b", " c"]);
  });
});

describe("tintSegments", () => {
  it("cuts the coloured runs at the edges of the tints, and the pieces still make the text", () => {
    const text = 'a **bold <Mark color="green">text** more</Mark> end';
    const segments = tokenizeMarkdown(text);
    const out = tintSegments(segments, [{ start: text.indexOf("text"), end: text.indexOf("</Mark>"), color: "green" }]);

    expect(out.map((s) => s.text).join("")).toBe(text);
    expect(out.filter((s) => s.tint).map((s) => s.text)).toEqual(["text**", " more"]);
    // The strong run was cut in two but is still strong.
    expect(out.find((s) => s.tint && s.text === "text**")?.kind).toBe("strong");
  });

  it("keeps the extra fields of the segments it cuts", () => {
    const out = tintSegments([{ text: "abcdef", kind: null, match: "match" as const }], [{ start: 2, end: 4, color: "pink" }]);

    expect(out).toEqual([
      { text: "ab", kind: null, match: "match", tint: null },
      { text: "cd", kind: null, match: "match", tint: "pink" },
      { text: "ef", kind: null, match: "match", tint: null },
    ]);
  });

  it("returns the segments untinted when there are no tints", () => {
    expect(tintSegments([{ text: "x", kind: null }], [])).toEqual([{ text: "x", kind: null, tint: null }]);
  });
});
