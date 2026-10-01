import { getDb } from "./db";
import { GroupNotEmptyError, groupIsEmpty } from "./groupsRepo";
import { expiryOf, retentionCutoff, type Trash } from "./trash";

/**
 * The only way a note or group leaves the `notes`/`groups` tables: it moves to
 * the trash tables (db.ts), from where it can be restored until it is
 * permanently deleted by hand or by outliving the retention window.
 */

type TrashedNoteRow = { id: number; title: string; deleted_at: string };
type TrashedGroupRow = { id: number; name: string; deleted_at: string };

function nowIso(): string {
  return new Date().toISOString();
}

/** Moves a note to the trash. A note that's already gone is ignored. */
export function trashNote(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO trashed_notes
         (id, title, content, tags, description, created_at, updated_at, group_id, deleted_at)
       SELECT id, title, content, tags, description, created_at, updated_at, group_id, ?
       FROM notes WHERE id = ?`,
    ).run(nowIso(), id);
    db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  })();
}

/**
 * Moves a group to the trash. Refuses a group that still has sub-groups or
 * notes, so no trashed item ever hangs off another one.
 */
export function trashGroup(id: number): void {
  const db = getDb();
  db.transaction(() => {
    if (!groupIsEmpty(id)) {
      throw new GroupNotEmptyError(
        `Group ${id} still has sub-groups or notes; empty it before deleting.`,
      );
    }
    db.prepare(
      `INSERT OR REPLACE INTO trashed_groups
         (id, name, parent_id, created_at, updated_at, deleted_at)
       SELECT id, name, parent_id, created_at, updated_at, ?
       FROM groups WHERE id = ?`,
    ).run(nowIso(), id);
    db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  })();
}

export function listTrash(): Trash {
  const db = getDb();
  const notes = db
    .prepare("SELECT id, title, deleted_at FROM trashed_notes ORDER BY deleted_at DESC, id DESC")
    .all() as TrashedNoteRow[];
  const groups = db
    .prepare("SELECT id, name, deleted_at FROM trashed_groups ORDER BY deleted_at DESC, id DESC")
    .all() as TrashedGroupRow[];
  return {
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      deletedAt: n.deleted_at,
      expiresAt: expiryOf(n.deleted_at),
    })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      deletedAt: g.deleted_at,
      expiresAt: expiryOf(g.deleted_at),
    })),
  };
}

/**
 * Puts a trashed note back, in its original group if that group still exists,
 * otherwise ungrouped. Returns null when the note isn't in the trash (already
 * restored or purged, perhaps by another window); `restoredToTopLevel` says
 * whether its group was gone.
 */
export function restoreNote(id: number): { restoredToTopLevel: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM trashed_notes WHERE id = ?").get(id) as
      | {
          title: string;
          content: string;
          tags: string;
          description: string;
          created_at: string;
          updated_at: string;
          group_id: number | null;
        }
      | undefined;
    if (!row) return null;

    const groupExists =
      row.group_id !== null && db.prepare("SELECT 1 FROM groups WHERE id = ?").get(row.group_id);
    const groupId = groupExists ? row.group_id : null;
    // Ids are never reused (AUTOINCREMENT), so keeping it is safe; a clash would
    // mean the database was swapped underneath us, and a fresh id is still correct.
    const idTaken = db.prepare("SELECT 1 FROM notes WHERE id = ?").get(id);
    db.prepare(
      `INSERT INTO notes (id, title, content, tags, description, created_at, updated_at, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      idTaken ? null : id,
      row.title,
      row.content,
      row.tags,
      row.description,
      row.created_at,
      row.updated_at,
      groupId,
    );
    db.prepare("DELETE FROM trashed_notes WHERE id = ?").run(id);
    return { restoredToTopLevel: row.group_id !== null && groupId === null };
  })();
}

/**
 * Puts a trashed group back under its original parent if that still exists,
 * otherwise at the top level. Null when the group isn't in the trash.
 */
export function restoreGroup(id: number): { restoredToTopLevel: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM trashed_groups WHERE id = ?").get(id) as
      | { name: string; parent_id: number | null; created_at: string; updated_at: string }
      | undefined;
    if (!row) return null;

    const parentExists =
      row.parent_id !== null &&
      db.prepare("SELECT 1 FROM groups WHERE id = ?").get(row.parent_id);
    const parentId = parentExists ? row.parent_id : null;
    const idTaken = db.prepare("SELECT 1 FROM groups WHERE id = ?").get(id);
    db.prepare(
      `INSERT INTO groups (id, name, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(idTaken ? null : id, row.name, parentId, row.created_at, row.updated_at);
    db.prepare("DELETE FROM trashed_groups WHERE id = ?").run(id);
    return { restoredToTopLevel: row.parent_id !== null && parentId === null };
  })();
}

/** Permanently deletes a trashed note. */
export function purgeNote(id: number): void {
  getDb().prepare("DELETE FROM trashed_notes WHERE id = ?").run(id);
}

/** Permanently deletes a trashed group. */
export function purgeGroup(id: number): void {
  getDb().prepare("DELETE FROM trashed_groups WHERE id = ?").run(id);
}

/** Permanently deletes everything that has been in the trash longer than the retention window. */
export function purgeExpired(now: Date = new Date()): void {
  const db = getDb();
  const cutoff = retentionCutoff(now);
  db.transaction(() => {
    db.prepare("DELETE FROM trashed_notes WHERE deleted_at < ?").run(cutoff);
    db.prepare("DELETE FROM trashed_groups WHERE deleted_at < ?").run(cutoff);
  })();
}
