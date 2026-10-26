/**
 * Breaking a line that has grown past a column, for the editor's reflow setting.
 *
 * This works on the line being typed, the way a plain-text editor's auto-wrap does: it moves the
 * words past the column onto a new line and leaves every other line alone. Lines whose shape
 * matters to Markdown are never broken: frontmatter, code, headings, HTML and JSX, and (unless
 * told otherwise) table rows. A continuation line keeps the line's indent and any `>` quote
 * marks, and sits under the text of a list item rather than under its bullet.
 */

export type ReflowOptions = {
  /** The most characters a line may hold. */
  column: number;
  /** Leave table rows whole. */
  keepTables: boolean;
};

export type ReflowEdit = { text: string; caret: number };

/** Leading whitespace and quote marks, then an optional list marker (and task checkbox). */
const PREFIX = /^(\s*(?:>[ \t]*)*)((?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// Runs on one line of a note at a time, as it is typed. The only ambiguity is whitespace around the first pipe,
// which can't grow beyond the width of a line.
// nosemgrep: detect-redos
const isDelimiterRow = (line: string) => line.includes("|") && TABLE_DELIMITER.test(line);

/** Whether line `i` is inside the frontmatter block at the top of the note. */
function inFrontmatter(lines: string[], i: number): boolean {
  if (lines[0]?.trimEnd() !== "---") return false;
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  return close === -1 || i <= close;
}

/** Whether line `i` is a code fence or sits between a fence's opening and closing lines. */
function inFence(lines: string[], i: number): boolean {
  let open: { char: string; length: number } | null = null;
  for (let index = 0; index <= i; index++) {
    const match = FENCE.exec(lines[index]);
    if (!match) continue;
    const marker = match[1];
    if (!open) {
      open = { char: marker[0], length: marker.length };
      if (index === i) return true;
    } else if (marker[0] === open.char && marker.length >= open.length && lines[index].trim() === marker) {
      if (index === i) return true;
      open = null;
    }
  }
  return open !== null;
}

function isTableRow(lines: string[], i: number): boolean {
  const line = lines[i];
  if (line.trimStart().startsWith("|")) return true;
  if (!line.includes("|")) return false;
  // A run of lines with pipes is a table once it has a delimiter row, and the header is the line above it.
  let first = i;
  while (first > 0 && lines[first - 1].includes("|")) first--;
  let last = i;
  while (last < lines.length - 1 && lines[last + 1].includes("|")) last++;
  for (let d = first + 1; d <= last; d++) {
    if (isDelimiterRow(lines[d]) && i >= d - 1) return true;
  }
  return false;
}

/** Whether Markdown would read line `i` as something other than flowing text, so that breaking it changes its meaning. */
function isRigid(lines: string[], i: number, keepTables: boolean): boolean {
  const line = lines[i];
  if (inFrontmatter(lines, i) || inFence(lines, i)) return true;
  if (HEADING.test(line) || line.trimStart().startsWith("<")) return true;
  if (keepTables && isTableRow(lines, i)) return true;
  // Indented four spaces after a blank line is a code block, unless it is a list item.
  const indented = /^( {4}|\t)/.test(line);
  const listItem = (PREFIX.exec(line)?.[2] ?? "") !== "";
  return indented && !listItem && (i === 0 || lines[i - 1].trim() === "");
}

/** The run of spaces to break at: the last one that leaves the line within `column`, else the first one after it. */
function findBreak(line: string, prefixLength: number, column: number): { start: number; end: number } | null {
  let fallback: { start: number; end: number } | null = null;
  let best: { start: number; end: number } | null = null;
  for (const run of line.matchAll(/ +/g)) {
    const start = run.index;
    const end = start + run[0].length;
    // Nothing to break off before the line's own text starts, or after its last word.
    if (start <= prefixLength || end >= line.length) continue;
    if (start <= column) best = { start, end };
    else {
      fallback = { start, end };
      break;
    }
  }
  return best ?? fallback;
}

/**
 * Breaks the line the caret is on, once or as often as it takes, until it fits in `column` or
 * has nowhere left to break (one long word or URL stays whole). Returns null when the line
 * needs no change.
 */
export function reflowAtCaret(text: string, caret: number, { column, keepTables }: ReflowOptions): ReflowEdit | null {
  let start = caret === 0 ? 0 : text.lastIndexOf("\n", caret - 1) + 1;
  let end = text.indexOf("\n", start);
  if ((end === -1 ? text.length : end) - start <= column) return null;

  const lines = text.split("\n");
  const index = text.slice(0, start).split("\n").length - 1;
  if (isRigid(lines, index, keepTables)) return null;

  const match = PREFIX.exec(lines[index])!;
  const [prefix, lead, marker = ""] = match;
  // Continuation lines line up under the list item's text, not under its bullet or checkbox.
  const bullet = marker.replace(/\[[ xX]\][ \t]+$/, "");
  const indent = lead + " ".repeat(bullet.length);

  let out = text;
  let moved = caret;
  let prefixLength = prefix.length;
  for (;;) {
    end = out.indexOf("\n", start);
    const line = out.slice(start, end === -1 ? out.length : end);
    if (line.length <= column) break;
    const found = findBreak(line, prefixLength, column);
    if (!found) break;
    const from = start + found.start;
    const to = start + found.end;
    out = `${out.slice(0, from)}\n${indent}${out.slice(to)}`;
    if (moved >= to) moved += 1 + indent.length - (to - from);
    else if (moved > from) moved = from + 1 + indent.length;
    start = from + 1;
    prefixLength = indent.length;
  }
  return out === text ? null : { text: out, caret: moved };
}

/** The stretch of `before` that turned into `insert` to make `after`: what to hand an editor command so the rest of the text is left alone. */
export function changedSpan(before: string, after: string): { start: number; end: number; insert: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return { start, end: before.length - tail, insert: after.slice(start, after.length - tail) };
}
