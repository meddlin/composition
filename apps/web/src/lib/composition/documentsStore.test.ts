import { describe, expect, it, vi } from "vitest";
import type { DocumentsApi, PdfDocument } from "./documentsApi";
import { createDocumentsStore, unavailableDocuments } from "./documentsStore";

const doc = (id: number, noteId = id + 10, over: Partial<PdfDocument> = {}): PdfDocument => ({
  id,
  uuid: String(id).padStart(32, "0"),
  noteId,
  fileName: `book${id}.pdf`,
  size: 100,
  pageCount: 0,
  viewState: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function setup(documents: PdfDocument[] = [doc(1), doc(2)], over: Partial<DocumentsApi> = {}) {
  const deps: DocumentsApi = {
    listDocuments: vi.fn(async () => documents),
    importPdf: vi.fn(async () => ({ canceled: true })),
    importPdfCopy: vi.fn(async () => ({ canceled: true })),
    setDocumentPageCount: vi.fn(async () => {}),
    saveDocumentViewState: vi.fn(async () => {}),
    listBookmarks: vi.fn(async () => []),
    addBookmark: vi.fn(async () => ({}) as never),
    renameBookmark: vi.fn(async () => null),
    removeBookmark: vi.fn(async () => {}),
    describeDocument: vi.fn(async () => null),
    ...over,
  };
  return { deps, store: createDocumentsStore(deps) };
}

describe("the documents store", () => {
  it("loads the PDFs once, and knows each by its id and by its note", async () => {
    const { store, deps } = setup();
    expect(store.getSnapshot().status).toBe("idle");

    await Promise.all([store.load(), store.load()]);
    await store.load();

    expect(deps.listDocuments).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ status: "ready", documents: [doc(1), doc(2)], error: null });
    expect(store.byId(2)).toEqual(doc(2));
    expect(store.forNote(11)).toEqual(doc(1));
    expect(store.forNote(99)).toBeUndefined();
  });

  it("says the PDFs are unknown, not none, when loading fails, and tries again next time", async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce([doc(1)]);
    const { store } = setup([], { listDocuments: list });

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", error: "disk", documents: [] });

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", documents: [doc(1)] });
  });

  it("tells its listeners when the PDFs change", async () => {
    const { store } = setup();
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    await store.load();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    stop();
    store.setPageCount(1, 5);

    expect(listener).not.toHaveBeenCalled();
  });

  describe("importing", () => {
    it("adds the PDF that came of it, and hands back what the backend said", async () => {
      const added = { note: { id: 30 } as never, document: doc(3, 30) };
      const { store, deps } = setup([doc(1)], { importPdf: vi.fn(async () => added) });
      await store.load();

      const result = await store.importPdf({ groupId: 4, notebookId: 1 });

      expect(deps.importPdf).toHaveBeenCalledWith({ groupId: 4, notebookId: 1 });
      expect(result).toBe(added);
      expect(store.getSnapshot().documents.map((d) => d.id)).toEqual([1, 3]);
    });

    it("changes nothing for a cancelled picker, a refused file or a duplicate", async () => {
      for (const result of [{ canceled: true }, { error: "no" }, { duplicate: { token: "t", fileName: "a.pdf", existing: [] } }]) {
        const { store } = setup([doc(1)], { importPdf: vi.fn(async () => result) });
        await store.load();

        expect(await store.importPdf({ groupId: null, notebookId: 1 })).toBe(result);
        expect(store.getSnapshot().documents).toEqual([doc(1)]);
      }
    });

    it("answers a failure of the bridge as an error, not a throw", async () => {
      const { store } = setup([], { importPdf: vi.fn(async () => Promise.reject(new Error("bridge down"))) });

      expect(await store.importPdf({ groupId: null, notebookId: 1 })).toEqual({ error: "bridge down" });
    });

    it("imports a duplicate as a separate copy with the token and target it was given", async () => {
      const added = { note: { id: 31 } as never, document: doc(4, 31) };
      const { store, deps } = setup([doc(1)], { importPdfCopy: vi.fn(async () => added) });
      await store.load();

      const result = await store.importCopy({ token: "tok", fileName: "a.pdf", existing: [], target: { groupId: 2, notebookId: 1 } });

      expect(deps.importPdfCopy).toHaveBeenCalledWith("tok", { groupId: 2, notebookId: 1 });
      expect(result).toBe(added);
      expect(store.byId(4)).toEqual(doc(4, 31));
    });
  });

  describe("the reader's bookkeeping", () => {
    it("shows a page count at once, tells the backend, and does nothing when it is the same", async () => {
      const { store, deps } = setup();
      await store.load();

      store.setPageCount(1, 412);
      store.setPageCount(1, 412);
      store.setPageCount(99, 5);

      expect(store.byId(1)?.pageCount).toBe(412);
      expect(deps.setDocumentPageCount).toHaveBeenCalledTimes(1);
      expect(deps.setDocumentPageCount).toHaveBeenCalledWith(1, 412);
    });

    it("keeps the reading position and sends it on without redrawing anything", async () => {
      const { store, deps } = setup();
      await store.load();
      const listener = vi.fn();
      store.subscribe(listener);

      store.saveViewState(2, { page: 40, zoom: 1.5, darkPages: true });

      expect(store.byId(2)?.viewState).toEqual({ page: 40, zoom: 1.5, darkPages: true });
      expect(deps.saveDocumentViewState).toHaveBeenCalledWith(2, { page: 40, zoom: 1.5, darkPages: true });
      expect(listener).not.toHaveBeenCalled();
    });

    it("only logs a failure to save, so reading goes on", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { store } = setup([doc(1)], { saveDocumentViewState: vi.fn(async () => Promise.reject(new Error("no"))), setDocumentPageCount: vi.fn(async () => Promise.reject(new Error("no"))) });
      await store.load();

      store.saveViewState(1, { page: 3 });
      store.setPageCount(1, 9);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(error).toHaveBeenCalledTimes(2);
      error.mockRestore();
    });
  });

  it("passes bookmarks and the delete summary through to the backend", async () => {
    const { store, deps } = setup();

    await store.listBookmarks(1);
    await store.addBookmark(1, 3, "x");
    await store.renameBookmark(2, "y");
    await store.removeBookmark(2);
    await store.describe(11);

    expect(deps.listBookmarks).toHaveBeenCalledWith(1);
    expect(deps.addBookmark).toHaveBeenCalledWith(1, 3, "x");
    expect(deps.renameBookmark).toHaveBeenCalledWith(2, "y");
    expect(deps.removeBookmark).toHaveBeenCalledWith(2);
    expect(deps.describeDocument).toHaveBeenCalledWith(11);
  });

  it("is available by default, and a store with no backend says there are no PDFs here", async () => {
    expect(setup().store.available).toBe(true);
    const none = createDocumentsStore(unavailableDocuments, false);
    expect(none.available).toBe(false);

    await none.load();

    expect(none.getSnapshot()).toMatchObject({ status: "error", error: "PDFs are only available in the desktop app." });
  });
});
