import { getDb } from "./db";

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

export function listGroups(): Group[] {
  const rows = getDb().prepare("SELECT * FROM groups ORDER BY name").all() as GroupRow[];
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

/** Refuses to delete a group that still has sub-groups or notes in it. */
export function deleteGroup(id: number): void {
  if (!groupIsEmpty(id)) {
    throw new GroupNotEmptyError(
      `Group ${id} still has sub-groups or notes; empty it before deleting.`,
    );
  }
  getDb().prepare("DELETE FROM groups WHERE id = ?").run(id);
}
