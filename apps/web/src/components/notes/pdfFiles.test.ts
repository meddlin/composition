import { describe, expect, it } from "vitest";
import { dragMayBePdf, droppedPdfs, isPdfFile } from "./pdfFiles";

const file = (name: string, type: string) => ({ name, type }) as File;

describe("isPdfFile", () => {
  it("takes a file typed as a PDF, whatever its name, and an untyped one that is named .pdf", () => {
    expect(isPdfFile({ name: "scan", type: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "Book.PDF", type: "" })).toBe(true);
  });

  it("leaves out other types, even one named .pdf (the main process would refuse it anyway)", () => {
    expect(isPdfFile({ name: "notes.txt", type: "text/plain" })).toBe(false);
    expect(isPdfFile({ name: "photo.pdf", type: "image/png" })).toBe(false);
    expect(isPdfFile({ name: "readme", type: "" })).toBe(false);
  });
});

describe("dragMayBePdf", () => {
  it("is true for a drag of a PDF, and of a file the system has not typed", () => {
    expect(dragMayBePdf({ types: ["Files"], items: [{ kind: "file", type: "application/pdf" }] })).toBe(true);
    expect(dragMayBePdf({ types: ["Files"], items: [{ kind: "file", type: "" }] })).toBe(true);
    expect(dragMayBePdf({ types: ["Files"], items: [{ kind: "file", type: "image/png" }, { kind: "file", type: "application/pdf" }] })).toBe(true);
  });

  it("is true when the system gives no items to look at, as long as files are being dragged", () => {
    expect(dragMayBePdf({ types: ["Files"] })).toBe(true);
  });

  it("is false for pictures alone, and for anything that is not files", () => {
    expect(dragMayBePdf({ types: ["Files"], items: [{ kind: "file", type: "image/png" }] })).toBe(false);
    expect(dragMayBePdf({ types: ["application/x-composition-note-id"], items: [{ kind: "string", type: "application/x-composition-note-id" }] })).toBe(false);
    expect(dragMayBePdf({ types: ["text/plain"] })).toBe(false);
  });
});

describe("droppedPdfs", () => {
  it("keeps the PDFs, in order", () => {
    const a = file("a.pdf", "application/pdf");
    const b = file("b.txt", "text/plain");
    const c = file("c.pdf", "");

    expect(droppedPdfs({ files: [a, b, c] })).toEqual([a, c]);
    expect(droppedPdfs({ files: [b] })).toEqual([]);
  });
});
