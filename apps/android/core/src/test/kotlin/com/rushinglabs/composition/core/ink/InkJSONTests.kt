package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.json.JsonMember
import com.rushinglabs.composition.core.json.JsonValue
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Ported from InkJSONTests.swift.

@DisplayName("Ink: the stroke JSON")
class InkJSONTests {
    @Test
    @DisplayName("a drawing comes back as it went")
    fun aDrawingComesBackAsItWent() {
        val page = InkSamples.page()
        assertEquals(page, InkDocument.fromData(page.jsonData()))
    }

    @Test
    @DisplayName("numbers are written short")
    fun numbersAreWrittenShort() {
        val page = InkDocument(100.0, 100.0, listOf(InkStroke(points = listOf(InkPoint(0.1 + 0.2, 1.0 / 3, t = 7.0000001, force = 0.30000000000000004)))))
        val text = page.jsonData().decodeToString()
        // 0.1 + 0.2 and a third, written at a hundredth; the force at a thousandth: no long tails.
        assertTrue(text.contains("[[0.3,0.33,7,0.3,"), text)
    }

    @Test
    @DisplayName("the columns are named once")
    fun theColumnsAreNamedOnce() {
        val text = InkSamples.page().jsonData().decodeToString()
        assertEquals(2, text.split("\"force\"").size)
        assertTrue(text.startsWith("{\"format\":\"composition-ink\",\"version\":1,\"canvas\":{\"width\":200,\"height\":120},\"fields\":[\"x\",\"y\","))
    }

    @Test
    @DisplayName("what is not understood is kept")
    fun whatIsNotUnderstoodIsKept() {
        var page = InkSamples.page()
        val first = page.strokes[0].copy(
            extra = listOf(JsonMember("seed", JsonValue.Number(7.0))),
            extraColumns = listOf(InkExtraColumn("tiltX", page.strokes[0].points.indices.map { JsonValue.Number(it / 10.0) })),
        )
        page = page.copy(
            extra = listOf(JsonMember("author", JsonValue.Text("somebody")), JsonMember("layers", JsonValue.Array(listOf(JsonValue.Number(1.0), JsonValue.Null)))),
            strokes = listOf(first) + page.strokes.drop(1),
        )
        // The second stroke has no such column: its cells are null, and come back as the column, with nulls.
        val back = InkDocument.fromData(page.jsonData())
        assertEquals(page.extra, back.extra)
        assertEquals(page.strokes[0].extra, back.strokes[0].extra)
        assertEquals(page.strokes[0].extraColumns, back.strokes[0].extraColumns)
        assertEquals(listOf(InkExtraColumn("tiltX", List(back.strokes[1].points.size) { JsonValue.Null })), back.strokes[1].extraColumns)
        // And a second round trip changes nothing.
        assertEquals(back, InkDocument.fromData(back.jsonData()))
    }

    @Test
    @DisplayName("a point that is not finite writes as the default")
    fun aNonFinitePointWritesAsTheDefault() {
        val page = InkDocument(10.0, 10.0, listOf(InkStroke(points = listOf(InkPoint(1.0, 2.0, force = Double.NaN, width = Double.POSITIVE_INFINITY)))))
        val back = InkDocument.fromData(page.jsonData())
        assertEquals(1.0, back.strokes[0].points[0].force)
        assertEquals(3.0, back.strokes[0].points[0].width)
    }

    @Test
    @DisplayName("an edited point keeps its siblings")
    fun anEditedPointKeepsItsSiblings() {
        val back = InkDocument.fromData(InkSamples.page().jsonData())
        val firstStroke = back.strokes[0]
        val moved = firstStroke.copy(points = listOf(firstStroke.points[0].copy(x = firstStroke.points[0].x + 5)) + firstStroke.points.drop(1))
        val again = InkDocument.fromData(back.copy(strokes = listOf(moved) + back.strokes.drop(1)).jsonData())
        assertEquals(InkSamples.page().strokes[0].points[0].x + 5, again.strokes[0].points[0].x)
        assertEquals(InkSamples.page().strokes[1], again.strokes[1])
    }

    @Test
    @DisplayName("too many strokes are refused")
    fun tooManyStrokesAreRefused() {
        val strokes = "{\"points\":[]},".repeat(InkLimits.MAX_STROKES + 1).dropLast(1)
        val text = "{\"format\":\"composition-ink\",\"version\":1,\"canvas\":{\"width\":10,\"height\":10},\"strokes\":[$strokes]}"
        assertFailsWith<InkError> { InkDocument.fromData(text.encodeToByteArray()) }
    }

    @Test
    @DisplayName("the PencilKit blob is current until the strokes change")
    fun theBlobIsCurrentUntilTheStrokesChange() {
        var page = InkSamples.page()
        assertFalse(page.pencilKitBlobIsCurrent)
        page = page.markingPencilKitCurrent()
        assertTrue(page.pencilKitBlobIsCurrent)
        // It survives being written and read, and marking again does not stack members.
        var back = InkDocument.fromData(page.jsonData())
        assertTrue(back.pencilKitBlobIsCurrent)
        back = back.markingPencilKitCurrent()
        assertEquals(1, back.extra.count { it.key == "pencilKit" })
        // Another program moves a point and keeps the member it does not know: the blob is stale.
        val stroke = back.strokes[0]
        back = back.copy(strokes = listOf(stroke.copy(points = listOf(stroke.points[0].copy(x = stroke.points[0].x + 1)) + stroke.points.drop(1))) + back.strokes.drop(1))
        assertFalse(back.pencilKitBlobIsCurrent)
        // Which does not depend on the colour of the page or the order of anything else.
        val other = InkSamples.page().copy(extra = listOf(JsonMember("author", JsonValue.Text("x"))))
        assertEquals(InkSamples.page().strokesDigest, other.strokesDigest)
        // The digest is SHA-256 of the strokes' text: 64 hex digits, the same for the same strokes on every platform.
        assertTrue(Regex("[0-9a-f]{64}").matches(other.strokesDigest))
    }

    @Test
    @DisplayName("damaged text is refused")
    fun damagedTextIsRefused() {
        assertFailsWith<InkError> { InkDocument.fromData("{\"format\":".encodeToByteArray()) }
        val notUtf8 = assertFailsWith<InkError> { InkDocument.fromData(byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0)) }
        assertEquals("This drawing's text is not UTF-8.", notUtf8.message)
        assertFailsWith<InkError> { InkDocument.fromData(ByteArray(0)) }
    }

    @Test
    @DisplayName("colour names")
    fun colourNames() {
        assertEquals(InkColor.INK, InkColor.parse("ink"))
        assertEquals(InkColor.ACCENT, InkColor.parse("accent"))
        assertEquals(InkColor.Semantic("light-blue"), InkColor.parse("light-blue"))
        assertEquals(InkColor.Fixed(ThemeColor(0xAB, 0xCD, 0xEF)), InkColor.parse("#ABCDEF"))
        assertEquals("#abcdef", InkColor.parse("#abcdef")?.text)
        assertNull(InkColor.parse("Ink"))
        assertNull(InkColor.parse(""))
        assertNull(InkColor.parse("#abc"))
        assertNull(InkColor.parse("a".repeat(33)))
        // A letter outside ASCII is not a name, whatever case it is.
        assertNull(InkColor.parse("gr\u00FCn"))
    }
}
