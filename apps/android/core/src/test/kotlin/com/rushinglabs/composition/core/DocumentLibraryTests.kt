package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.pdf.DocumentException
import com.rushinglabs.composition.core.pdf.DocumentLibrary
import com.rushinglabs.composition.core.pdf.DocumentNames
import com.rushinglabs.composition.core.pdf.ExistingPdf
import com.rushinglabs.composition.core.pdf.ImportDocumentResult
import com.rushinglabs.composition.core.pdf.ImportPdfOutcome
import com.rushinglabs.composition.core.pdf.PdfMarkInput
import com.rushinglabs.composition.core.pdf.PdfMarkKind
import com.rushinglabs.composition.core.pdf.PdfRect
import com.rushinglabs.composition.core.pdf.PdfViewState
import com.rushinglabs.composition.core.pdf.StoredDocument
import com.rushinglabs.composition.core.pdf.addAnnotation
import com.rushinglabs.composition.core.pdf.addBookmark
import com.rushinglabs.composition.core.pdf.annotations
import com.rushinglabs.composition.core.pdf.bookmarks
import com.rushinglabs.composition.core.pdf.document
import com.rushinglabs.composition.core.pdf.documentForNote
import com.rushinglabs.composition.core.pdf.documents
import com.rushinglabs.composition.core.pdf.setPageCount
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

// The PDFs' files and what joins a file to its row, case by case as the desktop's `documents.test.ts` has them (the same inputs and the
// same words), against real files in a scratch folder. Ported from DocumentLibraryTests.swift.

@DisplayName("PDF files and their rows")
class DocumentLibraryTests {
    /** A data directory and an inbox to import from, both removed when the test is done. */
    private class Setup(scratch: File) {
        val location = DataLocation(File(scratch, "data"))
        val inbox = File(scratch, "inbox").also { it.mkdirs() }
        val database = CompositionDatabase.open(location)
        val store = NoteStore(database)
        val library = DocumentLibrary(store, location)

        fun write(name: String, content: ByteArray = pdf()): File = File(inbox, name).also { it.writeBytes(content) }

        fun note(title: String): NoteDetail = store.createNote(title)

        /** What is in `documents/`, hidden half-copies included, sorted. */
        val storedFiles: List<String> get() = location.documentsDirectory.list()?.sorted() ?: emptyList()
    }

    private companion object {
        fun pdf(extra: String = ""): ByteArray = "%PDF-1.7\n$extra\n%%EOF\n".toByteArray()

        fun hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(java.util.Locale.ROOT, it) }

        fun sha256(file: File): String = hex(file.readBytes())
    }

    private fun withSetup(body: (Setup) -> Unit) = withScratch { scratch ->
        val setup = Setup(scratch)
        setup.database.use { body(setup) }
    }

    private fun added(result: ImportDocumentResult): StoredDocument =
        (result as? ImportDocumentResult.Added)?.document ?: fail("expected the PDF to be added, got $result")

    // importDocument --------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("copies the PDF into the data directory and gives it to the note, leaving the original where it was")
    fun copiesIn() = withSetup { setup ->
        val note = setup.note("Textbook")
        val bytes = pdf("one")
        val file = setup.write("Designing Data.pdf", bytes)

        val document = added(setup.library.importDocument(note.id, file, pageCount = 12))

        assertEquals(listOf(note.id, "Designing Data.pdf", bytes.size.toLong(), 12, PdfViewState()), listOf(document.noteId, document.fileName, document.size, document.pageCount, document.viewState))
        assertTrue(document.sha256 == hex(bytes) && isUuid(document.uuid))
        assertEquals(listOf(document.storedName), setup.storedFiles)
        assertTrue(Regex("^[0-9a-f]{12}-Designing_Data\\.pdf\\z").containsMatchIn(document.storedName), document.storedName)
        assertTrue(File(setup.location.documentsDirectory, document.storedName).readBytes().contentEquals(bytes))
        assertTrue(file.exists(), "the original is left alone")
        assertEquals(document, setup.database.documentForNote(note.id))
    }

    @Test
    @DisplayName("does not know the page count until the reader has counted them")
    fun pageCountComesLater() = withSetup { setup ->
        val note = setup.note("A")
        val document = added(setup.library.importDocument(note.id, setup.write("a.pdf")))
        assertEquals(0, document.pageCount)
        setup.database.setPageCount(document.id, 41)
        assertEquals(41, setup.database.document(document.id)?.pageCount)
        assertFailsWith<DocumentException.InvalidPageCount> { setup.database.setPageCount(document.id, 0) }
    }

    @Test
    @DisplayName("accepts a PDF with a little junk before the header")
    fun acceptsJunk() = withSetup { setup ->
        val note = setup.note("A")
        added(setup.library.importDocument(note.id, setup.write("junk.pdf", ByteArray(900) { 0x20 } + pdf())))
    }

    @Test
    @DisplayName("refuses a file that is not a PDF, and leaves nothing behind")
    fun refusesNonPdfs() = withSetup { setup ->
        val note = setup.note("A")
        val files = listOf(
            setup.write("notes.txt", "just text".toByteArray()), setup.write("zipped.pdf", byteArrayOf(0x1f, 0x8b.toByte(), 8, 0, 1, 2, 3)),
            setup.write("empty.pdf", ByteArray(0)), setup.write("late.pdf", ByteArray(1100) { 0x20 } + pdf()),
        )
        for (file in files) {
            assertEquals(ImportDocumentResult.Refused("${file.name}: this doesn't look like a PDF."), setup.library.importDocument(note.id, file), file.name)
        }
        assertTrue(setup.storedFiles.isEmpty())
    }

    @Test
    @DisplayName("refuses a folder, a file over the size limit and a file that is not there, by name")
    fun refusesTheRest() = withSetup { setup ->
        val note = setup.note("A")
        val folder = File(setup.inbox, "chapters.pdf").also { it.mkdirs() }
        assertEquals(ImportDocumentResult.Refused("chapters.pdf: only files can be imported, not folders."), setup.library.importDocument(note.id, folder))

        val big = setup.write("big.pdf", ByteArray(0))
        RandomAccessFile(big, "rw").use { it.setLength(DocumentNames.MAX_BYTES + 1) } // sparse, so no real disk is used
        assertEquals(ImportDocumentResult.Refused("big.pdf: files can be at most 1 GB."), setup.library.importDocument(note.id, big))

        assertEquals(ImportDocumentResult.Refused("gone.pdf: could not be read."), setup.library.importDocument(note.id, File(setup.inbox, "gone.pdf")))
        assertTrue(setup.storedFiles.isEmpty())
    }

    @Test
    @DisplayName("refuses a note that already has a PDF and a note that no longer exists")
    fun refusesBadOwners() = withSetup { setup ->
        val note = setup.note("A")
        added(setup.library.importDocument(note.id, setup.write("first.pdf", pdf("1"))))
        assertEquals(ImportDocumentResult.Refused("That note already has a PDF."), setup.library.importDocument(note.id, setup.write("second.pdf", pdf("2"))))
        assertEquals(ImportDocumentResult.Refused("That note no longer exists."), setup.library.importDocument(9999, setup.write("third.pdf", pdf("3"))))
        assertEquals(1, setup.storedFiles.size, "no copy and no half-copy stays")
    }

    @Test
    @DisplayName("offers the PDF you already have when the same bytes come in again, copying nothing, and imports a separate copy when asked")
    fun duplicates() = withSetup { setup ->
        val note = setup.note("First reading")
        val other = setup.note("Second reading")
        val first = added(setup.library.importDocument(note.id, setup.write("book.pdf")))

        val again = setup.library.importDocument(other.id, setup.write("book copy.pdf"))
        assertEquals(ImportDocumentResult.Duplicate(listOf(first)), again)
        assertEquals(listOf(first.storedName), setup.storedFiles, "nothing was copied, and no hidden half-copy is left")

        val copy = added(setup.library.importDocument(other.id, setup.write("book copy.pdf"), allowDuplicate = true))
        assertEquals(2, setup.storedFiles.size)
        assertEquals(listOf(note.id, other.id), setup.database.documents(copy.sha256).map { it.noteId })
    }

    @Test
    @DisplayName("a file is copied whole, in pieces, whatever its size")
    fun copiesBigFiles() = withSetup { setup ->
        val note = setup.note("A")
        // a little over three chunks, so the last one is a short one, each piece a different byte so that a piece lost or moved shows
        var bytes = pdf()
        for (piece in 1..3) bytes += ByteArray(DocumentLibrary.CHUNK_SIZE) { piece.toByte() }
        bytes += ByteArray(12_345) { 0x7f }
        val source = setup.write("big.pdf", bytes)
        val document = added(setup.library.importDocument(note.id, source))
        assertTrue(document.size == bytes.size.toLong() && document.sha256 == sha256(source))
        assertEquals(document.sha256, sha256(File(setup.location.documentsDirectory, document.storedName)))
    }

    // documentFile, removeDocument ------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a PDF's file is found by its id, and not when the row or the file is gone or its stored name is not one the app made")
    fun findsFiles() = withSetup { setup ->
        val note = setup.note("A")
        val document = added(setup.library.importDocument(note.id, setup.write("a.pdf")))
        val found = assertNotNull(setup.library.documentFile(document.id))
        assertTrue(found.file == File(setup.location.documentsDirectory, document.storedName) && found.document == document)
        assertNull(setup.library.documentFile(9999))

        // a row from a backup that names a file outside the folder is not followed
        setup.database.file.write { it.execute("UPDATE documents SET stored_name = '../composition.db' WHERE id = ?", document.id) }
        assertNull(setup.library.documentFile(document.id))
        assertTrue(setup.library.removeDocument(document.id))
        assertTrue(setup.location.databaseFile.exists(), "the database was not removed")

        File(setup.location.documentsDirectory, document.storedName).delete()
    }

    @Test
    @DisplayName("a file deleted behind the app's back is not found")
    fun missingFile() = withSetup { setup ->
        val note = setup.note("A")
        val document = added(setup.library.importDocument(note.id, setup.write("a.pdf")))
        File(setup.location.documentsDirectory, document.storedName).delete()
        assertNull(setup.library.documentFile(document.id))
    }

    @Test
    @DisplayName("removing a PDF deletes its row, marks, bookmarks and file, and only that PDF's; and says so when there is none")
    fun removesOne() = withSetup { setup ->
        val note = setup.note("Mine")
        val other = setup.note("Other")
        val mine = added(setup.library.importDocument(note.id, setup.write("mine.pdf", pdf("mine"))))
        val theirs = added(setup.library.importDocument(other.id, setup.write("theirs.pdf", pdf("theirs"))))
        for (document in listOf(mine, theirs)) {
            setup.database.addAnnotation(document.id, PdfMarkInput(0, PdfMarkKind.HIGHLIGHT, "yellow", listOf(PdfRect(0.0, 0.0, 1.0, 1.0))))
            setup.database.addBookmark(document.id, 0, "start")
        }

        assertTrue(setup.library.removeDocument(mine.id))

        assertTrue(setup.database.annotations(mine.id).isEmpty() && setup.database.bookmarks(mine.id).isEmpty())
        assertTrue(setup.database.annotations(theirs.id).size == 1 && setup.database.bookmarks(theirs.id).size == 1)
        assertEquals(listOf(theirs.storedName), setup.storedFiles)
        assertFalse(setup.library.removeDocument(9999))
    }

    // A note's PDF through the Trash Can ------------------------------------------------------------------------------------------

    private class Owned(val note: NoteDetail, val other: NoteDetail, val mine: StoredDocument, val theirs: StoredDocument)

    private fun noteWithPdf(setup: Setup): Owned {
        val note = setup.note("Textbook")
        val other = setup.note("Other")
        val mine = added(setup.library.importDocument(note.id, setup.write("mine.pdf", pdf("mine")), pageCount = 5))
        val theirs = added(setup.library.importDocument(other.id, setup.write("theirs.pdf", pdf("theirs")), pageCount = 5))
        setup.database.addAnnotation(mine.id, PdfMarkInput(2, PdfMarkKind.HIGHLIGHT, "green", listOf(PdfRect(0.0, 0.0, 9.0, 9.0)), quote = "kept"))
        setup.database.addBookmark(mine.id, 3, "later")
        return Owned(note, other, mine, theirs)
    }

    @Test
    @DisplayName("keeps the file and the markup while the note is in the Trash Can, and finds them again when it is restored")
    fun followsItsNote() = withSetup { setup ->
        val owned = noteWithPdf(setup)
        setup.store.deleteNote(owned.note.id)
        assertEquals(owned.mine.id, setup.database.documentForNote(owned.note.id)?.id)
        assertTrue(setup.database.annotations(owned.mine.id).size == 1 && setup.database.bookmarks(owned.mine.id).size == 1)
        assertEquals(2, setup.storedFiles.size)

        // a sweep while it sits in the Trash Can leaves it alone
        setup.library.removeOrphans()
        assertEquals(2, setup.storedFiles.size)

        setup.store.restoreNote(owned.note.id)
        assertEquals(owned.mine, setup.database.documentForNote(owned.note.id))
        assertEquals(listOf("kept"), setup.database.annotations(owned.mine.id).map { it.quote })
        assertEquals(2, setup.storedFiles.size)
    }

    @Test
    @DisplayName("deletes the file, the marks and the bookmarks, and only them, when the note is permanently deleted")
    fun goesWithItsNote() = withSetup { setup ->
        val owned = noteWithPdf(setup)
        setup.store.deleteNote(owned.note.id)

        setup.library.permanentlyDeleteNote(owned.note.id)

        assertNull(setup.database.document(owned.mine.id))
        assertTrue(setup.database.annotations(owned.mine.id).isEmpty() && setup.database.bookmarks(owned.mine.id).isEmpty())
        assertEquals(listOf(owned.theirs.storedName), setup.storedFiles)
        assertNotNull(setup.database.document(owned.theirs.id))
    }

    @Test
    @DisplayName("deletes them when the note outlives the Trash Can's retention window, and keeps one still inside it")
    fun goesWhenExpired() = withSetup { setup ->
        val owned = noteWithPdf(setup)
        setup.store.deleteNote(owned.note.id)
        setup.store.deleteNote(owned.other.id)
        setup.database.file.write { it.execute("UPDATE trashed_notes SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", owned.note.id) }

        setup.library.purgeExpiredTrash()

        assertNull(setup.database.document(owned.mine.id))
        assertNotNull(setup.database.document(owned.theirs.id))
        assertEquals(listOf(owned.theirs.storedName), setup.storedFiles)
    }

    @Test
    @DisplayName("leaves a live note's PDF alone when the trash is cleaned")
    fun liveNotesStay() = withSetup { setup ->
        val owned = noteWithPdf(setup)
        setup.library.purgeExpiredTrash()
        setup.library.removeOrphans()
        assertTrue(setup.database.document(owned.mine.id) != null && setup.storedFiles.size == 2)
    }

    @Test
    @DisplayName("sweeps the PDF of a note deleted for good behind the app's back, and the marks of a PDF already gone")
    fun sweeps() = withSetup { setup ->
        val owned = noteWithPdf(setup)
        setup.database.file.write { it.execute("DELETE FROM notes WHERE id = ?", owned.note.id) }

        setup.library.removeOrphans()

        assertTrue(setup.database.document(owned.mine.id) == null && setup.database.annotations(owned.mine.id).isEmpty())
        assertEquals(listOf(owned.theirs.storedName), setup.storedFiles)

        setup.database.file.write { it.execute("DELETE FROM documents WHERE id = ?", owned.theirs.id) }
        setup.library.removeOrphans()
        assertTrue(setup.database.bookmarks(owned.theirs.id).isEmpty())
    }

    // importPdf -------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("makes a note titled from the file's name, in the group asked for, and gives the PDF to it")
    fun importsAsANote() = withSetup { setup ->
        val notebook = setup.database.listNotebooks().first().id
        val group = setup.database.createGroup("Reading", notebookId = notebook)
        val outcome = setup.library.importPdf(setup.write("Designing_Data_Intensive.pdf"), groupId = group.id)

        val added = outcome as? ImportPdfOutcome.Added ?: fail("expected the PDF to be added, got $outcome")
        assertTrue(added.note.title == "Designing Data Intensive" && added.note.groupId == group.id)
        assertTrue(added.document.noteId == added.note.id && added.document.fileName == "Designing_Data_Intensive.pdf")
        assertEquals("Designing Data Intensive", setup.database.note(added.note.id)?.title)
    }

    @Test
    @DisplayName("leaves no note and no file behind when the file is refused or is a duplicate, and names the note that owns the duplicate")
    fun importLeavesNothing() = withSetup { setup ->
        val notes = setup.database.listNotes().size

        val refused = setup.library.importPdf(setup.write("notes.txt", "just text".toByteArray()))
        assertEquals(ImportPdfOutcome.Refused("notes.txt: this doesn't look like a PDF."), refused)
        assertTrue(setup.database.listNotes().size == notes && setup.database.listTrash().notes.isEmpty(), "the note was never shown, so it is not in the Trash Can either")

        val first = setup.library.importPdf(setup.write("book.pdf")) as? ImportPdfOutcome.Added ?: fail("expected the PDF to be added")
        val again = setup.library.importPdf(setup.write("book again.pdf"))
        assertEquals(ImportPdfOutcome.Duplicate(listOf(ExistingPdf(first.document, "book"))), again)
        assertTrue(setup.database.listNotes().size == notes + 1 && setup.database.listTrash().notes.isEmpty())

        // the owner in the Trash Can is still named
        setup.store.deleteNote(first.note.id)
        assertEquals(ImportPdfOutcome.Duplicate(listOf(ExistingPdf(first.document, "book"))), setup.library.importPdf(setup.write("book again.pdf")))

        val separate = setup.library.importPdf(setup.write("book again.pdf"), allowDuplicate = true) as? ImportPdfOutcome.Added
            ?: fail("expected a separate copy")
        assertTrue(separate.note.title == "book again" && setup.storedFiles.size == 2)
        assertTrue(setup.storedFiles.none { it.startsWith(".") }, "no hidden half-copy is left")
    }
}
