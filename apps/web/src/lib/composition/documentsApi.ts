import type { PdfMarkKind, PdfRect, PdfViewState } from "./pdfMarkup";

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
