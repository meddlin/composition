/**
 * Excel's dates: whole days counted from 1900, as numbers. Pure, shared with the terminal app.
 *
 * Excel's calendar has a day that never was, 29 February 1900 (serial 60), kept from Lotus 1-2-3. So the
 * serials before 1 March 1900 are one less than the real days since 30 December 1899, and serial 0 is the
 * "day 0" of January 1900. Every rule here was checked against Excel (spikes/sheet/excel-verified-cases.json).
 */

export const MAX_SERIAL = 2_958_465; // 31 December 9999

const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);
const FIRST_REAL_SERIAL = 61; // 1 March 1900, from here the serial is the real count of days

export type Ymd = { year: number; month: number; day: number };

/** The real days between 30 December 1899 and the first of a month (year, month 1-12, as numbers that may overflow). */
const realMonthStart = (year: number, month: number) => Math.round((Date.UTC(year, month - 1, 1) - EPOCH) / DAY_MS);

/** The serial of the first day of a month, in Excel's calendar. `month` may be past 12 or below 1. */
function monthStart(year: number, month: number): number {
  const total = year * 12 + (month - 1);
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const real = realMonthStart(y, m);
  return real < FIRST_REAL_SERIAL ? real - 1 : real;
}

const inRange = (serial: number) => (Number.isFinite(serial) && serial >= 0 && serial <= MAX_SERIAL ? serial : null);

/** A date as a serial number, or `null` where Excel says `#NUM!`. A year from 0 to 1899 is counted from 1900. */
export function ymdToSerial(year: number, month: number, day: number): number | null {
  if (year < 0 || year >= 10_000) return null;
  return inRange(monthStart(year < 1900 ? year + 1900 : year, month) + day - 1);
}

/** A serial number (its whole days) as a date, or `null` where Excel says `#NUM!`. Serial 0 is January 0th, 1900. */
export function serialToYmd(serial: number): Ymd | null {
  const days = Math.floor(serial);
  if (days < 0 || days > MAX_SERIAL) return null;
  if (days === 0) return { year: 1900, month: 1, day: 0 };
  if (days <= 31) return { year: 1900, month: 1, day: days };
  if (days <= 60) return { year: 1900, month: 2, day: days - 31 };
  const date = new Date(EPOCH + days * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** The serial of the last day of the month `months` after the one `serial` is in. */
export function endOfMonth(serial: number, months: number): number | null {
  const date = serialToYmd(serial);
  if (!date) return null;
  return inRange(monthStart(date.year, date.month + months + 1) - 1);
}

/** The same day of the month, `months` later (or the last day, where that month is shorter). */
export function addMonths(serial: number, months: number): number | null {
  const date = serialToYmd(serial);
  if (!date) return null;
  const first = monthStart(date.year, date.month + months);
  const length = monthStart(date.year, date.month + months + 1) - first;
  return inRange(first + Math.min(date.day, length) - 1);
}

/** The day of the week, 0 for Sunday: serial 1 is a Sunday in Excel's calendar. */
export const dayOfWeek = (serial: number) => (((Math.floor(serial) - 1) % 7) + 7) % 7;

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
