import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadWebSettings, resolvedDbPath } from "./webSettings";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

const GROUPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

/**
 * Notebooks hold groups, sub-groups and notes; nothing in one is shown next to
 * another's. Every group and note carries its notebook's id (a note in a group
 * always shares the group's), so listing a notebook is a plain filter.
 */
const NOTEBOOKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS notebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

/**
 * The Trash Can. Deleted items move into their own tables, keeping their
 * original ids, rather than being flagged in `notes`/`groups`: the CLI shares
 * this database file and lists every row of those two tables, so a flag would
 * leave "deleted" notes showing there.
 */
const TRASH_SCHEMA = `
CREATE TABLE IF NOT EXISTS trashed_notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    group_id INTEGER,
    deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trashed_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL
);
`;

const ATTACHMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments (note_id);
`;

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(ddl);
  }
}

/**
 * Makes sure there is a notebook, and that every note and group is in one. A database
 * from before notebooks gets a single "Notebook" holding everything it had; rows
 * written by an older CLI (which knows nothing of notebooks) join the first notebook.
 */
export function adoptOrphans(db: Database.Database): void {
  db.transaction(() => {
    let first = db.prepare("SELECT MIN(id) AS id FROM notebooks").get() as { id: number | null };
    if (first.id === null) {
      const now = new Date().toISOString();
      const result = db
        .prepare("INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Notebook', ?, ?)")
        .run(now, now);
      first = { id: Number(result.lastInsertRowid) };
    }
    for (const table of ["notes", "groups", "trashed_notes", "trashed_groups"]) {
      db.prepare(`UPDATE ${table} SET notebook_id = ? WHERE notebook_id IS NULL`).run(first.id);
    }
  })();
}

function openConnection(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // Stored in the file header itself, so this also benefits the CLI's plain
  // sqlite3 connections opening the same file — improves cross-process
  // concurrency between `next dev` and a running CLI TUI.
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  db.exec(GROUPS_SCHEMA);
  db.exec(NOTEBOOKS_SCHEMA);
  db.exec(TRASH_SCHEMA);
  db.exec(ATTACHMENTS_SCHEMA);
  ensureColumn(db, "notes", "tags", "ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    db,
    "notes",
    "description",
    "ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(db, "notes", "group_id", "ALTER TABLE notes ADD COLUMN group_id INTEGER");
  // Hand-set order among siblings; NULL until the item is dragged into place (see ordering.ts).
  ensureColumn(db, "notes", "position", "ALTER TABLE notes ADD COLUMN position INTEGER");
  ensureColumn(db, "groups", "position", "ALTER TABLE groups ADD COLUMN position INTEGER");
  for (const table of ["notes", "groups", "trashed_notes", "trashed_groups"]) {
    ensureColumn(db, table, "notebook_id", `ALTER TABLE ${table} ADD COLUMN notebook_id INTEGER`);
  }
  adoptOrphans(db);
  return db;
}

declare global {
  var __compositionDb: { connection: Database.Database; dbPath: string } | undefined;
}

/**
 * Lazily opens (or reuses) the connection for the currently-configured db
 * path. Comparing the cached path against the current setting on every call
 * handles both Next.js dev-HMR dedup and reopening after a Settings change —
 * no separate invalidation mechanism needed.
 */
export function getDb(): Database.Database {
  const dbPath = resolvedDbPath(loadWebSettings());
  if (globalThis.__compositionDb && globalThis.__compositionDb.dbPath === dbPath) {
    return globalThis.__compositionDb.connection;
  }
  if (globalThis.__compositionDb) {
    globalThis.__compositionDb.connection.close();
  }
  const connection = openConnection(dbPath);
  globalThis.__compositionDb = { connection, dbPath };
  return connection;
}

export function closeDb(): void {
  if (globalThis.__compositionDb) {
    globalThis.__compositionDb.connection.close();
    globalThis.__compositionDb = undefined;
  }
}
