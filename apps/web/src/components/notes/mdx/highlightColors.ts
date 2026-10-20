/**
 * The colours a note's `<Mark color="…">` may use. Names, not hex values: each colour scheme tints
 * them to suit its own background (see `.note-mark` in globals.css), and a note written in one
 * scheme still reads in another. Pure, so the terminal app can share it.
 */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

export const isHighlightColor = (value: unknown): value is HighlightColor =>
  typeof value === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(value);

/** A `color` prop as a colour, falling back to the default for a missing or unknown one. */
export const highlightColorOf = (value: unknown): HighlightColor =>
  isHighlightColor(value) ? value : DEFAULT_HIGHLIGHT_COLOR;
