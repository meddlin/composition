/**
 * How the Markdown editor helps with the shape of the text, set in Settings.
 *
 * The ruler is only a guide: a vertical line drawn at a column. Reflow acts on the text: as you
 * type, a line that grows past its column is broken at the last space before it. Both are off
 * until switched on, so nothing changes for anyone who doesn't ask for it.
 */

export const MIN_WRITING_COLUMN = 20;
export const MAX_WRITING_COLUMN = 200;
export const DEFAULT_WRITING_COLUMN = 80;

export const HEADING_RAIL_SIDES = ["left", "right"] as const;
export type HeadingRailSide = (typeof HEADING_RAIL_SIDES)[number];

export function isHeadingRailSide(value: unknown): value is HeadingRailSide {
  return HEADING_RAIL_SIDES.some((side) => side === value);
}

export type WritingSettings = {
  /** Draw a vertical guide line at `rulerColumn`. */
  rulerEnabled: boolean;
  rulerColumn: number;
  /** Break lines at `reflowColumn` as they are typed. */
  reflowEnabled: boolean;
  reflowColumn: number;
  /**
   * Keep Markdown tables intact. A table row has to stay on one line to stay a table, so with
   * this on reflow leaves table rows alone; off, they are broken like any other line.
   */
  reflowKeepsTables: boolean;
  /** Show a live word count for the active note in the bar under it. */
  wordCountEnabled: boolean;
  /**
   * A rail of ticks beside the text, one per heading, with the heading you are reading lit. Unlike the rest it is a
   * look rather than a writing aid, so it is set under Settings > Styling and is on unless switched off.
   */
  headingRailEnabled: boolean;
  /** Which edge of the text the heading rail is on. */
  headingRailSide: HeadingRailSide;
};

export const DEFAULT_WRITING_SETTINGS: WritingSettings = {
  rulerEnabled: false,
  rulerColumn: DEFAULT_WRITING_COLUMN,
  reflowEnabled: false,
  reflowColumn: DEFAULT_WRITING_COLUMN,
  reflowKeepsTables: true,
  wordCountEnabled: false,
  headingRailEnabled: true,
  headingRailSide: "left",
};

/** Whether `value` is a whole number of columns the editor can use. */
export function isWritingColumn(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_WRITING_COLUMN &&
    value <= MAX_WRITING_COLUMN
  );
}

function column(value: unknown): number {
  return isWritingColumn(value) ? value : DEFAULT_WRITING_COLUMN;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Reads settings from already-parsed JSON, falling back to the default for anything missing or invalid. */
export function parseWritingSettings(data: unknown): WritingSettings {
  const value = (data ?? {}) as Record<string, unknown>;
  const defaults = DEFAULT_WRITING_SETTINGS;
  return {
    rulerEnabled: flag(value.rulerEnabled, defaults.rulerEnabled),
    rulerColumn: column(value.rulerColumn),
    reflowEnabled: flag(value.reflowEnabled, defaults.reflowEnabled),
    reflowColumn: column(value.reflowColumn),
    reflowKeepsTables: flag(value.reflowKeepsTables, defaults.reflowKeepsTables),
    wordCountEnabled: flag(value.wordCountEnabled, defaults.wordCountEnabled),
    headingRailEnabled: flag(value.headingRailEnabled, defaults.headingRailEnabled),
    headingRailSide: isHeadingRailSide(value.headingRailSide) ? value.headingRailSide : defaults.headingRailSide,
  };
}

/**
 * Checks settings that arrive from the UI. Unlike `parseWritingSettings` it refuses rather than
 * repairs: a column of 5 is an error to show the user, not a quiet 80.
 */
export function validateWritingSettings(
  data: unknown,
): { settings: WritingSettings; error?: undefined } | { error: string; settings?: undefined } {
  const value = (data ?? {}) as Record<string, unknown>;
  for (const key of ["rulerEnabled", "reflowEnabled", "reflowKeepsTables", "wordCountEnabled", "headingRailEnabled"] as const) {
    if (typeof value[key] !== "boolean") return { error: "Unknown writing setting." };
  }
  if (!isHeadingRailSide(value.headingRailSide)) return { error: "Unknown writing setting." };
  for (const key of ["rulerColumn", "reflowColumn"] as const) {
    if (!isWritingColumn(value[key])) {
      return { error: `Use a whole number of characters from ${MIN_WRITING_COLUMN} to ${MAX_WRITING_COLUMN}.` };
    }
  }
  return { settings: parseWritingSettings(value) };
}

/** The number of words in `text`: runs of non-whitespace, so `well-known` is one word. */
export function countWords(text: string): number {
  const words = text.match(/\S+/g);
  return words ? words.length : 0;
}
