/**
 * The values a sheet's formulas work with, and Excel's rules for turning one kind into another. Pure, with
 * nothing from React, so the terminal app shares it (see sheetFormula.ts).
 *
 * Excel is the spec. Every rule here that is not obvious (what `"5%"+1` is, where a number becomes
 * `1E+20`, when `0.1+0.2-0.3` is zero) was read off real Excel with spikes/sheet/run-in-excel.mjs, and the
 * cases are in spikes/sheet/excel-verified-cases.json. A shape Excel accepts that we do not reproduce is not
 * guessed at: it throws `Unsupported`, and the cell says what it could not calculate.
 */
import { ISO_DATE, isoDateSerial } from "./sheetDate";

export type ErrorCode = "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A";

/** An error value. A class, so that `instanceof` tells one from the text that spells it. */
export class SheetError {
  constructor(readonly code: ErrorCode) {}
}

export const ERR = {
  NULL: new SheetError("#NULL!"),
  DIV0: new SheetError("#DIV/0!"),
  VALUE: new SheetError("#VALUE!"),
  REF: new SheetError("#REF!"),
  NAME: new SheetError("#NAME?"),
  NUM: new SheetError("#NUM!"),
  NA: new SheetError("#N/A"),
} as const;

/** `ERROR.TYPE` numbers them in this order. */
export const ERROR_ORDER: readonly SheetError[] = [ERR.NULL, ERR.DIV0, ERR.VALUE, ERR.REF, ERR.NAME, ERR.NUM, ERR.NA];

export const errorByCode = (text: string): SheetError | undefined => ERROR_ORDER.find((error) => error.code === text);

/** A cell's value. `null` is a blank cell, which is not the same as the empty text. */
export type Scalar = number | string | boolean | null | SheetError;
/** A range or an array, as rows of values. */
export type Matrix = Scalar[][];
export type Value = Scalar | Matrix;

export const isError = (value: unknown): value is SheetError => value instanceof SheetError;
export const isMatrix = (value: Value | undefined): value is Matrix => Array.isArray(value);

/**
 * Something this engine does not calculate (a function it lacks, a text read as a date). It is thrown, not
 * returned, so that one formula stops, and the cell shows `#NAME?` with the reason. A value Excel would have
 * computed is never replaced by a guess.
 */
export class Unsupported {
  constructor(readonly reason: string) {}
}

/** The first of Excel's two exact limits for text read as a number: 15 significant digits. */
const SIGNIFICANT_DIGITS = 15;

/**
 * A number as Excel reads a literal: only the first 15 significant digits count, and the rest are dropped,
 * not rounded (`1.000000000000001` is 1, `0.1234567890123456789` is `0.123456789012345`).
 */
export function parseLiteral(text: string): number {
  const parts = /^(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!parts) return Number(text);
  const [, integer, fraction, exponent = "0"] = parts;
  const all = integer + fraction;
  const leading = all.length - all.replace(/^0+/, "").length;
  const significant = all.slice(leading);
  if (significant.length <= SIGNIFICANT_DIGITS) return Number(text);
  return Number(`${significant.slice(0, SIGNIFICANT_DIGITS)}e${integer.length - leading - SIGNIFICANT_DIGITS + Number(exponent)}`);
}

/** A number rounded to 15 significant digits: what Excel compares, and shows. */
export const round15 = (value: number) => (Number.isFinite(value) ? Number(value.toPrecision(SIGNIFICANT_DIGITS)) : value);

/**
 * A number as text, as Excel writes it into a text (`1/3&""`): 15 significant digits, written out in full
 * unless that takes more than 20 characters, and then in E notation with at least two exponent digits
 * (`1E+20`, `1.23456789012345E-05`).
 */
export function numberToText(value: number): string {
  if (value === 0) return "0";
  const [mantissa, exponentText] = Math.abs(value)
    .toExponential(SIGNIFICANT_DIGITS - 1)
    .split("e");
  const exponent = Number(exponentText);
  const digits = mantissa.replace(".", "").replace(/0+$/, "") || "0";
  const sign = value < 0 ? "-" : "";

  let plain: string;
  if (exponent >= digits.length - 1) plain = digits + "0".repeat(exponent - digits.length + 1);
  else if (exponent >= 0) plain = `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  else plain = `0.${"0".repeat(-exponent - 1)}${digits}`;
  if (plain.length <= 20) return sign + plain;

  const scientific = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${scientific}E${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/** Text that Excel would read as a date or a time, or with a currency we do not know: not a number to us, and not guessed. */
const DATE_LIKE = /^\d{1,4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,4}$|^\d{1,2}:\d{2}|^\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ,]+\d{2,4}$|^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/;
const OTHER_CURRENCY = /[€£¥₹₩₽]/;

const NUMBER_TEXT = /^([+-])?\s*(\$)?\s*([+-])?\s*(%)?\s*((?:\d+(?:,\d{3,})*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(%)?$/;

/**
 * Text as a number, the way Excel reads it in arithmetic (`"5%"+1` is 1.05): spaces around it, a sign, a `$`,
 * thousands commas, a percent sign, an exponent, or the whole thing in parentheses for a negative. Anything
 * else is `null` (and a `#VALUE!` to the caller): `"1 2"`, `"0x10"`, `"5-"`.
 */
export function parseNumberText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const bracketed = /^\(\s*([^()]*?)\s*\)$/.exec(trimmed);
  const inner = bracketed ? bracketed[1] : trimmed;
  const parts = NUMBER_TEXT.exec(inner);
  if (!parts) {
    // A date written 2026-03-04 is read as that date, and one that is not a day (2026-02-30) is not a number, as in Excel.
    if (ISO_DATE.test(trimmed)) return isoDateSerial(trimmed);
    if (DATE_LIKE.test(trimmed) || OTHER_CURRENCY.test(trimmed)) throw new Unsupported(`the text “${trimmed}” read as a date or a currency`);
    return null;
  }
  const [, before, , after, prefixPercent, digits, suffixPercent] = parts;
  if ((before && after) || (prefixPercent && suffixPercent) || (bracketed && (before || after))) return null;
  let value = parseLiteral(digits.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  if (prefixPercent || suffixPercent) value /= 100;
  return bracketed || before === "-" || after === "-" ? -value : value;
}

/** A value as a number for arithmetic: a blank is 0, `TRUE` is 1, text is read as above. Throws the error it is, or `#VALUE!`. */
export function toNumber(value: Scalar): number {
  if (typeof value === "number") return value;
  if (value === null) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (isError(value)) throw value;
  const parsed = parseNumberText(value);
  if (parsed === null) throw ERR.VALUE;
  return parsed;
}

/** A value as text, as `&` does: a number as Excel writes it, a blank as nothing. */
export function toText(value: Scalar): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return numberToText(value);
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  throw value;
}

/** A value as a condition: a number is true unless 0, and the texts `TRUE` and `FALSE` are read, in any case. Other text is `#VALUE!`. */
export function toBool(value: Scalar): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value === null) return false;
  if (isError(value)) throw value;
  const upper = value.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  throw ERR.VALUE;
}

/** The text `TRUE` or `FALSE` as a logical, in any case; anything else is `undefined`. */
export const logicalText = (text: string): boolean | undefined => {
  const upper = text.toUpperCase();
  return upper === "TRUE" ? true : upper === "FALSE" ? false : undefined;
};

/** Text compared the way Excel sorts it: ignoring case, not accents, with punctuation before digits before letters, and ß the same as ss. */
const collator = new Intl.Collator("en", {
  sensitivity: "accent",
  usage: "sort",
});
const eszett = (text: string) => (text.includes("ß") ? text.replace(/ß/g, "ss") : text);
export const compareText = (a: string, b: string) => (a === b ? 0 : collator.compare(eszett(a), eszett(b)));

const typeRank = (value: Scalar) => (typeof value === "number" || value === null ? 1 : typeof value === "string" ? 2 : 3);

/**
 * Excel's order: numbers, then text, then logicals. A blank is 0 beside a number, empty beside text, and
 * `FALSE` beside a logical; numbers are equal when their first 15 digits are. Errors are the caller's to handle.
 */
export function compareScalars(a: Scalar, b: Scalar): number {
  if (isError(a) || isError(b)) throw isError(a) ? a : (b as SheetError);
  const rank = (value: Scalar, other: Scalar) => {
    if (value !== null) return typeRank(value);
    return other === null ? 1 : typeRank(other);
  };
  const ra = rank(a, b);
  const rb = rank(b, a);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 1) {
    const x = round15(a === null ? 0 : (a as number));
    const y = round15(b === null ? 0 : (b as number));
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (ra === 2) return compareText(a === null ? "" : (a as string), b === null ? "" : (b as string));
  const x = a === null ? false : (a as boolean);
  const y = b === null ? false : (b as boolean);
  return x === y ? 0 : x ? 1 : -1;
}

/**
 * Whether the last addition or subtraction of a formula is nothing but rounding noise, which Excel shows as 0
 * (`=0.1+0.2-0.3` is 0, `=(0.1+0.2-0.3)` is 5.55E-17): its result is within 2^-50 of the operands' size.
 */
export const snapToZero = (a: number, b: number, result: number) =>
  result !== 0 && Math.abs(result) <= Math.max(Math.abs(a), Math.abs(b)) * 2 ** -50 ? 0 : result;

/**
 * `value` rounded to `digits` decimal places, half away from zero, on its 15 significant digits, which is
 * how Excel gets `ROUND(1.005,2)` right (1.01) where the binary number is just under. A negative `digits` rounds
 * to tens, hundreds. `mode` picks the direction: nearest, away from zero (`ROUNDUP`) or toward it (`ROUNDDOWN`).
 */
export function roundDigits(value: number, digits: number, mode: "nearest" | "up" | "down" = "nearest"): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const [mantissa, exponentText] = Math.abs(value)
    .toExponential(SIGNIFICANT_DIGITS - 1)
    .split("e");
  const exponent = Number(exponentText);
  if (exponent + digits >= SIGNIFICANT_DIGITS - 1) return value;
  const scaled = Number(`${mantissa}e${exponent + digits}`);
  const whole = mode === "nearest" ? Math.round(scaled) : mode === "up" ? Math.ceil(scaled) : Math.floor(scaled);
  const result = Number(`${whole}e${-digits}`);
  return result === 0 ? 0 : value < 0 ? -result : result;
}
