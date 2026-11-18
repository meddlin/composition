import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { definitionEnd, footnoteDecorations, footnoteMarksField, footnotesOf, footnotesSource } from "./liveFootnotes";
import { liveFrontmatterField } from "./liveFrontmatter";
import { NoteMarkdown } from "./NoteMarkdown";

function stateOf(doc: string, caret = doc.length): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage }), liveFrontmatterField, footnoteMarksField],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

function apply(state: EditorState, spec: TransactionSpec): EditorState {
  const next = state.update(spec).state;
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next.update({}).state;
}

/** The numbers Live gives the references, in order. */
const liveNumbers = (doc: string) => footnotesOf(stateOf(doc)).references.map((reference) => reference.number);

/** The numbers Preview draws for the references, in order. */
const previewNumbers = (doc: string) =>
  [...renderToStaticMarkup(<NoteMarkdown body={doc} rehypePlugins={[]} />).matchAll(/data-footnote-ref="true"[^>]*>(\d+)</g)].map((match) => Number(match[1]));

const NOTE = "Cited a[^x], then b[^Y], then a again[^X] and one with no note[^none].\n\n[^y]: Why.\n[^x]: Ex, with **bold**.\n[^unused]: Never cited.";

describe("numbering footnotes", () => {
  it("numbers them by the order they are first cited in, matching labels whatever their case, as Preview does", () => {
    expect(liveNumbers(NOTE)).toEqual([1, 2, 1]);
    expect(previewNumbers(NOTE)).toEqual([1, 2, 1]);
  });

  it("leaves out references and definitions in code and in the frontmatter", () => {
    const doc = "---\nnote: \"[^a]\"\n---\nText[^a] and `[^a]`.\n\n```\n[^a]: not this\n```\n\n[^a]: This one.";
    const footnotes = footnotesOf(stateOf(doc));
    expect(footnotes.references.map((reference) => reference.from)).toEqual([doc.indexOf("Text[^a]") + 4]);
    expect(footnotes.definitions.get("a")!.mark.from).toBe(doc.lastIndexOf("[^a]:"));
  });

  it("keeps its marks up to date edit by edit, as a fresh read of the text would find them", () => {
    let state = stateOf(NOTE);
    const edits: TransactionSpec[] = [
      { changes: { from: 0, insert: "New[^z] " } },
      { changes: { from: NOTE.length + 8, insert: "\n[^z]: Zed." } },
      // Breaking a reference, and a definition's line.
      { changes: { from: 12, to: 13 } },
      { changes: { from: 0, to: 0, insert: "\n\n" } },
      // Joining two lines puts a definition mid-line, where it is a reference.
      { changes: { from: state.doc.length, insert: "" } },
    ];
    for (const edit of edits) {
      state = apply(state, edit);
      const fresh = stateOf(state.doc.toString());
      expect(state.field(footnoteMarksField)).toEqual(fresh.field(footnoteMarksField));
    }
    const joined = state.doc.toString().indexOf("\n[^y]:");
    state = apply(state, { changes: { from: joined, to: joined + 1 } });
    expect(state.field(footnoteMarksField)).toEqual(stateOf(state.doc.toString()).field(footnoteMarksField));
  });
});

describe("drawing footnotes", () => {
  const draw = (doc: string, caret: number) => {
    const state = stateOf(doc, caret);
    return footnoteDecorations(state, [{ from: 0, to: doc.length }]).map((range) => ({
      from: range.from,
      to: range.to,
      widget: (range.value.spec.widget as { number?: number; href?: string } | undefined) ?? null,
      kind: range.value.spec.class as string | undefined,
    }));
  };

  it("draws a reference as its number, linked to its definition, and a definition's label as its number", () => {
    const found = draw(NOTE, NOTE.indexOf("Cited"));
    const refs = found.filter((d) => d.widget && d.to - d.from <= 4 + 1 && NOTE.slice(d.from, d.to).startsWith("[^") && !NOTE.slice(d.from, d.to).endsWith(":"));
    expect(refs.map((d) => [NOTE.slice(d.from, d.to), d.widget!.number, d.widget!.href])).toEqual([
      ["[^x]", 1, "#fn-x"],
      ["[^Y]", 2, "#fn-y"],
      ["[^X]", 1, "#fn-x"],
    ]);
    // The reference with no note, and the note nothing cites, are left as written.
    expect(found.some((d) => NOTE.slice(d.from, d.to).includes("none"))).toBe(false);
    expect(found.some((d) => d.from >= NOTE.indexOf("[^unused]"))).toBe(false);
    // Each cited definition: its label (and the space after) is its number, and its line is set small.
    const numbers = found.filter((d) => d.widget && NOTE.slice(d.from, d.to).includes("]:"));
    expect(numbers.map((d) => [NOTE.slice(d.from, d.to), d.widget!.number, d.widget!.href])).toEqual([
      ["[^y]: ", 2, "#fnref-Y"],
      ["[^x]: ", 1, "#fnref-x"],
    ]);
    expect(found.filter((d) => d.kind === "cm-live-footnote-def").map((d) => d.from)).toEqual([NOTE.indexOf("[^y]:"), NOTE.indexOf("[^x]:")]);
  });

  it("shows the source, dimmed, while the caret is on a reference or a definition's line", () => {
    const onReference = draw(NOTE, NOTE.indexOf("[^x]") + 2);
    expect(onReference.find((d) => d.from === NOTE.indexOf("[^x]"))).toMatchObject({ widget: null, kind: "cm-live-syntax" });
    const onDefinition = draw(NOTE, NOTE.indexOf("Ex, with"));
    const label = onDefinition.filter((d) => d.from === NOTE.indexOf("[^x]:") && d.to > d.from);
    expect(label).toEqual([{ from: NOTE.indexOf("[^x]:"), to: NOTE.indexOf("[^x]:") + 5, widget: null, kind: "cm-live-syntax" }]);
  });

  it("reads a definition on to its lazy and indented lines, and stops at a blank line before anything else", () => {
    const doc = "a[^1]\n\n[^1]: one\n    more\nlazy\n\n    second para\n\nafter";
    const state = stateOf(doc);
    const mark = footnotesOf(state).definitions.get("1")!.mark;
    expect(doc.slice(0, definitionEnd(state.doc, mark)).endsWith("second para")).toBe(true);
  });
});

describe("<Footnotes /> in Live", () => {
  it("is drawn from a body that Preview's renderer numbers and words as it does the whole note", () => {
    const doc = `${NOTE}\n\n<Footnotes />`;
    const html = renderToStaticMarkup(<NoteMarkdown body={footnotesSource(stateOf(doc), "<Footnotes />")} rehypePlugins={[]} />);
    const whole = renderToStaticMarkup(<NoteMarkdown body={doc} rehypePlugins={[]} />);
    const items = (markup: string) => [...markup.matchAll(/<li id="[^"]*fn-([^"]+)">([\s\S]*?)<\/li>/g)].map((match) => [match[1], match[2].replace(/<[^>]+>/g, "").trim()]);
    expect(items(html)).toEqual([
      ["x", "Ex, with bold. ↩ ↩2"],
      ["y", "Why. ↩"],
    ]);
    expect(items(html)).toEqual(items(whole));
  });

  it("says there are none yet when nothing is cited", () => {
    const html = renderToStaticMarkup(<NoteMarkdown body={footnotesSource(stateOf("No notes.\n\n<Footnotes />"), "<Footnotes />")} rehypePlugins={[]} />);
    expect(html).toContain("No footnotes yet.");
  });
});
