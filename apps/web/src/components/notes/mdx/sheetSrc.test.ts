import { describe, expect, it } from "vitest";
import { findOpenedSheet, findSheets, insertSheet, isSheetShortcut, sheetAt, sheetRange, sheetSource, sheetTag, tableAt, writeSheet } from "./sheetSrc";

const SHEET = '<Sheet title="Q3">\n\n```csv\nRegion,Units\nWest,120\n```\n\n</Sheet>';
const WITH_FORMULAS = '<Sheet title="Q3">\n\n```csv\nUnits,Double\n10,20\n```\n\n```formulas\nB2 =A2*2\n```\n\n</Sheet>';

describe("findSheets", () => {
  it("finds a sheet and the text of its two blocks", () => {
    const [sheet] = findSheets(`Before\n\n${WITH_FORMULAS}\n\nAfter`);
    expect(sheetSource(sheet)).toEqual({ csv: "Units,Double\n10,20", formulas: "B2 =A2*2" });
  });

  it("says where the sheet is, from its opening tag to the end of its closing one", () => {
    const text = `Before\n\n${SHEET}\n\nAfter`;
    const [sheet] = findSheets(text);
    expect(text.slice(sheet.start, sheet.end)).toBe(SHEET);
  });

  it("has no formulas when there is no formulas block", () => {
    expect(sheetSource(findSheets(SHEET)[0])).toEqual({ csv: "Region,Units\nWest,120", formulas: "" });
  });

  it("finds every sheet, in order", () => {
    const spans = findSheets(`${SHEET}\n\ntext\n\n${WITH_FORMULAS}`);
    expect(spans.map((span) => sheetSource(span).csv.split("\n")[0])).toEqual(["Region,Units", "Units,Double"]);
  });

  it("leaves a tag shown in a fenced code block alone", () => {
    expect(findSheets("```mdx\n" + SHEET + "\n```\n")).toEqual([]);
  });

  it("does not take a sheet with no closing tag, or a self-closing one", () => {
    expect(findSheets('<Sheet title="x">\n\n```csv\na,b\n```\n')).toEqual([]);
    expect(findSheets("<Sheet />")).toEqual([]);
  });

  it("is not ended by a cell that says </Sheet>, which is inside the fence", () => {
    const text = "<Sheet>\n\n```csv\nA\n</Sheet>\n```\n\n</Sheet>";
    const [sheet] = findSheets(text);
    expect(sheet.end).toBe(text.length);
    expect(sheetSource(sheet).csv).toBe("A\n</Sheet>");
  });

  it("reads a tag whose title has a > in it", () => {
    const text = '<Sheet title="a > b">\n\n```csv\nA\n```\n\n</Sheet>';
    expect(findSheets(text)).toHaveLength(1);
  });

  it("takes the first block as the CSV when none is tagged, as the preview does", () => {
    expect(sheetSource(findSheets("<Sheet>\n\n```\nA,B\n```\n\n</Sheet>")[0]).csv).toBe("A,B");
  });
});

describe("writeSheet", () => {
  const source = { csv: "Region,Units\nWest,121", formulas: "" };

  it("rewrites the CSV and leaves the rest of the tag, and the note around it, as it was", () => {
    const text = `Before\n\n${SHEET}\n\nAfter`;
    expect(writeSheet(text, findSheets(text)[0], source)).toBe('Before\n\n<Sheet title="Q3">\n\n```csv\nRegion,Units\nWest,121\n```\n\n</Sheet>\n\nAfter');
  });

  it("adds a formulas block after the CSV when the sheet gets its first formula", () => {
    const next = writeSheet(SHEET, findSheets(SHEET)[0], { csv: "Units,Double\n10,20", formulas: "B2 =A2*2" });
    expect(next).toBe(WITH_FORMULAS);
  });

  it("rewrites a formulas block", () => {
    const next = writeSheet(WITH_FORMULAS, findSheets(WITH_FORMULAS)[0], { csv: "Units,Double\n10,30", formulas: "B2 =A2*3" });
    expect(next).toBe('<Sheet title="Q3">\n\n```csv\nUnits,Double\n10,30\n```\n\n```formulas\nB2 =A2*3\n```\n\n</Sheet>');
  });

  it("takes the formulas block out, with the blank line after it, when no formulas are left", () => {
    const next = writeSheet(WITH_FORMULAS, findSheets(WITH_FORMULAS)[0], { csv: "Units,Double\n10,20", formulas: "" });
    expect(next).toBe('<Sheet title="Q3">\n\n```csv\nUnits,Double\n10,20\n```\n\n</Sheet>');
  });

  it("writes what it was given back as the same sheet", () => {
    const next = writeSheet(WITH_FORMULAS, findSheets(WITH_FORMULAS)[0], { csv: "Units,Double\n10,20", formulas: "B2 =A2*2" });
    expect(next).toBe(WITH_FORMULAS);
  });

  it("uses a longer fence when a cell holds one", () => {
    const next = writeSheet(SHEET, findSheets(SHEET)[0], { csv: "Note\n```code```", formulas: "" });
    expect(next).toContain("````csv\nNote\n```code```\n````");
    expect(sheetSource(findSheets(next)[0]).csv).toBe("Note\n```code```");
  });

  it("keeps the fence the sheet was written with", () => {
    const text = "<Sheet>\n\n~~~csv\nA\n~~~\n\n</Sheet>";
    expect(writeSheet(text, findSheets(text)[0], { csv: "A\n1", formulas: "" })).toContain("```csv\nA\n1\n```");
  });

  it("puts in a CSV block where the sheet has none", () => {
    const text = '<Sheet title="x">\n\n</Sheet>';
    const next = writeSheet(text, findSheets(text)[0], { csv: "A\n1", formulas: "" });
    expect(next).toBe('<Sheet title="x">\n\n```csv\nA\n1\n```\n\n</Sheet>');
  });
});

describe("sheetAt and findOpenedSheet", () => {
  const text = `${SHEET}\n\nmiddle\n\n${WITH_FORMULAS}`;

  it("finds the sheet that holds a place in the note", () => {
    const second = findSheets(text)[1];
    expect(sheetAt(text, second.start)).toEqual(second);
    expect(sheetAt(text, second.start + 10)).toEqual(second);
    expect(sheetAt(text, SHEET.length + 3)).toBeNull();
  });

  it("finds a sheet again, by where it was and what it said", () => {
    const second = findSheets(text)[1];
    const opened = { start: second.start, text: text.slice(second.start, second.end) };
    expect(findOpenedSheet(text, opened)).toEqual(second);
  });

  it("finds it where it has moved to, as long as it is the same text", () => {
    const second = findSheets(text)[1];
    const opened = { start: second.start, text: text.slice(second.start, second.end) };
    const moved = `a new line\n\n${text}`;
    expect(findOpenedSheet(moved, opened)?.start).toBe(second.start + "a new line\n\n".length);
  });

  it("does not find a sheet that has changed", () => {
    const second = findSheets(text)[1];
    const opened = { start: second.start, text: text.slice(second.start, second.end) };
    expect(findOpenedSheet(text.replace("10,20", "11,22"), opened)).toBeNull();
  });
});

describe("a new sheet", () => {
  const source = { csv: "A,B\n1,2", formulas: "" };

  it("is the tag with the CSV in its fence, and the formulas in another when there are any", () => {
    expect(sheetTag(source)).toBe("<Sheet>\n\n```csv\nA,B\n1,2\n```\n\n</Sheet>");
    expect(sheetTag({ csv: "A\n1", formulas: "A3 =A2" })).toBe("<Sheet>\n\n```csv\nA\n1\n```\n\n```formulas\nA3 =A2\n```\n\n</Sheet>");
  });

  it("goes on lines of its own, with a blank line around it, and the caret after it", () => {
    const text = "Some text";
    const edit = insertSheet(text, text.length, text.length, source);
    expect(edit.text).toBe("\n\n<Sheet>\n\n```csv\nA,B\n1,2\n```\n\n</Sheet>\n\n");
    expect(edit.caret).toBe(edit.text.length);
  });

  it("needs no blank line before it where there already is one, and only the one it lacks after it", () => {
    const text = "Before\n\n\nAfter";
    const edit = insertSheet(text, 8, 8, source);
    expect(edit.text.startsWith("<Sheet>")).toBe(true);
    expect(edit.text.endsWith("</Sheet>\n")).toBe(true);
    expect(insertSheet("Before\n\nAfter", 8, 8, source).text.endsWith("</Sheet>\n\n")).toBe(true);
  });

  it("goes at the start of the selection, and at the end of the note when that is in the frontmatter", () => {
    expect(sheetRange("abc\n\ndef", 5, 0)).toEqual({ start: 5, end: 5 });
    expect(sheetRange("---\ntitle: x\n---\nbody", 0, 17)).toEqual({ start: 21, end: 21 });
  });
});

describe("tableAt", () => {
  const TABLE = "| Region | Units |\n| --- | ---: |\n| West | 120 |\n| East | 80 |";

  it("reads a table the position is in, with its place in the note", () => {
    const text = `Before\n\n${TABLE}\n\nAfter`;
    const table = tableAt(text, text.indexOf("West"));
    expect(table).toEqual({
      start: text.indexOf("| Region"),
      end: text.indexOf("| East | 80 |") + "| East | 80 |".length,
      rows: [
        ["Region", "Units"],
        ["West", "120"],
        ["East", "80"],
      ],
    });
  });

  it("finds it from its first line or its last", () => {
    expect(tableAt(TABLE, 0)).not.toBeNull();
    expect(tableAt(TABLE, TABLE.length)).not.toBeNull();
  });

  it("is not there when the position is on another line", () => {
    const text = `Before\n\n${TABLE}\n\nAfter`;
    expect(tableAt(text, 2)).toBeNull();
    expect(tableAt(text, text.length)).toBeNull();
  });

  it("reads a table with no outer pipes, escaped pipes, and rows of different lengths", () => {
    const rows = tableAt("a | b\n--|--\nx \\| y | z\nonly |", 0)?.rows;
    expect(rows).toEqual([
      ["a", "b"],
      ["x | y", "z"],
      ["only", ""],
    ]);
  });

  it("is not a table without a delimiter row, or in a fenced code block", () => {
    expect(tableAt("| a | b |\n| c | d |", 0)).toBeNull();
    const fenced = "```\n" + TABLE + "\n```";
    expect(tableAt(fenced, fenced.indexOf("West"))).toBeNull();
  });
});

describe("isSheetShortcut", () => {
  const key = { key: "g", shiftKey: true, altKey: false, metaKey: true, ctrlKey: false };
  it("is Cmd or Ctrl and Shift and G", () => {
    expect(isSheetShortcut(key)).toBe(true);
    expect(isSheetShortcut({ ...key, metaKey: false, ctrlKey: true, key: "G" })).toBe(true);
    expect(isSheetShortcut({ ...key, shiftKey: false })).toBe(false);
    expect(isSheetShortcut({ ...key, altKey: true })).toBe(false);
    expect(isSheetShortcut({ ...key, key: "d" })).toBe(false);
  });
});
