package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.images.StoredImageType
import com.rushinglabs.composition.core.images.StoredImages
import com.rushinglabs.composition.core.withScratch
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Ported from InkPNGTests.swift. The Swift renders the PNG with CoreGraphics; here `InkRaster` draws it as the app's Canvas would, and
// `InkRenderer.pngData` adds the density and the chunks, as on the device.

@DisplayName("Ink: the PNG that carries its strokes")
class InkPNGTests {
    private val palette = InkPalette(ThemeColor(0, 0, 0), ThemeColor(20, 90, 200))

    private fun png(page: InkDocument = InkSamples.page(), pencilKit: ByteArray? = null): ByteArray =
        InkRaster.pngData(page, palette, 2.0, pencilKit)

    /** Replaces the payload of the first chunk of `type`, and writes the CRC that goes with it unless `keepCrc`. */
    private fun patched(data: ByteArray, type: String, keepCrc: Boolean = false, change: (ByteArray) -> Unit): ByteArray {
        val out = data.copyOf()
        val chunk = assertNotNull(InkPng.walk(data).firstOrNull { it.type == type })
        val body = data.copyOfRange(chunk.start + 8, chunk.end - 4)
        change(body)
        body.copyInto(out, chunk.start + 8)
        if (!keepCrc) InkCorpus.bigEndian(InkPng.crc(out, chunk.start + 4, chunk.end - 4)).copyInto(out, chunk.end - 4)
        return out
    }

    @Test
    @DisplayName("the strokes come back from the PNG")
    fun theStrokesComeBackFromThePNG() {
        val blob = ByteArray(5000) { (it % 251).toByte() }
        var contents = InkPng.contents(png(pencilKit = blob))
        assertEquals(InkSamples.page(), contents.drawing())
        assertTrue(blob.contentEquals(contents.pencilKit))
        assertEquals(emptyList(), contents.problems)
        contents = InkPng.contents(png())
        assertNull(contents.pencilKit)
    }

    @Test
    @DisplayName("any image viewer still sees the pixels")
    fun anyImageViewerStillSeesThePixels() {
        val data = png()
        assertEquals(StoredImageType.PNG, StoredImages.sniff(data))
        val image = TestPng.decode(data)
        assertEquals(400 to 240, image.width to image.height)
        assertTrue(image.inkedPixelCount > 500)
        assertEquals(InkImageSize(400, 240), InkPng.pixelSize(data))
        assertEquals(2.0, InkPng.pixelsPerPoint(data))
    }

    @Test
    @DisplayName("the chunks sit before the end")
    fun theChunksSitBeforeTheEnd() {
        val types = InkPng.walk(png(pencilKit = byteArrayOf(1, 2, 3))).map { it.type }
        assertEquals("IHDR", types.first())
        assertEquals(listOf("inKJ", "inKP", "IEND"), types.takeLast(3))
        assertTrue("IDAT" in types)
        assertEquals("pHYs", types[1], "the density comes right after the header")
        // Private, ancillary, and unsafe to copy: the name's four case bits.
        for (name in listOf(InkPng.JSON_CHUNK, InkPng.PENCIL_KIT_CHUNK)) {
            val bytes = name.encodeToByteArray()
            assertTrue(bytes[0].toInt() and 0x20 != 0, "ancillary")
            assertTrue(bytes[1].toInt() and 0x20 != 0, "private")
            assertTrue(bytes[2].toInt() and 0x20 == 0, "reserved bit")
            assertTrue(bytes[3].toInt() and 0x20 == 0, "unsafe to copy")
        }
    }

    @Test
    @DisplayName("embedding again replaces the old chunks")
    fun embeddingAgainReplacesTheOldChunks() {
        val first = png(pencilKit = byteArrayOf(9, 9, 9))
        val other = InkSamples.page().let { it.copy(strokes = it.strokes.dropLast(1)) }
        val second = InkPng.embedding(other, null, first)
        val types = InkPng.walk(second).map { it.type }
        assertEquals(1, types.count { it == "inKJ" })
        assertFalse("inKP" in types)
        assertEquals(other, InkPng.contents(second).drawing())
        val bare = InkPng.embedding(null, null, second)
        assertTrue(InkPng.walk(bare).all { it.type != "inKJ" && it.type != "inKP" })
        assertNull(InkPng.contents(bare).drawing())
        // The pixels are the same bytes throughout.
        val pixels = { png: ByteArray -> InkPng.walk(png).filter { it.type == "IDAT" }.map { png.copyOfRange(it.start, it.end).toList() } }
        assertEquals(pixels(first), pixels(bare))
    }

    @Test
    @DisplayName("a damaged chunk is reported and the pixels stay")
    fun aDamagedChunkIsReportedAndThePixelsStay() {
        val data = png(pencilKit = byteArrayOf(1, 2, 3))
        val flipped = patched(data, "inKJ", keepCrc = true) { it[it.size - 3] = (it[it.size - 3].toInt() xor 0xFF).toByte() }
        val contents = InkPng.contents(flipped)
        assertNull(contents.strokeJson)
        assertEquals(listOf("The inKJ chunk is damaged."), contents.problems)
        assertTrue(byteArrayOf(1, 2, 3).contentEquals(contents.pencilKit))
        assertEquals(400, TestPng.decode(flipped).width)
    }

    @Test
    @DisplayName("a newer chunk is left alone")
    fun aNewerChunkIsLeftAlone() {
        val data = patched(png(), "inKJ") { it[0] = 2 }
        val contents = InkPng.contents(data)
        assertNull(contents.strokeJson)
        assertEquals(listOf("The inKJ chunk is from a newer version."), contents.problems)
    }

    @Test
    @DisplayName("text that does not unpack is reported")
    fun textThatDoesNotUnpackIsReported() {
        // Flip a byte inside the zlib stream and write the CRC to match, so the chunk is intact but its contents are not.
        val data = patched(png(), "inKJ") { it[it.size / 2] = (it[it.size / 2].toInt() xor 0x55).toByte() }
        val contents = InkPng.contents(data)
        assertNull(contents.strokeJson)
        assertEquals(listOf("The inKJ chunk does not unpack."), contents.problems)
    }

    @Test
    @DisplayName("a length that lies is refused")
    fun aLengthThatLiesIsRefused() {
        // The unpacked size is the first four bytes after the version; claim a size the stream does not hold.
        val data = patched(png(), "inKJ") { it[1] = 0x10 }
        assertEquals(listOf("The inKJ chunk does not unpack."), InkPng.contents(data).problems)
        val huge = patched(png(), "inKJ") { it[1] = 0xFF.toByte() }
        assertEquals(listOf("The inKJ chunk does not unpack."), InkPng.contents(huge).problems)
        // A size a little short or a little long of what the stream holds.
        for (delta in listOf(-1, 1)) {
            val off = patched(png(), "inKJ") {
                val size = InkPng.readBigEndian(it, 1) + delta
                InkCorpus.bigEndian(size).copyInto(it, 1)
            }
            assertEquals(listOf("The inKJ chunk does not unpack."), InkPng.contents(off).problems, "off by $delta")
        }
    }

    @Test
    @DisplayName("something that is not a PNG is refused")
    fun somethingThatIsNotAPNGIsRefused() {
        assertFailsWith<InkError> { InkPng.contents("not a picture, but long enough to try".encodeToByteArray()) }
        assertFailsWith<InkError> { InkPng.contents(ByteArray(0)) }
        val whole = png()
        assertFailsWith<InkError> { InkPng.contents(whole.copyOf(whole.size - 20)) }
        assertFailsWith<InkError> { InkPng.embedding(InkSamples.page(), null, ByteArray(64)) }
        // A broken PNG is drawn at 2 pixels to a point, as the iPad draws.
        assertEquals(2.0, InkPng.pixelsPerPoint(whole.copyOf(whole.size - 20)))
    }

    @Test
    @DisplayName("a PNG without ink is ordinary")
    fun aPNGWithoutInkIsOrdinary() {
        val bare = InkPng.embedding(null, null, png())
        assertEquals(InkPng.Contents(), InkPng.contents(bare))
    }

    @Test
    @DisplayName("the tag names the stored picture")
    fun theTagNamesTheStoredPicture() {
        assertEquals("<Ink src=\"app_data/trip-drawing-0123456789ab.png\" alt=\"Drawing\" />", InkTag.markdown("trip-drawing-0123456789ab.png"))
        assertEquals(
            "<Ink src=\"app_data/a.png\" alt=\"a quoted bname\" width=\"50%\" />",
            InkTag.markdown("a.png", alt = "a \"quoted\" <b>\nname", width = "50%"),
        )
        // A Windows line break goes too (the Swift keeps a `\r\n` pair, which is one Character there).
        assertEquals("<Ink src=\"app_data/a.png\" alt=\"onetwo\" />", InkTag.markdown("a.png", alt = "one\r\ntwo"))
        val text = "before\n\n<Ink src=\"app_data/old.png\" alt=\"Drawing\" width=\"80%\" />\n\nand again ![x](app_data/old.png)"
        val changed = InkTag.replacing("old.png", "new.png", text)
        assertTrue(changed.contains("app_data/new.png") && !changed.contains("old.png"))
    }

    @Test
    @DisplayName("the words read from a drawing replace only words no person wrote")
    fun theWordsReadFromADrawingReplaceOnlyWordsNoPersonWrote() {
        fun tag(name: String, alt: String, rest: String = "") = "<Ink src=\"app_data/$name\" alt=\"$alt\"$rest />"
        val text = "a\n\n${tag("new.png", "Drawing", " width=\"50%\"")}\n\nb ${tag("other.png", "Drawing")}\n\n${tag("new.png", "meeting notes")}\n\n${tag("new.png", "my own words")}"
        // The default, an empty alt and the words read last time are refreshed, only for this drawing; a person's words are left.
        val changed = InkTag.refreshingAlt("new.png", "meeting notes", "meeting notes and a list", text)
        assertEquals(
            "a\n\n${tag("new.png", "meeting notes and a list", " width=\"50%\"")}\n\nb ${tag("other.png", "Drawing")}\n\n${tag("new.png", "meeting notes and a list")}\n\n${tag("new.png", "my own words")}",
            changed,
        )
        // Without any words (the drawing is only a picture) the alt is the default again, but not when a person wrote it.
        assertEquals(tag("new.png", "Drawing"), InkTag.refreshingAlt("new.png", "meeting notes", "", tag("new.png", "meeting notes")))
        assertEquals(tag("new.png", "hello"), InkTag.refreshingAlt("new.png", null, "hello", tag("new.png", "")))
        assertEquals(tag("new.png", "meeting notes"), InkTag.refreshingAlt("new.png", null, "hello", tag("new.png", "meeting notes")))
        // A tag without an alt, text with no tag, and a name that is a prefix of another are left as they are.
        assertEquals("<Ink src=\"app_data/new.png\" />", InkTag.refreshingAlt("new.png", null, "hello", "<Ink src=\"app_data/new.png\" />"))
        assertEquals(tag("new.png.bak", "Drawing"), InkTag.refreshingAlt("new.png", null, "hello", tag("new.png.bak", "Drawing")))
        // Quotes and angle brackets cannot be in an attribute.
        assertEquals(tag("new.png", "say hi now"), InkTag.refreshingAlt("new.png", null, "say \"hi\" <now>", tag("new.png", "Drawing")))
        // `<Ink` must end a word (`<Inkwell>` is not a tag), and `alt` must start one (`data_alt` is not the alt; `data-alt` would be, as `-` ends a word).
        val near = "<Inkwell src=\"app_data/new.png\" alt=\"Drawing\" /> <Ink src=\"app_data/new.png\" data_alt=\"x\" alt=\"\" />"
        assertEquals("<Inkwell src=\"app_data/new.png\" alt=\"Drawing\" /> <Ink src=\"app_data/new.png\" data_alt=\"x\" alt=\"hello\" />", InkTag.refreshingAlt("new.png", null, "hello", near))
        assertEquals("<Ink alt=\"Drawing\"", InkTag.refreshingAlt("new.png", null, "hello", "<Ink alt=\"Drawing\""), "a tag that never closes")
    }

    @Test
    @DisplayName("a stored file is only ink if it carries ink")
    fun aStoredFileIsOnlyInkIfItCarriesInk() = withScratch { folder ->
        val withInk = File(folder, "a.png").apply { writeBytes(png()) }
        val plain = File(folder, "b.png").apply { writeBytes(InkPng.embedding(null, null, png())) }
        val notPng = File(folder, "c.jpg").apply { writeBytes(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())) }
        assertNotNull(InkTag.contents(withInk)?.strokeJson)
        assertNull(InkTag.contents(plain))
        assertNull(InkTag.contents(notPng))
        assertNull(InkTag.contents(File(folder, "missing.png")))
    }
}
