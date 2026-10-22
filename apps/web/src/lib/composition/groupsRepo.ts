import type Database from "better-sqlite3";
import { getDb } from "./db";
import { wouldCreateCycle } from "./groupMove";
import { defaultNotebookId, getNotebook } from "./notebooksRepo";
import { placeBefore } from "./ordering";

export type Group = {
  id: number;
  name: string;
  parentId: number | null;
  notebookId: number;
  createdAt: string;
  updatedAt: string;
};

type GroupRow = {
  id: number;
  name: string;
  parent_id: number | null;
  notebook_id: number;
  created_at: string;
  updated_at: string;
};

export class GroupNotEmptyError extends Error {}

export class InvalidGroupMoveError extends Error {}

export class InvalidNotebookMoveError extends Error {}

function fromRow(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    notebookId: row.notebook_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Display order: hand-placed groups first, in their set order; the rest (new ones too) by name. */
const DISPLAY_ORDER = "position IS NULL, position, name, id";

export function listGroups(): Group[] {
  const rows = getDb()
    .prepare(`SELECT * FROM groups ORDER BY ${DISPLAY_ORDER}`)
    .all() as GroupRow[];
  return rows.map(fromRow);
}

export function getGroup(id: number): Group | null {
  const row = getDb().prepare("SELECT * FROM groups WHERE id = ?").get(id) as
    | GroupRow
    | undefined;
  return row ? fromRow(row) : null;
}

/**
 * A sub-group is always in its parent's notebook; a top-level group goes in
 * `notebookId` (the default notebook when none is given).
 */
export function createGroup(
  name: string,
  parentId: number | null = null,
  notebookId: number | null = null,
): Group {
  const now = nowIso();
  const parent = parentId === null ? null : getGroup(parentId);
  const inNotebook = parent?.notebookId ?? notebookId ?? defaultNotebookId();
  const result = getDb()
    .prepare(
      `INSERT INTO groups (name, parent_id, notebook_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(name, parentId, inNotebook, now, now);
  const group = getGroup(Number(result.lastInsertRowid));
  if (!group) throw new Error("Failed to read back the group that was just created");
  return group;
}

export function renameGroup(id: number, name: string): void {
  getDb()
    .prepare("UPDATE groups SET name = ?, updated_at = ? WHERE id = ?")
    .run(name, nowIso(), id);
}

/** Throws unless `parentId` (`null` = top level) is a legal new parent for group `id`. */
function assertCanMove(id: number, parentId: number | null): void {
  if (!getGroup(id)) throw new InvalidGroupMoveError(`Group ${id} not found.`);
  if (parentId !== null && !getGroup(parentId)) {
    throw new InvalidGroupMoveError(`Group ${parentId} not found.`);
  }
  if (wouldCreateCycle(listGroups(), id, parentId)) {
    throw new InvalidGroupMoveError(
      `Group ${id} cannot be moved into itself or one of its sub-groups.`,
    );
  }
}

/**
 * Reparents a group (`null` = top level); refuses to create a loop in the hierarchy.
 * It lands after any hand-placed siblings, since its old position meant nothing there.
 */
export function moveGroup(id: number, parentId: number | null): void {
  assertCanMove(id, parentId);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE groups SET parent_id = ?, position = NULL, updated_at = ? WHERE id = ?").run(
      parentId,
      nowIso(),
      id,
    );
    adoptParentNotebook(db, id, parentId);
  })();
}

/** A group moved under another one joins that group's notebook, taking everything in it along. */
function adoptParentNotebook(db: Database.Database, id: number, parentId: number | null): void {
  const parent = parentId === null ? null : getGroup(parentId);
  if (parent) setSubtreeNotebook(db, id, parent.notebookId);
}

/** Puts group `id`, all its sub-groups and every note in any of them into `notebookId`. */
function setSubtreeNotebook(db: Database.Database, id: number, notebookId: number): void {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    const children = db.prepare("SELECT id FROM groups WHERE parent_id = ?").all(ids[i]) as {
      id: number;
    }[];
    for (const child of children) if (!ids.includes(child.id)) ids.push(child.id);
  }
  const marks = ids.map(() => "?").join(", ");
  db.prepare(`UPDATE groups SET notebook_id = ? WHERE id IN (${marks})`).run(notebookId, ...ids);
  db.prepare(`UPDATE notes SET notebook_id = ? WHERE group_id IN (${marks})`).run(notebookId, ...ids);
}

/**
 * Moves a group, with its sub-groups and notes, into another notebook, where it
 * becomes a top-level group (last among them). Works the same for a sub-group,
 * which leaves its parent behind.
 */
export function moveGroupToNotebook(id: number, notebookId: number): void {
  if (!getGroup(id)) throw new InvalidNotebookMoveError(`Group ${id} not found.`);
  if (!getNotebook(notebookId)) throw new InvalidNotebookMoveError(`Notebook ${notebookId} not found.`);
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      "UPDATE groups SET parent_id = NULL, position = NULL, updated_at = ? WHERE id = ?",
    ).run(nowIso(), id);
    setSubtreeNotebook(db, id, notebookId);
  })();
}

/**
 * Puts a group under `parentId` immediately before its sibling `beforeId` (last when
 * null) and fixes the whole sibling list's order. Same refusals as `moveGroup`; a
 * group may also be placed within the parent it already has, which just reorders it.
 */
export function placeGroup(id: number, parentId: number | null, beforeId: number | null): void {
  assertCanMove(id, parentId);
  const db = getDb();
  // The notebook it ends up in: its new parent's, or the one it is already top-level in.
  const notebookId = (parentId === null ? getGroup(id) : getGroup(parentId))!.notebookId;
  db.transaction(() => {
    const siblings = (
      db
        .prepare(
          `SELECT id FROM groups WHERE parent_id IS ? AND notebook_id = ? ORDER BY ${DISPLAY_ORDER}`,
        )
        .all(parentId, notebookId) as { id: number }[]
    ).map((row) => row.id);
    const ordered = placeBefore(siblings, id, beforeId);
    db.prepare("UPDATE groups SET parent_id = ?, updated_at = ? WHERE id = ?").run(
      parentId,
      nowIso(),
      id,
    );
    adoptParentNotebook(db, id, parentId);
    const setPosition = db.prepare("UPDATE groups SET position = ? WHERE id = ?");
    ordered.forEach((groupId, index) => setPosition.run(index, groupId));
  })();
}

/** Whether a group has no sub-groups and no notes directly in it. */
export function groupIsEmpty(id: number): boolean {
  const db = getDb();
  const { count: childGroupCount } = db
    .prepare("SELECT COUNT(*) AS count FROM groups WHERE parent_id = ?")
    .get(id) as { count: number };
  const { count: noteCount } = db
    .prepare("SELECT COUNT(*) AS count FROM notes WHERE group_id = ?")
    .get(id) as { count: number };
  return childGroupCount === 0 && noteCount === 0;
}
