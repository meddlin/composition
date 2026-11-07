import type { IndentEdit } from "./indentLines";

/** Cmd+B and Ctrl+B, Cmd+I and Ctrl+I; `aria-keyshortcuts` says the same. */
export const BOLD_SHORTCUT = "Control+B Meta+B";
export const ITALIC_SHORTCUT = "Control+I Meta+I";

export type Emphasis = "bold" | "italic";

/** The `*` characters Markdown reads as bold (two) or italic (one). */
const WIDTH: Record<Emphasis, number> = { bold: 2, italic: 1 };

type KeyEvent = { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** The emphasis a key press asks for, if it is one: Cmd/Ctrl+B or Cmd/Ctrl+I, with no Shift or Alt. */
export function emphasisFor(event: KeyEvent): Emphasis | null {
  if (event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "b") return "bold";
  if (key === "i") return "italic";
  return null;
}

/** How many `*` run unbroken from `at`, forwards or (with `step` -1) backwards. */
function stars(text: string, at: number, step: 1 | -1): number {
  let count = 0;
  for (let i = step === 1 ? at : at - 1; text[i] === "*"; i += step) count++;
  return count;
}

/**
 * Makes the selection bold or italic by putting `**` or `*` around it, or takes the emphasis off when the selection
 * already has it (the markers inside the selection, or hard against its edges). Bold and italic share the same
 * character, so a run of three means both: italic on `**bold**` makes `***bold***`, and italic again gives `**bold**`.
 *
 * Spaces at the ends of the selection stay outside the markers, since Markdown does not read `** bold**` as bold. The
 * selection afterwards is the text itself, so the same key press undoes what it did. Null with nothing selected (or
 * only spaces): there is no text to mark.
 */
export function toggleEmphasis(text: string, from: number, to: number, emphasis: Emphasis): IndentEdit | null {
  const selected = text.slice(from, to);
  const trimmed = selected.trim();
  if (trimmed === "") return null;
  const start = from + selected.indexOf(trimmed);
  const end = start + trimmed.length;
  const width = WIDTH[emphasis];

  // Markers the selection holds itself win over those around it (a selection of nothing but `*` holds none).
  const inside = /^\*+$/.test(trimmed) ? 0 : Math.min(stars(text, start, 1), stars(text, end, -1));
  const around = inside > 0 ? 0 : Math.min(stars(text, start, -1), stars(text, end, 1));
  const run = inside || around;
  const has = emphasis === "bold" ? run >= 2 : run % 2 === 1;

  if (!has) {
    const mark = "*".repeat(width);
    return {
      start,
      end,
      text: mark + trimmed + mark,
      selection: { start: start + width, end: end + width },
    };
  }

  if (inside > 0) {
    return {
      start,
      end,
      text: trimmed.slice(width, trimmed.length - width),
      selection: { start, end: end - 2 * width },
    };
  }
  return {
    start: start - width,
    end: end + width,
    text: trimmed,
    selection: { start: start - width, end: end - width },
  };
}
