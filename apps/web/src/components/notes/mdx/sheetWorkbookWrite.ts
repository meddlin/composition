/**
 * The bytes of an `.xlsx` for an export (see sheetExport.ts): SheetJS Community Edition, loaded only when a file is made,
 * like the reader (sheetWorkbook.ts). Each cell is written with its value, and a formula with its formula beside the value, as
 * Excel does; SheetJS asks Excel to calculate everything again when it opens the file, so a formula this engine could not
 * calculate gets its answer there.
 */
import type { CellObject, WorkSheet } from "xlsx";
import { columnLabel } from "./sheetData";
import { type ExportCell, type SheetExport } from "./sheetExport";

/** The number a workbook holds for each error. */
const ERROR_NUMBERS: Record<string, number> = { "#NULL!": 0x00, "#DIV/0!": 0x07, "#VALUE!": 0x0f, "#REF!": 0x17, "#NAME?": 0x1d, "#NUM!": 0x24, "#N/A": 0x2a };

/** How a date is shown: the way it is written in the note. */
export const DATE_FORMAT = "yyyy-mm-dd";

/** A cell as the workbook holds it, or `null` for one with nothing in it. */
export function workbookCell({ value, formula, date }: ExportCell): CellObject | null {
  let cell: CellObject;
  if (value === null) {
    if (!formula) return null;
    cell = { t: "s", v: "" };
  } else if (typeof value === "number") cell = date ? { t: "n", v: value, z: DATE_FORMAT } : { t: "n", v: value };
  else if (typeof value === "boolean") cell = { t: "b", v: value };
  else if (typeof value === "string") cell = { t: "s", v: value };
  else cell = { t: "e", v: ERROR_NUMBERS[value.error] ?? 0x0f, w: value.error };
  if (formula) cell.f = formula;
  return cell;
}

/** How wide to make a column, in characters: its longest cell, between 8 and 40. */
function columnWidth(rows: ExportCell[][], column: number): number {
  const longest = rows.reduce((widest, row) => Math.max(widest, String(row[column]?.value ?? "").length), 0);
  return Math.min(40, Math.max(8, longest + 2));
}

/** The workbook of one sheet, named `sheetName`, as the bytes of an `.xlsx` file. */
export async function writeWorkbook({ rows, columns }: Pick<SheetExport, "rows" | "columns">, sheetName: string): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const sheet: WorkSheet = {};
  rows.forEach((cells, r) =>
    cells.forEach((cell, c) => {
      const written = workbookCell(cell);
      if (written) sheet[`${columnLabel(c)}${r + 1}`] = written;
    }),
  );
  sheet["!ref"] = `A1:${columnLabel(Math.max(0, columns - 1))}${Math.max(1, rows.length)}`;
  sheet["!cols"] = Array.from({ length: columns }, (_, c) => ({ wch: columnWidth(rows, c) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
