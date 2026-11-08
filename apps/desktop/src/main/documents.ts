import crypto from "node:crypto";
import path from "node:path";
import type { DocumentsHost, ImportPdfResult, ImportTarget } from "../../../web/src/lib/composition/documentsApi";
import type { ImportPdfOutcome } from "../../../web/src/lib/composition/service";
import type { service as Service } from "./backend";
import { checkDroppedPdf } from "./droppedPdf";
import type { ExportJob, ExportOutcome } from "./exportJob";

/**
 * The desktop-only DocumentsApi (see apps/web/src/lib/composition/documentsApi.ts).
 *
 * The operating system's dialog is what chooses the PDF: the renderer asks to "import a PDF into this group", never names
 * a path, so a compromised page cannot make the app copy a file of its choosing into the library. A file that turns out
 * to be one the library already has is remembered here, under a random token, so that "Import a separate copy" can go
 * ahead without the page ever being told where the file is.
 *
 * A PDF dropped on the window is the one other way in. The page hands the drop's File to the preload script, which reads the
 * path the operating system gave it and sends only that here; the page never sees it, and cannot make one up. The main
 * process checks it anyway (droppedPdf.ts) before the import looks inside the file.
 */

/** The native pieces this needs, as plain functions, so tests don't need Electron. */
export type DocumentUi = {
  /** The path of the PDF the user picked, or null if they cancelled. */
  pickPdf(): Promise<string | null>;
  /** Where the user wants an exported copy saved (the save dialog, offering `defaultName`), or null if they cancelled. */
  pickExportPath(defaultName: string): Promise<string | null>;
  /** Writes the export, out of the main process (see exportProcess.ts). */
  exportPdf(job: ExportJob): Promise<ExportOutcome>;
  /** The application data folder: the library's own files, which a dropped file must not come from. */
  dataFolder(): string;
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
  | "documentForExport"
  | "listAnnotations"
  | "addAnnotations"
  | "updateAnnotation"
  | "deleteAnnotation"
  | "restoreAnnotations"
>;

/** How many files found to be duplicates are remembered: a person is choosing one at a time. */
const MAX_PENDING = 4;

export function createDocumentsApi(service: DocumentService, ui: DocumentUi): DocumentsHost {
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

    async importDroppedPdf(droppedPath: string, target: ImportTarget) {
      const checked = await checkDroppedPdf(droppedPath, ui.dataFolder());
      if (!checked.ok) return { error: checked.error };
      return answer(await service.importPdf(checked.path, target), checked.path);
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

    async exportDocument(documentId, options) {
      const input = service.documentForExport(documentId);
      if (!input) return { error: "This PDF is no longer in the library." };
      const targetPath = await ui.pickExportPath(`${input.fileName.replace(/\.pdf$/i, "")} (annotated).pdf`);
      if (!targetPath) return { canceled: true };
      // The PDF in the library is never written to, even if the user points the dialog at it.
      if (path.resolve(targetPath) === path.resolve(input.path)) return { error: "Choose another file: the PDF in the library is never overwritten." };
      const outcome = await ui.exportPdf({ sourcePath: input.path, targetPath, marks: input.marks, flatten: options.flatten, ...(options.password === undefined ? {} : { password: options.password }) });
      return outcome.ok
        ? { saved: true, fileName: path.basename(targetPath), written: outcome.written, skipped: outcome.skipped, passwordProtected: outcome.passwordProtected }
        : { error: outcome.error };
    },
    listAnnotations: (documentId) => service.listAnnotations(documentId),
    addAnnotations: (documentId, inputs) => service.addAnnotations(documentId, inputs),
    updateAnnotation: (annotationId, changes) => service.updateAnnotation(annotationId, changes),
    deleteAnnotation: (annotationId) => service.deleteAnnotation(annotationId),
    restoreAnnotations: (documentId, annotations) => service.restoreAnnotations(documentId, annotations),
  };
}
