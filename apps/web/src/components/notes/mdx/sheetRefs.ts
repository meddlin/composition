/**
 * What inserting or deleting a row or column does to the formulas that point at the cells around it, as it does in
 * Excel: a reference to a cell below an inserted row moves down with it, a range with a row inserted inside it grows,
 * a range with a row deleted from it shrinks, and a reference to a deleted cell becomes `#REF!`. Pure, and read from
 * the formula's own tokens, so a cell name inside a text (`"A3"`), a function (`LOG10(`) or another sheet's
 * reference is left as it is. A formula that cannot be read comes back unchanged.
 */
import { parseAddress, tokenize, type Token } from "./sheetParse";
import { columnLabel } from "./sheetData";

export type Shift = {
  axis: "row" | "col";
  /** Where, from 0: for an insertion the new row's place (the row that was there moves down); for a deletion the row that goes. */
  at: number;
  delta: 1 | -1;
};

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const COLUMN = /^(\$?)([A-Za-z]{1,3})$/;
const ROW = /^\d+$/;

const isOp = (token: Token | undefined, text: string) => token?.kind === "op" && token.text === text;

/** A column's letters as its number from 0. */
function columnNumber(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** The new place of a single position on the shifted axis, or `null` where it was deleted. */
function movePoint(at: number, shift: Shift): number | null {
  if (shift.delta === 1) return at >= shift.at ? at + 1 : at;
  if (at === shift.at) return null;
  return at > shift.at ? at - 1 : at;
}

/** The new `[low, high]` of a range on the shifted axis: each end moves on its own, and a range of the one deleted row is gone. */
function moveSpan(low: number, high: number, shift: Shift): [number, number] | null {
  if (shift.delta === 1) return [low >= shift.at ? low + 1 : low, high >= shift.at ? high + 1 : high];
  if (low === high && low === shift.at) return null;
  return [low > shift.at ? low - 1 : low, high >= shift.at ? high - 1 : high];
}

type Replacement = { from: number; to: number; text: string };

/** The formula with every reference moved for `shift`. */
export function shiftReferences(formula: string, shift: Shift): string {
  const lead = formula.startsWith("=") ? 1 : 0;
  let tokens: Token[];
  try {
    tokens = tokenize(formula.slice(lead));
  } catch {
    return formula;
  }
  const along = (cell: { row: number; col: number }) => (shift.axis === "row" ? cell.row : cell.col);
  const replacements: Replacement[] = [];
  const end = (token: Token) => lead + token.at + token.text.length;
  const begin = (token: Token) => lead + token.at;

  /** A cell's text with its place on the shifted axis changed to `to`, keeping its dollar signs. */
  const cellText = (token: Token, to: number): string => {
    const [, colDollar, letters, rowDollar, digits] = CELL.exec(token.text) as RegExpExecArray;
    return shift.axis === "row" ? `${colDollar}${letters}${rowDollar}${to + 1}` : `${colDollar}${columnLabel(to)}${rowDollar}${digits}`;
  };
  const columnText = (token: Token, to: number): string => `${token.text.startsWith("$") ? "$" : ""}${columnLabel(to)}`;

  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    const next = tokens[k + 1];
    const after = tokens[k + 2];

    if (token.kind === "num" && ROW.test(token.text) && isOp(next, ":") && after?.kind === "num" && ROW.test(after.text)) {
      // Whole rows, `3:5`.
      k += 2;
      if (shift.axis !== "row") continue;
      const [a, b] = [Number(token.text) - 1, Number(after.text) - 1];
      const moved = moveSpan(Math.min(a, b), Math.max(a, b), shift);
      if (!moved) replacements.push({ from: begin(token), to: end(after), text: "#REF!" });
      else {
        const [first, second] = a <= b ? moved : [moved[1], moved[0]];
        if (first !== a) replacements.push({ from: begin(token), to: end(token), text: String(first + 1) });
        if (second !== b) replacements.push({ from: begin(after), to: end(after), text: String(second + 1) });
      }
      continue;
    }
    if (token.kind !== "ident") continue;
    // Another sheet's cell (`Sheet2!A3`) is not this sheet's, and a name followed by a bracket is a function.
    if (isOp(tokens[k - 1], "!")) {
      if (isOp(next, ":") && after?.kind === "ident") k += 2; // the far end of `Sheet2!A1:B2` is that sheet's too
      continue;
    }
    if (isOp(next, "(") || isOp(next, "!")) continue;

    const address = parseAddress(token.text);
    if (address && CELL.test(token.text)) {
      const endCell = isOp(next, ":") && after?.kind === "ident" && CELL.test(after.text) ? parseAddress(after.text) : undefined;
      if (endCell && after) {
        k += 2;
        const [a, b] = [along(address), along(endCell)];
        const moved = moveSpan(Math.min(a, b), Math.max(a, b), shift);
        if (!moved) replacements.push({ from: begin(token), to: end(after), text: "#REF!" });
        else {
          const [first, second] = a <= b ? moved : [moved[1], moved[0]];
          if (first !== a) replacements.push({ from: begin(token), to: end(token), text: cellText(token, first) });
          if (second !== b) replacements.push({ from: begin(after), to: end(after), text: cellText(after, second) });
        }
      } else {
        const moved = movePoint(along(address), shift);
        if (moved === null) replacements.push({ from: begin(token), to: end(token), text: "#REF!" });
        else if (moved !== along(address)) replacements.push({ from: begin(token), to: end(token), text: cellText(token, moved) });
      }
      continue;
    }

    if (COLUMN.test(token.text) && isOp(next, ":") && after?.kind === "ident" && COLUMN.test(after.text)) {
      // Whole columns, `B:D`.
      k += 2;
      if (shift.axis !== "col") continue;
      const [a, b] = [columnNumber(token.text.replace("$", "")), columnNumber(after.text.replace("$", ""))];
      const moved = moveSpan(Math.min(a, b), Math.max(a, b), shift);
      if (!moved) replacements.push({ from: begin(token), to: end(after), text: "#REF!" });
      else {
        const [first, second] = a <= b ? moved : [moved[1], moved[0]];
        if (first !== a) replacements.push({ from: begin(token), to: end(token), text: columnText(token, first) });
        if (second !== b) replacements.push({ from: begin(after), to: end(after), text: columnText(after, second) });
      }
    }
  }

  let result = formula;
  for (const { from, to, text } of replacements.sort((x, y) => y.from - x.from)) result = result.slice(0, from) + text + result.slice(to);
  return result;
}
