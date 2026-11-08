// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SheetDialog, type SheetEditSource } from "./SheetDialog";

afterEach(cleanup);

const BUDGET: SheetEditSource = {
  kind: "edit",
  csv: "Item,Qty,Price,Total\nPens,12,1.5,18\nPaper,3,4,12\nSum,15,,30",
  formulas: "D2 =B2*C2\nD3 =B3*C3\nB4 =SUM(B2:B3)\nD4 =SUM(D2:D3)",
};

function open(source: SheetEditSource = { kind: "new" }) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<SheetDialog open source={source} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

const grid = () => screen.getByRole("grid");
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(grid(), { key, ...init });
const button = (name: string) => screen.getByRole("button", { name });
const cells = () => screen.getAllByRole("row").map((row) => within(row));
function typeInto(text: string, then: "Enter" | "Tab" = "Enter") {
  press(text[0]);
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: then });
}
const cell = (row: number, col: number) => screen.getAllByRole("row")[row].querySelectorAll('[role="gridcell"]')[col] as HTMLElement;
const within = (row: HTMLElement) => ({ text: () => [...row.querySelectorAll('[role="gridcell"]')].map((c) => c.textContent) });

describe("SheetDialog: opening", () => {
  it("opens a new sheet as an empty grid with the keyboard in it, and will not save nothing", () => {
    open();

    expect(screen.getByRole("heading", { name: "New sheet" })).toBeTruthy();
    expect(document.activeElement).toBe(grid());
    expect((button("Save sheet") as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens a sheet to change as its grid, the formulas calculated, and says nothing is wrong", () => {
    open(BUDGET);

    expect(screen.getByRole("heading", { name: "Edit sheet" })).toBeTruthy();
    expect(cells()[4].text()).toEqual(["Sum", "15", "", "30"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens a Markdown table's cells as a sheet", () => {
    open({ kind: "promote", rows: [["A", "B"], ["1", "2"]] });

    expect(cells()[2].text()).toEqual(["1", "2"]);
  });

  it("says when a line of the formulas block is not a formula, and that saving leaves it out", () => {
    open({ kind: "edit", csv: "A\n1", formulas: "this is not one\nA2 =1+1" });

    expect(screen.getByText(/\(line 1\) is not a cell and a formula/).textContent).toContain("left out when you save");
  });

  it("shows the active cell's address and what is in it, a formula as its text", () => {
    open(BUDGET);
    press("ArrowDown");
    press("ArrowRight", { metaKey: true });

    const line = screen.getByTestId("sheet-formula-line");
    expect(line.textContent).toContain("D2");
    expect(line.textContent).toContain("=B2*C2");
  });

  it("says what could not be calculated, in the formula line", () => {
    open({ kind: "edit", csv: "A,B\n1,", formulas: "B2 =FILTER(A2,TRUE)" });
    press("ArrowDown");
    press("ArrowRight");

    expect(screen.getByTestId("sheet-formula-line").textContent).toContain("Not calculated");
  });
});

describe("SheetDialog: saving", () => {
  it("gives back the two blocks as they were when nothing changed", () => {
    const { onSaved } = open(BUDGET);

    fireEvent.click(button("Save sheet"));

    expect(onSaved).toHaveBeenCalledWith({ csv: BUDGET.kind === "edit" ? BUDGET.csv : "", formulas: BUDGET.kind === "edit" ? BUDGET.formulas : "" });
  });

  it("gives back a sheet typed from nothing, trailing empty rows and columns left out", () => {
    const { onSaved } = open();

    typeInto("Item", "Tab");
    typeInto("Qty");
    fireEvent.click(button("Save sheet"));

    expect(onSaved).toHaveBeenCalledWith({ csv: "Item,Qty", formulas: "" });
  });

  it("saves a cell that is still being typed in, on Ctrl+S", () => {
    const { onSaved } = open();
    press("H");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Heading" } });

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });

    expect(onSaved).toHaveBeenCalledWith({ csv: "Heading", formulas: "" });
  });

  it("says why a sheet with an empty first row cannot be saved, and does not save it", () => {
    const { onSaved } = open();
    press("ArrowDown");
    typeInto("1");

    fireEvent.click(button("Save sheet"));

    expect(screen.getByRole("alert").textContent).toContain("Row 1 holds the column names");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("SheetDialog: leaving", () => {
  it("closes at once when nothing was changed, on Cancel or Escape", () => {
    const { onClose } = open(BUDGET);

    fireEvent.click(button("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(grid(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("asks before throwing away changes, and a change can be kept or discarded", () => {
    const { onClose } = open(BUDGET);
    typeInto("Pencils");

    fireEvent.click(button("Cancel"));
    expect(screen.getByRole("status").textContent).toContain("Discard your changes");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(button("Keep editing"));
    expect(screen.queryByText(/Discard your changes/)).toBeNull();

    fireEvent.click(button("Cancel"));
    fireEvent.click(button("Discard"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a cell on Escape without closing the dialog", () => {
    const { onClose } = open(BUDGET);
    press("F2");

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("SheetDialog: rows and columns", () => {
  const savedWith = (source: SheetEditSource) => {
    const { onSaved } = open(source);
    return { onSaved, save: () => fireEvent.click(button("Save sheet")), saved: () => onSaved.mock.lastCall![0] as { csv: string; formulas: string } };
  };

  it("puts a row above the selected one, moving the formulas that read the rows below", () => {
    const { save, saved } = savedWith(BUDGET);
    press("ArrowDown", { ctrlKey: false });
    press("ArrowDown");

    fireEvent.click(button("Row above"));
    save();

    expect(saved().csv).toBe("Item,Qty,Price,Total\nPens,12,1.5,18\n,,,\nPaper,3,4,12\nSum,15,,30");
    expect(saved().formulas).toBe("D2 =B2*C2\nD4 =B4*C4\nB5 =SUM(B2:B4)\nD5 =SUM(D2:D4)");
  });

  it("puts a row below, and selects it", () => {
    const { save, saved } = savedWith(BUDGET);
    press("ArrowDown");

    fireEvent.click(button("Row below"));
    expect(screen.getByTestId("sheet-formula-line").textContent).toContain("A3");
    save();

    expect(saved().csv).toBe("Item,Qty,Price,Total\nPens,12,1.5,18\n,,,\nPaper,3,4,12\nSum,15,,30");
  });

  it("puts in as many rows as are selected", () => {
    const { save, saved } = savedWith(BUDGET);
    press("ArrowDown");
    press("ArrowDown", { shiftKey: true });

    fireEvent.click(button("Row above"));
    save();

    expect(saved().csv.split("\n")).toHaveLength(6); // the four rows it had, and two more
  });

  it("deletes the selected row, shrinking the totals that spanned it", () => {
    const { save, saved } = savedWith(BUDGET);
    press("ArrowDown");

    fireEvent.click(button("Delete row"));
    save();

    expect(saved().csv).toBe("Item,Qty,Price,Total\nPaper,3,4,12\nSum,3,,12");
    expect(saved().formulas).toBe("D2 =B2*C2\nB3 =SUM(B2:B2)\nD3 =SUM(D2:D2)");
  });

  it("puts a column in, moving the formulas that read the columns to its right", () => {
    const { save, saved } = savedWith(BUDGET);
    press("ArrowRight");

    fireEvent.click(button("Column left"));
    save();

    expect(saved().csv.split("\n")[0]).toBe("Item,,Qty,Price,Total");
    expect(saved().formulas).toBe("E2 =C2*D2\nE3 =C3*D3\nC4 =SUM(C2:C3)\nE4 =SUM(E2:E3)");
  });

  it("deletes a column, and a formula that read it shows #REF!", () => {
    const { save, saved } = savedWith(BUDGET);
    press("ArrowRight");

    fireEvent.click(button("Delete column"));
    save();

    expect(saved().csv.split("\n")[1]).toBe("Pens,1.5,#REF!");
  });

  it("goes back a step with Undo and forward again with Redo", () => {
    open(BUDGET);
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(true);
    typeInto("Pencils");
    expect(cell(1, 0).textContent).toBe("Pencils");

    fireEvent.click(button("Undo"));
    expect(cell(1, 0).textContent).toBe("Item");
    expect((button("Redo") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button("Redo"));
    expect(cell(1, 0).textContent).toBe("Pencils");
  });

  it("undoes and redoes from the keyboard", () => {
    open(BUDGET);
    typeInto("Pencils");

    press("z", { metaKey: true });
    expect(cell(1, 0).textContent).toBe("Item");
    press("z", { metaKey: true, shiftKey: true });
    expect(cell(1, 0).textContent).toBe("Pencils");
  });
});
