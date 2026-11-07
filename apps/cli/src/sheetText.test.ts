import { describe, expect, it } from "vitest";
import { parseSheet } from "./backend";
import { SHEET_TEXT_ROWS, sheetLines, sheetMarkdown } from "./sheetText";

const sheetOf = (csv: string) => {
  const parsed = parseSheet(csv);
  if (!parsed.sheet) throw new Error(parsed.error);
  return parsed.sheet;
};

describe("sheetLines", () => {
  it("draws Excel's column letters, the row numbers and the cells, a column of numbers flush right", () => {
    // Column A is 6 wide (Region), column B 5 (Units), flush right: the letters sit over the cells' edges.
    expect(sheetLines(sheetOf("Region,Units\nWest,120\nEast,5"))).toEqual([
      `  A${" ".repeat(11)}B`,
      "1 Region  Units",
      `2 West${" ".repeat(6)}120`,
      `3 East${" ".repeat(8)}5`,
    ]);
  });

  it("numbers the rows so their digits line up", () => {
    const lines = sheetLines(sheetOf(`n\n${Array.from({ length: 9 }, (_, i) => i + 1).join("\n")}`));

    expect(lines[1]).toBe(" 1 n");
    expect(lines[2]).toBe(" 2 1");
    expect(lines[10]).toBe("10 9");
  });

  it("keeps a column of text, or of numbers and text, on the left", () => {
    // Qty is all numbers, so flush right; Note holds an `x`, so it stays on the left whatever else is in it.
    expect(sheetLines(sheetOf("Name,Qty,Note\nAnn,5,x\nBo,12,7"))).toEqual([
      `  A${" ".repeat(7)}B  C`,
      "1 Name  Qty  Note",
      `2 Ann${" ".repeat(5)}5  x`,
      `3 Bo${" ".repeat(5)}12  7`,
    ]);
  });

  it("decides a column's alignment without its empty cells", () => {
    expect(sheetLines(sheetOf("Qty\n5\n\n12")).slice(1)).toEqual(["1 Qty", "2   5", "3", "4  12"]);
  });

  it("draws a cell with a line break on one line", () => {
    expect(sheetLines(sheetOf('a\n"two\nlines"'))[2]).toBe("2 two lines");
  });

  it("cuts a long cell to 24 characters, ending in an ellipsis", () => {
    const lines = sheetLines(sheetOf(`a\n${"x".repeat(40)}`));

    expect(lines[2]).toBe(`2 ${"x".repeat(23)}…`);
  });

  it("shows the first rows of a long sheet, and how many it left out", () => {
    const rows = SHEET_TEXT_ROWS + 25;
    const lines = sheetLines(sheetOf(`n\n${Array.from({ length: rows }, (_, i) => i + 1).join("\n")}`));

    // The letters, the header, SHEET_TEXT_ROWS rows, and the line saying the rest.
    expect(lines).toHaveLength(2 + SHEET_TEXT_ROWS + 1);
    expect(lines.at(-2)).toMatch(new RegExp(`^${SHEET_TEXT_ROWS + 1} +${SHEET_TEXT_ROWS}$`));
    expect(lines.at(-1)).toBe("… 25 more rows");
  });

  it("says one row, not one rows", () => {
    const lines = sheetLines(sheetOf(`n\n${Array.from({ length: SHEET_TEXT_ROWS + 1 }, (_, i) => i + 1).join("\n")}`));

    expect(lines.at(-1)).toBe("… 1 more row");
  });

  it("draws a header with no rows below it", () => {
    expect(sheetLines(sheetOf("a,b"))).toEqual(["  A  B", "1 a  b"]);
  });
});

describe("sheetMarkdown", () => {
  it("is the lines in a fenced block under a bold title", () => {
    expect(sheetMarkdown(sheetOf("a\n1"), "Q3 *budget*")).toBe("**Q3 \\*budget\\***\n\n```\n  A\n1 a\n2 1\n```");
  });

  it("has no title line without one", () => {
    expect(sheetMarkdown(sheetOf("a"))).toBe("```\n  A\n1 a\n```");
  });

  it("fences with more backticks than any cell holds", () => {
    expect(sheetMarkdown(sheetOf("a\n```x"))).toMatch(/^````\n[\s\S]*\n````$/);
  });
});
