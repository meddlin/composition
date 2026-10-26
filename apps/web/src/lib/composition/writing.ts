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
};

export const DEFAULT_WRITING_SETTINGS: WritingSettings = {
  rulerEnabled: false,
  rulerColumn: DEFAULT_WRITING_COLUMN,
  reflowEnabled: false,
  reflowColumn: DEFAULT_WRITING_COLUMN,
  reflowKeepsTables: true,
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
  for (const key of ["rulerEnabled", "reflowEnabled", "reflowKeepsTables"] as const) {
    if (typeof value[key] !== "boolean") return { error: "Unknown writing setting." };
  }
  for (const key of ["rulerColumn", "reflowColumn"] as const) {
    if (!isWritingColumn(value[key])) {
      return { error: `Use a whole number of characters from ${MIN_WRITING_COLUMN} to ${MAX_WRITING_COLUMN}.` };
    }
  }
  return { settings: parseWritingSettings(value) };
}
