import { adoptOrphans, getDb } from "./db";

export type Notebook = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type NotebookRow = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

export class NotebookNotEmptyError extends Error {}

export class LastNotebookError extends Error {}

function fromRow(row: NotebookRow): Notebook {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** In the order they were made, so the first one is the stable default. */
export function listNotebooks(): Notebook[] {
  // Rows an older CLI wrote since the database was opened join the first notebook.
  adoptOrphans(getDb());
  const rows = getDb().prepare("SELECT * FROM notebooks ORDER BY id").all() as NotebookRow[];
  return rows.map(fromRow);
}

export function getNotebook(id: number): Notebook | null {
  const row = getDb().prepare("SELECT * FROM notebooks WHERE id = ?").get(id) as
    | NotebookRow
    | undefined;
  return row ? fromRow(row) : null;
}

/** The notebook that takes anything whose own is gone (a restored item, a note made with none chosen). */
export function defaultNotebookId(): number {
  const row = getDb().prepare("SELECT MIN(id) AS id FROM notebooks").get() as { id: number | null };
  if (row.id === null) throw new Error("There are no notebooks.");
  return row.id;
}

export function createNotebook(name: string): Notebook {
  const now = nowIso();
  const result = getDb()
    .prepare("INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, ?, ?)")
    .run(name, now, now);
  const notebook = getNotebook(Number(result.lastInsertRowid));
  if (!notebook) throw new Error("Failed to read back the notebook that was just created");
  return notebook;
}

export function renameNotebook(id: number, name: string): void {
  getDb()
    .prepare("UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?")
    .run(name, nowIso(), id);
}

/**
 * Deletes an empty notebook for good. Like a group, one with anything in it is
 * refused (the Trash Can holds notes and groups, not notebooks), and the last
 * notebook stays: everything has to live somewhere.
 */
export function deleteNotebook(id: number): void {
  const db = getDb();
  db.transaction(() => {
    const { count: notebooks } = db.prepare("SELECT COUNT(*) AS count FROM notebooks").get() as {
      count: number;
    };
    if (notebooks <= 1) throw new LastNotebookError("The last notebook can't be deleted.");
    const { count: groups } = db
      .prepare("SELECT COUNT(*) AS count FROM groups WHERE notebook_id = ?")
      .get(id) as { count: number };
    const { count: notes } = db
      .prepare("SELECT COUNT(*) AS count FROM notes WHERE notebook_id = ?")
      .get(id) as { count: number };
    if (groups + notes > 0) {
      throw new NotebookNotEmptyError(`Notebook ${id} still has groups or notes.`);
    }
    // Trashed items that were in it come back to the default notebook if restored.
    db.prepare("DELETE FROM notebooks WHERE id = ?").run(id);
  })();
}
