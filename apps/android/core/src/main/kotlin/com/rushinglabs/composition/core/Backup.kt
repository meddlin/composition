package com.rushinglabs.composition.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardOpenOption
import java.time.Instant
import java.util.UUID
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipException

// Backing up and restoring everything the app keeps, in the format the desktop writes and reads (`backup.ts`, `tarArchive.ts`):
// one `.tar.gz` that plain `tar` can open. Ported from Backup.swift, Tar.swift and Gzip.swift; gzip is `java.util.zip`.
//
//   composition-backup.json   what this is, the format version, when, counts
//   settings.json             optional: favorites, colour scheme, and every other key the desktop keeps
//   composition.db            a consistent snapshot of the database (VACUUM INTO)
//   app_data/<image>          every pasted image
//   attachments/<file>        every attached file
//   documents/<file>          every PDF a note owns
//
// Restoring is two steps so nothing is touched until the file is known to be good: `stage` unpacks and checks it in a scratch
// folder, and `apply` swaps it in, with a rollback if anything fails halfway.

/** Why a backup or restore was refused. The wording follows the desktop's, so a person sees the same sentence in either app. */
sealed class BackupException(message: String) : Exception(message) {
    class CannotRead(path: String) : BackupException("Can't read $path.")
    class NotABackup : BackupException("This is not a Composition backup.")
    class Damaged : BackupException("This is not a Composition backup (or it is damaged).")
    class EndsUnexpectedly : BackupException("The backup ends unexpectedly.")
    class DamagedHeader : BackupException("The backup has a damaged header.")
    class ContainsNonFile(name: String) : BackupException("The backup contains something other than files (${name.ifEmpty { "an unnamed entry" }}), so it was not restored.")
    class DuplicateEntry(name: String) : BackupException("The backup lists $name twice.")
    class UnknownFile(name: String) : BackupException("The backup contains a file Composition doesn't know ($name), so it was not restored.")
    class NewerFormat(version: Int) : BackupException("This backup was made by a newer version of Composition (backup format $version); update Composition to restore it.")
    class JsonTooLarge(what: String) : BackupException("The backup's $what is too large to be real.")
    class JsonDamaged(what: String) : BackupException("The backup's $what is damaged.")
    class NoDatabase : BackupException("This backup has no database in it, so nothing was restored.")
    class DatabaseUnopenable : BackupException("The database inside this backup can't be opened, so nothing was restored.")
    class DatabaseDamaged : BackupException("The database inside this backup is damaged or isn't a Composition database, so nothing was restored.")
    class Shrank(path: String) : BackupException("$path shrank while it was being backed up.")
    class TooLarge(name: String) : BackupException("$name is too large to put in a backup.")
    class RestoreFailed(detail: String) : BackupException("Could not restore: $detail. Your previous data was put back.")
}

/** How many of each thing a backup holds, under the names the desktop's manifest uses. */
data class BackupCounts(
    val notes: Int = 0, val groups: Int = 0, val trashedNotes: Int = 0, val trashedGroups: Int = 0, val images: Int = 0,
    val attachments: Int = 0, val documents: Int = 0, val todos: Int = 0, val archivedTodos: Int = 0, val contacts: Int = 0,
) {
    val json: JsonObject get() = JsonObject(mapOf(
        "notes" to JsonPrimitive(notes), "groups" to JsonPrimitive(groups), "trashedNotes" to JsonPrimitive(trashedNotes),
        "trashedGroups" to JsonPrimitive(trashedGroups), "images" to JsonPrimitive(images), "attachments" to JsonPrimitive(attachments),
        "documents" to JsonPrimitive(documents), "todos" to JsonPrimitive(todos), "archivedTodos" to JsonPrimitive(archivedTodos),
        "contacts" to JsonPrimitive(contacts),
    ))
}

data class BackupSummary(val file: File, val bytes: Long, val createdAt: String, val counts: BackupCounts)

/** A backup unpacked and checked, waiting to be applied or discarded. */
class StagedBackup internal constructor(
    /** The scratch folder holding the unpacked backup; remove it with `Backup.discard`. */
    val directory: File,
    val createdAt: String,
    val counts: BackupCounts,
    /** The backup's `settings.json` as it was, or null when it had none. `apply` writes it to the data folder as it is. */
    val settings: ByteArray?,
    val hasImages: Boolean,
    val hasAttachments: Boolean,
    val hasDocuments: Boolean,
)

object Backup {
    private val manifestWriter = Json { prettyPrint = true }

    // Creating ------------------------------------------------------------------------------------------------------------

    /**
     * Writes a backup of `database` and the files in `location` to exactly `file`. The snapshot is taken with `VACUUM INTO`, which
     * is consistent while the app is writing. Written to a temporary name and renamed, so `file` is never a half-written archive.
     */
    fun create(database: CompositionDatabase, location: DataLocation, file: File, now: Instant = Instant.now()): BackupSummary {
        file.absoluteFile.parentFile.mkdirs()
        val scratch = File(file.absoluteFile.parentFile, ".composition-backup-${UUID.randomUUID()}")
        check(scratch.mkdir()) { "could not make ${scratch.path}" }
        try {
            val snapshot = File(scratch, BackupNames.DATABASE)
            database.file.writeWithoutTransaction { it.execute("VACUUM INTO ?", snapshot.path) }
            val images = storedFiles(location.imagesDirectory).filter(BackupNames::isImageName)
            val attachments = storedFiles(location.attachmentsDirectory).filter(BackupNames::isStoredName)
            val documents = storedFiles(location.documentsDirectory).filter(BackupNames::isStoredName)
            val counts = countRows(snapshot).copy(images = images.size)
            val createdAt = Timestamp.now(now)
            val settings = usableSettings(location.settingsFile)
            val manifest = manifestWriter.encodeToString(JsonElement.serializer(), JsonObject(mapOf(
                "format" to JsonPrimitive(BackupNames.FORMAT), "version" to JsonPrimitive(BackupNames.FORMAT_VERSION),
                "createdAt" to JsonPrimitive(createdAt), "counts" to counts.json,
            ))) + "\n"

            val partial = File(file.path + ".partial")
            try {
                BufferedOutputStream(GZIPOutputStream(FileOutputStream(partial), 64 * 1024)).use { output ->
                    val tar = TarWriter(output, now)
                    tar.addFile(BackupNames.MANIFEST, manifest.toByteArray())
                    if (settings != null) tar.addFile(BackupNames.SETTINGS, settings)
                    tar.addFile(BackupNames.DATABASE, snapshot)
                    for (name in images) tar.addFile("${BackupNames.IMAGE_DIRECTORY}/$name", File(location.imagesDirectory, name))
                    for (name in attachments) tar.addFile("${BackupNames.ATTACHMENT_DIRECTORY}/$name", File(location.attachmentsDirectory, name))
                    for (name in documents) tar.addFile("${BackupNames.DOCUMENT_DIRECTORY}/$name", File(location.documentsDirectory, name))
                    tar.finish()
                }
                if (file.exists()) file.delete()
                check(partial.renameTo(file)) { "could not move the backup into place" }
            } catch (error: Throwable) {
                partial.delete()
                throw error
            }
            return BackupSummary(file, file.length(), createdAt, counts)
        } finally {
            scratch.deleteRecursively()
        }
    }

    /** The bytes of `settings.json` when it is a JSON object small enough to be one. */
    private fun usableSettings(file: File): ByteArray? {
        if (!file.isFile || file.length() > BackupNames.MAX_JSON_BYTES) return null
        val bytes = runCatching { file.readBytes() }.getOrNull() ?: return null
        return if (runCatching { Json.parseToJsonElement(String(bytes, Charsets.UTF_8)) }.getOrNull() is JsonObject) bytes else null
    }

    /** The regular, non-hidden files of a folder, by name; a missing folder has none. */
    private fun storedFiles(directory: File): List<String> =
        (directory.listFiles() ?: emptyArray()).filter { it.isFile }.map { it.name }.filter { !it.startsWith(".") }.sorted()

    // Reading what is in a database ---------------------------------------------------------------------------------------

    /** Row counts of a database file, opened read-only. A table or column an older version never created counts as 0. */
    private fun countRows(file: File): BackupCounts = SqliteFile.openImmutable(file.path).use { sqlite ->
        sqlite.read { db ->
            fun count(table: String, condition: String = "1"): Int =
                runCatching { db.long("SELECT COUNT(*) FROM $table WHERE $condition")?.toInt() ?: 0 }.getOrDefault(0)
            val archived = count("todos", "archived_at IS NOT NULL")
            BackupCounts(
                notes = count("notes"), groups = count("groups"), trashedNotes = count("trashed_notes"),
                trashedGroups = count("trashed_groups"), attachments = count("attachments"), documents = count("documents"),
                archivedTodos = archived, todos = count("todos") - archived, contacts = count("contacts"),
            )
        }
    }

    /** Throws unless `file` is an intact SQLite database with a notes table. */
    private fun assertUsableDatabase(file: File) {
        val sqlite = try { SqliteFile.openImmutable(file.path) } catch (_: Exception) { throw BackupException.DatabaseUnopenable() }
        sqlite.use {
            val ok = try {
                it.read { db ->
                    db.string("PRAGMA quick_check") == "ok" && db.long("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'") != null
                }
            } catch (_: Exception) {
                throw BackupException.DatabaseDamaged()
            }
            if (!ok) throw BackupException.DatabaseDamaged()
        }
    }

    // Restoring -----------------------------------------------------------------------------------------------------------

    /**
     * Unpacks and validates the backup at `file` into a scratch folder inside `location` (the same disk, so the swap is a rename).
     * Every entry name is checked against the shapes the app itself generates, so a hostile archive cannot write outside the folder.
     */
    fun stage(file: File, location: DataLocation): StagedBackup {
        if (!file.canRead()) throw BackupException.CannotRead(file.path)
        location.directory.mkdirs()
        val directory = File(location.directory, ".restore-${UUID.randomUUID()}")
        check(directory.mkdir()) { "could not make ${directory.path}" }
        directory.setReadable(false, false); directory.setReadable(true, true)
        directory.setWritable(false, false); directory.setWritable(true, true)
        directory.setExecutable(false, false); directory.setExecutable(true, true)

        try {
            var manifest: Pair<Int, String>? = null
            var settings: ByteArray? = null
            var hasDatabase = false
            val seen = HashSet<String>()
            var images = 0
            var attachments = 0
            var documents = 0

            TarReader.forEachFile(file) { entry ->
                if (!seen.add(entry.name)) throw BackupException.DuplicateEntry(entry.name)
                when (entry.name) {
                    BackupNames.MANIFEST -> {
                        manifest = parseManifest(readJson(entry, "description"))
                        return@forEachFile
                    }
                    BackupNames.SETTINGS -> {
                        val bytes = readAll(entry, "settings")
                        if (runCatching { Json.parseToJsonElement(String(bytes, Charsets.UTF_8)) }.isFailure) throw BackupException.JsonDamaged("settings")
                        settings = bytes
                        return@forEachFile
                    }
                }
                val target: File
                if (entry.name == BackupNames.DATABASE) {
                    hasDatabase = true
                    target = File(directory, BackupNames.DATABASE)
                } else {
                    val parts = entry.name.split("/")
                    val known = parts.size == 2 && (
                        (parts[0] == BackupNames.IMAGE_DIRECTORY && BackupNames.isImageName(parts[1])) ||
                            (parts[0] == BackupNames.ATTACHMENT_DIRECTORY && BackupNames.isStoredName(parts[1])) ||
                            (parts[0] == BackupNames.DOCUMENT_DIRECTORY && BackupNames.isStoredName(parts[1]))
                        )
                    if (!known) throw BackupException.UnknownFile(entry.name)
                    when (parts[0]) {
                        BackupNames.IMAGE_DIRECTORY -> images++
                        BackupNames.DOCUMENT_DIRECTORY -> documents++
                        else -> attachments++
                    }
                    val folder = File(directory, parts[0]).apply { mkdirs() }
                    target = File(folder, parts[1])
                }
                write(entry, target)
            }

            val (_, createdAt) = manifest ?: throw BackupException.NotABackup()
            if (!hasDatabase) throw BackupException.NoDatabase()
            val stagedDatabase = File(directory, BackupNames.DATABASE)
            assertUsableDatabase(stagedDatabase)
            val counts = countRows(stagedDatabase).copy(images = images)
            return StagedBackup(directory, createdAt, counts, settings, images > 0, attachments > 0, documents > 0)
        } catch (error: Throwable) {
            directory.deleteRecursively()
            throw error
        }
    }

    fun discard(staged: StagedBackup) {
        staged.directory.deleteRecursively()
    }

    private fun readAll(entry: TarEntry, what: String): ByteArray {
        if (entry.size > BackupNames.MAX_JSON_BYTES) throw BackupException.JsonTooLarge(what)
        return entry.data.readBytes()
    }

    private fun readJson(entry: TarEntry, what: String): JsonElement {
        val bytes = readAll(entry, what)
        return try { Json.parseToJsonElement(String(bytes, Charsets.UTF_8)) } catch (_: Exception) { throw BackupException.JsonDamaged(what) }
    }

    /** The format version and creation time; refuses anything that is not a backup, or one from a newer format. */
    private fun parseManifest(value: JsonElement): Pair<Int, String> {
        val obj = value as? JsonObject ?: throw BackupException.NotABackup()
        val format = (obj["format"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val version = (obj["version"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        if (format != BackupNames.FORMAT || version == null) throw BackupException.NotABackup()
        if (version > BackupNames.FORMAT_VERSION) throw BackupException.NewerFormat(version)
        val createdAt = (obj["createdAt"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
        return version to createdAt
    }

    /** Writes an entry's bytes to a new file; an existing file there is an error, never overwritten. */
    private fun write(entry: TarEntry, target: File) {
        val output = try {
            Files.newOutputStream(target.toPath(), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        } catch (_: FileAlreadyExistsException) {
            throw BackupException.DuplicateEntry(target.name)
        }
        output.use { entry.data.copyTo(it, 64 * 1024) }
    }

    /**
     * Replaces the current database, images, attachments and PDFs with the staged ones, then removes the scratch folder. What was
     * there is set aside first and put back if anything fails. The caller must have closed the database first.
     */
    fun apply(staged: StagedBackup, location: DataLocation) {
        val aside = File(staged.directory, "previous")
        check(aside.mkdir()) { "could not make ${aside.path}" }

        // The backup's settings go in as they are; a backup without any leaves the current ones alone, as the desktop does.
        val settingsSwap = staged.settings?.let { bytes ->
            val file = File(staged.directory, BackupNames.SETTINGS)
            file.writeBytes(bytes)
            listOf(location.settingsFile to file)
        } ?: emptyList()

        // (where it lives now, what the staged copy replaces it with; null means nothing, the backup had none)
        val db = location.databaseFile
        val swaps: List<Pair<File, File?>> = settingsSwap +
            listOf(db to File(staged.directory, BackupNames.DATABASE)) +
            BackupNames.databaseSuffixes.map { File(db.path + it) to null } +
            listOf(
                location.imagesDirectory to (if (staged.hasImages) File(staged.directory, BackupNames.IMAGE_DIRECTORY) else null),
                location.attachmentsDirectory to (if (staged.hasAttachments) File(staged.directory, BackupNames.ATTACHMENT_DIRECTORY) else null),
                location.documentsDirectory to (if (staged.hasDocuments) File(staged.directory, BackupNames.DOCUMENT_DIRECTORY) else null),
            )

        val setAside = ArrayList<Pair<File, File>>()
        val placed = ArrayList<File>()
        try {
            for ((index, swap) in swaps.withIndex()) {
                if (!exists(swap.first)) continue
                val parked = File(aside, index.toString())
                move(swap.first, parked)
                setAside.add(swap.first to parked)
            }
            for ((current, replacement) in swaps) {
                if (replacement == null) continue
                move(replacement, current)
                placed.add(current)
            }
        } catch (error: Exception) {
            for (file in placed.reversed()) file.deleteRecursively()
            // Nothing more can be done if this fails; the previous data stays in the scratch folder, which is kept for that reason.
            for ((current, parked) in setAside.reversed()) runCatching { move(parked, current) }
            throw BackupException.RestoreFailed(error.message ?: error.toString())
        }
        // A draft belongs to a note of the database that was just replaced; applied to the new one it would overwrite the wrong text.
        location.draftsDirectory.deleteRecursively()
        staged.directory.deleteRecursively()
    }

    private fun move(from: File, to: File) {
        Files.move(from.toPath(), to.toPath())
    }

    /** Whether anything is at `file`, a broken link included. */
    private fun exists(file: File) = Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)
}

// tar ---------------------------------------------------------------------------------------------------------------------
//
// A minimal streaming tar writer and reader, the twin of `tarArchive.ts`. Written: ustar headers, GNU long names for paths over
// 100 bytes. Read: regular files only; a link, device, FIFO or anything else is refused rather than skipped, since skipping would
// hide a hostile archive. POSIX (`x`) and GNU (`L`) path extensions are understood.

private const val BLOCK = 512
private const val IO_CHUNK = 64 * 1024
/** ustar's size field is 11 octal digits. */
private const val MAX_ENTRY_SIZE = 0x1FFFFFFFFL
private const val MAX_EXTENSION_BYTES = 64 * 1024

internal class TarWriter(private val output: OutputStream, now: Instant) {
    private val modified = now.epochSecond

    /** A small file held in memory, such as the manifest. */
    fun addFile(name: String, contents: ByteArray) {
        writeHeader(name, contents.size.toLong())
        output.write(contents)
        output.write(padding(contents.size.toLong()))
    }

    /** A file streamed from disk. A file that has gone since the folder was listed is not part of the backup. */
    fun addFile(name: String, file: File) {
        val input = try { FileInputStream(file) } catch (_: IOException) { return }
        input.use {
            val size = it.channel.size()
            writeHeader(name, size)
            var remaining = size
            val buffer = ByteArray(IO_CHUNK)
            while (remaining > 0) {
                val read = it.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                if (read <= 0) throw BackupException.Shrank(file.path)
                output.write(buffer, 0, read)
                remaining -= read
            }
            output.write(padding(size))
        }
    }

    /** Two empty blocks; the gzip stream is ended by closing it. */
    fun finish() = output.write(ByteArray(BLOCK * 2))

    private fun writeHeader(name: String, size: Long) {
        if (size > MAX_ENTRY_SIZE) throw BackupException.TooLarge(name)
        val nameBytes = name.toByteArray(Charsets.UTF_8)
        if (nameBytes.size > 100) {
            val body = nameBytes + 0
            output.write(header("././@LongLink".toByteArray(), body.size.toLong(), 0, 'L'))
            output.write(body)
            output.write(padding(body.size.toLong()))
        }
        output.write(header(nameBytes, size, modified, '0'))
    }

    private fun octal(value: Long, width: Int): ByteArray = (value.toString(8).padStart(width - 1, '0')).toByteArray() + 0

    private fun header(name: ByteArray, size: Long, modified: Long, type: Char): ByteArray {
        val bytes = ByteArray(BLOCK)
        fun put(field: ByteArray, offset: Int) = field.copyInto(bytes, offset)
        put(name.copyOf(minOf(100, name.size)), 0)
        put(octal(0b110_100_100, 8), 100)
        put(octal(0, 8), 108)  // uid
        put(octal(0, 8), 116)  // gid
        put(octal(size, 12), 124)
        put(octal(modified, 12), 136)
        put(ByteArray(8) { 0x20 }, 148)  // the checksum is computed with this field as spaces
        put(byteArrayOf(type.code.toByte()), 156)
        put("ustar\u0000".toByteArray(), 257)
        put("00".toByteArray(), 263)
        val sum = bytes.sumOf { it.toInt() and 0xFF }
        put(sum.toString(8).padStart(6, '0').toByteArray() + byteArrayOf(0, 0x20), 148)
        return bytes
    }

    private fun padding(size: Long) = ByteArray(((BLOCK - size % BLOCK) % BLOCK).toInt())
}

internal class TarEntry(val name: String, val size: Long, val data: InputStream)

internal object TarReader {
    /** Visits each file in the `.tar.gz` at `file`, in order. Whatever the visitor leaves unread is skipped. */
    fun forEachFile(file: File, visit: (TarEntry) -> Unit) {
        val raw = try { FileInputStream(file) } catch (_: IOException) { throw BackupException.CannotRead(file.path) }
        raw.use {
            val input = try { BufferedInputStream(GZIPInputStream(BufferedInputStream(it), IO_CHUNK), IO_CHUNK) } catch (_: IOException) { throw BackupException.Damaged() }
            var pendingName: String? = null
            while (true) {
                val header = take(input, BLOCK)
                if (header.size < BLOCK) throw BackupException.EndsUnexpectedly()
                if (header.all { b -> b.toInt() == 0 }) return  // end of archive
                if (!checksumMatches(header)) throw BackupException.Damaged()

                val type = if (header[156].toInt() == 0) '0' else header[156].toInt().toChar()
                val size = parseOctal(header.copyOfRange(124, 136))
                val prefix = cString(header.copyOfRange(345, 500))
                val own = cString(header.copyOfRange(0, 100))
                val name = pendingName ?: if (prefix.isEmpty()) own else "$prefix/$own"
                pendingName = null
                val padded = (size + BLOCK - 1) / BLOCK * BLOCK

                when (type) {
                    'L', 'x' -> {
                        if (size > MAX_EXTENSION_BYTES) throw BackupException.DamagedHeader()
                        val body = take(input, padded.toInt())
                        if (body.size < padded) throw BackupException.EndsUnexpectedly()
                        val content = body.copyOf(size.toInt())
                        pendingName = if (type == 'L') cString(content) else paxPath(content)
                    }
                    'g', '5' -> skip(input, padded)
                    '0' -> {
                        val data = EntryStream(input, size)
                        visit(TarEntry(name, size, data))
                        // Whatever the visitor left unread, and the padding after the data.
                        skip(input, data.remaining)
                        skip(input, padded - size)
                    }
                    else -> throw BackupException.ContainsNonFile(name)
                }
            }
        }
    }

    /** The bytes of one entry; ends at the entry's size, and a stream that ends sooner is an error. */
    private class EntryStream(private val input: InputStream, var remaining: Long) : InputStream() {
        override fun read(): Int {
            if (remaining <= 0) return -1
            val byte = guarded { input.read() }
            if (byte < 0) throw BackupException.EndsUnexpectedly()
            remaining--
            return byte
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (remaining <= 0) return -1
            val read = guarded { input.read(buffer, offset, minOf(length.toLong(), remaining).toInt()) }
            if (read < 0) throw BackupException.EndsUnexpectedly()
            remaining -= read
            return read
        }
    }

    /** gzip's own errors, in the desktop's words. */
    private inline fun <T> guarded(body: () -> T): T = try {
        body()
    } catch (_: EOFException) {
        throw BackupException.EndsUnexpectedly()
    } catch (_: ZipException) {
        throw BackupException.Damaged()
    }

    /** Up to `count` bytes; fewer only at the end of the stream. */
    private fun take(input: InputStream, count: Int): ByteArray {
        val buffer = ByteArray(count)
        var taken = 0
        while (taken < count) {
            val read = guarded { input.read(buffer, taken, count - taken) }
            if (read < 0) break
            taken += read
        }
        return if (taken == count) buffer else buffer.copyOf(taken)
    }

    private fun skip(input: InputStream, count: Long) {
        var remaining = count
        val buffer = ByteArray(IO_CHUNK)
        while (remaining > 0) {
            val read = guarded { input.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt()) }
            if (read < 0) throw BackupException.EndsUnexpectedly()
            remaining -= read
        }
    }

    private fun parseOctal(field: ByteArray): Long {
        val text = cString(field).trim()
        if (text.isEmpty() || !text.all { it in '0'..'7' }) throw BackupException.DamagedHeader()
        return text.toLongOrNull(8) ?: throw BackupException.DamagedHeader()
    }

    private fun cString(field: ByteArray): String {
        val end = field.indexOf(0).let { if (it < 0) field.size else it }
        return String(field, 0, end, Charsets.UTF_8)
    }

    private fun checksumMatches(header: ByteArray): Boolean {
        val stored = runCatching { parseOctal(header.copyOfRange(148, 156)) }.getOrNull() ?: return false
        var sum = 0L
        for ((offset, byte) in header.withIndex()) sum += if (offset in 148 until 156) 0x20 else (byte.toInt() and 0xFF)
        return sum == stored
    }

    /** `path=…` from a POSIX extended header's `<length> <key>=<value>\n` records. */
    private fun paxPath(records: ByteArray): String? {
        var at = 0
        while (at < records.size) {
            var space = at
            while (space < records.size && records[space].toInt() != 0x20) space++
            if (space >= records.size) throw BackupException.DamagedHeader()
            val length = String(records, at, space - at, Charsets.UTF_8).toIntOrNull() ?: throw BackupException.DamagedHeader()
            if (length <= 0 || at + length > records.size || at + length - 1 < space + 1) throw BackupException.DamagedHeader()
            val record = String(records, space + 1, at + length - 1 - (space + 1), Charsets.UTF_8)
            if (record.startsWith("path=")) return record.removePrefix("path=")
            at += length
        }
        return null
    }
}
