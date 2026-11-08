/**
 * Pure helpers for the PDFs a note can own (docs/pdf-markup-plan.md). No Node imports, so the renderer can use them and
 * the main process the rest. Stored names follow the attachments rule (attachmentNames.ts): a unique prefix, then the
 * original name made safe.
 */

/** Folder inside the application data directory that holds the PDFs. */
export const DOCUMENT_DIR_NAME = "documents";

/** Largest PDF the app imports: the same limit as an attachment (P9). The bytes sit on disk, so this is a sanity limit. */
export const MAX_DOCUMENT_BYTES = 1_000_000_000;

/** How far into a file pdf.js looks for `%PDF-`: some PDFs have a few bytes of junk before the header. */
export const PDF_HEADER_WINDOW = 1024;

/** Whether the start of a file (at least its first `PDF_HEADER_WINDOW` bytes) has a PDF header. */
export function looksLikePdf(head: Uint8Array): boolean {
  const limit = Math.min(head.length, PDF_HEADER_WINDOW) - 4;
  for (let i = 0; i < limit; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  }
  return false;
}

/** A stored name is one path segment of the shape the app generates; the same test the backup applies to a restored file. */
export const STORED_DOCUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
