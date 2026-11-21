package com.rushinglabs.composition.core

/**
 * The pass that brings a database up to date on every open, in the order `openConnection` in `db.ts` runs it (ported from
 * SchemaPass.swift). Additive and idempotent: a database any app has touched is a no-op for the others. A second run on an
 * up-to-date file writes nothing.
 */
internal object SchemaPass {
    fun run(file: SqliteFile) {
        file.writeWithoutTransaction { db ->
            db.execute(Schema.notes)
            db.execute(Schema.groups)
            db.execute(Schema.notebooks)
            db.execute(Schema.trash)
            db.execute(Schema.attachments)
            db.execute(Schema.documents)
            db.execute(Schema.scans)
            db.execute(Schema.todos)
            db.execute(Schema.readingList)
            db.execute(Schema.feeds)
            db.execute(Schema.contacts)

            // A database from before statuses: the items already ticked off are "done", the rest keep the default "todo".
            if (!hasColumn(db, "todos", "status")) {
                db.execute("ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'")
                db.execute("UPDATE todos SET status = 'done' WHERE done = 1")
            }
            db.execute(Schema.todoCycle)
            for ((column, ddl) in Schema.todoCycleColumns) ensureColumn(db, "todos", column, ddl)
            ensureColumn(db, "notes", "tags", "ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
            ensureColumn(db, "notes", "description", "ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''")
            ensureColumn(db, "notes", "group_id", "ALTER TABLE notes ADD COLUMN group_id INTEGER")
            // Hand-set order among siblings; NULL until the item is dragged into place.
            ensureColumn(db, "notes", "position", "ALTER TABLE notes ADD COLUMN position INTEGER")
            ensureColumn(db, "groups", "position", "ALTER TABLE groups ADD COLUMN position INTEGER")
            ensureColumn(db, "notebooks", "position", "ALTER TABLE notebooks ADD COLUMN position INTEGER")
            for (table in listOf("notes", "groups", "trashed_notes", "trashed_groups")) {
                ensureColumn(db, table, "notebook_id", "ALTER TABLE $table ADD COLUMN notebook_id INTEGER")
            }
        }
        ensureUuids(file)
        adoptOrphans(file)
    }

    private fun hasColumn(db: Db, table: String, column: String): Boolean =
        db.rows("PRAGMA table_info($table)").any { it["name"] == column }

    private fun ensureColumn(db: Db, table: String, column: String, ddl: String) {
        if (!hasColumn(db, table, column)) db.execute(ddl)
    }

    /**
     * Adds `uuid` to every table that carries one and fills it for the rows that have none. The column, the trigger and the
     * unique index go in together in one immediate transaction; the backfill then runs a batch per write transaction.
     */
    private fun ensureUuids(file: SqliteFile) {
        file.writeWithoutTransaction { db ->
            db.inImmediateTransaction {
                for (table in Schema.uuidTables) {
                    ensureColumn(db, table, "uuid", "ALTER TABLE $table ADD COLUMN uuid TEXT")
                    db.execute(Schema.uuidTriggerAndIndex(table))
                }
            }
        }
        for (table in Schema.uuidTables) {
            do {
                val changed = file.write { db ->
                    db.execute(
                        """
                        UPDATE $table SET uuid = ${Schema.NEW_UUID}
                        WHERE rowid IN (SELECT rowid FROM $table WHERE uuid IS NULL LIMIT ${Schema.UUID_BACKFILL_BATCH})
                        """.trimIndent(),
                    )
                    db.changesCount
                }
            } while (changed > 0)
        }
    }

    /**
     * Makes sure there is a notebook, and that every note and group is in one. A database from before notebooks gets a single
     * "Notebook" holding everything it had; rows written by an older CLI join the first notebook.
     */
    private fun adoptOrphans(file: SqliteFile) {
        file.write { db ->
            var first = db.long("SELECT MIN(id) FROM notebooks")
            if (first == null) {
                val now = Timestamp.now()
                db.execute("INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Notebook', ?, ?)", now, now)
                first = db.lastInsertedRowId
            }
            for (table in listOf("notes", "groups", "trashed_notes", "trashed_groups")) {
                db.execute("UPDATE $table SET notebook_id = ? WHERE notebook_id IS NULL", first)
            }
        }
    }
}
