#![allow(dead_code)]
//! Shared by the conformance tests. The inputs are the shared corpus (`apps/ios/conformance/*.json`, which today lives on the
//! iPad branch) and the files the desktop's own code generated from it. Both arrive in one directory, named by
//! `COMPOSITION_CONFORMANCE_DIR`, exactly as the Swift tests expect (see `run.sh`).

use std::path::{Path, PathBuf};

use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags};

pub fn conformance_dir() -> Option<PathBuf> {
    let dir = std::env::var_os("COMPOSITION_CONFORMANCE_DIR").map(PathBuf::from)?;
    dir.is_dir().then_some(dir)
}

/// Skips (with a message) when the corpus is not available, like the Swift suites do.
#[macro_export]
macro_rules! need_corpus {
    () => {
        match common::conformance_dir() {
            Some(d) => d,
            None => {
                eprintln!("COMPOSITION_CONFORMANCE_DIR is not set: skipped (see run.sh)");
                return;
            }
        }
    };
}

pub fn copy_to(dir: &Path, from: &Path, name: &str) -> PathBuf {
    let to = dir.join(name);
    std::fs::copy(from, &to).expect("copy fixture");
    to
}

/// `sqlite_master` as (type, name, table, sql), ordered, without SQLite's own tables.
pub fn schema_of(conn: &Connection) -> Vec<(String, String, String, Option<String>)> {
    let mut stmt = conn
        .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(|r| r.unwrap()).collect()
}

/// Every row of every table, as text, in rowid order: what "unchanged" means.
pub fn dump_of(conn: &Connection) -> Vec<(String, Vec<Vec<String>>)> {
    let tables: Vec<String> = {
        let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    };
    let mut out = vec![];
    for table in tables {
        let mut stmt = conn.prepare(&format!("SELECT * FROM {table} ORDER BY rowid")).unwrap();
        let n = stmt.column_count();
        let rows: Vec<Vec<String>> = stmt
            .query_map([], |r| {
                (0..n)
                    .map(|i| {
                        Ok(match r.get::<_, Value>(i)? {
                            Value::Null => "NULL".to_string(),
                            Value::Integer(v) => v.to_string(),
                            Value::Real(v) => v.to_string(),
                            Value::Text(v) => format!("{v:?}"),
                            Value::Blob(v) => format!("blob({})", v.len()),
                        })
                    })
                    .collect()
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        out.push((table, rows));
    }
    out
}

/// Opens a database file nothing else is using, for reading, without creating side files.
pub fn read_only(path: &Path) -> Connection {
    Connection::open_with_flags(format!("file:{}?immutable=1", path.display()), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI)
        .unwrap()
}

pub fn data_version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA data_version", [], |r| r.get(0)).unwrap()
}
