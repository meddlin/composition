package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.CoreException
import com.rushinglabs.composition.core.Db
import com.rushinglabs.composition.core.Row
import com.rushinglabs.composition.core.Timestamp
import java.time.Instant

// The PDFs notes own: a port of `documentsRepo.ts` (by way of DocumentsStore.swift), with the same SQL and the same refusals. The
// conformance corpus (fixtures/conformance/pdf) runs both against a fresh database. Each operation is one write transaction, and `now` is
// a parameter so a test can say when something happened.
//
// A PDF is a row here and a file in `<application data>/documents/` (`DataLocation.documentsDirectory`). Writing and removing the file is
// the caller's (`DocumentLibrary`): `deleteDocument` and `deleteOrphanedDocuments` return the rows they dropped so the caller can remove
// the files.

/** A PDF a note owns, plus where its bytes are (`storedName`, the file's name in `documents/`) and their hash. */
data class StoredDocument(
    val id: Long,
    /** The name a second device knows this PDF by, and the one `pdf:` links use. */
    val uuid: String,
    /** The owner note, live or in the Trash Can. */
    val noteId: Long,
    /** The name it was imported as. */
    val fileName: String,
    val storedName: String,
    val sha256: String,
    /** Bytes. */
    val size: Long,
    /** 0 until the reader has counted them. */
    val pageCount: Int,
    val viewState: PdfViewState,
    val createdAt: String,
) {
    internal constructor(row: Row) : this(
        row.long("id"), row.string("uuid"), row.long("note_id"), row.string("file_name"), row.string("stored_name"), row.string("sha256"),
        row.long("size"), row.long("page_count").toInt(), PdfViewState.stored(row.stringOrNull("view_state")), row.string("created_at"),
    )
}

/**
 * Why a PDF can't be given to a note or counted: there is no such note, it already owns one (a note owns at most one PDF), or the pages
 * are fewer than one. The message is the desktop's and is safe to show.
 */
sealed class DocumentException(message: String) : Exception(message) {
    class NoNote : DocumentException("That note no longer exists.")
    class HasDocument : DocumentException("That note already has a PDF.")
    class InvalidPageCount : DocumentException("A PDF has at least one page.")
}

internal const val DOCUMENT_COLUMNS = "id, uuid, note_id, file_name, stored_name, sha256, size, page_count, view_state, created_at"

fun CompositionDatabase.document(id: Long): StoredDocument? = file.read { fetchDocument(it, id) }

fun CompositionDatabase.document(uuid: String): StoredDocument? =
    file.read { db -> db.row("SELECT $DOCUMENT_COLUMNS FROM documents WHERE uuid = ?", uuid)?.let(::StoredDocument) }

/** The PDF a note owns, whether the note is live or in the Trash Can. */
fun CompositionDatabase.documentForNote(noteId: Long): StoredDocument? =
    file.read { db -> db.row("SELECT $DOCUMENT_COLUMNS FROM documents WHERE note_id = ?", noteId)?.let(::StoredDocument) }

/** Every PDF with exactly these bytes, oldest first: what a second import of the same file is offered (P16). */
fun CompositionDatabase.documents(sha256: String): List<StoredDocument> =
    file.read { db -> db.rows("SELECT $DOCUMENT_COLUMNS FROM documents WHERE sha256 = ? ORDER BY id", sha256).map(::StoredDocument) }

/** Every PDF, oldest first: the sidebar marks the notes that own one, and opening a note finds its PDF here. */
fun CompositionDatabase.listDocuments(): List<StoredDocument> =
    file.read { db -> db.rows("SELECT $DOCUMENT_COLUMNS FROM documents ORDER BY id").map(::StoredDocument) }

/**
 * Gives a live note its PDF. Throws `DocumentException.NoNote` when the note is gone (one in the Trash Can is gone: it cannot be given a
 * PDF) and `HasDocument` when it already has one.
 */
fun CompositionDatabase.addDocument(
    noteId: Long, fileName: String, storedName: String, sha256: String, size: Long, pageCount: Int, now: Instant = Instant.now(),
): StoredDocument = file.write { db ->
    if (db.row("SELECT 1 FROM notes WHERE id = ?", noteId) == null) throw DocumentException.NoNote()
    if (db.row("SELECT 1 FROM documents WHERE note_id = ?", noteId) != null) throw DocumentException.HasDocument()
    db.execute(
        """
        INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """.trimIndent(),
        noteId, fileName, storedName, sha256, size, pageCount, Timestamp.now(now),
    )
    fetchDocument(db, db.lastInsertedRowId) ?: throw CoreException.NotFound("The PDF that was just added")
}

/** Records how many pages the reader counted. A PDF imported before it was counted has 0. */
fun CompositionDatabase.setPageCount(id: Long, pageCount: Int) {
    if (pageCount < 1) throw DocumentException.InvalidPageCount()
    file.write { it.execute("UPDATE documents SET page_count = ? WHERE id = ?", pageCount, id) }
}

/** Remembers where the reader was. Keeps the keys it knows and drops the rest (`PdfViewState.normalized`). */
fun CompositionDatabase.setViewState(id: Long, state: PdfViewState) {
    file.write { it.execute("UPDATE documents SET view_state = ? WHERE id = ?", state.normalized().json.serialized(), id) }
}

/** Drops a PDF's row, its marks, its bookmarks and a scan's pages and lines in one transaction, and returns the row so the caller can delete the file. */
fun CompositionDatabase.deleteDocument(id: Long): StoredDocument? = file.write { db ->
    val document = fetchDocument(db, id) ?: return@write null
    db.execute("DELETE FROM pdf_annotations WHERE document_id = ?", id)
    db.execute("DELETE FROM pdf_bookmarks WHERE document_id = ?", id)
    db.execute("DELETE FROM scan_lines WHERE document_id = ?", id)
    db.execute("DELETE FROM scan_pages WHERE document_id = ?", id)
    db.execute("DELETE FROM documents WHERE id = ?", id)
    document
}

/**
 * Drops the PDFs whose owner note is neither in `notes` nor in the Trash Can (`trashed_notes`), with their marks and bookmarks, and
 * returns them so the caller can delete the files. A PDF whose note is in the Trash Can is kept: restoring the note finds it again by the
 * note's unchanged id. Also drops marks and bookmarks whose PDF is gone.
 */
fun CompositionDatabase.deleteOrphanedDocuments(): List<StoredDocument> = file.write { db ->
    val orphans = db.rows(
        """
        SELECT $DOCUMENT_COLUMNS FROM documents
        WHERE note_id NOT IN (SELECT id FROM notes)
          AND note_id NOT IN (SELECT id FROM trashed_notes)
        """.trimIndent(),
    ).map(::StoredDocument)
    for (orphan in orphans) {
        db.execute("DELETE FROM pdf_annotations WHERE document_id = ?", orphan.id)
        db.execute("DELETE FROM pdf_bookmarks WHERE document_id = ?", orphan.id)
        db.execute("DELETE FROM scan_lines WHERE document_id = ?", orphan.id)
        db.execute("DELETE FROM scan_pages WHERE document_id = ?", orphan.id)
        db.execute("DELETE FROM documents WHERE id = ?", orphan.id)
    }
    db.execute("DELETE FROM pdf_annotations WHERE document_id NOT IN (SELECT id FROM documents)")
    db.execute("DELETE FROM pdf_bookmarks WHERE document_id NOT IN (SELECT id FROM documents)")
    db.execute("DELETE FROM scan_lines WHERE document_id NOT IN (SELECT id FROM documents)")
    db.execute("DELETE FROM scan_pages WHERE document_id NOT IN (SELECT id FROM documents)")
    orphans
}

// Inside a transaction ----------------------------------------------------------------------------------------------------------

internal fun fetchDocument(db: Db, id: Long): StoredDocument? = db.row("SELECT $DOCUMENT_COLUMNS FROM documents WHERE id = ?", id)?.let(::StoredDocument)
