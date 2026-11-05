import type { Segment } from "./markdownTokens";
import { highlightColorOf, type HighlightColor } from "./mdx/highlightColors";

/** A stretch of the editor's text that sits inside a `<Mark>`, and the colour to paint behind it. */
export type Tint = { start: number; end: number; color: HighlightColor };

// Segments whose tags are not tags: code shows them as text, and frontmatter isn't Markdown.
const LITERAL: ReadonlySet<Segment["kind"]> = new Set(["code", "fence", "frontmatter"]);

const MARK_TAG = /<Mark\b[^<>]*>|<\/Mark\s*>/g;
const COLOR = /\bcolor="([^"]*)"/;

/** Whether an index in the text is in a stretch whose tags are not tags. Ask in increasing order of index. */
export function literalFinder(segments: Segment[]): (index: number) => boolean {
  const literal: [start: number, end: number][] = [];
  let at = 0;
  for (const segment of segments) {
    if (LITERAL.has(segment.kind)) literal.push([at, at + segment.text.length]);
    at += segment.text.length;
  }
  let l = 0;
  return (index) => {
    while (l < literal.length && literal[l][1] <= index) l++;
    return l < literal.length && literal[l][0] <= index;
  };
}

/** A highlight as the text writes it: where its opening and closing tags are. */
export type MarkElement = { open: { start: number; end: number }; close: { start: number; end: number } };

/**
 * The tags of each complete `<Mark …>…</Mark>` pair, outside code and frontmatter, in the order they open. They
 * pair up exactly as `markTints` pairs them, and the same are ignored: a tag left open, one closed twice, a
 * self-closing one.
 */
export function markElements(text: string, segments: Segment[]): MarkElement[] {
  if (!text.includes("<Mark")) return [];

  const inLiteral = literalFinder(segments);
  const open: MarkElement["open"][] = [];
  const elements: MarkElement[] = [];
  for (const tag of text.matchAll(MARK_TAG)) {
    if (inLiteral(tag.index)) continue;
    const closing = tag[0].startsWith("</");
    if (!closing && tag[0].endsWith("/>")) continue;
    if (closing && open.length === 0) continue;

    const range = { start: tag.index, end: tag.index + tag[0].length };
    if (closing) elements.push({ open: open.pop()!, close: range });
    else open.push(range);
  }
  return elements.sort((a, b) => a.open.start - b.open.start);
}

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

  const inLiteral = literalFinder(segments);

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
