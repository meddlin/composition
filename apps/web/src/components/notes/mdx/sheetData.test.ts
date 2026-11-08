import { describe, expect, it } from "vitest";
import { columnLabel, columnWidths, isErrorValue, isNumberCell, parseFormulas, parseSheet, viewportHeight, type Sheet } from "./sheetData";

const sheetOf = (csv: string): Sheet => {
  const parsed = parseSheet(csv);
  if (!parsed.sheet) throw new Error(parsed.error);
  return parsed.sheet;
};

describe("parseSheet", () => {
  it("reads the header and the rows, trimming cells", () => {
    expect(sheetOf("Region, Units\nWest , 120\nEast,80")).toEqual({
      rows: [["Region", "Units"], ["West", "120"], ["East", "80"]],
      columns: 2,
    });
  });

  it("pads short rows to the widest, so every row has a cell in every column", () => {
    expect(sheetOf("a,b,c\n1\n1,2,3,4").rows).toEqual([["a", "b", "c", ""], ["1", "", "", ""], ["1", "2", "3", "4"]]);
    expect(sheetOf("a,b,c\n1\n1,2,3,4").columns).toBe(4);
  });

  it("keeps blank rows between rows, so a row's number is where it sits in the text", () => {
    expect(sheetOf("a,b\n1,2\n,\n\n3,4").rows).toEqual([["a", "b"], ["1", "2"], ["", ""], ["", ""], ["3", "4"]]);
  });

  it("drops blank lines before the header and after the last row", () => {
    expect(sheetOf("\n\na,b\n1,2\n,\n\n").rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads quoted cells with commas, escaped quotes and line breaks", () => {
    expect(sheetOf('name,note\n"Smith, J","said ""hi"""\n"two\nlines",x').rows).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"'],
      ["two\nlines", "x"],
    ]);
  });

  it("accepts a header with no rows below it, an empty table to start typing in", () => {
    expect(sheetOf("a,b")).toEqual({ rows: [["a", "b"]], columns: 2 });
  });

  it("says what is missing when there is no data", () => {
    expect(parseSheet("")).toEqual({ error: "Sheet: add a ```csv block with a header row and the data." });
    expect(parseSheet("\n , \n")).toEqual({ error: "Sheet: add a ```csv block with a header row and the data." });
  });

  it("handles a sheet far larger than a note would hold, without running out of stack", () => {
    const csv = `a,b\n${Array.from({ length: 150_000 }, (_, i) => `${i},x`).join("\n")}`;
    expect(sheetOf(csv).rows).toHaveLength(150_001);
  });
});

describe("parseFormulas", () => {
  it("reads a line to a cell, its address and its formula, in Excel's syntax", () => {
    const { formulas, problems } = parseFormulas("E2 =C2*D2\nE3 =C3*D3\nC4 =SUM(C2:C3)");

    expect([...formulas]).toEqual([
      ["E2", "=C2*D2"],
      ["E3", "=C3*D3"],
      ["C4", "=SUM(C2:C3)"],
    ]);
    expect(problems).toEqual([]);
  });

  it("keeps spaces inside a formula and drops those around it, and writes the address in capitals without dollars", () => {
    const { formulas } = parseFormulas('  e2   =IF(A1 = "a b", 1, 2)   \n$F$3\t=1');

    expect(formulas.get("E2")).toBe('=IF(A1 = "a b", 1, 2)');
    expect(formulas.get("F3")).toBe("=1");
  });

  it("takes the later line for a cell that is given twice, and passes over blank lines, and CRLF", () => {
    const { formulas, problems } = parseFormulas("A1 =1\r\n\r\nA1 =2\r\n");

    expect(formulas.get("A1")).toBe("=2");
    expect(problems).toEqual([]);
  });

  it("counts the lines that are not a cell and a formula, from 1, and reads the others", () => {
    const { formulas, problems } = parseFormulas("A1 =1\nnonsense\nA2 2+2\nXFE1 =1\nA0 =1\nA3 =3");

    expect([...formulas.keys()]).toEqual(["A1", "A3"]);
    expect(problems).toEqual([2, 3, 4, 5]);
  });

  it("reads no formulas from nothing", () => {
    expect(parseFormulas("")).toEqual({ formulas: new Map(), carried: new Set(), problems: [] });
  });

  it("reads a line marked carried as a formula that is not calculated", () => {
    const { formulas, carried, problems } = parseFormulas("B2 =A2*2\nC2 carried =XLOOKUP(A2,Prices!A:A,Prices!B:B)\n  D2   carried   =SUM(A2:B2)  ");
    expect([...formulas]).toEqual([
      ["B2", "=A2*2"],
      ["C2", "=XLOOKUP(A2,Prices!A:A,Prices!B:B)"],
      ["D2", "=SUM(A2:B2)"],
    ]);
    expect([...carried]).toEqual(["C2", "D2"]);
    expect(problems).toEqual([]);
  });

  it("takes the later line for a cell, carried or not", () => {
    expect([...parseFormulas("B2 carried =1+1\nB2 =2+2").carried]).toEqual([]);
    expect([...parseFormulas("B2 =1+1\nB2 carried =2+2").carried]).toEqual(["B2"]);
  });

  it("does not take another word before the formula for the marker", () => {
    expect(parseFormulas("B2 later =1+1").problems).toEqual([1]);
  });
});

describe("columnLabel", () => {
  it.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
    [16383, "XFD"],
  ])("labels column %i as %s, as Excel does", (index, label) => expect(columnLabel(index)).toBe(label));
});

describe("isNumberCell", () => {
  it("is true for what the chart reads as a number", () => {
    expect(["12", "-3.5", ".5", "1,234", "12%"].map(isNumberCell)).toEqual([true, true, true, true, true]);
  });

  it("is false for text, dates and empty cells", () => {
    expect(["", "West", "2026-03-04", "12abc", "#N/A"].map(isNumberCell)).toEqual([false, false, false, false, false]);
  });
});

describe("isErrorValue", () => {
  it.each(["#DIV/0!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#REF!", "#VALUE!"])("recognises %s", (text) => expect(isErrorValue(text)).toBe(true));

  it.each(["", "#", "#hashtag", "#n/a", "N/A", "#DIV/0! ok", "x #REF!"])("does not take %j for an error", (text) => expect(isErrorValue(text)).toBe(false));
});

describe("columnWidths", () => {
  it("is the longest cell of each column, in characters, header included", () => {
    expect(columnWidths(sheetOf("Region,Units\nWest,120\nNorth-East,5"))).toEqual([10, 5]);
  });

  it("keeps a column readable when it is nearly empty, and stops a very long cell taking the screen", () => {
    expect(columnWidths(sheetOf(`a,${"x".repeat(200)}\n1,2`))).toEqual([4, 40]);
  });
});

describe("viewportHeight", () => {
  it("is the height in pixels, 360 when left out or unreadable", () => {
    expect(viewportHeight("500")).toBe(500);
    expect(viewportHeight(undefined)).toBe(360);
    expect(viewportHeight("tall")).toBe(360);
  });

  it("stays between 120 and 800", () => {
    expect(viewportHeight("10")).toBe(120);
    expect(viewportHeight("5000")).toBe(800);
  });
});
