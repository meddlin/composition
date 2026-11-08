import { describe, expect, it } from "vitest";
import { parseSheet } from "./sheetData";
import { calculate, evaluate, evaluateSheet, formatValue, typeCell } from "./sheetFormula";
import { parseFormula } from "./sheetParse";
import { ERR, type Scalar, isError } from "./sheetValue";

/** One formula in a sheet of `cells`, at ZZ1 unless given, and what it came to. */
function calc(formula: string, cells: Scalar[][] = [], at = "ZZ1") {
  const result = evaluate(cells, new Map([[at, formula]])).get(at.toUpperCase());
  if (!result) throw new Error("no result");
  return result;
}
const value = (formula: string, cells?: Scalar[][]) => calc(formula, cells).value;

describe("evaluate", () => {
  it("calculates formulas that refer to cells and ranges, written with or without the leading =", () => {
    const cells: Scalar[][] = [
      [1, 2],
      [3, 4],
    ];
    expect(value("=A1+B2", cells)).toBe(5);
    expect(value("SUM(A1:B2)", cells)).toBe(10);
    expect(value("=$A$2*B$1", cells)).toBe(6);
  });

  it("gives every formula's result by its address, in capitals and without dollars", () => {
    const results = evaluate(
      [[10]],
      new Map([
        ["c1", "=A1*2"],
        ["$D$2", "=C1+1"],
      ]),
    );

    expect([...results.keys()].sort()).toEqual(["C1", "D2"]);
    expect(results.get("C1")?.value).toBe(20);
    expect(results.get("D2")?.value).toBe(21);
  });

  it("ignores a formula whose address is not one", () => {
    expect(evaluate([], new Map([["not an address", "=1"]])).size).toBe(0);
  });

  it("calculates in the order the formulas need, whatever order the sheet has them in", () => {
    const results = evaluate(
      [],
      new Map([
        ["A1", "=B1+1"],
        ["B1", "=C1*2"],
        ["C1", "=5"],
      ]),
    );

    expect(results.get("A1")?.value).toBe(11);
  });

  it("never gives a blank or an array: a blank result is 0, and a formula that fills several cells is not calculated", () => {
    expect(value("=A1", [[null]])).toBe(0);
    const spill = calc("=A1:A2", [[1], [2]]);
    expect(isError(spill.value)).toBe(true);
    expect(spill.unsupported).toEqual(["a formula that fills several cells"]);
    expect(value("=INDEX(A1:A1,0)", [[7]])).toBe(7);
  });

  it("reads the functions' Excel prefixes the way a workbook writes them", () => {
    expect(
      value("=_xlfn.XLOOKUP(2,A1:A3,B1:B3)", [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ]),
    ).toBe("b");
    expect(value("=_xlfn._xlws.SORT(A1)")).toBeDefined();
    expect(calc("=_xlfn._xlws.SORT(A1)").unsupported).toEqual(["the function SORT"]);
  });

  it("gives ROW and COLUMN of the cell the formula is in when no cell is named", () => {
    const results = evaluate(
      [],
      new Map([
        ["C4", "=ROW()"],
        ["D5", "=COLUMN()"],
      ]),
    );

    expect(results.get("C4")?.value).toBe(4);
    expect(results.get("D5")?.value).toBe(4);
  });

  it("takes a whole column to run to the end of what the sheet holds, and a formula in the column is part of it", () => {
    const cells: Scalar[][] = [[1], [2], [3]];

    expect(value("=SUM(A:A)", cells)).toBe(6);
    const results = evaluate(
      cells,
      new Map([
        ["A4", "=A1+10"],
        ["B1", "=SUM(A:A)"],
      ]),
    );
    expect(results.get("B1")?.value).toBe(17);
  });

  it("refuses a range of millions of cells instead of trying it", () => {
    const result = calc("=SUM(A1:XFD1048576)");

    expect(result.unsupported).toEqual(["a range of more than 5 million cells"]);
  });
});

describe("what it does not calculate", () => {
  it("makes the cell #NAME? and says which function it lacked, never a guess", () => {
    const result = calc("=FILTER(A1:A3,A1:A3>1)", [[1], [2], [3]]);

    expect(result.value).toBe(ERR.NAME);
    expect(result.unsupported).toEqual(["the function FILTER"]);
  });

  it("carries the flag to every cell that depends on it, through a cell and through a range", () => {
    const results = evaluate(
      [[1]],
      new Map([
        ["B1", "=FILTER(A1,TRUE)"],
        ["C1", "=B1+1"],
        ["D1", "=SUM(B1:C1)"],
        ["E1", "=A1+1"],
      ]),
    );

    expect(results.get("C1")?.unsupported).toEqual(["the function FILTER"]);
    expect(results.get("D1")?.unsupported).toEqual(["the function FILTER"]);
    expect(results.get("E1")).toEqual({ value: 2, unsupported: [] });
  });

  it("does not let IFERROR hide a function it lacks, which Excel would have calculated", () => {
    const result = calc("=IFERROR(FILTER(A1,TRUE),0)", [[1]]);

    expect(result.unsupported).toEqual(["the function FILTER"]);
  });

  it("says so for a name, another sheet, a table's column, a text read as a date, and a function with the wrong number of arguments", () => {
    expect(calc("=Rate*2").unsupported).toEqual(["the name Rate"]);
    expect(calc("=Sheet2!A1+1").unsupported).toEqual(["a reference to another sheet"]);
    expect(calc("='Q3 budget'!A1:B2").unsupported).toEqual(["a reference to another sheet"]);
    expect(calc("=SUM(Table1[Revenue])").unsupported).toEqual(["a table's column reference"]);
    expect(calc('="1/2/2026"+1').unsupported).toEqual(["the text “1/2/2026” read as a date or a currency"]);
    expect(calc("=ROUND(1)").unsupported).toEqual(["ROUND with 1 arguments"]);
  });

  it("says so for a formula it cannot read, with where", () => {
    expect(calc("=1+").unsupported).toEqual(["a formula this engine cannot read (a formula that stops too soon)"]);
    expect(calc("=(1+2").unsupported[0]).toContain("cannot read");
    expect(calc('="open').unsupported[0]).toContain("cannot read");
    expect(calc("=1 2").unsupported[0]).toContain("cannot read");
    expect(calc("=").unsupported[0]).toContain("an empty formula");
  });

  it("makes a circular reference #NAME? with a reason, and leaves the cells that do not depend on it alone", () => {
    const results = evaluate(
      [],
      new Map([
        ["A1", "=B1+1"],
        ["B1", "=A1+1"],
        ["C1", "=A1*2"],
        ["D1", "=1+1"],
        ["E1", "=E1+1"],
      ]),
    );

    expect(results.get("A1")?.unsupported).toContain("a formula that refers to itself");
    expect(results.get("B1")?.unsupported).toContain("a formula that refers to itself");
    expect(results.get("C1")?.unsupported).toContain("a formula that refers to itself");
    expect(results.get("E1")?.unsupported).toEqual(["a formula that refers to itself"]);
    expect(results.get("D1")).toEqual({ value: 2, unsupported: [] });
  });

  it("finds a circle that runs through a range", () => {
    const results = evaluate([[1]], new Map([["A2", "=SUM(A1:A3)"]]));

    expect(results.get("A2")?.unsupported).toEqual(["a formula that refers to itself"]);
  });
});

describe("what is safe", () => {
  it("calculates a running total down 5,000 rows, and one that has to look down it, without running out of stack", () => {
    const down = new Map<string, string>([["A1", "=1"]]);
    const up = new Map<string, string>([["A5000", "=1"]]);
    for (let row = 2; row <= 5000; row++) down.set(`A${row}`, `=A${row - 1}+1`);
    for (let row = 1; row < 5000; row++) up.set(`A${row}`, `=A${row + 1}+1`);

    expect(evaluate([], down).get("A5000")?.value).toBe(5000);
    expect(evaluate([], up).get("A1")?.value).toBe(5000);
  });

  it("calculates a SUMIFS in each of 5,000 rows over 5,000 rows, reading each range once", () => {
    const cells: Scalar[][] = Array.from({ length: 5000 }, (_, i) => [i % 7 === 0 ? "a" : "b", i]);
    const formulas = new Map<string, string>();
    for (let row = 1; row <= 5000; row++) formulas.set(`C${row}`, '=SUMIFS($B$1:$B$5000,$A$1:$A$5000,"a")');

    const results = evaluate(cells, formulas);

    // 0 + 7 + 14 + ... up to 4998: 715 terms of 7 * (0..714).
    expect(results.get("C5000")?.value).toBe((7 * 714 * 715) / 2);
  });

  it("stops a formula nested past Excel's 64 levels, or with 64 signs in a row, or longer than 8,192 characters, before it can overflow the stack", () => {
    expect(value(`=${"(".repeat(60)}1${")".repeat(60)}`)).toBe(1);
    expect(calc(`=${"(".repeat(200)}1${")".repeat(200)}`).unsupported[0]).toContain("64 levels of nesting");
    expect(calc(`=${"ABS(".repeat(100)}1${")".repeat(100)}`).unsupported[0]).toContain("64 levels of nesting");
    expect(calc(`=${"-".repeat(100)}1`).unsupported[0]).toContain("64 signs");
    expect(calc(`=${"1+".repeat(5000)}1`).unsupported[0]).toContain("8,192 characters");
    expect(value(`=${"-".repeat(60)}1`)).toBe(1);
  });

  it("calculates a sum of 4,000 terms written out, which is nearly as long as a formula can be", () => {
    expect(value(`=${"1+".repeat(4000)}1`)).toBe(4001);
  });
});

describe("the parser", () => {
  it("keeps Excel's precedence and associativity", () => {
    expect(value("=2+3*4^2/8-1")).toBe(7);
    expect(value("=-2^2")).toBe(4);
    expect(value("=2^3^2")).toBe(64);
    expect(value("=50%^2")).toBe(0.25);
    expect(value("=1+2&3+4")).toBe("37");
    expect(value("=1<2=TRUE")).toBe(true);
  });

  it("reads texts with doubled quotes, the error literals, and booleans in any case", () => {
    expect(value('="say ""hi"""')).toBe('say "hi"');
    expect(value("=#N/A")).toBe(ERR.NA);
    expect(isError(value("=IFERROR(#DIV/0!,1)"))).toBe(false);
    expect(value("=true")).toBe(true);
  });

  it("reads array constants, with rows and columns", () => {
    expect(value("=SUM({1,2;3,4})")).toBe(10);
    expect(value("=INDEX({1,2;3,4},2,1)")).toBe(3);
    expect(value("=SUM({-1,-2})")).toBe(-3);
    expect(calc("=SUM({1,2;3})").unsupported[0]).toContain("cannot read");
  });

  it("reads references in every form Excel writes them", () => {
    expect(parseFormula("B$7")).toEqual({ t: "ref", r1: 6, c1: 1, r2: 6, c2: 1, range: false });
    expect(parseFormula("$B7:D$9")).toEqual({ t: "ref", r1: 6, c1: 1, r2: 8, c2: 3, range: true });
    expect(parseFormula("D9:B7")).toEqual({ t: "ref", r1: 6, c1: 1, r2: 8, c2: 3, range: true });
    expect(parseFormula("$B:$D")).toEqual({ t: "ref", r1: 0, c1: 1, r2: Infinity, c2: 3, range: true });
    expect(parseFormula("3:5")).toEqual({ t: "ref", r1: 2, c1: 0, r2: 4, c2: Infinity, range: true });
  });

  it("tells LOG10(…) from the cell LOG10", () => {
    expect(value("=LOG10(1000)")).toBe(3);
    expect(parseFormula("LOG10")).toEqual({ t: "ref", r1: 9, c1: 8508, r2: 9, c2: 8508, range: false });
  });

  it("does not take a column past XFD or a row past 1,048,576 for a cell", () => {
    expect(parseFormula("XFE1")).toEqual({ t: "unsupported", reason: "the name XFE1" });
    expect(parseFormula("A1048577")).toEqual({ t: "unsupported", reason: "the name A1048577" });
  });

  it("keeps the parentheses it was given, since Excel treats =(0.1+0.2-0.3) and =0.1+0.2-0.3 differently", () => {
    expect(value("=0.1+0.2-0.3")).toBe(0);
    expect(value("=(0.1+0.2-0.3)")).not.toBe(0);
  });

  it("reads an argument left out", () => {
    expect(parseFormula("ROUND(2.5,)")).toEqual({ t: "call", name: "ROUND", args: [{ t: "num", v: 2.5 }, null] });
    expect(parseFormula("PI()")).toEqual({ t: "call", name: "PI", args: [] });
  });
});

describe("typeCell", () => {
  it("reads a cell of the CSV block as Excel would read it typed in", () => {
    expect(typeCell("")).toBeNull();
    expect(typeCell("120")).toBe(120);
    expect(typeCell("-3.5")).toBe(-3.5);
    expect(typeCell("1,234.5")).toBe(1234.5);
    expect(typeCell("12%")).toBe(0.12);
    expect(typeCell("$5")).toBe(5);
    expect(typeCell("1e3")).toBe(1000);
    expect(typeCell("TRUE")).toBe(true);
    expect(typeCell("FALSE")).toBe(false);
    expect(typeCell("#N/A")).toBe(ERR.NA);
    expect(typeCell("West")).toBe("West");
  });

  it("leaves text that is not a plain number as text, so an identifier keeps its zeros and another date is not guessed at", () => {
    expect(typeCell("007")).toBe("007");
    expect(typeCell("1/2/2026")).toBe("1/2/2026");
    expect(typeCell("true")).toBe("true");
    expect(typeCell("12 units")).toBe("12 units");
    expect(typeCell("1 2")).toBe("1 2");
  });

  it("reads a date written 2026-03-04 as that date, the days since 1900, as Excel does a date typed in", () => {
    expect(typeCell("2026-03-04")).toBe(46085);
    expect(typeCell("2026-3-4")).toBe(46085);
    expect(typeCell(" 2026-03-04 ")).toBe(46085);
    expect(typeCell("1900-01-01")).toBe(1);
    expect(typeCell("1900-02-29")).toBe(60); // Excel's 29 February 1900, which was not a day
    expect(typeCell("9999-12-31")).toBe(2958465);
  });

  it("leaves what is not a date as text: a day the month does not have, a year before 1900, a time", () => {
    for (const text of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-03-00", "1899-12-31", "2026-03-04 10:30", "26-03-04", "2026-03"]) {
      expect(typeCell(text)).toBe(text);
    }
  });

  it("lets a formula calculate with a date written in a cell", () => {
    const sheet = { rows: [["Start", "Days", "End"], ["2026-03-04", "30", ""]], columns: 3 };
    const { results } = calculate(sheet, new Map([["C2", "=A2+B2"]]));
    expect(results.get("C2")?.value).toBe(46115);
    expect(calculate(sheet, new Map([["C2", "=TEXT(A2,\"yyyy-mm-dd\")"]])).sheet.rows[1][2]).toBe("2026-03-04");
  });
});

describe("evaluateSheet", () => {
  const sheet = (csv: string) => {
    const parsed = parseSheet(csv);
    if (!parsed.sheet) throw new Error(parsed.error);
    return parsed.sheet;
  };

  it("calculates formulas over a sheet's CSV values, the header being row 1", () => {
    const results = evaluateSheet(
      sheet("Region,Units,Price,Revenue\nWest,120,9.5,\nEast,80,9.5,\nTotal,200,,"),
      new Map([
        ["D2", "=B2*C2"],
        ["D3", "=B3*C3"],
        ["D4", "=SUM(D2:D3)"],
      ]),
    );

    expect(results.get("D2")?.value).toBe(1140);
    expect(results.get("D4")?.value).toBe(1900);
  });

  it("reads a text that looks like a number in the CSV as a number, and a blank as nothing", () => {
    const results = evaluateSheet(
      sheet("a,b\n1,\n2,x"),
      new Map([
        ["C1", "=COUNT(A:A)"],
        ["C2", "=COUNTA(B:B)"],
        ["C3", "=COUNTBLANK(B1:B3)"],
      ]),
    );

    expect(results.get("C1")?.value).toBe(2);
    expect(results.get("C2")?.value).toBe(2);
    expect(results.get("C3")?.value).toBe(1);
  });
});

describe("calculate", () => {
  const sheet = (csv: string) => {
    const parsed = parseSheet(csv);
    if (!parsed.sheet) throw new Error(parsed.error);
    return parsed.sheet;
  };

  it("is the sheet with each formula's cell showing its result, and what each came to", () => {
    const { sheet: grid, results } = calculate(sheet("a,b\n2,"), new Map([["B2", "=A2*10"]]));

    expect(grid).toEqual({
      rows: [
        ["a", "b"],
        ["2", "20"],
      ],
      columns: 2,
    });
    expect(results.get("B2")?.value).toBe(20);
  });

  it("adds the rows and the columns a formula is in, as a totals row of nothing else has no row of its own in the CSV", () => {
    const { sheet: grid } = calculate(
      sheet("a,b\n2,3"),
      new Map([
        ["A3", "=SUM(A2:B2)"],
        ["C1", '="sum"'],
        ["B4", "=A3+1"],
      ]),
    );

    expect(grid).toEqual({
      rows: [
        ["a", "b", "sum"],
        ["2", "3", ""],
        ["5", "", ""],
        ["", "6", ""],
      ],
      columns: 3,
    });
  });

  it("calculates a formula far outside the sheet for the cells that use it, and does not make a sheet of a million rows for it", () => {
    const { sheet: grid, results } = calculate(
      sheet("a\n1"),
      new Map([
        ["A2", "=ZZ9999+1"],
        ["ZZ9999", "=5"],
        ["A1000000", "=1"],
      ]),
    );

    expect(grid.rows).toEqual([["a"], ["6"]]);
    expect(grid.columns).toBe(1);
    expect(results.get("ZZ9999")?.value).toBe(5);
    expect(results.get("A1000000")?.value).toBe(1);
  });
});

describe("formatValue", () => {
  it("shows a number to 15 digits, in E notation where Excel would, and an error by its name", () => {
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(1 / 3)).toBe("0.333333333333333");
    expect(formatValue(1e21)).toBe("1E+21");
    expect(formatValue(1140)).toBe("1140");
    expect(formatValue(ERR.DIV0)).toBe("#DIV/0!");
    expect(formatValue(true)).toBe("TRUE");
    expect(formatValue(null)).toBe("");
    expect(formatValue("West")).toBe("West");
  });
});


describe("calculate with carried formulas", () => {
  const sheet = { rows: [["Item", "Price", "Double", "Looked up"], ["Pens", "1.5", "", "4"]], columns: 4 };

  it("does not calculate a carried formula, and shows the value the CSV holds for it", () => {
    const { sheet: shown, results } = calculate(sheet, new Map([["C2", "=B2*2"], ["D2", "=XLOOKUP(A2,F:F,G:G)"]]), new Set(["D2"]));
    expect(shown.rows[1]).toEqual(["Pens", "1.5", "3", "4"]);
    expect(results.has("D2")).toBe(false);
    expect(results.get("C2")?.value).toBe(3);
  });

  it("lets a formula that reads a carried cell read the value it holds, and not be flagged as uncalculated", () => {
    const { results } = calculate(sheet, new Map([["C2", "=D2+1"], ["D2", "=XLOOKUP(A2,F:F,G:G)"]]), new Set(["D2"]));
    expect(results.get("C2")).toEqual({ value: 5, unsupported: [] });
  });

  it("grows the grid to hold a carried formula under the last row, as for any other", () => {
    const { sheet: shown } = calculate(sheet, new Map([["D5", "=XLOOKUP(A2,F:F,G:G)"]]), new Set(["D5"]));
    expect(shown.rows).toHaveLength(5);
  });
});
