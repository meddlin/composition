/**
 * Keeps the two halves of Split at the same place in the note: scrolling one scrolls the other to the matching spot.
 *
 * The halves are matched by where they are in the note's text, not by how far down they are scrolled: a picture, a
 * table, a chart or a component is much taller (or shorter) in the preview than in the editor, so the same fraction of
 * each would show different parts of the note. Each side is described by marks: a place in the text and how far down
 * that side draws it. One side's top is turned into a place in the text through its marks, and the other side scrolls
 * so that the same place is at its top. Between marks the place moves evenly. The iPad does the same
 * (`ScrollSync.swift`).
 */

/** A place in the note's text (fractional inside a block) and how far down a side draws it, in pixels. */
export type Mark = { offset: number; y: number };

/** A block of one side: where it is written in the note (`start` to `end`) and where that side draws it (`top` to `bottom`). */
export type Block = { start: number; end: number; top: number; bottom: number };

/**
 * A side's marks: the start of the note at its top, the top and bottom of each block, and the end of the note at the
 * bottom of what that side draws (`height`). Kept in order both ways (a block that would go back up the text or the
 * page is left out), so that the map from one side to the other never turns back.
 */
export function marksOf(blocks: readonly Block[], textLength: number, height: number): Mark[] {
  const out: Mark[] = [{ offset: 0, y: 0 }];
  const add = (offset: number, y: number) => {
    const last = out[out.length - 1];
    if (offset >= last.offset && y >= last.y) out.push({ offset, y });
  };
  for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
    if (block.bottom < block.top || block.end < block.start) continue;
    add(block.start, block.top);
    add(block.end, block.bottom);
  }
  add(textLength, Math.max(height, out[out.length - 1].y));
  return out;
}

/** How far down the side the marks describe draws the place `offset` in the text. */
export function yAtOffset(marks: readonly Mark[], offset: number): number {
  return interpolate(marks, offset, "offset", "y");
}

/** The place in the text that the side the marks describe draws at `y`. */
export function offsetAtY(marks: readonly Mark[], y: number): number {
  return interpolate(marks, y, "y", "offset");
}

/**
 * Where the other side scrolls to, given where it would put the matching place (`matched`), how far it can scroll
 * (`targetMax`), and where the side that moved is (`sourceTop`, out of `sourceMax`). At the very top the other goes
 * to its top, and at the very bottom to its bottom, so that the end of the note shows in both even where one side's
 * last screen holds more of the note than the other's.
 */
export function follow(matched: number, targetMax: number, sourceTop: number, sourceMax: number): number {
  const most = Math.max(targetMax, 0);
  if (sourceTop <= 1) return 0;
  if (sourceMax > 1 && sourceTop >= sourceMax - 1) return most;
  return Math.min(Math.max(matched, 0), most);
}

/**
 * Piecewise-linear between the marks: `value` measured along `from` gives the matching point along `to`. Before the
 * first mark is the first; after the last, the last. Where several marks share a value (a block with no height), the
 * first of them is taken, so a side shows the start of what the other draws as nothing.
 */
function interpolate(marks: readonly Mark[], value: number, from: keyof Mark, to: keyof Mark): number {
  if (marks.length === 0) return 0;
  const first = marks[0];
  if (value <= first[from]) return first[to];
  const end = Math.min(value, marks[marks.length - 1][from]);
  // The first mark at or past `end`.
  let low = 0;
  let high = marks.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (marks[middle][from] >= end) high = middle;
    else low = middle + 1;
  }
  const after = marks[low];
  if (after[from] === end) return after[to];
  const before = marks[low - 1];
  const fraction = (end - before[from]) / (after[from] - before[from]);
  return before[to] + fraction * (after[to] - before[to]);
}

/** The blocks the preview marked (`data-block-src="start-end"`, in the body), moved into the whole note's text by `shift` (the frontmatter's length). */
export function parseBlockSource(attribute: string | null, shift: number): { start: number; end: number } | null {
  const match = attribute ? /^(\d+)-(\d+)$/.exec(attribute) : null;
  if (!match) return null;
  const start = Number(match[1]) + shift;
  const end = Number(match[2]) + shift;
  return end >= start ? { start, end } : null;
}
