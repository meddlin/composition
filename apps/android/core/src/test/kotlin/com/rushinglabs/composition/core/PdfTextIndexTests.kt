package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.search.PdfSearchText
import com.rushinglabs.composition.core.search.PdfTextPage
import com.rushinglabs.composition.core.search.PdfTextSource
import com.rushinglabs.composition.core.search.PdfTextState
import com.rushinglabs.composition.core.search.SearchHit
import com.rushinglabs.composition.core.search.SearchIndex
import com.rushinglabs.composition.core.search.markPdfText
import com.rushinglabs.composition.core.search.pdfTextState
import com.rushinglabs.composition.core.search.pdfTextTotals
import com.rushinglabs.composition.core.search.reconcilePdfText
import com.rushinglabs.composition.core.search.storePdfText
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// A PDF's own text in the search index, ported from PdfTextIndexTests.swift.

@DisplayName("A PDF's own text in the search index")
class PdfTextIndexTests {
    private fun insert(db: CompositionDatabase, title: String, content: String = "", tags: String = "", updated: String = "2026-01-01T00:00:00.000Z"): Long =
        db.file.write {
            it.execute("INSERT INTO notes (title, content, tags, description, created_at, updated_at, notebook_id) VALUES (?, ?, ?, '', ?, ?, 1)", title, content, tags, updated, updated)
            it.lastInsertedRowId
        }

    private fun world(body: (CompositionDatabase, SearchIndex) -> Unit) = withScratch { scratch ->
        openDatabase(scratch).use { database -> SearchIndex.open(File(scratch, "search.db")).use { index -> body(database, index) } }
    }

    private val book = listOf(
        PdfTextPage(0, "i", "Preface"),
        PdfTextPage(1, "ii", ""),
        PdfTextPage(2, "1", "The lighthouse keeper\ncounted quetzals."),
        PdfTextPage(3, "2", "More quetzals and a harbour."),
    )

    @Test
    @DisplayName("a word only in the PDF finds its note, with the first page it is on and that page's label")
    fun findsByPage() = world { database, index ->
        val owner = insert(database, "Birds of the coast")
        index.rebuild(database)
        index.storePdfText(7, owner, "a", book)
        assertEquals(listOf(SearchHit(owner, 2, "1")), index.searchHits("quetzals"))
        assertEquals(3, index.searchHits("harbour").first().pdfPage)
        assertEquals(listOf(owner), index.search("quetz"), "the last word is the start of a word")
        assertEquals(listOf(owner), index.search("\"lighthouse keeper\""), "a phrase")
        assertTrue(index.search("\"keeper lighthouse\"").isEmpty())
        assertTrue(index.search("lighthouse harbour").isEmpty(), "every word has to be on one page")
        assertEquals(listOf(owner), index.search("quetzals harb"))
        assertTrue(index.search("quetzal harbour").isEmpty(), "only the last word is the start of a word, as in a note's own text")
        assertTrue(index.search("quetzls").isEmpty(), "no typo tolerance in a PDF's text")
        assertEquals(listOf(SearchHit(owner)), index.searchHits("birds"), "the note's own words are found without a page")
    }

    @Test
    @DisplayName("notes found in their own text come first; a note found both ways is listed once, without a page")
    fun ownTextFirst() = world { database, index ->
        val owner = insert(database, "A book", updated = "2026-03-01T00:00:00.000Z")
        val other = insert(database, "Field notes", content = "saw quetzals today", updated = "2026-01-01T00:00:00.000Z")
        val both = insert(database, "Quetzals", updated = "2026-02-01T00:00:00.000Z")
        index.rebuild(database)
        index.storePdfText(1, owner, "a", book)
        index.storePdfText(2, both, "b", book)
        assertEquals(listOf(SearchHit(both), SearchHit(other), SearchHit(owner, 2, "1")), index.searchHits("quetzals"))
    }

    @Test
    @DisplayName("PDF hits are ordered most recently updated first, and follow the query's filters")
    fun orderAndFilters() = world { database, index ->
        val old = insert(database, "Old book", tags = "birds", updated = "2025-01-01T00:00:00.000Z")
        val new = insert(database, "New book", tags = "sea", updated = "2026-05-01T00:00:00.000Z")
        index.rebuild(database)
        index.storePdfText(1, old, "a", book)
        index.storePdfText(2, new, "b", book)
        assertEquals(listOf(new, old), index.search("quetzals"))
        assertEquals(listOf(old), index.search("quetzals tag: birds"))
        assertEquals(listOf(old), index.search("quetzals updated: <2026-01-01"))
        assertTrue(index.search("title: quetzals").isEmpty(), "a title: search is about titles")
    }

    @Test
    @DisplayName("a note in the Trash Can is not found by its PDF's text, and is again once restored")
    fun trashed() = world { database, index ->
        val owner = insert(database, "Book")
        index.rebuild(database)
        index.storePdfText(1, owner, "a", book)
        index.remove(listOf(owner))
        assertTrue(index.search("quetzals").isEmpty())
        index.rebuild(database)
        assertEquals(listOf(owner), index.search("quetzals"), "rebuilding the notes keeps the PDFs' text")
    }

    @Test
    @DisplayName("states: indexed, no text (a scan), locked, unreadable; storing again replaces")
    fun states() = world { database, index ->
        val owner = insert(database, "Book")
        index.rebuild(database)
        assertNull(index.pdfTextState(1))
        index.storePdfText(1, owner, "a", listOf(PdfTextPage(0, text = "  \n "), PdfTextPage(1, text = "")))
        assertEquals(PdfTextState.NO_TEXT, index.pdfTextState(1))
        index.markPdfText(1, owner, "a", PdfTextState.LOCKED)
        assertEquals(PdfTextState.LOCKED, index.pdfTextState(1))
        index.storePdfText(1, owner, "a", book)
        assertEquals(PdfTextState.INDEXED, index.pdfTextState(1))
        assertEquals(3L, index.pdfTextTotals().pages)
        index.storePdfText(1, owner, "a", listOf(PdfTextPage(0, text = "only cormorants")))
        assertTrue(index.search("quetzals").isEmpty(), "the old pages are gone")
        assertEquals(listOf(owner), index.search("cormorants"))
        assertEquals(1L, index.pdfTextTotals().pages)
        assertEquals(PdfTextTotalsExpected(1, 15), index.pdfTextTotals().let { PdfTextTotalsExpected(it.files, it.characters) }, "one PDF of 15 characters")
    }

    private data class PdfTextTotalsExpected(val files: Long, val characters: Long)

    @Test
    @DisplayName("the reader's find bar gets the query's phrase, or else its longest word, without filters")
    fun findText() {
        assertEquals("quetzals", PdfSearchText.findText("quetzals"))
        assertEquals("lighthouse", PdfSearchText.findText("the lighthouse keeper"))
        assertEquals("keeper", PdfSearchText.findText("keeper house"), "a tie goes to the first")
        assertEquals("lighthouse keeper", PdfSearchText.findText("old \"lighthouse   keeper\" harbour"))
        assertEquals("quetzals", PdfSearchText.findText("quetzals tag: birds"))
        assertEquals("", PdfSearchText.findText("tag: birds"))
        assertEquals("Zürich", PdfSearchText.findText("Zürich, café"))
        // a letter and its combining accent are one character, as Swift counts them: kept in the word, and counted once
        assertEquals("e\u0301e\u0301e\u0301e\u0301e\u0301", PdfSearchText.findText("e\u0301e\u0301e\u0301e\u0301e\u0301 abcd"))
        assertEquals("abcd", PdfSearchText.findText("e\u0301e\u0301e\u0301 abcd"))
    }

    @Test
    @DisplayName("reconciling forgets PDFs that are gone or changed and returns those not yet read; locked and unreadable ones wait")
    fun reconcile() = world { database, index ->
        val a = insert(database, "A")
        val b = insert(database, "B")
        val c = insert(database, "C")
        index.rebuild(database)
        index.storePdfText(1, a, "s1", book)
        index.storePdfText(2, b, "s2", book)
        index.markPdfText(3, c, "s3", PdfTextState.LOCKED)
        index.markPdfText(4, c, "s4", PdfTextState.UNREADABLE)

        val sources = listOf(
            PdfTextSource(1, a, "s1"), // unchanged
            PdfTextSource(2, b, "changed"), // a new file under the same row
            PdfTextSource(3, c, "s3"), // locked: waits for the reader
            PdfTextSource(4, c, "s4"), // unreadable: not tried again
            PdfTextSource(5, c, "s5"), // new
        )
        val toRead = index.reconcilePdfText(sources)
        assertEquals(listOf(2L, 5L), toRead.map { it.documentId })
        assertNull(index.pdfTextState(2))
        assertEquals(listOf(a), index.search("quetzals"))

        assertTrue(index.reconcilePdfText(emptyList()).isEmpty())
        assertNull(index.pdfTextState(1), "a PDF that is gone is forgotten")
        assertTrue(index.search("quetzals").isEmpty())
    }
}
