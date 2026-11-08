import { describe, expect, it } from "vitest";
import {
  calculateDraft,
  clearCells,
  commitInput,
  deleteColumn,
  deleteRow,
  draftFromSource,
  draftToSource,
  emptyDraft,
  formatClipboard,
  formatCsv,
  insertColumn,
  insertRow,
  parseClipboard,
  pasteBlock,
  rangeFromClipboard,
  setCell,
  setTotals,
  trimDraft,
  type Draft,
} from "./sheetDraft";
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from "./sheetFormula";

const draft = (rows: string[][]): Draft => ({ rows, columns: rows[0].length });

const BUDGET = draft([
  ["Region", "Units", "Price", "Revenue"],
  ["West", "120", "9.5", "=B2*C2"],
  ["East", "80", "9.5", "=B3*C3"],
  ["Total", "=SUM(B2:B3)", "", "=SUM(D2:D3)"],
]);

describe("draftFromSource", () => {
  it("puts each formula where its cell is, over the value the CSV holds there", () => {
    const read = draftFromSource("Region,Units,Price,Revenue\nWest,120,9.5,1140\nEast,80,9.5,760", "D2 =B2*C2\nD3 =B3*C3");
    expect(read.rows).toEqual([
      ["Region", "Units", "Price", "Revenue"],
      ["West", "120", "9.5", "=B2*C2"],
      ["East", "80", "9.5", "=B3*C3"],
    ]);
  });

  it("grows the grid to hold a formula below the last CSV row", () => {
    const read = draftFromSource("Units\n10\n20", "A4 =SUM(A2:A3)");
    expect(read.rows.map((row) => row[0])).toEqual(["Units", "10", "20", "=SUM(A2:A3)"]);
  });

  it("holds a text that begins with an equals sign as text, with the apostrophe Excel uses", () => {
    expect(draftFromSource("Note\n=not a formula", "").rows[1][0]).toBe("'=not a formula");
  });

  it("is an empty sheet to type in when there is no CSV", () => {
    expect(draftFromSource("", "")).toEqual(emptyDraft());
  });
});

describe("draftToSource", () => {
  it("writes the CSV with each formula's value in its cell, and the formulas beside it", () => {
    const written = draftToSource(BUDGET);
    expect(written).toEqual({
      ok: true,
      source: {
        csv: "Region,Units,Price,Revenue\nWest,120,9.5,1140\nEast,80,9.5,760\nTotal,200,,1900",
        formulas: "D2 =B2*C2\nD3 =B3*C3\nB4 =SUM(B2:B3)\nD4 =SUM(D2:D3)",
      },
    });
  });

  it("reads back as the same draft", () => {
    const written = draftToSource(BUDGET);
    if (!written.ok) throw new Error(written.error);
    expect(draftFromSource(written.source.csv, written.source.formulas)).toEqual(BUDGET);
  });

  it("leaves out the empty rows and columns at the end", () => {
    const written = draftToSource(draft([["A", "B", "", ""], ["1", "2", "", ""], ["", "", "", ""], ["", "", "", ""]]));
    expect(written).toEqual({ ok: true, source: { csv: "A,B\n1,2", formulas: "" } });
  });

  it("keeps an empty row between two that are not", () => {
    const written = draftToSource(draft([["A"], ["1"], [""], ["3"]]));
    expect(written).toEqual({ ok: true, source: { csv: "A\n1\n\n3", formulas: "" } });
  });

  it("puts a cell with a comma, a quote or a line break in quotes", () => {
    expect(formatCsv([['a, b', 'say "hi"', "x"]])).toBe('"a, b","say ""hi""",x');
    expect(formatCsv([["line\nbreak"]])).toBe('"line\nbreak"');
  });

  it("writes a text that begins with an equals sign as the text, without its apostrophe", () => {
    const written = draftToSource(draft([["Note"], ["'=just text"]]));
    expect(written).toEqual({ ok: true, source: { csv: "Note\n=just text", formulas: "" } });
  });

  it("writes #NAME? where the engine cannot calculate a formula, and #DIV/0! where it can and the answer is an error", () => {
    const written = draftToSource(draft([["A", "B"], ["=FILTER(A1:A1,TRUE)", "=1/0"]]));
    expect(written).toMatchObject({ ok: true, source: { csv: "A,B\n#NAME?,#DIV/0!" } });
  });

  it("refuses a sheet with nothing in it", () => {
    expect(draftToSource(emptyDraft())).toMatchObject({ ok: false });
  });

  it("refuses a sheet whose first row is empty while others are not, which would move every row up", () => {
    const written = draftToSource(draft([["", ""], ["1", "2"]]));
    expect(written).toMatchObject({ ok: false, error: expect.stringContaining("Row 1") });
  });
});

describe("calculateDraft", () => {
  it("shows each formula's value and keeps what it came to", () => {
    const calculated = calculateDraft(BUDGET);
    expect(calculated.sheet.rows[3]).toEqual(["Total", "200", "", "1900"]);
    expect(calculated.formulas.get("B4")).toBe("=SUM(B2:B3)");
    expect(calculated.results.get("D2")?.value).toBe(1140);
  });
});

describe("setCell and clearCells", () => {
  it("changes one cell, keeps the other rows as they were, and trims what was typed", () => {
    const next = setCell(BUDGET, 1, 0, "  North \n");
    expect(next.rows[1][0]).toBe("North");
    expect(next.rows[2]).toBe(BUDGET.rows[2]);
  });

  it("is the same draft when nothing changes", () => {
    expect(setCell(BUDGET, 1, 0, "West")).toBe(BUDGET);
    expect(setCell(BUDGET, 9, 0, "x")).toBe(BUDGET);
  });

  it("clears a rectangle, whichever corner it is given from", () => {
    const next = clearCells(BUDGET, { row: 2, col: 1 }, { row: 1, col: 0 });
    expect(next.rows[1]).toEqual(["", "", "9.5", "=B2*C2"]);
    expect(next.rows[2]).toEqual(["", "", "9.5", "=B3*C3"]);
    expect(next.rows[3]).toBe(BUDGET.rows[3]);
  });

  it("is the same draft when the cells are already empty", () => {
    expect(clearCells(BUDGET, { row: 3, col: 2 }, { row: 3, col: 2 })).toBe(BUDGET);
  });
});

describe("inserting and deleting rows", () => {
  it("moves the formulas that point below a new row, and grows the range that spans it", () => {
    const next = insertRow(BUDGET, 2);
    expect(next.rows).toHaveLength(5);
    expect(next.rows[2]).toEqual(["", "", "", ""]);
    expect(next.rows[3]).toEqual(["East", "80", "9.5", "=B4*C4"]);
    expect(next.rows[4]).toEqual(["Total", "=SUM(B2:B4)", "", "=SUM(D2:D4)"]);
  });

  it("does not grow a total over a row put in just below its range", () => {
    expect(insertRow(BUDGET, 3).rows[4]).toEqual(["Total", "=SUM(B2:B3)", "", "=SUM(D2:D3)"]);
  });

  it("shrinks the ranges over a deleted row, and shows #REF! where a formula pointed at it", () => {
    const next = deleteRow(BUDGET, 1);
    expect(next.rows).toHaveLength(3);
    expect(next.rows[1]).toEqual(["East", "80", "9.5", "=B2*C2"]);
    expect(next.rows[2]).toEqual(["Total", "=SUM(B2:B2)", "", "=SUM(D2:D2)"]);
    expect(calculateDraft(deleteRow(deleteRow(BUDGET, 1), 1)).sheet.rows[1]).toEqual(["Total", "#REF!", "", "#REF!"]);
  });

  it("empties the last row left instead of removing it", () => {
    expect(deleteRow(draft([["a", "b"]]), 0).rows).toEqual([["", ""]]);
  });

  it("stops at the sheet's limit", () => {
    const tall = { rows: Array.from({ length: MAX_SHEET_ROWS }, () => [""]), columns: 1 };
    expect(insertRow(tall, 1)).toBe(tall);
  });
});

describe("inserting and deleting columns", () => {
  it("moves the formulas that point right of a new column, and the cells that hold them", () => {
    const next = insertColumn(BUDGET, 1);
    expect(next.columns).toBe(5);
    expect(next.rows[1]).toEqual(["West", "", "120", "9.5", "=C2*D2"]);
    expect(next.rows[3]).toEqual(["Total", "", "=SUM(C2:C3)", "", "=SUM(E2:E3)"]);
  });

  it("takes a column out, showing #REF! where a formula pointed at it", () => {
    const next = deleteColumn(BUDGET, 1);
    expect(next.columns).toBe(3);
    expect(next.rows[1]).toEqual(["West", "9.5", "=#REF!*B2"]);
  });

  it("empties the last column left instead of removing it", () => {
    expect(deleteColumn(draft([["a"], ["b"]]), 0).rows).toEqual([[""], [""]]);
  });

  it("stops at the sheet's limit", () => {
    const wide = draft([Array<string>(MAX_SHEET_COLUMNS).fill("")]);
    expect(insertColumn(wide, 0)).toBe(wide);
  });

  it("keeps the sheet's values the same in the cells that moved", () => {
    const before = calculateDraft(BUDGET).sheet.rows;
    const after = calculateDraft(insertColumn(insertRow(BUDGET, 1), 1)).sheet.rows;
    expect(after[4].filter((cell) => cell !== "")).toEqual(before[3].filter((cell) => cell !== ""));
  });
});

describe("column names in formulas, when rows and columns come and go", () => {
  const NAMED: Draft = {
    ...draft([
      ["Region", "Units", "Price", "Revenue"],
      ["West", "120", "9.5", "=[@Units]*[@Price]"],
      ["East", "80", "9.5", "=[@Units]*[@Price]"],
      ["Total", "=SUM([Units])", "", "=SUM([Revenue])"],
    ]),
    totals: true,
  };

  it("keeps a formula that names a column as it was when a row or a column goes in, since it says which column and not where", () => {
    const wider = insertColumn(insertRow(NAMED, 2), 1);
    expect(wider.rows[1][4]).toBe("=[@Units]*[@Price]");
    expect(wider.rows[4][2]).toBe("=SUM([Units])");
  });

  it("calculates the same after a row is put in, though the data are one longer", () => {
    const inserted = insertRow(NAMED, 1);
    expect(inserted.totals).toBe(true);
    const withData = setCell(setCell(setCell(setCell(inserted, 1, 0, "North"), 1, 1, "10"), 1, 2, "2"), 1, 3, "=[@Units]*[@Price]");
    const { sheet } = calculateDraft(withData);
    expect(sheet.rows[1][3]).toBe("20");
    expect(sheet.rows[4][3]).toBe("1920");
  });

  it("makes a formula that names a column that is deleted #REF!", () => {
    const { sheet } = calculateDraft(deleteColumn(NAMED, 1));
    expect(sheet.rows[3][2]).toBe("#REF!");
  });
});

describe("pasteBlock", () => {
  it("fills cells from the corner, and grows the grid to hold them", () => {
    const { draft: next, cut } = pasteBlock(draft([["a", "b"], ["c", "d"]]), 1, 1, [["1", "2"], ["3", "4"]]);
    expect(cut).toBe(false);
    expect(next.rows).toEqual([
      ["a", "b", ""],
      ["c", "1", "2"],
      ["", "3", "4"],
    ]);
    expect(next.columns).toBe(3);
  });

  it("leaves off what would pass the sheet's size, and says so", () => {
    const { draft: next, cut } = pasteBlock(draft([["a"]]), 0, MAX_SHEET_COLUMNS - 1, [["1", "2"]]);
    expect(cut).toBe(true);
    expect(next.columns).toBe(MAX_SHEET_COLUMNS);
    expect(next.rows[0][MAX_SHEET_COLUMNS - 1]).toBe("1");
  });
});

describe("the clipboard", () => {
  it("reads cells split by tabs and rows by line breaks, as a spreadsheet copies them", () => {
    expect(parseClipboard("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("reads a quoted cell with a tab, a line break and a quote in it", () => {
    expect(parseClipboard('"a\tb"\t"two\nlines"\t"say ""hi"""')).toEqual([["a\tb", "two\nlines", 'say "hi"']]);
  });

  it("keeps an empty cell at the end of a row", () => {
    expect(parseClipboard("a\t\nb\tc")).toEqual([["a", ""], ["b", "c"]]);
  });

  it("is a single cell for a text with no tab or line break", () => {
    expect(parseClipboard("just text")).toEqual([["just text"]]);
    expect(parseClipboard("")).toEqual([]);
  });

  it("writes cells so that reading them gives the same back", () => {
    const rows = [["a", "b\tc"], ['say "hi"', "two\nlines"]];
    expect(parseClipboard(formatClipboard(rows))).toEqual(rows);
  });
});

describe("trimDraft and commitInput", () => {
  it("keeps one cell of a sheet with nothing in it", () => {
    expect(trimDraft(emptyDraft())).toEqual({ rows: [[""]], columns: 1 });
  });

  it("is the same draft when there is nothing to trim", () => {
    expect(trimDraft(BUDGET)).toBe(BUDGET);
  });

  it("puts what was typed on one line with no space at either end", () => {
    expect(commitInput("  a\r\n b  ")).toBe("a b");
  });
});


describe("carried formulas", () => {
  const CSV = "Item,Price,Looked up,Plus one\nPens,1.5,99,100\nPaper,4,7,8";
  const FORMULAS = "C2 carried =XLOOKUP(A2,F:F,G:G)\nD2 =C2+1\nC3 carried =XLOOKUP(A3,F:F,G:G)\nD3 =C3+1";
  const loaded = () => draftFromSource(CSV, FORMULAS);

  it("keeps the formula as the cell's text and the value the CSV holds as what it carries", () => {
    const draft = loaded();
    expect(draft.rows[1]).toEqual(["Pens", "1.5", "=XLOOKUP(A2,F:F,G:G)", "=C2+1"]);
    expect(draft.carried?.[1]).toEqual([null, null, "99", null]);
    expect(draft.carried?.[2]).toEqual([null, null, "7", null]);
  });

  it("has nothing carried when no formula is", () => {
    expect(draftFromSource("A\n1", "A3 =A2+1").carried).toBeUndefined();
  });

  it("shows a carried cell's value, and calculates what reads it from that", () => {
    const calculated = calculateDraft(loaded());
    expect(calculated.sheet.rows[1]).toEqual(["Pens", "1.5", "99", "100"]);
    expect([...calculated.carried]).toEqual(["C2", "C3"]);
    expect(calculated.results.get("D2")).toEqual({ value: 100, unsupported: [] });
  });

  it("is saved as it was: marked carried, with its value, and not calculated", () => {
    const written = draftToSource(loaded());
    expect(written).toEqual({ ok: true, source: { csv: CSV, formulas: FORMULAS } });
  });

  it("becomes an ordinary formula when it is typed over with another, calculated or not calculated like any", () => {
    const edited = setCell(loaded(), 1, 2, "=FILTER(A2,TRUE)");
    expect(edited.carried?.[1][2]).toBeNull();
    expect(edited.carried?.[2][2]).toBe("7");
    expect(draftToSource(edited)).toMatchObject({ ok: true, source: { csv: expect.stringContaining("Pens,1.5,#NAME?,#NAME?") } });
  });

  it("keeps a carried cell that is typed over with the text it already has", () => {
    const draft = loaded();
    expect(setCell(draft, 1, 2, " =XLOOKUP(A2,F:F,G:G) ")).toBe(draft);
  });

  it("is no longer carried once the cell is cleared or pasted over", () => {
    expect(clearCells(loaded(), { row: 1, col: 2 }, { row: 1, col: 2 }).carried?.[1][2]).toBeNull();
    expect(pasteBlock(loaded(), 2, 2, [["5"]]).draft.carried?.[2][2]).toBeNull();
    expect(pasteBlock(loaded(), 2, 2, [["5"]]).draft.carried?.[1][2]).toBe("99");
  });

  it("goes when its last cell does, so the draft has none", () => {
    const one = draftFromSource("A,B\n1,2", "B2 carried =XLOOKUP(A2,F:F,G:G)");
    expect(one.carried).toBeDefined();
    expect(setCell(one, 1, 1, "3").carried).toBeUndefined();
  });

  it("moves with its row and its column, and its formula moves with it", () => {
    const below = insertRow(loaded(), 1);
    expect(below.rows[2][2]).toBe("=XLOOKUP(A3,F:F,G:G)");
    expect(below.carried?.[2][2]).toBe("99");
    expect(below.carried?.[1]).toEqual([null, null, null, null]);
    expect(below.rows[2][3]).toBe("=C3+1");

    const right = insertColumn(loaded(), 1);
    expect(right.carried?.[1]).toEqual([null, null, null, "99", null]);
    expect(right.rows[1][3]).toBe("=XLOOKUP(A2,G:G,H:H)");

    const gone = deleteRow(loaded(), 1);
    expect(gone.carried?.[1]).toEqual([null, null, "7", null]);
    expect(gone.carried).toHaveLength(2);

    const narrower = deleteColumn(loaded(), 1);
    expect(narrower.carried?.[1]).toEqual([null, "99", null]);
  });

  it("keeps the carried values of the rows that are left when empty ones at the foot are trimmed", () => {
    const wide = { ...loaded(), rows: [...loaded().rows, ["", "", "", ""]], carried: [...(loaded().carried ?? []), [null, null, null, null]] };
    expect(trimDraft(wide).carried).toHaveLength(3);
  });
});


describe("rangeFromClipboard", () => {
  const EXCEL_HTML = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table><tr><td>a</td></tr></table></html>';

  it("is the cells of text split by tabs, every row with as many", () => {
    expect(rangeFromClipboard("Item\tQty\r\nPens\t12\r\n")).toEqual([
      ["Item", "Qty"],
      ["Pens", "12"],
    ]);
  });

  it("keeps an empty cell in the middle or at the end of a row", () => {
    expect(rangeFromClipboard("a\t\tc\nd\te\t")).toEqual([
      ["a", "", "c"],
      ["d", "e", ""],
    ]);
  });

  it("is a single column too, when the HTML of the copy says Excel made it", () => {
    expect(rangeFromClipboard("a\nb\nc", EXCEL_HTML)).toEqual([["a"], ["b"], ["c"]]);
    expect(rangeFromClipboard("a\nb\nc")).toBeNull();
  });

  it("pads the rows of a copy from Excel to the widest", () => {
    expect(rangeFromClipboard("a\tb\nc", EXCEL_HTML)).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
  });

  it("is not any other text: no tab, one cell, rows of different lengths, text indented with tabs", () => {
    for (const text of ["", "Just a sentence.", "one\ntwo", "single", "a\tb\nc", "\tindented\n\tmore", "a\tb\n\n"]) {
      expect(rangeFromClipboard(text), JSON.stringify(text)).toBeNull();
    }
  });

  it("is not a range too big for a sheet", () => {
    expect(rangeFromClipboard(Array.from({ length: 5002 }, (_, i) => `${i}\tx`).join("\n"))).toBeNull();
    expect(rangeFromClipboard(Array.from({ length: 101 }, (_, i) => String(i)).join("\t") + "\n1\t2")).toBeNull();
  });
});


describe("the totals row", () => {
  const rows = [
    ["Region", "Units"],
    ["West", "120"],
    ["Total", "=SUM([Units])"],
  ];

  it("is data when the sheet does not say its last row is a totals row, so a total there reads itself", () => {
    expect(calculateDraft(draft(rows)).sheet.rows[2][1]).toBe("#NAME?");
  });

  it("is left out of a column named in a formula when it does, so the total reads the rows above it", () => {
    expect(calculateDraft({ ...draft(rows), totals: true }).sheet.rows[2][1]).toBe("120");
  });

  it("is set and cleared with setTotals, which leaves an equal draft alone", () => {
    const plain = draft(rows);
    const on = setTotals(plain, true);
    expect(on.totals).toBe(true);
    expect(setTotals(on, true)).toBe(on);
    expect(setTotals(plain, false)).toBe(plain);
    expect("totals" in setTotals(on, false)).toBe(false);
  });

  it("is kept through every change to the rows and columns, and written with the blocks", () => {
    const on = { ...draft(rows), totals: true };
    for (const changed of [setCell(on, 1, 0, "East"), insertRow(on, 1), deleteRow(on, 1), insertColumn(on, 1), deleteColumn(on, 1), pasteBlock(on, 0, 0, [["x"]]).draft, trimDraft(on), clearCells(on, { row: 1, col: 0 }, { row: 1, col: 0 })]) {
      expect(changed.totals).toBe(true);
    }
    expect(draftToSource(on)).toMatchObject({ ok: true, source: { totals: true } });
    expect(draftToSource(draft(rows))).toEqual(expect.not.objectContaining({ source: expect.objectContaining({ totals: true }) }));
  });

  it("is read back by draftFromSource", () => {
    expect(draftFromSource("Region,Units\nWest,120\nTotal,", "B3 =SUM([Units])", true).totals).toBe(true);
    expect(draftFromSource("Region,Units\nWest,120", "").totals).toBeUndefined();
    expect(draftFromSource("", "", true).totals).toBe(true);
  });
});
