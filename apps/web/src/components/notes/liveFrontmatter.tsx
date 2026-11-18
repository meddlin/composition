import { EditorSelection, Prec, StateEffect, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { useMemo } from "react";
import { parse } from "@/lib/composition/frontmatter";
import { FrontmatterCard } from "./FrontmatterCard";
import { BlockWidget, type BlockKind, type BlockPlace } from "./liveBlockWidget";
import { bodyStart, frontmatterEndAfter } from "./liveMarkdown";

/**
 * The frontmatter in the Live tab (decision D5 of docs/live-default-plan.md). Away from the caret it is drawn as
 * Preview's `FrontmatterCard`, through the block layer's widget, in place of its YAML. While the caret is in it only
 * the YAML shows, with no card under it: the card would repeat it word for word. This is the one exception to the
 * rule that a block being edited keeps its drawing under its source (D3).
 *
 * "The caret is in it" also needs the editor to have focus. A note opens with the caret at its very start, which is
 * in the frontmatter, and the card is what should show then; a click on the card, or arrowing up into it, puts the
 * caret there with the editor focused, which shows the YAML.
 *
 * It is its own state field, not one of `liveBlocks`' kinds, because the frontmatter is not a node of the Markdown
 * syntax tree (the parser reads its `---` lines as a rule and a heading's underline).
 */

/** Sent when the editor gains or loses focus. */
const setFocused = StateEffect.define<boolean>();

export type LiveFrontmatter = {
  /** Where the note's body starts (see `bodyStart`); 0 when there is no frontmatter. */
  end: number;
  /** The end of the frontmatter's closing `---` line, which the card replaces up to; 0 when there is none. */
  cardTo: number;
  focused: boolean;
  /** Whether the YAML is showing (the caret is in it, in a focused editor), so the card is not. */
  active: boolean;
  decorations: DecorationSet;
};

/** Where the closing `---` line of a frontmatter that ends the body at `end` ends: 0 when there is no frontmatter. */
function cardEnd(doc: Text, end: number): number {
  if (end === 0) return 0;
  for (let line = doc.lineAt(Math.min(end, doc.length)); line.number > 1; line = doc.line(line.number - 1)) {
    if (line.from < end && /^---[ \t]*\r?$/.test(line.text)) return line.to;
  }
  return 0;
}

function touches(state: EditorState, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to);
}

const FRONTMATTER_PLACE = (view: EditorView): BlockPlace => ({ start: 0, bodyStart: view.state.field(liveFrontmatterField).end });

/** The card, drawn by Preview's own component from the frontmatter's source. */
function FrontmatterDrawing({ source }: { source: string }) {
  const fm = useMemo(() => parse(`${source}\n`)[0], [source]);
  return fm ? <FrontmatterCard fm={fm} /> : null;
}

/** The frontmatter, drawn as a block (see `BlockKind`). */
export const FRONTMATTER: BlockKind = { node: "Frontmatter", Drawing: FrontmatterDrawing };

function decorate(state: EditorState, cardTo: number, active: boolean): DecorationSet {
  if (cardTo === 0 || active) return Decoration.none;
  const widget = new BlockWidget(state.doc.sliceString(0, cardTo), FRONTMATTER, false, FRONTMATTER_PLACE);
  return Decoration.set([Decoration.replace({ widget, block: true }).range(0, cardTo)]);
}

function settle(state: EditorState, end: number, focused: boolean, previous?: LiveFrontmatter): LiveFrontmatter {
  const cardTo = cardEnd(state.doc, end);
  const active = cardTo > 0 && focused && touches(state, cardTo);
  // With the text unchanged (`previous` is only given then), the card is the same one if it is still drawn.
  const same = previous && previous.cardTo === cardTo && previous.active === active;
  const decorations = same ? previous.decorations : decorate(state, cardTo, active);
  return { end, cardTo, focused, active, decorations };
}

/** The frontmatter's place in the note, and its card. */
export const liveFrontmatterField = StateField.define<LiveFrontmatter>({
  create: (state) => settle(state, bodyStart(state.doc.toString()), false),
  update(value, tr) {
    let focused = value.focused;
    for (const effect of tr.effects) if (effect.is(setFocused)) focused = effect.value;
    if (!tr.docChanged && !tr.selection && focused === value.focused) return value;
    const end = tr.docChanged ? frontmatterEndAfter(tr.state.doc, tr.changes, value.end) : value.end;
    return settle(tr.state, end, focused, tr.docChanged ? undefined : value);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Where the frontmatter ends in `state` (0 when there is none, or the editor has no frontmatter layer). */
export function frontmatterEndIn(state: EditorState): number {
  return state.field(liveFrontmatterField, false)?.end ?? bodyStart(state.doc.toString());
}

/**
 * Up from the first line under the card goes into the frontmatter's last line, as it would into the YAML (CodeMirror
 * would otherwise move past a block widget in one go, or not at all at the top of the note).
 */
function upIntoCard(extend: boolean) {
  return (view: EditorView): boolean => {
    const { cardTo, active } = view.state.field(liveFrontmatterField);
    if (cardTo === 0 || active) return false;
    const { state } = view;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    if (line.from > cardTo + 1) return false;
    const last = state.doc.lineAt(cardTo);
    const at = last.from + Math.min(range.head - line.from, last.length);
    view.dispatch({
      selection: extend ? EditorSelection.range(range.anchor, at) : EditorSelection.cursor(at),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

const cardArrows = Prec.high(keymap.of([{ key: "ArrowUp", run: upIntoCard(false), shift: upIntoCard(true) }]));

/** The frontmatter drawn as its card away from the caret (D5). */
export const liveFrontmatter: Extension = [
  liveFrontmatterField,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  cardArrows,
];
