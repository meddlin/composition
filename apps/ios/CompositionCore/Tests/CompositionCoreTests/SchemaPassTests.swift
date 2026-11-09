import Foundation
import GRDB
import Testing

@testable import CompositionCore

@Suite("Schema pass")
struct SchemaPassTests {
    @Test("a new database gets every table, a uuid column on the six tables, and one notebook")
    func freshDatabase() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            try database.close()

            let db = try rawConnection(scratch.databaseURL)
            try db.read { db in
                let tables = Set(try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = 'table'"))
                for table in [
                    "notes", "groups", "notebooks", "trashed_notes", "trashed_groups", "attachments", "todos",
                    "reading_list", "feeds", "feed_items", "contacts", "todo_events", "todo_closed", "todo_reports", "todo_places",
                ] {
                    #expect(tables.contains(table), "missing table \(table)")
                }
                for table in Schema.uuidTables {
                    let columns = try Row.fetchAll(db, sql: "PRAGMA table_info(\(table))").map { $0["name"] as String }
                    #expect(columns.contains("uuid"), "\(table) has no uuid")
                    let indexes = Set(try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = 'index'"))
                    #expect(indexes.contains("idx_\(table)_uuid"))
                    let triggers = Set(try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = 'trigger'"))
                    #expect(triggers.contains("trg_\(table)_fill_uuid"))
                }
                #expect(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM notebooks") == 1)
                #expect(try String.fetchOne(db, sql: "SELECT name FROM notebooks") == "Notebook")
                #expect(try String.fetchOne(db, sql: "PRAGMA journal_mode") == "wal")
            }
        }
    }

    @Test("a database from before groups, tags and notebooks is brought up to date without losing a note")
    func legacyDatabase() throws {
        try withScratch { scratch in
            // `notes` as the very first version created it, as db.test.ts's writeOldDatabase does.
            let legacy = try rawConnection(scratch.databaseURL)
            try legacy.write { db in
                try db.execute(sql: """
                    CREATE TABLE notes (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      title TEXT NOT NULL,
                      content TEXT NOT NULL DEFAULT '',
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    );
                    INSERT INTO notes (title, content, created_at, updated_at)
                      VALUES ('Legacy note', 'legacy content', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
                    """)
            }
            try legacy.close()

            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let notes = try database.listNotes()
            #expect(notes.count == 1)
            #expect(notes[0].title == "Legacy note")
            #expect(isUuid(notes[0].uuid), "the backfill gave the old note a uuid")
            #expect(notes[0].notebookId != nil, "the old note was adopted into the first notebook")
            try database.close()
        }
    }

    @Test("a row inserted without a uuid, as an older desktop build would, gets one from the trigger")
    func triggerFillsUuid() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            try database.close()

            let db = try rawConnection(scratch.databaseURL)
            let uuid = try db.write { db -> String? in
                try db.execute(
                    sql: "INSERT INTO notes (title, created_at, updated_at) VALUES ('Old build', 'x', 'x')")
                return try String.fetchOne(db, sql: "SELECT uuid FROM notes WHERE title = 'Old build'")
            }
            #expect(isUuid(uuid))
        }
    }

    @Test("running the pass again on an up-to-date database writes nothing")
    func secondRunIsNoOp() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            // Give it content, so a pass that rewrote rows would show.
            try database.pool.write { db in
                try db.execute(sql: """
                    INSERT INTO notes (title, content, created_at, updated_at, notebook_id)
                      VALUES ('One', 'a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1);
                    """)
            }
            let uuidBefore = try database.listNotes().map(\.uuid)

            // Measured on the open pool, so GRDB's own setup (below) is not counted: the write-ahead log's size and the
            // schema cookie move if anything is written, a DDL statement included, even one that changes no row.
            let walPath = scratch.databaseURL.path + "-wal"
            func walSize() throws -> Int {
                try FileManager.default.attributesOfItem(atPath: walPath)[.size] as? Int ?? -1
            }
            func schemaVersion() throws -> Int {
                try database.pool.read { try Int.fetchOne($0, sql: "PRAGMA schema_version") ?? -1 }
            }
            let walBefore = try walSize()
            let schemaBefore = try schemaVersion()
            let changesBefore = try database.pool.write { $0.totalChangesCount }

            try SchemaPass.run(database.pool)

            #expect(try walSize() == walBefore)
            #expect(try schemaVersion() == schemaBefore)
            #expect(try database.pool.write { $0.totalChangesCount } == changesBefore)
            #expect(try database.listNotes().map(\.uuid) == uuidBefore)
            try database.close()
        }
    }

    // GRDB's `DatabasePool` runs `CREATE TABLE grdb_issue_102; DROP TABLE grdb_issue_102` whenever the write-ahead log is
    // missing or empty, which it always is after a clean close (GRDB/Core/Database.swift, setUpWALMode). So opening a
    // quiescent database writes a few pages and moves its schema cookie, whatever our pass does. Harmless for a
    // single-process iPad app; recorded in the design doc (S1) because "a second open writes nothing" cannot be stated
    // about the pool, only about the pass.

    @Test("a uuid backfill covers more rows than one batch")
    func backfillAcrossBatches() throws {
        try withScratch { scratch in
            let legacy = try rawConnection(scratch.databaseURL)
            try legacy.write { db in
                try db.execute(sql: """
                    CREATE TABLE notes (
                      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
                      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    """)
                for index in 0..<(Schema.uuidBackfillBatch * 2 + 1) {
                    try db.execute(
                        sql: "INSERT INTO notes (title, created_at, updated_at) VALUES (?, 'x', 'x')",
                        arguments: ["Note \(index)"])
                }
            }
            try legacy.close()

            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let notes = try database.listNotes()
            #expect(notes.count == Schema.uuidBackfillBatch * 2 + 1)
            #expect(Set(notes.map(\.uuid)).count == notes.count, "every uuid is distinct")
            #expect(notes.allSatisfy { isUuid($0.uuid) })
            try database.close()
        }
    }
}
