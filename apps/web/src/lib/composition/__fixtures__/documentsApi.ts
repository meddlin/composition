import { vi } from "vitest";
import type { DocumentsApi } from "../documentsApi";

/**
 * A `DocumentsApi` whose every method is a mock that answers with nothing much, for the tests of what sits on top of it; a
 * test replaces the methods it is about. Test code only.
 */
export function fakeDocumentsApi(over: Partial<DocumentsApi> = {}): DocumentsApi {
  return {
    listDocuments: vi.fn(async () => []),
    importPdf: vi.fn(async () => ({ canceled: true })),
    importPdfCopy: vi.fn(async () => ({ canceled: true })),
    importDroppedPdf: vi.fn(async () => ({ canceled: true })),
    setDocumentPageCount: vi.fn(async () => {}),
    saveDocumentViewState: vi.fn(async () => {}),
    listBookmarks: vi.fn(async () => []),
    addBookmark: vi.fn(async () => ({}) as never),
    renameBookmark: vi.fn(async () => null),
    removeBookmark: vi.fn(async () => {}),
    describeDocument: vi.fn(async () => null),
    exportDocument: vi.fn(async () => ({ canceled: true as const })),
    listAnnotations: vi.fn(async () => []),
    addAnnotations: vi.fn(async () => []),
    updateAnnotation: vi.fn(async () => null),
    deleteAnnotation: vi.fn(async () => []),
    restoreAnnotations: vi.fn(async () => []),
    ...over,
  };
}
