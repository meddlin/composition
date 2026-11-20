package com.rushinglabs.composition.core.images

import com.rushinglabs.composition.core.BackupNames
import com.rushinglabs.composition.core.DataLocation
import com.rushinglabs.composition.core.markdown.NoteImage
import com.rushinglabs.composition.core.markdown.forEachMatch
import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.text.Normalizer

// Images in notes: the twins of the desktop's `images.ts` (sniffImage, imageFileName, storeImage) and of the parts of `imageRefs.ts`
// that write and read a note's image paths (imageAlt, imageMarkdown, imageTag, findImageRefs). Ported from StoredImages.swift. Pure
// apart from writing the file: turning a camera photo into JPEG bytes is the app's job. Checked against the real functions over
// fixtures/conformance/images-cases.json (ImagesConformanceTests).

/** What the desktop stores: only these four, whatever a file claims to be. SVG is left out on purpose (it can carry script). */
enum class StoredImageType(val rawValue: String) {
    PNG("png"), JPG("jpg"), GIF("gif"), WEBP("webp");

    companion object {
        fun of(rawValue: String): StoredImageType? = entries.firstOrNull { it.rawValue == rawValue }
    }
}

/** What storing an image came to. */
sealed interface ImageStoreResult {
    data class Stored(val name: String) : ImageStoreResult
    /** In the desktop's words, ready to show. */
    data class Failed(val message: String) : ImageStoreResult
}

/** `imageTag` refuses a name that is not a stored image's. */
class NotAnImageName(val name: String) : IllegalArgumentException("Not a stored image name: $name")

object StoredImages {
    /** The folder inside the data folder, and the start of an image's path in a note. */
    const val DIRECTORY_NAME = BackupNames.IMAGE_DIRECTORY

    // What the bytes are

    private val pngSignature = bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    private val jpegSignature = bytes(0xFF, 0xD8, 0xFF)

    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    /** What the bytes actually are, whatever the file says; null for anything else (a HEIC photo, SVG, a PDF) or a short input. */
    fun sniff(data: ByteArray): StoredImageType? {
        fun starts(signature: ByteArray, at: Int = 0) =
            data.size >= at + signature.size && signature.indices.all { data[at + it] == signature[it] }
        fun starts(signature: String, at: Int = 0) = starts(signature.toByteArray(Charsets.US_ASCII), at)
        return when {
            starts(pngSignature) -> StoredImageType.PNG
            starts(jpegSignature) -> StoredImageType.JPG
            starts("GIF87a") || starts("GIF89a") -> StoredImageType.GIF
            starts("RIFF") && starts("WEBP", at = 8) -> StoredImageType.WEBP
            else -> null
        }
    }

    // Names

    private fun slug(text: String, maxLength: Int): String {
        // NFKD, then the combining marks go, then lower case: so "Café" is "cafe" and a full-width "ＡＢＣ" is "abc".
        val plain = StringBuilder()
        for (c in Normalizer.normalize(text, Normalizer.Form.NFKD)) if (c !in '\u0300'..'\u036F') plain.append(c)
        val out = StringBuilder()
        var pendingDash = false
        for (c in plain.toString().lowercase()) {
            if (c in 'a'..'z' || c in '0'..'9') {
                if (pendingDash && out.isNotEmpty()) out.append('-')
                pendingDash = false
                out.append(c)
            } else {
                pendingDash = true
            }
        }
        // A run of other characters is one dash, but never one at either end; and cutting to the length can leave one at the end.
        return out.toString().take(maxLength).trimEnd('-')
    }

    private const val HEX = "0123456789abcdef"

    /** `<note title>-<image file name>-<content hash>.<ext>`, e.g. `trip-plan-map-3f9c2a71b0de.png`. */
    fun fileName(noteTitle: String, fileName: String, data: ByteArray, type: StoredImageType): String {
        // The last part of the path (either kind of slash), without its last extension.
        val name = fileName.substring(maxOf(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1)
        val dot = name.lastIndexOf('.')
        val stem = if (dot >= 0) name.substring(0, dot) else name
        val hash = StringBuilder()
        for (byte in MessageDigest.getInstance("SHA-256").digest(data).take(6)) {
            hash.append(HEX[(byte.toInt() shr 4) and 0xF]).append(HEX[byte.toInt() and 0xF])
        }
        val title = slug(noteTitle, 40)
        val image = slug(stem, 40)
        return "${title.ifEmpty { "note" }}-${image.ifEmpty { "image" }}-$hash.${type.rawValue}"
    }

    /** A single path segment with an image extension, so a name can never leave the folder. */
    fun isImageName(name: String): Boolean = BackupNames.isImageName(name)

    /** The path a note's Markdown uses for a stored image. */
    fun ref(name: String): String = "$DIRECTORY_NAME/$name"

    // What goes in the note

    /** Words for an image's alt text from its file name: `trip-plan-route-map-3f9c2a71b0de.png` is `trip plan route map`. */
    fun alt(name: String): String {
        val dot = name.lastIndexOf('.')
        var stem = if (dot >= 0) name.substring(0, dot) else name
        // The `-<12 hex digits>` before the extension.
        if (stem.length >= 13 && stem[stem.length - 13] == '-' && stem.takeLast(12).all { it in '0'..'9' || it in 'a'..'f' }) {
            stem = stem.dropLast(13)
        }
        val words = StringBuilder()
        var pendingSpace = false
        for (c in stem) {
            if (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9') {
                if (pendingSpace && words.isNotEmpty()) words.append(' ')
                pendingSpace = false
                words.append(c)
            } else {
                pendingSpace = true
            }
        }
        // Already trimmed: a run of other characters only ever became a single space between two words.
        return words.toString().ifEmpty { "image" }
    }

    /** The Markdown that shows a stored image. `alt` falls back to words from the file name; brackets and line breaks can't be in alt text. */
    fun markdown(name: String, alt: String? = null): String {
        var cleaned = ""
        if (alt != null) {
            // `[[\]\r\n]+` becomes a space, then every run of white space (the JavaScript kind) becomes one, then the ends are trimmed.
            val step = StringBuilder()
            var inBrackets = false
            for (c in alt) {
                if (c == '[' || c == ']' || c == '\r' || c == '\n') {
                    if (!inBrackets) step.append(' ')
                    inBrackets = true
                } else {
                    inBrackets = false
                    step.append(c)
                }
            }
            val collapsed = StringBuilder()
            var inSpace = false
            for (c in step) {
                if (JavaScriptText.isWhitespace(c.code)) {
                    if (!inSpace) collapsed.append(' ')
                    inSpace = true
                } else {
                    inSpace = false
                    collapsed.append(c)
                }
            }
            cleaned = JavaScriptText.trim(collapsed.toString())
        }
        return "![${cleaned.ifEmpty { StoredImages.alt(name) }}](${ref(name)})"
    }

    /** The `<Image>` tag that shows a stored image (it can then say how wide to be). */
    fun tag(name: String): String {
        if (!isImageName(name)) throw NotAnImageName(name)
        return "<Image src=\"${ref(name)}\" alt=\"\" />"
    }

    // `\w` here is JavaScript's without the `u` flag, which is ASCII, as a JVM's is.
    private val imageRef = Regex("""(?<![A-Za-z0-9_/.-])(?:\./)?app_data/[A-Za-z0-9][A-Za-z0-9._-]*""")

    /** Every stored image a note's text refers to, by file name. Finds `![](app_data/x.png)` and `<Image src="app_data/x.png" />` alike. */
    fun findRefs(content: String): Set<String> {
        val names = LinkedHashSet<String>()
        imageRef.forEachMatch(content) { match ->
            // A path at the end of a sentence picks up its full stop.
            NoteImage.nameFromRef(match.group().trimEnd('.'))?.let(names::add)
        }
        return names
    }

    // Storing

    /**
     * Writes the image under a name from the note's and the file's names plus a hash of the bytes, so that two different images never
     * share one and the same image pasted again into the same note reuses its file. `maxBytes` is a size limit, or null for none (as on
     * the desktop app). Writes to a temporary file and renames it, so nothing ever reads half an image.
     */
    fun store(noteTitle: String, fileName: String, data: ByteArray, location: DataLocation, maxBytes: Long? = null): ImageStoreResult {
        if (data.isEmpty()) return ImageStoreResult.Failed("That image is empty.")
        if (maxBytes != null && data.size > maxBytes) {
            return ImageStoreResult.Failed("Images can be at most ${JavaScriptText.numberString(maxBytes / (1024.0 * 1024))} MB.")
        }
        val type = sniff(data) ?: return ImageStoreResult.Failed("Only PNG, JPEG, GIF, and WebP images are supported.")
        val name = StoredImages.fileName(noteTitle, fileName, data, type)
        val directory = location.imagesDirectory
        val target = File(directory, name)
        try {
            Files.createDirectories(directory.toPath())
            if (!target.exists()) {
                val temporary = File(directory, ".$name.tmp")
                temporary.writeBytes(data)
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
            }
        } catch (error: IOException) {
            return ImageStoreResult.Failed("Could not save the image: ${error.message}")
        }
        return ImageStoreResult.Stored(name)
    }
}
