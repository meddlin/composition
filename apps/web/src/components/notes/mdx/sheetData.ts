/**
 * What a `<Sheet>` draws, read from the CSV block inside the tag. Pure, so the terminal app shares it
 * with the web preview (see apps/cli/src/mdx.ts), as it does chartData.ts, and for the same reason the
 * data is CSV in a fenced block: a note's props are plain strings, and a fence is the one place a note
 * can hold a table that Markdown won't rewrap.
 *
 *     <Sheet title="Q3 budget">
 *
 *     ```csv
 *     Region,Units,Price,Revenue
 *     West,120,9.5,1140
 *     ```
 *
 *     </Sheet>
 *
 * The first row is the header, and it is row 1 of the sheet: the first row below it is row 2, as in Excel,
 * because the formulas to come are written against those addresses (`=C2*D2`). That is why blank rows are
 * kept, and why only blank rows before the header and after the last row are dropped.
 */
import { parseCsv, parseNumber } from "./chartData";
import { parseAddress } from "./sheetParse";

export type Sheet = {
  /** Every row, the header row first, each padded with empty cells to `columns`. */
  rows: string[][];
  columns: number;
};

export type SheetParse = { sheet: Sheet; error?: undefined } | { sheet?: undefined; error: string };

/** Past this many characters the editor stops colouring the whole note, so a sheet this big is said to. */
export const SHEET_LARGE_CHARS = 100_000;

const DEFAULT_HEIGHT = 360;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 800;

/** A column is never narrower than this, in characters, so an almost empty one is still something to aim at... */
const MIN_COLUMN_CHARS = 4;
/** ...nor wider than this, so one long cell doesn't push the rest of the sheet off the screen. */
const MAX_COLUMN_CHARS = 40;

const blank = (row: string[]) => row.every((cell) => cell === "");

/**
 * The sheet in a CSV block. A header with nothing below it is a sheet, an empty one to start typing in;
 * no text at all comes back as `error`, in words for the notice shown in its place.
 */
export function parseSheet(csv: string): SheetParse {
  const table = parseCsv(csv, { keepBlankRows: true });
  let from = 0;
  let to = table.length;
  while (from < to && blank(table[from])) from++;
  while (to > from && blank(table[to - 1])) to--;
  const rows = table.slice(from, to);
  if (rows.length === 0) return { error: "Sheet: add a ```csv block with a header row and the data." };

  const columns = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return { sheet: { rows: rows.map((row) => (row.length < columns ? [...row, ...Array<string>(columns - row.length).fill("")] : row)), columns } };
}

export type FormulasParse = {
  /** Each formula by the address of its cell, in capitals and without dollar signs: `E2` -> `=C2*D2`. */
  formulas: Map<string, string>;
  /** The lines, counted from 1, that are not a cell and a formula. */
  problems: number[];
};

/**
 * The formulas block that goes beside the CSV one, a line to a cell, in Excel's own syntax:
 *
 *     ```formulas
 *     E2 =C2*D2
 *     E3 =C3*D3
 *     C4 =SUM(C2:C3)
 *     ```
 *
 * The CSV holds what each cell shows; this holds the formulas that make some of them, which are calculated again
 * when the sheet is drawn (see sheetFormula.ts). A line for a cell twice is the later one; a blank line is nothing.
 */
export function parseFormulas(text: string): FormulasParse {
  const formulas = new Map<string, string>();
  const problems: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    const match = /^\s*(\$?[A-Za-z]{1,3}\$?\d+)\s+(=.*?)\s*$/.exec(line);
    if (!match || !parseAddress(match[1])) problems.push(index + 1);
    else formulas.set(match[1].replace(/\$/g, "").toUpperCase(), match[2]);
  });
  return { formulas, problems };
}

/** A column's name as Excel writes it: A to Z, then AA, AB… (0 is A). */
export function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}

/** Whether a cell is a number as the chart reads one (plain, `1,234`, `12%`), so the grid sets it flush right. */
export const isNumberCell = (text: string) => parseNumber(text) !== null;

const ERROR_VALUE = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)$/;

/** Whether a cell is one of Excel's errors, which the grid shows as one, in the cell it came from. */
export const isErrorValue = (text: string) => ERROR_VALUE.test(text);

/** How wide to draw each column, in characters: its longest cell, header included, kept between the limits above. */
export function columnWidths({ rows, columns }: Sheet): number[] {
  const longest = Array<number>(columns).fill(0);
  for (const row of rows) for (let c = 0; c < columns; c++) if (row[c].length > longest[c]) longest[c] = row[c].length;
  return longest.map((chars) => Math.min(MAX_COLUMN_CHARS, Math.max(MIN_COLUMN_CHARS, chars)));
}

/** `height="500"` as pixels; anything else (or out of range) is kept in range or the default, so a half-typed value still draws. */
export function viewportHeight(value: string | undefined): number {
  const pixels = Number.parseInt(value ?? "", 10);
  return Number.isFinite(pixels) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, pixels)) : DEFAULT_HEIGHT;
}
