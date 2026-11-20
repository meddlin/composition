package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.pdf.PdfMark
import com.rushinglabs.composition.core.pdf.PdfMarkGeometry
import com.rushinglabs.composition.core.pdf.PdfMarkInput
import com.rushinglabs.composition.core.pdf.PdfMarkKind
import com.rushinglabs.composition.core.pdf.PdfRect
import com.rushinglabs.composition.core.pdf.PdfTextNoteBody
import com.rushinglabs.composition.core.pdf.addAnnotations
import com.rushinglabs.composition.core.pdf.addDocument
import com.rushinglabs.composition.core.pdf.boxes
import com.rushinglabs.composition.core.pdf.textNote
import com.rushinglabs.composition.core.pdf.union
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Where a mark is on its page and which mark a tap lands on, from the stored rectangles alone (the desktop's `boxesOf` and `markAt`),
// ported from PdfMarkGeometryTests.swift.

@DisplayName("Marks on the page: boxes, taps and a new note's box")
class PdfMarkGeometryTests {
    private fun marks(body: (List<PdfMark>) -> Unit) = withScratch { scratch ->
        openDatabase(scratch).use { database ->
            val store = NoteStore(database)
            val note = store.createNote("Book")
            val document = database.addDocument(note.id, "b.pdf", "aaaaaaaaaaaa-b.pdf", "a".repeat(64), 1, 5)
            val first = store.addAnnotations(
                document.id, listOf(PdfMarkInput(0, PdfMarkKind.HIGHLIGHT, "yellow", listOf(PdfRect(100.0, 300.0, 200.0, 318.0), PdfRect(100.0, 282.0, 160.0, 300.0)), quote = "two lines")),
            )
            val second = store.addAnnotations(document.id, listOf(PdfMarkInput(0, PdfMarkKind.UNDERLINE, "blue", listOf(PdfRect(150.0, 300.0, 250.0, 318.0)), quote = "over")))
            val note2 = store.addAnnotations(
                document.id, listOf(PdfMarkInput(0, PdfMarkKind.TEXT, "pink", body = PdfTextNoteBody(PdfRect(400.0, 500.0, 600.0, 556.0), "hello", 12.0).json)),
            )
            body(first + second + note2)
        }
    }

    @Test
    @DisplayName("a mark's boxes are its lines, or its note's box, and the union holds them all")
    fun boxes() = marks { all ->
        assertTrue(all[0].boxes.size == 2 && all[0].union == PdfRect(100.0, 282.0, 200.0, 318.0))
        assertTrue(all[2].boxes == listOf(PdfRect(400.0, 500.0, 600.0, 556.0)) && all[2].textNote?.text == "hello" && all[0].textNote == null)
    }

    @Test
    @DisplayName("a tap finds the mark under it, the latest where two overlap, with a little room at the edge")
    fun taps() = marks { all ->
        assertEquals(all[0].id, PdfMarkGeometry.markAt(120.0, 290.0, all)?.id, "the second line of the highlight")
        assertEquals(all[1].id, PdfMarkGeometry.markAt(170.0, 310.0, all)?.id, "where the underline lies over the highlight, the one made last")
        assertEquals(all[0].id, PdfMarkGeometry.markAt(120.0, 310.0, all)?.id)
        assertEquals(all[2].id, PdfMarkGeometry.markAt(500.0, 520.0, all)?.id, "a typed note")
        assertEquals(all[0].id, PdfMarkGeometry.markAt(98.5, 305.0, all)?.id, "two points past the edge still counts")
        assertNull(PdfMarkGeometry.markAt(97.0, 305.0, all))
        assertTrue(PdfMarkGeometry.markAt(10.0, 10.0, all) == null && PdfMarkGeometry.markAt(1.0, 1.0, emptyList()) == null)
        assertNull(PdfMarkGeometry.markAt(170.0, 292.0, all), "inside the union of the two lines, but on no line")
    }

    @Test
    @DisplayName("a new note's top-left corner is the tap, kept inside the page")
    fun newNoteBox() {
        assertEquals(PdfRect(100.0, 644.0, 300.0, 700.0), PdfMarkGeometry.noteBox(100.0, 700.0, 612.0, 792.0))
        assertEquals(612.0, PdfMarkGeometry.noteBox(500.0, 700.0, 612.0, 792.0).x1, "moved in from the right edge")
        assertEquals(0.0, PdfMarkGeometry.noteBox(-20.0, 700.0, 612.0, 792.0).x0)
        assertEquals(0.0, PdfMarkGeometry.noteBox(50.0, 10.0, 612.0, 792.0).y0, "moved up from the bottom edge")
        assertEquals(792.0, PdfMarkGeometry.noteBox(50.0, 900.0, 612.0, 792.0).y1)
        assertEquals(PdfRect(500.0, -46.0, 700.0, 10.0), PdfMarkGeometry.noteBox(500.0, 10.0, 0.0, 0.0), "with no page size it is where the tap was")
    }
}
