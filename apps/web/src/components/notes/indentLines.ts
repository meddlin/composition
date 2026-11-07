/** Ctrl+] and Ctrl+[ (VS Code's Cmd/Ctrl+] and [, minus Cmd, which Back and Forward already use on a Mac); `aria-keyshortcuts` says the same. */
export const INDENT_SHORTCUT = "Control+]";
export const OUTDENT_SHORTCUT = "Control+[";

/** The width of the leading spaces one outdent takes off a line that is indented with spaces, not a tab. */
const SPACE_INDENT = 4;

export type IndentEdit = {
  /** `[start, end)` of the text, whole lines, is swapped for `text`. */
  start: number;
  end: number;
  text: string;
  /** Where the selection goes, in the new text. */
  selection: { start: number; end: number };
};

/** What a key press asks of the lines under the selection: indent them, outdent them, or nothing (it is a key for something else). */
export type IndentCommand = "indent" | "outdent";

type KeyEvent = { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };

/**
 * The indent command a key press is, if it is one. Tab and Shift+Tab are only one when the selection spans lines
 * (otherwise Tab types a tab and Shift+Tab leaves the editor); Ctrl+] and Ctrl+[ always are.
 */
export function indentCommandFor(event: KeyEvent, text: string, selection: { start: number; end: number }): IndentCommand | null {
  if (event.altKey || event.metaKey) return null;
  if (event.key === "Tab" && !event.ctrlKey) {
    if (!text.slice(selection.start, selection.end).includes("\n")) return null;
    return event.shiftKey ? "outdent" : "indent";
  }
  if (event.ctrlKey && !event.shiftKey) {
    if (event.key === "]") return "indent";
    if (event.key === "[") return "outdent";
  }
  return null;
}

/** How many characters an outdent takes off the front of `line`: a tab, or up to four spaces. */
function outdentWidth(line: string): number {
  if (line.startsWith("\t")) return 1;
  let width = 0;
  while (width < SPACE_INDENT && line[width] === " ") width++;
  return width;
}

/**
 * Indents or outdents every line the selection touches, the way a code editor does: a selection that ends at the
 * very start of a line does not touch that line, an empty line is not indented, and the selection stays on the
 * same text. Null when nothing would change.
 */
export function indentLines(text: string, from: number, to: number, command: IndentCommand): IndentEdit | null {
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const lastChar = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const found = text.indexOf("\n", lastChar);
  const end = found === -1 ? text.length : found;

  // Each line, and by how much its front grows (or, below zero, shrinks).
  const lines: { offset: number; delta: number; line: string }[] = [];
  let offset = start;
  for (const line of text.slice(start, end).split("\n")) {
    const delta = command === "indent" ? (line === "" ? 0 : 1) : -outdentWidth(line);
    lines.push({ offset, delta, line });
    offset += line.length + 1;
  }
  if (lines.every((l) => l.delta === 0)) return null;

  const out = lines
    .map(({ line, delta }) => (delta > 0 ? "\t" + line : line.slice(-delta)))
    .join("\n");

  // Where a position of the old text lands: past the edits before it, and (for a caret inside the front of a
  // line that lost it) no further back than the line's start. A position at a line's start stays there on indent.
  const move = (pos: number) => {
    let shift = 0;
    for (const { offset: at, delta, line } of lines) {
      if (pos < at) break;
      const column = pos - at;
      if (pos > at + line.length) shift += delta;
      else shift += delta > 0 ? (column > 0 ? delta : 0) : Math.max(delta, -column);
    }
    return pos + shift;
  };

  return { start, end, text: out, selection: { start: move(from), end: move(to) } };
}
