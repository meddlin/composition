package com.rushinglabs.composition.core.ink

import org.junit.jupiter.api.DisplayName
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Ported from InkCropTests.swift.

@DisplayName("Ink: a new drawing is cut to what was drawn")
class InkCropTests {
    /** A pen line from (100, 200) to (160, 230), with a nib of 4 by 6. */
    private fun line() = InkDocument(
        834.0, 1194.0,
        listOf(InkStroke(points = listOf(InkPoint(100.0, 200.0, width = 4.0, height = 6.0), InkPoint(160.0, 230.0, t = 100.0, width = 4.0, height = 6.0)))),
    )

    @Test
    @DisplayName("the ink bounds are the points grown by half the nib")
    fun theInkBoundsAreThePointsGrownByHalfTheNib() {
        assertEquals(InkRect(98.0, 197.0, 64.0, 36.0), line().inkBounds)
        assertNull(InkDocument(10.0, 10.0).inkBounds)
        assertNull(InkDocument(10.0, 10.0, listOf(InkStroke(points = emptyList()))).inkBounds)
    }

    @Test
    @DisplayName("the cut page has the padding all round")
    fun theCutPageHasThePaddingAllRound() {
        val cut = line().cropped()
        assertEquals(64.0 + 32 to 36.0 + 32, cut.width to cut.height)
        // The first point is half a nib plus the padding from the top left; the strokes moved together.
        assertEquals(100.0 - 98 + 16 to 200.0 - 197 + 16, cut.strokes[0].points[0].x to cut.strokes[0].points[0].y)
        assertEquals(160.0 - 98 + 16 to 230.0 - 197 + 16, cut.strokes[0].points[1].x to cut.strokes[0].points[1].y)
        // The ink touches no side: its bounds sit inside the page with the padding left over on every side.
        val ink = assertNotNull(cut.inkBounds)
        assertTrue(ink.minX == 16.0 && ink.minY == 16.0 && ink.maxX == cut.width - 16 && ink.maxY == cut.height - 16)
        // The rest of the stroke is untouched.
        assertTrue(cut.strokes[0].points[1].t == 100.0 && cut.strokes[0].points[1].width == 4.0)
    }

    @Test
    @DisplayName("a lone dot gets a page of the minimum side round its middle")
    fun aLoneDotGetsAPageOfTheMinimumSideRoundItsMiddle() {
        val dot = InkDocument(834.0, 1194.0, listOf(InkStroke(points = listOf(InkPoint(400.0, 500.0, width = 3.0, height = 3.0)))))
        val cut = dot.cropped()
        assertEquals(InkCrop.MINIMUM_SIDE to InkCrop.MINIMUM_SIDE, cut.width to cut.height)
        assertEquals(InkCrop.MINIMUM_SIDE / 2 to InkCrop.MINIMUM_SIDE / 2, cut.strokes[0].points[0].x to cut.strokes[0].points[0].y)
    }

    @Test
    @DisplayName("a drawing with no ink is left alone")
    fun aDrawingWithNoInkIsLeftAlone() {
        val empty = InkDocument(834.0, 1194.0)
        assertEquals(empty, empty.cropped())
        assertNull(empty.cropBox())
    }

    @Test
    @DisplayName("cutting again changes nothing")
    fun cuttingAgainChangesNothing() {
        val once = line().cropped()
        assertEquals(once, once.cropped())
        // And the page opened for editing, moved by the room it is given and cut on Done, comes back as it was.
        val reopened = once.translated(InkCrop.EDITING_ROOM, InkCrop.EDITING_ROOM, InkSize(834.0, 1194.0))
        assertEquals(once, reopened.cropped())
    }

    @Test
    @DisplayName("the cut box is at the format's step, so writing it changes nothing")
    fun theCutBoxIsAtTheFormatsStepSoWritingItChangesNothing() {
        val odd = InkDocument(
            834.0, 1194.0,
            listOf(InkStroke(points = listOf(InkPoint(100.123, 200.456, width = 3.33, height = 3.33), InkPoint(160.987, 230.001, width = 3.33, height = 3.33)))),
        )
        val cut = odd.cropped()
        val again = InkDocument.fromJson(cut.json)
        assertEquals(cut.json, again.json)
        assertTrue(abs(again.width - cut.width) < 0.005 && abs(again.height - cut.height) < 0.005)
    }
}
