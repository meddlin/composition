/**
 * A `<Sheet>` as a workbook's cells, and as CSV: what **Export…** writes. Pure, with nothing from the workbook writer (that is
 * `sheetWorkbookWrite.ts`, which turns these cells into the bytes of an `.xlsx`).
 *
 * The sheet is written as it is drawn: each cell with the value it shows, and each formula as a formula **with** that value
 * beside it, as Excel itself saves one, so a program that reads the file without calculating sees the numbers. A carried formula
 * (see `parseFormulas`) keeps Excel's value and its formula as it came, which is what makes a round trip through Excel keep
 * what this engine could not calculate. A formula this engine could not calculate that was typed here is written as a formula
 * too, with `#NAME?` for its value; Excel calculates it when it opens the file.
 *
 * A formula is written in the file's form, not the one Excel shows: a function newer than Excel 2007 carries a prefix in the
 * file (`_xlfn.XLOOKUP`, and `_xlfn._xlws.FILTER` for the two that return a range), and without it Excel shows `#NAME?` for it
 * (SheetJS takes the prefix off on reading and does not put it back on writing, so `toFileFormula` does).
 *
 * What does not come along, and the summary says so: cell formats (a percent or a currency is the plain number; only a date,
 * written `2026-03-04`, is written as a date), column widths set by hand (there are none), colours and fonts.
 */
import { columnLabel, parseFormulas, parseSheet } from "./sheetData";
import { isoDateSerial } from "./sheetDate";
import { type SheetSource, formatCsv } from "./sheetDraft";
import { calculate, typeCell } from "./sheetFormula";
import { tokenize } from "./sheetParse";
import { type Scalar, isError } from "./sheetValue";

/** What a cell holds in the file: a number, a text, a logical, an error as its text (`#N/A`), or nothing. */
export type ExportValue = number | string | boolean | { error: string } | null;

export type ExportCell = {
  value: ExportValue;
  /** The formula as the file holds it: no `=`, newer functions with their prefixes. */
  formula?: string;
  /** The number is a date, and is written with a date format. */
  date?: boolean;
};

export type ExportSummary = {
  rows: number;
  columns: number;
  formulas: number;
  /** Of the formulas, the carried ones, written with Excel's value as it was. */
  carried: number;
  /** Of the formulas, the ones this engine could not calculate (and that are not carried): written with `#NAME?`, for Excel to calculate. */
  notCalculated: number;
  dates: number;
};

export type SheetExport = {
  rows: ExportCell[][];
  columns: number;
  /** The values as CSV text: what the sheet shows, formulas calculated. */
  csv: string;
  /** The same cells as the text each shows, by row: what a copy to the clipboard carries. */
  shown: string[][];
  summary: ExportSummary;
};

/** The functions Excel saves with `_xlfn.` in front: those added after Excel 2007, as XlsxWriter and Excel's own files have them. */
const XLFN = new Set(
  (
    "ACOT ACOTH AGGREGATE ARABIC ARRAYTOTEXT BASE BETA.DIST BETA.INV BINOM.DIST BINOM.DIST.RANGE BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR " +
    "CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM " +
    "CONFIDENCE.T COT COTH COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV " +
    "F.INV.RT F.TEST FILTERXML FLOOR.MATH FLOOR.PRECISE FORECAST.ETS FORECAST.LINEAR FORMULATEXT GAMMA GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS " +
    "HSTACK HYPGEOM.DIST IFNA IFS ISFORMULA ISOWEEKNUM LET LOGNORM.DIST LOGNORM.INV MAXIFS MINIFS MODE.MULT MODE.SNGL MUNIT NEGBINOM.DIST " +
    "NETWORKDAYS.INTL NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC " +
    "PERMUTATIONA PHI POISSON.DIST QUARTILE.EXC QUARTILE.INC QUERYSTRING RANDARRAY RANK.AVG RANK.EQ RRI SEC SECH SEQUENCE SHEET SHEETS SKEW.P SORTBY " +
    "STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW UNICHAR UNICODE " +
    "UNIQUE VALUETOTEXT VAR.P VAR.S VSTACK WEBSERVICE WEIBULL.DIST WORKDAY.INTL WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR Z.TEST"
  ).split(" "),
);
/** The two that Excel saves with `_xlfn._xlws.`: the ones that return a range. */
const XLWS = new Set(["FILTER", "SORT"]);

/** A formula (with or without its `=`) as the file holds it: no `=`, and newer functions with their prefix. */
export function toFileFormula(formula: string): string {
  const lead = formula.startsWith("=") ? 1 : 0;
  const text = formula.slice(lead);
  let tokens;
  try {
    tokens = tokenize(text);
  } catch {
    return text;
  }
  const marks: { at: number; prefix: string }[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "ident" || tokens[index + 1]?.kind !== "op" || tokens[index + 1].text !== "(") return;
    const name = token.text.toUpperCase();
    if (name.startsWith("_XL")) return; // already written the file's way
    if (XLWS.has(name)) marks.push({ at: token.at, prefix: "_xlfn._xlws." });
    else if (XLFN.has(name)) marks.push({ at: token.at, prefix: "_xlfn." });
  });
  let result = text;
  for (const { at, prefix } of marks.sort((a, b) => b.at - a.at)) result = result.slice(0, at) + prefix + result.slice(at);
  return result;
}

function exportValue(value: Scalar): ExportValue {
  return isError(value) ? { error: value.code } : value;
}

export type ExportResult = ({ ok: true } & SheetExport) | { ok: false; error: string };

/** The sheet in a note's two blocks as cells to write, and as CSV; or why it cannot be (it has no data). */
export function exportSheet(source: SheetSource): ExportResult {
  const parsed = parseSheet(source.csv);
  if (!parsed.sheet) return { ok: false, error: parsed.error };
  const { formulas, carried } = parseFormulas(source.formulas);
  const { sheet, results } = calculate(parsed.sheet, formulas, carried);

  let formulaCount = 0;
  let carriedCount = 0;
  let notCalculated = 0;
  let dates = 0;
  const rows = sheet.rows.map((cells, r) =>
    cells.map((text, c): ExportCell => {
      const address = `${columnLabel(c)}${r + 1}`;
      const formula = formulas.get(address);
      const result = results.get(address);
      let cell: ExportCell;
      if (formula !== undefined && result) {
        // Calculated here, or not calculable here: Excel will calculate it either way when it opens the file.
        cell = { value: exportValue(result.value), formula: toFileFormula(formula) };
        if (result.unsupported.length > 0) notCalculated++;
      } else {
        const date = isoDateSerial(text);
        cell = date !== null ? { value: date, date: true } : { value: exportValue(typeCell(text)) };
        if (formula !== undefined) {
          cell.formula = toFileFormula(formula); // carried: Excel's value, as it was
          carriedCount++;
        }
        if (cell.date) dates++;
      }
      if (formula !== undefined) formulaCount++;
      return cell;
    }),
  );
  return {
    ok: true,
    rows,
    columns: sheet.columns,
    csv: formatCsv(sheet.rows),
    shown: sheet.rows,
    summary: { rows: rows.length, columns: sheet.columns, formulas: formulaCount, carried: carriedCount, notCalculated, dates },
  };
}

const count = (n: number, noun: string, plural = `${noun}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? noun : plural}`;

/** What an export writes and does not, in sentences. */
export function describeExport({ rows, columns, formulas, carried, notCalculated, dates }: ExportSummary): string[] {
  const lines = [`${count(rows, "row")} (the first is the header) by ${count(columns, "column")}.`];
  if (formulas > 0) {
    lines.push(`${count(formulas, "formula")} written as ${formulas === 1 ? "a formula" : "formulas"}, each with the value it shows, so Excel calculates them again.`);
    if (carried > 0) lines.push(`${count(carried, "is", "are")} carried from Excel and written as it came, with Excel's value.`);
    if (notCalculated > 0) lines.push(`${count(notCalculated, "formula")} could not be calculated here, and ${notCalculated === 1 ? "is" : "are"} written with #NAME? for a value: Excel calculates ${notCalculated === 1 ? "it" : "them"} when it opens the file.`);
  }
  if (dates > 0) lines.push(`${count(dates, "date")} written as ${dates === 1 ? "a date" : "dates"} (yyyy-mm-dd).`);
  lines.push("Cell formats (a percent or a currency is the plain number), colours and column widths are not kept.");
  return lines;
}

/** A name for the workbook's one sheet: Excel's limits (31 characters, none of `[]:*?/\`), `Sheet1` for none. */
export function excelSheetName(title: string | undefined): string {
  const name = (title ?? "").replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim();
  return name === "" ? "Sheet1" : name;
}

/** A file name from a sheet's caption or the file it came from: letters, digits, spaces and a few marks, with the extension. */
export function exportFileName(title: string | undefined, source: string | undefined, extension: "xlsx" | "csv"): string {
  const fromSource = (source ?? "").replace(/\.[A-Za-z0-9]+$/, "");
  const base = (title ?? "").trim() || fromSource.trim() || "Sheet";
  const clean = base.replace(/[^\p{L}\p{N} ._-]+/gu, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${clean === "" ? "Sheet" : clean}.${extension}`;
}
