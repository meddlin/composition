/**
 * An Excel workbook as the import reads it (see sheetImport.ts): the sheets, and the cells of a range of one with the formula
 * Excel holds and the value it calculated and saved. This is the one place that touches SheetJS (Community Edition, from
 * cdn.sheetjs.com, the plan's reader), and it is loaded only when something is imported: `readWorkbook` imports the library
 * itself, so a note, and a sheet in it, pay nothing for it.
 *
 * What it takes care of: a number's format decides whether Excel shows a date, a time or a number (`numberFormatKind`);
 * a workbook that counts days from 1904 says so; an error is the text Excel shows (`#N/A`); a formula comes without its `=` and
 * with the `_xlfn.` prefix of newer functions already taken off, and a formula that was shared down a column is already
 * written out for each of its cells.
 *
 * What it does not do, on purpose: follow an external link, run or open a macro (a macro-enabled workbook is read as data),
 * read a pivot table (its cells are what it is), or give the table definitions Excel holds (see S9 in the plan). It also reads
 * no more than `MAX_ROWS_READ` rows of a sheet, so a very large file cannot take the page's memory.
 */
import type { CellObject, WorkBook, WorkSheet } from "xlsx";
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from "./sheetFormula";
import { type ImportTable, type SourceCell, type SourceRange, type SourceValue, type Workbook, parseRange, rangeText } from "./sheetImport";
import { readTables } from "./sheetTables";

/** A sheet is read down to this row and no further: a range past it is refused, with the reason. */
export const MAX_ROWS_READ = 100_000;

/** What Excel's number format makes of a number: a date (it has a year, a month or a day), a time of day, or just a number. */
export function numberFormatKind(code: string): "date" | "time" | undefined {
  if (code === "" || /^general$/i.test(code)) return undefined;
  // Text in quotes, an escaped character, padding (`_x`, `*x`), AM/PM and the brackets that carry colours, conditions and
  // currencies are not date letters; `[h]` and `[mm]` (elapsed time) are time.
  let elapsed = false;
  const cleaned = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .replace(/\[([^\]]*)\]/g, (_, inner: string) => {
      if (/^(?:h+|m+|s+)$/i.test(inner)) elapsed = true;
      return "";
    })
    .replace(/a\/p|am\/pm/gi, "");
  // A section the format has only for text, or for nothing, has no letters; look at the first section that has any.
  const section = cleaned.split(";")[0];
  if (/[yd]/i.test(section)) return "date";
  if (/m/i.test(section) && !/[hs]/i.test(section) && !elapsed) return "date";
  if (/[hs]/i.test(section) || elapsed || /m/i.test(section)) return "time";
  return undefined;
}

/** What SheetJS writes for an error's number, for the (rare) cell that has no text for it. */
const ERROR_CODES: Record<number, string> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" };

function errorText(cell: CellObject): string {
  if (typeof cell.w === "string" && cell.w.startsWith("#")) return cell.w;
  return ERROR_CODES[Number(cell.v)] ?? "#VALUE!";
}

/**
 * A formula as Excel's own name for each function: the file saves a newer one as `_xlfn.XLOOKUP`, and a dynamic-array one
 * as `_xlfn._xlws.FILTER`; SheetJS takes off the first, and this the rest, with the `_xlpm.` the file puts before each name a LET
 * or LAMBDA gives (`_xlfn.LET(_xlpm.x,5,_xlpm.x*2)` is `LET(x,5,x*2)` as Excel shows it).
 */
const withoutPrefixes = (formula: string) =>
  // The pieces in quotes (the odd ones) are texts, and are left as they are.
  formula
    .split(/("(?:[^"]|"")*")/)
    .map((piece, index) => (index % 2 === 1 ? piece : piece.replace(/(?<![A-Za-z0-9_.])(?:_xl(?:fn|ws|pm)\.)+/gi, "")))
    .join("");

/** A cell as the import takes it, or `null` for one with nothing in it (no value and no formula). */
export function sourceCell(cell: CellObject | undefined): SourceCell | null {
  if (!cell) return null;
  const formula = typeof cell.f === "string" && cell.f.trim() !== "" ? withoutPrefixes(cell.f.trim()) : undefined;
  let value: SourceValue | undefined;
  switch (cell.t) {
    case "n":
      value = typeof cell.v === "number" && Number.isFinite(cell.v) ? cell.v : undefined;
      break;
    case "s":
      value = cell.v === undefined || cell.v === null ? undefined : String(cell.v);
      break;
    case "b":
      value = cell.v === undefined ? undefined : Boolean(cell.v);
      break;
    case "e":
      value = { error: errorText(cell) };
      break;
    case "d":
      // Only with the `cellDates` option, which is not used: a date is a number with a format.
      value = undefined;
      break;
    default:
      value = undefined; // a stub: formatted, and empty
  }
  if (!formula && (value === undefined || value === "")) return null;
  const kind = cell.t === "n" && typeof cell.z === "string" ? numberFormatKind(cell.z) : undefined;
  return { value, ...(formula ? { formula } : {}), ...(kind ? { kind } : {}), ...(typeof cell.w === "string" ? { text: cell.w } : {}) };
}

const days1904 = (book: WorkBook) => {
  const flag: unknown = book.Workbook?.WBProps?.date1904;
  return flag === true || flag === 1 || flag === "1" || flag === "true";
};

/** Reads the cells of `range` of `sheet`: at most the size of a sheet, and no further down than `MAX_ROWS_READ`. */
function readRange(book: WorkBook, sheet: WorkSheet, range: string, sheetName: string, tables: readonly ImportTable[]): SourceRange | { error: string } {
  const parsed = parseRange(range);
  if (!parsed) return { error: `${range} is not a range.` };
  const rows = parsed.row2 - parsed.row1 + 1;
  const columns = parsed.col2 - parsed.col1 + 1;
  if (parsed.row2 >= MAX_ROWS_READ) return { error: `Only the first ${MAX_ROWS_READ.toLocaleString("en-US")} rows of a sheet are read. Choose a range above that.` };
  if (rows > MAX_SHEET_ROWS) return { error: `That range has ${rows.toLocaleString("en-US")} rows, and a sheet holds at most ${MAX_SHEET_ROWS.toLocaleString("en-US")} (the header included). Choose a narrower range.` };
  if (columns > MAX_SHEET_COLUMNS) return { error: `That range has ${columns} columns, and a sheet holds at most ${MAX_SHEET_COLUMNS}. Choose a narrower range.` };
  const cells: (SourceCell | null)[][] = [];
  for (let r = parsed.row1; r <= parsed.row2; r++) {
    const row: (SourceCell | null)[] = [];
    for (let c = parsed.col1; c <= parsed.col2; c++) row.push(sourceCell(sheet[`${columnName(c)}${r + 1}`] as CellObject | undefined));
    cells.push(row);
  }
  return { cells, origin: { row: parsed.row1, col: parsed.col1 }, date1904: days1904(book), sheet: sheetName, tables };
}

/** A column's letters, `A` to `XFD` (SheetJS names its cells so). */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** The used range of a sheet as `A1:F40`, from the range Excel saved for it; empty for a sheet with nothing in it. */
function usedRange(sheet: WorkSheet): string {
  const saved = sheet["!fullref"] ?? sheet["!ref"];
  if (!saved) return "";
  const parsed = parseRange(saved);
  return parsed ? rangeText(parsed) : "";
}

/**
 * Reads a workbook from the bytes of an `.xlsx` (or `.xlsm`) file. Throws, with the reason in words, for a file that is not
 * one, or is protected by a password. Hidden sheets are listed (they are still data); very hidden ones are not.
 */
export async function readWorkbook(bytes: Uint8Array): Promise<Workbook> {
  // SheetJS will read anything as a sheet of text, so the file has to say it is a workbook: a zip (an .xlsx), or the older
  // container of an .xls and of a workbook with a password.
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const container = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!zip && !container) throw new Error("It is not an Excel workbook.");
  const XLSX = await import("xlsx");
  let book: WorkBook;
  try {
    book = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellText: true, cellStyles: false, cellDates: false, sheetStubs: false, bookVBA: false, sheetRows: MAX_ROWS_READ });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "";
    throw new Error(/password|encrypt/i.test(message) ? "It is protected by a password." : "It is not an Excel workbook.");
  }
  // The workbook's tables are read from the file's own parts, which SheetJS does not give; a file whose parts cannot be read has none.
  const tables = await readTables(bytes).catch((): ImportTable[] => []);
  const visible = book.SheetNames.filter((_, index) => book.Workbook?.Sheets?.[index]?.Hidden !== 2);
  return {
    sheets: visible.map((name) => ({ name, used: usedRange(book.Sheets[name] ?? {}) })),
    read(sheet, range) {
      const found = book.Sheets[sheet];
      return found ? readRange(book, found, range, sheet, tables) : { error: `There is no sheet called ${sheet}.` };
    },
  };
}
