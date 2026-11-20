package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.BackupNames
import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.DataLocation
import com.rushinglabs.composition.core.NoteDetail
import com.rushinglabs.composition.core.NoteStore
import com.rushinglabs.composition.core.purgeExpired
import com.rushinglabs.composition.core.purgeNote
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant

// The PDFs' files, and the operations that join a file to its row: a port of `documents.ts` and of the PDF half of `service.ts`
// (`importPdf`, `permanentlyDeleteNote`, `purgeExpiredTrash`), by way of DocumentLibrary.swift. A PDF is a row (DocumentsStore.kt) and a
// plain file in `<application data>/documents/` (`DataLocation.documentsDirectory`), copied in once and never written again.

/**
 * What copying a PDF into the library came to. `Refused` is for something the person can fix (not a PDF, too large, the note already has
 * one); the message is the desktop's and is safe to show. `Duplicate` lists the PDFs with exactly these bytes and nothing was copied: the
 * caller offers to open one, or imports again with `allowDuplicate` for a separate copy.
 */
sealed class ImportDocumentResult {
    data class Added(val document: StoredDocument) : ImportDocumentResult()
    data class Duplicate(val existing: List<StoredDocument>) : ImportDocumentResult()
    data class Refused(val message: String) : ImportDocumentResult()
}

/** A PDF the library already holds, and the title of the note that owns it (live or in the Trash Can). */
data class ExistingPdf(val document: StoredDocument, val noteTitle: String)

/** What `importPdf` came to: the note and PDF made, or the PDFs that already hold these bytes, or a reason to show. */
sealed class ImportPdfOutcome {
    data class Added(val note: NoteDetail, val document: StoredDocument) : ImportPdfOutcome()
    data class Duplicate(val existing: List<ExistingPdf>) : ImportPdfOutcome()
    data class Refused(val message: String) : ImportPdfOutcome()
}

/** Where a PDF's bytes are, and its row. */
data class DocumentFile(val file: File, val document: StoredDocument)

class DocumentLibrary(val store: NoteStore, val location: DataLocation) {
    companion object {
        /** Bytes read and written at a time, so a book of hundreds of megabytes is never held in memory. */
        const val CHUNK_SIZE = 1 shl 20

        private val random = SecureRandom()

        /** Six random bytes as twelve hex digits: what keeps two PDFs of the same name apart. */
        private fun randomPrefix(): String {
            val bytes = ByteArray(6).also(random::nextBytes)
            return hex(bytes)
        }

        private fun hex(bytes: ByteArray): String = bytes.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    }

    private val database get() = store.database

    // Import ------------------------------------------------------------------------------------------------------------------------

    /**
     * Copies a PDF into the documents folder and gives it to the note. `pageCount` is what the caller counted (the reader's job, so 0 is
     * allowed and means not counted yet). The copy goes to a hidden temporary name and is renamed when it is whole, so a file is never
     * visible half written, and the hash is taken from the bytes as they are copied, not from a second read. (A file the person picked
     * through the system's picker arrives as a stream; the app copies it to its cache first and imports from there.)
     */
    fun importDocument(noteId: Long, source: File, pageCount: Int = 0, allowDuplicate: Boolean = false, now: Instant = Instant.now()): ImportDocumentResult {
        val fileName = DocumentNames.displayName(source.path)
        val file = runCatching { source.canonicalFile }.getOrDefault(source)
        val unreadable = ImportDocumentResult.Refused("$fileName: could not be read.")

        val attributes = runCatching { Files.readAttributes(file.toPath(), BasicFileAttributes::class.java) }.getOrNull() ?: return unreadable
        if (!attributes.isRegularFile) return ImportDocumentResult.Refused("$fileName: only files can be imported, not folders.")
        val size = attributes.size()
        if (size > DocumentNames.MAX_BYTES) return ImportDocumentResult.Refused("$fileName: files can be at most ${DocumentNames.formatBytes(DocumentNames.MAX_BYTES)}.")

        if (database.documentForNote(noteId) != null) return ImportDocumentResult.Refused(DocumentException.HasDocument().message!!)

        val input = runCatching { RandomAccessFile(file, "r") }.getOrNull() ?: return unreadable
        input.use {
            val head = ByteArray(minOf(size, DocumentNames.HEADER_WINDOW.toLong()).toInt())
            val read = runCatching { readFully(input, head) }.getOrDefault(0)
            if (!DocumentNames.looksLikePdf(head, read)) return ImportDocumentResult.Refused("$fileName: this doesn't look like a PDF.")
            input.seek(0)

            val directory = location.documentsDirectory
            directory.mkdirs()
            if (!directory.isDirectory) throw IOException("Could not make $directory")
            val storedName = DocumentNames.storedName(randomPrefix(), fileName)
            val target = File(directory, storedName)
            val temporary = File(directory, ".$storedName.tmp")
            // Whatever happens next, the hidden copy does not stay: after a successful rename there is nothing at this name to remove.
            try {
                val (sha256, copiedSize) = copyHashing(input, temporary)
                if (!allowDuplicate) {
                    val existing = database.documents(sha256)
                    if (existing.isNotEmpty()) return ImportDocumentResult.Duplicate(existing)
                }
                Files.move(temporary.toPath(), target.toPath())
                try {
                    return ImportDocumentResult.Added(database.addDocument(noteId, fileName, storedName, sha256, copiedSize, pageCount, now))
                } catch (error: DocumentException) {
                    target.delete()
                    return ImportDocumentResult.Refused(error.message!!)
                } catch (error: Throwable) {
                    target.delete()
                    throw error
                }
            } finally {
                temporary.delete()
            }
        }
    }

    /**
     * Makes a note for the PDF at `source` (in `groupId`, or `notebookId`) and imports the file into it. Nothing is left behind when the
     * file is refused, or is one the library already has and the caller did not ask for a separate copy: the note was never shown, so it
     * goes for good, not to the Trash Can.
     */
    fun importPdf(source: File, groupId: Long? = null, notebookId: Long? = null, allowDuplicate: Boolean = false, now: Instant = Instant.now()): ImportPdfOutcome {
        val note = store.createNote(DocumentNames.titleFromFileName(source.path), groupId, notebookId, now)
        val result = try {
            importDocument(note.id, source, allowDuplicate = allowDuplicate, now = now)
        } catch (error: Throwable) {
            runCatching { discard(note.id) }
            throw error
        }
        return when (result) {
            is ImportDocumentResult.Added -> ImportPdfOutcome.Added(note, result.document)
            is ImportDocumentResult.Refused -> {
                discard(note.id)
                ImportPdfOutcome.Refused(result.message)
            }
            is ImportDocumentResult.Duplicate -> {
                discard(note.id)
                ImportPdfOutcome.Duplicate(result.existing.map { ExistingPdf(it, ownerTitle(it.noteId)) })
            }
        }
    }

    // Files ---------------------------------------------------------------------------------------------------------------------------

    /**
     * Where a PDF's bytes are, or null when the row is gone or the file has been deleted behind the app's back. The path is built from the
     * stored name, and only a name of the shape the app makes is used, so a damaged or hostile row cannot point outside the folder.
     */
    fun documentFile(id: Long): DocumentFile? {
        val document = database.document(id) ?: return null
        if (!BackupNames.isStoredName(document.storedName)) return null
        val file = File(location.documentsDirectory, document.storedName)
        return if (file.exists()) DocumentFile(file, document) else null
    }

    /** Deletes a PDF, its marks, its bookmarks and its stored file. False when there was no such PDF. */
    fun removeDocument(id: Long): Boolean {
        val document = database.deleteDocument(id) ?: return false
        removeFiles(listOf(document))
        return true
    }

    /**
     * Deletes the PDFs (rows, marks, bookmarks and stored files) of notes that no longer exist anywhere, trashed or not. Run after a note
     * is permanently deleted, by hand or because it outlived the Trash Can's retention window; anything missed is found by the next sweep.
     */
    fun removeOrphans() = removeFiles(database.deleteOrphanedDocuments())

    /** `permanentlyDeleteNote`: the note leaves the Trash Can for good, and so does its PDF. */
    fun permanentlyDeleteNote(id: Long) {
        database.purgeNote(id)
        removeOrphans()
    }

    /** `purgeExpiredTrash`: clears what has been in the Trash Can past its retention window, and the PDFs of any notes among it. */
    fun purgeExpiredTrash(now: Instant = Instant.now()) {
        database.purgeExpired(now)
        removeOrphans()
    }

    // Pieces ------------------------------------------------------------------------------------------------------------------------

    /**
     * A file that is already gone is not an error, and neither is one that cannot be removed: the row is what matters, and a stray file
     * is left for the person to find in a backup's file list, not a reason to fail a delete.
     */
    private fun removeFiles(documents: List<StoredDocument>) {
        for (document in documents) {
            if (BackupNames.isStoredName(document.storedName)) runCatching { File(location.documentsDirectory, document.storedName).delete() }
        }
    }

    private fun discard(noteId: Long) {
        store.deleteNote(noteId)
        database.purgeNote(noteId)
    }

    /** The title of a note that owns a PDF, whether the note is live or in the Trash Can. */
    private fun ownerTitle(noteId: Long): String {
        database.note(noteId)?.let { return it.title }
        return database.trashedNoteTitle(noteId) ?: "Untitled"
    }

    /** Fills `buffer` from the start of the file, or as much of it as there is; returns how many bytes were read. */
    private fun readFully(input: RandomAccessFile, buffer: ByteArray): Int {
        var filled = 0
        while (filled < buffer.size) {
            val count = input.read(buffer, filled, buffer.size - filled)
            if (count < 0) break
            filled += count
        }
        return filled
    }

    private fun copyHashing(input: RandomAccessFile, destination: File): Pair<String, Long> {
        val hasher = MessageDigest.getInstance("SHA-256")
        var size = 0L
        FileOutputStream(destination).use { output ->
            // Only this app reads its documents; the folder is the app's own on Android, and this keeps a desktop JVM's copy private too.
            runCatching { Files.setPosixFilePermissions(destination.toPath(), PosixFilePermissions.fromString("rw-------")) }
            val chunk = ByteArray(CHUNK_SIZE)
            while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                if (count == 0) continue
                hasher.update(chunk, 0, count)
                output.write(chunk, 0, count)
                size += count
            }
        }
        return hex(hasher.digest()) to size
    }
}

/** The title of a note in the Trash Can, or null. */
internal fun CompositionDatabase.trashedNoteTitle(id: Long): String? =
    file.read { it.string("SELECT title FROM trashed_notes WHERE id = ?", id) }
