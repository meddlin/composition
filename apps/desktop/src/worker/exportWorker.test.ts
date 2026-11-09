import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The writer library is the web package's (the worker bundles it from there), so the test reads it from there too.
import { PDFDocument } from "../../../web/node_modules/@cantoo/pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runExport } from "./exportWorker";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-exportworker-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function samplePdf(file: string): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  fs.writeFileSync(file, await doc.save());
}
const highlight = { id: 1, uuid: "a".repeat(32), documentId: 1, page: 0, kind: "highlight", color: "yellow", rects: [[100, 296, 272, 322]], quote: "", comment: "", body: null, groupUuid: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } as never;
const note = (text: string) => ({ ...(highlight as object), id: 2, uuid: "b".repeat(32), kind: "text", rects: null, body: { rect: [100, 100, 300, 160], text, fontSize: 12 } }) as never;

describe("the export worker", () => {
  it("writes the copy where it is told, with the bundled fonts, and leaves no partial file behind", async () => {
    const source = path.join(dir, "in.pdf");
    const target = path.join(dir, "out.pdf");
    await samplePdf(source);

    const outcome = await runExport({ sourcePath: source, targetPath: target, marks: [highlight, note("Café ≤ Привет")], flatten: false });

    expect(outcome).toEqual({ ok: true, written: 2, skipped: { ink: 0, offPage: 0 }, passwordProtected: false });
    const written = await PDFDocument.load(fs.readFileSync(target));
    expect(written.getPages()[0].node.Annots()?.size()).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual(["in.pdf", "out.pdf"]);
    // the source is as it was
    expect((await PDFDocument.load(fs.readFileSync(source))).getPages()[0].node.Annots()).toBeUndefined();
  });

  it("opens a PDF that needs a password with the one it is given, and protects the copy with it", async () => {
    const source = path.join(dir, "locked.pdf");
    const target = path.join(dir, "out.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.encrypt({ userPassword: "s3cret", ownerPassword: "owner" });
    fs.writeFileSync(source, await doc.save());

    const withoutIt = await runExport({ sourcePath: source, targetPath: target, marks: [highlight], flatten: false });
    expect(withoutIt.ok === false && withoutIt.error).toMatch(/protected by a password/);
    expect(fs.readdirSync(dir)).toEqual(["locked.pdf"]);

    const outcome = await runExport({ sourcePath: source, targetPath: target, marks: [highlight], flatten: false, password: "s3cret" });

    expect(outcome).toEqual({ ok: true, written: 1, skipped: { ink: 0, offPage: 0 }, passwordProtected: true });
    await expect(PDFDocument.load(fs.readFileSync(target))).rejects.toThrow(/encrypted/);
    expect((await PDFDocument.load(fs.readFileSync(target), { password: "s3cret" })).getPages()[0].node.Annots()?.size()).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual(["locked.pdf", "out.pdf"]);
  });

  it("says why, and writes nothing, when a text note cannot be written", async () => {
    const source = path.join(dir, "in.pdf");
    const target = path.join(dir, "out.pdf");
    await samplePdf(source);

    const outcome = await runExport({ sourcePath: source, targetPath: target, marks: [note("日本語")], flatten: false });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toMatch(/cannot be written/);
    expect(fs.readdirSync(dir)).toEqual(["in.pdf"]);
  });

  it("says why when the PDF cannot be read, and cleans up", async () => {
    const source = path.join(dir, "gone.pdf");

    const outcome = await runExport({ sourcePath: source, targetPath: path.join(dir, "out.pdf"), marks: [], flatten: true });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toMatch(/^The export failed: /);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
