import { getDb } from "./db";
import * as frontmatter from "./frontmatter";
import { placeBefore } from "./ordering";

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

/**
 * Display order. Notes nobody has dragged into place (`position` NULL, which includes
 * every new note) come first, most recently edited first; hand-placed ones follow in
 * their set order.
 */
const DISPLAY_ORDER = "position IS NOT NULL, position, updated_at DESC, id DESC";

export function listNotes(): Note[] {
  const rows = getDb()
    .prepare(`SELECT * FROM notes ORDER BY ${DISPLAY_ORDER}`)
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

/**
 * Doesn't bump updated_at — a move isn't a content edit, and bumping it
 * would reorder the note in listNotes() just from moving it. Clears the
 * note's hand-set position: it no longer means anything among new siblings.
 */
export function setNoteGroup(id: number, groupId: number | null): void {
  getDb()
    .prepare("UPDATE notes SET group_id = ?, position = NULL WHERE id = ?")
    .run(groupId, id);
}

/**
 * Puts a note in `groupId` immediately before the sibling `beforeId` (last when
 * null) and fixes the whole sibling list's order, so what the user sees is what
 * stays. Like setNoteGroup, it isn't a content edit.
 */
export function placeNote(id: number, groupId: number | null, beforeId: number | null): void {
  const db = getDb();
  db.transaction(() => {
    const siblings = (
      db
        .prepare(`SELECT id FROM notes WHERE group_id IS ? ORDER BY ${DISPLAY_ORDER}`)
        .all(groupId) as { id: number }[]
    ).map((row) => row.id);
    const ordered = placeBefore(siblings, id, beforeId);
    db.prepare("UPDATE notes SET group_id = ? WHERE id = ?").run(groupId, id);
    const setPosition = db.prepare("UPDATE notes SET position = ? WHERE id = ?");
    ordered.forEach((noteId, index) => setPosition.run(index, noteId));
  })();
}
