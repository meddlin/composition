import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parse } from "@/lib/composition/frontmatter";
import { ImageWidget, imageElements, markdownImageSrc, markdownImageTitle, type ImageElement, type NoteImageSpec } from "./liveImages";
import { InkWidget } from "./liveInk";
import { markElements, markTints, type MarkElement, type Tint } from "./markTints";
import { tokenizeMarkdown, type TokenKind } from "./markdownTokens";
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
const ruleLine = Decoration.line({ class: "cm-live-rule" });
/** The tint behind the text of a `<Mark color="…">`, which is the same one the plain editor paints (see `.md-mark`). */
const tintMarks = new Map(HIGHLIGHT_COLORS.map((color) => [color, Decoration.mark({ class: "md-mark", attributes: { "data-color": color } })]));
const styles = new Map(Object.values(INLINE).map(({ class: name }) => [name, Decoration.mark({ class: name })]));

type Span = { from: number; to: number };

/** A node of the Markdown syntax tree (its package is not one of ours to import from). */
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

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
 * The kinds of text the plain editor colours that the live editor colours the same way: code and its fences, rules,
 * links and their addresses, tags, and list and quote marks. The rest it draws its own way (headings large, bold and
 * italic as such, frontmatter set apart), so colouring them too would only fight that.
 */
const COLOURED: ReadonlySet<TokenKind> = new Set(["fence", "code", "rule", "url", "link", "tag", "marker"]);
const tokenMarks = new Map([...COLOURED].map((kind) => [kind, Decoration.mark({ class: `md-${kind}` })]));

type Token = { start: number; end: number; kind: TokenKind };

/** What the live editor needs to know of a note's text beyond its Markdown syntax tree. */
export type NoteScan = {
  /** The text of each highlight, to tint. */
  tints: readonly Tint[];
  /** Each highlight's pair of tags (hidden like `**` while the caret is elsewhere). */
  elements: readonly MarkElement[];
  /** The runs the plain editor colours, and in which of its colours (the `md-…` classes). */
  tokens: readonly Token[];
  /** Each `<Image … />`, to draw (Markdown's `![alt](src)` is found in the syntax tree instead). */
  images: readonly ImageElement[];
  /** Each `<Ink … />`, to draw from its strokes. */
  inks: readonly ImageElement[];
};

const NO_SCAN: NoteScan = { tints: [], elements: [], tokens: [], images: [], inks: [] };

/**
 * Reads the note the way the plain editor does to colour it: its runs (`tokenizeMarkdown`), the text between each
 * `<Mark color="…">` and its `</Mark>`, and where those tags are. Skipped, as it does, for a note too long to colour
 * on every keystroke.
 */
export function scanOf(text: string): NoteScan {
  if (text.length > MAX_HIGHLIGHT_CHARS) return NO_SCAN;
  const segments = tokenizeMarkdown(text);

  const tokens: Token[] = [];
  let at = 0;
  for (const { text: run, kind } of segments) {
    if (kind && COLOURED.has(kind)) tokens.push({ start: at, end: at + run.length, kind });
    at += run.length;
  }
  const images = imageElements(text, segments);
  const inks = imageElements(text, segments, "Ink");
  if (!text.includes("<Mark")) return { tints: [], elements: [], tokens, images, inks };
  return { tints: markTints(text, segments), elements: markElements(text, segments), tokens, images, inks };
}

/** What a Markdown `![alt](src "title")` shows, or null when it has no address of its own (`![alt][ref]`). */
function markdownImage(state: EditorState, image: SyntaxNode): NoteImageSpec | null {
  const url = image.getChild("URL");
  if (!url) return null;
  const src = markdownImageSrc(state.sliceDoc(url.from, url.to));
  if (src === "") return null;
  const title = image.getChild("LinkTitle");
  // The alt text is what lies between the `![` and the `]` that closes it.
  const marks = image.getChildren("LinkMark");
  const alt = marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
  return { src, alt, title: title ? markdownImageTitle(state.sliceDoc(title.from, title.to)) : "", width: "" };
}

/**
 * Draws a picture in place of the text that writes it. While the caret is on that text it stays, as the syntax of
 * anything does, and the picture is drawn after it, so what is being typed or edited is the text and is still seen.
 */
function drawImage(decorations: Range<Decoration>[], image: NoteImageSpec, from: number, to: number, active: boolean, Widget: typeof ImageWidget | typeof InkWidget = ImageWidget) {
  if (active) decorations.push(Decoration.widget({ widget: new Widget(image, true), side: 1 }).range(to));
  else decorations.push(Decoration.replace({ widget: new Widget(image, false) }).range(from, to));
}

/**
 * The decorations for the parts of the document inside `ranges` (the viewport, normally). `frontmatterEnd` is where
 * the frontmatter ends (see `bodyStart`); it is left as plain, monospaced text. `scan` (see `scanOf`) is where the
 * text is coloured as the plain editor colours it, and where it is highlighted: tinted behind the text, wherever it
 * is, with the tags hidden as `**` is: shown, dimmed, only while the selection touches the element, from its
 * opening tag to its closing one.
 */
export function liveDecorations(
  state: EditorState,
  ranges: readonly Span[],
  frontmatterEnd: number,
  scan: NoteScan = NO_SCAN,
): DecorationSet {
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

        if (node.name === "HorizontalRule") {
          // Drawn as a line across the page, with the `---` hidden, unless the caret is on it (typing it, or editing it).
          if (touches(state, node.from, node.to)) return;
          decorations.push(ruleLine.range(doc.lineAt(node.from).from));
          decorations.push(hidden.range(node.from, node.to));
          return;
        }

        if (node.name === "Image") {
          const image = markdownImage(state, node.node);
          if (!image) return;
          drawImage(decorations, image, node.from, node.to, touches(state, node.from, node.to));
          return false;
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

  for (const { start, end, kind } of scan.tokens) {
    if (start < end && end <= doc.length) decorations.push(tokenMarks.get(kind)!.range(start, end));
  }
  for (const { start, end, color } of scan.tints) {
    if (start < end && end <= doc.length) decorations.push(tintMarks.get(color)!.range(start, end));
  }
  for (const { start, end, ...image } of scan.images) {
    if (end <= doc.length) drawImage(decorations, image, start, end, touches(state, start, end));
  }
  for (const { start, end, ...drawing } of scan.inks) {
    if (end <= doc.length) drawImage(decorations, drawing, start, end, touches(state, start, end), InkWidget);
  }
  for (const { open, close } of scan.elements) {
    if (close.end > doc.length) continue;
    const active = touches(state, open.start, close.end);
    for (const tag of [open, close]) {
      // A tag that runs over a line break can't be hidden by a plugin, so it is left showing, dimmed like the rest.
      if (active || doc.sliceString(tag.start, tag.end).includes("\n")) decorations.push(syntax.range(tag.start, tag.end));
      else decorations.push(hidden.range(tag.start, tag.end));
    }
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
    scan: NoteScan;

    constructor(view: EditorView) {
      const text = view.state.doc.toString();
      this.frontmatterEnd = bodyStart(text);
      this.scan = scanOf(text);
      this.decorations = liveDecorations(view.state, view.visibleRanges, this.frontmatterEnd, this.scan);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        this.frontmatterEnd = bodyStart(text);
        this.scan = scanOf(text);
      }
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = liveDecorations(update.state, update.view.visibleRanges, this.frontmatterEnd, this.scan);
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
  // A horizontal rule: the line's `---` is hidden, so the line is empty and the rule is drawn through its middle.
  ".cm-live-rule": {
    // Not `--border`: that is a hairline tint meant for panel edges, too faint to read as a rule on the page.
    backgroundImage: "linear-gradient(color-mix(in srgb, var(--foreground) 35%, transparent), color-mix(in srgb, var(--foreground) 35%, transparent))",
    backgroundSize: "100% 1px",
    backgroundPosition: "0 50%",
    backgroundRepeat: "no-repeat",
  },
  // A picture drawn in the text: never wider than the note, and sitting on the line like a word.
  ".cm-live-image": { display: "inline-block", maxWidth: "100%", verticalAlign: "bottom" },
  ".cm-live-image img": { display: "block", maxWidth: "100%", height: "auto" },
  // A drawing is an SVG; its colours are the page's tokens (`--foreground`), so a scheme restyles it.
  ".cm-live-image svg": { display: "block", maxWidth: "100%", height: "auto" },
  ".cm-live-image-missing": { color: "var(--muted-foreground)", fontStyle: "italic" },
  ".cm-live-frontmatter": {
    fontFamily: "var(--editor-font, var(--font-mono))",
    fontSize: "0.85em",
    color: "var(--muted-foreground)",
  },
});

/** Everything the live editor needs to draw Markdown: put it in an editor that has the Markdown language. */
export const liveMarkdown: Extension = [liveMarkdownPlugin, liveTheme];
