import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { pageLabel, readPdfText, type PdfjsForText } from "./pdfText";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, "../../../../../fixtures/conformance");
const pdfjsRoot = path.resolve(here, "../../../node_modules/pdfjs-dist");
const options = { cMapUrl: `${pdfjsRoot}/cmaps/`, standardFontDataUrl: `${pdfjsRoot}/standard_fonts/` };
const lib = pdfjs as unknown as PdfjsForText;

async function onePage(text: string, password?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 18, font });
  if (password) doc.encrypt({ allowWeakCryptography: true, userPassword: password, ownerPassword: `${password}-owner` });
  return doc.save();
}

describe("readPdfText", () => {
  it("reads every page of the conformance fixture as the committed oracle has it, by data or by path", async () => {
    const expected = JSON.parse(fs.readFileSync(path.join(corpus, "pdf-text.json"), "utf-8")) as { pages: { page: number; text: string }[] };
    const file = path.join(corpus, "pdf-text.pdf");
    for (const source of [{ data: new Uint8Array(fs.readFileSync(file)) }, { url: file }]) {
      const outcome = await readPdfText(lib, source, options);
      expect(outcome.status).toBe("pages");
      if (outcome.status !== "pages") return;
      expect(outcome.pages.map((p) => ({ page: p.page, text: p.text }))).toEqual(expected.pages.map((p) => ({ page: p.page, text: p.text })));
      expect(outcome.pages.every((p) => p.label === null)).toBe(true);
    }
  });

  it("says a protected PDF is locked without its password or with a wrong one, and reads it with the right one", async () => {
    const data = await onePage("Locked lighthouse", "secret");
    expect(await readPdfText(lib, { data: data.slice() }, options)).toEqual({ status: "locked" });
    expect(await readPdfText(lib, { data: data.slice() }, { ...options, password: "wrong" })).toEqual({ status: "locked" });
    const opened = await readPdfText(lib, { data: data.slice() }, { ...options, password: "secret" });
    expect(opened).toEqual({ status: "pages", pages: [{ page: 0, label: null, text: "Locked lighthouse" }] });
  });

  it("says bytes that are not a PDF are unreadable", async () => {
    expect(await readPdfText(lib, { data: new TextEncoder().encode("just text") }, options)).toEqual({ status: "unreadable" });
  });
});

describe("pageLabel", () => {
  it("keeps a label only when it is not the page's own number", () => {
    expect(pageLabel("xii", 11)).toBe("xii");
    expect(pageLabel("42", 43)).toBe("42");
    expect(pageLabel("12", 11)).toBeNull();
    expect(pageLabel(" 12 ", 11)).toBeNull();
    expect(pageLabel("", 0)).toBeNull();
    expect(pageLabel(null, 0)).toBeNull();
  });
});
