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

/**
 * The to-do panel's items. `parent_id` makes a tree; deleting an item deletes its sub-items too (todosRepo.ts does
 * that, so no foreign key is declared). The CLI shares this file and ignores the table.
 */
const TODOS_SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'todo',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_parent_id ON todos (parent_id);
`;

/**
 * The to-do weekly cycle (docs/todo-archival-plan.md). `todo_events` is the activity log: one row per change to an item,
 * never shown, with the local date it happened on (`on_date`) and the zone's offset in minutes, so changing the machine's
 * time zone cannot move an event into another week. `todo_closed` records the weeks, months and quarters the sweep has
 * already dealt with, which is what makes it safe to run twice. `todo_reports` links each period to the notes that
 * report it; there can be several per period, because regenerating makes a new note. No foreign keys: deleting an item
 * erases its log rows (todosRepo.ts), and a report's note belongs to the notes, which the owner can delete.
 */
const TODO_CYCLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS todo_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    at TEXT NOT NULL,
    on_date TEXT NOT NULL,
    utc_offset INTEGER NOT NULL DEFAULT 0,
    from_status TEXT,
    to_status TEXT,
    week_start TEXT,
    roll_count INTEGER,
    reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_todo_events_todo_id ON todo_events (todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_events_on_date ON todo_events (on_date);
CREATE TABLE IF NOT EXISTS todo_closed (
    kind TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    closed_at TEXT NOT NULL,
    PRIMARY KEY (kind, period_start)
);
CREATE TABLE IF NOT EXISTS todo_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    note_id INTEGER NOT NULL,
    generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_reports_period ON todo_reports (kind, period_start);
-- Where the reports go: the id of the To-do reports notebook and of its Weekly, Monthly and Quarterly groups, so a rename is
-- followed and a deletion is noticed (and made again).
CREATE TABLE IF NOT EXISTS todo_places (
    place TEXT PRIMARY KEY,
    ref_id INTEGER NOT NULL
);
`;

/** The columns the weekly cycle adds to `todos`, as additive migrations like the notes' later columns. */
const TODO_CYCLE_COLUMNS: readonly [column: string, ddl: string][] = [
  // When it was ticked: the instant, and the local date (a week is made of local dates).
  ["done_at", "ALTER TABLE todos ADD COLUMN done_at TEXT"],
  ["done_on", "ALTER TABLE todos ADD COLUMN done_on TEXT"],
  // Set when it left the live list; the week it happened in; and why (done, removed or dropped).
  ["archived_at", "ALTER TABLE todos ADD COLUMN archived_at TEXT"],
  ["archive_week", "ALTER TABLE todos ADD COLUMN archive_week TEXT"],
  ["archive_reason", "ALTER TABLE todos ADD COLUMN archive_reason TEXT"],
  // The week an unfinished item first rolled over from while it waits in Rolled over, and how many week closes it has been through.
  ["rolled_from_week", "ALTER TABLE todos ADD COLUMN rolled_from_week TEXT"],
  ["roll_count", "ALTER TABLE todos ADD COLUMN roll_count INTEGER NOT NULL DEFAULT 0"],
];

/**
 * The Reading List plugin's links. `url` is unique because the list refuses a link it already has; `title` is empty until
 * the page has been opened and named itself. The CLI shares this file and ignores the table.
 */
const READING_LIST_SCHEMA = `
CREATE TABLE IF NOT EXISTS reading_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

/**
 * The RSS Reader's feeds and their entries. Deleting a feed deletes its entries too (feedsRepo.ts does that in one
 * transaction, so no foreign key is declared). The CLI shares this file and ignores the tables.
 */
const FEEDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    site_url TEXT NOT NULL DEFAULT '',
    etag TEXT NOT NULL DEFAULT '',
    last_modified TEXT NOT NULL DEFAULT '',
    last_fetched_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    guid TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    UNIQUE (feed_id, guid)
);
CREATE INDEX IF NOT EXISTS idx_feed_items_feed_published ON feed_items (feed_id, published_at);
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
  db.exec(TODOS_SCHEMA);
  db.exec(READING_LIST_SCHEMA);
  db.exec(FEEDS_SCHEMA);
  // A database from before statuses: the items already ticked off are "done", the rest keep the default "todo".
  const todoColumns = db.prepare("PRAGMA table_info(todos)").all() as { name: string }[];
  if (!todoColumns.some((c) => c.name === "status")) {
    db.exec("ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'");
    db.exec("UPDATE todos SET status = 'done' WHERE done = 1");
  }
  db.exec(TODO_CYCLE_SCHEMA);
  for (const [column, ddl] of TODO_CYCLE_COLUMNS) ensureColumn(db, "todos", column, ddl);
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
  ensureColumn(db, "notebooks", "position", "ALTER TABLE notebooks ADD COLUMN position INTEGER");
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
