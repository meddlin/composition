//! The schema, as `apps/web/src/lib/composition/db.ts` defines it. The statement text is kept byte-for-byte identical to
//! the desktop's on purpose: `sqlite_master.sql` keeps the text as written, and a database that the desktop and this
//! core have each touched must be indistinguishable. When `db.ts` changes, this file changes with it, and the conformance
//! run (tests/schema.rs against `desktop-empty.db`) fails until it does.

pub const NOTES: &str = "
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
";

pub const GROUPS: &str = "
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
";

pub const NOTEBOOKS: &str = "
CREATE TABLE IF NOT EXISTS notebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
";

pub const TRASH: &str = "
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
";

pub const ATTACHMENTS: &str = "
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments (note_id);
";

pub const TODOS: &str = "
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
";

pub const TODO_CYCLE: &str = "
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
";

/// The columns the weekly cycle adds to `todos`, as additive migrations like the notes' later columns.
pub const TODO_CYCLE_COLUMNS: &[(&str, &str)] = &[
    ("done_at", "ALTER TABLE todos ADD COLUMN done_at TEXT"),
    ("done_on", "ALTER TABLE todos ADD COLUMN done_on TEXT"),
    ("archived_at", "ALTER TABLE todos ADD COLUMN archived_at TEXT"),
    ("archive_week", "ALTER TABLE todos ADD COLUMN archive_week TEXT"),
    ("archive_reason", "ALTER TABLE todos ADD COLUMN archive_reason TEXT"),
    ("rolled_from_week", "ALTER TABLE todos ADD COLUMN rolled_from_week TEXT"),
    ("roll_count", "ALTER TABLE todos ADD COLUMN roll_count INTEGER NOT NULL DEFAULT 0"),
    ("position", "ALTER TABLE todos ADD COLUMN position INTEGER"),
    ("priority", "ALTER TABLE todos ADD COLUMN priority INTEGER"),
];

pub const READING_LIST: &str = "
CREATE TABLE IF NOT EXISTS reading_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
";

pub const CONTACTS: &str = "
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'personal',
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    birth_date TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    manager TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
";

pub const FEEDS: &str = "
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
";

/// Every row of these tables carries a `uuid` (docs/architecture/data-model.md, "Identity").
pub const UUID_TABLES: &[&str] = &["notes", "groups", "notebooks", "trashed_notes", "trashed_groups", "attachments"];

/// Built-in SQL only: an older build opening the file has no user-defined functions, and its inserts must still work.
pub const NEW_UUID: &str = "lower(hex(randomblob(16)))";

/// Rows filled per write transaction, so the backfill never holds the writer (a running CLI, say) for long.
pub const UUID_BACKFILL_BATCH: usize = 200;

/// The `uuid` fill trigger and unique index for one table. The odd indentation is the desktop's template literal; it ends
/// up in `sqlite_master`, so it is reproduced exactly.
pub fn uuid_trigger_and_index(table: &str) -> String {
    format!(
        "CREATE TRIGGER IF NOT EXISTS trg_{table}_fill_uuid AFTER INSERT ON {table} WHEN NEW.uuid IS NULL\n\
         \x20       BEGIN\n\
         \x20         UPDATE {table} SET uuid = {NEW_UUID} WHERE rowid = NEW.rowid;\n\
         \x20       END;\n\
         \x20       CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_uuid ON {table} (uuid);\n"
    )
}
