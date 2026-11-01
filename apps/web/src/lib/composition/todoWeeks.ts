/**
 * The calendar rules behind the to-do weekly cycle: which week a date is in, which weeks have closed, and the months
 * and fiscal quarters the reports are written for. Pure data and arithmetic, so the sweep, the reports and their tests
 * share one definition.
 *
 * Everything works on local calendar dates written "YYYY-MM-DD", never on instants. A "week" is a run of dates, not
 * 7 x 24 hours: that drifts an hour after a daylight-saving change, and in some zones local midnight does not exist on
 * the day the clocks move (docs/todo-archival-plan.md, Gate A).
 */

/** A local calendar date, "YYYY-MM-DD". Dates in this form sort and compare correctly as strings. */
export type LocalDate = string;

/** 0 is Sunday, as in `Date.getDay`. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A run of days, first and last included. */
export type Period = { start: LocalDate; end: LocalDate };

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Whole days since 1970-01-01. Done in UTC, which has no daylight saving, so adding days is always exact. */
function toDayNumber(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function fromDayNumber(days: number): LocalDate {
  const d = new Date(days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 1970-01-01 was a Thursday. */
export function dayOfWeek(date: LocalDate): DayOfWeek {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7 as DayOfWeek;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** The date on the wall clock of the machine at that instant, in its current time zone. */
export function localDateOf(instant: Date): LocalDate {
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

/** The week a date is in: seven days, starting on `startDay`. */
export function weekOf(date: LocalDate, startDay: DayOfWeek): Period {
  const back = (dayOfWeek(date) - startDay + 7) % 7;
  const start = addDays(date, -back);
  return { start, end: addDays(start, 6) };
}

/** The first of a month, with `month` counted from 1 and allowed to run past 12 or below 1 into the next or last year. */
function firstOfMonth(year: number, month: number): LocalDate {
  return `${year + Math.floor((month - 1) / 12)}-${pad((((month - 1) % 12) + 12) % 12 + 1)}-01`;
}

function yearAndMonth(date: LocalDate): [number, number] {
  const [year, month] = date.split("-").map(Number);
  return [year, month];
}

/** Whether the text is a real calendar date written "2026-10-18" ("2026-02-30" is not). */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The calendar month a date is in. */
export function monthOf(date: LocalDate): Period {
  const [year, month] = yearAndMonth(date);
  return { start: firstOfMonth(year, month), end: addDays(firstOfMonth(year, month + 1), -1) };
}

/** A quarter of a fiscal year. `fiscalYear` is named by the calendar year the fiscal year ends in. */
export type FiscalQuarter = Period & { fiscalYear: number; quarter: 1 | 2 | 3 | 4 };

/**
 * The fiscal quarter a date is in, for a fiscal year that starts in `fiscalStartMonth` (1 is January). A year that
 * starts in January is the calendar year; one that starts in October 2026 is 2027, so its first quarter is
 * October to December 2026.
 */
export function fiscalQuarterOf(date: LocalDate, fiscalStartMonth: number): FiscalQuarter {
  const [year, month] = yearAndMonth(date);
  const monthsIn = (month - fiscalStartMonth + 12) % 12;
  const quarterStartMonth = month - (monthsIn % 3);
  const start = firstOfMonth(year, quarterStartMonth);
  const [startYear, startMonth] = yearAndMonth(start);
  const fiscalYearStartedIn = month >= fiscalStartMonth ? year : year - 1;
  return {
    start,
    end: addDays(firstOfMonth(startYear, startMonth + 3), -1),
    fiscalYear: fiscalStartMonth === 1 ? fiscalYearStartedIn : fiscalYearStartedIn + 1,
    quarter: (Math.floor(monthsIn / 3) + 1) as 1 | 2 | 3 | 4,
  };
}

/** The most recent month that is over: the one before the month `today` is in. */
export function latestClosedMonth(today: LocalDate): Period {
  return monthOf(addDays(monthOf(today).start, -1));
}

/** The most recent fiscal quarter that is over: the one before the quarter `today` is in. */
export function latestClosedQuarter(today: LocalDate, fiscalStartMonth: number): FiscalQuarter {
  return fiscalQuarterOf(addDays(fiscalQuarterOf(today, fiscalStartMonth).start, -1), fiscalStartMonth);
}

/** The most recent week that is over: the one before the week `today` is in. */
export function latestClosedWeek(today: LocalDate, startDay: DayOfWeek): Period {
  return weekOf(addDays(weekOf(today, startDay).start, -1), startDay);
}

/**
 * The periods that closed after `lastClosedEnd` and are over by `today`, oldest first. A period closes on the first
 * date after its last day. The first one starts the day after `lastClosedEnd` and ends where the period holding that
 * day ends, so if the rules changed (a new week start day) it can be shorter than usual, but no date is ever missed or
 * counted twice.
 */
function closedAfter<P extends Period>(holding: (date: LocalDate) => P, lastClosedEnd: LocalDate, today: LocalDate): P[] {
  const periods: P[] = [];
  let start = addDays(lastClosedEnd, 1);
  for (let end = holding(start).end; end < today; end = holding(start).end) {
    periods.push({ ...holding(start), start });
    start = addDays(end, 1);
  }
  return periods;
}

/** The weeks that closed after `lastClosedEnd` and are over by `today`, oldest first. */
export function weeksToClose(lastClosedEnd: LocalDate, today: LocalDate, startDay: DayOfWeek): Period[] {
  return closedAfter((date) => weekOf(date, startDay), lastClosedEnd, today);
}

/** The months that closed after `lastClosedEnd` and are over by `today`, oldest first. */
export function monthsToClose(lastClosedEnd: LocalDate, today: LocalDate): Period[] {
  return closedAfter(monthOf, lastClosedEnd, today);
}

/** The fiscal quarters that closed after `lastClosedEnd` and are over by `today`, oldest first. */
export function quartersToClose(lastClosedEnd: LocalDate, today: LocalDate, fiscalStartMonth: number): FiscalQuarter[] {
  return closedAfter((date) => fiscalQuarterOf(date, fiscalStartMonth), lastClosedEnd, today);
}
