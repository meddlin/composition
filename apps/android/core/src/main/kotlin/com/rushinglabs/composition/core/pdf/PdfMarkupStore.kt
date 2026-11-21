package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.CoreException
import com.rushinglabs.composition.core.CoreLog
import com.rushinglabs.composition.core.Db
import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.NoteStore
import com.rushinglabs.composition.core.Row
import com.rushinglabs.composition.core.Timestamp
import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.time.Instant
import java.util.Locale
import java.util.UUID

// The marks and bookmarks of a PDF: a port of `pdfMarkupRepo.ts` (by way of PdfMarkupStore.swift), with the same SQL and the same
// refusals. The conformance corpus (fixtures/conformance/pdf) runs both against a fresh database. Every write is checked by `PdfMarkup`
// and against the PDF's page count (a PDF whose pages have not been counted yet, `page_count` 0, accepts any page), and every mark and
// bookmark gets a uuid from the table's trigger. `pdf:` links name a PDF and a mark by those uuids.
//
// Not pinned by the corpus, so checked by PdfMarkupStoreTests against what the desktop's functions do: `restoreAnnotations` (undo of a
// delete), `marksSearchText` (the words that find a PDF's note) and `notesForPdf` (the notes that cite a PDF, which the desktop reads from
// the notes it already holds in memory).

/** A mark on a PDF. (`PdfAnnotation` on the desktop.) */
data class PdfMark(
    val id: Long,
    val uuid: String,
    val documentId: Long,
    /** 0-based page index. */
    val page: Int,
    val kind: PdfMarkKind,
    val color: String,
    val rects: List<PdfRect>?,
    val quote: String,
    val comment: String,
    val body: JsonValue?,
    val groupUuid: String?,
    val createdAt: String,
    val updatedAt: String,
) {
    /** Throws `InvalidMarkException` when a column holds what no mark of this app has: a kind it does not know, or JSON that is not rectangles or not JSON. */
    internal constructor(row: Row) : this(
        row.long("id"), row.string("uuid"), row.long("document_id"), row.long("page").toInt(), kindOf(row.string("kind")), row.string("color"),
        rectsOf(row.stringOrNull("rects")), row.string("quote"), row.string("comment"), bodyOf(row.stringOrNull("body")), row.stringOrNull("group_uuid"),
        row.string("created_at"), row.string("updated_at"),
    )

    private companion object {
        fun kindOf(name: String) = PdfMarkKind.of(name) ?: throw InvalidMarkException("Unknown kind of mark: $name.")

        fun rectsOf(text: String?): List<PdfRect>? = text?.let {
            val items = runCatching { JsonValue.parse(it) }.getOrNull()?.arrayValue ?: throw InvalidMarkException("A mark's rectangles are damaged.")
            items.map { item -> PdfRect.of(item) ?: throw InvalidMarkException("A mark's rectangles are damaged.") }
        }

        fun bodyOf(text: String?): JsonValue? = text?.let { runCatching { JsonValue.parse(it) }.getOrNull() ?: throw InvalidMarkException("A mark's body is damaged.") }
    }
}

data class PdfBookmark(
    val id: Long,
    val uuid: String,
    val documentId: Long,
    val page: Int,
    /** One line; empty means the page number is shown. */
    val label: String,
    val createdAt: String,
) {
    internal constructor(row: Row) : this(
        row.long("id"), row.string("uuid"), row.long("document_id"), row.long("page").toInt(), row.string("label"), row.string("created_at"),
    )
}

internal const val MARK_COLUMNS = "id, uuid, document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at"
internal const val BOOKMARK_COLUMNS = "id, uuid, document_id, page, label, created_at"

private const val TIMESTAMP_LENGTH = 40

// Marks ---------------------------------------------------------------------------------------------------------------------------

/**
 * The marks of a PDF, or of one page of it, in the order they were made. `withInk = false` leaves out the pages' ink, whose strokes are
 * megabytes (`PdfInkStore.kt`): what the reader holds as its list of marks.
 */
fun CompositionDatabase.annotations(documentId: Long, page: Int? = null, withInk: Boolean = true): List<PdfMark> {
    val notInk = if (withInk) "" else " AND kind <> 'ink'"
    return file.read { db ->
        if (page != null) {
            db.rows("SELECT $MARK_COLUMNS FROM pdf_annotations WHERE document_id = ? AND page = ?$notInk ORDER BY id", documentId, page).map(::PdfMark)
        } else {
            db.rows("SELECT $MARK_COLUMNS FROM pdf_annotations WHERE document_id = ?$notInk ORDER BY page, id", documentId).map(::PdfMark)
        }
    }
}

fun CompositionDatabase.annotation(id: Long): PdfMark? = file.read { fetchMark(it, id) }

fun CompositionDatabase.annotation(uuid: String): PdfMark? =
    file.read { db -> db.row("SELECT $MARK_COLUMNS FROM pdf_annotations WHERE uuid = ?", uuid)?.let(::PdfMark) }

/** Throws `InvalidMarkException` when the mark breaks the rules, the PDF is gone or the page is past its end; nothing is written then. */
fun CompositionDatabase.addAnnotation(documentId: Long, input: PdfMarkInput, now: Instant = Instant.now()): PdfMark {
    val mark = PdfMarkup.validate(input)
    return file.write { db ->
        assertPage(db, documentId, mark.page)
        insertMark(db, documentId, mark, Timestamp.now(now))
    }
}

/**
 * A selection that crossed pages is one record per page, joined by a group uuid made here: one input is an ordinary mark (no group), two
 * or more share one, whatever group the inputs name. All or none are stored.
 */
fun CompositionDatabase.addAnnotationGroup(documentId: Long, inputs: List<PdfMarkInput>, now: Instant = Instant.now()): List<PdfMark> {
    if (inputs.isEmpty()) return emptyList()
    val groupUuid = if (inputs.size > 1) UUID.randomUUID().toString().replace("-", "").lowercase(Locale.ROOT) else null
    val marks = inputs.map { PdfMarkup.validate(it.copy(groupUuid = groupUuid)) }
    return file.write { db ->
        for (mark in marks) assertPage(db, documentId, mark.page)
        val stamp = Timestamp.now(now)
        marks.map { insertMark(db, documentId, it, stamp) }
    }
}

/** Changes what the caller names and re-checks the whole mark; its page, kind and group never change. Null when it is gone. */
fun CompositionDatabase.updateAnnotation(id: Long, changes: PdfMarkChanges, now: Instant = Instant.now()): PdfMark? = file.write { db ->
    val current = fetchMark(db, id) ?: return@write null
    val mark = PdfMarkup.validate(
        PdfMarkInput(
            current.page, current.kind, changes.color ?: current.color,
            rects = if (changes.rects != null) changes.rects.rects else current.rects, quote = changes.quote ?: current.quote,
            comment = changes.comment ?: current.comment, body = changes.body ?: current.body, groupUuid = current.groupUuid,
        ),
    )
    db.execute(
        "UPDATE pdf_annotations SET color = ?, rects = ?, quote = ?, comment = ?, body = ?, updated_at = ? WHERE id = ?",
        mark.color, mark.rectsJson, mark.quote, mark.comment, mark.bodyJson, Timestamp.now(now), id,
    )
    fetchMark(db, id)
}

/**
 * Deletes a mark, and with it the other parts of the same selection when it crossed pages: the reader shows one highlight, so one delete
 * removes it. Returns what was removed (empty when it was already gone).
 */
fun CompositionDatabase.deleteAnnotation(id: Long): List<PdfMark> = file.write { db ->
    val mark = fetchMark(db, id) ?: return@write emptyList()
    val removed = mark.groupUuid?.let { group ->
        db.rows("SELECT $MARK_COLUMNS FROM pdf_annotations WHERE group_uuid = ? ORDER BY page, id", group).map(::PdfMark)
    } ?: listOf(mark)
    for (row in removed) db.execute("DELETE FROM pdf_annotations WHERE id = ?", row.id)
    removed
}

/**
 * Puts back marks that were deleted, exactly as they were: the same uuid (a note's citation of a mark names it by uuid), the same group,
 * the same times, and the same id when it is free (ids are never reused, so it is). This is what undoing a delete does. Each is checked as
 * a new mark would be. A mark whose uuid is already there is left alone, so asking twice, as a redo after an undo may, does no harm. All or
 * none are put back.
 */
fun CompositionDatabase.restoreAnnotations(documentId: Long, rows: List<PdfMark>): List<PdfMark> {
    val checked = rows.map { row ->
        if (!PdfMarkup.isHexUuid(row.uuid)) throw InvalidMarkException("A mark's uuid is 32 lowercase hex characters.")
        for (time in listOf(row.createdAt, row.updatedAt)) {
            if (time.isEmpty() || time.length > TIMESTAMP_LENGTH) throw InvalidMarkException("A mark has the times it was made and changed.")
        }
        row to PdfMarkup.validate(PdfMarkInput(row.page, row.kind, row.color, row.rects, row.quote, row.comment, row.body, row.groupUuid))
    }
    return file.write { db ->
        val restored = ArrayList<PdfMark>()
        for ((row, mark) in checked) {
            assertPage(db, documentId, mark.page)
            val existing = db.row("SELECT $MARK_COLUMNS FROM pdf_annotations WHERE uuid = ?", row.uuid)?.let(::PdfMark)
            if (existing != null) {
                restored.add(existing)
                continue
            }
            val idFree = db.row("SELECT 1 FROM pdf_annotations WHERE id = ?", row.id) == null
            db.execute(
                """
                INSERT INTO pdf_annotations (id, uuid, document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                if (idFree) row.id else null, row.uuid, documentId, mark.page, mark.kind.rawValue, mark.color, mark.rectsJson, mark.quote, mark.comment,
                mark.bodyJson, mark.groupUuid, row.createdAt, row.updatedAt,
            )
            restored.add(
                db.row("SELECT $MARK_COLUMNS FROM pdf_annotations WHERE uuid = ?", row.uuid)?.let(::PdfMark)
                    ?: throw CoreException.NotFound("The mark that was just restored"),
            )
        }
        restored
    }
}

// Search ----------------------------------------------------------------------------------------------------------------------------

/**
 * The words a PDF's owner note is found by, besides its own text: the quotes and comments of its marks, what its text notes say, and its
 * bookmarks' labels, one per line, by page. Kept apart from the note's content (the search index holds both under the note's id), so
 * searching "B-tree" finds the textbook's note when a highlight in it says so. With `noteId`, only that note's; otherwise every owner
 * note's (the whole index is being rebuilt). A note with no words has no entry.
 */
fun CompositionDatabase.marksSearchText(noteId: Long? = null): Map<Long, String> = file.read { db ->
    val filter = if (noteId == null) "" else "WHERE d.note_id = ?"
    val arguments: Array<Any?> = if (noteId == null) emptyArray() else arrayOf(noteId)
    val marks = db.rows(
        """
        SELECT d.note_id AS note_id, a.kind AS kind, a.quote AS quote, a.comment AS comment, CASE WHEN a.kind = 'text' THEN a.body END AS body
        FROM pdf_annotations a JOIN documents d ON d.id = a.document_id $filter ORDER BY d.note_id, a.page, a.id
        """.trimIndent(),
        *arguments,
    )
    val labels = db.rows(
        "SELECT d.note_id AS note_id, b.label AS label FROM pdf_bookmarks b JOIN documents d ON d.id = b.document_id $filter ORDER BY d.note_id, b.page, b.id",
        *arguments,
    )

    val lines = LinkedHashMap<Long, MutableList<String>>()
    fun add(id: Long, text: String?) {
        if (text == null) return
        val line = JavaScriptText.trim(text)
        if (line.isNotEmpty()) lines.getOrPut(id) { ArrayList() }.add(line)
    }
    for (mark in marks) {
        val id = mark.long("note_id")
        if (mark.string("kind") == PdfMarkKind.TEXT.rawValue) {
            // A damaged body has no words to find.
            val body = mark.stringOrNull("body")?.let { runCatching { JsonValue.parse(it) }.getOrNull() }
            if (body != null) add(id, body.objectValue?.get("text")?.stringValue)
        } else {
            add(id, mark.stringOrNull("quote"))
        }
        add(id, mark.stringOrNull("comment"))
    }
    for (label in labels) add(label.long("note_id"), label.stringOrNull("label"))
    lines.mapValues { it.value.joinToString("\n") }
}

// Citations -------------------------------------------------------------------------------------------------------------------------

/**
 * The notes that belong with a PDF, with their text: its owner (whether or not its text links to it) and every note whose text contains
 * `pdf:<uuid>`. `PdfRefs.citations(notes, documentUuid, ownerNoteId)` reads what each cites and puts them in order.
 */
fun CompositionDatabase.notesForPdf(uuid: String, ownerNoteId: Long): List<PdfNoteText> = file.read { db ->
    db.rows("SELECT id, title, content, updated_at FROM notes WHERE id = ? OR instr(content, ?) > 0", ownerNoteId, PdfRefs.SCHEME + uuid).map {
        PdfNoteText(it.long("id"), it.string("title"), it.string("content"), it.string("updated_at"))
    }
}

// Bookmarks -------------------------------------------------------------------------------------------------------------------------

fun CompositionDatabase.bookmarks(documentId: Long): List<PdfBookmark> =
    file.read { db -> db.rows("SELECT $BOOKMARK_COLUMNS FROM pdf_bookmarks WHERE document_id = ? ORDER BY page, id", documentId).map(::PdfBookmark) }

fun CompositionDatabase.bookmark(id: Long): PdfBookmark? = file.read { fetchBookmark(it, id) }

fun CompositionDatabase.addBookmark(documentId: Long, page: Int, label: String = "", now: Instant = Instant.now()): PdfBookmark {
    if (page < 0) throw InvalidMarkException("A page is a whole number from 0.")
    val text = PdfMarkup.validateBookmarkLabel(label)
    return file.write { db ->
        assertPage(db, documentId, page)
        db.execute("INSERT INTO pdf_bookmarks (document_id, page, label, created_at) VALUES (?, ?, ?, ?)", documentId, page, text, Timestamp.now(now))
        fetchBookmark(db, db.lastInsertedRowId) ?: throw CoreException.NotFound("The bookmark that was just added")
    }
}

/** Renames a bookmark. Null when it is gone. */
fun CompositionDatabase.renameBookmark(id: Long, label: String): PdfBookmark? {
    val text = PdfMarkup.validateBookmarkLabel(label)
    return file.write { db ->
        db.execute("UPDATE pdf_bookmarks SET label = ? WHERE id = ?", text, id)
        fetchBookmark(db, id)
    }
}

fun CompositionDatabase.deleteBookmark(id: Long) {
    file.write { it.execute("DELETE FROM pdf_bookmarks WHERE id = ?", id) }
}

// Inside a transaction --------------------------------------------------------------------------------------------------------------

internal fun fetchMark(db: Db, id: Long): PdfMark? = db.row("SELECT $MARK_COLUMNS FROM pdf_annotations WHERE id = ?", id)?.let(::PdfMark)

internal fun fetchBookmark(db: Db, id: Long): PdfBookmark? = db.row("SELECT $BOOKMARK_COLUMNS FROM pdf_bookmarks WHERE id = ?", id)?.let(::PdfBookmark)

/** Throws unless the PDF exists and `page` is one of its pages. */
internal fun assertPage(db: Db, documentId: Long, page: Int) {
    val count = db.long("SELECT page_count FROM documents WHERE id = ?", documentId) ?: throw InvalidMarkException("That PDF no longer exists.")
    if (count > 0 && page >= count) throw InvalidMarkException("This PDF has $count pages; page $page is past the end.")
}

private fun insertMark(db: Db, documentId: Long, mark: ValidPdfMark, stamp: String): PdfMark {
    db.execute(
        """
        INSERT INTO pdf_annotations (document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """.trimIndent(),
        documentId, mark.page, mark.kind.rawValue, mark.color, mark.rectsJson, mark.quote, mark.comment, mark.bodyJson, mark.groupUuid, stamp, stamp,
    )
    return fetchMark(db, db.lastInsertedRowId) ?: throw CoreException.NotFound("The mark that was just added")
}

// A PDF's marks and bookmarks through the NoteStore ---------------------------------------------------------------------------------
//
// The owner note of a PDF is found by the words of its PDF's marks (docs/pdf-markup-plan.md, "Search"), so a change to a mark or a
// bookmark puts that note back in the index. Like every index change in NoteStore it is derived state: it never fails the write.

fun NoteStore.addAnnotations(documentId: Long, inputs: List<PdfMarkInput>, now: Instant = Instant.now()): List<PdfMark> =
    withMarks(documentId) { database.addAnnotationGroup(documentId, inputs, now) }

fun NoteStore.updateAnnotation(id: Long, changes: PdfMarkChanges, now: Instant = Instant.now()): PdfMark? =
    withMarks(database.annotation(id)?.documentId) { database.updateAnnotation(id, changes, now) }

/** Deletes a mark and the rest of its selection; returns everything removed. */
fun NoteStore.deleteAnnotation(id: Long): List<PdfMark> = withMarks(database.annotation(id)?.documentId) { database.deleteAnnotation(id) }

fun NoteStore.restoreAnnotations(documentId: Long, rows: List<PdfMark>): List<PdfMark> =
    withMarks(documentId) { database.restoreAnnotations(documentId, rows) }

fun NoteStore.addBookmark(documentId: Long, page: Int, label: String = "", now: Instant = Instant.now()): PdfBookmark =
    withMarks(documentId) { database.addBookmark(documentId, page, label, now) }

fun NoteStore.renameBookmark(id: Long, label: String): PdfBookmark? =
    withMarks(database.bookmark(id)?.documentId) { database.renameBookmark(id, label) }

fun NoteStore.deleteBookmark(id: Long) = withMarks(database.bookmark(id)?.documentId) { database.deleteBookmark(id) }

/** Runs a change to a PDF's marks or bookmarks, then re-indexes the note that owns the PDF. */
private fun <T> NoteStore.withMarks(documentId: Long?, change: () -> T): T {
    val result = change()
    val index = search
    if (documentId != null && index != null) {
        val note = runCatching { database.document(documentId)?.let { database.note(it.noteId) } }.getOrNull()
        if (note != null) {
            try {
                index.upsert(listOf(indexed(note)))
            } catch (error: Exception) {
                CoreLog.sink("[search] indexing failed: $error")
            }
        }
    }
    return result
}
