package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.pdf.InvalidMarkException
import com.rushinglabs.composition.core.pdf.PdfMarkChanges
import com.rushinglabs.composition.core.pdf.PdfMarkEditor
import com.rushinglabs.composition.core.pdf.PdfMarkInput
import com.rushinglabs.composition.core.pdf.PdfMarkKind
import com.rushinglabs.composition.core.pdf.PdfRect
import com.rushinglabs.composition.core.pdf.PdfTextNoteBody
import com.rushinglabs.composition.core.pdf.addDocument
import com.rushinglabs.composition.core.pdf.textNote
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// Undo and redo of a PDF's marks, as the desktop's `documentMarks.ts` has them, ported from PdfMarkEditorTests.swift: create, delete and
// change are steps, 200 deep, in memory; a new change ends redo; undoing a delete brings the mark back with its uuid.

@DisplayName("Undo and redo of a PDF's marks")
class PdfMarkEditorTests {
    private fun withEditor(body: (PdfMarkEditor) -> Unit) = withScratch { scratch ->
        openDatabase(scratch).use { database ->
            val store = NoteStore(database)
            val note = store.createNote("Book")
            val document = database.addDocument(note.id, "b.pdf", "aaaaaaaaaaaa-b.pdf", "a".repeat(64), 1, 30)
            body(PdfMarkEditor(store, document.id))
        }
    }

    private fun highlight(page: Int = 0, quote: String = "words") =
        PdfMarkInput(page, PdfMarkKind.HIGHLIGHT, "yellow", listOf(PdfRect(72.0, 700.0, 300.0, 714.0)), quote = quote)

    @Test
    @DisplayName("a mark made can be undone and redone, and comes back as the same mark")
    fun createAndUndo() = withEditor { editor ->
        var state = editor.state
        assertTrue(state.marks.isEmpty() && !state.canUndo && !state.canRedo)
        state = editor.add(listOf(highlight()))
        val made = state.marks.first()
        assertTrue(state.canUndo && !state.canRedo)
        state = editor.undo()
        assertTrue(state.marks.isEmpty() && !state.canUndo && state.canRedo)
        state = editor.redo()
        assertEquals(listOf(made), state.marks, "the same uuid, id and times")
        assertTrue(state.canUndo && !state.canRedo)
    }

    @Test
    @DisplayName("a deleted mark comes back with its uuid, so a note's citation of it works again")
    fun deleteAndUndo() = withEditor { editor ->
        val made = editor.add(listOf(highlight(1), highlight(2))).marks.first()
        var state = editor.delete(made.id)
        assertTrue(state.marks.isEmpty(), "a selection over two pages goes as one")
        state = editor.undo()
        assertTrue(state.marks.size == 2 && state.marks[0].uuid == made.uuid && state.marks[0].groupUuid == state.marks[1].groupUuid)
        state = editor.undo()
        assertTrue(state.marks.isEmpty(), "the undo before that took back the making")
        state = editor.redo()
        assertEquals(2, state.marks.size)
        state = editor.redo()
        assertTrue(state.marks.isEmpty(), "and the delete is done again")
    }

    @Test
    @DisplayName("a recoloured mark, a new comment and a retyped note are undone and redone")
    fun changes() = withEditor { editor ->
        var state = editor.add(listOf(highlight()))
        val id = state.marks[0].id
        editor.update(id, PdfMarkChanges(color = "blue"))
        state = editor.update(id, PdfMarkChanges(comment = "check this"))
        assertTrue(state.marks[0].color == "blue" && state.marks[0].comment == "check this")
        state = editor.undo()
        assertTrue(state.marks[0].color == "blue" && state.marks[0].comment == "")
        state = editor.undo()
        assertEquals("yellow", state.marks[0].color)
        editor.redo()
        state = editor.redo()
        assertTrue(state.marks[0].color == "blue" && state.marks[0].comment == "check this")

        val note = PdfTextNoteBody(PdfRect(100.0, 100.0, 300.0, 156.0), "first", 12.0)
        state = editor.add(listOf(PdfMarkInput(3, PdfMarkKind.TEXT, "pink", body = note.json)))
        val noteId = state.marks.last { it.kind == PdfMarkKind.TEXT }.id
        state = editor.update(noteId, PdfMarkChanges(body = note.copy(text = "second").json))
        assertEquals("second", state.marks.last { it.kind == PdfMarkKind.TEXT }.textNote?.text)
        state = editor.undo()
        assertEquals("first", state.marks.last { it.kind == PdfMarkKind.TEXT }.textNote?.text)
        state = editor.redo()
        assertEquals("second", state.marks.last { it.kind == PdfMarkKind.TEXT }.textNote?.text)
    }

    @Test
    @DisplayName("a change that changes nothing is no step, and a new change ends redo")
    fun noOpAndRedoEnds() = withEditor { editor ->
        var state = editor.add(listOf(highlight()))
        val id = state.marks[0].id
        editor.update(id, PdfMarkChanges(color = "yellow"))
        state = editor.undo()
        assertTrue(state.marks.isEmpty(), "the first undo took back the making: the colour 'change' was not a step")
        assertTrue(state.canRedo)
        state = editor.add(listOf(highlight(5)))
        assertFalse(state.canRedo, "a new mark ends redo")
        state = editor.redo()
        assertEquals(1, state.marks.size, "redo with nothing to redo does nothing")
    }

    @Test
    @DisplayName("only the last 200 steps are kept")
    fun depth() = withEditor { editor ->
        var state = editor.state
        for (page in 0 until PdfMarkEditor.DEPTH + 10) state = editor.add(listOf(highlight(page % 30)))
        assertEquals(PdfMarkEditor.DEPTH + 10, state.marks.size)
        repeat(PdfMarkEditor.DEPTH + 50) { state = editor.undo() }
        assertTrue(state.marks.size == 10 && !state.canUndo, "200 were taken back and the earlier 10 stay")
    }

    @Test
    @DisplayName("a refused mark makes no step, and a missing mark is not an error")
    fun refusals() = withEditor { editor ->
        assertFailsWith<InvalidMarkException> { editor.add(listOf(PdfMarkInput(0, PdfMarkKind.HIGHLIGHT, "plaid", listOf(PdfRect(1.0, 1.0, 9.0, 9.0))))) }
        assertFailsWith<InvalidMarkException> { editor.add(listOf(highlight(99))) }
        var state = editor.state
        assertTrue(state.marks.isEmpty() && !state.canUndo)
        state = editor.delete(12345)
        assertFalse(state.canUndo)
    }
}
