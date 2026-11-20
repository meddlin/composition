package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.pdf.InvalidMarkException
import com.rushinglabs.composition.core.pdf.PdfInkGeometry
import com.rushinglabs.composition.core.pdf.PdfMarkEditor
import com.rushinglabs.composition.core.pdf.PdfMarkInput
import com.rushinglabs.composition.core.pdf.PdfMarkKind
import com.rushinglabs.composition.core.pdf.PdfRect
import com.rushinglabs.composition.core.pdf.StoredDocument
import com.rushinglabs.composition.core.pdf.addAnnotations
import com.rushinglabs.composition.core.pdf.addDocument
import com.rushinglabs.composition.core.pdf.annotations
import com.rushinglabs.composition.core.pdf.deleteDocument
import com.rushinglabs.composition.core.pdf.forEachInk
import com.rushinglabs.composition.core.pdf.inkBody
import com.rushinglabs.composition.core.pdf.inkPages
import com.rushinglabs.composition.core.pdf.marksSearchText
import com.rushinglabs.composition.core.pdf.setInk
import com.rushinglabs.composition.core.search.SearchIndex
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Ink on a PDF, ported from PdfInkStoreTests.swift: one record per page, kept out of the list of marks, out of the words a PDF's note is
// found by, and gone with the PDF. The strokes are opaque text here (the ink format is its own slice).

@DisplayName("A PDF's ink")
class PdfInkStoreTests {
    private class World(val database: CompositionDatabase, val index: SearchIndex, val store: NoteStore, val note: NoteDetail, val document: StoredDocument) {
        fun strokes(tag: String) = """{"format":"composition-ink","version":1,"canvas":{"width":612,"height":792},"strokes":[],"tag":"$tag"}"""
    }

    private fun withWorld(body: (World) -> Unit) = withScratch { scratch ->
        openDatabase(scratch).use { database ->
            SearchIndex.open(File(scratch, "search.db")).use { index ->
                val store = NoteStore(database, index)
                val note = store.createNote("Sketchbook")
                val document = database.addDocument(note.id, "s.pdf", "aaaaaaaaaaaa-s.pdf", "a".repeat(64), 10, 6)
                index.rebuild(database)
                body(World(database, index, store, note, document))
            }
        }
    }

    @Test
    @DisplayName("a page's ink is one record: made, replaced in place, and taken away")
    fun oneRecordPerPage() = withWorld { w ->
        assertTrue(w.database.inkPages(w.document.id).isEmpty())
        assertNull(w.database.inkBody(w.document.id, 2))

        assertTrue(w.store.setInk(w.document.id, 2, w.strokes("one")))
        val first = w.database.annotations(w.document.id).first()
        assertTrue(first.kind == PdfMarkKind.INK && first.page == 2 && first.rects == null && first.quote.isEmpty() && first.comment.isEmpty())
        assertEquals(w.strokes("one"), w.database.inkBody(w.document.id, 2))

        assertTrue(w.store.setInk(w.document.id, 2, w.strokes("two"), now = Instant.ofEpochSecond(5_000)))
        val all = w.database.annotations(w.document.id)
        assertEquals(1, all.size, "the second save replaced the first")
        assertTrue(all[0].id == first.id && all[0].uuid == first.uuid && all[0].createdAt == first.createdAt, "the same record: its uuid and the time it was made stay")
        assertTrue(all[0].updatedAt != first.updatedAt)
        assertEquals(w.strokes("two"), w.database.inkBody(w.document.id, 2))

        assertTrue(w.store.setInk(w.document.id, 4, w.strokes("page five")))
        assertEquals(listOf(2, 4), w.database.inkPages(w.document.id).keys.sorted())

        assertFalse(w.store.setInk(w.document.id, 2, null))
        assertEquals(listOf(4), w.database.inkPages(w.document.id).keys.sorted(), "a page with no strokes left has no record")
        assertFalse(w.store.setInk(w.document.id, 2, null), "taking away what is not there does nothing")
    }

    @Test
    @DisplayName("a merge that left two records on a page is healed by the next save: the newest is kept")
    fun duplicates() = withWorld { w ->
        for (tag in listOf("old", "new")) {
            w.database.file.write {
                it.execute(
                    "INSERT INTO pdf_annotations (document_id, page, kind, color, quote, comment, body, created_at, updated_at) VALUES (?, 1, 'ink', 'ink', '', '', ?, 't', 't')",
                    w.document.id, w.strokes(tag),
                )
            }
        }
        assertEquals(w.strokes("new"), w.database.inkBody(w.document.id, 1), "reads the newest")
        w.store.setInk(w.document.id, 1, w.strokes("healed"))
        assertEquals(1, w.database.annotations(w.document.id).size)
        assertEquals(w.strokes("healed"), w.database.inkBody(w.document.id, 1))
    }

    @Test
    @DisplayName("ink is checked like a mark: a page the PDF has, and strokes as a JSON object")
    fun checks() = withWorld { w ->
        assertFailsWith<InvalidMarkException> { w.store.setInk(w.document.id, 6, w.strokes("past the end")) }
        assertFailsWith<InvalidMarkException> { w.store.setInk(w.document.id, -1, w.strokes("before the start")) }
        assertFailsWith<InvalidMarkException> { w.store.setInk(w.document.id, 0, "[1,2,3]") }
        assertFailsWith<InvalidMarkException> { w.store.setInk(w.document.id, 0, "") }
        assertFailsWith<InvalidMarkException> { w.store.setInk(9_999, 0, w.strokes("no such PDF")) }
        assertTrue(w.database.annotations(w.document.id).isEmpty(), "nothing was written")
        assertTrue(w.store.setInk(w.document.id, 5, " \n" + w.strokes("leading space")), "the last page, and whitespace before the object")
    }

    @Test
    @DisplayName("the marks the reader holds leave the strokes out; the whole list still has them")
    fun outOfTheList() = withWorld { w ->
        val highlight = PdfMarkInput(0, PdfMarkKind.HIGHLIGHT, "yellow", listOf(PdfRect(72.0, 700.0, 300.0, 714.0)), quote = "alpha")
        w.store.addAnnotations(w.document.id, listOf(highlight))
        w.store.setInk(w.document.id, 0, w.strokes("on the same page"))
        val marks = PdfMarkEditor(w.store, w.document.id).state.marks
        assertEquals(listOf(PdfMarkKind.HIGHLIGHT), marks.map { it.kind }, "no ink in the editor's list")
        assertEquals(listOf(PdfMarkKind.HIGHLIGHT), w.database.annotations(w.document.id, withInk = false).map { it.kind })
        assertEquals(listOf(PdfMarkKind.HIGHLIGHT, PdfMarkKind.INK), w.database.annotations(w.document.id).map { it.kind }, "the whole list, as the corpus reads it")
        assertEquals(1, w.database.annotations(w.document.id, page = 0, withInk = false).size)
    }

    @Test
    @DisplayName("ink has no words: a PDF's note is not found by it, nor changed by it")
    fun noWords() = withWorld { w ->
        val entry = w.index.search("sketchbook")
        w.store.setInk(w.document.id, 3, w.strokes("composition-ink"))
        assertTrue(w.database.marksSearchText().isEmpty())
        assertTrue(w.index.search("composition").isEmpty(), "the strokes' own text is not searched")
        assertEquals(entry, w.index.search("sketchbook"))
    }

    @Test
    @DisplayName("each page's ink is handed over in page order, one at a time")
    fun forEach() = withWorld { w ->
        for (page in listOf(4, 0, 2)) w.store.setInk(w.document.id, page, w.strokes("p$page"))
        val seen = ArrayList<Pair<Int, String>>()
        w.database.forEachInk(w.document.id) { page, json -> seen.add(page to json) }
        assertEquals(listOf(0, 2, 4), seen.map { it.first })
        assertEquals(listOf(w.strokes("p0"), w.strokes("p2"), w.strokes("p4")), seen.map { it.second })
    }

    @Test
    @DisplayName("ink goes with its PDF, as its other marks do")
    fun goesWithThePdf() = withWorld { w ->
        w.store.setInk(w.document.id, 1, w.strokes("kept"))
        w.database.deleteDocument(w.document.id)
        assertTrue(w.database.inkPages(w.document.id).isEmpty(), "the PDF's delete took its ink with it")
    }

    @Test
    @DisplayName("a canvas point is a point of the crop box from its top-left corner, y down")
    fun geometry() {
        val plain = PdfInkGeometry.Box(0.0, 0.0, 612.0, 792.0)
        assertEquals(PdfInkGeometry.Point(0.0, 792.0), PdfInkGeometry.userSpace(0.0, 0.0, plain))
        assertEquals(PdfInkGeometry.Point(612.0, 0.0), PdfInkGeometry.userSpace(612.0, 792.0, plain))
        val offset = PdfInkGeometry.Box(40.0, 30.0, 400.0, 500.0)
        val there = PdfInkGeometry.userSpace(100.0, 50.0, offset)
        assertEquals(PdfInkGeometry.Point(140.0, 480.0), there)
        assertEquals(PdfInkGeometry.Point(100.0, 50.0), PdfInkGeometry.canvas(there.x, there.y, offset))
    }
}
