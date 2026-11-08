import { getDb } from "./db";
import type { PdfDocument } from "./documentsApi";
import { normalizeViewState, parseViewState, type PdfViewState } from "./pdfMarkup";

/** A PDF plus where its bytes are and their hash: the name of the file in `<application data>/documents/`. */
export type StoredDocument = PdfDocument & { storedName: string; sha256: string };

type DocumentRow = {
  id: number;
  uuid: string;
  note_id: number;
  file_name: string;
  stored_name: string;
  sha256: string;
  size: number;
  page_count: number;
  view_state: string | null;
  created_at: string;
};

function fromRow(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    uuid: row.uuid,
    noteId: row.note_id,
    fileName: row.file_name,
    storedName: row.stored_name,
    sha256: row.sha256,
    size: row.size,
    pageCount: row.page_count,
    viewState: parseViewState(row.view_state),
    createdAt: row.created_at,
  };
}

/** Why a PDF can't be given to a note: there is no such note, or it already owns one (a note owns at most one PDF). */
export class DocumentOwnerError extends Error {
  constructor(readonly reason: "no-note" | "has-document") {
    super(reason === "no-note" ? "That note no longer exists." : "That note already has a PDF.");
    this.name = "DocumentOwnerError";
  }
}

export function getDocument(id: number): StoredDocument | null {
  const row = getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
  return row ? fromRow(row) : null;
}

export function getDocumentByUuid(uuid: string): StoredDocument | null {
  const row = getDb().prepare("SELECT * FROM documents WHERE uuid = ?").get(uuid) as DocumentRow | undefined;
  return row ? fromRow(row) : null;
}

/** The PDF a note owns, whether the note is live or in the Trash Can. */
export function getDocumentForNote(noteId: number): StoredDocument | null {
  const row = getDb().prepare("SELECT * FROM documents WHERE note_id = ?").get(noteId) as DocumentRow | undefined;
  return row ? fromRow(row) : null;
}

/** Every PDF with exactly these bytes, oldest first: what a second import of the same file is offered (P16). */
export function findDocumentsBySha256(sha256: string): StoredDocument[] {
  const rows = getDb().prepare("SELECT * FROM documents WHERE sha256 = ? ORDER BY id").all(sha256) as DocumentRow[];
  return rows.map(fromRow);
}

/** Gives a live note its PDF. Throws `DocumentOwnerError` when the note is gone or already has one. */
export function addDocument(input: {
  noteId: number;
  fileName: string;
  storedName: string;
  sha256: string;
  size: number;
  pageCount: number;
}): StoredDocument {
  const db = getDb();
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM notes WHERE id = ?").get(input.noteId)) throw new DocumentOwnerError("no-note");
    if (db.prepare("SELECT 1 FROM documents WHERE note_id = ?").get(input.noteId)) throw new DocumentOwnerError("has-document");
    const result = db
      .prepare(
        `INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.noteId, input.fileName, input.storedName, input.sha256, input.size, input.pageCount, new Date().toISOString());
    const document = getDocument(Number(result.lastInsertRowid));
    if (!document) throw new Error("Failed to read back the PDF that was just added");
    return document;
  }).immediate();
}

/** Records how many pages the reader counted. A PDF imported before it was counted has 0. */
export function setPageCount(id: number, pageCount: number): void {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new RangeError("A PDF has at least one page.");
  getDb().prepare("UPDATE documents SET page_count = ? WHERE id = ?").run(pageCount, id);
}

/** Remembers where the reader was. Keeps the keys it knows and drops the rest (pdfMarkup.ts normalizeViewState). */
export function setViewState(id: number, state: PdfViewState): void {
  getDb().prepare("UPDATE documents SET view_state = ? WHERE id = ?").run(JSON.stringify(normalizeViewState(state)), id);
}

/** Drops a PDF's row, its marks and its bookmarks in one transaction, and returns the row so the caller can delete the file. */
export function deleteDocument(id: number): StoredDocument | null {
  const db = getDb();
  return db.transaction(() => {
    const document = getDocument(id);
    if (!document) return null;
    db.prepare("DELETE FROM pdf_annotations WHERE document_id = ?").run(id);
    db.prepare("DELETE FROM pdf_bookmarks WHERE document_id = ?").run(id);
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    return document;
  })();
}

/**
 * Drops the PDFs whose owner note is neither in `notes` nor in the Trash Can (`trashed_notes`), with their marks and
 * bookmarks, and returns them so the caller can delete the files. A PDF whose note is in the Trash Can is kept:
 * restoring the note finds it again by the note's unchanged id. Also drops marks and bookmarks whose PDF is gone
 * (nothing leaves such rows now, but a file the owner edited or a half-finished restore could).
 */
export function deleteOrphanedDocuments(): StoredDocument[] {
  const db = getDb();
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM documents
         WHERE note_id NOT IN (SELECT id FROM notes)
           AND note_id NOT IN (SELECT id FROM trashed_notes)`,
      )
      .all() as DocumentRow[];
    for (const row of rows) {
      db.prepare("DELETE FROM pdf_annotations WHERE document_id = ?").run(row.id);
      db.prepare("DELETE FROM pdf_bookmarks WHERE document_id = ?").run(row.id);
      db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
    }
    db.prepare("DELETE FROM pdf_annotations WHERE document_id NOT IN (SELECT id FROM documents)").run();
    db.prepare("DELETE FROM pdf_bookmarks WHERE document_id NOT IN (SELECT id FROM documents)").run();
    return rows.map(fromRow);
  })();
}
