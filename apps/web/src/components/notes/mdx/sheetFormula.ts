/**
 * The formula engine of a `<Sheet>`: it calculates the formulas of a grid. Pure, with nothing from React, so the
 * terminal app shares it, and the iPad's Swift port can be checked against the same cases.
 *
 *     const results = evaluate(cells, formulas);   // cells: the grid's values; formulas: address -> "=C2*D2"
 *     results.get("E2")                            // { value: 1140, unsupported: [] }
 *
 * Excel is the spec (docs/sheet-component-plan.md, S8). The rules are Excel's, read off real Excel and kept as
 * test cases in spikes/sheet/excel-verified-cases.json. What is not reproduced is not guessed: a function this
 * engine lacks, or a text it would have to read as a date, makes the cell `#NAME?` and says what it could not do,
 * in `unsupported`; so does a formula that depends on one. The caller decides what to show instead.
 *
 * The rest follows Excel 365: arrays work everywhere (`SUM(B1:B5*2)`), and a formula's last addition or
 * subtraction that is only rounding noise is 0.
 *
 * Cells are calculated in the order the formulas need, not in the order of the sheet, and without recursion, so a
 * running total down 5,000 rows is as safe as one down 5.
 */
import { columnLabel, type Sheet } from "./sheetData";
import { isoDateSerial } from "./sheetDate";
import { FUNCTIONS } from "./sheetFunctions";
import { type EvalContext, type Lazy, attempt, broadcast, finite, power, scalarOf } from "./sheetMatrix";
import { type Node, SyntaxProblem, parseAddress, parseFormula } from "./sheetParse";
import {
  ERR,
  type Matrix,
  type Scalar,
  Unsupported,
  type Value,
  compareScalars,
  errorByCode,
  isError,
  isMatrix,
  numberToText,
  parseNumberText,
  snapToZero,
  toNumber,
  toText,
} from "./sheetValue";

export type FormulaResult = {
  /** Never an array, never blank: a formula that is blank is 0, as in Excel. */
  value: Scalar;
  /** What this engine could not calculate, here or in a cell this one depends on; empty when it all was. */
  unsupported: string[];
};

export type Evaluation = Map<string, FormulaResult>;

/** The most cells one range may hold, so `A1:XFD1048576` is said and not tried. */
const MAX_RANGE_CELLS = 5_000_000;
const STRIDE = 16_384;

/** A formula cell that has to be calculated first. */
class Need {
  constructor(readonly keys: number[]) {}
}

type State = { used: Set<string>; context: EvalContext };

function arithmetic(op: string, x: Scalar, y: Scalar, root: boolean): Scalar {
  if (isError(x)) return x;
  if (isError(y)) return y;
  if (op === "&") return toText(x) + toText(y);
  if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
    const order = compareScalars(x, y);
    return op === "=" ? order === 0 : op === "<>" ? order !== 0 : op === "<" ? order < 0 : op === ">" ? order > 0 : op === "<=" ? order <= 0 : order >= 0;
  }
  const a = toNumber(x);
  const b = toNumber(y);
  switch (op) {
    case "+":
      return finite(root ? snapToZero(a, b, a + b) : a + b);
    case "-":
      return finite(root ? snapToZero(a, b, a - b) : a - b);
    case "*":
      return finite(a * b);
    case "/":
      return b === 0 ? ERR.DIV0 : finite(a / b);
    default:
      return power(a, b);
  }
}

/** A formula whose address is the key, the grid's values, and the results by address. */
export function evaluate(cells: readonly (readonly Scalar[])[], formulas: ReadonlyMap<string, string>): Evaluation {
  const parsed = new Map<number, { node?: Node; problem?: string }>();
  let lastRow = cells.length - 1;
  let lastCol = cells.reduce((widest, row) => Math.max(widest, row.length), 0) - 1;
  for (const [address, text] of formulas) {
    const at = parseAddress(address);
    if (!at) continue;
    try {
      parsed.set(at.row * STRIDE + at.col, { node: parseFormula(text) });
    } catch (error) {
      if (!(error instanceof SyntaxProblem)) throw error;
      parsed.set(at.row * STRIDE + at.col, { problem: error.message });
    }
    lastRow = Math.max(lastRow, at.row);
    lastCol = Math.max(lastCol, at.col);
  }

  const computed = new Map<number, FormulaResult>();
  const rangeCache = new Map<string, { matrix: Matrix; unsupported: string[] }>();

  const readCell = (row: number, col: number, used: Set<string>): Scalar => {
    const key = row * STRIDE + col;
    if (parsed.has(key)) {
      const result = computed.get(key);
      if (!result) throw new Need([key]);
      for (const reason of result.unsupported) used.add(reason);
      return result.value;
    }
    return cells[row]?.[col] ?? null;
  };

  const readRange = (r1: number, c1: number, r2: number, c2: number, used: Set<string>): Matrix => {
    // A whole column or row runs to the end of what the sheet holds.
    const lastR = Number.isFinite(r2) ? r2 : Math.max(lastRow, r1);
    const lastC = Number.isFinite(c2) ? c2 : Math.max(lastCol, c1);
    const id = `${r1},${c1},${lastR},${lastC}`;
    let entry = rangeCache.get(id);
    if (!entry) {
      if ((lastR - r1 + 1) * (lastC - c1 + 1) > MAX_RANGE_CELLS) throw new Unsupported("a range of more than 5 million cells");
      const missing: number[] = [];
      const reasons = new Set<string>();
      const matrix: Matrix = [];
      for (let r = r1; r <= lastR; r++) {
        const row: Scalar[] = [];
        for (let c = c1; c <= lastC; c++) {
          const key = r * STRIDE + c;
          if (parsed.has(key)) {
            const result = computed.get(key);
            if (!result) missing.push(key);
            else for (const reason of result.unsupported) reasons.add(reason);
            row.push(result ? result.value : null);
          } else row.push(cells[r]?.[c] ?? null);
        }
        matrix.push(row);
      }
      if (missing.length > 0) throw new Need(missing);
      entry = { matrix, unsupported: [...reasons] };
      rangeCache.set(id, entry);
    }
    for (const reason of entry.unsupported) used.add(reason);
    return entry.matrix;
  };

  const evalNode = (node: Node, state: State, root = false): Value => {
    switch (node.t) {
      case "num":
      case "str":
      case "bool":
      case "err":
        return node.v;
      case "ref":
        return node.range ? readRange(node.r1, node.c1, node.r2, node.c2, state.used) : readCell(node.r1, node.c1, state.used);
      case "paren":
        return evalNode(node.a, state);
      case "unary": {
        const value = evalNode(node.a, state);
        return node.op === "+" ? value : broadcast([value], ([x]) => attempt(() => finite(-toNumber(x))));
      }
      case "percent":
        return broadcast([evalNode(node.a, state)], ([x]) => attempt(() => finite(toNumber(x) / 100)));
      case "bin": {
        // Along the left side of a long `a+b+c+...`, one operand after another, so that a formula of thousands of terms does not nest that deep.
        const spine: Extract<Node, { t: "bin" }>[] = [];
        let leftmost: Node = node;
        while (leftmost.t === "bin") {
          spine.push(leftmost);
          leftmost = leftmost.a;
        }
        let result = evalNode(leftmost, state);
        for (let i = spine.length - 1; i >= 0; i--) {
          const { op, b } = spine[i];
          const isRoot = root && i === 0 && (op === "+" || op === "-");
          result = broadcast([result, evalNode(b, state)], ([x, y]) => attempt(() => arithmetic(op, x, y, isRoot)));
        }
        return result;
      }
      case "array":
        return node.rows.map((row) => row.map((item) => scalarOf(evalNode(item, state))));
      case "unsupported":
        throw new Unsupported(node.reason);
      case "call":
        return call(node, state);
    }
  };

  const call = (node: Extract<Node, { t: "call" }>, state: State): Value => {
    const spec = FUNCTIONS[node.name];
    if (!spec) throw new Unsupported(`the function ${node.name}`);
    if (node.args.length < spec.min || node.args.length > spec.max) throw new Unsupported(`${node.name} with ${node.args.length} arguments`);
    try {
      if (spec.kind === "scalar") {
        const args = node.args.map((arg) => (arg === null ? null : evalNode(arg, state)));
        return broadcast(args, (scalars) => {
          if (spec.errors !== "pass") {
            const failed = scalars.find(isError);
            if (failed) return failed;
          }
          return attempt(() => spec.run(scalars));
        });
      }
      if (spec.kind === "raw") {
        // A reference to one cell is given as an array of one, so that the function can tell it from a value typed in.
        const args = node.args.map((arg) =>
          arg === null ? undefined : arg.t === "ref" && !arg.range ? [[readCell(arg.r1, arg.c1, state.used)]] : evalNode(arg, state),
        );
        return spec.run(args);
      }
      const args: Lazy[] = node.args.map((arg) => ({
        node: arg,
        value: () => (arg === null ? null : evalNode(arg, state)),
      }));
      return spec.run(args, state.context);
    } catch (error) {
      if (isError(error)) return error;
      throw error;
    }
  };

  const compute = (key: number): FormulaResult => {
    const entry = parsed.get(key) as { node?: Node; problem?: string };
    if (!entry.node)
      return {
        value: ERR.NAME,
        unsupported: [`a formula this engine cannot read (${entry.problem})`],
      };
    const used = new Set<string>();
    const row = Math.floor(key / STRIDE);
    const col = key % STRIDE;
    const context: EvalContext = {
      readRange: (r1, c1, r2, c2) => readRange(r1, c1, r2, c2, used),
      row,
      col,
    };
    let value: Scalar;
    try {
      let result = evalNode(entry.node, { used, context }, true);
      if (isMatrix(result)) {
        if (result.length !== 1 || result[0].length !== 1) throw new Unsupported("a formula that fills several cells");
        result = result[0][0];
      }
      value = result === null ? 0 : result;
    } catch (error) {
      if (error instanceof Unsupported) {
        used.add(error.reason);
        value = ERR.NAME;
      } else if (isError(error)) value = error;
      else throw error;
    }
    return { value, unsupported: [...used] };
  };

  // Calculate a cell, and what it needs first, one at a time with a list in place of recursion.
  const visiting = new Set<number>();
  const settle = (first: number) => {
    const stack = [first];
    while (stack.length > 0) {
      const key = stack[stack.length - 1];
      if (computed.has(key)) {
        stack.pop();
        continue;
      }
      visiting.add(key);
      try {
        computed.set(key, compute(key));
        visiting.delete(key);
        stack.pop();
      } catch (error) {
        if (!(error instanceof Need)) throw error;
        if (error.keys.some((needed) => visiting.has(needed))) {
          computed.set(key, {
            value: ERR.NAME,
            unsupported: ["a formula that refers to itself"],
          });
          visiting.delete(key);
          stack.pop();
        } else for (const needed of error.keys) if (!computed.has(needed)) stack.push(needed);
      }
    }
  };
  for (const key of [...parsed.keys()].sort((a, b) => a - b)) settle(key);

  const results: Evaluation = new Map();
  for (const key of parsed.keys()) results.set(`${columnLabel(key % STRIDE)}${Math.floor(key / STRIDE) + 1}`, computed.get(key) as FormulaResult);
  return results;
}

/**
 * A cell of the sheet's CSV block as a value, as Excel would read it typed in: nothing is a blank, `TRUE` and
 * `FALSE` are logicals, a number may have thousands commas, a `$` or a percent sign, a date written `2026-03-04` is
 * that date (the number of days since 1900, as in Excel), and anything else is text. A text that begins with a zero
 * (`007`, an identifier) stays text; and one that looks like another kind of date does too, so arithmetic on it says
 * it cannot be calculated and is not guessed.
 */
export function typeCell(text: string): Scalar {
  if (text === "") return null;
  if (text === "TRUE") return true;
  if (text === "FALSE") return false;
  const error = errorByCode(text);
  if (error) return error;
  const date = isoDateSerial(text);
  if (date !== null) return date;
  if (/^[-+]?0\d/.test(text.trim())) return text;
  try {
    return parseNumberText(text) ?? text;
  } catch (thrown) {
    if (thrown instanceof Unsupported) return text;
    throw thrown;
  }
}

/** The formulas of a sheet, given the sheet's CSV values: its first row is row 1, as in Excel. */
export function evaluateSheet(sheet: Sheet, formulas: ReadonlyMap<string, string>): Evaluation {
  return evaluate(
    sheet.rows.map((row) => row.map(typeCell)),
    formulas,
  );
}

/** A sheet with its formulas calculated: the same grid with each formula's cell showing its result, and what each came to. */
export type Calculated = { sheet: Sheet; results: Evaluation };

/** The grid grows to hold a formula (a totals row of nothing else has no CSV row), but only this far: more is calculated and not shown. */
const NONE: ReadonlySet<string> = new Set();

export const MAX_SHEET_ROWS = 5_001;
export const MAX_SHEET_COLUMNS = 100;

/**
 * `carried` are formulas of `formulas` that are not calculated: the CSV holds their value (see `parseFormulas`), and the
 * cells that read them read that. They have no result, and the grid still grows to hold them.
 */
export function calculate(sheet: Sheet, formulas: ReadonlyMap<string, string>, carried: ReadonlySet<string> = NONE): Calculated {
  const live = carried.size === 0 ? formulas : new Map([...formulas].filter(([address]) => !carried.has(address)));
  const results = evaluateSheet(sheet, live);
  const places = [...formulas.keys()].flatMap((address) => {
    const at = parseAddress(address);
    return at && at.row < MAX_SHEET_ROWS && at.col < MAX_SHEET_COLUMNS ? [{ address, ...at }] : [];
  });
  const columns = places.reduce((widest, place) => Math.max(widest, place.col + 1), sheet.columns);
  const length = places.reduce((longest, place) => Math.max(longest, place.row + 1), sheet.rows.length);
  const rows = Array.from({ length }, (_, r) => Array.from({ length: columns }, (_, c) => sheet.rows[r]?.[c] ?? ""));
  for (const { address, row, col } of places) {
    const result = results.get(address);
    if (result) rows[row][col] = formatValue(result.value);
  }
  return { sheet: { rows, columns }, results };
}

/** A value as the grid shows it. */
export function formatValue(value: Scalar): string {
  if (typeof value === "number") return numberToText(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value === null) return "";
  if (isError(value)) return value.code;
  return value;
}
