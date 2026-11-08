//! The pass that brings a database up to date on every open, in the order `openConnection` in
//! `apps/web/src/lib/composition/db.ts` runs it. Additive and idempotent: a database either app has touched is a no-op
//! for the other, which is why this is not a numbered migration system (its bookkeeping table is one the desktop would
//! not know). A second run on an up-to-date file writes nothing.

use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, TransactionBehavior};

use crate::schema as s;
use crate::timestamp::now_iso;

/// `better-sqlite3` waits up to five seconds for a lock by default; so does this.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut conn = Connection::open(path)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    // Stored in the file header itself, so it also serves the CLI's and the desktop's connections.
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    run(&mut conn)?;
    Ok(conn)
}

pub fn run(conn: &mut Connection) -> rusqlite::Result<()> {
    for sql in [s::NOTES, s::GROUPS, s::NOTEBOOKS, s::TRASH, s::ATTACHMENTS, s::TODOS, s::READING_LIST, s::FEEDS, s::CONTACTS] {
        conn.execute_batch(sql)?;
    }
    // A database from before statuses: the items already ticked off are "done", the rest keep the default "todo".
    if !has_column(conn, "todos", "status")? {
        conn.execute_batch("ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'")?;
        conn.execute_batch("UPDATE todos SET status = 'done' WHERE done = 1")?;
    }
    conn.execute_batch(s::TODO_CYCLE)?;
    for (column, ddl) in s::TODO_CYCLE_COLUMNS {
        ensure_column(conn, "todos", column, ddl)?;
    }
    ensure_column(conn, "notes", "tags", "ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "notes", "description", "ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "notes", "group_id", "ALTER TABLE notes ADD COLUMN group_id INTEGER")?;
    // Hand-set order among siblings; NULL until the item is dragged into place.
    ensure_column(conn, "notes", "position", "ALTER TABLE notes ADD COLUMN position INTEGER")?;
    ensure_column(conn, "groups", "position", "ALTER TABLE groups ADD COLUMN position INTEGER")?;
    ensure_column(conn, "notebooks", "position", "ALTER TABLE notebooks ADD COLUMN position INTEGER")?;
    for table in ["notes", "groups", "trashed_notes", "trashed_groups"] {
        ensure_column(conn, table, "notebook_id", &format!("ALTER TABLE {table} ADD COLUMN notebook_id INTEGER"))?;
    }
    ensure_uuids(conn)?;
    adopt_orphans(conn)
}

fn has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> rusqlite::Result<()> {
    if !has_column(conn, table, column)? {
        conn.execute_batch(ddl)?;
    }
    Ok(())
}

/// Adds `uuid` to every table that carries one and fills it for the rows that have none. The column, the `AFTER INSERT`
/// trigger and the unique index go in together, in one immediate transaction: from then on a row written by an older
/// build, which does not know the column, gets a uuid from the trigger. The index goes in before the backfill so that
/// finding the rows still to fill (and knowing, on every later open, that there are none) is a lookup, not a scan.
fn ensure_uuids(conn: &mut Connection) -> rusqlite::Result<()> {
    {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        for table in s::UUID_TABLES {
            ensure_column(&tx, table, "uuid", &format!("ALTER TABLE {table} ADD COLUMN uuid TEXT"))?;
            tx.execute_batch(&s::uuid_trigger_and_index(table))?;
        }
        tx.commit()?;
    }
    for table in s::UUID_TABLES {
        // One write transaction per batch (autocommit), so the backfill never holds the writer for long.
        let fill = format!(
            "UPDATE {table} SET uuid = {} WHERE rowid IN (SELECT rowid FROM {table} WHERE uuid IS NULL LIMIT {})",
            s::NEW_UUID,
            s::UUID_BACKFILL_BATCH
        );
        while conn.execute(&fill, [])? > 0 {}
    }
    Ok(())
}

/// Makes sure there is a notebook, and that every note and group is in one. A database from before notebooks gets a
/// single "Notebook" holding everything it had; rows written by an older CLI join the first notebook. Immediate,
/// because it reads and then writes.
pub fn adopt_orphans(conn: &mut Connection) -> rusqlite::Result<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut first: Option<i64> = tx.query_row("SELECT MIN(id) FROM notebooks", [], |r| r.get(0))?;
    if first.is_none() {
        let now = now_iso();
        tx.execute("INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Notebook', ?1, ?2)", (&now, &now))?;
        first = Some(tx.last_insert_rowid());
    }
    for table in ["notes", "groups", "trashed_notes", "trashed_groups"] {
        tx.execute(&format!("UPDATE {table} SET notebook_id = ?1 WHERE notebook_id IS NULL"), [first])?;
    }
    tx.commit()
}

/// What `PRAGMA compile_options` and a few probes say about the SQLite this build links, for the S1 note.
pub fn sqlite_facts(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut facts = vec![format!("sqlite_version = {}", conn.query_row("select sqlite_version()", [], |r| r.get::<_, String>(0))?)];
    let mut stmt = conn.prepare("PRAGMA compile_options")?;
    let options: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for key in ["ENABLE_FTS5", "ENABLE_FTS4", "ENABLE_FTS3", "THREADSAFE", "ENABLE_JSON1", "OMIT_LOAD_EXTENSION", "ENABLE_MATH_FUNCTIONS"] {
        facts.push(format!("{key}: {}", options.iter().any(|o| o.starts_with(key))));
    }
    let probe = |label: &str, sql: &str, facts: &mut Vec<String>| {
        let r = conn.execute_batch(sql);
        facts.push(format!("{label}: {}", r.map(|_| "ok".to_string()).unwrap_or_else(|e| format!("FAILED ({e})"))));
    };
    probe("fts5 unicode61 remove_diacritics 2 + prefix", "CREATE VIRTUAL TABLE temp.p1 USING fts5(a, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4')", &mut facts);
    probe("fts5vocab(row)", "CREATE VIRTUAL TABLE temp.p2 USING fts5vocab(p1, 'row')", &mut facts);
    probe("fts5 trigram tokenizer", "CREATE VIRTUAL TABLE temp.p3 USING fts5(a, tokenize = 'trigram')", &mut facts);
    Ok(facts)
}
