import { describe, expect, it } from "vitest";
import { markTints, tintSegments } from "./markTints";
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
