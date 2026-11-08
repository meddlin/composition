/**
 * A sheet while it is being edited: the grid as what was typed into each cell, with a formula as the text that
 * starts with `=`, as in Excel. Pure, and every change returns a new draft that shares the rows it did not touch,
 * so the editor can keep each step for undo at the price of the rows that changed.
 *
 * The note holds the sheet as two blocks (see sheetData.ts): the CSV of what each cell shows, and the formulas.
 * `draftFromSource` reads them into a draft and `draftToSource` writes a draft back, calculating the formulas so
 * the CSV holds their values, which is what search, the assistant, the terminal app and `<Chart>` read.
 */
import { columnLabel, parseFormulas, parseSheet } from "./sheetData";
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, calculate, type Calculated } from "./sheetFormula";
import { shiftReferences, type Shift } from "./sheetRefs";

export type Draft = {
  /** Every row, the header row first, each `columns` cells long. */
  rows: readonly (readonly string[])[];
  columns: number;
  /**
   * Where a cell's formula is carried (see `parseFormulas`): the value the CSV holds for it, which Excel calculated and
   * this engine does not; `null` for every other cell. The same shape as `rows`, and left out when nothing is carried.
   * Changing a cell, in any way, makes its formula an ordinary one.
   */
  carried?: readonly (readonly (string | null)[])[];
  /** The last row is the table's totals row, which a column named in a formula does not include (the tag says `totals`). Left out when it is not. */
  totals?: boolean;
};

/** `totals` as a draft holds it: present only when true, so a draft without one is equal to one that never had it. */
const withTotals = (totals: boolean | undefined) => (totals ? { totals: true } : {});

/** The draft with its last row made a totals row, or not. */
export function setTotals(draft: Draft, totals: boolean): Draft {
  if ((draft.totals ?? false) === totals) return draft;
  const changed: Draft = { ...draft, ...withTotals(totals) };
  if (!totals) delete changed.totals;
  return changed;
}

/** What a new sheet starts as: a header row and five empty ones, in four columns. */
export const NEW_SHEET_ROWS = 6;
export const NEW_SHEET_COLUMNS = 4;

const blankRow = (columns: number): string[] => Array<string>(columns).fill("");
const noCarried = (columns: number): null[] => Array<null>(columns).fill(null);

/** The grid of carried values after `change` is made to its rows (it is `undefined` while nothing is carried). */
const withCarried = (draft: Draft, change: (grid: (string | null)[][]) => void): Draft["carried"] => {
  if (!draft.carried) return undefined;
  const grid = draft.carried.map((cells) => [...cells]);
  change(grid);
  return grid.some((cells) => cells.some((cell) => cell !== null)) ? grid : undefined;
};

export function emptyDraft(rows = NEW_SHEET_ROWS, columns = NEW_SHEET_COLUMNS): Draft {
  return { rows: Array.from({ length: rows }, () => blankRow(columns)), columns };
}

/** Whether what was typed in a cell is a formula. */
export const isFormulaInput = (input: string) => input.startsWith("=");

/**
 * A text that is meant as text but begins with `=` is held with a leading apostrophe, as Excel does, so it is not
 * mistaken for a formula; the apostrophe is not part of the value.
 */
export const literalText = (input: string) => (input.startsWith("'=") ? input.slice(1) : input);

/** What the editor holds for a CSV cell's text. */
const inputOfText = (text: string) => (text.startsWith("=") ? `'${text}` : text);

/** A typed cell as it is kept: on one line, and without the spaces at either end that the CSV would not keep. */
export const commitInput = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** The sheet in the note's two blocks, as a draft. A sheet with no CSV is an empty one, to start typing in. */
export function draftFromSource(csv: string, formulasText: string, totals = false): Draft {
  const parsed = parseSheet(csv);
  if (!parsed.sheet) return { ...emptyDraft(), ...withTotals(totals) };
  const { formulas, carried } = parseFormulas(formulasText);
  // The grid grows to hold a formula below the last CSV row, as it does when the sheet is drawn.
  const { sheet } = calculate(parsed.sheet, formulas, carried, { totals });
  const rows = sheet.rows.map((row) => row.map(inputOfText));
  const kept = sheet.rows.map((row) => row.map((): string | null => null));
  for (const [address, formula] of formulas) {
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    if (!match) continue;
    const column = [...match[1]].reduce((index, char) => index * 26 + (char.charCodeAt(0) - 64), 0) - 1;
    const row = Number(match[2]) - 1;
    if (row >= rows.length || column >= sheet.columns) continue;
    rows[row][column] = formula;
    // A carried formula keeps what the CSV holds in its cell, which is its value.
    if (carried.has(address)) kept[row][column] = sheet.rows[row][column];
  }
  return { rows, columns: sheet.columns, ...(carried.size > 0 && kept.some((cells) => cells.some((cell) => cell !== null)) ? { carried: kept } : {}), ...withTotals(totals) };
}

/** The draft with one cell changed to `input`, as it is kept (see `commitInput`). */
export function setCell(draft: Draft, row: number, col: number, input: string): Draft {
  const value = commitInput(input);
  if (draft.rows[row]?.[col] === undefined || draft.rows[row][col] === value) return draft;
  return {
    ...draft,
    rows: draft.rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === col ? value : cell)) : cells)),
    carried: withCarried(draft, (grid) => (grid[row][col] = null)),
  };
}

/** The draft with these cells cleared: a rectangle from `from` to `to`, corners in any order. */
export function clearCells(draft: Draft, from: { row: number; col: number }, to: { row: number; col: number }): Draft {
  const [r1, r2] = [Math.min(from.row, to.row), Math.max(from.row, to.row)];
  const [c1, c2] = [Math.min(from.col, to.col), Math.max(from.col, to.col)];
  let changed = false;
  const rows = draft.rows.map((cells, r) => {
    if (r < r1 || r > r2 || cells.slice(c1, c2 + 1).every((cell) => cell === "")) return cells;
    changed = true;
    return cells.map((cell, c) => (c >= c1 && c <= c2 ? "" : cell));
  });
  return changed ? { ...draft, rows, carried: withCarried(draft, (grid) => grid.forEach((cells, r) => r >= r1 && r <= r2 && cells.fill(null, c1, c2 + 1))) } : draft;
}

/** Every formula's text moved for `shift`: what a row or column going in or out does to the references. */
function shiftFormulas(cells: readonly string[], shift: Shift): string[] {
  return cells.map((cell) => (isFormulaInput(cell) ? shiftReferences(cell, shift) : cell));
}

export const canInsertRow = (draft: Draft) => draft.rows.length < MAX_SHEET_ROWS;
export const canInsertColumn = (draft: Draft) => draft.columns < MAX_SHEET_COLUMNS;

/** A row inserted so that it is row `at` (from 0); the formulas that point at the rows below move with them. */
export function insertRow(draft: Draft, at: number): Draft {
  if (!canInsertRow(draft) || at < 0 || at > draft.rows.length) return draft;
  const shift: Shift = { axis: "row", at, delta: 1 };
  const rows = draft.rows.map((cells) => shiftFormulas(cells, shift));
  rows.splice(at, 0, blankRow(draft.columns));
  return { ...draft, rows, carried: withCarried(draft, (grid) => grid.splice(at, 0, noCarried(draft.columns))) };
}

/** Row `at` taken out, with the formulas that point at it showing `#REF!`. The last row left is emptied, not removed. */
export function deleteRow(draft: Draft, at: number): Draft {
  if (at < 0 || at >= draft.rows.length) return draft;
  if (draft.rows.length === 1) return { columns: draft.columns, rows: [blankRow(draft.columns)], ...withTotals(draft.totals) };
  const shift: Shift = { axis: "row", at, delta: -1 };
  const rows = draft.rows.map((cells) => shiftFormulas(cells, shift));
  rows.splice(at, 1);
  return { ...draft, rows, carried: withCarried(draft, (grid) => grid.splice(at, 1)) };
}

/** A column inserted so that it is column `at` (from 0). */
export function insertColumn(draft: Draft, at: number): Draft {
  if (!canInsertColumn(draft) || at < 0 || at > draft.columns) return draft;
  const shift: Shift = { axis: "col", at, delta: 1 };
  return {
    ...withTotals(draft.totals),
    columns: draft.columns + 1,
    rows: draft.rows.map((cells) => {
      const next = shiftFormulas(cells, shift);
      next.splice(at, 0, "");
      return next;
    }),
    carried: withCarried(draft, (grid) => grid.forEach((cells) => cells.splice(at, 0, null))),
  };
}

/** Column `at` taken out. The last column left is emptied, not removed. */
export function deleteColumn(draft: Draft, at: number): Draft {
  if (at < 0 || at >= draft.columns) return draft;
  if (draft.columns === 1) return { columns: 1, rows: draft.rows.map(() => [""]), ...withTotals(draft.totals) };
  const shift: Shift = { axis: "col", at, delta: -1 };
  return {
    ...withTotals(draft.totals),
    columns: draft.columns - 1,
    rows: draft.rows.map((cells) => {
      const next = shiftFormulas(cells, shift);
      next.splice(at, 1);
      return next;
    }),
    carried: withCarried(draft, (grid) => grid.forEach((cells) => cells.splice(at, 1))),
  };
}

/**
 * A block of cells laid down with its top left corner at `(row, col)`, growing the grid to hold it, up to the sheet's
 * limits (the rest is left off, and `cut` says so).
 */
export function pasteBlock(draft: Draft, row: number, col: number, block: readonly (readonly string[])[]): { draft: Draft; cut: boolean } {
  const wanted = block.reduce((widest, line) => Math.max(widest, line.length), 0);
  const rowCount = Math.min(MAX_SHEET_ROWS, Math.max(draft.rows.length, row + block.length));
  const columns = Math.min(MAX_SHEET_COLUMNS, Math.max(draft.columns, col + wanted));
  const cut = row + block.length > rowCount || col + wanted > columns;
  const rows = Array.from({ length: rowCount }, (_, r) => {
    const existing = draft.rows[r] ?? blankRow(draft.columns);
    const line = block[r - row];
    if (!line && columns === draft.columns) return existing;
    const cells = Array.from({ length: columns }, (_, c) => existing[c] ?? "");
    if (line) for (let c = 0; c < line.length && col + c < columns; c++) cells[col + c] = commitInput(line[c]);
    return cells;
  });
  const carried = draft.carried
    ? Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: columns }, (_, c) => (r >= row && r < row + block.length && c >= col && c < col + (block[r - row]?.length ?? 0) ? null : (draft.carried?.[r]?.[c] ?? null))),
      )
    : undefined;
  return { draft: { rows, columns, ...(carried?.some((cells) => cells.some((cell) => cell !== null)) ? { carried } : {}), ...withTotals(draft.totals) }, cut };
}

/**
 * The cells in text copied from a spreadsheet: a tab between cells and a line break between rows, a cell holding a tab,
 * a line break or a quote written in quotes with the quote doubled. The line break that ends the last row is not another row.
 */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atStart = true;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
    atStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (char === "\t") {
      row.push(cell);
      cell = "";
      atStart = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += char;
      atStart = false;
    }
  }
  if (cell !== "" || row.length > 0 || quoted) endRow();
  return rows;
}

/** What Excel puts in the HTML of a copy: its own namespace, and a name for the program that made it. */
const EXCEL_HTML = /urn:schemas-microsoft-com:office:excel|ProgId["']?\s+content=["']?Excel\.Sheet/i;

/**
 * The cells of a paste that is a range copied from a spreadsheet, or `null` for any other text. Cells split by tabs, every row
 * with as many, and in no more rows and columns than a sheet holds are one; so is a copy whose HTML says it came from Excel, even
 * of a single column. Text indented with tabs (every row's first cell empty) is not.
 */
export function rangeFromClipboard(text: string, html = ""): string[][] | null {
  const rows = parseClipboard(text);
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  if (rows.length === 0 || rows.length > MAX_SHEET_ROWS || width > MAX_SHEET_COLUMNS) return null;
  if (rows.length * width < 2 || rows.every((row) => row[0] === "")) return null;
  const fromExcel = EXCEL_HTML.test(html);
  if (!fromExcel && !(text.includes("\t") && width >= 2 && rows.every((row) => row.length === width))) return null;
  return rows.map((row) => (row.length < width ? [...row, ...Array<string>(width - row.length).fill("")] : row));
}

/** Cells as text for the clipboard, the way a spreadsheet writes them (see `parseClipboard`). */
export function formatClipboard(rows: readonly (readonly string[])[]): string {
  const quote = (cell: string) => (/[\t\r\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return rows.map((row) => row.map(quote).join("\t")).join("\n");
}

/** A cell as CSV: in quotes when it holds a comma, a quote or a line break. */
function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows of cells as the text of a CSV block, with no line break at the end. */
export function formatCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Whether nothing at all has been typed. */
export const isDraftEmpty = (draft: Draft) => draft.rows.every((cells) => cells.every((cell) => cell === ""));

/** The draft without the empty rows at its foot and the empty columns at its right, which the CSV would only hold as commas; one cell stays. */
export function trimDraft(draft: Draft): Draft {
  let rowCount = draft.rows.length;
  while (rowCount > 1 && draft.rows[rowCount - 1].every((cell) => cell === "")) rowCount--;
  let columns = draft.columns;
  while (columns > 1 && draft.rows.slice(0, rowCount).every((cells) => cells[columns - 1] === "")) columns--;
  if (rowCount === draft.rows.length && columns === draft.columns) return draft;
  return {
    ...withTotals(draft.totals),
    rows: draft.rows.slice(0, rowCount).map((cells) => cells.slice(0, columns)),
    columns,
    carried: draft.carried?.slice(0, rowCount).map((cells) => cells.slice(0, columns)),
  };
}

export type SheetSource = {
  /** The text of the CSV block. */
  csv: string;
  /** The text of the `formulas` block, empty when no cell has a formula. */
  formulas: string;
  /** The tag says `totals`: the last row is the table's totals row (see `sheetTableOf`). */
  totals?: boolean;
};

export type DraftToSource = { ok: true; source: SheetSource } | { ok: false; error: string };

/** A draft calculated: each formula by the address of its cell (`E2`), the cells whose formula is carried, and the grid with every cell as it is shown. */
export function calculateDraft(draft: Draft): Calculated & { formulas: Map<string, string>; carried: Set<string> } {
  const formulas = new Map<string, string>();
  const carried = new Set<string>();
  const values = draft.rows.map((cells, r) =>
    cells.map((cell, c) => {
      if (!isFormulaInput(cell)) return literalText(cell);
      const address = `${columnLabel(c)}${r + 1}`;
      formulas.set(address, cell);
      const kept = draft.carried?.[r]?.[c] ?? null;
      if (kept === null) return "";
      carried.add(address);
      return kept;
    }),
  );
  return { formulas, carried, ...calculate({ rows: values, columns: draft.columns }, formulas, carried, { totals: draft.totals }) };
}

/**
 * The draft as the note's two blocks. Each formula is calculated and its value goes in the CSV; a formula the engine
 * cannot calculate is `#NAME?` there, as it is wherever the sheet is drawn. A carried one is written as it was, with the
 * value it held, and marked `carried`.
 *
 * Row 1 holds the column names and a sheet's CSV can't begin with an empty row (it would be read as not there, and
 * every address below would move up), so a draft whose first row is empty while others are not is refused.
 */
export function draftToSource(draft: Draft): DraftToSource {
  const trimmed = trimDraft(draft);
  if (isDraftEmpty(trimmed)) return { ok: false, error: "There is nothing in the sheet to save." };
  if (trimmed.rows[0].every((cell) => cell === "")) return { ok: false, error: "Row 1 holds the column names: type at least one before saving." };

  const { formulas, carried, sheet } = calculateDraft(trimmed);
  const lines = [...formulas].map(([address, formula]) => `${address} ${carried.has(address) ? "carried " : ""}${formula}`);
  return { ok: true, source: { csv: formatCsv(sheet.rows), formulas: lines.join("\n"), ...withTotals(trimmed.totals) } };
}
