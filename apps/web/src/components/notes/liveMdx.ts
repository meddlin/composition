import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { liveBlockKinds, TABLE } from "./liveBlocks";
import type { BlockKind } from "./liveBlockWidget";
import { mdxRemarkPlugins } from "./NoteMarkdown";

/**
 * MDX components as blocks of the Live tab (Step 6 of docs/live-default-plan.md): `<Info>`, `<Warning>`, `<Drawio>`,
 * `<Chart>`, `<Repo>`, `<Sheet>` and `<YouTube>`, each drawn whole by Preview's `NoteMarkdown`, through the block
 * layer (`liveBlocks.ts`). Inline tags (`<Mark>`, `<Image>`, `<Ink>`) keep their own handling and are not blocks;
 * `<Toc>` and `<Footnotes>` need the whole note and come in Step 7.
 *
 * A component block starts at a top-level node (an HTML block, or a paragraph when the opening tag runs over lines)
 * whose text opens with the tag, and runs to the node holding its matching closing tag, so the Markdown inside it
 * (blank lines, a CSV fence) is part of it. The syntax tree is left as it is, so while the caret is in a component its
 * source is drawn as any Markdown is. One with no closing tag yet is its opening node alone, and since that is not
 * valid MDX it shows its source with a "not rendered yet" note, as does any block MDX can't read yet.
 */

/** The components drawn as blocks, and whether the drawing handles its own clicks (so it gets an Edit source button). */
const COMPONENTS: readonly (readonly [name: string, ownsClicks: boolean])[] = [
  ["Info", false],
  ["Warning", false],
  ["Drawio", false],
  ["Chart", false],
  ["Repo", false],
  // A sheet's grid and a video player take their clicks.
  ["Sheet", true],
  ["YouTube", true],
];

export const BLOCK_COMPONENTS: readonly string[] = COMPONENTS.map(([name]) => name);

/** A tag of one of `names` in some text: where it starts and ends, and what it is. */
export type Tag = { name: string; at: number; end: number; close: boolean; selfClosing: boolean };

/**
 * A tag of any name: `<Name` or `</Name`, the name followed by a space, `/`, `>` or the end. Which names count is
 * checked after (a pattern built from the names would be a regex made at run time, which scanners flag).
 */
const tagPattern = () => /<(\/?)([A-Za-z][\w.-]*)(?=[\s/>]|$)/g;

/**
 * Where the tag whose name ends at `from` ends (past its `>`), and whether it closes itself; "more" when `text` ends
 * first, and "invalid" when a blank line comes first (MDX can't carry a tag across one).
 */
function tagEnd(text: string, from: number): { end: number; selfClosing: boolean } | "more" | "invalid" {
  for (let at = from; at < text.length; at++) {
    const ch = text[at];
    if (ch === '"' || ch === "'") {
      const close = text.indexOf(ch, at + 1);
      if (close === -1) return "more";
      at = close;
    } else if (ch === "{") {
      let depth = 1;
      while (depth > 0 && ++at < text.length) {
        if (text[at] === "{") depth++;
        else if (text[at] === "}") depth--;
      }
      if (at >= text.length) return "more";
    } else if (ch === ">") {
      let before = at - 1;
      while (before >= from && /\s/.test(text[before])) before--;
      return { end: at + 1, selfClosing: before >= from && text[before] === "/" };
    } else if (ch === "\n" && /^\n[ \t]*\r?(\n|$)/.test(text.slice(at, at + 64))) {
      return "invalid";
    }
  }
  return "more";
}

/**
 * The tags of `names` in `text`, in order, leaving out those `inCode` says are in code. Stops at a tag `text` ends in
 * the middle of, returning `more: true`; a tag broken by a blank line is left out.
 */
export function tagsIn(text: string, names: readonly string[], inCode: (at: number) => boolean = () => false): { tags: Tag[]; more: boolean } {
  const tags: Tag[] = [];
  const wanted = new Set(names);
  const pattern = tagPattern();
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const at = match.index;
    const name = match[2];
    if (!wanted.has(name) || inCode(at)) continue;
    const close = match[1] === "/";
    const end = tagEnd(text, at + match[0].length);
    if (end === "more") return { tags, more: true };
    if (end === "invalid") continue;
    tags.push({ name, at, end: end.end, close, selfClosing: !close && end.selfClosing });
    pattern.lastIndex = end.end;
  }
  return { tags, more: false };
}

const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode"]);

/** Whether `pos` is in code, as the syntax tree has it (as far as it is parsed). */
function inCodeAt(state: EditorState, pos: number): boolean {
  for (let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent as typeof node) {
    if (CODE.has(node.name)) return true;
  }
  return false;
}

/**
 * Where the element of `name` whose opening tag starts at `start` ends (past its closing tag, or past the opening tag
 * if it closes itself), or null if it is not closed. The note is read from there in growing pieces, so a nearby closing
 * tag costs a short read and only an unclosed tag reads on to the end.
 */
export function elementEnd(state: EditorState, name: string, start: number): number | null {
  const doc: Text = state.doc;
  for (let size = 4096; ; size *= 4) {
    const to = Math.min(doc.length, start + size);
    const { tags, more } = tagsIn(doc.sliceString(start, to), [name], (at) => inCodeAt(state, start + at));
    let depth = 0;
    for (const [index, tag] of tags.entries()) {
      // The first tag is the opening one.
      if (index === 0 && (tag.at !== 0 || tag.close)) return null;
      if (tag.close) depth--;
      else if (!tag.selfClosing) depth++;
      if (depth === 0) return start + tag.end;
    }
    if (to >= doc.length || (!more && tags.length === 0)) return null;
  }
}

/** An opening tag of any name at the start of a line, after up to three spaces (see `tagPattern`). */
const OPENING = /^ {0,3}<([A-Za-z][\w.-]*)(?=[\s/>]|$)/;

/** The end of the component of `name` that starts at a top-level node (see `BlockKind.reach`). */
function reachOf(name: string) {
  return (state: EditorState, node: { from: number; to: number }): number | null => {
    const head = OPENING.exec(state.doc.sliceString(node.from, Math.min(node.to, node.from + name.length + 5)));
    if (!head || head[1] !== name) return null;
    const start = node.from + head[0].length - name.length - 1;
    const end = elementEnd(state, name, start);
    // Not closed yet: the opening node alone, which can't be drawn yet.
    if (end === null) return node.to;
    // To the end of the top-level node the closing tag is in, as blocks are whole nodes.
    const top = syntaxTree(state).topNode.childBefore(end);
    return Math.max(node.to, top && top.to >= end ? top.to : end);
  };
}

/**
 * Where a component starts above `from` whose closing tag is in `from`..`to` (one typed below its opening tag), or
 * null. Read back from `from` in growing pieces, matching tags as MDX nests them.
 */
export function startAbove(state: EditorState, from: number, to: number): number | null {
  const inCode = (base: number) => (at: number) => inCodeAt(state, base + at);
  // The closing tags in the stretch with no opening one in it, by name.
  const unmatched = new Map<string, number>();
  const open = new Map<string, number>();
  for (const tag of tagsIn(state.doc.sliceString(from, to), BLOCK_COMPONENTS, inCode(from)).tags) {
    if (tag.selfClosing) continue;
    const depth = open.get(tag.name) ?? 0;
    if (!tag.close) open.set(tag.name, depth + 1);
    else if (depth > 0) open.set(tag.name, depth - 1);
    else unmatched.set(tag.name, (unmatched.get(tag.name) ?? 0) + 1);
  }
  if (unmatched.size === 0) return null;

  let earliest: number | null = null;
  for (const [name, count] of unmatched) {
    for (let size = 4096; ; size *= 4) {
      const base = Math.max(0, from - size);
      const { tags } = tagsIn(state.doc.sliceString(base, from), [name], inCode(base));
      let need = count;
      let start: number | null = null;
      for (let index = tags.length - 1; index >= 0 && start === null; index--) {
        const tag = tags[index];
        if (tag.close) need++;
        else if (!tag.selfClosing && --need === 0) start = base + tag.at;
      }
      if (start !== null) {
        earliest = earliest === null ? start : Math.min(earliest, start);
        break;
      }
      if (base === 0) break;
    }
  }
  return earliest;
}

/** Each component's source, read by Preview's MDX plugins, with why it failed: the last few hundred blocks. */
const problems = new Map<string, string | null>();
const PROBLEMS_KEPT = 256;
let processor: ReturnType<typeof makeProcessor> | null = null;

function makeProcessor() {
  return unified().use(remarkParse).use(mdxRemarkPlugins("live-check-")).freeze();
}

/**
 * Why a component's source can't be drawn yet: the failure Preview's `MdxBoundary` shows as an error banner (a tag
 * typed half way, an unknown component, an `{expression}`), or null when it is valid MDX.
 */
export function mdxProblem(source: string): string | null {
  const known = problems.get(source);
  if (known !== undefined) {
    // Most recently used last, so the oldest goes first.
    problems.delete(source);
    problems.set(source, known);
    return known;
  }
  processor ??= makeProcessor();
  let problem: string | null = null;
  try {
    processor.runSync(processor.parse(source));
  } catch (error) {
    problem = error instanceof Error ? (error as Error & { reason?: string }).reason ?? error.message : String(error);
  }
  problems.set(source, problem);
  if (problems.size > PROBLEMS_KEPT) problems.delete(problems.keys().next().value!);
  return problem;
}

/** The block kinds, one a component. */
export const MDX_BLOCK_KINDS: readonly BlockKind[] = COMPONENTS.map(([name, ownsClicks]) => ({
  node: ["HTMLBlock", "Paragraph"],
  name: `mdx-${name}`,
  ownsClicks,
  reach: reachOf(name),
  startAbove,
  problem: mdxProblem,
}));

/** The "not rendered yet" note, small and quiet: it is not an error, just a block being typed. */
const mdxTheme = EditorView.baseTheme({
  // A sheet keeps its own tools (Edit sheet, Export) at its top right, so a component's Edit source goes top left.
  '.cm-live-block[data-kind^="mdx-"] .cm-live-block-edit': { left: "0", right: "auto" },
  ".cm-live-block-pending": {
    margin: "0",
    fontSize: "0.75rem",
    fontStyle: "italic",
    color: "var(--muted-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

/** The Live tab's MDX component blocks, beside its tables. Goes with `liveBlocks`. */
export const liveMdxBlocks: Extension = [liveBlockKinds.of(TABLE), MDX_BLOCK_KINDS.map((kind) => liveBlockKinds.of(kind)), mdxTheme];
