import type { DocumentsApi, ExistingPdf, ExportPdfOptions, ExportPdfResult, ImportPdfResult, ImportTarget, PdfAnnotation, PdfBookmark, PdfContents, PdfDocument } from "./documentsApi";
import { createMarksController, type DocumentMarks } from "./documentMarks";
import type { AnnotationChanges, PdfAnnotationInput, PdfViewState } from "./pdfMarkup";

/** What the store reaches outside for: the PDFs' backend. */
export type DocumentsDeps = DocumentsApi;

export type DocumentsSnapshot = {
  /** `idle` until the first `load`; `error` if that failed (the PDFs are then unknown, not none). */
  status: "idle" | "loading" | "ready" | "error";
  /** Every PDF, one per owner note. */
  documents: PdfDocument[];
  error: string | null;
  /** The marks of each PDF whose marks have been asked for, with how much of each can be undone or redone. */
  marks: Record<number, DocumentMarks>;
};

/** A file the user picked that the library already has: asked about, then opened or imported again as a separate copy. */
export type DuplicateImport = { token: string; fileName: string; existing: ExistingPdf[]; target: ImportTarget };

export type DocumentsStore = {
  /** Whether this build has PDFs at all: the desktop app does, the web app does not (and offers no way to import one). */
  readonly available: boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): DocumentsSnapshot;
  /** Reads the PDFs from the backend. Does nothing once they are loaded (or while they load); after a failure it tries again. */
  load(): Promise<void>;
  /** The PDF a note owns, if it owns one. */
  forNote(noteId: number): PdfDocument | undefined;
  byId(documentId: number): PdfDocument | undefined;
  /**
   * Imports a PDF the user picks in the native dialog, into a new note in the target group. Resolves with what came of it;
   * a PDF the library already has comes back as `duplicate`, and nothing was imported.
   */
  importPdf(target: ImportTarget): Promise<ImportPdfResult>;
  /** Imports a PDF the user dropped on the window (the File the drop gave the page), into a new note in the target group. */
  importDropped(file: File, target: ImportTarget): Promise<ImportPdfResult>;
  /** Imports the file of a `duplicate` result as a separate copy. */
  importCopy(duplicate: DuplicateImport): Promise<ImportPdfResult>;
  /** Remembers the page count the reader found (it shows at once; the backend is told). */
  setPageCount(documentId: number, pageCount: number): void;
  /** Remembers where the reader was. Not awaited: it is a convenience and must not get in the way of reading. */
  saveViewState(documentId: number, state: PdfViewState): void;
  listBookmarks(documentId: number): Promise<PdfBookmark[]>;
  addBookmark(documentId: number, page: number, label: string): Promise<PdfBookmark>;
  renameBookmark(bookmarkId: number, label: string): Promise<PdfBookmark | null>;
  removeBookmark(bookmarkId: number): Promise<void>;
  /** Writes a copy of the PDF with its marks in it, to a file the user picks; says what came of it, and never throws. */
  exportDocument(documentId: number, options: ExportPdfOptions): Promise<ExportPdfResult>;
  /** What deleting the PDF's note would take with it, for the delete dialog; null when the note owns no PDF. */
  describe(noteId: number): Promise<PdfContents | null>;
  /** Reads a PDF's marks (once: the store keeps them current as they change). */
  loadMarks(documentId: number): Promise<void>;
  /** Marks one selection (one mark per page it covers). Resolves with the marks made, or why none were. */
  addMarks(documentId: number, inputs: PdfAnnotationInput[]): Promise<{ marks?: PdfAnnotation[]; error?: string }>;
  /** Changes a mark, or says why it could not be. */
  changeMark(mark: PdfAnnotation, changes: AnnotationChanges): Promise<{ error?: string }>;
  /** Deletes a mark and the rest of its selection. */
  removeMark(mark: PdfAnnotation): Promise<{ error?: string }>;
  /** Takes back the last change made to the PDF's marks. */
  undoMark(documentId: number): Promise<{ error?: string }>;
  /** Does it again after an undo. */
  redoMark(documentId: number): Promise<{ error?: string }>;
};

export const NO_DOCUMENTS: DocumentsSnapshot = { status: "idle", documents: [], error: null, marks: {} };

const reason = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/**
 * The PDFs, with no React in it, so every panel showing one (in any window) and the sidebar's PDF rows agree. An import
 * waits for the backend (the picker is a native dialog); the reader's own bookkeeping (page count, where it was) shows at
 * once and is sent on, and a failure of it is only logged: reading must not stop for it.
 */
export function createDocumentsStore(deps: DocumentsDeps, available = true): DocumentsStore {
  let state: DocumentsSnapshot = NO_DOCUMENTS;
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  function set(next: Partial<DocumentsSnapshot>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  const marks = createMarksController(deps, () => set({ marks: marks.snapshot() }));

  function load(): Promise<void> {
    if (state.status === "ready") return Promise.resolve();
    if (loading) return loading;
    set({ status: "loading", error: null });
    loading = deps
      .listDocuments()
      .then((documents) => set({ status: "ready", documents, error: null }))
      .catch((error) => set({ status: "error", error: reason(error) }))
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  function learn(result: ImportPdfResult) {
    if (result.document) set({ documents: [...state.documents.filter((d) => d.id !== result.document!.id), result.document] });
  }

  async function importPdf(target: ImportTarget): Promise<ImportPdfResult> {
    try {
      const result = await deps.importPdf(target);
      learn(result);
      return result;
    } catch (error) {
      return { error: reason(error) };
    }
  }

  async function importDropped(file: File, target: ImportTarget): Promise<ImportPdfResult> {
    try {
      const result = await deps.importDroppedPdf(file, target);
      learn(result);
      return result;
    } catch (error) {
      return { error: reason(error) };
    }
  }

  async function importCopy(duplicate: DuplicateImport): Promise<ImportPdfResult> {
    try {
      const result = await deps.importPdfCopy(duplicate.token, duplicate.target);
      learn(result);
      return result;
    } catch (error) {
      return { error: reason(error) };
    }
  }

  const log = (what: string) => (error: unknown) => console.error("[pdf] could not save:", what, error);

  return {
    available,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    load,
    forNote: (noteId) => state.documents.find((d) => d.noteId === noteId),
    byId: (documentId) => state.documents.find((d) => d.id === documentId),
    importPdf,
    importDropped,
    importCopy,
    setPageCount(documentId, pageCount) {
      const document = state.documents.find((d) => d.id === documentId);
      if (!document || document.pageCount === pageCount) return;
      set({ documents: state.documents.map((d) => (d.id === documentId ? { ...d, pageCount } : d)) });
      void deps.setDocumentPageCount(documentId, pageCount).catch(log("the page count was not saved"));
    },
    saveViewState(documentId, viewState) {
      // Not set(): the reader owns what it shows, and a change here would redraw every panel on every scroll.
      state = { ...state, documents: state.documents.map((d) => (d.id === documentId ? { ...d, viewState } : d)) };
      void deps.saveDocumentViewState(documentId, viewState).catch(log("the reading position was not saved"));
    },
    listBookmarks: (documentId) => deps.listBookmarks(documentId),
    addBookmark: (documentId, page, label) => deps.addBookmark(documentId, page, label),
    renameBookmark: (bookmarkId, label) => deps.renameBookmark(bookmarkId, label),
    removeBookmark: (bookmarkId) => deps.removeBookmark(bookmarkId),
    describe: (noteId) => deps.describeDocument(noteId),
    async exportDocument(documentId, options) {
      try {
        return await deps.exportDocument(documentId, options);
      } catch (error) {
        return { error: reason(error) };
      }
    },
    loadMarks: (documentId) => marks.load(documentId),
    addMarks: (documentId, inputs) => marks.make(documentId, inputs),
    changeMark: (mark, changes) => marks.change(mark, changes),
    removeMark: (mark) => marks.remove(mark),
    undoMark: (documentId) => marks.undo(documentId),
    redoMark: (documentId) => marks.redo(documentId),
  };
}

const UNAVAILABLE = "PDFs are only available in the desktop app.";

/** For a workspace with no PDF backend (the web app has no reader): loading them reports that. */
export const unavailableDocuments: DocumentsDeps = {
  listDocuments: () => Promise.reject(new Error(UNAVAILABLE)),
  importPdf: () => Promise.reject(new Error(UNAVAILABLE)),
  importPdfCopy: () => Promise.reject(new Error(UNAVAILABLE)),
  importDroppedPdf: () => Promise.reject(new Error(UNAVAILABLE)),
  setDocumentPageCount: () => Promise.reject(new Error(UNAVAILABLE)),
  saveDocumentViewState: () => Promise.reject(new Error(UNAVAILABLE)),
  listBookmarks: () => Promise.reject(new Error(UNAVAILABLE)),
  addBookmark: () => Promise.reject(new Error(UNAVAILABLE)),
  renameBookmark: () => Promise.reject(new Error(UNAVAILABLE)),
  removeBookmark: () => Promise.reject(new Error(UNAVAILABLE)),
  describeDocument: () => Promise.reject(new Error(UNAVAILABLE)),
  exportDocument: () => Promise.reject(new Error(UNAVAILABLE)),
  listAnnotations: () => Promise.reject(new Error(UNAVAILABLE)),
  addAnnotations: () => Promise.reject(new Error(UNAVAILABLE)),
  updateAnnotation: () => Promise.reject(new Error(UNAVAILABLE)),
  deleteAnnotation: () => Promise.reject(new Error(UNAVAILABLE)),
  restoreAnnotations: () => Promise.reject(new Error(UNAVAILABLE)),
};
