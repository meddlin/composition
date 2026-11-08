// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SourceCell, type SourceRange, type Workbook } from "./mdx/sheetImport";
import { MAX_WORKBOOK_BYTES, SheetImportDialog, describeImport } from "./SheetImportDialog";

afterEach(cleanup);

const v = (value: SourceCell["value"]): SourceCell => ({ value });
const f = (formula: string, value: SourceCell["value"]): SourceCell => ({ formula, value });

/** A workbook of two sheets: `Q3`, used range A1:D3, and an empty `Notes`. */
const BOOK: Workbook = {
  sheets: [
    { name: "Q3", used: "A1:D3" },
    { name: "Notes", used: "" },
  ],
  read(sheet, range): SourceRange | { error: string } {
    if (sheet !== "Q3") return { error: "nothing there" };
    const all = [
      [v("Item"), v("Qty"), v("Price"), v("Total")],
      [v("Pens"), v(12), v(1.5), f("B2*C2", 18)],
      [v("Paper"), v(3), v(4), f("FILTER(A3:A3,TRUE)", 12)],
    ];
    if (range === "A1:D3") return { cells: all, origin: { row: 0, col: 0 } };
    if (range === "A1:C3") return { cells: all.map((row) => row.slice(0, 3)), origin: { row: 0, col: 0 } };
    return { error: `The range ${range} is not in the sheet.` };
  },
};

function open(loadWorkbook = vi.fn().mockResolvedValue(BOOK)) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(<SheetImportDialog open loadWorkbook={loadWorkbook} onClose={onClose} onImported={onImported} />);
  return { loadWorkbook, onClose, onImported };
}

const choose = (file: File) => fireEvent.change(screen.getByLabelText("Excel workbook"), { target: { files: [file] } });
const xlsx = (name = "budget.xlsx", bytes = 8) => new File([new Uint8Array(bytes)], name);
const insertButton = () => screen.getByRole("button", { name: "Insert sheet" }) as HTMLButtonElement;

describe("SheetImportDialog", () => {
  it("starts with nothing chosen, and nothing to insert", () => {
    open();

    expect(screen.getByRole("heading", { name: "Import from Excel" })).toBeTruthy();
    expect(insertButton().disabled).toBe(true);
    expect(screen.queryByLabelText("Range")).toBeNull();
  });

  it("reads the file it is given, and offers its first sheet with the range Excel says it uses", async () => {
    const { loadWorkbook } = open();

    choose(xlsx());

    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Range").value).toBe("A1:D3"));
    expect(loadWorkbook).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(screen.getByLabelText<HTMLSelectElement>("Sheet").value).toBe("Q3");
    expect(screen.getByText("budget.xlsx")).toBeTruthy();
  });

  it("says what would come across: the size, and what became of the formulas", async () => {
    open();
    choose(xlsx());

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("3 rows (the first is the header) by 4 columns"));
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("2 formulas");
    expect(text).toContain("1 is kept as a formula");
    expect(text).toContain("1 is carried");
    expect(text).toContain("FILTER");
    expect(insertButton().disabled).toBe(false);
  });

  it("changes what would come across when the range is changed, once it is finished", async () => {
    open();
    choose(xlsx());
    const box = await screen.findByLabelText<HTMLInputElement>("Range");

    fireEvent.change(box, { target: { value: "A1:C3" } });
    expect(screen.getByRole("status").textContent).toContain("by 4 columns"); // not yet read
    fireEvent.blur(box);

    expect(screen.getByRole("status").textContent).toContain("by 3 columns");
    expect(screen.getByRole("status").textContent).toContain("No formulas");
  });

  it("applies a range on Enter too", async () => {
    open();
    choose(xlsx());
    const box = await screen.findByLabelText<HTMLInputElement>("Range");

    fireEvent.change(box, { target: { value: "A1:C3" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(screen.getByRole("status").textContent).toContain("by 3 columns");
  });

  it("says when a range is not one, or not in the sheet, and will not insert it", async () => {
    open();
    choose(xlsx());
    const box = await screen.findByLabelText<HTMLInputElement>("Range");

    fireEvent.change(box, { target: { value: "nonsense" } });
    fireEvent.blur(box);
    expect(screen.getByRole("status").textContent).toContain("Write the range as A1:F40");
    expect(insertButton().disabled).toBe(true);

    fireEvent.change(box, { target: { value: "A1:Z99" } });
    fireEvent.blur(box);
    expect(screen.getByRole("status").textContent).toContain("is not in the sheet");
  });

  it("moves to another sheet's own range, and says an empty sheet has nothing in it", async () => {
    open();
    choose(xlsx());
    await screen.findByLabelText("Range");

    fireEvent.change(screen.getByLabelText("Sheet"), { target: { value: "Notes" } });

    expect(screen.getByRole("status").textContent).toContain("That sheet has nothing in it");
    expect(screen.getByLabelText<HTMLInputElement>("Range").value).toBe("");
    expect(insertButton().disabled).toBe(true);
  });

  it("hands the note the two blocks, where they came from, and a fingerprint of them", async () => {
    const { onImported } = open();
    choose(xlsx("budget.xlsx"));
    await screen.findByLabelText("Range");

    fireEvent.click(insertButton());

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledWith({
      source: { csv: "Item,Qty,Price,Total\nPens,12,1.5,18\nPaper,3,4,12", formulas: "D2 =B2*C2\nD3 carried =FILTER(A3:A3,TRUE)" },
      file: "budget.xlsx",
      sheet: "Q3",
      range: "A1:D3",
      imported: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
  });

  it("says a file that could not be read could not, and keeps nothing from it", async () => {
    open(vi.fn().mockRejectedValue(new Error("This is not a zip file.")));

    choose(xlsx("notes.txt"));

    expect((await screen.findByRole("alert")).textContent).toBe("notes.txt could not be read as an Excel workbook: This is not a zip file.");
    expect(screen.queryByLabelText("Range")).toBeNull();
    expect(insertButton().disabled).toBe(true);
  });

  it("refuses a file too big to read whole, without trying", () => {
    const { loadWorkbook } = open();
    const big = xlsx("huge.xlsx");
    Object.defineProperty(big, "size", { value: MAX_WORKBOOK_BYTES + 1 });

    choose(big);

    expect(screen.getByRole("alert").textContent).toContain("50 MB is the most");
    expect(loadWorkbook).not.toHaveBeenCalled();
  });

  it("closes without importing on Cancel", () => {
    const { onClose, onImported } = open();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onImported).not.toHaveBeenCalled();
  });
});

describe("describeImport", () => {
  const summary = { rows: 40, columns: 6, formulas: 0, calculated: 0, carried: 0, values: 0, unchecked: 0, carriedWhy: [], valuesWhy: [] };

  it("says a sheet of values has no formulas", () => {
    expect(describeImport(summary)).toEqual(["40 rows (the first is the header) by 6 columns.", "No formulas: every cell is the value Excel showed."]);
  });

  it("says what became of each kind of formula, and why, and leaves out the kinds there are none of", () => {
    const lines = describeImport({
      ...summary,
      formulas: 9,
      calculated: 5,
      carried: 2,
      values: 1,
      unchecked: 1,
      carriedWhy: [{ reason: "the function XLOOKUP", count: 2 }],
      valuesWhy: [{ reason: "another sheet or workbook", count: 1 }],
    });
    expect(lines).toEqual([
      "40 rows (the first is the header) by 6 columns.",
      "9 formulas:",
      "5 are kept as formulas, calculated here, where they gave the number Excel saved.",
      "2 are carried: the formula is kept, and the cell shows Excel's value without calculating it again. Why: the function XLOOKUP (2).",
      "1 is kept as a value, because it reads outside the range: another sheet or workbook (1).",
      "1 formula had no value saved by Excel, so could not be checked against one.",
    ]);
  });
});
