import crypto from "node:crypto";
import path from "node:path";
import type { DocumentsApi, ImportPdfResult, ImportTarget } from "../../../web/src/lib/composition/documentsApi";
import type { ImportPdfOutcome } from "../../../web/src/lib/composition/service";
import type { service as Service } from "./backend";

/**
 * The desktop-only DocumentsApi (see apps/web/src/lib/composition/documentsApi.ts).
 *
 * The operating system's dialog is what chooses the PDF: the renderer asks to "import a PDF into this group", never names
 * a path, so a compromised page cannot make the app copy a file of its choosing into the library. A file that turns out
 * to be one the library already has is remembered here, under a random token, so that "Import a separate copy" can go
 * ahead without the page ever being told where the file is.
 */

/** The native piece this needs, as a plain function, so tests don't need Electron. */
export type DocumentUi = {
  /** The path of the PDF the user picked, or null if they cancelled. */
  pickPdf(): Promise<string | null>;
};

type DocumentService = Pick<
  typeof Service,
  | "listDocuments"
  | "importPdf"
  | "setDocumentPageCount"
  | "saveDocumentViewState"
  | "listBookmarks"
  | "addBookmark"
  | "renameBookmark"
  | "removeBookmark"
  | "describeDocument"
  | "listAnnotations"
  | "addAnnotations"
  | "updateAnnotation"
  | "deleteAnnotation"
  | "restoreAnnotations"
>;

/** How many files found to be duplicates are remembered: a person is choosing one at a time. */
const MAX_PENDING = 4;

export function createDocumentsApi(service: DocumentService, ui: DocumentUi): DocumentsApi {
  const pending = new Map<string, string>();

  function answer(outcome: ImportPdfOutcome, sourcePath: string): ImportPdfResult {
    if (outcome.status === "added") return { note: outcome.note, document: outcome.document };
    if (outcome.status === "refused") return { error: outcome.error };
    const token = crypto.randomBytes(8).toString("hex");
    pending.set(token, sourcePath);
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value as string);
    return { duplicate: { token, fileName: path.basename(sourcePath), existing: outcome.existing } };
  }

  return {
    listDocuments: () => service.listDocuments(),

    async importPdf(target: ImportTarget) {
      const sourcePath = await ui.pickPdf();
      if (!sourcePath) return { canceled: true };
      return answer(await service.importPdf(sourcePath, target), sourcePath);
    },

    async importPdfCopy(token: string, target: ImportTarget) {
      const sourcePath = pending.get(token);
      if (!sourcePath) return { error: "That import is no longer waiting; choose the file again." };
      pending.delete(token);
      return answer(await service.importPdf(sourcePath, target, { allowDuplicate: true }), sourcePath);
    },

    setDocumentPageCount: (documentId, pageCount) => service.setDocumentPageCount(documentId, pageCount),
    saveDocumentViewState: (documentId, state) => service.saveDocumentViewState(documentId, state),
    listBookmarks: (documentId) => service.listBookmarks(documentId),
    addBookmark: (documentId, page, label) => service.addBookmark(documentId, page, label),
    renameBookmark: (bookmarkId, label) => service.renameBookmark(bookmarkId, label),
    removeBookmark: (bookmarkId) => service.removeBookmark(bookmarkId),
    describeDocument: (noteId) => service.describeDocument(noteId),
    listAnnotations: (documentId) => service.listAnnotations(documentId),
    addAnnotations: (documentId, inputs) => service.addAnnotations(documentId, inputs),
    updateAnnotation: (annotationId, changes) => service.updateAnnotation(annotationId, changes),
    deleteAnnotation: (annotationId) => service.deleteAnnotation(annotationId),
    restoreAnnotations: (documentId, annotations) => service.restoreAnnotations(documentId, annotations),
  };
}
