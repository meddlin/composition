import { describe, expect, it } from "vitest";
import { MAX_PDF_TITLE_LENGTH, pdfOwnTitle, retitleFromPdf, sensiblePdfTitle } from "./pdfTitle";

describe("sensiblePdfTitle", () => {
  it("takes an ordinary title, tidied up", () => {
    expect(sensiblePdfTitle("Designing Data-Intensive Applications")).toBe("Designing Data-Intensive Applications");
    expect(sensiblePdfTitle("  The   Art of\n Computer\tProgramming ")).toBe("The Art of Computer Programming");
    expect(sensiblePdfTitle("Café ≤ Привет 日本語")).toBe("Café ≤ Привет 日本語");
    expect(sensiblePdfTitle("2024 Annual Report")).toBe("2024 Annual Report");
    expect(sensiblePdfTitle("Thinking, Fast and Slow\u0000\u200b")).toBe("Thinking, Fast and Slow");
  });

  it("passes over what is not a string, and an empty or blank one", () => {
    for (const value of [undefined, null, 7, {}, [], "", "   ", "\n\t", "\u0000\u0001"]) expect(sensiblePdfTitle(value)).toBeNull();
  });

  it("passes over the placeholders tools write when nobody gave a title", () => {
    for (const value of ["Untitled", "untitled", "UNTITLED DOCUMENT", "Title", "Document", "Document1", "Document 12", "Untitled 2", "Layout 1", "Microsoft Word - Report.docx", "Microsoft PowerPoint - slides", "PowerPoint Presentation", "unknown", "(anonymous)", "null"]) {
      expect(sensiblePdfTitle(value), value).toBeNull();
    }
  });

  it("passes over a file name, which the tool that made the PDF copied in", () => {
    for (const value of ["report.docx", "Thesis final v3.tex", "Book.indd", "Designing_Data.pdf", "slides.PPTX"]) expect(sensiblePdfTitle(value), value).toBeNull();
  });

  it("keeps a title that only looks like those, because it has more to it", () => {
    expect(sensiblePdfTitle("The Document Object Model")).toBe("The Document Object Model");
    expect(sensiblePdfTitle("Untitled: a history of the blank page")).toBe("Untitled: a history of the blank page");
    expect(sensiblePdfTitle("Page 1 of the Story")).toBe("Page 1 of the Story");
    expect(sensiblePdfTitle("Learning Node.js")).toBe("Learning Node.js");
  });

  it("passes over text with no letters or digits, garbled text and a title that is a paragraph", () => {
    expect(sensiblePdfTitle("---")).toBeNull();
    expect(sensiblePdfTitle("¿?!")).toBeNull();
    expect(sensiblePdfTitle("Caf\uFFF9\uFFFD")).toBeNull();
    expect(sensiblePdfTitle("x".repeat(MAX_PDF_TITLE_LENGTH))).toBe("x".repeat(MAX_PDF_TITLE_LENGTH));
    expect(sensiblePdfTitle("x".repeat(MAX_PDF_TITLE_LENGTH + 1))).toBeNull();
  });
});

describe("pdfOwnTitle", () => {
  it("prefers the XMP title over the Info title", () => {
    expect(pdfOwnTitle({ xmpTitle: "From XMP", infoTitle: "From Info" })).toBe("From XMP");
  });

  it("falls back to the Info title when the XMP one is missing or not a title", () => {
    expect(pdfOwnTitle({ infoTitle: "From Info" })).toBe("From Info");
    expect(pdfOwnTitle({ xmpTitle: "Untitled", infoTitle: "From Info" })).toBe("From Info");
    expect(pdfOwnTitle({ xmpTitle: "", infoTitle: "From Info" })).toBe("From Info");
  });

  it("is null when neither is a title", () => {
    expect(pdfOwnTitle({})).toBeNull();
    expect(pdfOwnTitle({ xmpTitle: "Untitled", infoTitle: "Document1" })).toBeNull();
  });
});

describe("retitleFromPdf", () => {
  const base = { currentTitle: "Designing Data", fileName: "Designing_Data.pdf" };

  it("gives a note that still has the title made from the file's name the PDF's own title", () => {
    expect(retitleFromPdf({ ...base, pdfTitle: "Designing Data-Intensive Applications" })).toBe("Designing Data-Intensive Applications");
  });

  it("never replaces a title the user changed", () => {
    expect(retitleFromPdf({ ...base, currentTitle: "My copy of DDIA", pdfTitle: "Designing Data-Intensive Applications" })).toBeNull();
    expect(retitleFromPdf({ ...base, currentTitle: "designing data", pdfTitle: "Designing Data-Intensive Applications" })).toBeNull();
    expect(retitleFromPdf({ ...base, currentTitle: "Untitled", pdfTitle: "Designing Data-Intensive Applications" })).toBeNull();
  });

  it("leaves a note that already has the PDF's title, and one for a PDF with none", () => {
    expect(retitleFromPdf({ currentTitle: "Same Words", fileName: "Same_Words.pdf", pdfTitle: "Same Words" })).toBeNull();
    expect(retitleFromPdf({ ...base, pdfTitle: null })).toBeNull();
  });

  it("does it once: after the retitle the note no longer has the title from the file", () => {
    const retitled = retitleFromPdf({ ...base, pdfTitle: "A Real Title" });
    expect(retitled).toBe("A Real Title");
    expect(retitleFromPdf({ ...base, currentTitle: retitled!, pdfTitle: "A Real Title" })).toBeNull();
  });

  it("reads the file's name the way the import did: no .pdf, underscores as spaces, from a path too", () => {
    expect(retitleFromPdf({ currentTitle: "My Book", fileName: "My_Book.PDF", pdfTitle: "My Book, Second Edition" })).toBe("My Book, Second Edition");
    expect(retitleFromPdf({ currentTitle: "PDF", fileName: ".pdf", pdfTitle: "Something" })).toBe("Something");
  });
});
