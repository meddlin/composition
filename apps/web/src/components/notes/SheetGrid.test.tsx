// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Draft } from "./mdx/sheetDraft";
import { SheetGrid, addressOf, cellSelection, type Selection } from "./SheetGrid";

afterEach(cleanup);

const draft = (rows: string[][]): Draft => ({ rows, columns: rows[0].length });
const BUDGET = draft([
  ["Item", "Qty", "Price", "Total"],
  ["Pens", "12", "1.5", "=B2*C2"],
  ["Paper", "3", "4", "=B3*C3"],
]);

type Spies = { onSave: (draft: Draft) => void; onNotice: (message: string | null) => void; onUndo: () => void; onRedo: () => void };

function Harness({ initial, spies }: { initial: Draft; spies?: Partial<Spies> }) {
  const [current, setCurrent] = useState(initial);
  const [selection, setSelection] = useState<Selection>(cellSelection({ row: 0, col: 0 }));
  const editing = useRef(false);
  return (
    <>
      <SheetGrid
        draft={current}
        selection={selection}
        onSelect={setSelection}
        onChange={setCurrent}
        onUndo={spies?.onUndo ?? vi.fn()}
        onRedo={spies?.onRedo ?? vi.fn()}
        onNotice={spies?.onNotice ?? vi.fn()}
        onSave={spies?.onSave ?? vi.fn()}
        editingRef={editing}
      />
      <output data-testid="draft">{JSON.stringify(current.rows)}</output>
      <output data-testid="active">{addressOf(selection.focus)}</output>
      <output data-testid="anchor">{addressOf(selection.anchor)}</output>
    </>
  );
}

const grid = () => screen.getByRole("grid");
const rowsOf = () => JSON.parse(screen.getByTestId("draft").textContent!) as string[][];
const active = () => screen.getByTestId("active").textContent;
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(grid(), { key, ...init });
const cell = (address: string) => {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(address)!;
  const col = letters.charCodeAt(0) - 65;
  return within(screen.getAllByRole("row")[Number(row)]).getAllByRole("gridcell")[col];
};
/** Types `text` into the active cell the way a person does: the first key starts the edit, the rest goes in the box. */
function typeInto(text: string) {
  press(text[0]);
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: text } });
  return box;
}

describe("SheetGrid: drawing", () => {
  it("is a grid of cells with column letters and row numbers, each cell as it is shown", () => {
    render(<Harness initial={BUDGET} />);

    expect(grid().getAttribute("aria-rowcount")).toBe("4");
    expect(grid().getAttribute("aria-colcount")).toBe("5");
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["", "A", "B", "C", "D"]);
    expect(cell("D2").textContent).toBe("18"); // =B2*C2
    expect(cell("D3").textContent).toBe("12");
    expect(screen.getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["1", "2", "3"]);
  });

  it("shows an error where a formula comes to one, and says what could not be calculated", () => {
    render(<Harness initial={draft([["A", "B"], ["1", "=1/0"], ["", "=FILTER(A2,TRUE)"]])} />);

    expect(cell("B2").textContent).toBe("#DIV/0!");
    expect(cell("B3").textContent).toBe("#NAME?");
    expect(cell("B3").getAttribute("title")).toContain("Not calculated");
  });

  it("draws only the rows in view of a long sheet", () => {
    const long = draft(Array.from({ length: 5001 }, (_, i) => [String(i), String(i * 2)]));
    render(<Harness initial={long} />);

    expect(screen.getAllByRole("row").length).toBeLessThan(80);
    expect(grid().getAttribute("aria-rowcount")).toBe("5002");
  });
});

describe("SheetGrid: moving", () => {
  it("is on the first cell, and the arrow keys move the highlight, not past the edge", () => {
    render(<Harness initial={BUDGET} />);
    expect(active()).toBe("A1");

    press("ArrowUp");
    press("ArrowLeft");
    expect(active()).toBe("A1");
    press("ArrowDown");
    press("ArrowRight");
    expect(active()).toBe("B2");
    press("ArrowDown");
    press("ArrowDown");
    expect(active()).toBe("B3");
    expect(grid().getAttribute("aria-activedescendant")).toBe(cell("B3").id);
  });

  it("goes to the edges with Ctrl or Cmd, and to the ends of the row with Home and End", () => {
    render(<Harness initial={BUDGET} />);

    press("ArrowDown", { metaKey: true });
    press("ArrowRight", { ctrlKey: true });
    expect(active()).toBe("D3");
    press("Home");
    expect(active()).toBe("A3");
    press("End");
    expect(active()).toBe("D3");
    press("Home", { metaKey: true });
    expect(active()).toBe("A1");
  });

  it("moves with Tab and Shift+Tab, wrapping to the next row, and lets Tab out of the grid at its ends", () => {
    render(<Harness initial={BUDGET} />);

    expect(fireEvent.keyDown(grid(), { key: "Tab" })).toBe(false); // handled here
    expect(active()).toBe("B1");
    press("End");
    press("Tab");
    expect(active()).toBe("A2");
    press("Tab", { shiftKey: true });
    expect(active()).toBe("D1");

    press("End", { metaKey: true });
    expect(fireEvent.keyDown(grid(), { key: "Tab" })).toBe(true); // left to the browser: on to the next control
    expect(active()).toBe("D3");
    press("Home", { metaKey: true });
    expect(fireEvent.keyDown(grid(), { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("moves down with Enter and up with Shift+Enter", () => {
    render(<Harness initial={BUDGET} />);

    press("Enter");
    press("Enter");
    expect(active()).toBe("A3");
    press("Enter", { shiftKey: true });
    expect(active()).toBe("A2");
  });

  it("extends a selection with Shift and the arrows, and selects everything with Ctrl+A", () => {
    render(<Harness initial={BUDGET} />);

    press("ArrowRight", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(screen.getByTestId("anchor").textContent).toBe("A1");
    expect(active()).toBe("B2");
    expect(cell("A2").getAttribute("aria-selected")).toBe("true");
    expect(cell("C2").getAttribute("aria-selected")).toBe("false");

    press("a", { ctrlKey: true });
    expect(active()).toBe("D3");
    expect(screen.getByTestId("anchor").textContent).toBe("A1");
  });

  it("selects a cell by a click, and a range by shift-click", () => {
    render(<Harness initial={BUDGET} />);

    fireEvent.mouseDown(cell("C2"));
    expect(active()).toBe("C2");
    fireEvent.mouseDown(cell("D3"), { shiftKey: true });
    expect(screen.getByTestId("anchor").textContent).toBe("C2");
    expect(active()).toBe("D3");
  });

  it("selects a column from its letter and a row from its number", () => {
    render(<Harness initial={BUDGET} />);

    fireEvent.mouseDown(screen.getByRole("columnheader", { name: "B" }));
    expect(screen.getByTestId("anchor").textContent).toBe("B1");
    expect(active()).toBe("B3");

    fireEvent.mouseDown(screen.getAllByRole("rowheader")[1]);
    expect(screen.getByTestId("anchor").textContent).toBe("A2");
    expect(active()).toBe("D2");
  });
});

describe("SheetGrid: editing", () => {
  it("starts a new value when a character is typed, and Enter keeps it and moves down", () => {
    render(<Harness initial={BUDGET} />);
    press("ArrowDown");
    press("ArrowRight");

    const box = typeInto("30");
    fireEvent.keyDown(box, { key: "Enter" });

    expect(rowsOf()[1][1]).toBe("30");
    expect(active()).toBe("B3");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(cell("D2").textContent).toBe("45"); // the formula that reads it was calculated again
  });

  it("keeps it and moves right with Tab, and left with Shift+Tab", () => {
    render(<Harness initial={BUDGET} />);

    fireEvent.keyDown(typeInto("Pencils"), { key: "Tab" });
    expect(rowsOf()[0][0]).toBe("Pencils");
    expect(active()).toBe("B1");
    fireEvent.keyDown(typeInto("Count"), { key: "Tab", shiftKey: true });
    expect(rowsOf()[0][1]).toBe("Count");
    expect(active()).toBe("A1");
  });

  it("returns to where a run of Tabs began when Enter ends the row", () => {
    render(<Harness initial={draft([["", "", ""], ["", "", ""], ["", "", ""]])} />);

    fireEvent.keyDown(typeInto("a"), { key: "Tab" });
    fireEvent.keyDown(typeInto("b"), { key: "Tab" });
    fireEvent.keyDown(typeInto("c"), { key: "Enter" });

    expect(active()).toBe("A2");
    expect(rowsOf()[0]).toEqual(["a", "b", "c"]);
  });

  it("drops the typing on Escape, and keeps the cell as it was", () => {
    render(<Harness initial={BUDGET} />);

    const box = typeInto("zzz");
    fireEvent.keyDown(box, { key: "Escape" });

    expect(rowsOf()[0][0]).toBe("Item");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(active()).toBe("A1");
  });

  it("edits what is in the cell on F2, a formula as its text, and on a double click", () => {
    render(<Harness initial={BUDGET} />);
    press("ArrowDown");
    press("ArrowRight", { metaKey: true });

    press("F2");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("=B2*C2");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    fireEvent.doubleClick(cell("A3"));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Paper");
  });

  it("shows a formula's result once the cell is left, and the formula itself while it is edited", () => {
    render(<Harness initial={draft([["x"], ["2"], [""]])} />);
    press("ArrowDown", { metaKey: true });

    fireEvent.keyDown(typeInto("=A2*21"), { key: "Enter" });

    expect(rowsOf()[2][0]).toBe("=A2*21");
    expect(cell("A3").textContent).toBe("42");
  });

  it("keeps what is typed when something else is clicked, and leaves the selection to the click", () => {
    render(<Harness initial={BUDGET} />);

    typeInto("Pencils");
    fireEvent.mouseDown(cell("C3"));
    fireEvent.blur(screen.getByRole("textbox"));

    expect(rowsOf()[0][0]).toBe("Pencils");
    expect(active()).toBe("C3");
  });

  it("starts the next row when Enter is pressed after typing in the last one", () => {
    render(<Harness initial={draft([["a"], ["b"]])} />);
    press("ArrowDown");

    fireEvent.keyDown(typeInto("c"), { key: "Enter" });

    expect(rowsOf()).toEqual([["a"], ["c"], [""]]);
    expect(active()).toBe("A3");
  });

  it("does not start a row for an Enter that changed nothing", () => {
    render(<Harness initial={draft([["a"], ["b"]])} />);
    press("ArrowDown");
    press("F2");

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(rowsOf()).toHaveLength(2);
  });

  it("trims what was typed to one line with no spaces at the ends", () => {
    render(<Harness initial={BUDGET} />);

    fireEvent.keyDown(typeInto("  Pencils  "), { key: "Enter" });

    expect(rowsOf()[0][0]).toBe("Pencils");
  });
});

describe("SheetGrid: clearing and the clipboard", () => {
  it("clears the selected cells with Delete or Backspace", () => {
    render(<Harness initial={BUDGET} />);
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });

    press("Delete");

    expect(rowsOf()[1]).toEqual(["", "", "1.5", "=B2*C2"]);
    expect(rowsOf()[2]).toEqual(["", "", "4", "=B3*C3"]);
    press("ArrowRight", { metaKey: true });
    press("Backspace");
    expect(rowsOf()[2][3]).toBe("");
  });

  const clipboardOf = (text = "") => {
    const data = { text, set: "" };
    return {
      data,
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? data.text : ""),
        setData: (_type: string, value: string) => {
          data.set = value;
        },
      },
    };
  };

  it("copies the selection as a spreadsheet does, each cell as it is shown", () => {
    render(<Harness initial={BUDGET} />);
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true, metaKey: true });
    press("ArrowDown", { shiftKey: true });
    const { data, clipboardData } = clipboardOf();

    fireEvent.copy(grid(), { clipboardData });

    expect(data.set).toBe("Pens\t12\t1.5\t18\nPaper\t3\t4\t12");
  });

  it("cuts: copies, and clears", () => {
    render(<Harness initial={BUDGET} />);
    press("ArrowDown");
    const { data, clipboardData } = clipboardOf();

    fireEvent.cut(grid(), { clipboardData });

    expect(data.set).toBe("Pens");
    expect(rowsOf()[1][0]).toBe("");
  });

  it("fills cells from a range pasted from Excel, growing the grid to hold it", () => {
    const onNotice = vi.fn();
    render(<Harness initial={draft([["A", "B"], ["", ""]])} spies={{ onNotice }} />);
    press("ArrowDown");
    const { clipboardData } = clipboardOf("1\t2\t3\r\n4\t5\t6\r\n7\t8\t9\r\n");

    fireEvent.paste(grid(), { clipboardData });

    expect(rowsOf()).toEqual([
      ["A", "B", ""],
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
    ]);
    expect(active()).toBe("C4"); // the pasted range is what is selected
    expect(screen.getByTestId("anchor").textContent).toBe("A2");
    expect(onNotice).toHaveBeenCalledWith(null);
  });

  it("fills a selection with one pasted value", () => {
    render(<Harness initial={BUDGET} />);
    press("ArrowDown");
    press("ArrowDown", { shiftKey: true });
    const { clipboardData } = clipboardOf("9");

    fireEvent.paste(grid(), { clipboardData });

    expect(rowsOf().map((row) => row[0])).toEqual(["Item", "9", "9"]);
  });

  it("does nothing for an empty clipboard", () => {
    render(<Harness initial={BUDGET} />);

    fireEvent.paste(grid(), { clipboardData: clipboardOf("").clipboardData });

    expect(rowsOf()).toEqual(BUDGET.rows);
  });
});

describe("SheetGrid: undo and save", () => {
  it("asks for undo and redo with Ctrl or Cmd+Z, Shift+Z and Y", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<Harness initial={BUDGET} spies={{ onUndo, onRedo }} />);

    press("z", { metaKey: true });
    press("z", { ctrlKey: true, shiftKey: true });
    press("y", { ctrlKey: true });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it("asks to save with Ctrl or Cmd+S, with what is being typed included", () => {
    const onSave = vi.fn();
    render(<Harness initial={BUDGET} spies={{ onSave }} />);

    press("s", { metaKey: true });
    expect(onSave).toHaveBeenLastCalledWith(BUDGET);

    const box = typeInto("Pencils");
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    expect(onSave.mock.lastCall![0].rows[0][0]).toBe("Pencils");
  });
});
