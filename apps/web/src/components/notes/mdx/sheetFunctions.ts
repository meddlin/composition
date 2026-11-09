/**
 * The functions a formula can call, and the table that finds them by name. Pure, shared with the terminal app.
 *
 * This file holds the numbers and the logic: sums and counts, rounding, `IF` and its kind, the `IS` tests. The
 * text and date functions are in sheetFunctionsText.ts, the criteria family and the lookups in
 * sheetFunctionsLookup.ts. A function not in the table is not calculated: the cell shows `#NAME?` and says which.
 *
 * Every function here was checked against real Excel (spikes/sheet/excel-verified-cases.json). Where Excel does
 * something odd it is on purpose, and the comment says what (`AND(TRUE,"a")` ignores the text).
 */
import { DATE_FUNCTIONS, TEXT_FUNCTIONS } from "./sheetFunctionsText";
import { LOOKUP_FUNCTIONS } from "./sheetFunctionsLookup";
import { type FunctionSpec, type Lazy, attempt, broadcast, collectNumbers, finite, flatten, liftOver, power, scalarOf, toMatrix } from "./sheetMatrix";
import {
  ERR,
  ERROR_ORDER,
  type Scalar,
  type SheetError,
  type Value,
  Unsupported,
  compareScalars,
  isError,
  isMatrix,
  logicalText,
  parseNumberText,
  round15,
  roundDigits,
  snapToZero,
  toBool,
  toNumber,
} from "./sheetValue";

const scalar = (min: number, max: number, run: (args: Scalar[]) => Scalar, errors?: "pass"): FunctionSpec => ({ kind: "scalar", min, max, run, errors });
const raw = (min: number, max: number, run: (args: (Value | undefined)[]) => Value): FunctionSpec => ({ kind: "raw", min, max, run });
const lazy = (min: number, max: number, run: Extract<FunctionSpec, { kind: "lazy" }>["run"]): FunctionSpec => ({ kind: "lazy", min, max, run });

/** One number in, one out. */
const math1 = (f: (n: number) => Scalar) => scalar(1, 1, ([x]) => f(toNumber(x)));
/** A test of what a value is, which an error is an answer to and not a failure of. */
const test = (f: (value: Scalar) => boolean) => scalar(1, 1, ([x]) => f(x), "pass");

const rounding = (mode: "nearest" | "up" | "down") => scalar(2, 2, ([n, digits]) => roundDigits(toNumber(n), Math.trunc(toNumber(digits)), mode));

/** The sum, whose last addition is the one Excel snaps to zero when it is only rounding noise (`SUM(0.1,0.2,-0.3)` is 0). */
function sum(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < numbers.length - 1; i++) total += numbers[i];
  return numbers.length === 1 ? numbers[0] : snapToZero(total, numbers[numbers.length - 1], total + numbers[numbers.length - 1]);
}

/** `CEILING` and `FLOOR`: to a multiple of `step`. The quotient is cut to 15 digits first, as Excel does, or `FLOOR(0.6,0.2)` would be 0.4. */
function toMultiple(direction: "up" | "down", n: number, step: number): Scalar {
  if (step === 0) return direction === "up" ? 0 : ERR.DIV0;
  if (n > 0 && step < 0) return ERR.NUM;
  const quotient = round15(n / step);
  return finite((direction === "up" ? Math.ceil(quotient) : Math.floor(quotient)) * step);
}

/** Each argument's logical values, for `AND` and `OR`: numbers and logicals count, and so do the texts `TRUE` and `FALSE`; other text and blanks are skipped. */
function logicals(args: (Value | undefined)[]): boolean[] | SheetError {
  const values: boolean[] = [];
  for (const arg of args) {
    if (arg === undefined) continue;
    for (const cell of flatten(arg)) {
      if (isError(cell)) return cell;
      if (typeof cell === "boolean") values.push(cell);
      else if (typeof cell === "number") values.push(cell !== 0);
      else if (typeof cell === "string" && !isMatrix(arg)) {
        const flag = logicalText(cell);
        if (flag !== undefined) values.push(flag);
      }
    }
  }
  return values;
}

const connective = (combine: (values: boolean[]) => boolean) =>
  raw(1, Infinity, (args) => {
    const values = logicals(args);
    if (isError(values)) return values;
    return values.length === 0 ? ERR.VALUE : combine(values);
  });

/** `IF`, over an array condition, picks element by element, and calculates both branches to do it. */
const IF = lazy(2, 3, ([condition, yes, no]) => {
  const result = condition.value();
  const branch = (value: Lazy | undefined): Value => (value ? value.value() : false);
  if (!isMatrix(result)) {
    if (isError(result)) return result;
    return branch(toBool(result) ? yes : no);
  }
  return broadcast([result, branch(yes), branch(no)], ([cond, a, b]) => {
    if (isError(cond)) return cond;
    return attempt(() => (toBool(cond) ? a : b));
  });
});

const isNA = (value: Scalar) => isError(value) && value.code === "#N/A";
/** `IFERROR` and `IFNA`: the second argument where the first is an error (every error, or only `#N/A`); element by element for an array. */
const recover = (applies: (value: Scalar) => boolean) =>
  lazy(2, 2, ([value, fallback]) => {
    const result = value.value();
    if (isMatrix(result)) return broadcast([result, fallback.value()], ([x, y]) => (applies(x) ? y : x));
    return applies(result as Scalar) ? fallback.value() : result;
  });

/** The statistics of the numbers in some arguments: sorted, for the order functions. */
const sortedNumbers = (args: (Value | undefined)[]) => collectNumbers(args).sort((a, b) => a - b);

const rank = (value: number, numbers: number[], ascending: boolean) =>
  1 + numbers.filter((n) => (ascending ? round15(n) < round15(value) : round15(n) > round15(value))).length;

const numericTextCounts = (text: string) => {
  try {
    return parseNumberText(text) !== null;
  } catch (error) {
    if (error instanceof Unsupported) throw error;
    return false;
  }
};

export const FUNCTIONS: Record<string, FunctionSpec> = {
  // Sums and counts.
  SUM: raw(1, Infinity, (args) => {
    const numbers = collectNumbers(args);
    return finite(sum(numbers));
  }),
  PRODUCT: raw(1, Infinity, (args) => {
    const numbers = collectNumbers(args);
    return numbers.length === 0 ? 0 : finite(numbers.reduce((product, n) => product * n, 1));
  }),
  SUMPRODUCT: raw(1, Infinity, (args) => {
    const arrays = args.map((arg) => toMatrix(arg ?? 0));
    const { length: rows } = arrays[0];
    const cols = arrays[0][0]?.length ?? 0;
    if (arrays.some((array) => array.length !== rows || (array[0]?.length ?? 0) !== cols)) return ERR.VALUE;
    let total = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let product = 1;
        for (const array of arrays) {
          const cell = array[r][c];
          if (isError(cell)) return cell;
          product *= typeof cell === "number" ? cell : 0;
        }
        total += product;
      }
    return finite(total);
  }),
  AVERAGE: raw(1, Infinity, (args) => {
    const numbers = collectNumbers(args);
    return numbers.length === 0 ? ERR.DIV0 : finite(sum(numbers) / numbers.length);
  }),
  MIN: raw(1, Infinity, (args) => {
    const numbers = collectNumbers(args);
    return numbers.length === 0 ? 0 : numbers.reduce((least, n) => Math.min(least, n));
  }),
  MAX: raw(1, Infinity, (args) => {
    const numbers = collectNumbers(args);
    return numbers.length === 0 ? 0 : numbers.reduce((most, n) => Math.max(most, n));
  }),
  COUNT: raw(1, Infinity, (args) => {
    let count = 0;
    for (const arg of args) {
      if (arg === undefined) continue;
      if (isMatrix(arg)) count += arg.flat().filter((cell) => typeof cell === "number").length;
      else if (typeof arg === "number" || typeof arg === "boolean") count++;
      else if (typeof arg === "string" && numericTextCounts(arg)) count++;
    }
    return count;
  }),
  COUNTA: raw(1, Infinity, (args) =>
    args.reduce<number>((count, arg) => count + (arg === undefined ? 0 : flatten(arg).filter((cell) => cell !== null).length), 0),
  ),
  COUNTBLANK: raw(1, 1, ([range]) => flatten(range ?? null).filter((cell) => cell === null || cell === "").length),
  LARGE: raw(2, 2, (all) =>
    liftOver(all, [1], ([array, k]) => {
      const numbers = sortedNumbers([array]);
      const n = Math.trunc(toNumber(scalarOf(k)));
      return n < 1 || n > numbers.length ? ERR.NUM : numbers[numbers.length - n];
    }),
  ),
  SMALL: raw(2, 2, (all) =>
    liftOver(all, [1], ([array, k]) => {
      const numbers = sortedNumbers([array]);
      const n = Math.trunc(toNumber(scalarOf(k)));
      return n < 1 || n > numbers.length ? ERR.NUM : numbers[n - 1];
    }),
  ),
  MEDIAN: raw(1, Infinity, (args) => {
    const numbers = sortedNumbers(args);
    if (numbers.length === 0) return ERR.NUM;
    const middle = numbers.length >> 1;
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  }),
  RANK: raw(2, 3, ([value, ref, order]) => {
    if (!isMatrix(ref)) return ERR.VALUE;
    const target = toNumber(scalarOf(value));
    const numbers = collectNumbers([ref]);
    if (!numbers.some((n) => round15(n) === round15(target))) return ERR.NA;
    return rank(target, numbers, order !== undefined && toNumber(scalarOf(order)) !== 0);
  }),

  // Numbers.
  ABS: math1((n) => Math.abs(n)),
  SIGN: math1((n) => Math.sign(n) || 0),
  INT: math1((n) => Math.floor(n)),
  SQRT: math1((n) => (n < 0 ? ERR.NUM : Math.sqrt(n))),
  EXP: math1((n) => finite(Math.exp(n))),
  LN: math1((n) => (n <= 0 ? ERR.NUM : Math.log(n))),
  LOG10: math1((n) => (n <= 0 ? ERR.NUM : Math.log10(n))),
  LOG: scalar(1, 2, ([x, base]) => {
    const n = toNumber(x);
    const b = base === undefined || base === null ? 10 : toNumber(base);
    if (n <= 0 || b <= 0) return ERR.NUM;
    return b === 1 ? ERR.DIV0 : Math.log(n) / Math.log(b);
  }),
  PI: scalar(0, 0, () => Math.PI),
  POWER: scalar(2, 2, ([a, b]) => power(toNumber(a), toNumber(b))),
  MOD: scalar(2, 2, ([n, d]) => {
    const divisor = toNumber(d);
    if (divisor === 0) return ERR.DIV0;
    const dividend = toNumber(n);
    // The remainder is the one `%` gives, with the sign of the divisor: `MOD(1,0.1)` is 0.1 (to 15 digits), as in Excel.
    const remainder = dividend % divisor;
    return remainder !== 0 && remainder < 0 !== divisor < 0 ? remainder + divisor : remainder;
  }),
  ROUND: rounding("nearest"),
  ROUNDUP: rounding("up"),
  ROUNDDOWN: rounding("down"),
  TRUNC: scalar(1, 2, ([n, digits]) => roundDigits(toNumber(n), Math.trunc(toNumber(digits ?? 0)), "down")),
  CEILING: scalar(2, 2, ([n, step]) => toMultiple("up", toNumber(n), toNumber(step))),
  FLOOR: scalar(2, 2, ([n, step]) => toMultiple("down", toNumber(n), toNumber(step))),

  // Logic.
  IF,
  IFERROR: recover(isError),
  IFNA: recover(isNA),
  IFS: lazy(2, Infinity, (args) => {
    if (args.length % 2 !== 0) throw new Unsupported("IFS with an argument that has no pair");
    for (let i = 0; i < args.length; i += 2) {
      const condition = args[i].value();
      if (isMatrix(condition)) throw new Unsupported("IFS over an array");
      if (isError(condition)) return condition;
      if (toBool(condition)) return args[i + 1].value();
    }
    return ERR.NA;
  }),
  SWITCH: lazy(3, Infinity, (args) => {
    const target = scalarOf(args[0].value());
    if (isError(target)) return target;
    for (let i = 1; i + 1 < args.length; i += 2) {
      const candidate = scalarOf(args[i].value());
      if (!isError(candidate) && compareScalars(target, candidate) === 0) return args[i + 1].value();
    }
    return args.length % 2 === 0 ? args[args.length - 1].value() : ERR.NA;
  }),
  CHOOSE: lazy(2, Infinity, ([index, ...choices]) => {
    const picked = scalarOf(index.value());
    if (isError(picked)) return picked;
    const n = Math.trunc(toNumber(picked));
    return n < 1 || n > choices.length ? ERR.VALUE : choices[n - 1].value();
  }),
  AND: connective((values) => values.every(Boolean)),
  OR: connective((values) => values.some(Boolean)),
  NOT: scalar(1, 1, ([x]) => !toBool(x)),
  TRUE: scalar(0, 0, () => true),
  FALSE: scalar(0, 0, () => false),
  NA: scalar(0, 0, () => ERR.NA),

  // What a value is.
  ISBLANK: test((value) => value === null),
  ISNUMBER: test((value) => typeof value === "number"),
  ISTEXT: test((value) => typeof value === "string"),
  ISLOGICAL: test((value) => typeof value === "boolean"),
  ISERROR: test(isError),
  ISERR: test((value) => isError(value) && !isNA(value)),
  ISNA: test(isNA),
  "ERROR.TYPE": scalar(1, 1, ([value]) => (isError(value) ? ERROR_ORDER.indexOf(value) + 1 : ERR.NA), "pass"),

  ...TEXT_FUNCTIONS,
  ...DATE_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
};
