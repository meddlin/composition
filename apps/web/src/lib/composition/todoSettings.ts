import type { DayOfWeek } from "./todoWeeks";

/**
 * How the to-do cycle is set up, in Settings > To-dos (desktop app). Pure, like writing.ts: the stored shape, its
 * defaults, and the two ways of checking it.
 */

export type TodoSettings = {
  /** The first day of the week, 0 (Sunday) to 6 (Saturday). */
  weekStartsOn: DayOfWeek;
  /** How long archived items are kept, in months; `null` is Keep forever. */
  retentionMonths: number | null;
  /** The month a fiscal year starts in, 1 (January) to 12. Quarters in the reports follow it. */
  fiscalYearStartMonth: number;
};

export const DEFAULT_TODO_SETTINGS: TodoSettings = {
  weekStartsOn: 0,
  retentionMonths: 60,
  fiscalYearStartMonth: 1,
};

/** The shortest window: a month. Anything shorter would purge what was archived at the last week close. */
export const MIN_RETENTION_MONTHS = 1;
/** The longest window (50 years); beyond that, Keep forever. */
export const MAX_RETENTION_MONTHS = 600;

export const RETENTION_ERROR = `Keep archived items for a whole number of months from ${MIN_RETENTION_MONTHS} to ${MAX_RETENTION_MONTHS}, or choose Keep forever.`;

export const isWeekStart =(value: unknown): value is DayOfWeek => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;

/** A window of months, or `null` for Keep forever. */
export const isRetention = (value: unknown): value is number | null =>
  value === null || (Number.isInteger(value) && (value as number) >= MIN_RETENTION_MONTHS && (value as number) <= MAX_RETENTION_MONTHS);

export const isFiscalStartMonth = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12;

/** Reads settings from already-parsed JSON, falling back to the default for anything missing or invalid. */
export function parseTodoSettings(data: unknown): TodoSettings {
  const value = (data ?? {}) as Record<string, unknown>;
  const defaults = DEFAULT_TODO_SETTINGS;
  return {
    weekStartsOn: isWeekStart(value.weekStartsOn) ? value.weekStartsOn : defaults.weekStartsOn,
    retentionMonths: isRetention(value.retentionMonths) ? value.retentionMonths : defaults.retentionMonths,
    fiscalYearStartMonth: isFiscalStartMonth(value.fiscalYearStartMonth) ? value.fiscalYearStartMonth : defaults.fiscalYearStartMonth,
  };
}

/**
 * Checks settings that arrive from the UI. Unlike `parseTodoSettings` it refuses rather than repairs: a window of 0 months
 * is an error to show the user, not a quiet 5 years. Only the three settings come back, whatever else was sent.
 */
export function validateTodoSettings(
  data: unknown,
): { settings: TodoSettings; error?: undefined } | { error: string; settings?: undefined } {
  const value = (data ?? {}) as Record<string, unknown>;
  if (!isWeekStart(value.weekStartsOn)) return { error: "Pick the day the week starts on." };
  if (!isRetention(value.retentionMonths)) return { error: RETENTION_ERROR };
  if (!isFiscalStartMonth(value.fiscalYearStartMonth)) return { error: "Pick the month the fiscal year starts in." };
  return {
    settings: {
      weekStartsOn: value.weekStartsOn,
      retentionMonths: value.retentionMonths,
      fiscalYearStartMonth: value.fiscalYearStartMonth,
    },
  };
}
