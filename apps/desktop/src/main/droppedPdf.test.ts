import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDroppedPdf, isInside } from "./droppedPdf";

let root: string;
let data: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "composition-drop-")));
  data = path.join(root, "data");
  fs.mkdirSync(path.join(data, "documents"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (file: string, bytes = "%PDF-1.7\n") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
};

describe("checkDroppedPdf", () => {
  it("accepts a PDF file, and answers with the path it was given", async () => {
    const file = write(path.join(root, "Downloads", "Book.pdf"));

    expect(await checkDroppedPdf(file, data)).toEqual({ ok: true, path: file });
  });

  it("accepts a capital extension", async () => {
    const file = write(path.join(root, "BOOK.PDF"));

    expect(await checkDroppedPdf(file, data)).toEqual({ ok: true, path: file });
  });

  it("says a File with no path is not a file from the computer", async () => {
    // What the preload sends for a File the page made, or one dragged out of a web page.
    for (const value of ["", undefined, null, 7, "relative/book.pdf", "/tmp/a\0.pdf"]) {
      expect(await checkDroppedPdf(value, data)).toEqual({ ok: false, error: "Drop a PDF file from your computer." });
    }
  });

  it("refuses a file that does not end in .pdf, by name", async () => {
    const file = write(path.join(root, "notes.txt"));

    expect(await checkDroppedPdf(file, data)).toEqual({ ok: false, error: "notes.txt: only PDF files can be dropped here." });
  });

  it("refuses a file that is not there", async () => {
    expect(await checkDroppedPdf(path.join(root, "gone.pdf"), data)).toEqual({ ok: false, error: "gone.pdf: could not be read." });
  });

  it("refuses a folder named like a PDF", async () => {
    const folder = path.join(root, "Folder.pdf");
    fs.mkdirSync(folder);

    expect(await checkDroppedPdf(folder, data)).toEqual({ ok: false, error: "Folder.pdf: only files can be imported, not folders." });
  });

  it("refuses a file inside the application data folder, whatever its name", async () => {
    const file = write(path.join(data, "documents", "abc123-book.pdf"));

    expect(await checkDroppedPdf(file, data)).toEqual({ ok: false, error: "abc123-book.pdf: this is already inside Composition's own data folder." });
  });

  it("refuses a link that leads into the data folder, and accepts one that leads out of it", async () => {
    const inside = write(path.join(data, "documents", "abc123-book.pdf"));
    const linkIn = path.join(root, "innocent.pdf");
    fs.symlinkSync(inside, linkIn);
    const outside = write(path.join(root, "elsewhere", "real.pdf"));
    const linkOut = path.join(data, "shortcut.pdf");
    fs.symlinkSync(outside, linkOut);

    expect(await checkDroppedPdf(linkIn, data)).toMatchObject({ ok: false });
    expect(await checkDroppedPdf(linkOut, data)).toEqual({ ok: true, path: linkOut });
  });

  it("still checks a data folder that does not exist yet", async () => {
    const file = write(path.join(root, "Book.pdf"));

    expect(await checkDroppedPdf(file, path.join(root, "not-created"))).toEqual({ ok: true, path: file });
  });
});

describe("isInside", () => {
  it("is true for the folder itself and anything below it, and false for a sibling with the same prefix", () => {
    expect(isInside("/a/data", "/a/data")).toBe(true);
    expect(isInside("/a/data", "/a/data/documents/x.pdf")).toBe(true);
    expect(isInside("/a/data", "/a/data-old/x.pdf")).toBe(false);
    expect(isInside("/a/data", "/a/x.pdf")).toBe(false);
  });
});
