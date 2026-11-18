import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { BlockWidget } from "./liveBlockWidget";
import { frontmatterEndOf, liveBlockKinds, liveBlocksField, redrawBlocks, revealBlocks, TABLE, type LiveBlocks } from "./liveBlocks";

const TABLE_1 = "| a | b |\n|---|---|\n| 1 | 2 |";
const TABLE_2 = "| c | d |\n|---|---|\n| 3 | 4 |";

/** A state with the whole note parsed, the caret at `caret`. */
function stateOf(doc: string, caret = 0, extensions: Extension = []): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage }), liveBlocksField, extensions],
  });
  // `ensureSyntaxTree` parses on the side; a transaction takes the finished tree into the state.
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/** Applies `spec`, then makes sure the tree is parsed to the end, as the editor's background parse would. */
function apply(state: EditorState, spec: TransactionSpec): EditorState {
  const next = state.update(spec).state;
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next.update({}).state;
}

const field = (state: EditorState): LiveBlocks => state.field(liveBlocksField);
const spans = (state: EditorState) => field(state).blocks.map(({ from, to }) => [from, to]);
const sliceOf = (state: EditorState, index: number) => {
  const { from, to } = field(state).blocks[index];
  return state.sliceDoc(from, to);
};

type Drawn = { from: number; to: number; source: string; beside: boolean; block: boolean };

/** What the field draws: each widget, where, of what source, and whether in place of the source or beside it. */
function drawn(state: EditorState): Drawn[] {
  const out: Drawn[] = [];
  field(state).decorations.between(0, state.doc.length, (from, to, value) => {
    const widget = value.spec.widget as BlockWidget;
    out.push({ from, to, source: widget.source, beside: widget.beside, block: !!value.spec.block });
  });
  return out;
}

describe("finding blocks", () => {
  it("finds each top-level table as whole lines and draws it in place of its source, away from the caret", () => {
    const doc = `Intro\n\n${TABLE_1}\n\nMiddle\n\n${TABLE_2}\n`;
    const state = stateOf(doc, 0);
    const first = doc.indexOf("| a");
    const second = doc.indexOf("| c");
    expect(spans(state)).toEqual([
      [first, first + TABLE_1.length],
      [second, second + TABLE_2.length],
    ]);
    expect(drawn(state)).toEqual([
      { from: first, to: first + TABLE_1.length, source: TABLE_1, beside: false, block: true },
      { from: second, to: second + TABLE_2.length, source: TABLE_2, beside: false, block: true },
    ]);
  });

  it("leaves a table in a list or a quote, or in the frontmatter, as written", () => {
    const quoted = TABLE_1.split("\n").map((line) => `> ${line}`).join("\n");
    expect(spans(stateOf(`${quoted}\n`, 0))).toEqual([]);
    expect(spans(stateOf(`- item\n\n  ${TABLE_1.replaceAll("\n", "\n  ")}\n`, 0))).toEqual([]);
  });

  it("does not take a table's last line break into it", () => {
    const state = stateOf(`${TABLE_1}\n\nAfter`, 20);
    expect(sliceOf(state, 0)).toBe(TABLE_1);
  });

  it("reads where the frontmatter ends from its lines", () => {
    expect(frontmatterEndOf(stateOf("---\ntitle: x\n---\nBody").doc)).toBe("---\ntitle: x\n---\n".length);
    expect(frontmatterEndOf(stateOf("Body\n---\n").doc)).toBe(0);
    // A `---` with nothing closing it is a rule, not frontmatter.
    expect(frontmatterEndOf(stateOf("---\nBody").doc)).toBe(0);
  });

  it("finds only the kinds it is told to", () => {
    const html = "<div>\nhi\n</div>";
    const doc = `${html}\n\n${TABLE_1}\n`;
    const state = stateOf(doc, doc.length, liveBlockKinds.of({ node: "HTMLBlock", accepts: (source) => source.startsWith("<div") }));
    // Given kinds replace the default, tables included.
    expect(field(state).blocks.map((block) => block.kind.node)).toEqual(["HTMLBlock"]);
    const both = stateOf(doc, doc.length, [liveBlockKinds.of(TABLE), liveBlockKinds.of({ node: "HTMLBlock" })]);
    expect(field(both).blocks.map((block) => block.kind.node)).toEqual(["HTMLBlock", "Table"]);
  });
});

describe("incremental reading", () => {
  const doc = `${TABLE_1}\n\nBetween the two.\n\n${TABLE_2}\n\nAfter.`;

  it("maps the blocks through a change elsewhere and keeps the same block objects' kind and drawing", () => {
    const state = stateOf(doc, doc.length);
    const before = field(state).blocks;
    const at = doc.indexOf("Between");
    const next = apply(state, { changes: { from: at, insert: "Text " }, selection: { anchor: at + 5 } });
    expect(spans(next)).toEqual([
      [before[0].from, before[0].to],
      [before[1].from + 5, before[1].to + 5],
    ]);
    // The second table's drawing is the same, so its widget is equal and is not redrawn.
    const [, second] = drawn(next);
    expect(second.source).toBe(TABLE_2);
    const widgets: BlockWidget[] = [];
    field(state).decorations.between(0, state.doc.length, (_f, _t, value) => void widgets.push(value.spec.widget));
    const nextWidgets: BlockWidget[] = [];
    field(next).decorations.between(0, next.doc.length, (_f, _t, value) => void nextWidgets.push(value.spec.widget));
    expect(nextWidgets[1].eq(widgets[1])).toBe(true);
  });

  it("re-reads a table that is typed in, and only it", () => {
    const state = stateOf(doc, doc.length);
    const first = field(state).blocks[0];
    const cell = doc.indexOf("2 |");
    const next = apply(state, { changes: { from: cell, insert: "22" } });
    expect(sliceOf(next, 0)).toBe(TABLE_1.replace("| 2 |", "| 222 |"));
    // The untouched table is the very same object, mapped.
    expect(field(next).blocks[0]).not.toBe(first);
    expect(field(next).blocks[1].kind).toBe(TABLE);
    expect(sliceOf(next, 1)).toBe(TABLE_2);
  });

  it("finds a table as soon as its delimiter row makes it one, and drops one that stops being one", () => {
    const start = "| x | y |\n";
    let state = stateOf(start, start.length);
    expect(spans(state)).toEqual([]);
    state = apply(state, { changes: { from: start.length, insert: "|---|---|" }, selection: { anchor: start.length + 9 } });
    expect(spans(state)).toEqual([[0, start.length + 9]]);
    state = apply(state, { changes: { from: start.length, to: start.length + 9 } });
    expect(spans(state)).toEqual([]);
  });

  it("splits a table typed apart by a blank line and joins it again", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    let state = stateOf(table, table.length);
    expect(spans(state)).toHaveLength(1);
    const cut = table.indexOf("| 3");
    state = apply(state, { changes: { from: cut, insert: "\n" } });
    expect(spans(state)).toEqual([[0, cut - 1]]);
    state = apply(state, { changes: { from: cut, to: cut + 1 } });
    expect(spans(state)).toEqual([[0, table.length]]);
  });

  it("drops the tables a code fence opened above them swallows, and finds them again when it closes", () => {
    let state = stateOf(doc, 0);
    expect(spans(state)).toHaveLength(2);
    const at = doc.indexOf("Between");
    state = apply(state, { changes: { from: at, insert: "```\n" } });
    expect(spans(state)).toHaveLength(1);
    state = apply(state, { changes: { from: at, to: at + 4 } });
    expect(spans(state)).toHaveLength(2);
  });

  it("drops a table that is deleted with what is around it", () => {
    const state = stateOf(doc, doc.length);
    const next = apply(state, { changes: { from: 0, to: doc.indexOf("Between") } });
    expect(spans(next)).toHaveLength(1);
    expect(sliceOf(next, 0)).toBe(TABLE_2);
  });

  it("reads a long note as the parser gets to it, without trusting a node the parser may have cut short", () => {
    const part = `${TABLE_1}\n\nSome words between the tables.\n\n`;
    const long = part.repeat(3000);
    const state = EditorState.create({ doc: long, extensions: [markdown({ base: markdownLanguage }), liveBlocksField] });
    // Only the start is parsed when the state is made.
    expect(syntaxTree(state).length).toBeLessThan(long.length);
    const early = field(state).blocks.length;
    expect(early).toBeLessThan(3000);
    expect(field(state).dirty.length).toBe(1);
    // The parser goes on; the state is told of the new tree, and the rest is read.
    ensureSyntaxTree(state, long.length, 10_000);
    const parsed = state.update({}).state;
    expect(field(parsed).blocks.length).toBe(3000);
    expect(field(parsed).dirty).toEqual([]);
    expect(field(parsed).blocks.every((block) => parsed.sliceDoc(block.from, block.to) === TABLE_1)).toBe(true);
  });

  it("follows the frontmatter as it is typed and taken away, and never draws inside it", () => {
    const body = `${TABLE_1}\n`;
    let state = stateOf(body, body.length);
    const yaml = "---\ntitle: x\n---\n";
    state = apply(state, { changes: { from: 0, insert: yaml } });
    expect(field(state).frontmatterEnd).toBe(yaml.length);
    expect(spans(state)).toEqual([[yaml.length, yaml.length + TABLE_1.length]]);
    state = apply(state, { changes: { from: 0, to: yaml.length } });
    expect(field(state).frontmatterEnd).toBe(0);
    expect(spans(state)).toEqual([[0, TABLE_1.length]]);
  });
});

describe("the reveal rule", () => {
  const doc = `Before\n\n${TABLE_1}\n\nAfter`;
  const from = doc.indexOf("| a");
  const to = from + TABLE_1.length;

  it("shows the source while the caret is anywhere in the table, ends included", () => {
    for (const caret of [from, from + 5, to]) {
      const state = apply(stateOf(doc, 0), { selection: { anchor: caret } });
      expect(drawn(state)).toEqual([{ from: to, to, source: TABLE_1, beside: true, block: true }]);
    }
    // The line before and the line after are not the table.
    expect(drawn(apply(stateOf(doc, 0), { selection: { anchor: from - 1 } }))[0].beside).toBe(false);
    expect(drawn(apply(stateOf(doc, 0), { selection: { anchor: to + 1 } }))[0].beside).toBe(false);
  });

  it("shows the source while a selection reaches into the table", () => {
    const state = apply(stateOf(doc, 0), { selection: { anchor: 0, head: from + 1 } });
    expect(drawn(state)[0].beside).toBe(true);
  });

  it("keeps the last drawing under the source while it is typed in, and redraws it on the pause", () => {
    let state = apply(stateOf(doc, 0), { selection: { anchor: from + 2 } });
    expect(field(state).pending).toBe(false);
    // Typing in a cell: the drawing under it is still the table as it was.
    state = apply(state, { changes: { from: from + 2, insert: "x" }, selection: { anchor: from + 3 } });
    expect(drawn(state)[0].source).toBe(TABLE_1);
    expect(field(state).pending).toBe(true);
    state = apply(state, { changes: { from: from + 3, insert: "y" } });
    expect(drawn(state)[0].source).toBe(TABLE_1);

    state = apply(state, { effects: redrawBlocks.of(null) });
    const now = state.sliceDoc(from, field(state).blocks[0].to);
    expect(drawn(state)[0]).toMatchObject({ source: now, beside: true });
    expect(field(state).pending).toBe(false);
  });

  it("keeps the drawing of a table that stops being one while it is typed, until the pause says it is not one", () => {
    let state = apply(stateOf(doc, 0), { selection: { anchor: from + 2 } });
    // A cell typed into the header row ahead of the delimiter row: for now it is not a table.
    state = apply(state, { changes: { from: from + 2, insert: "x | " }, selection: { anchor: from + 6 } });
    expect(drawn(state)).toEqual([{ from: to + 4, to: to + 4, source: TABLE_1, beside: true, block: true }]);
    // The delimiter row catches up before the pause: a table again, still with the drawing it had.
    const delimiter = state.doc.line(state.doc.lineAt(from).number + 1);
    state = apply(state, { changes: { from: delimiter.to, insert: "---|" }, selection: { anchor: delimiter.to + 4 } });
    expect(field(state).blocks).toHaveLength(1);
    expect(field(state).blocks[0].orphan).toBeUndefined();
    expect(drawn(state)[0].source).toBe(TABLE_1);
  });

  it("lets go of a table that is still not one at the pause, or when the caret leaves", () => {
    const broken = (state: EditorState) => apply(state, { changes: { from: from + 2, insert: "x | " }, selection: { anchor: from + 6 } });
    const typed = broken(apply(stateOf(doc, 0), { selection: { anchor: from + 2 } }));
    expect(drawn(apply(typed, { effects: redrawBlocks.of(null) }))).toEqual([]);
    expect(field(apply(typed, { effects: redrawBlocks.of(null) })).blocks).toEqual([]);
    expect(field(apply(typed, { selection: { anchor: 0 } })).blocks).toEqual([]);
  });

  it("draws the table as it is, at once, when the caret leaves it", () => {
    let state = apply(stateOf(doc, 0), { selection: { anchor: from + 2 } });
    state = apply(state, { changes: { from: from + 2, insert: "x" } });
    state = apply(state, { selection: { anchor: 0 } });
    expect(drawn(state)[0]).toMatchObject({ source: state.sliceDoc(from, field(state).blocks[0].to), beside: false });
    expect(field(state).pending).toBe(false);
  });

  it("has no drawing under a table being typed until the pause, so a half-typed one never shows", () => {
    const start = "| x | y |\n";
    let state = stateOf(start, start.length);
    state = apply(state, { changes: { from: start.length, insert: "|---|---|" }, selection: { anchor: start.length + 9 } });
    expect(spans(state)).toHaveLength(1);
    expect(drawn(state)).toEqual([]);
    expect(field(state).pending).toBe(true);
    state = apply(state, { effects: redrawBlocks.of(null) });
    expect(drawn(state)).toHaveLength(1);
  });

  it("a note opened with the caret in a table draws it after the first pause", () => {
    const state = stateOf(TABLE_1, 0);
    expect(drawn(state)).toEqual([]);
    expect(field(state).pending).toBe(true);
  });

  it("shows the source of the table holding find's current match, until it is replaced", () => {
    const at = doc.indexOf("2 |");
    let state = apply(stateOf(doc, 0), { effects: revealBlocks.of([{ from: at, to: at + 1 }]) });
    expect(drawn(state)[0].beside).toBe(true);
    // Typing above maps the match with the text.
    state = apply(state, { changes: { from: 0, insert: "More " } });
    expect(drawn(state)[0].beside).toBe(true);
    state = apply(state, { effects: revealBlocks.of([]) });
    expect(drawn(state)[0].beside).toBe(false);
  });

  it("an undo across a table finds it again", () => {
    // What undo does to the field: the text goes back, and the table is read again from it.
    let state = stateOf(doc, 0);
    state = apply(state, { changes: { from: from - 2, to: to + 2 } });
    expect(spans(state)).toEqual([]);
    state = apply(state, { changes: { from: from - 2, insert: `\n\n${TABLE_1}\n\n` }, selection: { anchor: 0 } });
    expect(spans(state)).toEqual([[from, to]]);
    expect(drawn(state)[0]).toMatchObject({ source: TABLE_1, beside: false });
  });
});
