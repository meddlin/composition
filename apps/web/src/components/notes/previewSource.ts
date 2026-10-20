import { SOURCE_ATTRIBUTE } from "./rehypeSourceSpans";

export { SOURCE_ATTRIBUTE };

/** What the renderer left out of a piece of text that the note's own text has: spaces, `>` and `\`. */
const SKIPPABLE = new Set([" ", "\t", ">", "\\"]);
const CHARACTER_REFERENCE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;

/**
 * Where each character of `rendered` (a piece of the preview's text) sits in `source` (the note's
 * text it was rendered from), as an index into `source`; null when that can't be said for sure.
 *
 * The two differ by what Markdown consumes: the backslash of an escape (`\_` shows as `_`), the `>`
 * of a quote and the indent of a list item at the start of each continued line, spaces before a line
 * break. So every character of `rendered` is found, in order, in `source`, skipping only those. The
 * character of an escape maps to the character itself, not the backslash.
 *
 * Character references (`&amp;`) are not attempted: `&` is one character on screen and a run of them
 * in the note, and guessing would highlight the wrong text.
 */
export function alignText(rendered: string, source: string): number[] | null {
  if (CHARACTER_REFERENCE.test(source)) return null;
  const map: number[] = [];
  let j = 0;
  for (const char of rendered) {
    while (j < source.length && !source.startsWith(char, j)) {
      // The renderer never joins lines, so a line's end can't be skipped over to find a character.
      if (!SKIPPABLE.has(source[j])) return null;
      j++;
    }
    if (j >= source.length) return null;
    // A character outside the BMP is two UTF-16 units, and `rendered` is indexed by those.
    for (let k = 0; k < char.length; k++) map.push(j + k);
    j += char.length;
  }
  return map;
}

export type SourceRange = { ok: true; start: number; end: number } | { ok: false; reason: string };

const NO_TEXT = "There is no text in the selection that can be highlighted (code can't be).";
const UNLOCATABLE =
  "Some of the selected text can't be traced back to the note (it uses a character, such as &, that the note writes out another way). Select it in the editor instead.";

/**
 * The stretch of the note's text (`body`, which the preview was rendered from) that a selection in
 * the rendered preview covers, from its first selected character to its last. It may include text
 * that wasn't selected, such as code between two paragraphs; highlighting skips that.
 */
export function sourceRangeOf(root: HTMLElement, range: Range, body: string): SourceRange {
  if (!root.contains(range.commonAncestorContainer)) return { ok: false, reason: "The selection reaches outside the note." };

  let start = Infinity;
  let end = -Infinity;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(node)) continue;
    const marked = node.parentElement?.getAttribute(SOURCE_ATTRIBUTE)?.split("-");
    if (!marked) continue;
    const from = range.startContainer === node ? range.startOffset : 0;
    const to = range.endContainer === node ? range.endOffset : node.length;
    if (from >= to) continue;

    const at = Number(marked[0]);
    const map = alignText(node.data, body.slice(at, Number(marked[1])));
    if (!map) return { ok: false, reason: UNLOCATABLE };
    start = Math.min(start, at + map[from]);
    end = Math.max(end, at + map[to - 1] + 1);
  }
  return end < start ? { ok: false, reason: NO_TEXT } : { ok: true, start, end };
}
