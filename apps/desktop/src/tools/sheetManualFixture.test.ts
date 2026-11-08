import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fixture behind the sheet manual test (docs/manual-tests/sheet.md): the workbooks it writes are read back by the real import,
 * and the notes it makes are read by the real sheet code, to see that they say what the manual test says they do.
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-sheet-fixture-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(home, "userData", "settings.json"));
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("../../../web/src/lib/composition/db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

/** Writes the workbooks into the home and runs `check` on one of them, as a person would, returning what it prints. */
async function checked(name: string, names = true): Promise<string> {
  const { workbooks } = await import("../../../web/src/components/notes/mdx/sheetManualWorkbooks");
  const { check } = await import("./sheetManualFixture");
  const file = path.join(home, name);
  fs.writeFileSync(file, workbooks()[name]);
  return (await check([file], names)).join("\n");
}

describe("the workbooks", () => {
  it("orders.xlsx has a real table, and its formulas come out as the manual test says: 16 calculated, 3 carried, 1 a value", async () => {
    const text = await checked("orders.xlsx");
    expect(text).toContain('"Orders" (A1:J8):');
    expect(text).toContain("20 formulas:");
    expect(text).toContain("16 are kept as formulas, calculated here, where they gave the number Excel saved.");
    expect(text).toContain("3 are carried");
    expect(text).toContain("the function SUBTOTAL (2)");
    expect(text).toContain("the function FILTER (1)");
    expect(text).toContain("1 is kept as a value, because it reads outside the range: another sheet or workbook (1).");
    expect(text).toContain('"Prices" (A1:B3):');
  });

  it("orders.xlsx's table is read from the file, with its name and its totals row", async () => {
    const { workbooks } = await import("../../../web/src/components/notes/mdx/sheetManualWorkbooks");
    const { readWorkbook } = await import("../../../web/src/components/notes/mdx/sheetWorkbook");
    const range = (await readWorkbook(workbooks()["orders.xlsx"])).read("Orders", "A1:J8");
    if ("error" in range) throw new Error(range.error);
    expect(range.tables).toMatchObject([{ name: "Orders", sheet: "Orders", totalsRows: 1, headerRows: 1 }]);
    expect(range.tables?.[0].columns).toEqual(["Region", "Product", "Units", "Unit Price", "Revenue", "Due", "Share", "Status"]);
  });

  it("carried.xlsx has a stale value, a function the engine lacks, a volatile one and two reads outside the range", async () => {
    const text = await checked("carried.xlsx");
    expect(text).toContain("10 formulas:");
    expect(text).toContain("4 are kept as formulas, calculated here, where they gave the number Excel saved.");
    expect(text).toContain("4 are carried");
    expect(text).toContain("the function STDEV (1)");
    expect(text).toContain("the function NETWORKDAYS (1)");
    expect(text).toContain("its result is not the one Excel saved (1)");
    expect(text).toContain("the function TODAY (1)");
    expect(text).toContain("2 are kept as values");
    expect(text).toContain("another sheet or workbook (1)");
  });

  it("old-1904.xlsx counts days from 1904, and its dates come across as the dates Excel shows", async () => {
    const { workbooks } = await import("../../../web/src/components/notes/mdx/sheetManualWorkbooks");
    const { readWorkbook } = await import("../../../web/src/components/notes/mdx/sheetWorkbook");
    const { importRange } = await import("../../../web/src/components/notes/mdx/sheetImport");
    const range = (await readWorkbook(workbooks()["old-1904.xlsx"])).read("Dates", "A1:B3");
    if ("error" in range) throw new Error(range.error);
    const result = importRange(range);
    if (!result.ok) throw new Error(result.error);
    expect(result.source.csv.split("\n")).toEqual(["Event,Date", "Kick-off,2026-03-04", "Review,2026-03-09"]);
  });

  it("big.xlsx has a sheet at the limit that imports whole, and one a row over that is refused", async () => {
    const text = await checked("big.xlsx");
    expect(text).toContain('"Big" (A1:F5001):');
    expect(text).toContain("5,001 rows (the first is the header) by 6 columns.");
    expect(text).toContain("10,000 are kept as formulas, calculated here, where they gave the number Excel saved.");
    expect(text).toContain('"TooBig" (A1:F5200): That range has 5,200 rows, and a sheet holds at most 5,001 (the header included).');
  }, 120_000);

  it("the two files that are not workbooks say so, and a path that is not there says it cannot be read", async () => {
    expect(await checked("not-a-workbook.xlsx")).toBe("not-a-workbook.xlsx: It is not an Excel workbook.");
    expect(await checked("cut-short.xlsx")).toBe("cut-short.xlsx: It is not an Excel workbook.");
    const { check } = await import("./sheetManualFixture");
    expect(await check([path.join(home, "missing.xlsx")], false)).toEqual(["missing.xlsx: cannot be read."]);
  });

  it("check leaves sheet names out unless asked, and never prints a cell", async () => {
    const text = await checked("orders.xlsx", false);
    expect(text).toContain("sheet 1 (A1:J8):");
    expect(text).not.toContain("Orders");
    expect(text).not.toMatch(/West|Widget|Gadget/);
  });
});

describe("setup", () => {
  async function made() {
    const { setup } = await import("./sheetManualFixture");
    const notes = await import("../../../web/src/lib/composition/notesRepo");
    const lines = await setup(home);
    const byTitle = new Map(notes.listNotes().map((note) => [note.title, notes.getNote(note.id)!.content]));
    return { lines, byTitle };
  }

  it("writes the six workbooks and three notes, and a second setup on the same home refuses", async () => {
    const { lines, byTitle } = await made();
    expect(lines[0]).toContain("Made 3 notes");
    expect([...byTitle.keys()].sort()).toEqual(["Sheet tour", "Sheet: promote, paste and start", "Sheet: re-import"]);
    expect(fs.readdirSync(path.join(home, "workbooks")).sort()).toEqual([
      "big.xlsx",
      "carried.xlsx",
      "cut-short.xlsx",
      "not-a-workbook.xlsx",
      "old-1904.xlsx",
      "orders.xlsx",
    ]);
    const { setup } = await import("./sheetManualFixture");
    await expect(setup(home)).rejects.toThrow("already has notes");
  });

  it("the tour's sheets calculate to what the manual test says", async () => {
    const { byTitle } = await made();
    const { findSheets, sheetSource } = await import("../../../web/src/components/notes/mdx/sheetSrc");
    const { exportSheet } = await import("../../../web/src/components/notes/mdx/sheetExport");
    const spans = findSheets(byTitle.get("Sheet tour")!);
    const sheets = spans.map((span) => {
      const result = exportSheet(sheetSource(span));
      if (!result.ok) throw new Error(result.error);
      return result;
    });
    expect(spans.length).toBe(4);
    const [budget, byRegion, squares, notCalculated] = sheets;
    // Budget: three rows of units times price, and a totals row that names its columns.
    expect(budget.rows.map((row) => row[3].value)).toEqual(["Revenue", 1140, 760, 900, 2800]);
    expect(budget.rows[4][1].value).toBe(245);
    expect(sheetSource(spans[0]).totals).toBe(true);
    // Orders by region: SUMIFS, a spread of dates, and text built from a number.
    expect(byRegion.rows[5][1].value).toBe(2040);
    expect(byRegion.rows[1][3].value).toBe("West: 1,140");
    expect(byRegion.summary.dates).toBe(4);
    // Squares: 300 rows, the last running total being the sum of the first 300 squares.
    expect(squares.rows.length).toBe(301);
    expect(squares.rows[300][2].value).toBe((300 * 301 * 601) / 6);
    // The sheet with a formula this engine cannot calculate has exactly one.
    expect(notCalculated.summary.notCalculated).toBe(1);
  });

  it("the re-import note's sheet is as an import writes it: the tag says where it came from and its fingerprint matches", async () => {
    const { byTitle } = await made();
    const { findSheets, sheetSource, sheetAttributes } = await import("../../../web/src/components/notes/mdx/sheetSrc");
    const { importedHash } = await import("../../../web/src/components/notes/mdx/sheetImport");
    const [span] = findSheets(byTitle.get("Sheet: re-import")!);
    const attributes = sheetAttributes(span.tag);
    expect(attributes).toMatchObject({ source: "orders.xlsx", sheet: "Orders", range: "A1:J8" });
    expect(attributes.imported).toBe(await importedHash(sheetSource(span)));
    expect(sheetSource(span).formulas).toContain("C8 carried =SUBTOTAL(109,$C$2:$C$7)");
  });
});
