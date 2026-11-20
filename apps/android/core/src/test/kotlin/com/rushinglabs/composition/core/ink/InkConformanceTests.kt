package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.skipUnless
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.util.Locale
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// The ink format against the shared corpus in fixtures/conformance/ink (fixtures/conformance/README.md), ported from
// InkConformanceTests.swift. This corpus was written by the iPad's Swift first; the desktop's TypeScript reader (`ink.ts`, `inkPng.ts`,
// run against it by `ink.test.ts`, `inkPng.test.ts`, `inkSvg.test.ts` and `inkBackup.test.ts`) was built against it, and so is this one:
//
//   validation.json  what a reader must accept and what it writes back, and what it must refuse (written by hand)
//   drawing.json     the stroke JSON of `InkSamples.page()`, as the Swift writes it
//   sample.png       the same drawing rendered by the Swift with the default scheme's colours, with the same JSON in its `inKJ` chunk
//   containers.json  what a reader must find in each PNG: the drawing's width, the problems it reports, the pixel density
//   renderer.json    the tables a renderer must agree on: each ink's share of its colour, the mark hues, the dark style of a fixed colour
//
// Beyond the Swift suite, the last two tests hold the Kotlin renderer's geometry to the Swift renderer's own pictures, sample.png and
// wide.png: the same size, the same density chunk, and ink on the same pixels.

private fun corpus(): File {
    val directory = InkCorpus.directory
    skipUnless(directory != null, "fixtures/conformance/ink is not here")
    return directory!!
}

private fun read(name: String): JsonValue = JsonValue.parse(File(corpus(), name).readText())

@DisplayName("Ink: the shared corpus")
class InkConformanceTests {
    @Test
    @DisplayName("every validation case is read and written back as stored, or refused")
    fun validationCases() {
        val cases = assertNotNull(read("validation.json").objectValue?.get("cases")?.arrayValue)
        assertTrue(cases.size >= 40)
        var refused = 0
        val notRefused = ArrayList<String>()
        val rewritten = ArrayList<String>()
        val different = ArrayList<String>()
        for (entry in cases) {
            val case = assertNotNull(entry.objectValue)
            val name = case["name"]?.stringValue ?: "?"
            val input = assertNotNull(case["input"], "$name: no input")
            if (case["invalid"] == JsonValue.Bool(true)) {
                refused += 1
                try {
                    InkDocument.fromJson(input)
                    notRefused.add(name)
                } catch (_: InkError) {
                }
            } else {
                val drawing = InkDocument.fromJson(input)
                if (drawing.json != case["stored"]) different.add("$name: ${drawing.json.serialized()}")
                // What is written back is stable: reading it and writing it again changes nothing (the first write already rounded).
                if (InkDocument.fromJson(drawing.json).json != drawing.json) rewritten.add(name)
            }
        }
        println("Ink, validation.json: ${cases.size - notRefused.size - rewritten.size - different.size} of ${cases.size} cases agree with the desktop")
        assertEquals(emptyList(), notRefused, "cases that must be refused")
        assertEquals(emptyList(), different, "cases that do not write back as `stored`")
        assertEquals(emptyList(), rewritten, "cases that change when written, read and written again")
        assertTrue(refused >= 30)
    }

    @Test
    @DisplayName("the committed drawing is what this code writes, byte for byte")
    fun theCommittedDrawingIsWhatThisCodeWrites() {
        val page = InkSamples.page()
        val text = File(corpus(), "drawing.json").readBytes()
        val committed = JsonValue.parse(text.decodeToString())
        assertEquals(page.json, committed)
        assertEquals(page, InkDocument.fromJson(committed))
        assertEquals(text.decodeToString(), page.jsonData().decodeToString(), "the same text, not only the same value")
    }

    @Test
    @DisplayName("the committed PNG carries that drawing")
    fun theCommittedPNGCarriesThatDrawing() {
        val png = File(corpus(), "sample.png").readBytes()
        val contents = InkPng.contents(png)
        assertEquals(emptyList(), contents.problems)
        assertEquals(InkSamples.page(), contents.drawing())
        val chunk = assertNotNull(contents.strokeJson)
        assertTrue(chunk.contentEquals(File(corpus(), "drawing.json").readBytes()))
    }

    @Test
    @DisplayName("each PNG gives the drawing, the problems and the density containers.json names")
    fun containerCases() {
        val cases = assertNotNull(read("containers.json").objectValue?.get("cases")?.arrayValue)
        assertTrue(cases.size >= 4)
        val different = ArrayList<String>()
        for (entry in cases) {
            val case = assertNotNull(entry.objectValue)
            val file = assertNotNull(case["file"]?.stringValue)
            val png = File(corpus(), file).readBytes()
            val contents = InkPng.contents(png)
            if (contents.problems != case["problems"]?.arrayValue?.mapNotNull { it.stringValue }) different.add("$file: problems ${contents.problems}")
            if (contents.drawing()?.width != case["width"]?.doubleValue) different.add("$file: the drawing it carries")
            if (InkPng.pixelsPerPoint(png) != case["pixelsPerPoint"]?.doubleValue) different.add("$file: pixels to a point ${InkPng.pixelsPerPoint(png)}")
        }
        println("Ink, containers.json: ${cases.size - different.map { it.substringBefore(':') }.toSet().size} of ${cases.size} PNGs agree with the desktop")
        assertEquals(emptyList(), different)
    }

    @Test
    @DisplayName("each ink's share of its colour, the mark hues and an unknown name are renderer.json's")
    fun rendererTables() {
        val corpus = assertNotNull(read("renderer.json").objectValue)
        val inks = assertNotNull(corpus["inks"]?.objectValue)
        assertTrue(inks.members.size >= 8)
        val different = ArrayList<String>()
        for (member in inks.members) {
            val style = InkRenderer.Style.of(InkType(member.key))
            if (style.alpha != member.value.objectValue?.get("alpha")?.doubleValue) different.add("${member.key}: alpha")
            if (style.constantWidth != (member.value.objectValue?.get("oneWidth") == JsonValue.Bool(true))) different.add("${member.key}: one width")
        }
        val marks = assertNotNull(corpus["marks"]?.objectValue)
        assertEquals(InkPalette.MARK_HUES.keys, marks.members.map { it.key }.toSet())
        val palette = InkPalette(ThemeColor(1, 2, 3), ThemeColor(4, 5, 6))
        for (member in marks.members) {
            if (palette.color(InkColor.Semantic(member.key)).hex != member.value.stringValue) different.add("mark ${member.key}")
        }
        assertEquals("ink", corpus["unknownColourName"]?.stringValue)
        assertEquals(palette.ink, palette.color(InkColor.Semantic("teal")))
        val total = inks.members.size + marks.members.size
        println("Ink, renderer.json: ${total - different.size} of $total inks and hues agree with the desktop")
        assertEquals(emptyList(), different)
    }

    @Test
    @DisplayName("a fixed colour on a dark scheme is PencilKit's dark style, and names do not change with the style")
    fun darkStyleColours() {
        val pairs = assertNotNull(read("renderer.json").objectValue?.get("darkStyle")?.objectValue?.get("pairs")?.arrayValue)
        assertTrue(pairs.size >= 12)
        val light = InkPalette(ThemeColor(1, 2, 3), ThemeColor(4, 5, 6))
        val dark = light.copy(darkStyle = true)
        val different = ArrayList<String>()
        for (pair in pairs) {
            val hexes = pair.arrayValue.orEmpty().mapNotNull { it.stringValue }
            assertEquals(2, hexes.size)
            val stored = assertNotNull(ThemeColor.fromHex(hexes[0]))
            if (stored.darkStyle.hex != hexes[1]) different.add("${hexes[0]} on a dark scheme is ${stored.darkStyle.hex}, not ${hexes[1]}")
            assertEquals(hexes[1], dark.color(InkColor.Fixed(stored)).hex)
            assertEquals(stored, light.color(InkColor.Fixed(stored)), "a light scheme draws it as stored")
            // Names do not change with the scheme's style: `ink` and `accent` come from the scheme, a mark hue is its hue.
            assertEquals(dark.ink, dark.color(InkColor.INK))
            assertEquals(InkPalette.MARK_HUES["blue"], dark.color(InkColor.Semantic("blue")))
        }
        println("Ink, renderer.json dark style: ${pairs.size - different.size} of ${pairs.size} colours agree with the desktop")
        assertEquals(emptyList(), different)
    }

    @Test
    @DisplayName("the Swift renderer's PNGs have the size and the density chunk this code works out")
    fun theSwiftPicturesHaveThisSizeAndDensity() {
        val wide = InkDocument(5000.0, 40.0, listOf(InkStroke(points = listOf(InkPoint(10.0, 20.0), InkPoint(2500.0, 10.0, t = 400.0), InkPoint(4990.0, 20.0, t = 800.0)))))
        for ((file, drawing) in listOf("sample.png" to InkSamples.page(), "wide.png" to wide)) {
            val png = File(corpus(), file).readBytes()
            assertEquals(InkRenderer.imageSize(drawing), InkPng.pixelSize(png), "$file: pixels")
            assertEquals(drawing, InkPng.contents(png).drawing(), "$file: strokes")
            // Made again from the Swift's own pixels (its chunks taken off), the PNG says the same density in the same bytes.
            val pixels = InkPng.embedding(null, null, png)
            val again = InkRenderer.pngData(drawing, pixels)
            assertEquals(physBody(png), physBody(again), "$file: the pHYs chunk")
            assertEquals(InkPng.pixelsPerPoint(png), InkPng.pixelsPerPoint(again))
            assertEquals(drawing, InkPng.contents(again).drawing())
        }
    }

    @Test
    @DisplayName("the Kotlin geometry inks the pixels the Swift renderer inked")
    fun theGeometryMatchesTheSwiftPictures() {
        // The default scheme (Dark): the text colour for ink, the brand colour for the accent, fixed colours in PencilKit's dark style.
        val palette = InkPalette(ThemeColor.fromHex("#e0e0e0")!!, ThemeColor.fromHex("#0178d4")!!, darkStyle = true)
        val wide = InkDocument(5000.0, 40.0, listOf(InkStroke(points = listOf(InkPoint(10.0, 20.0), InkPoint(2500.0, 10.0, t = 400.0), InkPoint(4990.0, 20.0, t = 800.0)))))
        var compared = 0
        var agreeing = 0
        for ((file, drawing) in listOf("sample.png" to InkSamples.page(), "wide.png" to wide)) {
            val swift = TestPng.decode(File(corpus(), file).readBytes())
            val kotlin = InkRaster.render(drawing, palette)
            assertEquals(swift.width to swift.height, kotlin.width to kotlin.height)
            var inked = 0
            var far = 0
            var worst = 0
            var colourOff = 0
            for (y in 0 until swift.height) {
                for (x in 0 until swift.width) {
                    val a = swift.alpha(x, y)
                    val b = kotlin.alpha(x, y)
                    if (a == 0 && b == 0) continue
                    inked += 1
                    val difference = abs(a - b)
                    worst = maxOf(worst, difference)
                    // An edge pixel's share differs by the two ways of measuring it; more than a quarter is ink in the wrong place.
                    if (difference > 64) far += 1
                    if (a == 255 && b == 255) {
                        val p = swift.pixel(x, y)
                        val q = kotlin.pixel(x, y)
                        if (abs(p.r - q.r) > 1 || abs(p.g - q.g) > 1 || abs(p.b - q.b) > 1) colourOff += 1
                    }
                }
            }
            compared += inked
            agreeing += inked - far - colourOff
            println(String.format(Locale.ROOT, "Ink, %s: %d of %d inked pixels agree with the iPad's renderer (largest difference in alpha %d of 255)", file, inked - far - colourOff, inked, worst))
            assertTrue(inked > 300, "$file: something is drawn")
            assertEquals(0, far, "$file: pixels whose alpha differs by more than a quarter, of $inked")
            assertEquals(0, colourOff, "$file: solid pixels of another colour")
        }
        assertTrue(agreeing > 0 && compared > 0)
    }

    private fun physBody(png: ByteArray): String {
        val chunk = assertNotNull(InkPng.walk(png).firstOrNull { it.type == "pHYs" })
        return png.copyOfRange(chunk.start + 8, chunk.end - 4).joinToString(" ") { (it.toInt() and 0xFF).toString() }
    }
}
