import { describe, expect, it, vi } from "vitest";
import type { PdfDocument } from "../../../web/src/lib/composition/documentsApi";
import type { ImportPdfOutcome } from "../../../web/src/lib/composition/service";
import { createDocumentsApi, type DocumentUi } from "./documents";

const document: PdfDocument = { id: 1, uuid: "a".repeat(32), noteId: 5, fileName: "book.pdf", size: 10, pageCount: 0, viewState: {}, createdAt: "x" };
const note = { id: 5, title: "book" } as never;
const target = { groupId: 3, notebookId: 1 };

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
  };
  const nativeUi: DocumentUi = { pickPdf: vi.fn(async () => "/inbox/book.pdf"), ...ui };
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

    expect(service.setDocumentPageCount).toHaveBeenCalledWith(1, 600);
    expect(service.saveDocumentViewState).toHaveBeenCalledWith(1, { page: 4 });
    expect(service.addBookmark).toHaveBeenCalledWith(1, 3, "x");
    expect(service.renameBookmark).toHaveBeenCalledWith(2, "y");
    expect(service.removeBookmark).toHaveBeenCalledWith(2);
    expect(service.describeDocument).toHaveBeenCalledWith(5);
  });
});
