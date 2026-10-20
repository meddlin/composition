import type { Segment } from "./markdownTokens";
import { highlightColorOf, type HighlightColor } from "./mdx/highlightColors";

/** A stretch of the editor's text that sits inside a `<Mark>`, and the colour to paint behind it. */
export type Tint = { start: number; end: number; color: HighlightColor };

// Segments whose tags are not tags: code shows them as text, and frontmatter isn't Markdown.
const LITERAL: ReadonlySet<Segment["kind"]> = new Set(["code", "fence", "frontmatter"]);

const MARK_TAG = /<Mark\b[^<>]*>|<\/Mark\s*>/g;
const COLOR = /\bcolor="([^"]*)"/;

/**
 * Where the text of `text` is highlighted: between each `<Mark …>` and its `</Mark>`, outside code
 * and frontmatter. The tags are found by scanning the text rather than the coloured runs, because
 * the colouring takes `**<Mark>b</Mark>**` and `[<Mark>c</Mark>](url)` as one run each and the tags
 * inside would be lost.
 *
 * The result is in order and does not overlap: where highlights are nested the inner one's colour
 * is used, and the outer one carries on after it. A tag left open, or closed twice, is ignored.
 */
export function markTints(text: string, segments: Segment[]): Tint[] {
  if (!text.includes("<Mark")) return [];

  const literal: [start: number, end: number][] = [];
  let at = 0;
  for (const segment of segments) {
    if (LITERAL.has(segment.kind)) literal.push([at, at + segment.text.length]);
    at += segment.text.length;
  }
  let l = 0;
  const inLiteral = (index: number) => {
    while (l < literal.length && literal[l][1] <= index) l++;
    return l < literal.length && literal[l][0] <= index;
  };

  type Open = { color: HighlightColor; closed: boolean };
  const open: Open[] = [];
  const spans: (Tint & { owner: Open })[] = [];
  let cursor = 0;
  for (const tag of text.matchAll(MARK_TAG)) {
    if (inLiteral(tag.index)) continue;
    const closing = tag[0].startsWith("</");
    if (!closing && tag[0].endsWith("/>")) continue;
    if (closing && open.length === 0) continue;

    const owner = open[open.length - 1];
    if (owner && tag.index > cursor) spans.push({ start: cursor, end: tag.index, color: owner.color, owner });
    cursor = tag.index + tag[0].length;
    if (closing) open.pop()!.closed = true;
    else open.push({ color: highlightColorOf(COLOR.exec(tag[0])?.[1]), closed: false });
  }
  return spans.filter((span) => span.owner.closed).map(({ start, end, color }) => ({ start, end, color }));
}

/**
 * Cuts the editor's runs at the edges of the tints, tagging the pieces inside one. Like `markMatches`
 * the pieces still concatenate to the original text, which the highlight layer relies on.
 */
export function tintSegments<T extends { text: string }>(segments: T[], tints: Tint[]): (T & { tint: HighlightColor | null })[] {
  if (tints.length === 0) return segments.map((s) => ({ ...s, tint: null }));

  const out: (T & { tint: HighlightColor | null })[] = [];
  let at = 0;
  let t = 0;
  for (const segment of segments) {
    const end = at + segment.text.length;
    let pos = at;
    while (pos < end) {
      while (t < tints.length && tints[t].end <= pos) t++;
      const tint = tints[t];
      const inside = tint !== undefined && tint.start <= pos;
      const stop = Math.min(end, inside ? tint.end : tint === undefined ? end : tint.start);
      out.push({ ...segment, text: segment.text.slice(pos - at, stop - at), tint: inside ? tint.color : null });
      pos = stop;
    }
    at = end;
  }
  return out;
}
