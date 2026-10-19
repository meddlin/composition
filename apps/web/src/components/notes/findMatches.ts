import type { Segment, TokenKind } from "./markdownTokens";

export type FindOptions = {
  matchCase: boolean;
  /** Only count a match that isn't part of a longer word. */
  wholeWord: boolean;
};

/** A found stretch of text: `[start, end)`. */
export type Match = { start: number; end: number };

/** Past this many the search stops: highlighting (and counting) more would only make typing lag. */
export const MAX_MATCHES = 5000;

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every place `query` occurs in `text`, in order and without overlap. The query is plain text, so a
 * phrase is matched as typed (punctuation and spaces included), never as a pattern. Whole-word
 * matching only constrains an end of the query that is itself a word character: "c++" can still
 * be found as a whole word.
 */
export function findMatches(text: string, query: string, { matchCase, wholeWord }: FindOptions): Match[] {
  if (query === "") return [];
  const first = [...query][0];
  const last = [...query].pop()!;
  const before = wholeWord && WORD_CHAR.test(first) ? "(?<![\\p{L}\\p{N}_])" : "";
  const after = wholeWord && WORD_CHAR.test(last) ? "(?![\\p{L}\\p{N}_])" : "";
  const pattern = new RegExp(`${before}${escapeRegExp(query)}${after}`, matchCase ? "gu" : "giu");

  const matches: Match[] = [];
  for (const found of text.matchAll(pattern)) {
    matches.push({ start: found.index, end: found.index + found[0].length });
    if (matches.length === MAX_MATCHES) break;
  }
  return matches;
}

/** How a stretch of the editor's text relates to the search: part of a match, or of the one being looked at. */
export type MatchState = "match" | "current";

export type MarkedSegment = { text: string; kind: TokenKind | null; match: MatchState | null };

/**
 * Cuts the editor's coloured runs at the edges of the matches, tagging the pieces inside one. The
 * pieces still concatenate to the original text, which the highlight layer relies on.
 */
export function markMatches(segments: Segment[], matches: Match[], current: number): MarkedSegment[] {
  if (matches.length === 0) return segments.map((s) => ({ ...s, match: null }));

  const out: MarkedSegment[] = [];
  let at = 0;
  let m = 0;
  for (const segment of segments) {
    const end = at + segment.text.length;
    let pos = at;
    while (pos < end) {
      while (m < matches.length && matches[m].end <= pos) m++;
      const match = matches[m];
      const inside = match !== undefined && match.start <= pos;
      const stop = Math.min(end, inside ? match.end : match === undefined ? end : match.start);
      out.push({
        text: segment.text.slice(pos - at, stop - at),
        kind: segment.kind,
        match: inside ? (m === current ? "current" : "match") : null,
      });
      pos = stop;
    }
    at = end;
  }
  return out;
}

// What starts a new line of the preview's text, so a phrase can't match across two paragraphs.
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, div, tr, figcaption, dt, dd";
const SKIPPED = "script, style";

/**
 * Where each match sits in the DOM under `root`, as ranges. Text is read node by node, joined across
 * inline markup (so `**bold** text` can be found as one phrase) but split at block boundaries.
 */
export function findRanges(root: HTMLElement, query: string, options: FindOptions): Range[] {
  if (query === "") return [];
  const doc = root.ownerDocument;

  // The text of every node, with the offset where each starts in the joined haystack.
  const nodes: { node: Text; start: number }[] = [];
  let haystack = "";
  let block: Element | null = null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIPPED)) continue;
    const nearest = parent.closest(BLOCKS);
    if (nodes.length > 0 && nearest !== block) haystack += "\n";
    block = nearest;
    nodes.push({ node, start: haystack.length });
    haystack += node.data;
  }

  const locate = (offset: number, atEnd: boolean) => {
    // The last node starting at or before `offset`; a match's end belongs to the node it finishes in.
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (nodes[mid].start < offset || (!atEnd && nodes[mid].start === offset)) lo = mid;
      else hi = mid - 1;
    }
    return { node: nodes[lo].node, offset: offset - nodes[lo].start };
  };

  return findMatches(haystack, query, options).map(({ start, end }) => {
    const from = locate(start, false);
    const to = locate(end, true);
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  });
}
