package com.rushinglabs.composition.core

import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

// The Kotlin core against databases the desktop's own TypeScript made, ported from ConformanceTests.swift. The fixtures are
// generated, not committed:
//
//   cd apps/web && COMPOSITION_FIXTURE_DIR=/some/dir node node_modules/vitest/vitest.mjs run scripts/conformance-fixtures.test.ts -t "writes "
//   cd apps/android && COMPOSITION_CONFORMANCE_DIR=/some/dir ./gradlew :core:test
//
// Without the variable these tests are reported as skipped, never as passed.

@DisplayName("Conformance with the desktop")
class ConformanceTests {
    /** Every schema object the file declares, in a stable order: the text of each `CREATE`. SQLite's own bookkeeping is left out. */
    private fun schemaObjects(file: File): List<String> = raw(file) { db ->
        db.rows("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
            .map { "${it["type"]} ${it["name"]} on ${it["tbl_name"]}: ${it["sql"] ?: "nil"}" }
    }

    /** The schema and every row of every table, as text: equal dumps mean nothing was added, changed or removed. */
    private fun dump(file: File): List<String> {
        val lines = schemaObjects(file).toMutableList()
        raw(file) { db ->
            for (table in db.strings("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")) {
                for (row in db.rows("SELECT * FROM \"$table\" ORDER BY rowid")) lines.add("$table: $row")
            }
        }
        return lines
    }

    /** A working copy, so the fixture itself is never opened for writing. */
    private fun copy(fixture: File, scratch: File): File = File(scratch, "composition.db").also { fixture.copyTo(it) }

    @Test
    @DisplayName("a database the Kotlin core creates has exactly the schema the desktop creates")
    fun freshSchemaMatchesDesktop() {
        val desktop = withScratch { schemaObjects(copy(fixture("desktop-empty.db"), it)) }
        withScratch { scratch ->
            val file = File(scratch, "composition.db")
            CompositionDatabase.open(file).close()
            val kotlin = schemaObjects(file)
            assertTrue(desktop.isNotEmpty())
            assertEquals(desktop.size, kotlin.size, "object counts differ")
            for ((mine, theirs) in kotlin.zip(desktop)) {
                if (mine != theirs) fail("schema differs:\n  kotlin:  $mine\n  desktop: $theirs")
            }
        }
    }

    @Test
    @DisplayName("opening a populated desktop database changes nothing in it")
    fun populatedDatabaseIsUntouched() {
        val source = fixture("desktop-populated.db")
        withScratch { scratch ->
            val file = copy(source, scratch)
            val before = dump(file)
            assertTrue(before.any { it.startsWith("notes: ") }, "the fixture has notes")
            assertTrue(before.any { it.startsWith("trashed_notes: ") }, "the fixture has a trashed note")
            CompositionDatabase.open(file).use { database ->
                assertEquals(2, database.listNotes().size, "Alpha and Beta are live; Gamma is in the Trash Can")
            }
            assertEquals(before, dump(file))
        }
    }

    @Test
    @DisplayName("every desktop uuid is a uuid, and none repeats across the tables")
    fun desktopUuidsAreWellFormed() {
        val source = fixture("desktop-populated.db")
        val uuids = withScratch { scratch ->
            raw(copy(source, scratch)) { db -> Schema.uuidTables.flatMap { db.strings("SELECT uuid FROM $it") } }
        }
        assertTrue(uuids.size >= 6)
        assertTrue(uuids.all(::isUuid))
        assertEquals(uuids.size, uuids.toSet().size)
    }
}
