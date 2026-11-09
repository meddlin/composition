mod common;

use composition_core_spike::pass;
use composition_core_spike::schema::UUID_TABLES;
use rusqlite::Connection;

#[test]
fn the_linked_sqlite_has_fts5() {
    // Not an assumption: ask the library this binary actually linked.
    let conn = Connection::open_in_memory().unwrap();
    let facts = pass::sqlite_facts(&conn).unwrap();
    for line in &facts {
        eprintln!("{line}");
    }
    assert!(facts.contains(&"ENABLE_FTS5: true".to_string()), "{facts:?}");
    assert!(facts.iter().any(|f| f.starts_with("fts5 unicode61 remove_diacritics 2 + prefix: ok")), "{facts:?}");
    assert!(facts.iter().any(|f| f.starts_with("fts5vocab(row): ok")), "{facts:?}");
}

#[test]
fn a_database_made_from_nothing_matches_the_desktops_schema_exactly() {
    let corpus = need_corpus!();
    let dir = tempfile::tempdir().unwrap();
    let ours = pass::open(&dir.path().join("composition.db")).unwrap();
    let desktop = common::read_only(&corpus.join("desktop-empty.db"));
    let (a, b) = (common::schema_of(&ours), common::schema_of(&desktop));
    assert_eq!(a.len(), b.len(), "same number of objects");
    for (x, y) in a.iter().zip(b.iter()) {
        assert_eq!(x, y, "{} {}", x.0, x.1);
    }
    // Same rows too: the one default notebook, with the same shape.
    let notebooks = |c: &Connection| c.query_row("SELECT COUNT(*), MIN(name) FROM notebooks", [], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).unwrap();
    assert_eq!(notebooks(&ours), notebooks(&desktop));
    let mode: String = ours.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "wal");
}

#[test]
fn a_database_the_desktop_populated_is_a_no_op_for_the_pass() {
    let corpus = need_corpus!();
    let dir = tempfile::tempdir().unwrap();
    let path = common::copy_to(dir.path(), &corpus.join("desktop-populated.db"), "composition.db");
    let (schema_before, dump_before) = {
        let c = common::read_only(&path);
        (common::schema_of(&c), common::dump_of(&c))
    };
    // An observer connection: its data_version moves only when another connection commits a change.
    let observer = Connection::open(&path).unwrap();
    let before = common::data_version(&observer);
    let ours = pass::open(&path).unwrap();
    assert_eq!(common::schema_of(&ours), schema_before, "schema unchanged");
    assert_eq!(common::dump_of(&ours), dump_before, "every row unchanged");
    assert_eq!(common::data_version(&observer), before, "the pass committed nothing to a database the desktop made");
    drop(ours);
    // And a second open writes nothing either.
    let _again = pass::open(&path).unwrap();
    assert_eq!(common::data_version(&observer), before, "the second open committed nothing");
}

/// The oldest shape of the database: no uuid, no notebook, no position, no tags. A hand-made old file, not a fixture.
const OLD_SCHEMA: &str = "
CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE trashed_notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, group_id INTEGER, deleted_at TEXT NOT NULL);
CREATE TABLE attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, file_name TEXT NOT NULL, stored_name TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
";

#[test]
fn an_old_database_is_brought_up_without_losing_a_row_and_every_row_gets_a_uuid() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("composition.db");
    {
        let old = Connection::open(&path).unwrap();
        old.execute_batch(OLD_SCHEMA).unwrap();
        let tx = old.unchecked_transaction().unwrap();
        for i in 0..450 {
            // More than two batches of 200, so the backfill really does run in several transactions.
            tx.execute("INSERT INTO notes (title, content, created_at, updated_at) VALUES (?1, 'x', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')", [format!("n{i}")]).unwrap();
        }
        tx.execute("INSERT INTO groups (name, created_at, updated_at) VALUES ('g', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')", []).unwrap();
        tx.execute("INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at) VALUES (900, 't', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')", []).unwrap();
        tx.execute("INSERT INTO attachments (note_id, file_name, stored_name, size, created_at) VALUES (1, 'a.pdf', 'aaaa-a.pdf', 3, '2024-01-01T00:00:00Z')", []).unwrap();
        tx.execute("INSERT INTO todos (title, done, created_at, updated_at) VALUES ('open', 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'), ('ticked', 1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')", []).unwrap();
        tx.commit().unwrap();
    }
    let mut conn = pass::open(&path).unwrap();

    let reader = Connection::open(&path).unwrap();
    let count = |sql: &str| reader.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
    assert_eq!(count("SELECT COUNT(*) FROM notes"), 450);
    for table in UUID_TABLES {
        assert_eq!(count(&format!("SELECT COUNT(*) FROM {table} WHERE uuid IS NULL OR length(uuid) != 32")), 0, "{table}: every row has a 32-character uuid");
        assert_eq!(count(&format!("SELECT COUNT(*) - COUNT(DISTINCT uuid) FROM {table}")), 0, "{table}: unique");
    }
    assert_eq!(count("SELECT COUNT(*) FROM notebooks"), 1, "one default notebook");
    assert_eq!(count("SELECT COUNT(*) FROM notes WHERE notebook_id IS NOT 1"), 0, "every note adopted");
    assert_eq!(count("SELECT COUNT(*) FROM trashed_notes WHERE notebook_id IS NOT 1"), 0);
    assert_eq!(count("SELECT COUNT(*) FROM todos WHERE status = 'done'"), 1, "the ticked item became done");
    assert_eq!(count("SELECT COUNT(*) FROM todos WHERE status = 'todo'"), 1);

    // Idempotent: nothing is written the second time.
    let observer = Connection::open(&path).unwrap();
    let before = common::data_version(&observer);
    pass::run(&mut conn).unwrap();
    assert_eq!(common::data_version(&observer), before, "a second pass committed nothing");

    // The trigger: a row written by a build that does not know the column still gets a uuid ...
    conn.execute("INSERT INTO notes (title, content, created_at, updated_at) VALUES ('later', 'y', '2024-01-02T00:00:00Z', '2024-01-02T00:00:00Z')", []).unwrap();
    assert_eq!(count("SELECT COUNT(*) FROM notes WHERE title = 'later' AND length(uuid) = 32"), 1);
    // ... and, knowing nothing of notebooks, lands in none until the next open adopts it into the first.
    assert_eq!(count("SELECT COUNT(*) FROM notes WHERE title = 'later' AND notebook_id IS NULL"), 1);
    pass::run(&mut conn).unwrap();
    assert_eq!(count("SELECT COUNT(*) FROM notes WHERE title = 'later' AND notebook_id = 1"), 1);
}

/// Not a check: leaves `rust-empty.db` and `rust-populated.db` in the corpus directory for the desktop's own `db.ts` to open
/// (`tools/rust-fixtures.test.ts`). The populated one is the desktop's file after the Rust pass, closed cleanly.
#[test]
fn leaves_databases_for_the_desktop_to_open() {
    let corpus = need_corpus!();
    let work = tempfile::tempdir().unwrap();
    for (name, from) in [("rust-empty.db", None), ("rust-populated.db", Some("desktop-populated.db"))] {
        let path = match from {
            Some(f) => common::copy_to(work.path(), &corpus.join(f), name),
            None => work.path().join(name),
        };
        drop(pass::open(&path).unwrap()); // the last connection closing checkpoints the WAL and removes it
        assert!(!work.path().join(format!("{name}-wal")).exists(), "no WAL left behind");
        std::fs::copy(&path, corpus.join(name)).unwrap();
    }
}
