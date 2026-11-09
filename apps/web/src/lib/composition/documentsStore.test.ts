import { describe, expect, it, vi } from "vitest";
import type { DocumentsApi, PdfDocument } from "./documentsApi";
import { fakeDocumentsApi } from "./__fixtures__/documentsApi";
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
  const deps = fakeDocumentsApi({ listDocuments: vi.fn(async () => documents), ...over });
  return { deps, store: createDocumentsStore(deps) };
}

describe("the documents store", () => {
  it("loads the PDFs once, and knows each by its id and by its note", async () => {
    const { store, deps } = setup();
    expect(store.getSnapshot().status).toBe("idle");

    await Promise.all([store.load(), store.load()]);
    await store.load();

    expect(deps.listDocuments).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ status: "ready", documents: [doc(1), doc(2)], error: null, marks: {} });
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

    it("imports a dropped file into the target group, and adds the PDF that came of it", async () => {
      const added = { note: { id: 32 } as never, document: doc(5, 32) };
      const { store, deps } = setup([doc(1)], { importDroppedPdf: vi.fn(async () => added) });
      await store.load();
      const file = new File(["%PDF-1.7"], "Dropped.pdf", { type: "application/pdf" });

      const result = await store.importDropped(file, { groupId: 7, notebookId: 1 });

      expect(deps.importDroppedPdf).toHaveBeenCalledWith(file, { groupId: 7, notebookId: 1 });
      expect(result).toBe(added);
      expect(store.getSnapshot().documents.map((d) => d.id)).toEqual([1, 5]);
    });

    it("changes nothing for a dropped file that is refused or already in the library, and answers a bridge failure as an error", async () => {
      const file = new File([""], "x.pdf");
      for (const result of [{ error: "x.pdf: only PDF files can be dropped here." }, { duplicate: { token: "t", fileName: "x.pdf", existing: [] } }]) {
        const { store } = setup([doc(1)], { importDroppedPdf: vi.fn(async () => result) });
        await store.load();

        expect(await store.importDropped(file, { groupId: null, notebookId: 1 })).toBe(result);
        expect(store.getSnapshot().documents).toEqual([doc(1)]);
      }
      const { store } = setup([], { importDroppedPdf: vi.fn(async () => Promise.reject(new Error("bridge down"))) });

      expect(await store.importDropped(file, { groupId: null, notebookId: 1 })).toEqual({ error: "bridge down" });
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

  describe("a protected PDF's password", () => {
    it("is remembered for that PDF alone, for as long as the store lives", () => {
      const { store } = setup([doc(1), doc(2)]);

      expect(store.passwordFor(1)).toBeUndefined();
      store.rememberPassword(1, "s3cret");

      expect(store.passwordFor(1)).toBe("s3cret");
      expect(store.passwordFor(2)).toBeUndefined();
    });

    it("is kept out of the snapshot, which every panel reads and anything may inspect, and out of what the backend is sent", async () => {
      const { store, deps } = setup([doc(1)]);
      await store.load();
      store.rememberPassword(1, "s3cret");
      store.setPageCount(1, 5);
      store.saveViewState(1, { page: 2 });

      expect(JSON.stringify(store.getSnapshot())).not.toContain("s3cret");
      expect(JSON.stringify(Object.values(deps).flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock?.calls ?? []))).not.toContain("s3cret");
    });

    it("does not tell the listeners: nothing is drawn from it", () => {
      const { store } = setup([doc(1)]);
      const listener = vi.fn();
      store.subscribe(listener);

      store.rememberPassword(1, "s3cret");

      expect(listener).not.toHaveBeenCalled();
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

  it("keeps a PDF's marks in its snapshot, tells its listeners as they change, and undoes the last change", async () => {
    const made = { id: 1, uuid: "a".repeat(32), documentId: 1, page: 0, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]], quote: "q", comment: "", body: null, groupUuid: null, createdAt: "t", updatedAt: "t" } as never;
    const { store, deps } = setup([doc(1)], { addAnnotations: vi.fn(async () => [made]), deleteAnnotation: vi.fn(async () => [made]), listAnnotations: vi.fn(async () => []) });
    const listener = vi.fn();
    store.subscribe(listener);

    await store.loadMarks(1);
    const result = await store.addMarks(1, [{ page: 0, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]] }]);

    expect(result.marks).toEqual([made]);
    expect(store.getSnapshot().marks[1]).toMatchObject({ status: "ready", items: [made], undoCount: 1, redoCount: 0 });
    expect(listener).toHaveBeenCalled();

    await store.undoMark(1);
    expect(store.getSnapshot().marks[1]).toMatchObject({ items: [], undoCount: 0, redoCount: 1 });
    expect(deps.deleteAnnotation).toHaveBeenCalledWith(1);

    await store.changeMark(made, { color: "pink" });
    await store.removeMark(made);
    await store.redoMark(1);
  });

  it("is available by default, and a store with no backend says there are no PDFs here", async () => {
    expect(setup().store.available).toBe(true);
    const none = createDocumentsStore(unavailableDocuments, false);
    expect(none.available).toBe(false);

    await none.load();

    expect(none.getSnapshot()).toMatchObject({ status: "error", error: "PDFs are only available in the desktop app." });
  });
});

describe("exporting a PDF with its marks", () => {
  it("asks the backend, and passes on what came of it", async () => {
    const result = { saved: true as const, fileName: "a (annotated).pdf", written: 2, skipped: { ink: 0, offPage: 0 }, passwordProtected: false };
    const api = fakeDocumentsApi({ exportDocument: vi.fn(async () => result) });
    const store = createDocumentsStore(api);

    expect(await store.exportDocument(4, { flatten: true })).toEqual(result);
    expect(api.exportDocument).toHaveBeenCalledWith(4, { flatten: true });
  });

  it("says why, and does not throw, when the backend does", async () => {
    const store = createDocumentsStore(fakeDocumentsApi({ exportDocument: vi.fn(async () => Promise.reject(new Error("The save dialog failed."))) }));

    expect(await store.exportDocument(4, { flatten: false })).toEqual({ error: "The save dialog failed." });
  });

  it("is refused where there are no PDFs, as in the web app", async () => {
    const store = createDocumentsStore(unavailableDocuments, false);

    expect(await store.exportDocument(1, { flatten: false })).toEqual({ error: "PDFs are only available in the desktop app." });
  });
});
