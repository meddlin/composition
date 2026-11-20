package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.pdf.marksSearchText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onSubscription
import java.io.File

/** A note as the list shows it: no body, so listing a large database stays cheap. */
data class NoteSummary(
    val id: Long,
    /** The name a second device knows this note by. Never shown. */
    val uuid: String,
    val title: String,
    /** Comma-joined, the way the database stores them. */
    val tags: String,
    val notebookId: Long?,
    val groupId: Long?,
    val createdAt: String,
    val updatedAt: String,
) {
    internal constructor(row: Row) : this(
        row.long("id"), row.string("uuid"), row.string("title"), row.string("tags"), row.longOrNull("notebook_id"),
        row.longOrNull("group_id"), row.string("created_at"), row.string("updated_at"),
    )
}

/** A whole note: what the list shows, and the text. */
data class NoteDetail(
    val id: Long,
    val uuid: String,
    val title: String,
    val description: String,
    /** The Markdown, frontmatter included, exactly as stored. */
    val content: String,
    val tags: String,
    val notebookId: Long?,
    val groupId: Long?,
    val createdAt: String,
    val updatedAt: String,
) {
    internal constructor(row: Row) : this(
        row.long("id"), row.string("uuid"), row.string("title"), row.string("description"), row.string("content"),
        row.string("tags"), row.longOrNull("notebook_id"), row.longOrNull("group_id"), row.string("created_at"),
        row.string("updated_at"),
    )
}

/**
 * `composition.db`: the same file shape the desktop writes. Opening runs the additive schema pass, so a database from the
 * desktop, from the iPad, from a backup or from nothing at all comes up to date. Ported from CompositionDatabase.swift.
 */
class CompositionDatabase private constructor(internal val file: SqliteFile) : AutoCloseable {
    companion object {
        /** Opens (creating if needed) the database at `path`, in WAL mode like the desktop, and brings it up to date. */
        fun open(path: File): CompositionDatabase {
            path.absoluteFile.parentFile.mkdirs()
            val file = SqliteFile.open(path.path)
            try {
                SchemaPass.run(file)
            } catch (error: Throwable) {
                file.close()
                throw error
            }
            return CompositionDatabase(file)
        }

        fun open(location: DataLocation): CompositionDatabase = open(location.databaseFile)
    }

    /** Folds the write-ahead log into the main file and closes the connection. Needed before the file is copied as a backup. */
    override fun close() = file.close()

    fun listNotes(): List<NoteSummary> = file.read { db ->
        db.rows("SELECT id, uuid, title, tags, notebook_id, group_id, created_at, updated_at FROM notes ORDER BY updated_at DESC, id DESC")
            .map(::NoteSummary)
    }

    /** One note with its text, or null if there is none with this id. */
    fun note(id: Long): NoteDetail? = file.read { db -> fetchNote(db, id) }

    /** The notes with these ids, in the order given; an id that is not a note is skipped (a search result may have just been trashed). */
    fun notes(ids: List<Long>): List<NoteSummary> = file.read { db ->
        val found = HashMap<Long, NoteSummary>()
        // SQLite's limit on variables is far above any page of results, but a long list is read in pieces anyway.
        for (chunk in ids.chunked(500)) {
            val marks = chunk.joinToString(", ") { "?" }
            db.rows("SELECT id, uuid, title, tags, notebook_id, group_id, created_at, updated_at FROM notes WHERE id IN ($marks)", *chunk.toTypedArray())
                .forEach { found[it.long("id")] = NoteSummary(it) }
        }
        ids.mapNotNull { found[it] }
    }

    /**
     * What the notes look like now, in one short string: how many, the latest change, and the sum of their ids. The search index
     * stores it when it is built, and a different one later means the notes changed behind its back (a restore, say).
     */
    fun notesFingerprint(): String = file.read { db ->
        val row = db.row("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS latest, COALESCE(SUM(id), 0) AS total FROM notes")!!
        "${row["n"]}|${row["latest"]}|${row["total"]}"
    }

    /** Every note as the search index takes it. A note that owns a PDF is also found by the words of that PDF's marks, which follow its text. */
    internal fun indexedNotes(): List<com.rushinglabs.composition.core.search.IndexedNote> {
        val marks = marksSearchText()
        return file.read { db ->
            db.rows("SELECT id, title, description, content, tags, created_at, updated_at FROM notes ORDER BY id").map {
                val id = it.long("id")
                val content = it.string("content")
                com.rushinglabs.composition.core.search.IndexedNote(
                    id, it.string("title"), it.string("description"), marks[id]?.let { words -> "$content\n\n$words" } ?: content,
                    it.string("tags"), it.string("created_at"), it.string("updated_at"),
                )
            }
        }
    }

    /** The version of the SQLite this database runs on (the bundled one). */
    fun sqliteVersion(): String = file.read { it.string("SELECT sqlite_version()") ?: "unknown" }

    /**
     * `query` now, and again after every write: what a screen collects to stay current. Runs on the IO dispatcher, never the main
     * thread. A burst of writes may be seen as one re-read. The first read happens once the subscription to writes is in place,
     * so a write landing between the two is never missed.
     */
    fun <T> observe(query: (CompositionDatabase) -> T): Flow<T> =
        file.changes.onSubscription { emit(Unit) }.map { query(this) }.flowOn(Dispatchers.IO)

    internal fun fetchNote(db: Db, id: Long): NoteDetail? =
        db.row("SELECT $NOTE_COLUMNS FROM notes WHERE id = ?", id)?.let(::NoteDetail)
}

internal const val NOTE_COLUMNS = "id, uuid, title, description, content, tags, notebook_id, group_id, created_at, updated_at"
