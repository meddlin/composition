// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetExportDialog } from "./SheetExportDialog";

const exportFile = vi.hoisted(() => {
  class SaveFileError extends Error {}
  return { canSaveFile: vi.fn(() => true), saveFile: vi.fn<(name: string, data: Uint8Array | string, kind: string) => Promise<string>>(async () => "offered"), SaveFileError };
});
vi.mock("./exportFile", () => exportFile);

const SOURCE = { csv: "Item,Qty,Total,Due\nPens,12,0,2026-03-04\nPaper,3,7,2026-03-09", formulas: "C2 =B2*1.5\nC3 carried =XLOOKUP(A3,F:F,G:G)" };

function open(props: Partial<React.ComponentProps<typeof SheetExportDialog>> = {}) {
  const onClose = vi.fn();
  render(<SheetExportDialog open source={SOURCE} title="Q3 budget" from="budget.xlsx" onClose={onClose} {...props} />);
  return { onClose };
}

beforeEach(() => {
  exportFile.canSaveFile.mockReturnValue(true);
  exportFile.saveFile.mockResolvedValue("offered");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SheetExportDialog", () => {
  it("says what would be written: the size, the formulas, the dates, and what is not kept", () => {
    open();

    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("3 rows (the first is the header) by 4 columns");
    expect(text).toContain("2 formulas written as formulas");
    expect(text).toContain("1 is carried from Excel");
    expect(text).toContain("2 dates written as dates");
    expect(text).toContain("Cell formats");
  });

  it("downloads a workbook named for the caption, whose bytes are a zip", async () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(exportFile.saveFile).toHaveBeenCalledTimes(1));
    const [name, data, kind] = exportFile.saveFile.mock.calls[0];
    expect(name).toBe("Q3 budget.xlsx");
    expect(kind).toBe("xlsx");
    expect([(data as Uint8Array)[0], (data as Uint8Array)[1]]).toEqual([0x50, 0x4b]); // "PK"
    expect(screen.getByRole("status").textContent).toContain("Q3 budget.xlsx was offered to your browser");
  });

  it("downloads CSV of the values the sheet shows, with a byte order mark for Excel", async () => {
    open();
    fireEvent.click(screen.getByLabelText(/CSV/));

    expect(screen.getByRole("dialog").textContent).toContain("formulas calculated, with commas");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(exportFile.saveFile).toHaveBeenCalledTimes(1));
    const [name, data, kind] = exportFile.saveFile.mock.calls[0];
    expect(name).toBe("Q3 budget.csv");
    expect(kind).toBe("csv");
    expect(data).toBe("\uFEFFItem,Qty,Total,Due\nPens,12,18,2026-03-04\nPaper,3,7,2026-03-09\n");
  });

  it("names the file for the workbook it came from when the sheet has no caption", async () => {
    open({ title: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(exportFile.saveFile).toHaveBeenCalled());
    expect(exportFile.saveFile.mock.calls[0][0]).toBe("budget.xlsx");
  });

  it("copies the cells as Excel takes them pasted: tabs between them, as shown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();

    fireEvent.click(screen.getByRole("button", { name: "Copy cells" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe("Item\tQty\tTotal\tDue\nPens\t12\t18\t2026-03-04\nPaper\t3\t7\t2026-03-09");
    expect(screen.getByRole("status").textContent).toContain("copied");
  });

  it("says Saved, not that the browser was offered it, when the desktop app's save dialog wrote the file", async () => {
    exportFile.saveFile.mockResolvedValue("saved");
    open();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect((await screen.findByRole("status")).textContent).toBe("Saved.");
    expect(screen.getByRole("dialog").textContent).not.toContain("browser");
  });

  it("says nothing when the save dialog is dismissed, and can be used again", async () => {
    exportFile.saveFile.mockResolvedValue("canceled");
    open();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(exportFile.saveFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says why the desktop app could not write the file", async () => {
    exportFile.saveFile.mockRejectedValue(new exportFile.SaveFileError("Could not save the file: ENOSPC: no space left on device"));
    open();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Could not save the file: ENOSPC: no space left on device");
  });

  it("cannot save where the window has no way to, and says so; copying still works", () => {
    exportFile.canSaveFile.mockReturnValue(false);
    open();

    expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Copy cells" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("dialog").textContent).toContain("This window cannot save a file");
  });

  it("says a sheet with no data has nothing to export", () => {
    open({ source: { csv: "", formulas: "" } });

    expect(screen.getByRole("alert").textContent).toContain("csv");
    expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when the file could not be made", async () => {
    exportFile.saveFile.mockImplementationOnce(() => {
      throw new Error("no");
    });
    open();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The file could not be made.");
  });

  it("closes on Close", () => {
    const { onClose } = open();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
