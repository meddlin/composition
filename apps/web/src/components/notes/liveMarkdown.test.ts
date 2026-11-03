import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bodyStart, liveDecorations } from "./liveMarkdown";

type Found = { from: number; to: number; kind: string };

/** What the live editor does to `text` with the caret at `caret` (or a selection `[from, to]`): what it hides, and the classes it marks. */
function decorate(text: string, caret: number | [number, number]): { hidden: Found[]; marked: Found[]; lines: Found[] } {
  const [from, to] = typeof caret === "number" ? [caret, caret] : caret;
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.range(from, to),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const set = liveDecorations(state, [{ from: 0, to: state.doc.length }], bodyStart(text));
  const out = { hidden: [] as Found[], marked: [] as Found[], lines: [] as Found[] };
  set.between(0, state.doc.length, (start, end, value) => {
    const kind = (value.spec.class as string | undefined) ?? "";
    // A line decoration sits at a point; a replacement covers a stretch; a mark covers one and has a class.
    if (start === end) out.lines.push({ from: start, to: end, kind });
    else if (value.point) out.hidden.push({ from: start, to: end, kind });
    else out.marked.push({ from: start, to: end, kind });
  });
  return out;
}

const spans = (found: Found[]) => found.map(({ from, to }) => [from, to]);
const classes = (found: Found[]) => found.map(({ kind }) => kind);

describe("bold, italic, strikethrough and code", () => {
  const bold = "**some text** and more";

  it("hides the marks and styles the text while the caret is elsewhere", () => {
    const { hidden, marked } = decorate(bold, bold.length);
    expect(spans(hidden)).toEqual([
      [0, 2],
      [11, 13],
    ]);
    expect(marked).toEqual([{ from: 0, to: 13, kind: "cm-live-strong" }]);
  });

  it("shows the marks, dimmed, while the caret is inside", () => {
    const { hidden, marked } = decorate(bold, 5);
    expect(hidden).toEqual([]);
    expect(classes(marked)).toEqual(["cm-live-strong", "cm-live-syntax", "cm-live-syntax"]);
    expect(spans(marked.filter((m) => m.kind === "cm-live-syntax"))).toEqual([
      [0, 2],
      [11, 13],
    ]);
  });

  it("keeps the marks until the caret has left: right after the closing mark is still the construct, the next word is not", () => {
    expect(decorate(bold, 13).hidden).toEqual([]);
    expect(decorate(bold, 14).hidden).toHaveLength(2);
    // The caret before the opening mark is just as close.
    expect(decorate(`word ${bold}`, 5).hidden).toEqual([]);
    expect(decorate(`word ${bold}`, 4).hidden).toHaveLength(2);
  });

  it("treats a selection that reaches the construct as being in it", () => {
    expect(decorate(`${bold}`, [10, 20]).hidden).toEqual([]);
    expect(decorate(`${bold}`, [15, 20]).hidden).toHaveLength(2);
  });

  it("does nothing to a mark that has no partner yet", () => {
    const { hidden, marked } = decorate("**some text", 11);
    expect(hidden).toEqual([]);
    expect(marked).toEqual([]);
  });

  it.each([
    ["*italic* tail", "cm-live-emphasis", [[0, 1], [7, 8]]],
    ["_italic_ tail", "cm-live-emphasis", [[0, 1], [7, 8]]],
    ["~~struck~~ tail", "cm-live-strike", [[0, 2], [8, 10]]],
    ["`code` tail", "cm-live-code", [[0, 1], [5, 6]]],
    ["***both*** tail", "cm-live-strong", [[0, 1], [1, 3], [7, 9], [9, 10]]],
  ])("%s", (text, kind, hiddenSpans) => {
    const { hidden, marked } = decorate(text, text.length);
    expect(spans(hidden)).toEqual(hiddenSpans);
    expect(classes(marked)).toContain(kind);
  });

  it("leaves a mark in a code span alone", () => {
    expect(decorate("`**not bold**` tail", 19).hidden).toEqual([
      { from: 0, to: 1, kind: "" },
      { from: 13, to: 14, kind: "" },
    ]);
  });
});

describe("headings", () => {
  const text = "# Title\n\nbody";

  it("hides the # and the space after it, and sizes the line, while the caret is on another line", () => {
    const { hidden, lines } = decorate(text, text.length);
    expect(spans(hidden)).toEqual([[0, 2]]);
    expect(lines).toEqual([{ from: 0, to: 0, kind: "cm-live-heading cm-live-h1" }]);
  });

  it("shows the # while the caret is on the heading's line", () => {
    for (const caret of [0, 3, 7]) {
      const { hidden, marked } = decorate(text, caret);
      expect(hidden).toEqual([]);
      expect(marked).toEqual([{ from: 0, to: 1, kind: "cm-live-syntax" }]);
    }
  });

  it.each([2, 3, 4, 5, 6])("sizes a level-%i heading", (level) => {
    const { lines } = decorate(`${"#".repeat(level)} Title\n\nbody`, 12 + level);
    expect(classes(lines)).toEqual([`cm-live-heading cm-live-h${level}`]);
  });

  it("is not a heading without the space, and a #-less line is plain", () => {
    expect(decorate("#hashtag\n\nbody", 14)).toEqual({ hidden: [], marked: [], lines: [] });
  });

  it("styles inline marks inside a heading", () => {
    const { hidden } = decorate("# A **bold** title\n\nbody", 24);
    expect(spans(hidden)).toEqual([
      [0, 2],
      [4, 6],
      [10, 12],
    ]);
  });
});

describe("frontmatter", () => {
  const text = "---\ntitle: Note\n---\n# Heading\n\n**bold** tail";

  it("is left as it is, and set apart", () => {
    const { hidden, lines } = decorate(text, text.length);
    // Not read as a heading underlined by its closing `---`: only the real heading and the bold text are touched.
    expect(spans(hidden)).toEqual([
      [20, 22],
      [31, 33],
      [37, 39],
    ]);
    expect(lines.filter((l) => l.kind === "cm-live-frontmatter").map((l) => l.from)).toEqual([0, 4, 16]);
    expect(lines.filter((l) => l.kind.includes("cm-live-h1"))).toHaveLength(1);
  });

  it("does not take a YAML-less --- pair for frontmatter", () => {
    expect(bodyStart("---\n- not: [yaml\n---\n")).toBe(0);
    expect(bodyStart("no frontmatter")).toBe(0);
    expect(bodyStart(text)).toBe(20);
  });
});
