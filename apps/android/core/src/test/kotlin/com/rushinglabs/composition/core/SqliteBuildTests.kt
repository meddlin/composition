package com.rushinglabs.composition.core

import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// What the bundled SQLite is (spike A1 of docs/android-app-design.md): its version and build options beside the ones the iPad
// core relies on, and the pieces search needs. Prints them, so a run on the Mac's JVM and one on the emulator can be compared.

@DisplayName("The bundled SQLite")
class SqliteBuildTests {
    @Test
    @DisplayName("reports its version and build options")
    fun reportsBuild() = withScratch { scratch ->
        raw(File(scratch, "probe.db")) { db ->
            val version = db.string("SELECT sqlite_version()")
            val options = db.strings("PRAGMA compile_options")
            println("SQLite $version\n${options.joinToString(" ")}")
            assertTrue(options.isNotEmpty())
        }
    }

    @Test
    @DisplayName("has FTS5 with fts5vocab and the trigram tokenizer, which search and its typo layer use")
    fun hasSearchPieces() = withScratch { scratch ->
        raw(File(scratch, "probe.db")) { db ->
            db.execute("CREATE VIRTUAL TABLE t USING fts5(body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3')")
            db.execute("INSERT INTO t (body) VALUES ('Routing notes across devices')")
            assertEquals(1L, db.long("SELECT COUNT(*) FROM t WHERE t MATCH 'routing'"))
            db.execute("CREATE VIRTUAL TABLE v USING fts5vocab(t, 'row')")
            assertTrue(db.strings("SELECT term FROM v").contains("routing"))
            db.execute("CREATE VIRTUAL TABLE g USING fts5(body, tokenize = 'trigram')")
            db.execute("INSERT INTO g (body) VALUES ('Routing')")
            assertEquals(1L, db.long("SELECT COUNT(*) FROM g WHERE g MATCH 'uti'"))
        }
    }

    @Test
    @DisplayName("opens a WAL database as an immutable URI, as restoring a backup does")
    fun opensImmutableUri() = withScratch { scratch ->
        // A file whose header says WAL, closed cleanly, in a folder with spaces in its name.
        val folder = File(scratch, "a folder with spaces").apply { mkdirs() }
        val file = File(folder, "composition.db")
        SqliteFile.open(file.path).use { it.write { db -> db.execute("CREATE TABLE notes (id INTEGER)"); db.execute("INSERT INTO notes VALUES (7)") } }
        SqliteFile.openImmutable(file.path).use { immutable ->
            assertEquals(7L, immutable.read { it.long("SELECT id FROM notes") })
        }
        assertTrue(folder.listFiles()!!.none { it.name.endsWith("-wal") || it.name.endsWith("-shm") }, "no side files were made")
    }

    @Test
    @DisplayName("splits a block of SQL as SQLite would, keeping a trigger's body whole")
    fun splitsScripts() {
        val parts = SqlScript.split(Schema.uuidTriggerAndIndex("notes"))
        assertEquals(2, parts.size)
        assertTrue(parts[0].startsWith("CREATE TRIGGER") && parts[0].endsWith("END"))
        assertTrue(parts[1].startsWith("CREATE UNIQUE INDEX"))
        val quoted = SqlScript.split("SELECT ';'; -- a comment; still a comment\nSELECT 2;")
        assertEquals(2, quoted.size)
        assertEquals("SELECT ';'", quoted[0])
        assertTrue(quoted[1].endsWith("SELECT 2"), "the comment stays with the statement after it")
    }
}
