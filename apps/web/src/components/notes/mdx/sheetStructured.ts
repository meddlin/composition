/**
 * Column names in formulas, Excel's "structured references" to a table: `=SUM([Revenue])`, `=[@Units]*[@Price]`,
 * `=SUMIFS([Revenue],[Region],"West")`. A sheet's header row is its table (S9 in the plan), and a formula says a column by
 * its name, which a column inserted or moved does not change. Pure, with nothing from React.
 *
 * This resolves each reference to an ordinary range of the table, as text, and the rest of the engine never sees one: the
 * engine does it to a sheet's own formulas (the table is the sheet: the header row and the rows below it), an export does it
 * because Excel would not know the table, and an import does it with the table definitions of the file, so `Table1[Revenue]`
 * comes across as `$E$2:$E$5` and stays a formula.
 *
 * What is read (Excel's grammar, [from its documentation](https://support.microsoft.com/en-us/office/using-structured-references-with-excel-tables-f5ed2452-2337-4f71-bed3-c8ae6d2b276e)):
 *
 *     [Revenue]   [@Units]   [@[Unit Price]]   [@]   [[#This Row],[Units]]   [[Region]:[Revenue]]
 *     [#Headers]  [#Data]    [#Totals]         [#All]   [[#Headers],[Revenue]]   [[#Data],[Revenue]]
 *     [[#Headers],[#Data]]   [[#Data],[#Totals]]   Table1[Revenue]   Table1[[#Totals],[Revenue]]
 *
 * with Excel's escape in a column name: a `'` before `[`, `]`, `#` or `'`. A column that is not there becomes `#REF!` in its
 * place, so `IFERROR([Nope],0)` still says 0, as Excel does; `@` in a row that is not one of the table's data is `#VALUE!`. A form it does not read (a table that is on another sheet, a
 * combination of rows Excel does not allow) is `unsupported`, and the caller says so.
 */
import { columnLabel } from "./sheetData";
import { tokenize, type Token } from "./sheetParse";

/** A table: the cells it covers in its sheet (from 0, headers and totals included), and the names of its columns. */
export type TableDef = {
  row1: number;
  col1: number;
  row2: number;
  col2: number;
  headerRows: 0 | 1;
  totalsRows: 0 | 1;
  /** The column names, left to right, the first being column `col1`. */
  columns: readonly string[];
};

/**
 * What looks a table up: by its name (`Table1[…]`), or, with `null`, the one the formula's own cell is in. `undefined` is no such
 * table, which is `#REF!`; `{ unsupported }` is one it cannot be read against, and says why (a table on another sheet).
 */
export type FindTable = (name: string | null) => TableDef | { unsupported: string } | undefined;

export type ResolvedStructured = { formula: string; unsupported?: undefined } | { formula?: undefined; unsupported: string };

/**
 * A sheet as the table its formulas' column names mean (S9): its header row (`headers`, the names), and every row of the grid below
 * it as data, `rows` being how many rows the grid has. With `totals` (the tag says `<Sheet totals>`) the last row is the table's totals
 * row, as Excel's Total Row is: not data, so `=SUM([Revenue])` in it does not read itself. A formula-only row under the last row of the CSV is
 * not data either, since the grid grows to hold it and the table is the rows the CSV has.
 */
export function sheetTableOf(headers: readonly string[], rows: number, totals = false): TableDef | undefined {
  if (rows < 1 || headers.length < 1) return undefined;
  return { row1: 0, col1: 0, row2: rows - 1, col2: headers.length - 1, headerRows: 1, totalsRows: totals && rows > 1 ? 1 : 0, columns: headers };
}

/** The `find` of a sheet's own formulas: the sheet is the table, and a table written by name is one it cannot know. */
export const findInSheet =
  (table: TableDef | undefined): FindTable =>
  (name) =>
    name === null ? table : { unsupported: `a table called ${name} (write its column as [Column], without the table's name)` };

type Rows = "data" | "headers" | "totals" | "all" | "this" | "headers+data" | "data+totals";
type Spec = { rows: Rows; first?: string; last?: string };

const KEYWORDS: Record<string, string> = { "#headers": "headers", "#data": "data", "#totals": "totals", "#all": "all", "#this row": "this" };

/** A column name as the reference writes it, with Excel's escapes (`'[`, `']`, `'#`, `''`) taken off. */
const unescapeName = (text: string) => text.replace(/'([[\]#'])/g, "$1");

/** The pieces of `a,b,c` that are not inside brackets. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") {
      current += char + (text[++i] ?? "");
      continue;
    }
    if (char === "[") depth++;
    else if (char === "]") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts;
}

/** A column or a pair of them: `Name`, `[Name]` or `[First]:[Last]`; `null` for anything else. */
function columns(text: string): { first: string; last: string } | null {
  const trimmed = text.trim();
  // A name that begins with `#` unescaped is one of Excel's special items (`#Headers`), and one this does not know is not a column.
  if (/^\[?#/.test(trimmed)) return null;
  const pair = /^\[((?:'.|[^'\]])*)\]\s*:\s*\[((?:'.|[^'\]])*)\]$/.exec(trimmed);
  if (pair) return { first: unescapeName(pair[1]), last: unescapeName(pair[2]) };
  const bracketed = /^\[((?:'.|[^'\]])*)\]$/.exec(trimmed);
  if (bracketed) return { first: unescapeName(bracketed[1]), last: unescapeName(bracketed[1]) };
  if (trimmed !== "" && !/[[\]]/.test(trimmed.replace(/'./g, ""))) return { first: unescapeName(trimmed), last: unescapeName(trimmed) };
  return null;
}

/** What a reference's brackets say: which rows of the table and which columns, or `null` for a form not read. */
function parseSpec(text: string): Spec | null {
  const inner = text.slice(1, -1).trim();
  if (inner.startsWith("@")) {
    const rest = inner.slice(1).trim();
    if (rest === "") return { rows: "this" };
    const named = columns(rest);
    return named ? { rows: "this", ...named } : null;
  }
  const items = inner.startsWith("[") ? splitTopLevel(inner).map((item) => item.trim()) : [inner];
  const rows: string[] = [];
  let named: { first: string; last: string } | undefined;
  for (const item of items) {
    const keyword = KEYWORDS[item.replace(/^\[|\]$/g, "").trim().toLowerCase()];
    if (keyword && /^(?:\[#[^\]]*\]|#.*)$/.test(item)) rows.push(keyword);
    else {
      const found = columns(item);
      if (!found || named) return null;
      named = found;
    }
  }
  const set = new Set(rows);
  let kind: Rows;
  if (set.size === 0) kind = "data";
  else if (set.size === 1) kind = [...set][0] as Rows;
  else if (set.size === 2 && set.has("headers") && set.has("data")) kind = "headers+data";
  else if (set.size === 2 && set.has("data") && set.has("totals")) kind = "data+totals";
  else return null;
  return { rows: kind, ...named };
}

type Cell = { row: number; col: number };

/** The range a reference stands for, as A1 text, `#REF!` when it points at what the table does not have, or `unsupported`. */
function toRange(spec: Spec, table: TableDef, cell: Cell | null): string | { unsupported: string } {
  const dataFirst = table.row1 + table.headerRows;
  const dataLast = table.row2 - table.totalsRows;
  let rows: [number, number] | undefined;
  switch (spec.rows) {
    case "data":
      rows = dataFirst <= dataLast ? [dataFirst, dataLast] : undefined;
      break;
    case "headers":
      rows = table.headerRows === 1 ? [table.row1, table.row1] : undefined;
      break;
    case "totals":
      rows = table.totalsRows === 1 ? [table.row2, table.row2] : undefined;
      break;
    case "all":
      rows = [table.row1, table.row2];
      break;
    case "headers+data":
      rows = table.headerRows === 1 && dataFirst <= dataLast ? [table.row1, dataLast] : undefined;
      break;
    case "data+totals":
      rows = table.totalsRows === 1 && dataFirst <= dataLast ? [dataFirst, table.row2] : undefined;
      break;
    case "this":
      // `@` in a row that is not one of the table's data is `#VALUE!` in Excel (checked in it), not a guess.
      if (!cell || cell.row < dataFirst || cell.row > dataLast) return "#VALUE!";
      rows = [cell.row, cell.row];
      break;
  }
  if (!rows) return "#REF!";
  let cols: [number, number] = [table.col1, table.col2];
  if (spec.first !== undefined && spec.last !== undefined) {
    const find = (name: string) => table.columns.findIndex((column) => column.trim().toLowerCase() === name.trim().toLowerCase());
    const [a, b] = [find(spec.first), find(spec.last)];
    if (a < 0 || b < 0) return "#REF!";
    cols = [table.col1 + Math.min(a, b), table.col1 + Math.max(a, b)];
  }
  const single = rows[0] === rows[1] && cols[0] === cols[1];
  const absolute = spec.rows !== "this";
  const at = (row: number, col: number) => `${absolute ? "$" : ""}${columnLabel(col)}${absolute ? "$" : ""}${row + 1}`;
  return single ? at(rows[0], cols[0]) : `${at(rows[0], cols[0])}:${at(rows[1], cols[1])}`;
}

const adjacent = (before: Token | undefined, after: Token) => before !== undefined && before.kind === "ident" && before.at + before.text.length === after.at;

/**
 * The formula with each structured reference in it replaced by the range it stands for. `cell` is where the formula is (for `@`);
 * `find` says which table a reference means. A reference to a column the table has not is `#REF!` in its place. A formula with no
 * reference, or one that cannot be read at all, comes back as it was.
 */
export function resolveStructuredReferences(formula: string, find: FindTable, cell: Cell | null): ResolvedStructured {
  if (!formula.includes("[")) return { formula };
  const lead = formula.startsWith("=") ? 1 : 0;
  let tokens: Token[];
  try {
    tokens = tokenize(formula.slice(lead));
  } catch {
    return { formula };
  }
  const replacements: { from: number; to: number; text: string }[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.kind !== "structured") continue;
    const before = tokens[k - 1];
    const qualified = adjacent(before, token) ? before : undefined;
    const spec = parseSpec(token.text);
    if (!spec) return { unsupported: `a table reference this reads no further (${token.text})` };
    const table = find(qualified ? qualified.text : null);
    if (table && "unsupported" in table) return { unsupported: table.unsupported };
    if (!table) {
      // No such table is a reference to nothing, as Excel has it.
      replacements.push({ from: lead + (qualified ?? token).at, to: lead + token.at + token.text.length, text: "#REF!" });
      continue;
    }
    const range = toRange(spec, table, cell);
    if (typeof range !== "string") return range;
    replacements.push({ from: lead + (qualified ?? token).at, to: lead + token.at + token.text.length, text: range });
  }
  let result = formula;
  for (const { from, to, text } of replacements.sort((x, y) => y.from - x.from)) result = result.slice(0, from) + text + result.slice(to);
  return { formula: result };
}
