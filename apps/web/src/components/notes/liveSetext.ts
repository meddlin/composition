import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { frontmatterEndIn } from "./liveFrontmatter";

/**
 * Setext headings in the Live tab (Step 7 of docs/live-default-plan.md): a paragraph underlined with `===` is drawn
 * as a level 1 heading and one underlined with `---` as a level 2, with the look `#` headings have. Away from the
 * caret the underline's line is collapsed to nothing (its text stays in the document, as a code fence's does, see
 * `liveCode`): a view plugin may not hide a line break, but it may give a line no height. While the caret or a
 * selection touches the heading, the underline shows, dimmed, as `#` does.
 */

const SETEXT = /^SetextHeading([12])$/;

const headingLine = [1, 2].map((level) => Decoration.line({ class: `cm-live-heading cm-live-h${level} cm-live-setext` }));
const hiddenLine = Decoration.line({ class: "cm-live-setext-hidden" });
const syntax = Decoration.mark({ class: "cm-live-syntax" });

type Span = { from: number; to: number };

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** The decorations for the setext headings inside `ranges`, none of them before `frontmatterEnd`. */
export function setextDecorations(state: EditorState, ranges: readonly Span[], frontmatterEnd: number): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  const doc = state.doc;
  let last = -1;
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from: Math.max(from, frontmatterEnd),
      to,
      enter(node) {
        const match = SETEXT.exec(node.name);
        if (!match) return;
        // Visible ranges can share a heading; it is drawn once.
        if (node.from < frontmatterEnd || node.from <= last) return false;
        last = node.from;
        const underline = node.node.getChild("HeaderMark");
        if (!underline) return false;
        const mark = doc.lineAt(underline.from);
        for (let number = doc.lineAt(node.from).number; number < mark.number; number++) {
          decorations.push(headingLine[Number(match[1]) - 1].range(doc.line(number).from));
        }
        if (touches(state, node.from, node.to)) decorations.push(syntax.range(underline.from, underline.to));
        else decorations.push(hiddenLine.range(mark.from));
        return false;
      },
    });
  }
  return decorations;
}

const setextPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.read(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = this.read(update.view);
      }
    }

    read(view: EditorView) {
      return Decoration.set(setextDecorations(view.state, view.visibleRanges, frontmatterEndIn(view.state)), true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const setextTheme = EditorView.baseTheme({
  // The underline's line while the caret is elsewhere: there, but no height (see `liveCode`'s fences).
  ".cm-line.cm-live-setext-hidden": { height: "0", overflow: "hidden", padding: "0" },
});

/** Setext headings drawn as headings. */
export const liveSetext: Extension = [setextPlugin, setextTheme];
