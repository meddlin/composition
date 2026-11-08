import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type FormulaResult, evaluate } from "./sheetFormula";
import { parseAddress } from "./sheetParse";
import { type Scalar, isError, numberToText } from "./sheetValue";

/**
 * The engine against real Excel: every case in spikes/sheet/excel-verified-cases.json was entered in Microsoft Excel
 * by spikes/sheet/run-in-excel.mjs, and `excel` is what Excel returned. Each formula is calculated here, in a sheet
 * of the file's `cells`, and must give the same. To add a case, add it to the file and run that script.
 */
type Expected = number | string | boolean | { error: string };
type Spec = {
  cells: Record<string, number | boolean | string | { text: string } | { formula: string }>;
  ranges: Record<string, string>;
  cases: { label: string; formula: string; excel?: Expected }[];
};

const spec: Spec = JSON.parse(readFileSync(new URL("../../../../../../spikes/sheet/excel-verified-cases.json", import.meta.url), "utf8"));

/**
 * What Excel does that this engine does not calculate, by design: the cell says so (`unsupported`) and the caller
 * shows Excel's own value. Each is a text, a format or a mode this engine does not read; none is a wrong answer.
 */
const NOT_CALCULATED = new Map<string, string>([
  ['"€5"+0', "a currency other than $"],
  ['TEXT(0.5,"# ?/?")', "a fraction format"],
  ['TEXT(5,"[>3]0;0")', "a condition in a format"],
  ['TEXT(0.5,"hh:mm")', "a time format"],
  ['TEXT(12345,"0.00E+00")', "E notation in a format"],
  ['TEXT(1000000,"#,##0,")', "a scale by thousands"],
  ['COUNT("1/2/2026")', "a date written as text"],
  ["XLOOKUP(30,B1:B5,A1:A5,,0,2)", "binary search"],
]);

const expand = (formula: string) => formula.replace(/\{(\w+)\}/g, (_, name) => spec.ranges[name].replace(/\$/g, ""));

const cells: Scalar[][] = [];
const formulas = new Map<string, string>();
for (const [address, cell] of Object.entries(spec.cells)) {
  const at = parseAddress(address) as { row: number; col: number };
  while (cells.length <= at.row) cells.push([]);
  const row = cells[at.row];
  while (row.length <= at.col) row.push(null);
  if (typeof cell === "object" && "formula" in cell) formulas.set(address, cell.formula);
  else row[at.col] = typeof cell === "object" ? cell.text : cell;
}
const RESULT_COLUMN = "AY";
spec.cases.forEach(({ formula }, index) => formulas.set(`${RESULT_COLUMN}${index + 1}`, `=${expand(formula)}`));

const results = evaluate(cells, formulas);

function describeResult(result: FormulaResult) {
  return result.unsupported.length > 0
    ? `not calculated: ${result.unsupported.join("; ")}`
    : isError(result.value)
      ? result.value.code
      : JSON.stringify(result.value);
}

describe("the formula engine against Excel", () => {
  it("has the cases to check", () => {
    expect(spec.cases.length).toBeGreaterThan(900);
    expect(spec.cases.every((c) => c.excel !== undefined)).toBe(true);
  });

  it.each(spec.cases.map((c, index) => ({ ...c, index })))("$label: $formula", ({ formula, excel, index }) => {
    const result = results.get(`${RESULT_COLUMN}${index + 1}`) as FormulaResult;
    const reason = NOT_CALCULATED.get(formula);
    if (reason !== undefined) {
      // Said, not guessed: the cell is #NAME? and names what it could not do.
      expect(result.unsupported.length, `expected "${reason}" to be reported, got ${describeResult(result)}`).toBeGreaterThan(0);
      return;
    }
    expect(result.unsupported, "the engine says it cannot calculate this").toEqual([]);
    const expected = excel as Expected;
    if (typeof expected === "object") {
      expect(isError(result.value) ? result.value.code : `a value: ${describeResult(result)}`).toBe(expected.error);
    } else if (typeof expected === "number") {
      expect(typeof result.value === "number" ? numberToText(result.value) : describeResult(result)).toBe(numberToText(expected));
    } else expect(result.value).toBe(expected);
  });
});
