import { syntaxTree } from "@codemirror/language";
import { StateEffect, type ChangeSet, type EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { createLowlight } from "lowlight";
import { parse } from "../../lib/composition/frontmatter";

/**
 * Code blocks in the live editor, drawn as Preview draws them: on the block's background, in the code font, with
 * rounded corners, and coloured by language with the same highlighter (`lowlight`) and the same `hljs-*` classes, so
 * the two tabs colour code alike. The text stays the Markdown source: the fences (```` ```lang ```` and ```` ``` ````)
 * are only hidden, by collapsing their lines, while the caret is outside the block, and an indented block's
 * four-space indent likewise. Inside the block both show, so what is being edited is the source (the iPad's rule
 * too, its V2).
 *
 * Everything here is line and mark decorations, which a view plugin may give: hiding a whole fence line by replacing
 * it would replace a line break, which only a state field may do, so the line is drawn with no height instead.
 */

/** A run of a code block's text to colour: `from`..`to` in the code (not the note), and the `hljs-*` classes. */
export type CodeColour = { from: number; to: number; class: string };

/** Colours `code` as the language `lang`, or null when it is not a language the highlighter knows (left plain, as Preview leaves it). */
export type Highlight = (lang: string, code: string) => readonly CodeColour[] | null;

type Lowlight = ReturnType<typeof createLowlight>;

/** The tree lowlight gives back (hast): only what `colours` reads of it. */
type HastNode = { type: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] };

/** The coloured runs of a highlighted tree, in order, outer runs before the runs inside them. */
function colours(root: HastNode): CodeColour[] {
  const found: CodeColour[] = [];
  let at = 0;
  const walk = (node: HastNode) => {
    if (node.type === "text") {
      at += node.value?.length ?? 0;
      return;
    }
    const from = at;
    for (const child of node.children ?? []) walk(child);
    const names = node.properties?.className;
    if (node.type === "element" && Array.isArray(names) && names.length > 0 && at > from) {
      found.push({ from, to: at, class: names.join(" ") });
    }
  };
  walk(root);
  return found.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** How many blocks' colours are kept. Typing in a block makes a new entry per keystroke; the oldest go first. */
const CACHE_SIZE = 256;

/**
 * Colours code with `lowlight`, as Preview's `rehype-highlight` does: the language named on the fence or nothing (no
 * guessing), and each block's colours remembered by its language and text, so a block is highlighted again only when
 * it changes, not when the caret moves or the note scrolls.
 */
export function lowlightHighlight(lowlight: Lowlight): Highlight {
  const cache = new Map<string, readonly CodeColour[] | null>();
  return (lang, code) => {
    const key = `${lang}\n${code}`;
    const kept = cache.get(key);
    if (kept !== undefined) {
      // Most recently used goes last, so it is the last to be dropped.
      cache.delete(key);
      cache.set(key, kept);
      return kept;
    }
    const found = lowlight.registered(lang) ? colours(lowlight.highlight(lang, code, { prefix: "hljs-" }) as HastNode) : null;
    cache.set(key, found);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return found;
  };
}

let highlight: Highlight | null = null;
let loading: Promise<Highlight> | undefined;

/**
 * Fetches the highlighter the first time a note shows a code block with a language, as Preview does
 * (`useCodeHighlighting`): every highlight.js language is a large bundle. The chunk is the one Preview loads.
 */
export function loadHighlight(): Promise<Highlight> {
  loading ??= import("lowlight").then(({ createLowlight, all }) => (highlight = lowlightHighlight(createLowlight(all))));
  return loading;
}

/** The language a fence's info string names, as remark reads it: its first word. Empty for an untagged fence. */
export function fenceLanguage(info: string): string {
  return info.trim().split(/\s/, 1)[0] ?? "";
}

const codeLine = Decoration.line({ class: "cm-live-codeblock" });
const firstLine = Decoration.line({ class: "cm-live-codeblock cm-live-codeblock-first" });
const lastLine = Decoration.line({ class: "cm-live-codeblock cm-live-codeblock-last" });
const onlyLine = Decoration.line({ class: "cm-live-codeblock cm-live-codeblock-first cm-live-codeblock-last" });
const fenceLine = Decoration.line({ class: "cm-live-codeblock cm-live-codeblock-fence" });
const hiddenLine = Decoration.line({ class: "cm-live-codeblock-hidden" });
const hidden = Decoration.replace({});
const colourMarks = new Map<string, Decoration>();
const colourMark = (name: string) => {
  let mark = colourMarks.get(name);
  if (!mark) colourMarks.set(name, (mark = Decoration.mark({ class: name })));
  return mark;
};

type Span = { from: number; to: number };

/** A node of the Markdown syntax tree (its package is not one of ours to import from). */
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** Whether the caret, or any selection, reaches `from`..`to`, ends included. */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** What `codeDecorations` found: the decorations, and whether a block on screen names a language to colour it in. */
export type CodeDecorations = { decorations: DecorationSet; wantsColour: boolean };

/**
 * One code block's decorations, pushed onto `out`: the background on every line that shows, the fences hidden (their
 * lines collapsed) while the caret is elsewhere, and the colours for the lines inside `ranges`. Returns whether the
 * block names a language.
 */
function decorateBlock(state: EditorState, block: SyntaxNode, ranges: readonly Span[], highlight: Highlight | null, out: Range<Decoration>[]): boolean {
  const doc = state.doc;
  const fenced = block.name === "FencedCode";
  const first = doc.lineAt(block.from).number;
  const last = doc.lineAt(block.to).number;
  const marks = block.getChildren("CodeMark");
  // A fence that is never closed runs to the end of the note, and its last line is code.
  const closed = fenced && marks.length >= 2 && doc.lineAt(marks[marks.length - 1].from).number > first;
  const codeFirst = fenced ? first + 1 : first;
  const codeLast = closed ? last - 1 : last;
  const active = touches(state, block.from, block.to);
  // The fences are hidden only where there is code to show in their place; an empty block keeps them.
  const hideFences = fenced && !active && codeLast >= codeFirst;

  // Where each code line's code starts: past a quote's `>` or a list item's indent, which the tree leaves out of `CodeText`.
  const starts = new Map<number, number>();
  for (const text of block.getChildren("CodeText")) {
    // A run can end just past a line break (`indented\n`): the next line's code starts at its own run, not there.
    for (let pos = text.from; pos < text.to; ) {
      const line = doc.lineAt(pos);
      if (!starts.has(line.number)) starts.set(line.number, Math.max(pos, line.from));
      pos = line.to + 1;
    }
  }

  const shownFirst = hideFences ? codeFirst : first;
  const shownLast = hideFences ? codeLast : last;
  // An indented block's indent is hidden like a fence (only at the top level: in a list or quote it is the item's).
  const hideIndent = !fenced && !active && block.parent?.name === "Document";
  const visible = (from: number, to: number) => ranges.some((range) => range.from <= to && range.to >= from);

  for (let number = first; number <= last; number++) {
    const line = doc.line(number);
    const isFence = fenced && (number === first || (closed && number === last));
    if (isFence && hideFences) {
      out.push(hiddenLine.range(line.from));
      continue;
    }
    if (number !== shownFirst && number !== shownLast && !visible(line.from, line.to)) continue;
    const edge = number === shownFirst ? (number === shownLast ? onlyLine : firstLine) : number === shownLast ? lastLine : null;
    out.push((edge ?? (isFence ? fenceLine : codeLine)).range(line.from));
    if (isFence && edge) out.push(fenceLine.range(line.from));
    if (hideIndent && starts.has(number) && starts.get(number)! > line.from) out.push(hidden.range(line.from, starts.get(number)!));
  }

  const info = block.getChild("CodeInfo");
  const lang = info ? fenceLanguage(doc.sliceString(info.from, info.to)) : "";
  if (!lang || !highlight || codeLast < codeFirst) return lang !== "";

  // The code as Preview highlights it: each line's code, without the fences, the quote marks or the item's indent.
  const pieces: string[] = [];
  const offsets: { code: number; doc: number }[] = [];
  let length = 0;
  for (let number = codeFirst; number <= codeLast; number++) {
    const line = doc.line(number);
    const start = Math.min(starts.get(number) ?? line.to, line.to);
    offsets.push({ code: length, doc: start });
    const piece = doc.sliceString(start, line.to);
    pieces.push(piece);
    length += piece.length + 1;
  }
  const found = highlight(lang, pieces.join("\n"));
  if (!found) return true;

  // A run can cross a line break (a block comment): it is marked line by line, as a mark may not span what it skips.
  for (const { from, to, class: name } of found) {
    for (let index = lineIndex(offsets, from); index < offsets.length && offsets[index].code < to; index++) {
      const { code, doc: at } = offsets[index];
      const end = at + pieces[index].length;
      const start = at + Math.max(0, from - code);
      const stop = Math.min(end, at + (to - code));
      if (start < stop && visible(start, stop)) out.push(colourMark(name).range(start, stop));
    }
  }
  return true;
}

/** The index of the line of the code that `pos` (in the code) is on. */
function lineIndex(offsets: readonly { code: number }[], pos: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle].code <= pos) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * The decorations for the code blocks inside `ranges` (the viewport, normally), past `frontmatterEnd` (see
 * `bodyStart`). `highlight` colours them; while it is null (not loaded yet), they are drawn uncoloured.
 */
export function codeDecorations(state: EditorState, ranges: readonly Span[], frontmatterEnd: number, highlight: Highlight | null): CodeDecorations {
  const out: Range<Decoration>[] = [];
  const seen = new Set<number>();
  let wantsColour = false;
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from: Math.max(from, frontmatterEnd),
      to,
      enter(node) {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        if (node.from >= frontmatterEnd && !seen.has(node.from)) {
          seen.add(node.from);
          if (decorateBlock(state, node.node, ranges, highlight, out)) wantsColour = true;
        }
        return false;
      },
    });
  }
  return { decorations: Decoration.set(out, true), wantsColour };
}

/**
 * Where the frontmatter ends once `changes` (which made `doc`) are made, given where it ended before them: read again
 * only when the note starts with `---` and a change is at or above its end (or there was none yet).
 */
function frontmatterEndAfter(doc: Text, changes: ChangeSet, before: number): number {
  if (doc.sliceString(0, 3) !== "---") return 0;
  let touched = before === 0;
  changes.iterChangedRanges((fromA) => {
    if (fromA <= before) touched = true;
  });
  if (!touched) return before;
  const text = doc.toString();
  return text.length - parse(text)[1].length;
}

/** Tells the plugin the highlighter has loaded, so the blocks on screen are coloured. */
const highlightLoaded = StateEffect.define<null>();

const liveCodePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    frontmatterEnd: number;
    gone = false;

    constructor(readonly view: EditorView) {
      const doc = view.state.doc;
      this.frontmatterEnd = doc.sliceString(0, 3) === "---" ? doc.length - parse(doc.toString())[1].length : 0;
      this.draw();
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.frontmatterEnd = frontmatterEndAfter(update.state.doc, update.changes, this.frontmatterEnd);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(highlightLoaded)))
      ) {
        this.draw();
      }
    }

    draw() {
      const { decorations, wantsColour } = codeDecorations(this.view.state, this.view.visibleRanges, this.frontmatterEnd, highlight);
      this.decorations = decorations;
      if (wantsColour && !highlight) {
        void loadHighlight().then(() => {
          if (!this.gone) this.view.dispatch({ effects: highlightLoaded.of(null) });
        });
      }
    }

    destroy() {
      this.gone = true;
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * The look of a code block, after Preview's `prose pre` (tailwind typography): its background, size and padding. The
 * colours are Preview's, from the `hljs-*` rules in `globals.css`.
 */
const codeTheme = EditorView.baseTheme({
  ".cm-line.cm-live-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875em",
    lineHeight: "1.7142857",
    backgroundColor: "var(--surface)",
    paddingLeft: "1.1428571em",
    paddingRight: "1.1428571em",
  },
  ".cm-line.cm-live-codeblock-first": { paddingTop: "0.8571429em", borderTopLeftRadius: "0.375rem", borderTopRightRadius: "0.375rem" },
  ".cm-line.cm-live-codeblock-last": { paddingBottom: "0.8571429em", borderBottomLeftRadius: "0.375rem", borderBottomRightRadius: "0.375rem" },
  // The fences, while they show: there, but not in the way.
  ".cm-line.cm-live-codeblock-fence": { color: "var(--muted-foreground)" },
  // A fence line while the caret is outside its block: collapsed to nothing, its text still in the document.
  ".cm-line.cm-live-codeblock-hidden": { height: "0", overflow: "hidden", padding: "0" },
  // The plain editor's code colour is for code it cannot colour; here the code is Preview's, plain or by language.
  ".cm-live-codeblock .md-code": { color: "inherit" },
});

/** Code blocks drawn as Preview draws them: put it in an editor that has the Markdown language. */
export const liveCode: Extension = [liveCodePlugin, codeTheme];
