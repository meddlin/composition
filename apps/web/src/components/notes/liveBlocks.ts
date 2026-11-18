import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, Prec, StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type Range, type Text, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { BlockWidget, liveBlockHost, type BlockKind, type BlockPlace, type LiveBlockHost } from "./liveBlockWidget";
import { bodyStart } from "./liveMarkdown";

/**
 * The Live tab's block layer: the parts of a note drawn whole, by Preview's own renderer, in place of their source
 * (a table; Steps 6 and 7 of docs/live-default-plan.md add MDX components, the frontmatter card, `<Toc>` and
 * `<Footnotes>`). CodeMirror takes block widgets only from a state field, not from a view plugin like
 * `liveMarkdown`'s, and a state field sees the whole note, so this one is kept incremental: a change maps the blocks
 * it had through the change and reads again only the top-level blocks of the syntax tree that the change touched.
 *
 * The reveal rule (D3): while the caret or a selection touches a block (its first line's start to its last line's
 * end), its source shows, with the drawing under it. That drawing is the one there was when the caret came in; it is
 * redrawn once typing has paused for `REDRAW_DELAY` ms, so a half-typed block never flashes an error.
 */

/** How long typing must pause before the drawing under a block being edited is redrawn. */
export const REDRAW_DELAY = 300;

/** Tables (GFM), the kind of block Step 5 draws. */
export const TABLE: BlockKind = { node: "Table" };

/** The kinds of block drawn whole; tables by default, and more from extensions that add to it. */
export const liveBlockKinds = Facet.define<BlockKind, readonly BlockKind[]>({
  combine: (kinds) => (kinds.length > 0 ? [...new Set(kinds)] : [TABLE]),
});

/** Redraws the drawing under each block being edited, from its source as it is now (what the pause timer sends). */
export const redrawBlocks = StateEffect.define<null>();

/**
 * Stretches of the note that show their source as if the caret were on them: find's current match, so a match inside
 * a table is seen and highlighted. Mapped through changes until replaced.
 */
export const revealBlocks = StateEffect.define<readonly Span[]>();

export type Span = { from: number; to: number };

/**
 * A drawn block: whole lines, from the start of its first to the end of its last. `drawn` is the source the drawing
 * under it shows while it is `active` (the caret is in it), null until there is one; away from the caret the drawing
 * is of its source as it is.
 */
export type Block = Span & {
  kind: BlockKind;
  active: boolean;
  drawn: string | null;
  /**
   * A block being edited that has stopped being one (a header row typed a cell ahead of its delimiter row, say). It
   * keeps its drawing under the text until typing pauses or the caret leaves, and then goes, unless it is read as a
   * block again meanwhile.
   */
  orphan?: boolean;
};

export type LiveBlocks = {
  /** In document order, not overlapping. */
  blocks: readonly Block[];
  /** Stretches changed but not yet read again, because the syntax tree does not reach them yet. In order, not overlapping. */
  dirty: readonly Span[];
  /** Where the frontmatter ends: nothing before it is a block (it is YAML, not Markdown). */
  frontmatterEnd: number;
  reveal: readonly Span[];
  /** Whether a block being edited has a drawing behind its source (so `redrawBlocks` is due). */
  pending: boolean;
  decorations: DecorationSet;
};

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
type Tree = ReturnType<typeof syntaxTree>;

const touchesAny = (spans: readonly Span[], from: number, to: number) => spans.some((span) => span.from <= to && span.to >= from);

function isActive(state: EditorState, reveal: readonly Span[], block: Span): boolean {
  return touchesAny(state.selection.ranges, block.from, block.to) || touchesAny(reveal, block.from, block.to);
}

/** The first top-level node of the tree (a child of its Document) that overlaps or touches `from` or comes after it. */
function firstTopNode(tree: Tree, from: number): SyntaxNode | null {
  const top = tree.topNode;
  let node = top.childBefore(from) ?? top.firstChild;
  while (node && node.to < from) node = node.nextSibling;
  return node;
}

/** The top-level nodes of the tree that overlap or touch `from`..`to`, in order. */
function topNodes(tree: Tree, from: number, to: number): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (let node = firstTopNode(tree, from); node && node.from <= to; node = node.nextSibling) nodes.push(node);
  return nodes;
}

/** `from`..`to` widened to the top-level nodes it touches. */
function widen(tree: Tree, from: number, to: number): Span {
  const nodes = topNodes(tree, from, to);
  if (nodes.length === 0) return { from, to };
  return { from: Math.min(from, nodes[0].from), to: Math.max(to, nodes[nodes.length - 1].to) };
}

/**
 * How far the tree can be read: the whole note once it is parsed, else up to the start of its last top-level node,
 * which may have been cut short where the parser stopped.
 */
function trustedEnd(tree: Tree, doc: Text): number {
  if (tree.length >= doc.length) return doc.length;
  return tree.topNode.lastChild?.from ?? 0;
}

/**
 * The frontmatter's end, as `bodyStart` finds it, read only from the lines it can span: a note that does not start
 * with a `---` line has none.
 */
export function frontmatterEndOf(doc: Text): number {
  if (!/^---[ \t]*\r?$/.test(doc.line(1).text)) return 0;
  // A closing line is needed; look a few hundred lines down at most, as no real frontmatter is longer.
  const last = Math.min(doc.lines, 500);
  for (let number = 2; number <= last; number++) {
    const line = doc.line(number);
    if (/^---[ \t]*\r?$/.test(line.text)) return bodyStart(doc.sliceString(0, Math.min(doc.length, line.to + 1)));
  }
  return 0;
}

/** Adds `span` to sorted, non-overlapping `spans`, joining it with any it touches. */
function addSpan(spans: readonly Span[], span: Span): Span[] {
  const out: Span[] = [];
  let { from, to } = span;
  let placed = false;
  for (const other of spans) {
    if (other.to < from) out.push(other);
    else if (other.from > to) {
      if (!placed) out.push({ from, to });
      placed = true;
      out.push(other);
    } else {
      from = Math.min(from, other.from);
      to = Math.max(to, other.to);
    }
  }
  if (!placed) out.push({ from, to });
  return out;
}

function mapSpan(span: Span, changes: ChangeDesc): Span {
  return { from: changes.mapPos(span.from, -1), to: changes.mapPos(span.to, 1) };
}

const startsAt = (kind: BlockKind, name: string) => (typeof kind.node === "string" ? kind.node === name : kind.node.includes(name));

/** The block that starts at a top-level node, if it is one of `kinds` (the first that takes it). */
function blockOf(state: EditorState, node: SyntaxNode, kinds: readonly BlockKind[], frontmatterEnd: number): Block | null {
  if (node.from < frontmatterEnd) return null;
  const doc = state.doc;
  for (const kind of kinds) {
    if (!startsAt(kind, node.name)) continue;
    const end = kind.reach ? kind.reach(state, node) : node.to;
    if (end === null) continue;
    // A node ends at its last character; one that ends on a line break ends on the line before.
    const last = end > node.from && doc.sliceString(end - 1, end) === "\n" ? end - 1 : end;
    const from = doc.lineAt(node.from).from;
    const to = doc.lineAt(last).to;
    if (kind.accepts && !kind.accepts(doc.sliceString(from, to))) continue;
    return { from, to, kind, active: false, drawn: null };
  }
  return null;
}

/**
 * Reads the blocks in `dirty` again, as far as the tree reaches (`trusted`), and returns the blocks, what is still
 * to read, and whether any block was dropped or found.
 */
function reread(state: EditorState, blocks: readonly Block[], dirty: readonly Span[], frontmatterEnd: number, reveal: readonly Span[]) {
  const tree = syntaxTree(state);
  const trusted = trustedEnd(tree, state.doc);
  const kinds = state.facet(liveBlockKinds);
  let next = blocks;
  const left: Span[] = [];
  let touched = false;

  for (const span of dirty) {
    // (A change at the very end of a note parsed to its end is read like any other.)
    if (span.from >= trusted && trusted < state.doc.length) {
      left.push(span);
      continue;
    }
    const end = Math.min(span.to, trusted);
    if (span.to > trusted) left.push({ from: trusted, to: span.to });
    let region = widen(tree, span.from, end);
    // A block can run over several top-level nodes (an MDX component with Markdown in it), so it is read again whole:
    // from the start of any block the change is in, and of any that a closing tag in it may end.
    for (const block of next) {
      if (block.from <= region.to && block.to >= region.from) region = { from: Math.min(region.from, block.from), to: Math.max(region.to, block.to) };
    }
    for (const startAbove of new Set(kinds.map((kind) => kind.startAbove))) {
      const start = startAbove?.(state, region.from, region.to);
      if (start != null && start < region.from) region = { from: start, to: region.to };
    }
    region = widen(tree, region.from, region.to);

    const read: Block[] = [];
    let reach = region.to;
    for (let node = firstTopNode(tree, region.from); node && node.from <= reach; node = node.nextSibling) {
      if (node.from >= trusted) break;
      // Inside a block just found (the Markdown in a component).
      if (read.length > 0 && node.from <= read[read.length - 1].to) continue;
      const block = blockOf(state, node, kinds, frontmatterEnd);
      if (!block) continue;
      read.push(block);
      reach = Math.max(reach, block.to);
    }
    const dropped = next.filter((block) => block.from <= reach && block.to >= region.from);
    const found: Block[] = read.map((block) => {
      // A block read again (typed in, say) keeps the drawing it had. A new one the caret is in (being typed) has none
      // until typing pauses.
      const was = dropped.find((old) => old.kind === block.kind && old.from <= block.to && old.to >= block.from);
      return was ? { ...block, active: was.active, drawn: was.drawn } : { ...block, active: isActive(state, reveal, block) };
    });
    for (const old of dropped) {
      if (!old.active || old.drawn === null || found.some((block) => block.from <= old.to && block.to >= old.from)) continue;
      found.push({ ...old, orphan: true });
    }
    if (dropped.length === 0 && found.length === 0) continue;
    touched = true;
    const kept = next.filter((block) => !dropped.includes(block));
    next = [...kept, ...found].sort((a, b) => a.from - b.from);
  }
  return { blocks: next, dirty: left, touched };
}

/** Where `block` (the one drawn by `dom`) starts now: found from where the editor has its widget. */
function blockPlace(view: EditorView, dom: HTMLElement): BlockPlace | null {
  let pos: number;
  try {
    pos = view.posAtDOM(dom);
  } catch {
    return null;
  }
  const { blocks } = view.state.field(liveBlocksField);
  const block = blocks.find((candidate) => candidate.from <= pos && candidate.to >= pos);
  if (!block) return null;
  return { start: block.from, bodyStart: bodyStart(view.state.doc.toString()) };
}

/**
 * The blocks' decorations: away from the caret a block is replaced by its drawing; while the caret is in it, its
 * source stays and the drawing it had is placed under it.
 */
function decorate(state: EditorState, blocks: readonly Block[]): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  for (const block of blocks) {
    if (!block.active) {
      const source = state.doc.sliceString(block.from, block.to);
      // One that can't be drawn yet (not valid MDX) keeps its source, with the note saying so under it.
      const ready = !block.kind.problem?.(source);
      const widget = new BlockWidget(source, block.kind, !ready, blockPlace);
      decorations.push(
        ready ? Decoration.replace({ widget, block: true }).range(block.from, block.to) : Decoration.widget({ widget, block: true, side: 1 }).range(block.to),
      );
    } else if (block.drawn !== null) {
      const widget = new BlockWidget(block.drawn, block.kind, true, blockPlace);
      decorations.push(Decoration.widget({ widget, block: true, side: 1 }).range(block.to));
    }
  }
  return Decoration.set(decorations);
}

/** Marks each block active or not, and settles what the drawing under each active one shows. */
function settle(state: EditorState, blocks: readonly Block[], reveal: readonly Span[], redraw: boolean): { blocks: Block[]; changed: boolean } {
  let changed = false;
  const settled: Block[] = [];
  for (const block of blocks) {
    const active = isActive(state, reveal, block);
    if (block.orphan && (!active || redraw)) {
      changed = true;
      continue;
    }
    let drawn = block.drawn;
    if (!active) drawn = null;
    // Coming in from away: the drawing under it is the one it had, which is its source as it was.
    else if (!block.active && drawn === null) drawn = state.doc.sliceString(block.from, block.to);
    else if (redraw) drawn = state.doc.sliceString(block.from, block.to);
    if (active === block.active && drawn === block.drawn) {
      settled.push(block);
      continue;
    }
    changed = true;
    settled.push({ ...block, active, drawn });
  }
  return { blocks: settled, changed };
}

function pendingOf(state: EditorState, blocks: readonly Block[]): boolean {
  return blocks.some((block) => block.active && block.drawn !== state.doc.sliceString(block.from, block.to));
}

function create(state: EditorState): LiveBlocks {
  const frontmatterEnd = frontmatterEndOf(state.doc);
  // A block the caret starts in has no drawing yet; one appears after the first pause, or when the caret leaves.
  const { blocks, dirty } = reread(state, [], [{ from: 0, to: state.doc.length }], frontmatterEnd, []);
  return { blocks, dirty, frontmatterEnd, reveal: [], pending: pendingOf(state, blocks), decorations: decorate(state, blocks) };
}

function update(value: LiveBlocks, tr: Transaction): LiveBlocks {
  let redraw = false;
  let reveal = value.reveal;
  for (const effect of tr.effects) {
    if (effect.is(redrawBlocks)) redraw = true;
    if (effect.is(revealBlocks)) reveal = effect.value;
  }
  const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
  if (!tr.docChanged && !treeChanged && !tr.selection && !redraw && reveal === value.reveal) return value;

  const state = tr.state;
  let blocks = value.blocks;
  let dirty = value.dirty;
  let frontmatterEnd = value.frontmatterEnd;

  if (tr.docChanged) {
    const changes = tr.changes;
    blocks = blocks.map((block) => ({ ...block, ...mapSpan(block, changes) })).filter((block) => block.from < block.to);
    dirty = dirty.map((span) => mapSpan(span, changes));
    reveal = reveal.map((span) => mapSpan(span, changes));
    const oldTree = syntaxTree(tr.startState);
    let touched: Span[] = [...dirty];
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      // What the change touched before (an opened code fence ran on to the end, say) and what it touches now.
      touched = addSpan(touched, mapSpan(widen(oldTree, fromA, toA), changes));
      touched = addSpan(touched, { from: fromB, to: toB });
    });
    dirty = touched;
    const nextFrontmatterEnd = frontmatterEndOf(state.doc);
    const mappedEnd = changes.mapPos(frontmatterEnd);
    if (nextFrontmatterEnd !== mappedEnd) dirty = addSpan(dirty, { from: 0, to: Math.max(nextFrontmatterEnd, mappedEnd) });
    frontmatterEnd = nextFrontmatterEnd;
  }

  let readAgain = false;
  if ((tr.docChanged || treeChanged) && dirty.length > 0) {
    const read = reread(state, blocks, dirty, frontmatterEnd, reveal);
    blocks = read.blocks;
    dirty = read.dirty;
    readAgain = read.touched;
  }

  const settled = settle(state, blocks, reveal, redraw);
  blocks = settled.blocks;
  const decorations =
    readAgain || settled.changed || (tr.docChanged && blocks.some((block) => block.active))
      ? decorate(state, blocks)
      : value.decorations.map(tr.changes);
  return { blocks, dirty, frontmatterEnd, reveal, pending: pendingOf(state, blocks), decorations };
}

/** The blocks of the note, and how they are drawn. */
export const liveBlocksField = StateField.define<LiveBlocks>({
  create,
  update,
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Redraws a block being edited once typing has paused (see `REDRAW_DELAY`). */
const redrawAfterPause = ViewPlugin.fromClass(
  class implements PluginValue {
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly view: EditorView) {
      this.schedule(true);
    }

    update(update: ViewUpdate) {
      this.schedule(update.docChanged);
    }

    private schedule(restart: boolean) {
      if (!this.view.state.field(liveBlocksField).pending) {
        this.clear();
        return;
      }
      if (this.timer !== null && !restart) return;
      this.clear();
      this.timer = setTimeout(() => {
        this.timer = null;
        this.view.dispatch({ effects: redrawBlocks.of(null) });
      }, REDRAW_DELAY);
    }

    private clear() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }

    destroy() {
      this.clear();
    }
  },
);

/**
 * Up and down arrows step into a drawn block rather than over it. CodeMirror moves past a block widget in one go, as
 * if it were a line; here, a move that would cross a drawn block lands on its first line (going down) or its last
 * (going up), at the caret's column, and the reveal rule then shows the source. `extend` is the same with Shift held.
 */
function arrowInto(forward: boolean, extend: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { blocks } = state.field(liveBlocksField);
    if (blocks.length === 0) return false;
    let moved = false;
    const selection = EditorSelection.create(
      state.selection.ranges.map((range) => {
        const next = view.moveVertically(range, forward);
        const head = range.head;
        const crossed = forward
          ? blocks.find((block) => !block.active && block.from > head && block.from <= next.head)
          : [...blocks].reverse().find((block) => !block.active && block.to < head && block.to >= next.head);
        if (!crossed) return extend ? EditorSelection.range(range.anchor, next.head) : next;
        moved = true;
        const column = head - state.doc.lineAt(head).from;
        const line = state.doc.lineAt(forward ? crossed.from : crossed.to);
        const at = line.from + Math.min(column, line.length);
        return extend ? EditorSelection.range(range.anchor, at) : EditorSelection.cursor(at);
      }),
      state.selection.mainIndex,
    );
    if (!moved) return false;
    view.dispatch({ selection, scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

const blockArrows = Prec.high(
  keymap.of([
    { key: "ArrowDown", run: arrowInto(true, false), shift: arrowInto(true, true) },
    { key: "ArrowUp", run: arrowInto(false, false), shift: arrowInto(false, true) },
  ]),
);

/** The look of a drawn block. The drawing itself is styled by Preview's `prose`. */
const blockTheme = EditorView.baseTheme({
  ".cm-live-block": { position: "relative", padding: "0.5em 0", cursor: "text" },
  // Under its own source while it is edited: set off a little from the text being typed.
  ".cm-live-block-beside": { opacity: "0.75" },
  ".cm-live-block-owns-clicks": { cursor: "auto" },
  // The editor's `pre-wrap` would draw the line breaks between a list's items in the drawing as blank lines.
  ".cm-live-block-body": { fontSize: "inherit", lineHeight: "1.7", whiteSpace: "normal" },
  // In Live a table sits with the text, not two lines away from it as in Preview's flowing page.
  ".cm-live-block-body > :first-child": { marginTop: "0" },
  ".cm-live-block-body > :last-child": { marginBottom: "0" },
  ".cm-live-block-edit": {
    position: "absolute",
    top: "0.5em",
    right: "0",
    font: "inherit",
    fontSize: "0.75rem",
    padding: "0.125rem 0.5rem",
    borderRadius: "0.25rem",
    border: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    opacity: "0",
  },
  ".cm-live-block:hover .cm-live-block-edit, .cm-live-block-edit:focus-visible": { opacity: "1" },
});

/**
 * The block layer, for an editor that has the Markdown language. `host` hands the drawings what Preview's providers
 * hand it (see `LiveBlockHost`).
 */
export function liveBlocks(host?: LiveBlockHost): Extension {
  return [liveBlocksField, redrawAfterPause, blockArrows, blockTheme, host ? liveBlockHost.of(host) : []];
}
