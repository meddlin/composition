import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { useCallback, type MouseEvent } from "react";
import { frontmatterEndIn } from "./liveFrontmatter";
import { followFromLive, FOLLOW_HINT } from "./liveLinks";
import type { BlockKind } from "./liveBlockWidget";
import { useSettledNote } from "./liveSettled";
import { NoteMarkdown } from "./NoteMarkdown";

/**
 * Footnotes in the Live tab (Step 7 of docs/live-default-plan.md), drawn as Preview draws them:
 *
 * - a reference, `[^label]`, is drawn away from the caret as its number, raised, in the link colour, numbered by the
 *   order the notes are first cited in (as remark-gfm numbers them). Cmd/Ctrl+click goes to its definition, as
 *   following a link does (`liveLinks`).
 * - a definition, `[^label]: text`, has its `[^label]:` drawn as its number while the caret is off its line, and its
 *   lines set in the smaller type of Preview's list of notes. Cmd/Ctrl+click on the number goes back to where it is
 *   first cited.
 * - `<Footnotes />` is drawn as Preview's list of the note's footnotes (`FOOTNOTES`).
 *
 * A reference with no definition, and a definition nothing cites, are left as written, as Preview leaves the first
 * and drops the second.
 *
 * Lezer's Markdown has no footnote node, so they are found by reading the text: `footnoteMarksField` keeps every
 * `[^label]` of the note, reading again only the lines a change touches, and `footnotesOf` numbers them, leaving out
 * those in code or the frontmatter (from the syntax tree, for the few marks there are).
 */

/** A `[^label]` in the text: a reference, or (at the start of a line) the label of a definition. */
export type FootnoteMark = {
  from: number;
  /** After the `]`, or for a definition after the `]:`. */
  to: number;
  /** The label as written, and as it is matched (case and all left out). */
  label: string;
  key: string;
  definition: boolean;
};

const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:/;
const REFERENCE = /\[\^([^\]\s]+)\]/g;

export const footnoteKey = (label: string) => label.toLowerCase();

/** The marks on the lines from the one holding `from` to the one holding `to`. */
function scanLines(doc: Text, from: number, to: number): FootnoteMark[] {
  const marks: FootnoteMark[] = [];
  const last = doc.lineAt(Math.min(to, doc.length)).number;
  for (let number = doc.lineAt(Math.min(from, doc.length)).number; number <= last; number++) {
    const line = doc.line(number);
    const text = line.text;
    if (!text.includes("[^")) continue;
    let rest = 0;
    const definition = DEFINITION.exec(text);
    if (definition) {
      const start = text.indexOf("[^");
      rest = definition[0].length;
      marks.push({ from: line.from + start, to: line.from + rest, label: definition[1], key: footnoteKey(definition[1]), definition: true });
    }
    REFERENCE.lastIndex = rest;
    for (let match = REFERENCE.exec(text); match; match = REFERENCE.exec(text)) {
      // `\[^1]` is not a reference.
      if (match.index > 0 && text[match.index - 1] === "\\") continue;
      const at = line.from + match.index;
      marks.push({ from: at, to: at + match[0].length, label: match[1], key: footnoteKey(match[1]), definition: false });
    }
  }
  return marks;
}

/** Every footnote mark of the note, in order: read once, then again only on the lines a change touches. */
export const footnoteMarksField = StateField.define<readonly FootnoteMark[]>({
  create: (state) => scanLines(state.doc, 0, state.doc.length),
  update(marks, tr) {
    if (!tr.docChanged) return marks;
    const doc = tr.state.doc;
    // The changed lines, in the new text, joined where they meet.
    const spans: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = doc.lineAt(fromB).from;
      const to = doc.lineAt(toB).to;
      const previous = spans[spans.length - 1];
      if (previous && previous.to >= from - 1) previous.to = Math.max(previous.to, to);
      else spans.push({ from, to });
    });
    const inSpan = (pos: number) => spans.some((span) => pos >= span.from && pos <= span.to);
    const kept: FootnoteMark[] = [];
    for (const mark of marks) {
      const from = tr.changes.mapPos(mark.from, 1);
      const to = tr.changes.mapPos(mark.to, -1);
      if (to - from !== mark.to - mark.from || inSpan(from)) continue;
      kept.push(from === mark.from ? mark : { ...mark, from, to });
    }
    const found = spans.flatMap((span) => scanLines(doc, span.from, span.to));
    if (found.length === 0 && kept.length === marks.length && kept.every((mark, i) => mark === marks[i])) return marks;
    return [...kept, ...found].sort((a, b) => a.from - b.from);
  },
});

/** The syntax-tree nodes a footnote mark means nothing inside. */
const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock", "Comment"]);

/** A definition: its mark, and where its text (all its lines) ends. */
export type FootnoteDefinition = { mark: FootnoteMark; number: number | null };

export type NoteFootnotes = {
  /** The references that have a definition, in order, with their number. */
  references: readonly (FootnoteMark & { number: number })[];
  /** Each label's first definition, by key. */
  definitions: ReadonlyMap<string, FootnoteDefinition>;
  /** How many footnotes are cited. */
  count: number;
};

const cache = new WeakMap<readonly FootnoteMark[], { tree: unknown; frontmatterEnd: number; footnotes: NoteFootnotes }>();

/** The note's footnotes, numbered by the order they are first cited in, as remark-gfm numbers them. */
export function footnotesOf(state: EditorState): NoteFootnotes {
  const marks = state.field(footnoteMarksField);
  const tree = syntaxTree(state);
  const frontmatterEnd = frontmatterEndIn(state);
  const cached = cache.get(marks);
  if (cached && cached.tree === tree && cached.frontmatterEnd === frontmatterEnd) return cached.footnotes;

  const counts = (mark: FootnoteMark) => {
    if (mark.from < frontmatterEnd) return false;
    for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(mark.from, 1); node; node = node.parent) {
      if (CODE.has(node.name)) return false;
    }
    return true;
  };
  const live = marks.filter(counts);
  const definitions = new Map<string, FootnoteDefinition>();
  for (const mark of live) if (mark.definition && !definitions.has(mark.key)) definitions.set(mark.key, { mark, number: null });
  const references: (FootnoteMark & { number: number })[] = [];
  let count = 0;
  for (const mark of live) {
    if (mark.definition) continue;
    const definition = definitions.get(mark.key);
    if (!definition) continue;
    if (definition.number === null) definition.number = ++count;
    references.push({ ...mark, number: definition.number });
  }
  const footnotes = { references, definitions, count };
  cache.set(marks, { tree, frontmatterEnd, footnotes });
  return footnotes;
}

/**
 * Where a definition's text ends: its first line, the lines that carry its paragraph on (any that are not blank and
 * start nothing else), and after a blank line the lines indented four spaces, which are more of it.
 */
export function definitionEnd(doc: Text, mark: FootnoteMark): number {
  let line = doc.lineAt(mark.from);
  let end = line.to;
  let blank = false;
  while (line.number < doc.lines) {
    line = doc.line(line.number + 1);
    if (line.text.trim() === "") {
      blank = true;
      continue;
    }
    if (blank ? !/^(?: {4}|\t)/.test(line.text) : /^ {0,3}(?:\[\^[^\]\s]+\]:|#{1,6}(?:\s|$)|```|~~~|>|[-*+]\s|\d{1,9}[.)]\s)/.test(line.text)) break;
    blank = false;
    end = line.to;
  }
  return end;
}

/** The first words of a definition, for a reference's tooltip. */
function definitionGist(doc: Text, mark: FootnoteMark): string {
  const text = doc.sliceString(mark.to, Math.min(definitionEnd(doc, mark), mark.to + 200)).replace(/\s+/g, " ").trim();
  return text.length >= 120 ? `${text.slice(0, 117)}…` : text;
}

/** A reference drawn as its number. Its `data-href` is what `liveLinks` follows on Cmd/Ctrl+click. */
class ReferenceWidget extends WidgetType {
  constructor(
    readonly number: number,
    readonly href: string,
    readonly tooltip: string,
  ) {
    super();
  }

  eq(other: ReferenceWidget) {
    return this.number === other.number && this.href === other.href && this.tooltip === other.tooltip;
  }

  toDOM() {
    const sup = document.createElement("sup");
    sup.className = "cm-live-footnote-ref";
    sup.dataset.href = this.href;
    sup.title = this.tooltip;
    sup.setAttribute("aria-label", `Footnote ${this.number}`);
    sup.textContent = String(this.number);
    return sup;
  }

  ignoreEvent() {
    return false;
  }
}

/** A definition's `[^label]:` drawn as its number. */
class NumberWidget extends WidgetType {
  constructor(
    readonly number: number,
    readonly href: string,
  ) {
    super();
  }

  eq(other: NumberWidget) {
    return this.number === other.number && this.href === other.href;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-footnote-number";
    span.dataset.href = this.href;
    span.title = `Footnote ${this.number}\n${FOLLOW_HINT} back to where it is cited`;
    span.textContent = `${this.number}.`;
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

const definitionLine = Decoration.line({ class: "cm-live-footnote-def" });
const syntax = Decoration.mark({ class: "cm-live-syntax" });

type Span = { from: number; to: number };

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

const within = (ranges: readonly Span[], from: number, to: number) => ranges.some((range) => from < range.to && to > range.from);

/** The decorations for the footnote references and definitions inside `ranges`. */
export function footnoteDecorations(state: EditorState, ranges: readonly Span[]): Range<Decoration>[] {
  const { references, definitions } = footnotesOf(state);
  if (definitions.size === 0) return [];
  const doc = state.doc;
  const decorations: Range<Decoration>[] = [];

  for (const reference of references) {
    if (!within(ranges, reference.from, reference.to)) continue;
    if (touches(state, reference.from, reference.to)) {
      decorations.push(syntax.range(reference.from, reference.to));
      continue;
    }
    const definition = definitions.get(reference.key)!;
    const tooltip = `${definitionGist(doc, definition.mark)}\n${FOLLOW_HINT}`.trim();
    const widget = new ReferenceWidget(reference.number, `#fn-${definition.mark.label}`, tooltip);
    decorations.push(Decoration.replace({ widget }).range(reference.from, reference.to));
  }

  for (const { mark, number } of definitions.values()) {
    if (number === null) continue;
    const end = definitionEnd(doc, mark);
    if (!within(ranges, mark.from, end)) continue;
    for (let line = doc.lineAt(mark.from); ; line = doc.line(line.number + 1)) {
      decorations.push(definitionLine.range(line.from));
      if (line.to >= end) break;
    }
    const first = doc.lineAt(mark.from);
    if (touches(state, first.from, first.to)) {
      decorations.push(syntax.range(mark.from, mark.to));
      continue;
    }
    // The space after the `:` goes with it, as with a heading's `# `.
    const gap = doc.sliceString(mark.to, mark.to + 1) === " " ? 1 : 0;
    const cited = references.find((reference) => reference.key === mark.key)!;
    decorations.push(Decoration.replace({ widget: new NumberWidget(number, `#fnref-${cited.label}`) }).range(mark.from, mark.to + gap));
  }
  return decorations;
}

const footnotePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = Decoration.set(footnoteDecorations(view.state, view.visibleRanges), true);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = Decoration.set(footnoteDecorations(update.state, update.view.visibleRanges), true);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * What `<Footnotes />` is drawn from: the note's references, one each in the order they are cited, then the tag, then
 * every definition that is cited. Preview's own `NoteMarkdown` reads that as it reads the note, so the list is
 * numbered, worded and linked exactly as Preview's (`rehypeFootnotes` puts it in the tag); the line of references
 * comes first in what it draws and is not shown.
 */
export function footnotesSource(state: EditorState, tag: string): string {
  const { references, definitions } = footnotesOf(state);
  if (references.length === 0) return tag;
  const doc = state.doc;
  const cited = [...definitions.values()].filter((definition) => definition.number !== null);
  const texts = cited.map(({ mark }) => doc.sliceString(doc.lineAt(mark.from).from, definitionEnd(doc, mark)).replace(/^ {0,3}/, ""));
  return [references.map((reference) => `[^${reference.label}]`).join(" "), tag, ...texts].join("\n\n");
}

/**
 * A click on a link in a drawn `<Toc>` or `<Footnotes>` is followed in Live's own text: a heading's `#slug`, or a
 * footnote's ↩ back to the reference it stands for. Caught before Preview's handlers, which look for the target among
 * the page's elements (Live has none for them).
 */
export function useFollowInLive(view: EditorView) {
  return useCallback(
    (event: MouseEvent) => {
      const link = (event.target as Element).closest?.("a");
      const href = link?.getAttribute("href") ?? "";
      if (!link || !href.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      if (link.hasAttribute("data-footnote-backref")) {
        const item = link.closest("li[id]");
        const id = item?.id ?? "";
        const key = footnoteKey(id.slice(id.indexOf("fn-") + 3));
        // The second ↩ of a note cited twice goes back to the second citation.
        const nth = item ? [...item.querySelectorAll("a[data-footnote-backref]")].indexOf(link) : 0;
        const cited = footnotesOf(view.state).references.filter((reference) => reference.key === key);
        const at = cited[Math.max(0, nth)] ?? cited[0];
        if (at) view.dispatch({ effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
        return;
      }
      followFromLive(view, href, event.shiftKey);
    },
    [view],
  );
}

/** `<Footnotes />` drawn as Preview draws it, from the note's footnotes as they are once typing pauses. */
function FootnotesDrawing({ source, view }: { source: string; view: EditorView }) {
  const read = useCallback((state: EditorState) => footnotesSource(state, source), [source]);
  const body = useSettledNote(view, read);
  const follow = useFollowInLive(view);
  return (
    <div className="cm-live-footnotes" onClickCapture={follow}>
      <NoteMarkdown body={body} rehypePlugins={NO_REHYPE} />
    </div>
  );
}

const NO_REHYPE: never[] = [];

/** `<Footnotes />` on a line of its own, as a block (see `BlockKind`). Its links are its own, so it has "Edit source". */
export const FOOTNOTES: BlockKind = {
  // Lezer reads a self-closing tag on its own line as a paragraph (its HTML block rule does not take `/>`).
  node: "Paragraph",
  ownsClicks: true,
  accepts: (source) => /^\s*<Footnotes\s*\/>\s*$/.test(source),
  Drawing: FootnotesDrawing,
};

const footnoteTheme = EditorView.baseTheme({
  ".cm-live-footnote-ref": {
    color: "var(--link)",
    fontSize: "0.75em",
    lineHeight: "0",
    verticalAlign: "super",
    padding: "0 0.1em",
  },
  ".cm-scroller.cm-live-following .cm-live-footnote-ref, .cm-scroller.cm-live-following .cm-live-footnote-number": { cursor: "pointer" },
  // Preview's list of notes is in its small type (`text-sm`).
  ".cm-live-footnote-def": { fontSize: "0.875em" },
  ".cm-live-footnote-number": { color: "var(--muted-foreground)", marginRight: "0.4em" },
  // The line of references `footnotesSource` starts with, which only numbers the list.
  ".cm-live-footnotes > p:first-child": { display: "none" },
});

/** Footnote references and definitions drawn with their numbers. `FOOTNOTES` is added to the block layer apart. */
export const liveFootnotes: Extension = [footnoteMarksField, footnotePlugin, footnoteTheme];
