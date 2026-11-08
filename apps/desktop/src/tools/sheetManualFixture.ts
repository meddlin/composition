import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createNote, listNotes, updateNoteContent } from "../../../web/src/lib/composition/notesRepo";
import { describeImport, importRange, importedHash, parseRange, rangeText } from "../../../web/src/components/notes/mdx/sheetImport";
import { sheetTag } from "../../../web/src/components/notes/mdx/sheetSrc";
import { readWorkbook } from "../../../web/src/components/notes/mdx/sheetWorkbook";
import { workbooks } from "../../../web/src/components/notes/mdx/sheetManualWorkbooks";

/**
 * The fixture behind the sheet manual test (docs/manual-tests/sheet.md): workbooks to import, made here so the test does not need
 * yours, and a scratch home whose notes hold a sheet of every kind; and `check`, which runs a workbook of yours through the import
 * and says, without printing a cell, how many of its formulas the engine reproduces.
 */

// ---------------------------------------------------------------------------------------------------------------------------
// The notes of the scratch home.
// ---------------------------------------------------------------------------------------------------------------------------

const sheet = (attributes: Record<string, string>, csv: string, formulas: string, totals = false) => sheetTag({ csv, formulas, totals }, attributes);

async function importedOrders(dir: string): Promise<string> {
  const book = await readWorkbook(readFileSync(path.join(dir, "orders.xlsx")));
  const used = book.sheets.find((sheet) => sheet.name === "Orders")?.used ?? "";
  const range = book.read("Orders", used);
  if ("error" in range) throw new Error(range.error);
  const result = importRange(range);
  if (!result.ok) throw new Error(result.error);
  const parsed = parseRange(used);
  return sheetTag(result.source, { source: "orders.xlsx", sheet: "Orders", range: parsed ? rangeText(parsed) : used, imported: await importedHash(result.source) });
}

function noteBodies(imported: string): { title: string; body: string }[] {
  const tour = [
    "# Sheet tour",
    "Each sheet below is a place to try something from the manual test. Point at a sheet to see **Edit sheet**, **Export…**; the caret in a sheet and **Ctrl/Cmd+Shift+G** edits it.",
    "## Formulas and a totals row",
    sheet(
      { title: "Budget", totals: "true" },
      "Region,Units,Price,Revenue\nWest,120,9.5,\nEast,80,9.5,\nNorth,45,20,\nTotal,,,",
      "D2 =[@Units]*[@Price]\nD3 =[@Units]*[@Price]\nD4 =[@Units]*[@Price]\nB5 =SUM([Units])\nD5 =SUM([Revenue])",
      true,
    ),
    "## SUMIFS, a lookup, dates and text",
    sheet(
      { title: "Orders by region" },
      "Region,Amount,Due,Label\nWest,1140,2026-03-04,\nEast,760,2026-03-09,\nWest,900,2026-03-19,\nNorth,215,2026-03-29,\n,,,",
      ["D2", "D3", "D4", "D5"].map((at, i) => `${at} =A${i + 2}&": "&TEXT(B${i + 2},"#,##0")`).join("\n") +
        '\nB6 =SUMIFS(B2:B5,A2:A5,"West")\nC6 =MAX(C2:C5)-MIN(C2:C5)\nA6 ="West total"',
    ),
    "## A long sheet (300 rows: only the rows in view are drawn)",
    sheet(
      { title: "Squares", height: "240" },
      "n,square,running\n" + Array.from({ length: 300 }, (_, i) => `${i + 1},${(i + 1) ** 2},`).join("\n"),
      Array.from({ length: 300 }, (_, i) => `C${i + 2} =SUM(B$2:B${i + 2})`).join("\n"),
    ),
    "## A formula this engine cannot calculate",
    sheet({ title: "Not calculated" }, "Value,Result\n5,\n7,", "B2 =FILTER(A2:A3,A2:A3>5)\nB3 =A3*2"),
    "The end.",
  ];
  const paste = [
    "# Sheet: promote, paste and start",
    "## A Markdown table: put the caret in it and press Ctrl/Cmd+Shift+G",
    "| Item | Qty | Price |\n| --- | ---: | ---: |\n| Pens | 12 | 1.5 |\n| Paper | 3 | 4 |\n| Ink | 8 | 6 |",
    "## Paste a range copied from Excel just below, as text, then choose **Make it a sheet**",
    "",
    "## A new sheet: put the caret on the empty line below and press Ctrl/Cmd+Shift+G",
    "",
  ];
  const reimport = [
    "# Sheet: re-import",
    "This sheet came from `orders.xlsx` (sheet Orders, A1:J8) as the **Import from Excel** button writes it, fingerprint included. Edit the workbook, or the sheet, and use **Re-import**.",
    imported,
    "A formula marked with a dot is **carried**: Excel's value, with the formula kept.",
  ];
  return [
    { title: "Sheet tour", body: tour.join("\n\n") },
    { title: "Sheet: promote, paste and start", body: paste.join("\n\n") },
    { title: "Sheet: re-import", body: reimport.join("\n\n") },
  ];
}

/** Sets up a scratch home: the workbooks in `<home>/workbooks`, and the notes of the test. Refuses a database that already has notes. */
export async function setup(home: string): Promise<string[]> {
  if (listNotes().length > 0) throw new Error("That home already has notes. Use a new --home, or delete the folder.");
  const dir = path.join(home, "workbooks");
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(workbooks())) writeFileSync(path.join(dir, name), bytes);
  const made: string[] = [];
  for (const { title, body } of noteBodies(await importedOrders(dir))) {
    const note = createNote(title);
    updateNoteContent(note.id, `${note.content}\n${body}\n`);
    made.push(title);
  }
  return [`Made ${made.length} notes (${made.join("; ")}) and ${Object.keys(workbooks()).length} workbooks in ${dir}.`];
}

// ---------------------------------------------------------------------------------------------------------------------------
// check: a workbook of yours through the import, without printing a cell.
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * What the import would do with each sheet of each workbook: how many formulas it keeps as formulas, carries and makes values,
 * and why. It prints counts and the names of functions, never a cell value; sheet names only with `names`.
 */
export async function check(files: string[], names: boolean): Promise<string[]> {
  const lines: string[] = [];
  for (const file of files) {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(file);
    } catch {
      lines.push(`${path.basename(file)}: cannot be read.`);
      continue;
    }
    let book;
    try {
      book = await readWorkbook(bytes);
    } catch (error) {
      lines.push(`${path.basename(file)}: ${error instanceof Error ? error.message : "cannot be read as a workbook."}`);
      continue;
    }
    lines.push(`${path.basename(file)}: ${book.sheets.length} sheet(s)`);
    book.sheets.forEach((sheet, i) => {
      const label = names ? `"${sheet.name}"` : `sheet ${i + 1}`;
      if (!sheet.used) {
        lines.push(`  ${label}: empty`);
        return;
      }
      const range = book.read(sheet.name, sheet.used);
      if ("error" in range) {
        lines.push(`  ${label} (${sheet.used}): ${range.error}`);
        return;
      }
      const result = importRange(range);
      if (!result.ok) {
        lines.push(`  ${label} (${sheet.used}): ${result.error}`);
        return;
      }
      lines.push(`  ${label} (${sheet.used}):`, ...describeImport(result.summary).map((line) => `    ${line}`));
    });
  }
  return lines;
}
