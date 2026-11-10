import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { importRange } from "./sheetImport";
import { exportSheet } from "./sheetExport";
import { DATE_FORMAT, workbookCell, writeWorkbook } from "./sheetWorkbookWrite";
import { readWorkbook } from "./sheetWorkbook";

const exported = (csv: string, formulas = "") => {
  const result = exportSheet({ csv, formulas });
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("workbookCell", () => {
  it("writes a number, a text, a logical and an error with the kind each is", () => {
    expect(workbookCell({ value: 12 })).toEqual({ t: "n", v: 12 });
    expect(workbookCell({ value: "Pens" })).toEqual({ t: "s", v: "Pens" });
    expect(workbookCell({ value: true })).toEqual({ t: "b", v: true });
    expect(workbookCell({ value: { error: "#N/A" } })).toEqual({ t: "e", v: 0x2a, w: "#N/A" });
    expect(workbookCell({ value: { error: "#DIV/0!" } })).toEqual({ t: "e", v: 0x07, w: "#DIV/0!" });
  });

  it("writes a date as a number with a date format, and a formula beside its value", () => {
    expect(workbookCell({ value: 46085, date: true })).toEqual({ t: "n", v: 46085, z: DATE_FORMAT });
    expect(workbookCell({ value: 18, formula: "A2*B2" })).toEqual({ t: "n", v: 18, f: "A2*B2" });
  });

  it("writes nothing for an empty cell, and an empty text for a formula that came to nothing", () => {
    expect(workbookCell({ value: null })).toBeNull();
    expect(workbookCell({ value: null, formula: "A1" })).toEqual({ t: "s", v: "", f: "A1" });
  });
});

describe("writeWorkbook", () => {
  it("makes a workbook that reads back as the same sheet: values, formulas, dates, errors", async () => {
    const { rows, columns } = exported(
      "Item,Qty,Price,Total,Due,Check\nPens,12,1.5,0,2026-03-04,\nPaper,3,4,0,2026-03-09,",
      "D2 =B2*C2\nD3 =B3*C3\nF2 =B2/0",
    );
    const bytes = await writeWorkbook({ rows, columns }, "Orders");
    const book = await readWorkbook(bytes);
    expect(book.sheets).toEqual([{ name: "Orders", used: "A1:F3" }]);
    const range = book.read("Orders", "A1:F3");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells[1].map((cell) => cell?.value)).toEqual(["Pens", 12, 1.5, 18, 46085, { error: "#DIV/0!" }]);
    expect(range.cells[1][3]).toMatchObject({ formula: "B2*C2" });
    expect(range.cells[2][3]).toMatchObject({ formula: "B3*C3", value: 12 });
    expect(range.cells[1][4]).toMatchObject({ kind: "date", text: "2026-03-04" });
    expect(range.cells[1][2]?.formula).toBeUndefined();
  });

  it("keeps a carried formula and Excel's value, so a round trip through Excel loses neither", async () => {
    const { rows, columns } = exported("Item,Found\nPens,99", "B2 carried =XLOOKUP(A2,F:F,G:G)");
    const bytes = await writeWorkbook({ rows, columns }, "S");
    const range = (await readWorkbook(bytes)).read("S", "A1:B2");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells[1][1]).toMatchObject({ value: 99, formula: "XLOOKUP(A2,F:F,G:G)" });
  });

  // Checked in Excel itself (Excel for Mac 16.114.4, 2026-11-08), on a file with these formulas and deliberately wrong stored values: it
  // calculated them all again on opening (the file has no `calcPr`, so it is treated as one an older program saved), `XLOOKUP`, `IFS` and
  // `FILTER` worked with the prefixes, `MAXIFS` written without one was `#NAME?`, and the date showed as 2026-03-04.
  it("writes the prefix of a newer function in the file, which the reader takes off again", async () => {
    const { rows, columns } = exported("A,B\n1,", "B2 =IFS(A2>0,\"yes\",TRUE,\"no\")");
    const bytes = await writeWorkbook({ rows, columns }, "S");
    // What is in the file, before anything reads it: SheetJS can show the parts of the zip.
    const book = XLSX.read(bytes, { type: "array", bookFiles: true, cellFormula: true }) as { files?: Record<string, { content: unknown }> };
    const part = book.files?.["xl/worksheets/sheet1.xml"]?.content;
    const xml = new TextDecoder().decode(part as Uint8Array);
    expect(xml).toContain("<f>_xlfn.IFS(A2&gt;0,&quot;yes&quot;,TRUE,&quot;no&quot;)</f>");
  });

  it("round trips an import: what comes out of a sheet that came from a workbook is the same cells", async () => {
    const imported = importRange({
      origin: { row: 0, col: 0 },
      cells: [
        [{ value: "Item" }, { value: "Qty" }, { value: "Total" }],
        [{ value: "Pens" }, { value: 12 }, { value: 18, formula: "B2*1.5" }],
        [{ value: "Sum" }, { value: 12, formula: "SUM(B2:B2)" }, { value: 99, formula: "FILTER(C2:C2,TRUE)" }],
      ],
    });
    if (!imported.ok) throw new Error(imported.error);
    const { rows, columns } = exported(imported.source.csv, imported.source.formulas);
    const bytes = await writeWorkbook({ rows, columns }, "Sheet1");
    const range = (await readWorkbook(bytes)).read("Sheet1", "A1:C3");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells[1].map((cell) => cell?.value)).toEqual(["Pens", 12, 18]);
    expect(range.cells[2].map((cell) => cell?.formula)).toEqual([undefined, "SUM(B2:B2)", "FILTER(C2:C2,TRUE)"]);
    expect(range.cells[2][2]?.value).toBe(99);
  });
});
