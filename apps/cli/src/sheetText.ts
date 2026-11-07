import { columnLabel, isNumberCell, type Sheet } from "./backend";

/** The rows below the header drawn; a longer sheet says how many it left out. A terminal can't scroll a code block. */
export const SHEET_TEXT_ROWS = 50;
const MAX_CELL = 24;

/** A cell on one line, cut at MAX_CELL characters with an ellipsis. */
function clip(cell: string): string {
  const line = cell.replace(/\s*\n\s*/g, " ");
  return line.length > MAX_CELL ? `${line.slice(0, MAX_CELL - 1)}…` : line;
}

/**
 * A sheet as text, for a terminal that can't draw a grid: Excel's column letters, the row numbers down the
 * side (the header is row 1, as on the web) and the cells, two spaces apart. A column that holds numbers and
 * nothing else (empty cells aside) is set flush right, any other on the left, so the digits line up. Returned
 * as the lines of a code block, so the terminal keeps the alignment.
 */
export function sheetLines({ rows, columns }: Sheet): string[] {
  const body = rows.length - 1;
  const drawn = Math.min(body, SHEET_TEXT_ROWS);
  const shown = rows.slice(0, drawn + 1).map((row) => row.map(clip));

  const widths = Array.from({ length: columns }, (_, c) => Math.max(columnLabel(c).length, ...shown.map((row) => row[c].length)));
  const flushRight = Array.from({ length: columns }, (_, c) => {
    const cells = shown.slice(1).map((row) => row[c]).filter((cell) => cell !== "");
    return cells.length > 0 && cells.every(isNumberCell);
  });
  const gutter = String(drawn + 1).length;

  const line = (label: string, cells: string[]) =>
    `${label.padStart(gutter)} ${cells.map((cell, c) => (flushRight[c] ? cell.padStart(widths[c]) : cell.padEnd(widths[c]))).join("  ")}`.trimEnd();

  const lines = [line("", Array.from({ length: columns }, (_, c) => columnLabel(c))), ...shown.map((row, r) => line(String(r + 1), row))];
  const left = body - drawn;
  if (left > 0) lines.push(`… ${left.toLocaleString("en-US")} more row${left === 1 ? "" : "s"}`);
  return lines;
}

/** The lines as a fenced Markdown block (a fence longer than any backtick run in them), under a bold title when there is one. */
export function sheetMarkdown(sheet: Sheet, title?: string): string {
  const lines = sheetLines(sheet);
  const longest = Math.max(0, ...lines.map((line) => Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length))));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const heading = title?.trim() ? `**${title.trim().replace(/[\\*_`]/g, "\\$&")}**\n\n` : "";
  return `${heading}${fence}\n${lines.join("\n")}\n${fence}`;
}
