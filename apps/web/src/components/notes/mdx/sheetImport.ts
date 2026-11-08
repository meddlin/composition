/**
 * A range of an Excel sheet as a `<Sheet>`: its cells in, the sheet's two blocks and a summary of what was done out.
 * Pure, with nothing from the workbook reader (that is what turns an `.xlsx` into a `SourceRange`, and is loaded
 * only when something is imported), so it is tested on cells made by hand and by Excel's own values.
 *
 * Values first (S5 in the plan): **a cell arrives as what Excel showed**, a formula cell as the value Excel calculated
 * and saved in the file. A formula comes across only where it can be trusted:
 *
 * - **It stays a formula, calculated here, when** every cell and range it reads is inside the imported range, this
 *   engine knows every function in it, and the number it gives is the one Excel saved. Excel's own answers are the
 *   test, one per formula, run on the file being imported.
 * - **It is carried** (see `parseFormulas`) when it reads only what is in the range but this engine cannot calculate it
 *   (`XLOOKUP` by binary search, `FILTER`) or gives another answer than Excel did. The formula's text is kept, the cell
 *   shows Excel's value, and nothing here calculates it. Our number never replaces Excel's where they could differ.
 * - **It becomes a value** when it reads anything that is not in the range: another sheet, a cell outside, a table, a
 *   name. Without that cell the formula would mean something else, and Excel's value is all that is left of it.
 *
 * A carried formula's value is Excel's as of the import: change a cell it reads and it is stale. A formula that reads a
 * carried cell reads the value it holds. The checking is done again after each formula is carried, since a formula
 * that agreed with Excel only because it read another one's wrong answer must be checked on the right one.
 */
import { columnLabel } from "./sheetData";
import { serialToYmd } from "./sheetDate";
import { type SheetSource, formatCsv } from "./sheetDraft";
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, evaluate, formatValue, typeCell } from "./sheetFormula";
import { parseAddress } from "./sheetParse";
import { rebaseReferences } from "./sheetRefs";
import { type FindTable, type TableDef, resolveStructuredReferences } from "./sheetStructured";
import { type Scalar, errorByCode, isError, round15 } from "./sheetValue";

/** What Excel holds in a cell, as the workbook reader hands it over: its value, or an error as `{ error: "#N/A" }`. */
export type SourceValue = number | string | boolean | { error: string } | null;

export type SourceCell = {
  /** The value; for a formula, the one Excel calculated and saved, absent where the file has none. */
  value?: SourceValue;
  /** The formula as the file holds it, with or without the `=`. */
  formula?: string;
  /** How Excel shows a number: as a date (a number format with a year, month or day), as a time, or as a number. */
  kind?: "date" | "time";
  /** Excel's own text for the cell, kept for what is not a plain date (a date with a time) and for a time. */
  text?: string;
};

/** A table of the workbook: its name and sheet, and where it is and what its columns are called (see sheetTables.ts). */
export type ImportTable = TableDef & { name: string; sheet: string };

/** A range of cells as the workbook reader reads it. */
export type SourceRange = {
  /** The rows of the range, each cell or `null` where there is none. */
  cells: readonly (readonly (SourceCell | null | undefined)[])[];
  /** Where the range's first cell is in its sheet, from 0. */
  origin: { row: number; col: number };
  /** The workbook counts days from 1904. */
  date1904?: boolean;
  /** The sheet the range is in, and every table of the workbook, for a formula that names one (`Table1[Revenue]`). */
  sheet?: string;
  tables?: readonly ImportTable[];
};

export type Reason = { reason: string; count: number };

export type ImportSummary = {
  rows: number;
  columns: number;
  /** The formula cells in the range, and what became of them: they add up to this. */
  formulas: number;
  calculated: number;
  carried: number;
  values: number;
  /** Of the calculated ones, the ones Excel saved no value for, which were not checked against anything. */
  unchecked: number;
  carriedWhy: Reason[];
  valuesWhy: Reason[];
};

export type ImportResult = { ok: true; source: SheetSource; summary: ImportSummary } | { ok: false; error: string };

/** A workbook, as much of it as an import needs, read by the loader of the day (SheetJS, see sheetWorkbook.ts). */
export type Workbook = {
  sheets: { name: string; /** The used range, `A1:F40`, empty for a sheet with nothing in it. */ used: string }[];
  /** The cells of `range` (`A1:F40`) in the sheet called `sheet`. */
  read(sheet: string, range: string): SourceRange | { error: string };
};

const DAYS_1904_TO_1900 = 1462;
const MAX_PASSES = 20;
/** Where the copies of the formulas go to be checked (see `importRange`): far to the right of any sheet's 100 columns. */
const COPY_COLUMN = 2000;

const two = (n: number) => String(n).padStart(2, "0");

/** A cell as the CSV holds it: what Excel showed (a number as it is, a date as `2026-03-04`). */
function shownText(cell: SourceCell | null | undefined, date1904: boolean): string {
  const value = cell?.value;
  if (cell === null || cell === undefined || value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") return value.error;
  if (typeof value === "string") return value;
  const plain = formatValue(value);
  if (cell.kind === "time") return cell.text ?? plain;
  if (cell.kind !== "date") return plain;
  const serial = date1904 ? value + DAYS_1904_TO_1900 : value;
  const date = Number.isInteger(serial) && serial >= 1 ? serialToYmd(serial) : null;
  return date ? `${String(date.year).padStart(4, "0")}-${two(date.month)}-${two(date.day)}` : (cell.text ?? plain);
}

/** What Excel saved for a cell, as a value to compare with ours; `undefined` where the file has none. */
function savedValue(cell: SourceCell): Scalar | undefined {
  const { value } = cell;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "object") return errorByCode(value.error) ?? value.error;
  return value;
}

/** Whether our answer is Excel's: a number to 15 digits (the most Excel keeps), a text exactly, an error by its kind, a blank as an empty text. */
function sameValue(ours: Scalar, theirs: Scalar): boolean {
  const blank = (value: Scalar) => value === null || value === "";
  if (blank(ours) || blank(theirs)) return blank(ours) && blank(theirs);
  if (isError(ours) || isError(theirs)) return isError(ours) && isError(theirs) && ours.code === theirs.code;
  if (typeof ours === "number" && typeof theirs === "number") {
    if (round15(ours) === round15(theirs)) return true;
    return Math.abs(ours - theirs) <= 1e-12 * Math.max(Math.abs(ours), Math.abs(theirs));
  }
  return ours === theirs;
}

/** The grid as Excel showed it, each cell as the engine reads that text. */
const asShown = (text: readonly (readonly string[])[]): Scalar[][] => text.map((row) => row.map(typeCell));

const tally = (reasons: string[]): Reason[] => {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
};

/** Which table a reference means: by its name, or the one on `sheet` that holds the formula's cell. With no tables known (a reader that does not give them) it is not read. */
function findTable(tables: readonly ImportTable[], sheet: string, cell: { row: number; col: number }): FindTable {
  if (tables.length === 0) return () => ({ unsupported: "a table's column" });
  return (name) => {
    if (name === null) return tables.find((table) => table.sheet === sheet && cell.row >= table.row1 && cell.row <= table.row2 && cell.col >= table.col1 && cell.col <= table.col2);
    const found = tables.find((table) => table.name.toLowerCase() === name.toLowerCase());
    return found && found.sheet !== sheet ? { unsupported: "a table on another sheet" } : found;
  };
}

type Pending = { address: string; row: number; col: number; formula: string; cell: SourceCell };

/** The range as a sheet: its CSV and `formulas` blocks, and a summary of what was kept as a formula, carried and made a value. */
export function importRange({ cells, origin, date1904 = false, sheet = "", tables = [] }: SourceRange): ImportResult {
  const rows = cells.length;
  const columns = cells.reduce((widest, row) => Math.max(widest, row.length), 0);
  if (rows === 0 || columns === 0) return { ok: false, error: "There is nothing in that range." };
  if (rows > MAX_SHEET_ROWS) {
    return { ok: false, error: `That range has ${rows.toLocaleString("en-US")} rows, and a sheet holds at most ${MAX_SHEET_ROWS.toLocaleString("en-US")} (the header included). Choose a narrower range.` };
  }
  if (columns > MAX_SHEET_COLUMNS) return { ok: false, error: `That range has ${columns} columns, and a sheet holds at most ${MAX_SHEET_COLUMNS}. Choose a narrower range.` };
  const header = cells[0];
  if (!header.some((cell) => shownText(cell, date1904) !== "")) {
    return { ok: false, error: "The first row of that range is empty. A sheet's first row holds its column names: start the range at the row that does." };
  }

  const text = cells.map((row) => Array.from({ length: columns }, (_, c) => shownText(row[c], date1904)));
  const pending: Pending[] = [];
  const valuesWhy: string[] = [];
  let formulaCells = 0;
  cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell?.formula) return;
      formulaCells++;
      // A column named in the formula (`Table1[Revenue]`) is the range it is in the workbook, which is then moved with the rest.
      const at = { row: origin.row + r, col: origin.col + c };
      const resolved = cell.formula.includes("[") ? resolveStructuredReferences(cell.formula, findTable(tables, sheet, at), at) : { formula: cell.formula };
      if (resolved.unsupported !== undefined) {
        valuesWhy.push(resolved.unsupported);
        return;
      }
      const rebased = rebaseReferences(resolved.formula, origin, { rows, cols: columns });
      if (rebased.outside !== undefined) {
        valuesWhy.push(rebased.outside);
        return;
      }
      const formula = rebased.formula.startsWith("=") ? rebased.formula : `=${rebased.formula}`;
      pending.push({ address: `${columnLabel(c)}${r + 1}`, row: r, col: c, formula, cell });
    }),
  );

  // A formula whose result Excel shows as a date is carried from the start: it would be drawn as a number of days here.
  const carried = new Map<string, string>();
  for (const { address, cell } of pending) if (cell.kind === "date") carried.set(address, "its result is a date, which is not drawn as one here");

  // Each formula is checked on its own, against Excel's values for the cells it reads: the grid holds what Excel saved
  // everywhere, and a copy of each formula sits off to the right of it (a formula names its cells, so a copy reads the same
  // ones). One that disagrees is then wrong by itself, and not because a formula it reads was.
  const saved = asShown(text);
  const copies = new Map(pending.filter((p) => !carried.has(p.address)).map((p) => [`${columnLabel(COPY_COLUMN + p.col)}${p.row + 1}`, p]));
  const checked = evaluate(saved, new Map([...copies].map(([address, p]) => [address, p.formula])));
  for (const [copy, { address, cell }] of copies) {
    const result = checked.get(copy);
    const theirs = savedValue(cell);
    // With nothing saved by Excel there is nothing to carry or to check against: the formula is calculated, or says it cannot be.
    if (!result || theirs === undefined) continue;
    if (result.unsupported.length > 0) carried.set(address, result.unsupported[0]);
    else if (!sameValue(result.value, theirs)) carried.set(address, "its result is not the one Excel saved");
  }

  // The formulas that are left are calculated together, and what they come to is checked once more against Excel, since a
  // chain of them can drift, or go round in a circle that Excel did not.
  const live = () => evaluate(saved, new Map(pending.filter((p) => !carried.has(p.address)).map((p) => [p.address, p.formula])));
  let results = live();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let added = false;
    for (const { address, cell } of pending) {
      const result = results.get(address);
      const theirs = savedValue(cell);
      if (carried.has(address) || !result || theirs === undefined || sameValue(result.value, theirs)) continue;
      carried.set(address, "its result is not the one Excel saved");
      added = true;
    }
    if (!added) break;
    results = live();
  }

  let unchecked = 0;
  for (const { address, row, col, cell } of pending) {
    if (carried.has(address)) continue;
    const result = results.get(address);
    if (result) text[row][col] = formatValue(result.value);
    if (savedValue(cell) === undefined) unchecked++;
  }

  // The empty rows at the foot and empty columns at the right are left off, but never a cell that has a formula.
  const used = (r: number, c: number) => text[r][c] !== "" || pending.some((p) => p.row === r && p.col === c);
  let lastRow = rows - 1;
  while (lastRow > 0 && !Array.from({ length: columns }, (_, c) => used(lastRow, c)).some(Boolean)) lastRow--;
  let lastColumn = columns - 1;
  while (lastColumn > 0 && !Array.from({ length: lastRow + 1 }, (_, r) => used(r, lastColumn)).some(Boolean)) lastColumn--;

  const lines = pending.map(({ address, formula }) => `${address} ${carried.has(address) ? "carried " : ""}${formula}`);
  return {
    ok: true,
    source: { csv: formatCsv(text.slice(0, lastRow + 1).map((row) => row.slice(0, lastColumn + 1))), formulas: lines.join("\n") },
    summary: {
      rows: lastRow + 1,
      columns: lastColumn + 1,
      formulas: formulaCells,
      calculated: pending.length - carried.size,
      carried: carried.size,
      values: valuesWhy.length,
      unchecked,
      carriedWhy: tally([...carried.values()]),
      valuesWhy: tally(valuesWhy),
    },
  };
}

/** A range as written in a box (`A1:F40`, `$A$1:$F$40`, a single `B2`, corners in either order), or `null` where it is not one. */
export function parseRange(text: string): { row1: number; col1: number; row2: number; col2: number } | null {
  const [first, second, ...extra] = text.trim().split(":");
  if (extra.length > 0 || !first) return null;
  const a = parseAddress(first.trim());
  const b = parseAddress((second ?? first).trim());
  if (!a || !b) return null;
  return { row1: Math.min(a.row, b.row), col1: Math.min(a.col, b.col), row2: Math.max(a.row, b.row), col2: Math.max(a.col, b.col) };
}

/** A range as `A1:F40`. */
export const rangeText = ({ row1, col1, row2, col2 }: { row1: number; col1: number; row2: number; col2: number }) =>
  `${columnLabel(col1)}${row1 + 1}:${columnLabel(col2)}${row2 + 1}`;

/**
 * A short fingerprint of what an import wrote, kept on the tag (`imported="…"`), so that a later import can tell whether the
 * sheet has been changed since: it is the first 12 hex digits of the SHA-256 of the two blocks.
 */
export async function importedHash(source: SheetSource): Promise<string> {
  const bytes = new TextEncoder().encode(`${source.csv}\n\u0000\n${source.formulas}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
