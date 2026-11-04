import { EditorState, type Extension } from "@codemirror/state";
import { changedSpan, reflowAtCaret, type ReflowOptions } from "./reflowText";

/**
 * Reflow in the live editor, as in the plain one: a line that typing has pushed past the column is broken there.
 * Only typing does it (a character, or a word an autocorrect puts in); pasting, dropping, deleting, undoing,
 * Enter and composing leave the text as it is. It is the same `reflowAtCaret`, so the breaks fall in the same places.
 *
 * The break goes into the same transaction as the character that caused it, so undo takes both back together,
 * where the textarea editor, which can only do it afterwards, makes the break a step of its own.
 */
export function liveReflow({ column, keepTables }: ReflowOptions): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !tr.isUserEvent("input.type") || tr.isUserEvent("input.type.compose")) return tr;

    let changes = 0;
    let multiline = false;
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      changes++;
      if (inserted.lines > 1) multiline = true;
    });
    if (changes !== 1 || multiline) return tr;

    const caret = tr.newSelection.main.head;
    // The usual keystroke is nowhere near the column, and that is settled without reading the whole note.
    if (tr.newDoc.lineAt(caret).length <= column) return tr;

    const text = tr.newDoc.toString();
    const edit = reflowAtCaret(text, caret, { column, keepTables });
    if (!edit) return tr;

    const { start, end, insert } = changedSpan(text, edit.text);
    // `sequential`: the break is placed in the text as the typed character left it.
    return [tr, { changes: { from: start, to: end, insert }, selection: { anchor: edit.caret }, sequential: true }];
  });
}
