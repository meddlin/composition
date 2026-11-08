import { describe, expect, it } from "vitest";
import { describeExport, excelSheetName, exportFileName, exportSheet, toFileFormula } from "./sheetExport";

const exported = (csv: string, formulas = "") => {
  const result = exportSheet({ csv, formulas });
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("toFileFormula", () => {
  it("takes off the equals sign", () => {
    expect(toFileFormula("=SUM(A1:A3)")).toBe("SUM(A1:A3)");
    expect(toFileFormula("SUM(A1:A3)")).toBe("SUM(A1:A3)");
  });

  it("puts _xlfn. on a function newer than Excel 2007, and leaves the older ones alone", () => {
    expect(toFileFormula("=XLOOKUP(A2,B:B,C:C)")).toBe("_xlfn.XLOOKUP(A2,B:B,C:C)");
    for (const name of ["IFS", "SWITCH", "CONCAT", "TEXTJOIN", "MAXIFS", "MINIFS", "IFNA"]) expect(toFileFormula(`=${name}(A1,B1)`)).toBe(`_xlfn.${name}(A1,B1)`);
    for (const name of ["SUMIFS", "COUNTIFS", "AVERAGEIFS", "IFERROR", "VLOOKUP", "INDEX", "MATCH", "SUM", "IF", "TEXT", "RANK", "ROUND"]) expect(toFileFormula(`=${name}(A1,B1)`)).toBe(`${name}(A1,B1)`);
  });

  it("puts _xlfn._xlws. on the two that return a range", () => {
    expect(toFileFormula('=FILTER(A2:A9,B2:B9>5)')).toBe("_xlfn._xlws.FILTER(A2:A9,B2:B9>5)");
    expect(toFileFormula("=SORT(A2:A9)")).toBe("_xlfn._xlws.SORT(A2:A9)");
    expect(toFileFormula("=UNIQUE(A2:A9)")).toBe("_xlfn.UNIQUE(A2:A9)");
  });

  it("does the ones inside others, and leaves a text, a name and a prefix already there alone", () => {
    expect(toFileFormula('=IFERROR(XLOOKUP("XLOOKUP(",A:A,B:B),IFS(A1>1,"a",TRUE,"b"))')).toBe('IFERROR(_xlfn.XLOOKUP("XLOOKUP(",A:A,B:B),_xlfn.IFS(A1>1,"a",TRUE,"b"))');
    expect(toFileFormula("=_xlfn.XLOOKUP(A1,B:B,C:C)")).toBe("_xlfn.XLOOKUP(A1,B:B,C:C)");
    expect(toFileFormula("=XLOOKUPS+1")).toBe("XLOOKUPS+1");
  });

  it("keeps the case a function was written in", () => {
    expect(toFileFormula("=xlookup(A1,B:B,C:C)")).toBe("_xlfn.xlookup(A1,B:B,C:C)");
  });

  it("gives a formula it cannot read as it is, without the equals sign", () => {
    expect(toFileFormula('=XLOOKUP("open')).toBe('XLOOKUP("open');
  });
});

describe("exportSheet", () => {
  it("is each cell as the sheet shows it: a number, a text, a logical, an error, nothing", () => {
    const { rows, columns, summary } = exported("Item,Qty,Done,Check,Blank\nPens,12,TRUE,#N/A,");
    expect(columns).toBe(5);
    expect(rows[1].map((cell) => cell.value)).toEqual(["Pens", 12, true, { error: "#N/A" }, null]);
    expect(summary).toMatchObject({ rows: 2, columns: 5, formulas: 0, carried: 0, notCalculated: 0, dates: 0 });
  });

  it("writes a date as a number with a date mark, and the number as the days since 1900", () => {
    const { rows, summary } = exported("When\n2026-03-04");
    expect(rows[1][0]).toEqual({ value: 46085, date: true });
    expect(summary.dates).toBe(1);
  });

  it("writes a formula with its calculated value beside it", () => {
    const { rows, summary } = exported("Qty,Price,Total\n12,1.5,0", "C2 =A2*B2");
    expect(rows[1][2]).toEqual({ value: 18, formula: "A2*B2" });
    expect(summary).toMatchObject({ formulas: 1, carried: 0, notCalculated: 0 });
  });

  it("writes a carried formula as it came, with the value Excel gave it", () => {
    const { rows, summary } = exported("Item,Found\nPens,99", "B2 carried =XLOOKUP(A2,F:F,G:G)");
    expect(rows[1][1]).toEqual({ value: 99, formula: "_xlfn.XLOOKUP(A2,F:F,G:G)" });
    expect(summary).toMatchObject({ formulas: 1, carried: 1, notCalculated: 0 });
  });

  it("writes a formula this engine cannot calculate as a formula with #NAME? for its value, for Excel to calculate", () => {
    const { rows, summary } = exported("A,B\n1,", "B2 =FILTER(A2:A2,TRUE)");
    expect(rows[1][1]).toEqual({ value: { error: "#NAME?" }, formula: "_xlfn._xlws.FILTER(A2:A2,TRUE)" });
    expect(summary).toMatchObject({ formulas: 1, carried: 0, notCalculated: 1 });
  });

  it("writes a formula whose answer is an error, a text or a logical", () => {
    const { rows } = exported("A,B,C\n1,0,", "C2 =A2/B2\nD2 =\"x\"&A2\nE2 =A2>0");
    expect(rows[1].map((cell) => cell.value)).toEqual([1, 0, { error: "#DIV/0!" }, "x1", true]);
  });

  it("holds a formula under the last row, which the grid grows to hold", () => {
    const { rows } = exported("Units\n10\n20", "A4 =SUM(A2:A3)");
    expect(rows).toHaveLength(4);
    expect(rows[3][0]).toEqual({ value: 30, formula: "SUM(A2:A3)" });
  });

  it("writes a column named in a formula as the range it stands for, which Excel can read, with the value it came to", () => {
    const { rows, summary } = exported(
      "Region,Units,Unit Price,Revenue\nWest,120,9.5,\nEast,80,9.5,",
      "D2 =[@Units]*[@[Unit Price]]\nD3 =[@Units]*[@[Unit Price]]\nD4 =SUM([Revenue])\nB4 =SUMIFS([Units],[Region],\"West\")",
    );
    expect(rows[1][3]).toEqual({ value: 1140, formula: "B2*C2" });
    expect(rows[2][3]).toEqual({ value: 760, formula: "B3*C3" });
    expect(rows[3][3]).toEqual({ value: 1900, formula: "SUM($D$2:$D$3)" });
    expect(rows[3][1]).toEqual({ value: 120, formula: 'SUMIFS($B$2:$B$3,$A$2:$A$3,"West")' });
    expect(summary).toMatchObject({ formulas: 4, notCalculated: 0 });
  });

  it("writes a formula with a table reference it cannot read as it was written", () => {
    const { rows } = exported("A,B\n1,", "B2 =SUM(Table1[A])");
    expect(rows[1][1].formula).toBe("SUM(Table1[A])");
    expect(rows[1][1].value).toMatchObject({ error: "#NAME?" });
  });

  it("is the CSV of what the sheet shows, formulas calculated", () => {
    expect(exported("Qty,Price,Total\n12,1.5,0\n2,3,0", "C2 =A2*B2\nC3 =A3*B3").csv).toBe("Qty,Price,Total\n12,1.5,18\n2,3,6");
  });

  it("is the cells as the text each shows, for a copy", () => {
    expect(exported("Qty,Price,Total\n12,1.5,0", "C2 =A2*B2").shown).toEqual([["Qty", "Price", "Total"], ["12", "1.5", "18"]]);
  });

  it("is why it cannot be when there is no data", () => {
    expect(exportSheet({ csv: "", formulas: "" })).toMatchObject({ ok: false, error: expect.stringContaining("csv") });
  });
});

describe("describeExport", () => {
  const base = { rows: 6, columns: 4, formulas: 0, carried: 0, notCalculated: 0, dates: 0 };

  it("says the size and what is not kept", () => {
    expect(describeExport(base)).toEqual(["6 rows (the first is the header) by 4 columns.", "Cell formats (a percent or a currency is the plain number), colours and column widths are not kept."]);
  });

  it("says what became of the formulas and the dates", () => {
    const lines = describeExport({ ...base, formulas: 5, carried: 2, notCalculated: 1, dates: 3 });
    expect(lines).toContain("5 formulas written as formulas, each with the value it shows, so Excel calculates them again.");
    expect(lines).toContain("2 are carried from Excel and written as it came, with Excel's value.");
    expect(lines).toContain("1 formula could not be calculated here, and is written with #NAME? for a value: Excel calculates it when it opens the file.");
    expect(lines).toContain("3 dates written as dates (yyyy-mm-dd).");
  });
});

describe("names", () => {
  it("makes a sheet name of a caption within Excel's limits", () => {
    expect(excelSheetName("Q3 budget")).toBe("Q3 budget");
    expect(excelSheetName("a/b:c*d?[e]\\f")).toBe("a b c d e f");
    expect(excelSheetName("x".repeat(50))).toHaveLength(31);
    expect(excelSheetName(undefined)).toBe("Sheet1");
    expect(excelSheetName("  ")).toBe("Sheet1");
  });

  it("makes a file name of the caption, else of the file it came from, else Sheet", () => {
    expect(exportFileName("Q3 budget", "budget.xlsx", "xlsx")).toBe("Q3 budget.xlsx");
    expect(exportFileName(undefined, "budget.xlsx", "csv")).toBe("budget.csv");
    expect(exportFileName(undefined, undefined, "xlsx")).toBe("Sheet.xlsx");
    expect(exportFileName('a/b\\c:"d"', undefined, "xlsx")).toBe("a_b_c_d_.xlsx");
    expect(exportFileName("Résumé 2026", undefined, "csv")).toBe("Résumé 2026.csv");
  });
});

describe("exportSheet with a totals row", () => {
  it("writes a column named in a formula without the totals row, and the total's formula over the rows above", () => {
    const result = exportSheet({ csv: "Region,Units\nWest,120\nEast,80\nTotal,", formulas: "B4 =SUM([Units])", totals: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[3][1]).toEqual({ value: 200, formula: "SUM($B$2:$B$3)" });
  });
});
