/**
 * The functions that pick cells out of a range (see sheetFunctions.ts): the criteria family (`COUNTIF`,
 * `SUMIFS`, `AVERAGEIFS`, `MAXIFS`...), the lookups (`VLOOKUP`, `HLOOKUP`, `INDEX`, `MATCH`, `XLOOKUP`) and
 * the functions that say where a cell is. Pure, shared with the terminal app.
 *
 * The matching rules, which a function library gets wrong, are Excel's and live in sheetCriteria.ts: text is
 * compared without regard to case, `*` and `?` stand for any text, and a number never equals a text that looks
 * like one, except for `COUNTIF` and its kind, where it does.
 */
import { type Criterion, hasWildcard, matchesPattern, parseCriterion } from "./sheetCriteria";
import { type EvalContext, type FunctionSpec, type Lazy, attempt, broadcast, dims, finite, liftOver, scalarOf, toMatrix } from "./sheetMatrix";
import {
  ERR,
  type Matrix,
  type Scalar,
  Unsupported,
  type Value,
  compareScalars,
  compareText,
  isError,
  isMatrix,
  round15,
  toBool,
  toNumber,
} from "./sheetValue";

const raw = (min: number, max: number, run: (args: (Value | undefined)[]) => Value): FunctionSpec => ({ kind: "raw", min, max, run });

/** A criterion given as a value: one cell's worth, since an array of criteria is not calculated. */
function criterionOf(value: Value | undefined): Criterion {
  if (isMatrix(value) && !(value.length === 1 && value[0].length === 1)) throw new Unsupported("an array of criteria");
  return parseCriterion(scalarOf(value));
}

const asRange = (value: Value | undefined): Matrix => {
  if (value === undefined) throw ERR.VALUE;
  return toMatrix(value);
};

/** A range and the test its cells must pass. */
type Condition = { range: Matrix; test: Criterion };

/** The conditions in `(range, criteria)` pairs, which must all be the same size, or `#VALUE!`. */
function conditions(args: (Value | undefined)[], like?: Matrix): Condition[] {
  const result: Condition[] = [];
  for (let i = 0; i < args.length; i += 2) result.push({ range: asRange(args[i]), test: criterionOf(args[i + 1]) });
  const shape = dims(like ?? result[0].range);
  if (result.some(({ range }) => dims(range).rows !== shape.rows || dims(range).cols !== shape.cols)) throw ERR.VALUE;
  return result;
}

/** Each place, row and column, where every condition holds. */
function forEachMatch(all: Condition[], visit: (r: number, c: number) => void) {
  const { rows, cols } = dims(all[0].range);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (all.every(({ range, test }) => test(range[r][c]))) visit(r, c);
}

/** The numbers in `values` at the places the conditions pick. An error in a place that matches is the result; in one that does not, it is passed over. */
function matchedNumbers(values: Matrix, all: Condition[]): number[] {
  if (dims(values).rows !== dims(all[0].range).rows || dims(values).cols !== dims(all[0].range).cols) throw ERR.VALUE;
  const numbers: number[] = [];
  forEachMatch(all, (r, c) => {
    const cell = values[r][c];
    if (isError(cell)) throw cell;
    if (typeof cell === "number") numbers.push(cell);
  });
  return numbers;
}

/** The places of the criteria among the arguments: every second one, from `first`. */
function criteriaAt(first: number, count: number): number[] {
  const positions: number[] = [];
  for (let i = first; i < count; i += 2) positions.push(i);
  return positions;
}

const conditionalAggregate = (aggregate: (numbers: number[]) => Scalar) =>
  raw(3, Infinity, (args) => {
    if (args.length % 2 === 0) throw new Unsupported("a function with a criteria that has no range");
    return liftOver(args, criteriaAt(2, args.length), (each) => {
      const all = conditions(each.slice(1), asRange(each[0]));
      return aggregate(matchedNumbers(asRange(each[0]), all));
    });
  });

/**
 * `SUMIF` and `AVERAGEIF`: the range to add up may be given smaller than the one tested (or start elsewhere), and
 * Excel lays it out again from its first cell, the size of the tested range, reading the sheet beyond it.
 */
const resized = (aggregate: (numbers: number[]) => Scalar): FunctionSpec => ({
  kind: "lazy",
  min: 2,
  max: 3,
  run: ([rangeArg, criteriaArg, valuesArg], context) => {
    const range = asRange(rangeArg.value());
    const criteria = criteriaArg.value();
    let values = range;
    if (valuesArg) {
      const node = valuesArg.node;
      const { rows, cols } = dims(range);
      values = node?.t === "ref" ? context.readRange(node.r1, node.c1, node.r1 + rows - 1, node.c1 + cols - 1) : asRange(valuesArg.value());
    }
    return broadcast([criteria], ([one]) => attempt(() => aggregate(matchedNumbers(values, [{ range, test: criterionOf(one) }]))));
  },
});

const sum = (numbers: number[]) => finite(numbers.reduce((total, n) => total + n, 0));

/** The kind of a value, since a lookup finds only what is of the same kind: a number is never a text. */
const kindOf = (value: Scalar) => (value === null ? "blank" : typeof value);

/** Whether a cell is the one a lookup key names: the same kind, equal; text with wildcards where `wildcards` is on. */
function exactMatch(cell: Scalar, key: Scalar, wildcards: boolean): boolean {
  if (isError(cell) || isError(key)) return isError(cell) && isError(key) && cell.code === key.code;
  if (kindOf(cell) !== kindOf(key)) return false;
  if (typeof key === "number") return round15(cell as number) === round15(key);
  if (typeof key === "string") return wildcards && hasWildcard(key) ? matchesPattern(key, cell as string) : compareText(cell as string, key) === 0;
  return cell === key;
}

/**
 * The place, from 0, of the last of `values` that is at most `key` (or at least, for `descending`), by the binary search
 * Excel uses, which assumes they are sorted: only values of the key's kind are looked at, and others are skipped.
 */
function approximate(values: Scalar[], key: Scalar, descending: boolean): number {
  const same: number[] = [];
  values.forEach((value, index) => {
    if (!isError(value) && kindOf(value) === kindOf(key)) same.push(index);
  });
  let low = 0;
  let high = same.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const order = compareScalars(values[same[middle]], key);
    if (descending ? order >= 0 : order <= 0) {
      found = same[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** `VLOOKUP` and `HLOOKUP`: the key down the first column (or across the first row), then across (or down) to the `index`th. */
function lookup(vertical: boolean) {
  return raw(3, 4, (all) =>
    liftOver(all, [0], (args) => {
      const key = scalarOf(args[0]);
      if (isError(key)) return key;
      const table = asRange(args[1]);
      const index = Math.trunc(toNumber(scalarOf(args[2])));
      const { rows, cols } = dims(table);
      if (index < 1) return ERR.VALUE;
      if (index > (vertical ? cols : rows)) return ERR.REF;
      const keys = vertical ? table.map((row) => row[0]) : table[0];
      const exact = args.length >= 4 && (args[3] === undefined || !toBool(scalarOf(args[3])));
      let found = -1;
      if (exact) found = keys.findIndex((cell) => exactMatch(cell, key, true));
      else found = approximate(keys, key, false);
      if (found < 0) return ERR.NA;
      return vertical ? table[found][index - 1] : table[index - 1][found];
    }),
  );
}

/** An array that is a single row or column, as a list; `undefined` for a table. */
function asVector(array: Matrix): Scalar[] | undefined {
  const { rows, cols } = dims(array);
  return rows === 1 ? array[0] : cols === 1 ? array.map((row) => row[0]) : undefined;
}

/** `XLOOKUP` finds the place; this is the one nearest to `key` that is smaller (`-1`) or larger (`1`), with ties to the first in the order searched. */
function nearest(values: Scalar[], order: number[], key: Scalar, direction: -1 | 1): number {
  let best = -1;
  for (const index of order) {
    const value = values[index];
    if (isError(value) || kindOf(value) !== kindOf(key)) continue;
    const side = compareScalars(value, key);
    if (side * direction <= 0) continue;
    if (best < 0 || compareScalars(value, values[best]) * direction < 0) best = index;
  }
  return best;
}

export const LOOKUP_FUNCTIONS: Record<string, FunctionSpec> = {
  COUNTIF: raw(2, 2, (args) =>
    liftOver(args, [1], ([range, criteria]) => {
      const test = criterionOf(criteria);
      return asRange(range)
        .flat()
        .filter((cell) => test(cell)).length;
    }),
  ),
  COUNTIFS: raw(2, Infinity, (args) => {
    if (args.length % 2 !== 0) throw new Unsupported("COUNTIFS with a range that has no criteria");
    return liftOver(args, criteriaAt(1, args.length), (each) => {
      let count = 0;
      forEachMatch(conditions(each), () => count++);
      return count;
    });
  }),
  SUMIF: resized(sum),
  SUMIFS: conditionalAggregate(sum),
  AVERAGEIF: resized((numbers) => (numbers.length === 0 ? ERR.DIV0 : finite(numbers.reduce((total, n) => total + n, 0) / numbers.length))),
  AVERAGEIFS: conditionalAggregate((numbers) => (numbers.length === 0 ? ERR.DIV0 : finite(numbers.reduce((total, n) => total + n, 0) / numbers.length))),
  MAXIFS: conditionalAggregate((numbers) => (numbers.length === 0 ? 0 : numbers.reduce((most, n) => Math.max(most, n)))),
  MINIFS: conditionalAggregate((numbers) => (numbers.length === 0 ? 0 : numbers.reduce((least, n) => Math.min(least, n)))),

  VLOOKUP: lookup(true),
  HLOOKUP: lookup(false),
  MATCH: raw(2, 3, (all) =>
    liftOver(all, [0], ([keyArg, arrayArg, typeArg]) => {
      const key = scalarOf(keyArg);
      if (isError(key)) return key;
      const values = asVector(asRange(arrayArg));
      if (!values) return ERR.NA;
      // The sign of the type says which way it is sorted; zero is an exact match.
      const type = typeArg === undefined ? 1 : Math.sign(toNumber(scalarOf(typeArg)));
      const found = type === 0 ? values.findIndex((cell) => exactMatch(cell, key, true)) : approximate(values, key, type < 0);
      return found < 0 ? ERR.NA : found + 1;
    }),
  ),
  INDEX: raw(2, 3, (all) =>
    liftOver(all, [1, 2], ([arrayArg, rowArg, columnArg]) => {
      const array = asRange(arrayArg);
      const { rows, cols } = dims(array);
      let row = Math.trunc(toNumber(scalarOf(rowArg)));
      let col: number;
      // With one row, the one number is the column; with one column (or a table and no column), it is the row.
      if (columnArg !== undefined) col = Math.trunc(toNumber(scalarOf(columnArg)));
      else if (rows === 1 && cols > 1) {
        col = row;
        row = 1;
      } else col = 0;
      if (row < 0 || col < 0) return ERR.VALUE;
      if (row > rows || col > cols) return ERR.REF;
      if (row > 0 && col > 0) return array[row - 1][col - 1];
      if (row > 0) return [array[row - 1]];
      if (col > 0) return array.map((cells) => [cells[col - 1]]);
      return array;
    }),
  ),
  XLOOKUP: raw(3, 6, (all) =>
    liftOver(all, [0], ([keyArg, lookupArg, returnArg, notFound, matchArg, searchArg]) => {
      const key = scalarOf(keyArg);
      if (isError(key)) return key;
      const lookupArray = asRange(lookupArg);
      const returned = asRange(returnArg);
      const values = asVector(lookupArray);
      if (!values) return ERR.VALUE;
      const horizontal = dims(lookupArray).rows === 1 && values.length > 1;
      if ((horizontal ? dims(returned).cols : dims(returned).rows) !== values.length) return ERR.VALUE;

      const mode = matchArg === undefined ? 0 : Math.trunc(toNumber(scalarOf(matchArg)));
      const search = searchArg === undefined ? 1 : Math.trunc(toNumber(scalarOf(searchArg)));
      if (![-1, 0, 1, 2].includes(mode) || ![-2, -1, 1, 2].includes(search)) return ERR.VALUE;
      if (Math.abs(search) === 2) throw new Unsupported("XLOOKUP by binary search");

      const order = values.map((_, index) => index);
      if (search === -1) order.reverse();
      let found = order.find((index) => exactMatch(values[index], key, mode === 2)) ?? -1;
      if (found < 0 && (mode === -1 || mode === 1)) found = nearest(values, order, key, mode);
      if (found < 0) return notFound === undefined ? ERR.NA : notFound;
      if (horizontal) {
        const column = returned.map((row) => row[found]);
        return column.length === 1 ? column[0] : column.map((cell) => [cell]);
      }
      return returned[found].length === 1 ? returned[found][0] : [returned[found]];
    }),
  ),

  ROW: positionOf((ref, context) => (ref ? Array.from({ length: ref.r2 - ref.r1 + 1 }, (_, i) => ref.r1 + i + 1) : [context.row + 1]), true),
  COLUMN: positionOf((ref, context) => (ref ? Array.from({ length: ref.c2 - ref.c1 + 1 }, (_, i) => ref.c1 + i + 1) : [context.col + 1]), false),
  ROWS: raw(1, 1, ([array]) => dims(asRange(array)).rows),
  COLUMNS: raw(1, 1, ([array]) => dims(asRange(array)).cols),
};

type Reference = { r1: number; c1: number; r2: number; c2: number };

/** `ROW` and `COLUMN`: where a reference is, or where this cell is; a range is a list of them. */
function positionOf(positions: (ref: Reference | undefined, context: EvalContext) => number[], down: boolean): FunctionSpec {
  return {
    kind: "lazy",
    min: 0,
    max: 1,
    run: (args: Lazy[], context) => {
      const node = args[0]?.node;
      const ref = node?.t === "ref" ? node : undefined;
      if (args.length > 0 && !ref) return ERR.VALUE;
      if (ref && (ref.r2 === Infinity || ref.c2 === Infinity)) throw new Unsupported("ROW or COLUMN of a whole column or row");
      const list = positions(ref, context);
      if (list.length === 1) return list[0];
      return down ? list.map((n) => [n]) : [list];
    },
  };
}
