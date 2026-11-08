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
};

/** What a new sheet starts as: a header row and five empty ones, in four columns. */
export const NEW_SHEET_ROWS = 6;
export const NEW_SHEET_COLUMNS = 4;

const blankRow = (columns: number): string[] => Array<string>(columns).fill("");

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
export function draftFromSource(csv: string, formulasText: string): Draft {
  const parsed = parseSheet(csv);
  if (!parsed.sheet) return emptyDraft();
  const { formulas } = parseFormulas(formulasText);
  // The grid grows to hold a formula below the last CSV row, as it does when the sheet is drawn.
  const { sheet } = calculate(parsed.sheet, formulas);
  const rows = sheet.rows.map((row) => row.map(inputOfText));
  for (const [address, formula] of formulas) {
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    if (!match) continue;
    const column = [...match[1]].reduce((index, char) => index * 26 + (char.charCodeAt(0) - 64), 0) - 1;
    const row = Number(match[2]) - 1;
    if (row < rows.length && column < sheet.columns) rows[row][column] = formula;
  }
  return { rows, columns: sheet.columns };
}

/** The draft with one cell changed to `input`, as it is kept (see `commitInput`). */
export function setCell(draft: Draft, row: number, col: number, input: string): Draft {
  const value = commitInput(input);
  if (draft.rows[row]?.[col] === undefined || draft.rows[row][col] === value) return draft;
  return { ...draft, rows: draft.rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === col ? value : cell)) : cells)) };
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
  return changed ? { ...draft, rows } : draft;
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
  return { ...draft, rows };
}

/** Row `at` taken out, with the formulas that point at it showing `#REF!`. The last row left is emptied, not removed. */
export function deleteRow(draft: Draft, at: number): Draft {
  if (at < 0 || at >= draft.rows.length) return draft;
  if (draft.rows.length === 1) return { ...draft, rows: [blankRow(draft.columns)] };
  const shift: Shift = { axis: "row", at, delta: -1 };
  const rows = draft.rows.map((cells) => shiftFormulas(cells, shift));
  rows.splice(at, 1);
  return { ...draft, rows };
}

/** A column inserted so that it is column `at` (from 0). */
export function insertColumn(draft: Draft, at: number): Draft {
  if (!canInsertColumn(draft) || at < 0 || at > draft.columns) return draft;
  const shift: Shift = { axis: "col", at, delta: 1 };
  return {
    columns: draft.columns + 1,
    rows: draft.rows.map((cells) => {
      const next = shiftFormulas(cells, shift);
      next.splice(at, 0, "");
      return next;
    }),
  };
}

/** Column `at` taken out. The last column left is emptied, not removed. */
export function deleteColumn(draft: Draft, at: number): Draft {
  if (at < 0 || at >= draft.columns) return draft;
  if (draft.columns === 1) return { ...draft, rows: draft.rows.map(() => [""]) };
  const shift: Shift = { axis: "col", at, delta: -1 };
  return {
    columns: draft.columns - 1,
    rows: draft.rows.map((cells) => {
      const next = shiftFormulas(cells, shift);
      next.splice(at, 1);
      return next;
    }),
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
  return { draft: { rows, columns }, cut };
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
  return { rows: draft.rows.slice(0, rowCount).map((cells) => cells.slice(0, columns)), columns };
}

export type SheetSource = {
  /** The text of the CSV block. */
  csv: string;
  /** The text of the `formulas` block, empty when no cell has a formula. */
  formulas: string;
};

export type DraftToSource = { ok: true; source: SheetSource } | { ok: false; error: string };

/** A draft calculated: each formula by the address of its cell (`E2`), and the grid with every cell as it is shown. */
export function calculateDraft(draft: Draft): Calculated & { formulas: Map<string, string> } {
  const formulas = new Map<string, string>();
  const values = draft.rows.map((cells, r) =>
    cells.map((cell, c) => {
      if (!isFormulaInput(cell)) return literalText(cell);
      formulas.set(`${columnLabel(c)}${r + 1}`, cell);
      return "";
    }),
  );
  return { formulas, ...calculate({ rows: values, columns: draft.columns }, formulas) };
}

/**
 * The draft as the note's two blocks. Each formula is calculated and its value goes in the CSV; a formula the engine
 * cannot calculate is `#NAME?` there, as it is wherever the sheet is drawn.
 *
 * Row 1 holds the column names and a sheet's CSV can't begin with an empty row (it would be read as not there, and
 * every address below would move up), so a draft whose first row is empty while others are not is refused.
 */
export function draftToSource(draft: Draft): DraftToSource {
  const trimmed = trimDraft(draft);
  if (isDraftEmpty(trimmed)) return { ok: false, error: "There is nothing in the sheet to save." };
  if (trimmed.rows[0].every((cell) => cell === "")) return { ok: false, error: "Row 1 holds the column names: type at least one before saving." };

  const { formulas, sheet } = calculateDraft(trimmed);
  const lines = [...formulas].map(([address, formula]) => `${address} ${formula}`);
  return { ok: true, source: { csv: formatCsv(sheet.rows), formulas: lines.join("\n") } };
}
