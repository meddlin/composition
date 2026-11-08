import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PdfDocument } from "../../../web/src/lib/composition/documentsApi";
import type { ImportPdfOutcome } from "../../../web/src/lib/composition/service";
import { createDocumentsApi, type DocumentUi } from "./documents";

const document: PdfDocument = { id: 1, uuid: "a".repeat(32), noteId: 5, fileName: "book.pdf", size: 10, pageCount: 0, viewState: {}, createdAt: "x" };
const note = { id: 5, title: "book" } as never;
const target = { groupId: 3, notebookId: 1 };
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "composition-documents-")));
const dataFolder = path.join(scratch, "data");
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function setup(outcome: ImportPdfOutcome, ui: Partial<DocumentUi> = {}) {
  const service = {
    listDocuments: vi.fn(async () => [document]),
    importPdf: vi.fn(async () => outcome),
    setDocumentPageCount: vi.fn(async () => {}),
    saveDocumentViewState: vi.fn(async () => {}),
    listBookmarks: vi.fn(async () => []),
    addBookmark: vi.fn(async () => ({}) as never),
    renameBookmark: vi.fn(async () => null),
    removeBookmark: vi.fn(async () => {}),
    describeDocument: vi.fn(async () => null),
    documentForExport: vi.fn(() => ({ path: "/library/documents/abc-book.pdf", fileName: "book.pdf", marks: [] as never[] })),
    listAnnotations: vi.fn(async () => []),
    addAnnotations: vi.fn(async () => []),
    updateAnnotation: vi.fn(async () => null),
    deleteAnnotation: vi.fn(async () => []),
    restoreAnnotations: vi.fn(async () => []),
  };
  const nativeUi: DocumentUi = {
    pickPdf: vi.fn(async () => "/inbox/book.pdf"),
    pickExportPath: vi.fn(async () => "/out/book (annotated).pdf"),
    exportPdf: vi.fn(async () => ({ ok: true as const, written: 3, skipped: { ink: 0, offPage: 0 }, passwordProtected: false })),
    dataFolder: () => dataFolder,
    ...ui,
  };
  return { api: createDocumentsApi(service, nativeUi), service, ui: nativeUi };
}

describe("importPdf", () => {
  it("imports exactly the file the user picked in the dialog, into the group the page named", async () => {
    const { api, service } = setup({ status: "added", note, document });

    const result = await api.importPdf(target);

    expect(service.importPdf).toHaveBeenCalledWith("/inbox/book.pdf", target);
    expect(result).toEqual({ note, document });
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { api, service } = setup({ status: "added", note, document }, { pickPdf: vi.fn(async () => null) });

    expect(await api.importPdf(target)).toEqual({ canceled: true });
    expect(service.importPdf).not.toHaveBeenCalled();
  });

  it("passes on a reason to show when the file is refused", async () => {
    const { api } = setup({ status: "refused", error: "notes.txt: this doesn't look like a PDF." });

    expect(await api.importPdf(target)).toEqual({ error: "notes.txt: this doesn't look like a PDF." });
  });

  it("answers a PDF the library already has with the ones that hold it, and a token, never the path", async () => {
    const existing = [{ document, noteTitle: "My textbook" }];
    const { api } = setup({ status: "duplicate", existing });

    const result = await api.importPdf(target);

    expect(result).toEqual({ duplicate: { token: expect.stringMatching(/^[0-9a-f]{16}$/), fileName: "book.pdf", existing } });
    expect(JSON.stringify(result)).not.toContain("/inbox");
  });
});

describe("importDroppedPdf", () => {
  const dropped = path.join(scratch, "Downloads", "Dropped Book.pdf");
  fs.mkdirSync(path.dirname(dropped), { recursive: true });
  fs.writeFileSync(dropped, "%PDF-1.7\n");

  it("imports the file the preload read the path of, into the group the page named, after checking it", async () => {
    const { api, service, ui } = setup({ status: "added", note, document });

    const result = await api.importDroppedPdf(dropped, target);

    expect(service.importPdf).toHaveBeenCalledWith(dropped, target);
    expect(result).toEqual({ note, document });
    expect(ui.pickPdf).not.toHaveBeenCalled();
  });

  it("imports nothing for a path that fails the check, and says why", async () => {
    const { api, service } = setup({ status: "added", note, document });

    expect(await api.importDroppedPdf("", target)).toEqual({ error: "Drop a PDF file from your computer." });
    expect(await api.importDroppedPdf(path.join(scratch, "notes.txt"), target)).toEqual({ error: "notes.txt: only PDF files can be dropped here." });
    const inside = path.join(dataFolder, "documents", "abc-book.pdf");
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.writeFileSync(inside, "%PDF-1.7\n");
    expect(await api.importDroppedPdf(inside, target)).toEqual({ error: expect.stringMatching(/inside Composition's own data folder/) });
    expect(service.importPdf).not.toHaveBeenCalled();
  });

  it("answers a PDF the library already has the way the picker does, so Import a separate copy works with the token", async () => {
    const { api, service } = setup({ status: "duplicate", existing: [{ document, noteTitle: "My textbook" }] });

    const result = await api.importDroppedPdf(dropped, target);

    expect(result).toEqual({ duplicate: { token: expect.stringMatching(/^[0-9a-f]{16}$/), fileName: "Dropped Book.pdf", existing: [{ document, noteTitle: "My textbook" }] } });
    service.importPdf.mockResolvedValueOnce({ status: "added", note, document });
    await api.importPdfCopy(result.duplicate!.token, target);
    expect(service.importPdf).toHaveBeenLastCalledWith(dropped, target, { allowDuplicate: true });
  });

  it("passes on a reason to show when the service refuses the file", async () => {
    const { api } = setup({ status: "refused", error: "Dropped Book.pdf: this doesn't look like a PDF." });

    expect(await api.importDroppedPdf(dropped, target)).toEqual({ error: "Dropped Book.pdf: this doesn't look like a PDF." });
  });
});

describe("importPdfCopy", () => {
  async function duplicate() {
    const context = setup({ status: "duplicate", existing: [{ document, noteTitle: "My textbook" }] });
    const result = await context.api.importPdf(target);
    return { ...context, token: result.duplicate!.token };
  }

  it("imports the file the token stands for as a separate copy, once", async () => {
    const { api, service, token } = await duplicate();
    service.importPdf.mockResolvedValueOnce({ status: "added", note, document });

    const result = await api.importPdfCopy(token, target);

    expect(service.importPdf).toHaveBeenLastCalledWith("/inbox/book.pdf", target, { allowDuplicate: true });
    expect(result).toEqual({ note, document });
    expect(await api.importPdfCopy(token, target)).toEqual({ error: expect.stringMatching(/no longer waiting/) });
  });

  it("does not take a path in the token's place", async () => {
    const { api, service } = await duplicate();

    expect(await api.importPdfCopy("/etc/passwd", target)).toEqual({ error: expect.stringMatching(/no longer waiting/) });
    expect(service.importPdf).toHaveBeenCalledTimes(1);
  });

  it("remembers only the last few files that were found to be duplicates", async () => {
    const { api, token: first } = await duplicate();
    for (let i = 0; i < 4; i++) await api.importPdf(target);

    expect(await api.importPdfCopy(first, target)).toEqual({ error: expect.stringMatching(/no longer waiting/) });
  });
});

describe("the rest", () => {
  it("hands everything else to the service as it is", async () => {
    const { api, service } = setup({ status: "added", note, document });

    await api.setDocumentPageCount(1, 600);
    await api.saveDocumentViewState(1, { page: 4 });
    await api.listBookmarks(1);
    await api.addBookmark(1, 3, "x");
    await api.renameBookmark(2, "y");
    await api.removeBookmark(2);
    await api.describeDocument(5);
    await api.listAnnotations(1);
    await api.addAnnotations(1, [{ page: 0, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]] }]);
    await api.updateAnnotation(2, { color: "pink" });
    await api.deleteAnnotation(2);
    await api.restoreAnnotations(1, []);

    expect(service.setDocumentPageCount).toHaveBeenCalledWith(1, 600);
    expect(service.saveDocumentViewState).toHaveBeenCalledWith(1, { page: 4 });
    expect(service.addBookmark).toHaveBeenCalledWith(1, 3, "x");
    expect(service.renameBookmark).toHaveBeenCalledWith(2, "y");
    expect(service.removeBookmark).toHaveBeenCalledWith(2);
    expect(service.describeDocument).toHaveBeenCalledWith(5);
    expect(service.listAnnotations).toHaveBeenCalledWith(1);
    expect(service.addAnnotations).toHaveBeenCalledWith(1, [{ page: 0, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]] }]);
    expect(service.updateAnnotation).toHaveBeenCalledWith(2, { color: "pink" });
    expect(service.deleteAnnotation).toHaveBeenCalledWith(2);
    expect(service.restoreAnnotations).toHaveBeenCalledWith(1, []);
  });
});

describe("exportDocument", () => {
  const options = { flatten: false };

  it("asks where to save, offering the PDF's name with (annotated), and has the copy written there with the marks", async () => {
    const marks = [{ id: 1 }] as never[];
    const { api, service, ui } = setup({ status: "refused", error: "x" });
    service.documentForExport.mockReturnValue({ path: "/library/documents/abc-book.pdf", fileName: "book.pdf", marks });

    const result = await api.exportDocument(1, { flatten: true });

    expect(ui.pickExportPath).toHaveBeenCalledWith("book (annotated).pdf");
    expect(ui.exportPdf).toHaveBeenCalledWith({ sourcePath: "/library/documents/abc-book.pdf", targetPath: "/out/book (annotated).pdf", marks, flatten: true });
    expect(result).toEqual({ saved: true, fileName: "book (annotated).pdf", written: 3, skipped: { ink: 0, offPage: 0 }, passwordProtected: false });
  });

  it("hands the writer the password a protected PDF was opened with, only when there is one, and says the copy is protected", async () => {
    const protectedCopy = setup({ status: "refused", error: "x" }, { exportPdf: vi.fn(async () => ({ ok: true as const, written: 1, skipped: { ink: 0, offPage: 0 }, passwordProtected: true })) });
    protectedCopy.service.documentForExport.mockReturnValue({ path: "/library/documents/abc-book.pdf", fileName: "book.pdf", marks: [] });

    const result = await protectedCopy.api.exportDocument(1, { flatten: false, password: "s3cret" });

    expect(protectedCopy.ui.exportPdf).toHaveBeenCalledWith({ sourcePath: "/library/documents/abc-book.pdf", targetPath: "/out/book (annotated).pdf", marks: [], flatten: false, password: "s3cret" });
    expect(result).toMatchObject({ saved: true, passwordProtected: true });
    // Not in anything handed back to the page.
    expect(JSON.stringify(result)).not.toContain("s3cret");

    const plain = setup({ status: "refused", error: "x" });
    await plain.api.exportDocument(1, { flatten: false });
    expect("password" in (plain.ui.exportPdf as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(false);
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { api, ui } = setup({ status: "refused", error: "x" }, { pickExportPath: vi.fn(async () => null) });

    expect(await api.exportDocument(1, options)).toEqual({ canceled: true });
    expect(ui.exportPdf).not.toHaveBeenCalled();
  });

  it("says so when the PDF is gone, without asking where to save", async () => {
    const { api, service, ui } = setup({ status: "refused", error: "x" });
    service.documentForExport.mockReturnValue(null as never);

    expect(await api.exportDocument(1, options)).toEqual({ error: "This PDF is no longer in the library." });
    expect(ui.pickExportPath).not.toHaveBeenCalled();
  });

  it("never overwrites the PDF in the library, even when the dialog is pointed at it", async () => {
    const { api, ui } = setup({ status: "refused", error: "x" }, { pickExportPath: vi.fn(async () => "/library/documents/../documents/abc-book.pdf") });

    const result = await api.exportDocument(1, options);

    expect(result).toEqual({ error: "Choose another file: the PDF in the library is never overwritten." });
    expect(ui.exportPdf).not.toHaveBeenCalled();
  });

  it("passes on why an export failed, and what it left out when it did not", async () => {
    const failed = setup({ status: "refused", error: "x" }, { exportPdf: vi.fn(async () => ({ ok: false as const, error: "A text note has characters that cannot be written." })) });
    expect(await failed.api.exportDocument(1, options)).toEqual({ error: "A text note has characters that cannot be written." });

    const partial = setup({ status: "refused", error: "x" }, { exportPdf: vi.fn(async () => ({ ok: true as const, written: 2, skipped: { ink: 1, offPage: 0 }, passwordProtected: false })) });
    expect(await partial.api.exportDocument(1, options)).toMatchObject({ saved: true, written: 2, skipped: { ink: 1, offPage: 0 } });
  });
});
