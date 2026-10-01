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

function ensureColumn(db: Database.Database, column: string, ddl: string): void {
  const columns = db.prepare("PRAGMA table_info(notes)").all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(ddl);
  }
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
  db.exec(TRASH_SCHEMA);
  db.exec(ATTACHMENTS_SCHEMA);
  ensureColumn(db, "tags", "ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    db,
    "description",
    "ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(db, "group_id", "ALTER TABLE notes ADD COLUMN group_id INTEGER");
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
