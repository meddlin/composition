import GRDB

/// The pass that brings a database up to date on every open, in the order `openConnection` in
/// `apps/web/src/lib/composition/db.ts` runs it. Additive and idempotent: a database either app has touched is a no-op
/// for the other, which is why this is not GRDB's `DatabaseMigrator` (its bookkeeping table is one the desktop would not
/// know). A second run on an up-to-date file writes nothing.
enum SchemaPass {
    static func run(_ writer: DatabasePool) throws {
        try writer.writeWithoutTransaction { db in
            try db.execute(sql: Schema.notes)
            try db.execute(sql: Schema.groups)
            try db.execute(sql: Schema.notebooks)
            try db.execute(sql: Schema.trash)
            try db.execute(sql: Schema.attachments)
            try db.execute(sql: Schema.documents)
            try db.execute(sql: Schema.todos)
            try db.execute(sql: Schema.readingList)
            try db.execute(sql: Schema.feeds)
            try db.execute(sql: Schema.contacts)

            // A database from before statuses: the items already ticked off are "done", the rest keep the default "todo".
            if try !hasColumn(db, "todos", "status") {
                try db.execute(sql: "ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'")
                try db.execute(sql: "UPDATE todos SET status = 'done' WHERE done = 1")
            }
            try db.execute(sql: Schema.todoCycle)
            for (column, ddl) in Schema.todoCycleColumns {
                try ensureColumn(db, "todos", column, ddl)
            }
            try ensureColumn(db, "notes", "tags", "ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
            try ensureColumn(
                db, "notes", "description", "ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''")
            try ensureColumn(db, "notes", "group_id", "ALTER TABLE notes ADD COLUMN group_id INTEGER")
            // Hand-set order among siblings; NULL until the item is dragged into place.
            try ensureColumn(db, "notes", "position", "ALTER TABLE notes ADD COLUMN position INTEGER")
            try ensureColumn(db, "groups", "position", "ALTER TABLE groups ADD COLUMN position INTEGER")
            try ensureColumn(db, "notebooks", "position", "ALTER TABLE notebooks ADD COLUMN position INTEGER")
            for table in ["notes", "groups", "trashed_notes", "trashed_groups"] {
                try ensureColumn(db, table, "notebook_id", "ALTER TABLE \(table) ADD COLUMN notebook_id INTEGER")
            }
        }
        try ensureUuids(writer)
        try adoptOrphans(writer)
    }

    private static func hasColumn(_ db: Database, _ table: String, _ column: String) throws -> Bool {
        try Row.fetchAll(db, sql: "PRAGMA table_info(\(table))").contains { $0["name"] as String == column }
    }

    private static func ensureColumn(_ db: Database, _ table: String, _ column: String, _ ddl: String) throws {
        if try !hasColumn(db, table, column) {
            try db.execute(sql: ddl)
        }
    }

    /// Adds `uuid` to every table that carries one and fills it for the rows that have none. The column, the `AFTER INSERT`
    /// trigger and the unique index go in together, in one immediate transaction: from then on a row written by an older
    /// build, which does not know the column, gets a uuid from the trigger. The index goes in before the backfill so that
    /// finding the rows still to fill (and knowing, on every later open, that there are none) is a lookup, not a scan.
    private static func ensureUuids(_ writer: DatabasePool) throws {
        try writer.writeWithoutTransaction { db in
            try db.inTransaction(.immediate) {
                for table in Schema.uuidTables {
                    try ensureColumn(db, table, "uuid", "ALTER TABLE \(table) ADD COLUMN uuid TEXT")
                    try db.execute(sql: Schema.uuidTriggerAndIndex(table))
                }
                return .commit
            }
        }
        for table in Schema.uuidTables {
            // One write transaction per batch, so the backfill never holds the writer for long.
            var changed = 0
            repeat {
                changed = try writer.write { db in
                    try db.execute(sql: """
                        UPDATE \(table) SET uuid = \(Schema.newUuid)
                        WHERE rowid IN (SELECT rowid FROM \(table) WHERE uuid IS NULL LIMIT \(Schema.uuidBackfillBatch))
                        """)
                    return db.changesCount
                }
            } while changed > 0
        }
    }

    /// Makes sure there is a notebook, and that every note and group is in one. A database from before notebooks gets a
    /// single "Notebook" holding everything it had; rows written by an older CLI (which knows nothing of notebooks) join
    /// the first notebook. Immediate, because it reads and then writes.
    private static func adoptOrphans(_ writer: DatabasePool) throws {
        try writer.writeWithoutTransaction { db in
            try db.inTransaction(.immediate) {
                var first = try Int64.fetchOne(db, sql: "SELECT MIN(id) FROM notebooks")
                if first == nil {
                    let now = Timestamp.now()
                    try db.execute(
                        sql: "INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Notebook', ?, ?)",
                        arguments: [now, now])
                    first = db.lastInsertedRowID
                }
                for table in ["notes", "groups", "trashed_notes", "trashed_groups"] {
                    try db.execute(
                        sql: "UPDATE \(table) SET notebook_id = ? WHERE notebook_id IS NULL", arguments: [first])
                }
                return .commit
            }
        }
    }
}
