import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { liveReflow } from "./liveReflow";

const options = { column: 20, keepTables: true };

/** A note's state, with the caret at the end of `text` and reflow on. */
const stateOf = (text: string, reflow = options) =>
  EditorState.create({ doc: text, selection: EditorSelection.cursor(text.length), extensions: liveReflow(reflow) });

/** What one change does to `text` with the caret at the end: the new text and where the caret ends up. */
function apply(text: string, spec: (end: number) => TransactionSpec, reflow = options) {
  const state = stateOf(text, reflow);
  const tr = state.update(spec(text.length));
  return { text: tr.state.doc.toString(), caret: tr.state.selection.main.head, transaction: tr };
}

/** One character typed at the end. */
const typed = (char: string) => (end: number): TransactionSpec => ({
  changes: { from: end, insert: char },
  selection: { anchor: end + 1 },
  userEvent: "input.type",
});

describe("liveReflow", () => {
  it("breaks the line when a typed character takes it past the column, keeping the caret after the character", () => {
    // 20 characters fit the column; the 21st does not.
    expect(apply("the quick brown fox", typed(" ")).text).toBe("the quick brown fox ");

    const next = apply("the quick brown fox ", typed("j"));
    expect(next.text).toBe("the quick brown fox\nj");
    expect(next.caret).toBe(next.text.length);
  });

  it("does it inside the typed character's own transaction, so there is one step to undo", () => {
    const { transaction } = apply("the quick brown fox ", typed("j"));

    expect(transaction.docChanged).toBe(true);
    // One transaction made both the typed character and the break; its changes together read as one edit.
    expect(transaction.newDoc.toString()).toBe("the quick brown fox\nj");
    expect(transaction.isUserEvent("input.type")).toBe(true);
  });

  it("lines a list item's continuation up under its text", () => {
    // The 21st character takes "- the quick brown fox" past the column.
    expect(apply("- the quick brown fo", typed("x")).text).toBe("- the quick brown\n  fox");
  });

  it("leaves a table row whole, or breaks it when asked", () => {
    const row = "| the quick brown fox | jumps over";
    expect(apply(row, typed(" ")).text).toBe(`${row} `);
    expect(apply(row, typed(" "), { ...options, keepTables: false }).text).toContain("\n");
  });

  it("leaves a line that still fits alone", () => {
    expect(apply("short", typed("!")).text).toBe("short!");
  });

  it.each([
    ["pasting", "input.paste"],
    ["dropping", "input.drop"],
    ["Enter", "input"],
    ["deleting", "delete.backward"],
    ["undoing", "undo"],
    ["composing", "input.type.compose"],
  ])("leaves the text as it is when it is %s", (_name, userEvent) => {
    const long = "the quick brown fox jumps over the lazy dog";

    expect(apply("", (end) => ({ changes: { from: end, insert: long }, userEvent })).text).toBe(long);
  });

  it("leaves a change that is not typing alone, with no event at all", () => {
    expect(apply("", (end) => ({ changes: { from: end, insert: "the quick brown fox jumps over" } })).text).toBe(
      "the quick brown fox jumps over",
    );
  });

  it("does not reflow several changes at once, or text with a new line in it", () => {
    const long = "the quick brown fox jumps over";
    const state = stateOf("ab");

    // Two edits apart (as a multiple cursor makes), not one.
    const two = state.update({ changes: [{ from: 0, insert: long }, { from: 2, insert: "!" }], userEvent: "input.type" });
    expect(two.state.doc.toString()).toBe(`${long}ab!`);
    expect(state.update({ changes: { from: 2, insert: `${long}\nmore` }, userEvent: "input.type" }).state.doc.toString()).toBe(`ab${long}\nmore`);
  });

  it("is a word typed at once too (what an autocorrect puts in), as the Markdown editor reflows an insertText", () => {
    expect(apply("the quick brown fox ", (end) => ({ changes: { from: end, insert: "jumps" }, selection: { anchor: end + 5 }, userEvent: "input.type" })).text).toBe(
      "the quick brown fox\njumps",
    );
  });
});
