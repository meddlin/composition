import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bodyStart } from "./liveMarkdown";
import { setextDecorations } from "./liveSetext";

type Found = { at: number; to: number; kind: string };

/** What the setext layer does to `text` with the caret at `caret`: line classes (by line start) and marks. */
function decorate(text: string, caret: number) {
  const state = EditorState.create({ doc: text, selection: EditorSelection.cursor(caret), extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const lines: Found[] = [];
  const marks: Found[] = [];
  for (const range of setextDecorations(state, [{ from: 0, to: text.length }], bodyStart(text))) {
    const found = { at: range.from, to: range.to, kind: String(range.value.spec.class) };
    (range.from === range.to ? lines : marks).push(found);
  }
  return { lines, marks };
}

describe("setext headings in Live", () => {
  const doc = "Title\n=====\n\nSome text.\n\nTwo line\nsection\n---\n\nEnd.";

  it("draws the text as a level 1 or 2 heading and collapses the underline's line, away from the caret", () => {
    const { lines, marks } = decorate(doc, doc.length);
    expect(lines).toEqual([
      { at: 0, to: 0, kind: "cm-live-heading cm-live-h1 cm-live-setext" },
      { at: 6, to: 6, kind: "cm-live-setext-hidden" },
      { at: doc.indexOf("Two"), to: doc.indexOf("Two"), kind: "cm-live-heading cm-live-h2 cm-live-setext" },
      { at: doc.indexOf("section"), to: doc.indexOf("section"), kind: "cm-live-heading cm-live-h2 cm-live-setext" },
      { at: doc.indexOf("---"), to: doc.indexOf("---"), kind: "cm-live-setext-hidden" },
    ]);
    expect(marks).toEqual([]);
  });

  it("shows the underline, dimmed, while the caret is on the heading", () => {
    const { lines, marks } = decorate(doc, 2);
    expect(lines.filter((line) => line.at < 12).map((line) => line.kind)).toEqual(["cm-live-heading cm-live-h1 cm-live-setext"]);
    expect(marks).toEqual([{ at: 6, to: 11, kind: "cm-live-syntax" }]);
    // The other heading, away from the caret, keeps its underline collapsed.
    expect(lines.at(-1)).toEqual({ at: doc.indexOf("---"), to: doc.indexOf("---"), kind: "cm-live-setext-hidden" });
  });

  it("leaves a rule, and the frontmatter's closing line, alone", () => {
    expect(decorate("Text\n\n---\n\nMore", 0)).toEqual({ lines: [], marks: [] });
    const withFrontmatter = "---\ntitle: x\n---\n\nBody";
    expect(decorate(withFrontmatter, withFrontmatter.length)).toEqual({ lines: [], marks: [] });
  });
});
