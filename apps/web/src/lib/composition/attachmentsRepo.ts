import { getDb } from "./db";
import type { Attachment } from "./attachmentsApi";

/** An attachment plus where its bytes are: the name of the file in `<application data>/attachments/`. */
export type StoredAttachment = Attachment & { storedName: string };

type AttachmentRow = {
  id: number;
  note_id: number;
  file_name: string;
  stored_name: string;
  size: number;
  created_at: string;
};

function fromRow(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id,
    noteId: row.note_id,
    fileName: row.file_name,
    storedName: row.stored_name,
    size: row.size,
    createdAt: row.created_at,
  };
}

export function listAttachments(noteId: number): StoredAttachment[] {
  const rows = getDb()
    .prepare("SELECT * FROM attachments WHERE note_id = ? ORDER BY id")
    .all(noteId) as AttachmentRow[];
  return rows.map(fromRow);
}

export function getAttachment(id: number): StoredAttachment | null {
  const row = getDb().prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
    | AttachmentRow
    | undefined;
  return row ? fromRow(row) : null;
}

export function addAttachment(
  noteId: number,
  fileName: string,
  storedName: string,
  size: number,
): StoredAttachment {
  const result = getDb()
    .prepare(
      `INSERT INTO attachments (note_id, file_name, stored_name, size, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(noteId, fileName, storedName, size, new Date().toISOString());
  const attachment = getAttachment(Number(result.lastInsertRowid));
  if (!attachment) throw new Error("Failed to read back the attachment that was just added");
  return attachment;
}

export function deleteAttachment(id: number): void {
  getDb().prepare("DELETE FROM attachments WHERE id = ?").run(id);
}

/** Drops every attachment row of a note and returns them, so the caller can delete the files. */
export function deleteAttachmentsForNote(noteId: number): StoredAttachment[] {
  const removed = listAttachments(noteId);
  getDb().prepare("DELETE FROM attachments WHERE note_id = ?").run(noteId);
  return removed;
}

/**
 * Drops the rows of attachments whose note is neither in `notes` nor in the Trash
 * Can (`trashed_notes`), and returns them so the caller can delete the files.
 * Attachments of a trashed note are kept: restoring the note brings them back.
 */
export function deleteOrphanedAttachments(): StoredAttachment[] {
  const db = getDb();
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM attachments
         WHERE note_id NOT IN (SELECT id FROM notes)
           AND note_id NOT IN (SELECT id FROM trashed_notes)`,
      )
      .all() as AttachmentRow[];
    for (const row of rows) db.prepare("DELETE FROM attachments WHERE id = ?").run(row.id);
    return rows.map(fromRow);
  })();
}
