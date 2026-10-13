import { getDb } from "./db";
import { wouldCreateCycle } from "./groupMove";
import { placeBefore } from "./ordering";

export type Group = {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
};

type GroupRow = {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
};

export class GroupNotEmptyError extends Error {}

export class InvalidGroupMoveError extends Error {}

function fromRow(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
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

export function createGroup(name: string, parentId: number | null = null): Group {
  const now = nowIso();
  const result = getDb()
    .prepare(
      "INSERT INTO groups (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run(name, parentId, now, now);
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
  getDb()
    .prepare("UPDATE groups SET parent_id = ?, position = NULL, updated_at = ? WHERE id = ?")
    .run(parentId, nowIso(), id);
}

/**
 * Puts a group under `parentId` immediately before its sibling `beforeId` (last when
 * null) and fixes the whole sibling list's order. Same refusals as `moveGroup`; a
 * group may also be placed within the parent it already has, which just reorders it.
 */
export function placeGroup(id: number, parentId: number | null, beforeId: number | null): void {
  assertCanMove(id, parentId);
  const db = getDb();
  db.transaction(() => {
    const siblings = (
      db
        .prepare(`SELECT id FROM groups WHERE parent_id IS ? ORDER BY ${DISPLAY_ORDER}`)
        .all(parentId) as { id: number }[]
    ).map((row) => row.id);
    const ordered = placeBefore(siblings, id, beforeId);
    db.prepare("UPDATE groups SET parent_id = ?, updated_at = ? WHERE id = ?").run(
      parentId,
      nowIso(),
      id,
    );
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
