package com.rushinglabs.composition.core.images

import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.DataLocation
import com.rushinglabs.composition.core.NOTE_DISPLAY_ORDER
import com.rushinglabs.composition.core.Timestamp
import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.attribute.BasicFileAttributes

// The images already stored: inserting one again (the tracker's "Insert a stored image"), and the Images page that cleans them up.
// The twins of the desktop's `listImages` (images.ts), of the join with the notes that point at each image (`imageUsage` in
// imageRefs.ts), and of the picker's `matchImages`, `usageLabel` and `formatSize` (imagePicker.ts); then the iPad's own clean-up.
// Ported from ImageLibrary.swift and ImageCleanup.swift, where these are extensions of StoredImages. Checked against the real
// functions over fixtures/conformance/images-cases.json (ImagesConformanceTests).

/** One image in `app_data/`. */
data class StoredImageFile(
    val name: String,
    /** Size in bytes. */
    val size: Long,
    /** When the file was last written (ISO 8601, as the desktop's `toISOString`). */
    val modifiedAt: String,
)

/** A note that points at a stored image. */
data class ImageUse(val id: Long, val title: String)

/** A stored image and the notes that still point at it (empty once the last one has been deleted). */
data class StoredImageInfo(val name: String, val size: Long, val modifiedAt: String, val usedIn: List<ImageUse>)

/** A note's id, title and text: what is needed to see which images it points at. */
data class NoteText(val id: Long, val title: String, val content: String)

/** What asking to delete a stored image came to. */
sealed interface ImageRemoveOutcome {
    data object Removed : ImageRemoveOutcome
    /** A note's text still points at it; nothing was deleted. */
    data class UsedByNotes(val count: Int) : ImageRemoveOutcome
    /** A note in the Trash Can points at it; nothing was deleted, because restoring that note would bring it back without its picture. */
    data object UsedInTrash : ImageRemoveOutcome
    /** There is no stored image of that name (or the name is not a stored image's). */
    data object NotFound : ImageRemoveOutcome
    data class Failed(val message: String) : ImageRemoveOutcome
}

/**
 * Every note's id, title and text, in the order the sidebar shows them (`listNotes` of `notesRepo.ts`, which the desktop reads whole to
 * see which notes point at each stored image).
 */
fun CompositionDatabase.noteTexts(): List<NoteText> = file.read { db ->
    db.rows("SELECT id, title, content FROM notes ORDER BY $NOTE_DISPLAY_ORDER").map { NoteText(it.long("id"), it.string("title"), it.string("content")) }
}

/** The text of every note in the Trash Can: the notes that can still come back, and so still point at images. */
fun CompositionDatabase.trashedNoteTexts(): List<String> = file.read { db -> db.strings("SELECT content FROM trashed_notes ORDER BY id") }

object ImageLibrary {
    /** How many images the picker lists at once; typing narrows the rest. */
    const val PICKER_LIMIT = 50

    // Listing

    /**
     * Every image in `app_data/`, newest first (ties by name). A missing folder is no images; files that are not images, folders, and
     * half-written ones (`.name.tmp`) are skipped. A link is read through, as the desktop's `stat` reads it.
     */
    fun list(location: DataLocation): List<StoredImageFile> {
        val directory = location.imagesDirectory
        val names = directory.list() ?: return emptyList()
        val found = names.filter(StoredImages::isImageName).mapNotNull { name ->
            val attributes = try {
                Files.readAttributes(File(directory, name).toPath(), BasicFileAttributes::class.java)
            } catch (gone: IOException) {
                return@mapNotNull null // Gone between the listing and the stat.
            }
            if (!attributes.isRegularFile) return@mapNotNull null
            StoredImageFile(name, attributes.size(), Timestamp.string(attributes.lastModifiedTime().toMillis()))
        }
        return found.sortedWith { a, b -> if (a.modifiedAt != b.modifiedAt) b.modifiedAt.compareTo(a.modifiedAt) else nameOrder(a.name, b.name) }
    }

    /**
     * JavaScript's `a.localeCompare(b)` for the characters a stored name can hold (`[A-Za-z0-9._-]`): by ICU's order, which puts `_`
     * before `-` before `.` before digits before letters, and ignores case. (Two names that differ only in case cannot both be in a
     * folder whose file system ignores case; on one that doesn't, they come out in either order.)
     */
    internal fun nameOrder(a: String, b: String): Int {
        fun rank(c: Char): Int = when (c) {
            '_' -> 0
            '-' -> 1
            '.' -> 2
            in '0'..'9' -> 3 + (c - '0')
            in 'A'..'Z' -> 13 + (c - 'A')
            else -> 13 + (c - 'a')
        }
        for (index in 0 until minOf(a.length, b.length)) {
            val x = rank(a[index])
            val y = rank(b[index])
            if (x != y) return x.compareTo(y)
        }
        return a.length.compareTo(b.length)
    }

    // Who uses each

    /** The notes that point at each image, by file name, in the order the notes are given. */
    fun usage(notes: List<NoteText>): Map<String, List<ImageUse>> {
        val usedIn = LinkedHashMap<String, MutableList<ImageUse>>()
        for (note in notes) {
            for (name in StoredImages.findRefs(note.content)) usedIn.getOrPut(name) { ArrayList() }.add(ImageUse(note.id, note.title))
        }
        return usedIn
    }

    /**
     * Every stored image, newest first, with the notes that still refer to it. Images are never deleted along with the text that mentions
     * them, so this is how one is found again. `notes` is read only when there are images.
     */
    fun library(location: DataLocation, notes: () -> List<NoteText>): List<StoredImageInfo> {
        val files = list(location)
        val usedIn = if (files.isEmpty()) emptyMap() else usage(notes())
        return files.map { StoredImageInfo(it.name, it.size, it.modifiedAt, usedIn[it.name] ?: emptyList()) }
    }

    // What the picker shows

    /**
     * The images the picker offers for what was typed, in the order given (newest first). Every word has to appear in the file name,
     * which starts with the title of the note the image was put into, so `trip map` finds `trip-plan-route-map-…`.
     */
    fun match(images: List<StoredImageInfo>, query: String, limit: Int = PICKER_LIMIT): List<StoredImageInfo> {
        val words = ArrayList<String>()
        val word = StringBuilder()
        for (c in query.lowercase()) {
            if (JavaScriptText.isWhitespace(c.code)) {
                if (word.isNotEmpty()) words.add(word.toString())
                word.setLength(0)
            } else {
                word.append(c)
            }
        }
        if (word.isNotEmpty()) words.add(word.toString())
        return images.filter { image ->
            val name = image.name.lowercase()
            words.all { name.contains(it) }
        }.take(limit)
    }

    /** "Not used in any note", or how many notes still point at the image. */
    fun usageLabel(count: Int): String = when (count) {
        0 -> "Not used in any note"
        1 -> "Used in 1 note"
        else -> "Used in $count notes"
    }

    /** A file size the way a person reads it: `812 KB`, `2.4 MB`. */
    fun sizeLabel(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        if (bytes < 1024 * 1024) return "${JavaScriptText.round(bytes / 1024.0).toLong()} KB"
        // `toFixed(1)`: the nearest tenth, the larger one when two are as near (an exact quarter of a megabyte, say).
        return "${JavaScriptText.toFixed(bytes / (1024.0 * 1024), 1)} MB"
    }

    // Cleaning up (the Images page)

    // The desktop's Images screen only browses: it lists every image, filters by name or by "not used", and shows which notes point at
    // each. It never deletes (images outlive the text that mentions them, so one can be found and used again). Deleting is the iPad's
    // addition, so it is narrower than the browsing: only an image **nothing refers to** can go, and "nothing" includes the notes in the
    // Trash Can, whose text the desktop's "not used" does not read. Without that a note restored from the Trash Can would come back
    // with a missing picture.

    /** The images no live note refers to (the desktop's "Not used" filter), in the order given. */
    fun unused(images: List<StoredImageInfo>): List<StoredImageInfo> = images.filter { it.usedIn.isEmpty() }

    /** The total size of `images`, in bytes. */
    fun totalSize(images: List<StoredImageInfo>): Long = images.sumOf { it.size }

    /**
     * Deletes a stored image, if nothing refers to it **now**: `liveNotes` and `trashedTexts` are read again by the caller just before,
     * so a screen that was open while a note was edited cannot delete a picture that was put back in the meantime. The name must be a
     * plain image file name, so it can never leave the folder.
     */
    fun remove(name: String, location: DataLocation, liveNotes: List<NoteText>, trashedTexts: List<String>): ImageRemoveOutcome {
        if (!StoredImages.isImageName(name)) return ImageRemoveOutcome.NotFound
        val using = liveNotes.count { name in StoredImages.findRefs(it.content) }
        if (using > 0) return ImageRemoveOutcome.UsedByNotes(using)
        if (trashedTexts.any { name in StoredImages.findRefs(it) }) return ImageRemoveOutcome.UsedInTrash
        val file = File(location.imagesDirectory, name)
        if (!file.isFile) return ImageRemoveOutcome.NotFound
        return try {
            Files.delete(file.toPath())
            ImageRemoveOutcome.Removed
        } catch (error: IOException) {
            ImageRemoveOutcome.Failed("Could not delete the image: ${error.message}")
        }
    }
}
