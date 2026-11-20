package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.images.HeaderImageSource
import com.rushinglabs.composition.core.images.ImageLibrary
import com.rushinglabs.composition.core.images.ImageRemoveOutcome
import com.rushinglabs.composition.core.images.ImageStoreResult
import com.rushinglabs.composition.core.images.ImageUse
import com.rushinglabs.composition.core.images.MarkdownImages
import com.rushinglabs.composition.core.images.NoteText
import com.rushinglabs.composition.core.images.StoredImageType
import com.rushinglabs.composition.core.images.StoredImages
import com.rushinglabs.composition.core.images.noteTexts
import com.rushinglabs.composition.core.images.trashedNoteTexts
import com.rushinglabs.composition.core.yaml.JavaScriptText
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Images in notes in plain words, ported from ImagesTests.swift; ImagesConformanceTests holds the same rules against the desktop's
// real functions. The header image and clean-up checks have no desktop twin to compare with.

private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3)
private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 1, 2)

private fun stored(result: ImageStoreResult): String = (result as? ImageStoreResult.Stored)?.name ?: error("not stored: $result")

@DisplayName("Images in notes")
class ImagesTests {
    @Test
    @DisplayName("the bytes say what an image is, and a HEIC photo, SVG or short input is none of the four")
    fun sniffing() {
        assertEquals(StoredImageType.PNG, StoredImages.sniff(png))
        assertEquals(StoredImageType.JPG, StoredImages.sniff(jpeg))
        assertEquals(StoredImageType.GIF, StoredImages.sniff("GIF89a12".toByteArray()))
        assertEquals(StoredImageType.WEBP, StoredImages.sniff("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ".toByteArray()))
        val heic = byteArrayOf(0, 0, 0, 0x18) + "ftypheic".toByteArray()
        assertNull(StoredImages.sniff(heic), "converted to JPEG by the app before it gets here")
        assertNull(StoredImages.sniff("<svg/>".toByteArray()))
        assertNull(StoredImages.sniff(ByteArray(0)))
    }

    @Test
    @DisplayName("a file is named for its note, its own name and its bytes")
    fun naming() {
        val name = StoredImages.fileName("Trip Plan", "Route Map.JPG", png, StoredImageType.PNG)
        assertTrue(name.startsWith("trip-plan-route-map-") && name.endsWith(".png") && name.length == "trip-plan-route-map-".length + 12 + 4, name)
        assertTrue(StoredImages.fileName("日本語", "../../etc/passwd", png, StoredImageType.PNG).startsWith("note-passwd-"), "nothing usable falls back, and a path never escapes")
        assertTrue(StoredImages.fileName("Café ＡＢＣ", "C:\\photos\\Größe.png", png, StoredImageType.PNG).startsWith("cafe-abc-gro-e-"), "accents and full-width letters fold; a sharp s is not a letter a to z")
        assertTrue(StoredImages.isImageName(name))
        assertFalse(StoredImages.isImageName("../x.png"))
        assertFalse(StoredImages.isImageName("x.txt"))
    }

    @Test
    @DisplayName("an image is stored once: the same bytes reuse the file, and the Markdown and tag point at it")
    fun storing(): Unit = withScratch { scratch ->
        val location = DataLocation(scratch)
        val name = stored(StoredImages.store("Trip", "map.png", png, location))
        assertEquals(ImageStoreResult.Stored(name), StoredImages.store("Trip", "map.png", png, location))
        assertEquals(listOf(name), location.imagesDirectory.list()!!.toList(), "no temporary file is left behind")
        assertEquals("![map](app_data/$name)", StoredImages.markdown(name, "map"))
        assertEquals("<Image src=\"app_data/$name\" alt=\"\" />", StoredImages.tag(name))
        assertEquals(setOf(name, "gone.png"), StoredImages.findRefs("see ![map](app_data/$name) and ![gone](app_data/gone.png)."))
    }

    @Test
    @DisplayName("an empty, unsupported or too large image is refused with the desktop's words")
    fun refusing(): Unit = withScratch { scratch ->
        val location = DataLocation(scratch)
        assertEquals(ImageStoreResult.Failed("That image is empty."), StoredImages.store("T", "f.png", ByteArray(0), location))
        assertEquals(ImageStoreResult.Failed("Only PNG, JPEG, GIF, and WebP images are supported."), StoredImages.store("T", "f.txt", "text".toByteArray(), location))
        assertEquals(
            ImageStoreResult.Failed("Images can be at most ${JavaScriptText.numberString(5.0 / 1_048_576)} MB."),
            StoredImages.store("T", "f.png", png, location, maxBytes = 5),
            "the number is written the way JavaScript writes it",
        )
        val big = png.copyOf(10 * 1_048_576 + 9)
        assertEquals(ImageStoreResult.Failed("Images can be at most 10 MB."), StoredImages.store("T", "f.png", big, location, maxBytes = 10L * 1_048_576))
        assertFalse(location.imagesDirectory.exists(), "nothing was written")
    }

    @Test
    @DisplayName("alt text falls back to words from the name, and brackets and line breaks never get into it")
    fun altText() {
        assertEquals("trip plan route map", StoredImages.alt("trip-plan-route-map-3f9c2a71b0de.png"))
        assertEquals("![a](app_data/a-0123456789ab.jpg)", StoredImages.markdown("a-0123456789ab.jpg", null))
        assertEquals("![one two](app_data/a-0123456789ab.jpg)", StoredImages.markdown("a-0123456789ab.jpg", "  [one]\ntwo  "))
    }

    @Test
    @DisplayName("a Markdown image becomes an Image tag that can say how wide to be, and the caret waits inside it")
    fun conversion() {
        val text = "before ![a map](app_data/x.png \"Route\") after"
        val edit = assertNotNull(MarkdownImages.toMdx(text, 12, 12))
        assertEquals("<Image src=\"app_data/x.png\" alt=\"a map\" title=\"Route\" />", edit.text)
        assertEquals("![a map](app_data/x.png \"Route\")", text.substring(edit.start, edit.end))
        assertEquals(edit.text.length - 3, edit.caret, "before ` />`, ready for width=")
        assertNull(MarkdownImages.toMdx(text, 0, 0), "the caret is not on the image")
        assertNull(MarkdownImages.toMdx("```\n![a](x.png)\n```", 0, 19), "code is left alone")
        assertNull(MarkdownImages.toMdx("`![a](x.png)`", 3, 3), "an inline code span too")
        assertEquals("<Image src=\"a&amp;b.png\" alt=\"say &quot;hi&quot; [x]\" />", MarkdownImages.toMdx("![say \"hi\" \\[x\\]](a&b.png)", 0, 0)?.text)
        assertNull(MarkdownImages.toMdx("![a](x\u00A0y.png)", 0, 0), "a no-break space is white space to JavaScript, so the address has a space")
    }

    @Test
    @DisplayName("an image stored by the app goes into a backup and comes out of it")
    fun inABackup(): Unit = withScratch { scratch ->
        val source = DataLocation(File(scratch, "source"))
        check(source.directory.mkdirs())
        CompositionDatabase.open(source).use { database ->
            val name = stored(StoredImages.store("Trip", "map.png", png, source))
            val summary = Backup.create(database, source, File(scratch, "backup.tar.gz"))
            assertEquals(1, summary.counts.images)
            val staged = Backup.stage(summary.file, DataLocation(File(scratch, "target")))
            assertEquals(1, staged.counts.images)
            assertTrue(File(File(staged.directory, "app_data"), name).readBytes().contentEquals(png))
        }
    }

    @Test
    @DisplayName("the stored images are listed newest first with who uses them, and the picker narrows them by words of the name")
    fun theLibrary(): Unit = withScratch { scratch ->
        val location = DataLocation(scratch)
        assertTrue(ImageLibrary.list(location).isEmpty(), "no folder is no images")
        val trip = stored(StoredImages.store("Trip Plan", "route map.png", png, location))
        val recipe = stored(StoredImages.store("Recipes", "pasta.jpg", jpeg, location))
        val folder = location.imagesDirectory
        check(File(folder, trip).setLastModified(1_000_000_000))
        check(File(folder, recipe).setLastModified(2_000_000_000))
        File(folder, "notes.txt").writeText("x")
        File(folder, ".$trip.tmp").writeText("x")

        val notes = listOf(NoteText(4, "Plan", "![map](app_data/$trip)"), NoteText(3, "Other", "no pictures"))
        val library = ImageLibrary.library(location) { notes }
        assertEquals(listOf(recipe, trip), library.map { it.name }, "newest first; the text file and the half-written one are left out")
        assertEquals(listOf(emptyList(), listOf(ImageUse(4, "Plan"))), library.map { it.usedIn })
        assertEquals(listOf(jpeg.size.toLong(), png.size.toLong()), library.map { it.size })
        assertEquals("1970-01-12T13:46:40.000Z", library.last().modifiedAt)

        assertEquals(listOf(trip), ImageLibrary.match(library, "trip map").map { it.name }, "every word, anywhere in the name")
        assertEquals(listOf(recipe, trip), ImageLibrary.match(library, "  ").map { it.name }, "nothing typed offers all of them, in the order given")
        assertEquals(listOf(recipe), ImageLibrary.match(library, "RECIPES").map { it.name }, "case does not matter")
        assertTrue(ImageLibrary.match(library, "nothing").isEmpty())
        assertEquals(listOf(recipe), ImageLibrary.match(library, "", limit = 1).map { it.name })
    }

    @Test
    @DisplayName("the notes are read only when there is an image to say who uses")
    fun notesAreReadOnDemand(): Unit = withScratch { scratch ->
        var reads = 0
        ImageLibrary.library(DataLocation(scratch)) { reads += 1; emptyList() }
        assertEquals(0, reads)
    }

    @Test
    @DisplayName("a note's texts come with its id and title, in the order the sidebar shows them")
    fun noteTexts(): Unit = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val now = Instant.now()
            val first = database.createNote("First", now = now)
            val second = database.createNote("Second", now = now.plusSeconds(5))
            database.saveNoteContent(first.id, "---\ntitle: First\n---\n![x](app_data/x-0123456789ab.png)", now = now.plusSeconds(10))
            val texts = database.noteTexts()
            assertEquals(listOf(first.id, second.id), texts.map { it.id }, "the last edited first")
            assertEquals("First", texts.first().title)
            assertTrue("app_data/x-0123456789ab.png" in texts.first().content)
            assertEquals(listOf(ImageUse(first.id, "First")), ImageLibrary.usage(texts)["x-0123456789ab.png"])
        }
    }

    @Test
    @DisplayName("sizes and counts are written as the picker writes them")
    fun labels() {
        assertEquals("0 B", ImageLibrary.sizeLabel(0))
        assertEquals("1023 B", ImageLibrary.sizeLabel(1023))
        assertEquals("812 KB", ImageLibrary.sizeLabel(812L * 1024))
        assertEquals("2 KB", ImageLibrary.sizeLabel(1536))
        assertEquals("5.4 MB", ImageLibrary.sizeLabel(5L * 1_048_576 + 400_000))
        assertEquals("1.3 MB", ImageLibrary.sizeLabel(1_310_720), "1.25 MB: the larger tenth, as JavaScript's toFixed picks it")
        assertEquals("3189.7 MB", ImageLibrary.sizeLabel(3_344_682_261), "past what a 32-bit Int holds")
        assertEquals("Not used in any note", ImageLibrary.usageLabel(0))
        assertEquals("Used in 1 note", ImageLibrary.usageLabel(1))
        assertEquals("Used in 4 notes", ImageLibrary.usageLabel(4))
    }

    @Test
    @DisplayName("an image goes only when no note, live or in the Trash Can, points at it")
    fun cleanUp(): Unit = withScratch { scratch ->
        val location = DataLocation(scratch)
        val kept = stored(StoredImages.store("Trip", "map.png", png, location))
        val trashed = stored(StoredImages.store("Trip", "old.jpg", jpeg, location))
        val loose = stored(StoredImages.store("Trip", "loose.gif", "GIF89a-loose".toByteArray(), location))
        val live = listOf(NoteText(1, "Trip", "![map](app_data/$kept)"))
        val inTrash = listOf("![old](./app_data/$trashed)")

        val library = ImageLibrary.library(location) { live }
        assertEquals(setOf(trashed, loose), ImageLibrary.unused(library).map { it.name }.toSet(), "the Trash Can's notes do not count as using, as on the desktop")
        assertEquals((png.size + jpeg.size + 12).toLong(), ImageLibrary.totalSize(library))

        assertEquals(ImageRemoveOutcome.UsedByNotes(1), ImageLibrary.remove(kept, location, live, inTrash))
        assertEquals(ImageRemoveOutcome.UsedInTrash, ImageLibrary.remove(trashed, location, live, inTrash))
        assertEquals(ImageRemoveOutcome.NotFound, ImageLibrary.remove("../composition.db", location, live, inTrash))
        assertEquals(ImageRemoveOutcome.NotFound, ImageLibrary.remove("missing-0123456789ab.png", location, live, inTrash))
        assertEquals(ImageRemoveOutcome.Removed, ImageLibrary.remove(loose, location, live, inTrash))
        assertEquals(setOf(kept, trashed), location.imagesDirectory.list()!!.toSet())
    }

    @Test
    @DisplayName("the Trash Can's texts are read for the clean-up")
    fun trashedTexts(): Unit = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val note = database.createNote("Gone")
            database.saveNoteContent(note.id, "---\ntitle: Gone\n---\n![x](app_data/x-0123456789ab.png)")
            database.trashNote(note.id)
            assertTrue(database.noteTexts().isEmpty())
            assertEquals(listOf(setOf("x-0123456789ab.png")), database.trashedNoteTexts().map(StoredImages::findRefs))
        }
    }

    @Test
    @DisplayName("a header image is a stored picture or a web address, and nothing else")
    fun headerImages() {
        assertEquals(HeaderImageSource.Stored("a-0123456789ab.png"), HeaderImageSource.resolve("app_data/a-0123456789ab.png"))
        assertEquals(HeaderImageSource.Stored("a.png"), HeaderImageSource.resolve("./app_data/a.png"))
        assertEquals(HeaderImageSource.Web("HTTPS://example.com/a.png"), HeaderImageSource.resolve("HTTPS://example.com/a.png"))
        assertEquals(HeaderImageSource.Web("http://x"), HeaderImageSource.resolve("http://x"))
        assertNull(HeaderImageSource.resolve("https://"), "nothing after the scheme")
        assertNull(HeaderImageSource.resolve("https://a b.png"), "white space")
        assertNull(HeaderImageSource.resolve("https://a\u3000b.png"), "JavaScript's white space, not only ASCII's")
        assertNull(HeaderImageSource.resolve("http\u017F://a.png"), "a long s is not an s")
        assertNull(HeaderImageSource.resolve("data:image/png;base64,AAAA"))
        assertNull(HeaderImageSource.resolve("app_data/../x.png"))
        assertEquals("a.png", HeaderImageSource.storedName("app_data/a.png"))
        assertNull(HeaderImageSource.storedName("https://example.com/a.png"))
        assertNull(HeaderImageSource.storedName(null))
    }
}
