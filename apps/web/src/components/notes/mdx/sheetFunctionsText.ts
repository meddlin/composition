/**
 * The text and date functions of a formula (see sheetFunctions.ts). Pure, shared with the terminal app.
 *
 * All take one value per argument, so an array passed to one is lifted: `LEFT(A1:A5,1)` is five letters.
 */
import { type Ymd, addMonths, dayOfWeek, endOfMonth, serialToYmd, ymdToSerial } from "./sheetDate";
import { wildcardFind } from "./sheetCriteria";
import { formatNumber } from "./sheetFormat";
import { type FunctionSpec, flatten } from "./sheetMatrix";
import { ERR, type Scalar, Unsupported, isMatrix, parseNumberText, toBool, toNumber, toText } from "./sheetValue";

const scalar = (min: number, max: number, run: (args: Scalar[]) => Scalar): FunctionSpec => ({ kind: "scalar", min, max, run });

/** A count of characters, cut to a whole number; `fallback` where it was not given. */
const count = (value: Scalar | undefined, fallback: number) => (value === undefined ? fallback : Math.trunc(toNumber(value)));

const MAX_TEXT = 32_767;

/** Whether a character is a letter, for `PROPER`. */
const isLetter = (char: string) => char.toLowerCase() !== char.toUpperCase();

function proper(text: string): string {
  let previousLetter = false;
  let result = "";
  for (const char of text) {
    const letter = isLetter(char);
    result += letter ? (previousLetter ? char.toLowerCase() : char.toUpperCase()) : char;
    previousLetter = letter;
  }
  return result;
}

/** The place, from 1, of the `n`th `find` in `text`, or -1. */
function nth(text: string, find: string, n: number): number {
  let at = -1;
  for (let i = 0; i < n; i++) {
    at = text.indexOf(find, at + 1);
    if (at < 0) return -1;
  }
  return at;
}

/** `TEXT`: a number by a format; a text that is not a number stays as it is, and a logical is its own name. */
function text(value: Scalar, format: Scalar): Scalar {
  const pattern = toText(format);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") {
    const read = parseNumberText(value);
    return read === null ? value : formatNumber(read, pattern);
  }
  return formatNumber(toNumber(value), pattern);
}

const WEEKDAY_FIRST: Record<number, number> = {
  1: 0,
  2: 1,
  3: 1,
  11: 1,
  12: 2,
  13: 3,
  14: 4,
  15: 5,
  16: 6,
  17: 0,
};

export const TEXT_FUNCTIONS: Record<string, FunctionSpec> = {
  LEN: scalar(1, 1, ([value]) => toText(value).length),
  LEFT: scalar(1, 2, ([value, n]) => {
    const length = count(n, 1);
    return length < 0 ? ERR.VALUE : toText(value).slice(0, length);
  }),
  RIGHT: scalar(1, 2, ([value, n]) => {
    const length = count(n, 1);
    const from = toText(value);
    return length < 0 ? ERR.VALUE : length === 0 ? "" : from.slice(-length);
  }),
  MID: scalar(3, 3, ([value, start, length]) => {
    const first = count(start, 1);
    const size = count(length, 0);
    return first < 1 || size < 0 ? ERR.VALUE : toText(value).slice(first - 1, first - 1 + size);
  }),
  UPPER: scalar(1, 1, ([value]) => toText(value).toUpperCase()),
  LOWER: scalar(1, 1, ([value]) => toText(value).toLowerCase()),
  PROPER: scalar(1, 1, ([value]) => proper(toText(value))),
  // Only spaces: a tab stays, as in Excel.
  TRIM: scalar(1, 1, ([value]) =>
    toText(value)
      .replace(/^ +| +$/g, "")
      .replace(/ {2,}/g, " "),
  ),
  SUBSTITUTE: scalar(3, 4, ([value, find, replacement, instance]) => {
    const from = toText(value);
    const old = toText(find);
    const to = toText(replacement);
    if (old === "") return from;
    if (instance === undefined) return from.split(old).join(to);
    const n = Math.trunc(toNumber(instance));
    if (n < 1) return ERR.VALUE;
    const at = nth(from, old, n);
    return at < 0 ? from : from.slice(0, at) + to + from.slice(at + old.length);
  }),
  FIND: scalar(2, 3, ([find, within, start]) => {
    const inside = toText(within);
    const from = count(start, 1);
    if (from < 1 || from > inside.length) return ERR.VALUE;
    const at = inside.indexOf(toText(find), from - 1);
    return at < 0 ? ERR.VALUE : at + 1;
  }),
  SEARCH: scalar(2, 3, ([find, within, start]) => {
    const inside = toText(within);
    const from = count(start, 1);
    if (from < 1 || from > inside.length) return ERR.VALUE;
    const at = wildcardFind(toText(find), inside, from - 1);
    return at < 0 ? ERR.VALUE : at + 1;
  }),
  EXACT: scalar(2, 2, ([a, b]) => toText(a) === toText(b)),
  REPT: scalar(2, 2, ([value, times]) => {
    const n = Math.trunc(toNumber(times));
    const from = toText(value);
    return n < 0 || from.length * n > MAX_TEXT ? ERR.VALUE : from.repeat(n);
  }),
  CONCATENATE: {
    kind: "raw",
    min: 1,
    max: Infinity,
    run: (args) =>
      args
        .map((arg) => {
          const cells = arg === undefined ? [null] : flatten(arg);
          if (isMatrix(arg) && cells.length > 1) throw new Unsupported("CONCATENATE over a range (CONCAT does that)");
          return toText(cells[0]);
        })
        .join(""),
  },
  CONCAT: {
    kind: "raw",
    min: 1,
    max: Infinity,
    run: (args) =>
      args
        .flatMap((arg) => (arg === undefined ? [] : flatten(arg)))
        .map(toText)
        .join(""),
  },
  TEXTJOIN: {
    kind: "raw",
    min: 3,
    max: Infinity,
    run: ([delimiter, ignoreEmpty, ...parts]) => {
      const separator = toText(flatten(delimiter ?? null)[0]);
      const skipEmpty = toBool(flatten(ignoreEmpty ?? null)[0]);
      const cells = parts.flatMap((part) => (part === undefined ? [] : flatten(part))).filter((cell) => !(skipEmpty && (cell === null || cell === "")));
      return cells.map(toText).join(separator);
    },
  },
  VALUE: scalar(1, 1, ([value]) => {
    if (typeof value === "boolean") return ERR.VALUE;
    if (typeof value !== "string") return toNumber(value);
    const read = parseNumberText(value);
    return read === null ? ERR.VALUE : read;
  }),
  TEXT: scalar(2, 2, ([value, format]) => text(value, format)),
  // Only the characters every code page agrees on; the rest are not the same on a Mac as on Windows.
  CHAR: scalar(1, 1, ([value]) => {
    const code = Math.trunc(toNumber(value));
    if (code >= 1 && code <= 127) return String.fromCharCode(code);
    if (code >= 128 && code <= 255) throw new Unsupported("CHAR for a code above 127, which depends on the computer");
    return ERR.VALUE;
  }),
  CODE: scalar(1, 1, ([value]) => {
    const first = toText(value).charCodeAt(0);
    if (Number.isNaN(first)) return ERR.VALUE;
    if (first > 127) throw new Unsupported("CODE for a character above 127, which depends on the computer");
    return first;
  }),
};

/** One part of a date given as a serial number; a negative or out-of-range serial is `#NUM!`. */
function part(value: Scalar, pick: (date: Ymd) => number): Scalar {
  const n = toNumber(value);
  const date = n < 0 ? null : serialToYmd(n);
  return date ? pick(date) : ERR.NUM;
}

export const DATE_FUNCTIONS: Record<string, FunctionSpec> = {
  DATE: scalar(3, 3, ([year, month, day]) => ymdToSerial(Math.trunc(toNumber(year)), Math.trunc(toNumber(month)), Math.trunc(toNumber(day))) ?? ERR.NUM),
  YEAR: scalar(1, 1, ([value]) => part(value, (date) => date.year)),
  MONTH: scalar(1, 1, ([value]) => part(value, (date) => date.month)),
  DAY: scalar(1, 1, ([value]) => part(value, (date) => date.day)),
  EOMONTH: scalar(2, 2, ([start, months]) => endOfMonth(Math.trunc(toNumber(start)), Math.trunc(toNumber(months))) ?? ERR.NUM),
  EDATE: scalar(2, 2, ([start, months]) => addMonths(Math.trunc(toNumber(start)), Math.trunc(toNumber(months))) ?? ERR.NUM),
  WEEKDAY: scalar(1, 2, ([value, type]) => {
    const n = toNumber(value);
    const kind = count(type, 1);
    if (n < 0 || !(kind in WEEKDAY_FIRST) || serialToYmd(n) === null) return ERR.NUM;
    // Types 1, 11-17 number from 1 starting at a day; 2 is 11; 3 numbers from 0 starting on Monday.
    const days = (dayOfWeek(n) - WEEKDAY_FIRST[kind] + 7) % 7;
    return kind === 3 ? days : days + 1;
  }),
};
