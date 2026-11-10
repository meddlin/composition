/**
 * What every formula function is built from: the shape of a function (how it is given its arguments), and
 * Excel's rules for ranges and arrays, which are the same for all of them. Pure, shared with the terminal app.
 *
 * Excel 365 works on arrays everywhere: `LEN(A1:A5)` is five lengths, `B1:B5*2` is five products, and a
 * one-row array beside a one-column one makes a table. A function that takes one value per argument is lifted
 * over arrays by `broadcast`; the rest are given the arrays and decide for themselves.
 */
import type { Node } from "./sheetParse";
import { ERR, type Matrix, type Scalar, type Value, isError, isMatrix, round15, toNumber } from "./sheetValue";

/** What a function may ask of the sheet it is in. */
export type EvalContext = {
  /** A range of the sheet as values; for the functions that read beyond the range they are given (`SUMIF`'s sum range). */
  readRange(r1: number, c1: number, r2: number, c2: number): Matrix;
  /** The cell being calculated, from 0, for `ROW()` and `COLUMN()`. */
  row: number;
  col: number;
};

/** An argument that is calculated only if the function asks: `IF` does not calculate the branch it does not take. */
export type Lazy = { node: Node | null; value(): Value };

/**
 * How a function is given what it is passed:
 *  - `scalar`: one value per argument; arrays are lifted (the function runs per element) and an error argument is
 *    the result, unless `errors: "pass"`. An argument left out is a blank.
 *  - `raw`: the arguments as they are, arrays and ranges whole (a reference to one cell is a 1x1 array, which is how
 *    `SUM(A1)` knows to ignore a text in it where `SUM("a")` is `#VALUE!`); a left-out argument is `undefined`.
 *  - `lazy`: each argument is calculated when asked for.
 */
export type FunctionSpec =
  | {
      kind: "scalar";
      min: number;
      max: number;
      errors?: "pass";
      run(args: Scalar[]): Scalar;
    }
  | {
      kind: "raw";
      min: number;
      max: number;
      run(args: (Value | undefined)[]): Value;
    }
  | {
      kind: "lazy";
      min: number;
      max: number;
      run(args: Lazy[], context: EvalContext): Value;
    };

export const dims = (matrix: Matrix) => ({
  rows: matrix.length,
  cols: matrix[0]?.length ?? 0,
});

export const toMatrix = (value: Value): Matrix => (isMatrix(value) ? value : [[value]]);

/** A value as one value: the one in a 1x1 array, `#VALUE!` for a larger one, a blank for what was left out. */
export function scalarOf(value: Value | undefined): Scalar {
  if (value === undefined) return null;
  if (!isMatrix(value)) return value;
  if (value.length === 1 && value[0].length === 1) return value[0][0];
  throw ERR.VALUE;
}

/**
 * `f` over its arguments, element by element where any is an array. Arrays of different sizes are laid over
 * each other: a one-row (or one-column) array repeats across, and where the others run out the result is `#N/A`.
 */
export function broadcast(values: readonly Value[], f: (scalars: Scalar[]) => Scalar): Value {
  let rows = 0;
  let cols = 0;
  let arrays = false;
  for (const value of values) {
    if (!isMatrix(value)) continue;
    arrays = true;
    rows = Math.max(rows, value.length);
    cols = Math.max(cols, value[0]?.length ?? 0);
  }
  if (!arrays) return f(values as Scalar[]);

  const result: Matrix = [];
  for (let r = 0; r < rows; r++) {
    const row: Scalar[] = [];
    for (let c = 0; c < cols; c++) {
      const picked = values.map((value): Scalar => {
        if (!isMatrix(value)) return value;
        const rr = value.length === 1 ? 0 : r;
        const cc = (value[0]?.length ?? 0) === 1 ? 0 : c;
        return rr < value.length && cc < value[rr].length ? value[rr][cc] : ERR.NA;
      });
      row.push(f(picked));
    }
    result.push(row);
  }
  return result;
}

/**
 * `run`, with the arguments at `positions` taken one cell at a time where any of them is an array of several cells:
 * `COUNTIF(A1:A5,A1:A5)` is five counts, `INDEX(B1:B5,{1,3})` is two cells. A reference to one cell is not an array.
 */
export function liftOver(args: (Value | undefined)[], positions: number[], run: (args: (Value | undefined)[]) => Value): Value {
  const arrays = positions.filter((position) => {
    const arg = args[position];
    return isMatrix(arg) && !(arg.length === 1 && arg[0].length === 1);
  });
  if (arrays.length === 0) return run(args);
  return broadcast(
    arrays.map((position) => args[position] as Value),
    (cells) =>
      attempt(() => {
        const copy = [...args];
        arrays.forEach((position, i) => (copy[position] = cells[i]));
        return scalarOf(run(copy));
      }),
  );
}

/** `f`, with a thrown error as its result: how the rules below stay short (`toNumber` throws `#VALUE!`). */
export function attempt(f: () => Scalar): Scalar {
  try {
    return f();
  } catch (error) {
    if (isError(error)) return error;
    throw error;
  }
}

/** A finite number, or `#NUM!`: what a result that overflowed is in Excel. */
export const finite = (value: number): Scalar => (Number.isFinite(value) ? value : ERR.NUM);

/** Every value of an array or range, row by row. */
export const flatten = (value: Value): Scalar[] => (isMatrix(value) ? value.flat() : [value]);

/**
 * The numbers in the arguments of `SUM` and its kind. In an array or a range, only numbers count (a text, a logical or a
 * blank is skipped); an argument given directly is read as a number (`SUM("3",TRUE)` is 4, `SUM("a")` is `#VALUE!`).
 * An error anywhere is thrown, the first in the order given.
 */
export function collectNumbers(args: readonly (Value | undefined)[]): number[] {
  const numbers: number[] = [];
  for (const arg of args) {
    if (arg === undefined) continue;
    if (isMatrix(arg)) {
      for (const row of arg)
        for (const cell of row) {
          if (isError(cell)) throw cell;
          if (typeof cell === "number") numbers.push(cell);
        }
    } else numbers.push(toNumber(arg));
  }
  return numbers;
}

/**
 * `base` to the power `exp`, with Excel's special cases: `0^0` is `#NUM!`, `0` to a negative power is `#DIV/0!`, and
 * a negative base with a fractional exponent has a real result only where the exponent is one over an odd number
 * (`(-8)^(1/3)` is -2, to 15 digits; `(-8)^0.5` is `#NUM!`).
 */
export function power(base: number, exp: number): Scalar {
  if (base === 0 && exp === 0) return ERR.NUM;
  if (base === 0 && exp < 0) return ERR.DIV0;
  if (base < 0 && !Number.isInteger(exp)) {
    const inverse = round15(1 / exp);
    if (!Number.isInteger(inverse) || Math.abs(inverse % 2) !== 1) return ERR.NUM;
    return finite(-(Math.abs(base) ** exp));
  }
  return finite(base ** exp);
}
