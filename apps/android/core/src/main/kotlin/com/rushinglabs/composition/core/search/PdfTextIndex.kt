package com.rushinglabs.composition.core.search

import com.rushinglabs.composition.core.Db
import com.rushinglabs.composition.core.pdf.StoredDocument

// The text of PDFs in the search index (docs/architecture/search.md, "The text of a PDF"), ported from SearchIndex+PdfText.swift: every
// page of every PDF a note owns, so that a word found only in the PDF finds the note, with the page it is first on.
//
// Like the rest of the index it lives in `search.db`, never in `composition.db` (the shared schema) or a backup: it is derived from the
// files. It is kept apart from the notes' own text for three reasons. Reading a big PDF takes seconds, so a rebuild of the notes
// (`rebuild`) must not throw it away; it is keyed by the file's SHA-256 so a PDF is read once. A page is a row, so a hit can say its page.
// And its words stay out of the vocabulary that typo tolerance searches on every keystroke: a library of books has hundreds of thousands of
// words, which would make every search slow; in a PDF's text a word is found as typed (and the last one as the start of a word), not with
// typos.
//
// The FTS5 table is contentless (`content=''`): the text is never read back, so it is not stored twice; `contentless_delete=1` (SQLite
// 3.43, which the bundled SQLite is well past) lets a PDF's rows be deleted.

/** One note a search found. `pdfPage` (0-based) is set when only its PDF's own text was found, with the page's printed label if it has one. */
data class SearchHit(val noteId: Long, val pdfPage: Int? = null, val pdfPageLabel: String? = null)

/** Where a PDF's text is in the index. */
enum class PdfTextState(val rawValue: String) {
    /** Its pages are in the index (some may have had no text). */
    INDEXED("indexed"),
    /** It was read, and not one page had text: a scan, most likely (OCR is not built). */
    NO_TEXT("noText"),
    /** It asks for a password; it is read when it is next unlocked in the reader. The password is never kept. */
    LOCKED("locked"),
    /** The text reader could not open it. */
    UNREADABLE("unreadable");

    companion object {
        fun of(rawValue: String): PdfTextState? = entries.firstOrNull { it.rawValue == rawValue }
    }
}

/** A PDF a note owns, as the index needs to know it: what `reconcilePdfText` is given from `composition.db`'s `documents`. */
data class PdfTextSource(val documentId: Long, val noteId: Long, val sha256: String) {
    constructor(document: StoredDocument) : this(document.id, document.noteId, document.sha256)
}

/** The PDFs' text that is in the index: how many PDFs, pages with text and characters (for Settings and the measurements). */
data class PdfTextTotals(val files: Long, val pages: Long, val characters: Long)

internal fun createPdfTextTables(db: Db) {
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS pdf_files (
            document_id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL, sha256 TEXT NOT NULL, state TEXT NOT NULL,
            pages INTEGER NOT NULL DEFAULT 0, characters INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS pdf_pages (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, page INTEGER NOT NULL, label TEXT);
        CREATE INDEX IF NOT EXISTS idx_pdf_pages_document ON pdf_pages (document_id, page);
        CREATE VIRTUAL TABLE IF NOT EXISTS pdf_text_fts USING fts5(
            text, tokenize = 'unicode61 remove_diacritics 2', content = '', contentless_delete = 1);
        """.trimIndent(),
    )
}

// Keeping it in step with the PDFs ------------------------------------------------------------------------------------------------

/**
 * Forgets what is no longer a PDF here (its row is gone, or the file under it changed) and returns the PDFs whose text has to be read:
 * those never read. A PDF that was locked is not returned (it is read when it is unlocked); one that could not be opened is not tried again
 * until its file changes.
 */
fun SearchIndex.reconcilePdfText(documents: List<PdfTextSource>): List<PdfTextSource> = file.write { db ->
    val known = db.rows("SELECT document_id, note_id, sha256 FROM pdf_files")
    val current = LinkedHashMap<Long, PdfTextSource>()
    for (document in documents) current.putIfAbsent(document.documentId, document)
    val kept = HashSet<Long>()
    for (row in known) {
        val id = row.long("document_id")
        val document = current[id]
        if (document != null && document.sha256 == row.string("sha256") && document.noteId == row.long("note_id")) {
            kept.add(id)
        } else {
            deletePdfText(id, db)
        }
    }
    documents.filter { it.documentId !in kept }
}

/** Keeps a PDF's pages (replacing any it had), each through `PdfSearchText.pageSearchText`. A PDF none of whose pages has text is `NO_TEXT`. */
fun SearchIndex.storePdfText(documentId: Long, noteId: Long, sha256: String, pages: List<PdfTextPage>) {
    file.write { db ->
        deletePdfText(documentId, db)
        var characters = 0L
        for (entry in pages) {
            val indexed = PdfSearchText.pageSearchText(entry.text)
            if (indexed.isEmpty()) continue
            characters += PdfSearchText.characterCount(indexed)
            db.execute("INSERT INTO pdf_pages (document_id, page, label) VALUES (?, ?, ?)", documentId, entry.page, entry.label)
            // Folded as a query is (`Typo.fold`): FTS5's `remove_diacritics` takes the accents off Latin letters only, so `Ζεύς` would
            // stay `ζεύς` in the index and the query's `ζευς` would not find it. The text is never shown, so nothing is lost.
            db.execute("INSERT INTO pdf_text_fts (rowid, text) VALUES (?, ?)", db.lastInsertedRowId, Typo.fold(indexed))
        }
        db.execute(
            "INSERT INTO pdf_files (document_id, note_id, sha256, state, pages, characters) VALUES (?, ?, ?, ?, ?, ?)",
            documentId, noteId, sha256, (if (characters > 0) PdfTextState.INDEXED else PdfTextState.NO_TEXT).rawValue, pages.size, characters,
        )
    }
}

/** Records that a PDF could not be read (`LOCKED` or `UNREADABLE`), with no text. */
fun SearchIndex.markPdfText(documentId: Long, noteId: Long, sha256: String, state: PdfTextState) {
    file.write { db ->
        deletePdfText(documentId, db)
        db.execute("INSERT INTO pdf_files (document_id, note_id, sha256, state) VALUES (?, ?, ?, ?)", documentId, noteId, sha256, state.rawValue)
    }
}

/** Where a PDF's text is: null if it has not been read yet. */
fun SearchIndex.pdfTextState(documentId: Long): PdfTextState? =
    file.read { it.string("SELECT state FROM pdf_files WHERE document_id = ?", documentId) }?.let(PdfTextState::of)

fun SearchIndex.pdfTextTotals(): PdfTextTotals = file.read { db ->
    val row = db.row("SELECT COUNT(*) AS files, COALESCE(SUM(characters), 0) AS characters FROM pdf_files WHERE state = 'indexed'")
    val pages = db.long("SELECT COUNT(*) FROM pdf_pages") ?: 0L
    PdfTextTotals(row?.longOrNull("files") ?: 0L, pages, row?.longOrNull("characters") ?: 0L)
}

fun SearchIndex.removePdfText(documentIds: List<Long>) {
    file.write { db -> for (id in documentIds) deletePdfText(id, db) }
}

private fun deletePdfText(documentId: Long, db: Db) {
    db.execute("DELETE FROM pdf_text_fts WHERE rowid IN (SELECT id FROM pdf_pages WHERE document_id = ?)", documentId)
    db.execute("DELETE FROM pdf_pages WHERE document_id = ?", documentId)
    db.execute("DELETE FROM pdf_files WHERE document_id = ?", documentId)
}

// Searching -------------------------------------------------------------------------------------------------------------------------

/**
 * The notes, not in `excluding`, whose PDF has every word of the query on one page (the last word also as the start of a word, phrases as
 * phrases), each with the first such page. Ordered as the notes' own hits are: most recently updated first. The filters are the query's.
 */
internal fun pdfTextHits(query: SearchTerms, excluding: Set<Long>, limit: Int, filterSql: String, arguments: List<Any?>, db: Db): List<SearchHit> {
    val lastIndex = query.words.size - 1
    val words = query.words.mapIndexed { index, points ->
        val word = "\"" + String(points, 0, points.size) + "\""
        if (index == lastIndex && query.endsWithWord) "$word*" else word
    }
    val units = words + query.phrases.map(SearchTerms::phraseExpression)
    if (units.isEmpty() || limit <= 0) return emptyList()
    // SQLite gives the bare columns of the row MIN() chose: the first page, and its label.
    val rows = db.rows(
        """
        SELECT pdf_files.note_id AS note_id, MIN(pdf_pages.page) AS page, pdf_pages.label AS label
        FROM pdf_text_fts
        JOIN pdf_pages ON pdf_pages.id = pdf_text_fts.rowid
        JOIN pdf_files ON pdf_files.document_id = pdf_pages.document_id
        JOIN docs ON docs.id = pdf_files.note_id
        WHERE pdf_text_fts MATCH ?$filterSql
        GROUP BY pdf_files.note_id
        ORDER BY docs.updated_at DESC, docs.id DESC
        """.trimIndent(),
        units.joinToString(" AND "), *arguments.toTypedArray(),
    )
    val hits = ArrayList<SearchHit>()
    for (row in rows) {
        val id = row.long("note_id")
        if (id in excluding) continue
        hits.add(SearchHit(id, row.longOrNull("page")?.toInt(), row.stringOrNull("label")))
        if (hits.size == limit) break
    }
    return hits
}
