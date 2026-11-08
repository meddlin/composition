import { describe, expect, it } from "vitest";
import { type SourceCell, type SourceRange, importRange, importedHash, parseRange, rangeText } from "./sheetImport";
import { parseFormulas, parseSheet } from "./sheetData";
import { calculate } from "./sheetFormula";
import { draftFromSource, draftToSource } from "./sheetDraft";

const v = (value: SourceCell["value"], extra: Partial<SourceCell> = {}): SourceCell => ({ value, ...extra });
const f = (formula: string, value: SourceCell["value"], extra: Partial<SourceCell> = {}): SourceCell => ({ formula, value, ...extra });

const range = (cells: (SourceCell | null)[][], extra: Partial<SourceRange> = {}): SourceRange => ({ cells, origin: { row: 0, col: 0 }, ...extra });
const imported = (source: SourceRange) => {
  const result = importRange(source);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("importRange: values", () => {
  it("brings each cell as what Excel showed: a number as it is, a text, a logical, an error", () => {
    const { source, summary } = imported(range([[v("Item"), v("Qty"), v("Done"), v("Check")], [v("Pens"), v(12.5), v(true), v({ error: "#N/A" })]]));
    expect(source.csv).toBe("Item,Qty,Done,Check\nPens,12.5,TRUE,#N/A");
    expect(source.formulas).toBe("");
    expect(summary).toMatchObject({ rows: 2, columns: 4, formulas: 0, calculated: 0, carried: 0, values: 0 });
  });

  it("writes a number to the 15 digits Excel keeps, and a text with a comma or a quote in quotes", () => {
    const { source } = imported(range([[v("A"), v("B")], [v(0.1 + 0.2), v('say "hi", then')]]));
    expect(source.csv).toBe('A,B\n0.3,"say ""hi"", then"');
  });

  it("writes a date as 2026-03-04, which the engine reads as that date again", () => {
    const { source } = imported(range([[v("When")], [v(46085, { kind: "date" })]]));
    expect(source.csv).toBe("When\n2026-03-04");
  });

  it("counts days from 1904 for a workbook that does", () => {
    const { source } = imported(range([[v("When")], [v(46085 - 1462, { kind: "date" })]], { date1904: true }));
    expect(source.csv).toBe("When\n2026-03-04");
  });

  it("keeps Excel's own text for a date with a time and for a time, which are not dates here", () => {
    const { source } = imported(range([[v("A"), v("B")], [v(46085.5, { kind: "date", text: "2026-03-04 12:00" }), v(0.4375, { kind: "time", text: "10:30" })]]));
    expect(source.csv).toBe("A,B\n2026-03-04 12:00,10:30");
  });

  it("leaves out the empty rows at the foot and the empty columns at the right", () => {
    const { source, summary } = imported(range([[v("A"), v("B"), null], [v(1), v(2), null], [null, null, null], [null, null, null]]));
    expect(source.csv).toBe("A,B\n1,2");
    expect(summary).toMatchObject({ rows: 2, columns: 2 });
  });

  it("keeps an empty row between two that are not", () => {
    expect(imported(range([[v("A")], [v(1)], [null], [v(3)]])).source.csv).toBe("A\n1\n\n3");
  });

  it("refuses an empty range, a first row with nothing in it, and a range past the size of a sheet", () => {
    expect(importRange(range([]))).toMatchObject({ ok: false });
    expect(importRange(range([[null, null], [v(1), v(2)]]))).toMatchObject({ ok: false, error: expect.stringContaining("first row") });
    expect(importRange(range(Array.from({ length: 5002 }, (_, i) => [v(i)])))).toMatchObject({ ok: false, error: expect.stringContaining("narrower") });
    expect(importRange(range([Array.from({ length: 101 }, (_, i) => v(i))]))).toMatchObject({ ok: false, error: expect.stringContaining("columns") });
  });
});

describe("importRange: formulas", () => {
  const header = [v("Item"), v("Qty"), v("Price"), v("Total")];

  it("keeps a formula, calculated here, when its result is the number Excel saved", () => {
    const { source, summary } = imported(range([header, [v("Pens"), v(12), v(1.5), f("B2*C2", 18)]]));
    expect(source.formulas).toBe("D2 =B2*C2");
    expect(source.csv).toBe("Item,Qty,Price,Total\nPens,12,1.5,18");
    expect(summary).toMatchObject({ formulas: 1, calculated: 1, carried: 0, values: 0 });
  });

  it("carries a formula the engine cannot calculate, with the value Excel saved", () => {
    const { source, summary } = imported(range([[v("Item"), v("Found")], [v("Pens"), f("FILTER(A2:A2,TRUE)", "Pens")]]));
    expect(source.formulas).toBe("B2 carried =FILTER(A2:A2,TRUE)");
    expect(source.csv).toBe("Item,Found\nPens,Pens");
    expect(summary).toMatchObject({ calculated: 0, carried: 1, carriedWhy: [{ reason: expect.stringContaining("FILTER"), count: 1 }] });
  });

  it("carries a formula whose result is not the number Excel saved, and never writes ours over Excel's", () => {
    const { source, summary } = imported(range([header, [v("Pens"), v(12), v(1.5), f("B2*C2", 19)]]));
    expect(source.formulas).toBe("D2 carried =B2*C2");
    expect(source.csv).toContain("Pens,12,1.5,19");
    expect(summary.carriedWhy).toEqual([{ reason: "its result is not the one Excel saved", count: 1 }]);
  });

  it("takes numbers as the same when they differ only past the 15 digits Excel keeps", () => {
    const { summary } = imported(range([[v("A"), v("B")], [v(0.1), f("A2+0.2", 0.30000000000000004)]]));
    expect(summary).toMatchObject({ calculated: 1, carried: 0 });
  });

  it("takes a text, a logical and an error as the same only when they are", () => {
    const sheet = range([
      [v("A"), v("B"), v("C"), v("D")],
      [v("x"), f('UPPER(A2)', "X"), f("A2=\"x\"", true), f("1/0", { error: "#DIV/0!" })],
    ]);
    expect(imported(sheet).summary).toMatchObject({ calculated: 3, carried: 0 });
    const wrong = range([[v("A"), v("B")], [v("x"), f("UPPER(A2)", "x")]]);
    expect(imported(wrong).summary).toMatchObject({ calculated: 0, carried: 1 });
  });

  it("lets a formula read a carried cell, and keeps it calculated when it agrees with Excel from that value", () => {
    const { source, summary } = imported(range([[v("A"), v("B"), v("C")], [v(5), f("FILTER(A2:A2,TRUE)", 5), f("B2+1", 6)]]));
    expect(source.formulas).toBe("B2 carried =FILTER(A2:A2,TRUE)\nC2 =B2+1");
    expect(summary).toMatchObject({ calculated: 1, carried: 1 });
  });

  it("carries only the formula that is wrong, not the ones that read it: each is checked against Excel's values for what it reads", () => {
    // B2 gives 6 here and Excel saved 7; C2 reads it and Excel saved 8, which is right from Excel's 7.
    const { source, summary } = imported(range([[v("A"), v("B"), v("C")], [v(5), f("A2+1", 7), f("B2+1", 8)]]));
    expect(source.formulas).toBe("B2 carried =A2+1\nC2 =B2+1");
    expect(summary).toMatchObject({ calculated: 1, carried: 1 });
  });

  it("carries a formula whose result Excel shows as a date, which would be drawn as a number of days", () => {
    const { source } = imported(range([[v("Start"), v("End")], [v(46085, { kind: "date" }), f("A2+30", 46115, { kind: "date" })]]));
    expect(source.csv).toBe("Start,End\n2026-03-04,2026-04-03");
    expect(source.formulas).toBe("B2 carried =A2+30");
  });

  it("makes a value of a formula that reads outside the range, another sheet, a table or a name", () => {
    const { source, summary } = imported(
      range([
        [v("A"), v("B"), v("C"), v("D"), v("E")],
        [v(1), f("Sheet2!A1*2", 10), f("Table1[Total]", 20), f("A2*TaxRate", 30), f("Z99+1", 40)],
      ]),
    );
    expect(source.formulas).toBe("");
    expect(source.csv).toBe("A,B,C,D,E\n1,10,20,30,40");
    expect(summary).toMatchObject({ formulas: 4, values: 4, calculated: 0, carried: 0 });
    expect(summary.valuesWhy.map((entry) => entry.reason).sort()).toEqual(["a defined name", "a table's column", "another sheet or workbook", "cells that are not in the range"]);
  });

  it("moves the formulas to where the range began, and makes a value of one that reads above or left of it", () => {
    // The range is B2:D3 of the sheet, so C3*2 at D3 reads the cell now at B2, and A1 is outside.
    const { source, summary } = imported(
      range(
        [
          [v("Item"), v("Qty"), v("Double")],
          [v("Pens"), v(12), f("C3*2", 24)],
        ],
        { origin: { row: 1, col: 1 } },
      ),
    );
    expect(source.formulas).toBe("C2 =B2*2");
    expect(summary.values).toBe(0);
    const outside = imported(range([[v("A"), v("B")], [v(1), f("A1+1", 2)]], { origin: { row: 1, col: 1 } }));
    expect(outside.summary).toMatchObject({ values: 1, calculated: 0 });
  });

  it("calculates what Excel saved no value for, and says it could not check it", () => {
    const { source, summary } = imported(range([[v("A"), v("B")], [v(2), f("A2*3", undefined)]]));
    expect(source.formulas).toBe("B2 =A2*3");
    expect(source.csv).toBe("A,B\n2,6");
    expect(summary).toMatchObject({ calculated: 1, unchecked: 1 });
  });

  it("keeps a formula with no saved value and an unsupported function as a formula that says #NAME?, rather than carry nothing", () => {
    const { source, summary } = imported(range([[v("A"), v("B")], [v(2), f("FILTER(A2:A2,TRUE)", undefined)]]));
    expect(source.formulas).toBe("B2 =FILTER(A2:A2,TRUE)");
    expect(source.csv).toBe("A,B\n2,#NAME?");
    expect(summary).toMatchObject({ calculated: 1, carried: 0, unchecked: 1 });
  });

  it("does not leave off a trailing row that holds only a formula", () => {
    const { source } = imported(range([[v("A")], [v(1)], [f('""', "")]]));
    expect(source.formulas).toBe('A3 =""');
    expect(source.csv.split("\n")).toHaveLength(3);
  });

  it("reads back as the same sheet: drawn, every formula's value is what the import said", () => {
    const { source } = imported(
      range([
        [v("Item"), v("Qty"), v("Price"), v("Total"), v("Found")],
        [v("Pens"), v(12), v(1.5), f("B2*C2", 18), f("FILTER(A2:A3,TRUE)", "Pens")],
        [v("Paper"), v(3), v(4), f("B3*C3", 12), f("FILTER(A2:A3,TRUE)", "Paper")],
        [v("Sum"), f("SUM(B2:B3)", 15), null, f("SUM(D2:D3)", 30), null],
      ]),
    );
    const parsed = parseSheet(source.csv);
    const { formulas, carried } = parseFormulas(source.formulas);
    const { sheet } = calculate(parsed.sheet!, formulas, carried);
    expect(sheet.rows[3]).toEqual(["Sum", "15", "", "30", ""]);
    expect(sheet.rows[1][4]).toBe("Pens");
    expect([...carried]).toEqual(["E2", "E3"]);
  });
});

describe("an import, then the grid editor", () => {
  it("is written back as it was by a save that changed nothing, so the sheet is not taken for one that was edited", async () => {
    const { source } = imported(
      range([
        [v("Item"), v("Qty"), v("Price"), v("Total"), v("Found"), v("Due"), v("Share")],
        [v("Pens"), v(12), v(1.5), f("B2*C2", 18), f("FILTER(A2:A3,TRUE)", "Pens"), v(46085, { kind: "date" }), f("D2/D$4", 18 / 30)],
        [v("Paper"), v(3), v(4), f("B3*C3", 12), f("FILTER(A2:A3,TRUE)", "Pens"), v(46090, { kind: "date" }), f("D3/D$4", 12 / 30)],
        [v("Sum"), f("SUM(B2:B3)", 15), null, f("SUM(D2:D3)", 30), null, null, null],
      ]),
    );
    expect(source.formulas).toContain("carried");
    const saved = draftToSource(draftFromSource(source.csv, source.formulas));
    expect(saved).toEqual({ ok: true, source });
    expect(await importedHash(saved.ok ? saved.source : source)).toBe(await importedHash(source));
  });
});

describe("importedHash", () => {
  it("is the same for the same two blocks and another for a changed one", async () => {
    const a = await importedHash({ csv: "A\n1", formulas: "" });
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(await importedHash({ csv: "A\n1", formulas: "" })).toBe(a);
    expect(await importedHash({ csv: "A\n2", formulas: "" })).not.toBe(a);
    expect(await importedHash({ csv: "A\n1", formulas: "A2 =1" })).not.toBe(a);
  });
});

describe("parseRange and rangeText", () => {
  it("reads a range as written, in either order, with or without dollar signs, and a single cell", () => {
    expect(parseRange("A1:F40")).toEqual({ row1: 0, col1: 0, row2: 39, col2: 5 });
    expect(parseRange(" $B$2 : $D$9 ")).toEqual({ row1: 1, col1: 1, row2: 8, col2: 3 });
    expect(parseRange("F40:A1")).toEqual({ row1: 0, col1: 0, row2: 39, col2: 5 });
    expect(parseRange("C3")).toEqual({ row1: 2, col1: 2, row2: 2, col2: 2 });
  });

  it("is null for what is not one", () => {
    for (const text of ["", "A", "1:5", "A1:B2:C3", "A0:B2", "hello"]) expect(parseRange(text), text).toBeNull();
  });

  it("writes one as A1:F40", () => {
    expect(rangeText({ row1: 0, col1: 0, row2: 39, col2: 5 })).toBe("A1:F40");
  });
});
