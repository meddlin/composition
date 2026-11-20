package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.pdf.InvalidMarkException
import com.rushinglabs.composition.core.pdf.PdfMarkChanges
import com.rushinglabs.composition.core.pdf.PdfMarkInput
import com.rushinglabs.composition.core.pdf.PdfMarkKind
import com.rushinglabs.composition.core.pdf.PdfRect
import com.rushinglabs.composition.core.pdf.PdfRefs
import com.rushinglabs.composition.core.pdf.PdfTextNoteBody
import com.rushinglabs.composition.core.pdf.StoredDocument
import com.rushinglabs.composition.core.pdf.addAnnotations
import com.rushinglabs.composition.core.pdf.addBookmark
import com.rushinglabs.composition.core.pdf.addDocument
import com.rushinglabs.composition.core.pdf.annotations
import com.rushinglabs.composition.core.pdf.deleteAnnotation
import com.rushinglabs.composition.core.pdf.deleteBookmark
import com.rushinglabs.composition.core.pdf.marksSearchText
import com.rushinglabs.composition.core.pdf.notesForPdf
import com.rushinglabs.composition.core.pdf.renameBookmark
import com.rushinglabs.composition.core.pdf.restoreAnnotations
import com.rushinglabs.composition.core.pdf.updateAnnotation
import com.rushinglabs.composition.core.search.SearchIndex
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// What the corpus (fixtures/conformance/pdf) does not pin, checked against what the desktop's functions do, ported from
// PdfMarkupStoreTests.swift: undo of a delete (`restoreAnnotations`), the words a PDF's note is found by (`marksSearchText`), the notes that
// cite a PDF, and the search index keeping in step with the marks (`searchIndex.ts`'s `noteToDocument`, `service.ts`'s `reindexOwnerSoon`).

@DisplayName("A PDF's marks: undo, search and citations")
class PdfMarkupStoreTests {
    private class World(val database: CompositionDatabase, val index: SearchIndex, val store: NoteStore, val note: NoteDetail, val document: StoredDocument) {
        fun highlight(page: Int = 0, quote: String = "", comment: String = "", color: String = "yellow") =
            PdfMarkInput(page, PdfMarkKind.HIGHLIGHT, color, listOf(PdfRect(72.0, 700.0, 300.0, 714.0)), quote, comment)

        fun textNote(page: Int = 0, text: String) =
            PdfMarkInput(page, PdfMarkKind.TEXT, "yellow", body = PdfTextNoteBody(PdfRect(400.0, 600.0, 560.0, 656.0), text, 12.0).json)
    }

    private fun withWorld(body: (World) -> Unit) = withScratch { scratch ->
        openDatabase(scratch).use { database ->
            SearchIndex.open(File(scratch, "search.db")).use { index ->
                val store = NoteStore(database, index)
                val note = store.createNote("Designing Data")
                val document = database.addDocument(note.id, "dd.pdf", "aaaaaaaaaaaa-dd.pdf", "a".repeat(64), 10, 20)
                index.rebuild(database)
                body(World(database, index, store, note, document))
            }
        }
    }

    // Undo of a delete ----------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a deleted mark comes back with its uuid, id, group and times, and a second restore does nothing")
    fun restore() = withWorld { w ->
        val made = w.store.addAnnotations(w.document.id, listOf(w.highlight(1, "alpha"), w.highlight(2, "beta")), Instant.ofEpochSecond(1_000))
        assertTrue(made.size == 2 && made[0].groupUuid != null && made[0].groupUuid == made[1].groupUuid)
        val removed = w.store.deleteAnnotation(made[0].id)
        assertEquals(2, removed.size, "a selection that crossed pages goes as one")
        assertTrue(w.database.annotations(w.document.id).isEmpty())

        val back = w.store.restoreAnnotations(w.document.id, removed)
        assertEquals(made, back, "exactly as they were: uuid, id, group, times")
        assertEquals(made, w.database.annotations(w.document.id))
        assertEquals(made, w.store.restoreAnnotations(w.document.id, removed), "asking twice does no harm")
        assertEquals(2, w.database.annotations(w.document.id).size)
    }

    @Test
    @DisplayName("a restored mark takes a new id when its own was taken, and keeps its uuid")
    fun restoreWhenIdIsTaken() = withWorld { w ->
        val first = w.store.addAnnotations(w.document.id, listOf(w.highlight(quote = "one")))[0]
        w.store.deleteAnnotation(first.id)
        // The table is AUTOINCREMENT, so the id is not reused; force the clash by putting another mark on it.
        w.database.file.write {
            it.execute(
                "INSERT INTO pdf_annotations (id, document_id, page, kind, color, rects, quote, comment, created_at, updated_at) VALUES (?, ?, 0, 'highlight', 'green', '[[1,1,2,2]]', 'other', '', 't', 't')",
                first.id, w.document.id,
            )
        }
        val back = w.store.restoreAnnotations(w.document.id, listOf(first))
        assertTrue(back.size == 1 && back[0].uuid == first.uuid && back[0].id != first.id)
    }

    @Test
    @DisplayName("a restore is checked like a new mark, and all of it or none is put back")
    fun restoreIsChecked() = withWorld { w ->
        val good = w.store.addAnnotations(w.document.id, listOf(w.highlight(1, "good")))[0]
        w.store.deleteAnnotation(good.id)
        assertFailsWith<InvalidMarkException> { w.store.restoreAnnotations(w.document.id, listOf(good.copy(uuid = "NOT-A-UUID"))) }
        assertFailsWith<InvalidMarkException> { w.store.restoreAnnotations(w.document.id, listOf(good.copy(createdAt = ""))) }
        assertFailsWith<InvalidMarkException> { w.store.restoreAnnotations(w.document.id, listOf(good, good.copy(page = 20))) }
        assertTrue(w.database.annotations(w.document.id).isEmpty(), "the good one was not put back alone")
    }

    // The words a PDF's note is found by --------------------------------------------------------------------------------------

    @Test
    @DisplayName("quotes, comments, text notes and bookmark labels, one a line, by page, as the desktop reads them")
    fun marksText() = withWorld { w ->
        w.store.addAnnotations(w.document.id, listOf(w.highlight(3, " later quote ", "second comment")))
        w.store.addAnnotations(w.document.id, listOf(w.highlight(1, "B-tree", "see chapter 3")))
        w.store.addAnnotations(w.document.id, listOf(w.textNote(2, "remember this")))
        w.store.addAnnotations(w.document.id, listOf(PdfMarkInput(4, PdfMarkKind.UNDERLINE, "blue", listOf(PdfRect(1.0, 1.0, 9.0, 9.0)), quote = "   ")))
        w.store.addBookmark(w.document.id, 5, "Replication")
        w.store.addBookmark(w.document.id, 6)
        val words = assertNotNull(w.database.marksSearchText(w.note.id)[w.note.id])
        assertEquals("B-tree\nsee chapter 3\nremember this\nlater quote\nsecond comment\nReplication", words)
        assertEquals(words, w.database.marksSearchText()[w.note.id], "every owner note's, for a rebuild, is the same")
    }

    @Test
    @DisplayName("a note with no marks has no entry; a damaged text-note body has no words")
    fun noWords() = withWorld { w ->
        assertTrue(w.database.marksSearchText().isEmpty())
        val other = w.store.createNote("Other")
        assertTrue(w.database.marksSearchText(other.id).isEmpty())
        val mark = w.store.addAnnotations(w.document.id, listOf(w.textNote(text = "fine")))[0]
        w.database.file.write { it.execute("UPDATE pdf_annotations SET body = '{not json' WHERE id = ?", mark.id) }
        assertTrue(w.database.marksSearchText().isEmpty())
    }

    // Search ------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("searching for a word in a highlight finds the PDF's note, and not before or after the mark exists")
    fun searchFindsTheOwner() = withWorld { w ->
        assertTrue(w.index.search("replication").isEmpty())
        val mark = w.store.addAnnotations(
            w.document.id, listOf(w.highlight(2, "Replication keeps copies of the same data on several machines", "leader and follower")),
        )[0]
        assertEquals(listOf(w.note.id), w.index.search("replication"), "a word in the quote")
        assertEquals(listOf(w.note.id), w.index.search("follower"), "a word in the comment")
        assertEquals(listOf(w.note.id), w.index.search("designing"), "its own title still finds it")

        w.store.updateAnnotation(mark.id, PdfMarkChanges(comment = "quorum reads"))
        assertTrue(w.index.search("follower").isEmpty(), "a changed comment is searched in its new words")
        assertEquals(listOf(w.note.id), w.index.search("quorum"))

        w.store.addAnnotations(w.document.id, listOf(w.textNote(4, "Tombstones")))
        assertEquals(listOf(w.note.id), w.index.search("tombstones"), "a typed note's words")

        val bookmark = w.store.addBookmark(w.document.id, 7, "Consensus")
        assertEquals(listOf(w.note.id), w.index.search("consensus"), "a bookmark's label")
        w.store.renameBookmark(bookmark.id, "Raft")
        assertTrue(w.index.search("consensus").isEmpty() && w.index.search("raft") == listOf(w.note.id))
        w.store.deleteBookmark(bookmark.id)
        assertTrue(w.index.search("raft").isEmpty())

        w.store.deleteAnnotation(mark.id)
        assertTrue(w.index.search("replication").isEmpty(), "a deleted mark is no longer searched")
        w.store.restoreAnnotations(w.document.id, listOf(mark))
        assertEquals(listOf(w.note.id), w.index.search("replication"), "undoing the delete finds it again, by the words it had when it was deleted")
    }

    @Test
    @DisplayName("editing the owner note keeps the marks' words in its entry, and a rebuild puts them in")
    fun ownerEditsAndRebuilds() = withWorld { w ->
        w.store.addAnnotations(w.document.id, listOf(w.highlight(quote = "linearizable")))
        w.store.saveNoteContent(
            w.note.id,
            NoteFrontmatter.render(Frontmatter("Designing Data", "", emptyList(), w.note.createdAt, w.note.updatedAt), "My own thoughts on storage"),
        )
        assertEquals(listOf(w.note.id), w.index.search("storage"))
        assertEquals(listOf(w.note.id), w.index.search("linearizable"), "a save does not drop the marks' words")
        w.index.rebuild(w.database)
        assertEquals(listOf(w.note.id), w.index.search("linearizable"), "nor does a rebuild")
        w.store.deleteNote(w.note.id)
        assertTrue(w.index.search("linearizable").isEmpty(), "a note in the Trash Can is not searched, marks and all")
        w.store.restoreNote(w.note.id)
        assertEquals(listOf(w.note.id), w.index.search("linearizable"), "restored, it is found by them again")
    }

    @Test
    @DisplayName("a PDF's note is not found by a word in another PDF's marks")
    fun otherPdfs() = withWorld { w ->
        val second = w.store.createNote("Second book")
        val other = w.database.addDocument(second.id, "s.pdf", "bbbbbbbbbbbb-s.pdf", "b".repeat(64), 10, 5)
        w.store.addAnnotations(other.id, listOf(w.highlight(quote = "monads")))
        assertEquals(listOf(second.id), w.index.search("monads"))
    }

    // Which notes cite a PDF --------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("the notes that cite a PDF are found by its uuid in their text, owner first")
    fun citingNotes() = withWorld { w ->
        val uuid = w.document.uuid
        val chapter = w.store.createNote("Chapter 3")
        val mark = w.store.addAnnotations(w.document.id, listOf(w.highlight(4, "data outlives code")))[0]
        val text = NoteFrontmatter.render(
            Frontmatter("Chapter 3", "", emptyList(), chapter.createdAt, chapter.updatedAt),
            PdfRefs.quoteBlock(uuid, "Designing Data", mark.quote, 5, mark.uuid),
        )
        w.store.saveNoteContent(chapter.id, text)
        w.store.createNote("Unrelated")

        val notes = w.database.notesForPdf(uuid, w.note.id)
        assertEquals(setOf(w.note.id, chapter.id), notes.map { it.id }.toSet())
        val citations = PdfRefs.citations(notes, uuid, w.note.id)
        assertTrue(citations.map { it.noteId } == listOf(w.note.id, chapter.id) && citations[0].owner)
        assertTrue(citations[1].pages == listOf(5) && citations[1].marks == listOf(mark.uuid))
    }
}
