/**
 * Highlighting text in a note: turning a selection into `<Mark color="…">` tags in the note's own
 * text, and taking them off again. Pure, so the editor's and the preview's menus share it and it is
 * tested without a browser.
 *
 * A selection can cut across formatting (`**bo|ld** te|xt`) or span several paragraphs, and a tag
 * pair can't. So the note is parsed, and every run of plain text the selection touches gets a pair of
 * its own: `**bo<Mark>ld</Mark>** <Mark>te</Mark>xt`. Tags therefore always sit inside whatever
 * formatting the text is in, never across it. Code, frontmatter and tag attributes hold no such text,
 * so they are never highlighted.
 *
 * Offsets are into the whole note, frontmatter included, as a textarea reports them.
 *
 * Marks carry a note across a line: once one is added, the note is read as MDX (see
 * `usesMdxComponent`), which is stricter than Markdown. A note MDX can't read, or one where the tags
 * would change how the surrounding formatting parses, is refused with the reason rather than edited.
 */
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseFrontmatter } from "@/lib/composition/frontmatter";
import { mdxComponents, usesMdxComponent } from "./mdx/components";
import { highlightColorOf, type HighlightColor } from "./mdx/highlightColors";
import { remarkIndentedCode } from "./mdx/remarkIndentedCode";
import { remarkRestrictMdx } from "./mdx/remarkRestrictMdx";

export type TextRange = { start: number; end: number };

export type HighlightResult =
  /** The new text of the note, and the highlighted text within it, for the caller to select again. */
  | { ok: true; text: string; selection: TextRange }
  | { ok: false; reason: string };

// The mdast shapes this reads, loosely: the parser and its plugins are typed by their own packages.
type Node = {
  type: string;
  name?: string | null;
  value?: string;
  attributes?: { name?: string; value?: unknown }[];
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

const TAG = "Mark";

// The same plugins as the preview's MDX path (NoteMarkdown.tsx), less what only renders.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMdx)
  .use(remarkIndentedCode)
  .use(remarkRestrictMdx, { allowed: Object.keys(mdxComponents) });

const start = (node: Node) => node.position?.start.offset ?? 0;
const end = (node: Node) => node.position?.end.offset ?? 0;
const isMark = (node: Node) => (node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") && node.name === TAG;
const openTag = (color: HighlightColor) => `<${TAG} color="${color}">`;
const CLOSE_TAG = `</${TAG}>`;

type Parsed = { tree: Node } | { error: string };

/** Parses a note's body as the preview would read it once it holds a component, or says why it can't. */
function parseMdx(body: string): Parsed {
  try {
    const tree = processor.parse(body) as Node;
    // The allowlist plugin renames tags as it runs, and the caller needs them as written.
    processor.runSync(structuredClone(tree) as never);
    return { tree };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// A note with no component is shown as plain Markdown, which MDX reads differently in a few places.
const plainProcessor = unified().use(remarkParse).use(remarkGfm);

const unreadable = (message: string): HighlightResult => ({
  ok: false,
  reason: `This note can't hold highlights, because highlights make it MDX and MDX can't read it: ${message}`,
});

/** Everything the three operations start from. */
type Prepared = { body: string; frontmatterLength: number; tree: Node; from: number; to: number };

function prepare(text: string, range: TextRange): Prepared | { failure: HighlightResult } {
  const [, body] = parseFrontmatter(text);
  const frontmatterLength = text.length - body.length;
  // The note as it is shown now: as MDX if it already has components, as plain Markdown if not. What
  // a highlight must not change is that, so a note MDX would show differently is caught below.
  const parsed: Parsed = usesMdxComponent(body) ? parseMdx(body) : { tree: plainProcessor.parse(body) as Node };
  if ("error" in parsed) return { failure: unreadable(parsed.error) };
  // A selection that begins in the frontmatter is taken from where the body begins.
  const from = Math.max(0, Math.min(range.start, range.end) - frontmatterLength);
  const to = Math.min(body.length, Math.max(range.start, range.end) - frontmatterLength);
  return { body, frontmatterLength, tree: parsed.tree, from, to };
}

type Leaf = { start: number; end: number; mark: Node | null };
type Found = { leaves: Leaf[]; marks: Node[] };

/** The runs of text a highlight can go around, and the highlights already there. */
function collect(node: Node, found: Found = { leaves: [], marks: [] }, mark: Node | null = null, parent: Node | null = null): Found {
  if (isMark(node)) {
    found.marks.push(node);
    mark = node;
  }
  if (node.type === "text" && node.position) {
    // A bare web address is a link whose only content is itself; wrapping it would stop it being one.
    const bareLink = parent?.type === "link" && start(parent) === start(node) && end(parent) === end(node);
    if (!bareLink) found.leaves.push({ start: start(node), end: end(node), mark });
  }
  for (const child of node.children ?? []) collect(child, found, mark, node);
  return found;
}

/** A backslash escape or a character reference: a unit that must not be split by a tag. */
const UNSPLITTABLE = /\\[!-/:-@[-`{-~]|&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g;

/**
 * Where a highlight of `[from, to)` inside the text run `[leafStart, leafEnd)` should go: widened to
 * take in any escape or character reference it would otherwise cut, then shrunk off the spaces at
 * either end, and off the `>` and indent a quote or list item puts at the start of a continued line
 * (a tag in front of those would end the quote). Null when only such characters were selected.
 */
function tighten(body: string, leafStart: number, leafEnd: number, from: number, to: number): TextRange | null {
  for (const unit of body.slice(leafStart, leafEnd).matchAll(UNSPLITTABLE)) {
    const unitStart = leafStart + unit.index;
    const unitEnd = unitStart + unit[0].length;
    if (from > unitStart && from < unitEnd) from = unitStart;
    if (to > unitStart && to < unitEnd) to = unitEnd;
  }
  let lineBroken = false;
  while (from < to) {
    const char = body[from];
    if (char === "\n") lineBroken = true;
    else if (!/\s/.test(char) && !(lineBroken && char === ">")) break;
    from++;
  }
  while (to > from) {
    if (/\s/.test(body[to - 1])) to--;
    else if (body[to - 1] === ">") {
      // The `>` of a quote at the start of a line that nothing else is on yet.
      const lineStart = body.lastIndexOf("\n", to - 1) + 1;
      if (lineStart <= from || !/^[ \t>]*$/.test(body.slice(lineStart, to))) break;
      to = lineStart;
    } else break;
  }
  return from < to ? { start: from, end: to } : null;
}

const intersects = (a: number, b: number, from: number, to: number) => (from === to ? a < from && from < b : a < to && from < b);

/** The `>` that ends the opening tag of `mark`, and where its closing tag begins; null for `<Mark />`. */
function tagsOf(body: string, mark: Node): { openEnd: number; closeStart: number } | null {
  let quote = "";
  for (let i = start(mark) + 1; i < end(mark); i++) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") {
      const closeStart = body.lastIndexOf("</", end(mark) - 1);
      return i + 1 < end(mark) && closeStart >= i + 1 ? { openEnd: i + 1, closeStart } : null;
    }
  }
  return null;
}

const colorOf = (mark: Node): unknown => mark.attributes?.find((a) => a.name === "color")?.value;

/** A change to the body: `[start, end)` becomes `text`. `role` says which tag of a pair it is. */
type Edit = { start: number; end: number; text: string; role: "open" | "close" };

/** Applies the edits, and finds the text between the first opening and the last closing tag. */
function apply(prepared: Prepared, edits: Edit[], text: string): HighlightResult {
  const { body, frontmatterLength } = prepared;
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let cursor = 0;
  let selectionStart = -1;
  let selectionEnd = 0;
  for (const edit of sorted) {
    out += body.slice(cursor, edit.start);
    const before = out.length;
    out += edit.text;
    cursor = edit.end;
    if (edit.role === "open" && selectionStart === -1) selectionStart = out.length;
    if (edit.role === "close") selectionEnd = before;
  }
  out += body.slice(cursor);

  const changed = parseMdx(out);
  if ("error" in changed) return unreadable(changed.error);
  const shown = skeleton(prepared.tree);
  if (shown !== skeleton(changed.tree)) {
    // Is it the tags, or would the note read differently as MDX even with none?
    const asMdx = parseMdx(prepared.body);
    const mdxToo = "tree" in asMdx && skeleton(asMdx.tree) === shown;
    return {
      ok: false,
      reason: mdxToo
        ? "A highlight here would break the formatting around it, for example inside part of a word that is bold or italic. Select the whole word or phrase instead."
        : "Highlighting would turn this note into MDX, which shows part of it differently from how it looks now, so the highlight wasn't added.",
    };
  }
  const prefix = text.slice(0, frontmatterLength);
  return { ok: true, text: prefix + out, selection: { start: frontmatterLength + selectionStart, end: frontmatterLength + selectionEnd } };
}

/**
 * The note's structure with the highlights looked through and positions left out (the replacer below): what the tags
 * must not change. Adjacent text is joined, because a tag splits a run of text in two.
 */
function skeleton(root: Node): string {
  const nodes = (children: Node[]): unknown[] => {
    const out: Record<string, unknown>[] = [];
    for (const child of children) {
      const parts = isMark(child) ? nodes(child.children ?? []) : [node(child)];
      for (const part of parts as Record<string, unknown>[]) {
        const last = out[out.length - 1];
        if (part.type === "text" && last?.type === "text") last.value = `${last.value}${part.value}`;
        else out.push(part);
      }
    }
    return out;
  };
  const node = (n: Node): Record<string, unknown> => {
    const { children, ...rest } = n;
    return children ? { ...rest, children: nodes(children) } : { ...rest };
  };
  return JSON.stringify(nodes(root.children ?? []), (key, value) => (key === "position" ? undefined : value));
}

/** Edits that put `color` on `mark`: its opening tag rewritten, and an anchor at its closing tag. */
function recolor(body: string, mark: Node, color: HighlightColor): Edit[] {
  const tags = tagsOf(body, mark);
  if (!tags) return [];
  return [
    { start: start(mark), end: tags.openEnd, text: openTag(color), role: "open" },
    { start: tags.closeStart, end: tags.closeStart, text: "", role: "close" },
  ];
}

/** Edits that take both tags off `mark`. */
function unwrap(body: string, mark: Node): Edit[] {
  const tags = tagsOf(body, mark);
  if (!tags) return [];
  return [
    { start: start(mark), end: tags.openEnd, text: "", role: "open" },
    { start: tags.closeStart, end: end(mark), text: "", role: "close" },
  ];
}

/**
 * Highlights the text in `range` with `color`. Text already highlighted keeps its tags but takes
 * the new colour (all of that highlight, not just the part selected).
 */
export function highlightRange(text: string, range: TextRange, color: HighlightColor): HighlightResult {
  const prepared = prepare(text, range);
  if ("failure" in prepared) return prepared.failure;
  const { body, tree, from, to } = prepared;
  if (from >= to) return { ok: false, reason: "Select some text to highlight." };

  const { leaves, marks } = collect(tree);
  const edits: Edit[] = [];
  const hit = marks.filter((mark) => intersects(start(mark), end(mark), from, to));
  for (const mark of hit) if (colorOf(mark) !== color) edits.push(...recolor(body, mark, color));

  let touched = hit.length > 0;
  for (const leaf of leaves) {
    if (leaf.mark || !intersects(leaf.start, leaf.end, from, to)) continue;
    const span = tighten(body, leaf.start, leaf.end, Math.max(from, leaf.start), Math.min(to, leaf.end));
    if (!span) continue;
    touched = true;
    edits.push(
      { start: span.start, end: span.start, text: openTag(color), role: "open" },
      { start: span.end, end: span.end, text: CLOSE_TAG, role: "close" },
    );
  }

  if (!touched) return { ok: false, reason: "There is no text in the selection that can be highlighted (code can't be)." };
  if (edits.length === 0) return unchanged(prepared, hit, text);
  return apply(prepared, edits, text);
}

/** Takes the highlights the selection touches (or the caret is in) off, whatever their colour. */
export function removeHighlight(text: string, range: TextRange): HighlightResult {
  const prepared = prepare(text, range);
  if ("failure" in prepared) return prepared.failure;
  const { body, tree, from, to } = prepared;

  const hit = collect(tree).marks.filter((mark) => intersects(start(mark), end(mark), from, to));
  const edits = hit.flatMap((mark) => unwrap(body, mark));
  if (edits.length === 0) return { ok: false, reason: "There is no highlight here to remove." };
  return apply(prepared, edits, text);
}

/** Nothing to change: the text as it is, with the highlights it touches selected. */
function unchanged({ body, frontmatterLength }: Prepared, marks: Node[], text: string): HighlightResult {
  const inner = marks.flatMap((mark) => tagsOf(body, mark) ?? []);
  const first = inner[0];
  const last = inner[inner.length - 1];
  return {
    ok: true,
    text,
    selection: { start: frontmatterLength + (first?.openEnd ?? 0), end: frontmatterLength + (last?.closeStart ?? 0) },
  };
}

/** The highlight around `offset`, if any: its colour, and its whole extent (tags included). */
export function highlightAt(text: string, offset: number): (TextRange & { color: HighlightColor }) | null {
  const prepared = prepare(text, { start: offset, end: offset });
  if ("failure" in prepared) return null;
  const { body, tree, from } = prepared;
  // The innermost one, if highlights are nested by hand.
  const mark = collect(tree)
    .marks.filter((m) => tagsOf(body, m) && start(m) < from && from < end(m))
    .at(-1);
  if (!mark) return null;
  const base = prepared.frontmatterLength;
  return { color: highlightColorOf(colorOf(mark)), start: base + start(mark), end: base + end(mark) };
}
