import crypto from "node:crypto";
import { getDb } from "./db";
import type { PdfAnnotation, PdfBookmark } from "./documentsApi";
import {
  InvalidMarkError,
  validateAnnotation,
  validateBookmarkLabel,
  type AnnotationChanges,
  type PdfAnnotationInput,
  type PdfRect,
  type ValidAnnotation,
} from "./pdfMarkup";

/**
 * The marks and bookmarks of a PDF. Every write is checked by pdfMarkup.ts and against the PDF's page count (a PDF whose
 * pages have not been counted yet, `page_count` 0, accepts any page), and every mark and bookmark gets a uuid from the
 * table's trigger. `pdf:` links name a PDF and a mark by those uuids.
 */

type AnnotationRow = {
  id: number;
  uuid: string;
  document_id: number;
  page: number;
  kind: PdfAnnotation["kind"];
  color: string;
  rects: string | null;
  quote: string;
  comment: string;
  body: string | null;
  group_uuid: string | null;
  created_at: string;
  updated_at: string;
};

type BookmarkRow = {
  id: number;
  uuid: string;
  document_id: number;
  page: number;
  label: string;
  created_at: string;
};

function annotationFromRow(row: AnnotationRow): PdfAnnotation {
  return {
    id: row.id,
    uuid: row.uuid,
    documentId: row.document_id,
    page: row.page,
    kind: row.kind,
    color: row.color,
    rects: row.rects === null ? null : (JSON.parse(row.rects) as PdfRect[]),
    quote: row.quote,
    comment: row.comment,
    body: row.body === null ? null : (JSON.parse(row.body) as unknown),
    groupUuid: row.group_uuid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bookmarkFromRow(row: BookmarkRow): PdfBookmark {
  return {
    id: row.id,
    uuid: row.uuid,
    documentId: row.document_id,
    page: row.page,
    label: row.label,
    createdAt: row.created_at,
  };
}

/** Throws unless the PDF exists and `page` is one of its pages. */
function assertPage(documentId: number, page: number): void {
  const row = getDb().prepare("SELECT page_count FROM documents WHERE id = ?").get(documentId) as { page_count: number } | undefined;
  if (!row) throw new InvalidMarkError("That PDF no longer exists.");
  if (row.page_count > 0 && page >= row.page_count) throw new InvalidMarkError(`This PDF has ${row.page_count} pages; page ${page} is past the end.`);
}

const now = () => new Date().toISOString();

// --- marks -------------------------------------------------------------------

/** The marks of a PDF, or of one page of it, in the order they were made. */
export function listAnnotations(documentId: number, page?: number): PdfAnnotation[] {
  const db = getDb();
  const rows =
    page === undefined
      ? (db.prepare("SELECT * FROM pdf_annotations WHERE document_id = ? ORDER BY page, id").all(documentId) as AnnotationRow[])
      : (db.prepare("SELECT * FROM pdf_annotations WHERE document_id = ? AND page = ? ORDER BY id").all(documentId, page) as AnnotationRow[]);
  return rows.map(annotationFromRow);
}

export function getAnnotation(id: number): PdfAnnotation | null {
  const row = getDb().prepare("SELECT * FROM pdf_annotations WHERE id = ?").get(id) as AnnotationRow | undefined;
  return row ? annotationFromRow(row) : null;
}

export function getAnnotationByUuid(uuid: string): PdfAnnotation | null {
  const row = getDb().prepare("SELECT * FROM pdf_annotations WHERE uuid = ?").get(uuid) as AnnotationRow | undefined;
  return row ? annotationFromRow(row) : null;
}

function insertAnnotation(documentId: number, mark: ValidAnnotation): PdfAnnotation {
  const stamp = now();
  const result = getDb()
    .prepare(
      `INSERT INTO pdf_annotations (document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      documentId,
      mark.page,
      mark.kind,
      mark.color,
      mark.rects === null ? null : JSON.stringify(mark.rects),
      mark.quote,
      mark.comment,
      mark.body === null ? null : JSON.stringify(mark.body),
      mark.groupUuid,
      stamp,
      stamp,
    );
  const annotation = getAnnotation(Number(result.lastInsertRowid));
  if (!annotation) throw new Error("Failed to read back the mark that was just added");
  return annotation;
}

export function addAnnotation(documentId: number, input: PdfAnnotationInput): PdfAnnotation {
  const mark = validateAnnotation(input);
  const db = getDb();
  return db.transaction(() => {
    assertPage(documentId, mark.page);
    return insertAnnotation(documentId, mark);
  })();
}

/**
 * A selection that crossed pages is one record per page, joined by a group uuid made here: one input is an ordinary mark
 * (no group), two or more share one. All or none are stored.
 */
export function addAnnotationGroup(documentId: number, inputs: readonly PdfAnnotationInput[]): PdfAnnotation[] {
  if (inputs.length === 0) return [];
  const groupUuid = inputs.length > 1 ? crypto.randomBytes(16).toString("hex") : null;
  const marks = inputs.map((input) => validateAnnotation({ ...input, groupUuid }));
  const db = getDb();
  return db.transaction(() => {
    for (const mark of marks) assertPage(documentId, mark.page);
    return marks.map((mark) => insertAnnotation(documentId, mark));
  })();
}

/** Changes what the caller names and re-checks the whole mark; its page, kind and group never change. Null when it is gone. */
export function updateAnnotation(id: number, changes: AnnotationChanges): PdfAnnotation | null {
  const db = getDb();
  return db.transaction(() => {
    const current = getAnnotation(id);
    if (!current) return null;
    const mark = validateAnnotation({
      page: current.page,
      kind: current.kind,
      color: changes.color ?? current.color,
      rects: changes.rects === undefined ? current.rects : changes.rects,
      quote: changes.quote ?? current.quote,
      comment: changes.comment ?? current.comment,
      body: changes.body === undefined ? current.body : changes.body,
      groupUuid: current.groupUuid,
    });
    db.prepare(
      `UPDATE pdf_annotations SET color = ?, rects = ?, quote = ?, comment = ?, body = ?, updated_at = ? WHERE id = ?`,
    ).run(
      mark.color,
      mark.rects === null ? null : JSON.stringify(mark.rects),
      mark.quote,
      mark.comment,
      mark.body === null ? null : JSON.stringify(mark.body),
      now(),
      id,
    );
    return getAnnotation(id);
  })();
}

const UUID = /^[0-9a-f]{32}$/;
const TIMESTAMP_LENGTH = 40;

/**
 * Puts back marks that were deleted, exactly as they were: the same uuid (a note's citation of a mark names it by uuid), the
 * same group, the same times, and the same id when it is free (ids are never reused, so it is). This is what undoing a delete
 * does. Each is checked as a new mark would be. A mark whose uuid is already there is left alone, so asking twice, as a redo
 * after an undo may, does no harm. All or none are put back.
 */
export function restoreAnnotations(documentId: number, rows: readonly PdfAnnotation[]): PdfAnnotation[] {
  const checked = rows.map((row) => {
    if (typeof row.uuid !== "string" || !UUID.test(row.uuid)) throw new InvalidMarkError("A mark's uuid is 32 lowercase hex characters.");
    for (const time of [row.createdAt, row.updatedAt]) {
      if (typeof time !== "string" || time === "" || time.length > TIMESTAMP_LENGTH) throw new InvalidMarkError("A mark has the times it was made and changed.");
    }
    return { row, mark: validateAnnotation({ page: row.page, kind: row.kind, color: row.color, rects: row.rects, quote: row.quote, comment: row.comment, body: row.body, groupUuid: row.groupUuid }) };
  });
  const db = getDb();
  return db.transaction(() => {
    const restored: PdfAnnotation[] = [];
    for (const { row, mark } of checked) {
      assertPage(documentId, mark.page);
      const existing = getAnnotationByUuid(row.uuid);
      if (existing) {
        restored.push(existing);
        continue;
      }
      const idFree = Number.isSafeInteger(row.id) && !db.prepare("SELECT 1 FROM pdf_annotations WHERE id = ?").get(row.id);
      db.prepare(
        `INSERT INTO pdf_annotations (id, uuid, document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        idFree ? row.id : null,
        row.uuid,
        documentId,
        mark.page,
        mark.kind,
        mark.color,
        mark.rects === null ? null : JSON.stringify(mark.rects),
        mark.quote,
        mark.comment,
        mark.body === null ? null : JSON.stringify(mark.body),
        mark.groupUuid,
        row.createdAt,
        row.updatedAt,
      );
      const inserted = getAnnotationByUuid(row.uuid);
      if (!inserted) throw new Error("Failed to read back the mark that was just restored");
      restored.push(inserted);
    }
    return restored;
  })();
}

/**
 * Deletes a mark, and with it the other parts of the same selection when it crossed pages: the reader shows one
 * highlight, so one delete removes it. Returns what was removed (empty when it was already gone).
 */
export function deleteAnnotation(id: number): PdfAnnotation[] {
  const db = getDb();
  return db.transaction(() => {
    const mark = getAnnotation(id);
    if (!mark) return [];
    const rows =
      mark.groupUuid === null
        ? [mark]
        : (db.prepare("SELECT * FROM pdf_annotations WHERE group_uuid = ? ORDER BY page, id").all(mark.groupUuid) as AnnotationRow[]).map(annotationFromRow);
    for (const row of rows) db.prepare("DELETE FROM pdf_annotations WHERE id = ?").run(row.id);
    return rows;
  })();
}

// --- bookmarks ---------------------------------------------------------------

export function listBookmarks(documentId: number): PdfBookmark[] {
  const rows = getDb().prepare("SELECT * FROM pdf_bookmarks WHERE document_id = ? ORDER BY page, id").all(documentId) as BookmarkRow[];
  return rows.map(bookmarkFromRow);
}

export function getBookmark(id: number): PdfBookmark | null {
  const row = getDb().prepare("SELECT * FROM pdf_bookmarks WHERE id = ?").get(id) as BookmarkRow | undefined;
  return row ? bookmarkFromRow(row) : null;
}

export function addBookmark(documentId: number, page: number, label = ""): PdfBookmark {
  if (!Number.isInteger(page) || page < 0) throw new InvalidMarkError("A page is a whole number from 0.");
  const text = validateBookmarkLabel(label);
  const db = getDb();
  return db.transaction(() => {
    assertPage(documentId, page);
    const result = db
      .prepare("INSERT INTO pdf_bookmarks (document_id, page, label, created_at) VALUES (?, ?, ?, ?)")
      .run(documentId, page, text, now());
    const bookmark = getBookmark(Number(result.lastInsertRowid));
    if (!bookmark) throw new Error("Failed to read back the bookmark that was just added");
    return bookmark;
  })();
}

/** Renames a bookmark. Null when it is gone. */
export function renameBookmark(id: number, label: string): PdfBookmark | null {
  const text = validateBookmarkLabel(label);
  getDb().prepare("UPDATE pdf_bookmarks SET label = ? WHERE id = ?").run(text, id);
  return getBookmark(id);
}

export function deleteBookmark(id: number): void {
  getDb().prepare("DELETE FROM pdf_bookmarks WHERE id = ?").run(id);
}
