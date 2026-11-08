import type { Note } from "./notesRepo";
import type { AnnotationChanges, PdfAnnotationInput, PdfMarkKind, PdfRect, PdfViewState } from "./pdfMarkup";

/**
 * What the renderer is told about a PDF and its marks (docs/pdf-markup-plan.md). Types only, so this file is safe to import
 * anywhere (renderer, preload, main). The stored name and the hash stay on the server side (documentsRepo.ts), and the
 * renderer never supplies a path: like an attachment, a PDF is chosen in the operating system's own dialog, which only
 * the main process can open.
 */

/** A PDF that a note owns. The bytes live on disk (documents.ts); this is the row that describes them. */
export type PdfDocument = {
  id: number;
  /** What `pdf:<uuid>` links name. The same on every device for the life of the row. */
  uuid: string;
  /** The owner note, live or in the Trash Can. */
  noteId: number;
  /** The name the file had when it was imported; what the user sees. */
  fileName: string;
  /** Size in bytes. */
  size: number;
  /** 0 until the reader has counted them. */
  pageCount: number;
  viewState: PdfViewState;
  createdAt: string;
};

/** One mark on a page. Rectangles are in raw PDF user space (pdfMarkup.ts). */
export type PdfAnnotation = {
  id: number;
  /** What a note's citation names after `a=`. */
  uuid: string;
  documentId: number;
  /** 0-based. */
  page: number;
  kind: PdfMarkKind;
  color: string;
  rects: PdfRect[] | null;
  quote: string;
  comment: string;
  body: unknown;
  groupUuid: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PdfBookmark = {
  id: number;
  uuid: string;
  documentId: number;
  /** 0-based. */
  page: number;
  /** Empty when the user gave none; the page number is shown then. */
  label: string;
  createdAt: string;
};

/** What deleting a PDF's note takes with it: counted for the delete dialog and the Trash Can row. */
export type PdfContents = {
  fileName: string;
  /** Size in bytes. */
  size: number;
  /** Marks by kind (a text note is `text`). */
  marks: Record<PdfMarkKind, number>;
  /** How many pages have ink on them (ink is one record per page). */
  inkPages: number;
  bookmarks: number;
  /** How many notes other than the owner cite the PDF: their quotes stay, and their links stop working. */
  citingNotes: number;
};

/** A note that belongs with a PDF: its owner, or one whose text links to it, and what it cites of it. */
export type PdfCitation = {
  noteId: number;
  title: string;
  /** The note that owns the PDF (listed first, whether or not its text links to it). */
  owner: boolean;
  /** The pages (from 1) its links name. */
  pages: number[];
  /** The uuids of the marks its links name. */
  marks: string[];
};

/** How a PDF is exported with its marks. */
export type ExportPdfOptions = {
  /** Draw the marks into the pages (every app shows them the same, none can be edited) instead of adding annotations. */
  flatten: boolean;
};

/** What an export did, or why it did not: nothing is said of where, since the page never knows a path. */
export type ExportPdfResult =
  | { saved: true; fileName: string; written: number; skipped: { ink: number; offPage: number } }
  | { canceled: true }
  | { error: string };

/** Where an imported PDF's note goes: the group and notebook the sidebar is on. */
export type ImportTarget = { groupId: number | null; notebookId: number };

/** A PDF the same bytes of which are already imported, with the note that owns it. */
export type ExistingPdf = { document: PdfDocument; noteTitle: string };

/**
 * What an import came to. Cancelling the picker is not an error: `canceled` is set. When the file is one you already have,
 * nothing is imported and `duplicate` says which PDFs hold the same bytes; `token` stands for the file the user picked, so
 * that "Import a separate copy" (`importPdfCopy`) needs no path from the page.
 */
export type ImportPdfResult = {
  note?: Note;
  document?: PdfDocument;
  duplicate?: { token: string; fileName: string; existing: ExistingPdf[] };
  error?: string;
  canceled?: boolean;
};

/**
 * The contract for PDFs a note owns. Desktop only, like the reader that shows them: the web app and the CLI keep the file
 * and the note (docs/pdf-markup-plan.md). The renderer never supplies a path: a PDF is chosen in the operating system's own
 * dialog, which only the main process can open, and its bytes are served to the reader by the app scheme.
 */
export interface DocumentsApi {
  /** Every PDF, one per owner note. */
  listDocuments(): Promise<PdfDocument[]>;
  /** Opens the file picker, makes a note for the PDF in the target group, and imports the file into it. */
  importPdf(target: ImportTarget): Promise<ImportPdfResult>;
  /** Imports the file a refused `importPdf` found a duplicate of (`token`), as a separate copy, into a new note. */
  importPdfCopy(token: string, target: ImportTarget): Promise<ImportPdfResult>;
  /** Records how many pages the reader counted. */
  setDocumentPageCount(documentId: number, pageCount: number): Promise<void>;
  /** Remembers where the reader was in a PDF. */
  saveDocumentViewState(documentId: number, state: PdfViewState): Promise<void>;
  listBookmarks(documentId: number): Promise<PdfBookmark[]>;
  addBookmark(documentId: number, page: number, label: string): Promise<PdfBookmark>;
  renameBookmark(bookmarkId: number, label: string): Promise<PdfBookmark | null>;
  removeBookmark(bookmarkId: number): Promise<void>;
  /** What deleting the note would take with it; null when the note owns no PDF. */
  describeDocument(noteId: number): Promise<PdfContents | null>;
  /**
   * Writes a copy of the PDF with its marks in it, to a file the user chooses in the operating system's own dialog (the page
   * never names a path). The PDF in the library is not changed.
   */
  exportDocument(documentId: number, options: ExportPdfOptions): Promise<ExportPdfResult>;
  /** Every mark of a PDF, by page. */
  listAnnotations(documentId: number): Promise<PdfAnnotation[]>;
  /** Makes the marks of one selection: one per page it covers, tied together when there are several. Refuses all or none. */
  addAnnotations(documentId: number, inputs: PdfAnnotationInput[]): Promise<PdfAnnotation[]>;
  /** Changes a mark's color, comment, quote, rectangles or body. Null when it is gone. */
  updateAnnotation(annotationId: number, changes: AnnotationChanges): Promise<PdfAnnotation | null>;
  /** Deletes a mark and the other parts of its selection; says which were deleted, so that the delete can be undone. */
  deleteAnnotation(annotationId: number): Promise<PdfAnnotation[]>;
  /** Puts back marks deleted a moment ago, as they were, with the same uuids (what undoing a delete does). */
  restoreAnnotations(documentId: number, annotations: PdfAnnotation[]): Promise<PdfAnnotation[]>;
}

/** Every method of DocumentsApi, as data; the check below fails to compile if one is missing (see API_METHODS in api.ts). */
export const DOCUMENT_METHODS = [
  "listDocuments",
  "importPdf",
  "importPdfCopy",
  "setDocumentPageCount",
  "saveDocumentViewState",
  "listBookmarks",
  "addBookmark",
  "renameBookmark",
  "removeBookmark",
  "describeDocument",
  "exportDocument",
  "listAnnotations",
  "addAnnotations",
  "updateAnnotation",
  "deleteAnnotation",
  "restoreAnnotations",
] as const satisfies readonly (keyof DocumentsApi)[];

export type DocumentMethod = (typeof DOCUMENT_METHODS)[number];

type MissingFromDocumentMethods = Exclude<keyof DocumentsApi, DocumentMethod>;
const _everyMethodListed: [MissingFromDocumentMethods] extends [never] ? true : never = true;
void _everyMethodListed;
