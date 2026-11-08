import type { DocumentsApi } from "./documentsApi";
import type {} from "./desktopBridge";

/**
 * The desktop app's PDFs, reached over Electron IPC through the preload script's `window.composition`. Only the desktop
 * build uses it (the web app has no panels), so there is no Server Action twin.
 */

function bridge(): DocumentsApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error("The Composition desktop bridge is unavailable. PDFs only run inside the desktop app.");
  }
  return api;
}

export const listDocuments: DocumentsApi["listDocuments"] = () => bridge().listDocuments();
export const importPdf: DocumentsApi["importPdf"] = (target) => bridge().importPdf(target);
export const importPdfCopy: DocumentsApi["importPdfCopy"] = (token, target) => bridge().importPdfCopy(token, target);
export const importDroppedPdf: DocumentsApi["importDroppedPdf"] = (file, target) => bridge().importDroppedPdf(file, target);
export const setDocumentPageCount: DocumentsApi["setDocumentPageCount"] = (id, pageCount) => bridge().setDocumentPageCount(id, pageCount);
export const saveDocumentViewState: DocumentsApi["saveDocumentViewState"] = (id, state) => bridge().saveDocumentViewState(id, state);
export const listBookmarks: DocumentsApi["listBookmarks"] = (id) => bridge().listBookmarks(id);
export const addBookmark: DocumentsApi["addBookmark"] = (id, page, label) => bridge().addBookmark(id, page, label);
export const renameBookmark: DocumentsApi["renameBookmark"] = (id, label) => bridge().renameBookmark(id, label);
export const removeBookmark: DocumentsApi["removeBookmark"] = (id) => bridge().removeBookmark(id);
export const describeDocument: DocumentsApi["describeDocument"] = (noteId) => bridge().describeDocument(noteId);
export const exportDocument: DocumentsApi["exportDocument"] = (id, options) => bridge().exportDocument(id, options);
export const listAnnotations: DocumentsApi["listAnnotations"] = (id) => bridge().listAnnotations(id);
export const addAnnotations: DocumentsApi["addAnnotations"] = (id, inputs) => bridge().addAnnotations(id, inputs);
export const updateAnnotation: DocumentsApi["updateAnnotation"] = (id, changes) => bridge().updateAnnotation(id, changes);
export const deleteAnnotation: DocumentsApi["deleteAnnotation"] = (id) => bridge().deleteAnnotation(id);
export const restoreAnnotations: DocumentsApi["restoreAnnotations"] = (id, annotations) => bridge().restoreAnnotations(id, annotations);
