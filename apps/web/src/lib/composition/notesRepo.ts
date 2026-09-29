import { getDb } from "./db";
import * as frontmatter from "./frontmatter";

export type Note = {
  id: number;
  title: string;
  content: string;
  tags: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  groupId: number | null;
};

type NoteRow = {
  id: number;
  title: string;
  content: string;
  tags: string;
  description: string;
  created_at: string;
  updated_at: string;
  group_id: number | null;
};

function fromRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groupId: row.group_id,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function listNotes(): Note[] {
  const rows = getDb()
    .prepare("SELECT * FROM notes ORDER BY updated_at DESC")
    .all() as NoteRow[];
  return rows.map(fromRow);
}

export function getNote(id: number): Note | null {
  const row = getDb().prepare("SELECT * FROM notes WHERE id = ?").get(id) as
    | NoteRow
    | undefined;
  return row ? fromRow(row) : null;
}

export function createNote(
  title: string,
  tags = "",
  groupId: number | null = null,
): Note {
  const now = nowIso();
  const content = frontmatter.generate(title, {
    createdAt: now,
    updatedAt: now,
    tags: frontmatter.tagsFromString(tags),
  });
  const result = getDb()
    .prepare(
      `INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id)
       VALUES (?, ?, ?, '', ?, ?, ?)`,
    )
    .run(title, content, tags, now, now, groupId);
  const note = getNote(Number(result.lastInsertRowid));
  if (!note) throw new Error("Failed to read back the note that was just created");
  return note;
}

/** Fallback path: content + updated_at only, title/tags/description untouched. */
export function updateNoteContent(id: number, content: string): void {
  getDb()
    .prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?")
    .run(content, nowIso(), id);
}

/** Full-sync path: content plus the DB columns synced from parsed frontmatter. */
export function updateNote(
  id: number,
  content: string,
  fields: { title: string; tags: string; description: string },
): void {
  getDb()
    .prepare(
      `UPDATE notes SET content = ?, title = ?, tags = ?, description = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(content, fields.title, fields.tags, fields.description, nowIso(), id);
}

export function deleteNote(id: number): void {
  getDb().prepare("DELETE FROM notes WHERE id = ?").run(id);
}

/**
 * Doesn't bump updated_at — a move isn't a content edit, and bumping it
 * would reorder the note in listNotes() just from moving it.
 */
export function setNoteGroup(id: number, groupId: number | null): void {
  getDb().prepare("UPDATE notes SET group_id = ? WHERE id = ?").run(groupId, id);
}
