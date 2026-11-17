import { syntaxTree } from "@codemirror/language";
import type { ChangeSet, EditorState, Extension, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parse } from "@/lib/composition/frontmatter";
import { ImageWidget, imageElements, markdownImageSrc, markdownImageTitle, type ImageElement, type NoteImageSpec } from "./liveImages";
import { InkWidget } from "./liveInk";
import { markElements, markTints, type MarkElement, type Tint } from "./markTints";
import { fenceOpenedBy, tokenizeMarkdown, type Fence, type TokenizeFrom, type TokenKind } from "./markdownTokens";
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

type Positioned = { start: number; end: number };

/**
 * Reads `text` the way the plain editor does to colour it: its runs (`tokenizeMarkdown`), the text between each
 * `<Mark color="…">` and its `</Mark>`, where those tags are, and each `<Image />` and `<Ink />`. `text` starts at
 * `offset` in the note, and every position in the result is the note's.
 */
function scanText(text: string, offset: number, from: TokenizeFrom): NoteScan {
  const segments = tokenizeMarkdown(text, from);
  const move = <T extends Positioned>(item: T): T => ({ ...item, start: item.start + offset, end: item.end + offset });

  const tokens: Token[] = [];
  let at = offset;
  for (const { text: run, kind } of segments) {
    if (kind && COLOURED.has(kind)) tokens.push({ start: at, end: at + run.length, kind });
    at += run.length;
  }
  const images = imageElements(text, segments).map(move);
  const inks = imageElements(text, segments, "Ink").map(move);
  if (!text.includes("<Mark")) return { tints: [], elements: [], tokens, images, inks };
  return {
    tints: markTints(text, segments).map(move),
    elements: markElements(text, segments).map(({ open, close }) => ({ open: move(open), close: move(close) })),
    tokens,
    images,
    inks,
  };
}

/** The whole of `text` read as `scanAround` reads part of a note. */
export function scanOf(text: string): NoteScan {
  return scanText(text, 0, { frontmatter: true, fence: null });
}

/**
 * How far past what is on screen `scanAround` reads, either way. A highlight is tinted while its opening and closing
 * tags are both inside that, so one that opens further above the screen than this is drawn untinted, its tags showing.
 */
export const SCAN_MARGIN = 10_000;

/**
 * The code fence the line starting at `pos` is inside, from the syntax tree (which CodeMirror keeps up to date as
 * the note changes, without reading it all again), as `tokenizeMarkdown` would have found it by reading from the
 * top. Null outside a fence, on its opening line (which opens it), and for a fence the tokenizer does not take for
 * one (inside a quote or behind a list marker).
 */
function fenceAt(state: EditorState, pos: number): Fence | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== "FencedCode") continue;
    return node.from < pos ? fenceOpenedBy(state.doc.lineAt(node.from).text) : null;
  }
  return null;
}

/**
 * What `scanOf` finds, for the part of the note around `around` (what is on screen): the lines from `SCAN_MARGIN`
 * above it to `SCAN_MARGIN` below it, never the frontmatter (which ends at `frontmatterEnd`). The tokenizer reads a
 * line at a time and remembers only whether it is in a code fence, so starting at a line in the middle with the
 * fence the syntax tree says it is in gives the same runs as reading from the top, and a keystroke costs the same in
 * a note of any length.
 */
export function scanAround(state: EditorState, around: Span, frontmatterEnd: number): NoteScan {
  const doc = state.doc;
  const from = Math.max(frontmatterEnd, doc.lineAt(Math.max(0, Math.min(around.from, doc.length) - SCAN_MARGIN)).from);
  const to = doc.lineAt(Math.min(doc.length, Math.max(around.to, from) + SCAN_MARGIN)).to;
  if (from >= to) return NO_SCAN;
  // At the very top, a block that is not yet valid frontmatter (being typed) is still read as one, as the plain editor reads it.
  return scanText(doc.sliceString(from, to), from, { frontmatter: from === 0, fence: fenceAt(state, from) });
}

/**
 * Where the frontmatter ends once `changes` (which made `doc`) are made, given where it ended before them. It is
 * read again (see `bodyStart`) only when a change could have moved it: one at or above its end, or anywhere in a note
 * that starts with `---` and has none yet (the closing line may just have been typed). Typing below it reads nothing.
 */
export function frontmatterEndAfter(doc: Text, changes: ChangeSet, before: number): number {
  if (doc.sliceString(0, 3) !== "---") return 0;
  let touched = before === 0;
  changes.iterChangedRanges((fromA) => {
    if (fromA <= before) touched = true;
  });
  return touched ? bodyStart(doc.toString()) : before;
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
 * the frontmatter ends (see `bodyStart`); it is left as plain, monospaced text. `scan` (see `scanAround`) is where the
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

/**
 * Draws the Markdown as above, for what is on screen. Nothing it does on a keystroke reads the whole note, so a note
 * of any length is drawn in full: the Markdown tab's colours stop at `MAX_HIGHLIGHT_CHARS`, and this does not.
 */
const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    frontmatterEnd: number;
    scan: NoteScan;

    constructor(view: EditorView) {
      this.frontmatterEnd = bodyStart(view.state.doc.toString());
      this.scan = scanAround(view.state, view.viewport, this.frontmatterEnd);
      this.decorations = liveDecorations(view.state, view.visibleRanges, this.frontmatterEnd, this.scan);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.frontmatterEnd = frontmatterEndAfter(update.state.doc, update.changes, this.frontmatterEnd);
      // The scan covers what is on screen, so scrolling reads again too; the syntax tree changing means more of the
      // note has been parsed, which can change which fence the read starts in.
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (update.docChanged || update.viewportChanged || treeChanged) {
        this.scan = scanAround(update.state, update.view.viewport, this.frontmatterEnd);
      }
      if (update.docChanged || update.selectionSet || update.viewportChanged || treeChanged) {
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
