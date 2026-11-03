import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parse } from "@/lib/composition/frontmatter";
import { markTints, type Tint } from "./markTints";
import { tokenizeMarkdown } from "./markdownTokens";
import { MAX_HIGHLIGHT_CHARS } from "./MarkdownHighlight";
import { HIGHLIGHT_COLORS } from "./mdx/highlightColors";

/**
 * The live editor's Markdown: the text stays what it is (the document is the Markdown source, character for
 * character), and only how it is drawn changes. A bold, italic, struck-through or code span is drawn styled with its
 * marks (`**`, `*`, `~~`, `` ` ``) hidden, and a heading is drawn large with its `# ` hidden, except where the caret
 * (or a selection) touches it: there the marks are shown, dimmed, so what is being typed or edited is the syntax.
 * Moving the caret out of the construct, by typing on past it or by clicking elsewhere, hides them again.
 *
 * "Touches" includes the caret sitting right after the closing mark, so `**some text**|` still shows its marks and
 * `**some text** |`, the next word begun, does not.
 */

/** The inline constructs that hide their marks, by the syntax-tree node that holds them → the node of their marks. */
const INLINE: Record<string, { mark: string; class: string }> = {
  StrongEmphasis: { mark: "EmphasisMark", class: "cm-live-strong" },
  Emphasis: { mark: "EmphasisMark", class: "cm-live-emphasis" },
  Strikethrough: { mark: "StrikethroughMark", class: "cm-live-strike" },
  InlineCode: { mark: "CodeMark", class: "cm-live-code" },
};

const HEADING = /^ATXHeading([1-6])$/;

const hidden = Decoration.replace({});
const syntax = Decoration.mark({ class: "cm-live-syntax" });
const headingLine = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `cm-live-heading cm-live-h${level}` }));
const frontmatterLine = Decoration.line({ class: "cm-live-frontmatter" });
/** The tint behind the text of a `<Mark color="…">`, which is the same one the plain editor paints (see `.md-mark`). */
const tintMarks = new Map(HIGHLIGHT_COLORS.map((color) => [color, Decoration.mark({ class: "md-mark", attributes: { "data-color": color } })]));
const styles = new Map(Object.values(INLINE).map(({ class: name }) => [name, Decoration.mark({ class: name })]));

type Span = { from: number; to: number };

/** Whether the caret, or any selection, reaches `from`..`to`, ends included. */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Where the note's text proper starts: after the frontmatter, which is YAML and not Markdown (its closing `---`
 * would otherwise read as a heading's underline).
 */
export function bodyStart(text: string): number {
  return text.length - parse(text)[1].length;
}

/**
 * Where the text is highlighted: between each `<Mark color="…">` and its `</Mark>`. Found the way the plain editor
 * finds them, and skipped, as it does, for a note too long to colour on every keystroke.
 */
export function tintsOf(text: string): Tint[] {
  return text.length <= MAX_HIGHLIGHT_CHARS && text.includes("<Mark") ? markTints(text, tokenizeMarkdown(text)) : [];
}

/**
 * The decorations for the parts of the document inside `ranges` (the viewport, normally). `frontmatterEnd` is where
 * the frontmatter ends (see `bodyStart`); it is left as plain, monospaced text. `tints` (see `tintsOf`) are painted
 * behind the highlighted text, wherever it is.
 */
export function liveDecorations(state: EditorState, ranges: readonly Span[], frontmatterEnd: number, tints: readonly Tint[] = []): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const doc = state.doc;

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from: Math.max(from, frontmatterEnd),
      to,
      enter(node) {
        if (node.from < frontmatterEnd) return;

        const heading = HEADING.exec(node.name);
        if (heading) {
          decorations.push(headingLine[Number(heading[1]) - 1].range(doc.lineAt(node.from).from));
          const active = touches(state, node.from, node.to);
          let first = true;
          for (let mark = node.node.firstChild; mark; mark = mark.nextSibling) {
            if (mark.name !== "HeaderMark") continue;
            // The space after the opening `#`s goes with them, or the title would sit indented.
            const gap = first && doc.sliceString(mark.to, mark.to + 1) === " " ? 1 : 0;
            first = false;
            if (active) decorations.push(syntax.range(mark.from, mark.to));
            else decorations.push(hidden.range(mark.from, mark.to + gap));
          }
          return;
        }

        const inline = INLINE[node.name];
        if (!inline) return;
        decorations.push(styles.get(inline.class)!.range(node.from, node.to));
        const active = touches(state, node.from, node.to);
        for (let mark = node.node.firstChild; mark; mark = mark.nextSibling) {
          if (mark.name !== inline.mark || mark.from === mark.to) continue;
          decorations.push(active ? syntax.range(mark.from, mark.to) : hidden.range(mark.from, mark.to));
        }
      },
    });
  }

  for (const { start, end, color } of tints) {
    if (start < end && end <= doc.length) decorations.push(tintMarks.get(color)!.range(start, end));
  }

  if (frontmatterEnd > 0) {
    const last = doc.lineAt(Math.min(frontmatterEnd - 1, doc.length)).number;
    for (let number = 1; number <= last; number++) decorations.push(frontmatterLine.range(doc.line(number).from));
  }

  // Decoration sets are built in order; the tree is walked in order but the frontmatter's lines come last.
  return Decoration.set(decorations, true);
}

/** Draws the Markdown as above, for what is on screen. */
const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    frontmatterEnd: number;
    tints: Tint[];

    constructor(view: EditorView) {
      const text = view.state.doc.toString();
      this.frontmatterEnd = bodyStart(text);
      this.tints = tintsOf(text);
      this.decorations = liveDecorations(view.state, view.visibleRanges, this.frontmatterEnd, this.tints);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        this.frontmatterEnd = bodyStart(text);
        this.tints = tintsOf(text);
      }
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = liveDecorations(update.state, update.view.visibleRanges, this.frontmatterEnd, this.tints);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The look of what `liveDecorations` marks up. Sizes follow the preview's `prose`. */
const liveTheme = EditorView.baseTheme({
  ".cm-live-strong": { fontWeight: "700" },
  ".cm-live-emphasis": { fontStyle: "italic" },
  ".cm-live-strike": { textDecoration: "line-through" },
  ".cm-live-code": {
    fontFamily: "var(--editor-font, var(--font-mono))",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
    borderRadius: "0.25rem",
  },
  // Marks that are showing because the caret is in their construct: there, but not in the way.
  ".cm-live-syntax": { color: "var(--muted-foreground)", fontWeight: "400", fontStyle: "normal" },
  ".cm-live-heading": { fontWeight: "700", lineHeight: "1.4" },
  ".cm-live-h1": { fontSize: "2em", lineHeight: "1.3" },
  ".cm-live-h2": { fontSize: "1.5em" },
  ".cm-live-h3": { fontSize: "1.25em" },
  ".cm-live-frontmatter": {
    fontFamily: "var(--editor-font, var(--font-mono))",
    fontSize: "0.85em",
    color: "var(--muted-foreground)",
  },
});

/** Everything the live editor needs to draw Markdown: put it in an editor that has the Markdown language. */
export const liveMarkdown: Extension = [liveMarkdownPlugin, liveTheme];
