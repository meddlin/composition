package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.Theme
import com.rushinglabs.composition.core.appearance.ThemeColor
import org.junit.jupiter.api.DisplayName
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The renderer's geometry, ported from InkRendererTests.swift: the same pixels looked at, drawn from `InkRenderer.plan` by `InkRaster`
// instead of CoreGraphics. What these check is the port's geometry and colours; how Canvas antialiases is the app's to check on a device.

@DisplayName("Ink: the renderer's shapes")
class InkRendererTests {
    private val black = InkPalette(ThemeColor(0, 0, 0), ThemeColor(20, 90, 200))
    private val white = InkPalette(ThemeColor(255, 255, 255), ThemeColor(250, 200, 60))

    private fun render(page: InkDocument, palette: InkPalette, scale: Double = 1.0) = InkRaster.render(page, palette, scale)
    private fun render(palette: InkPalette, scale: Double = 1.0) = render(InkSamples.page(), palette, scale)
    private fun near(value: Int, expected: Int, slack: Int = 6) = abs(value - expected) <= slack

    @Test
    @DisplayName("the image has the canvas size times the scale")
    fun theImageHasTheCanvasSizeTimesTheScale() {
        assertEquals(InkImageSize(200, 120), InkRenderer.imageSize(InkSamples.page(), 1.0))
        assertEquals(InkImageSize(600, 360), InkRenderer.imageSize(InkSamples.page(), 3.0))
        assertEquals(InkImageSize(1, 1), InkRenderer.imageSize(InkDocument(0.1, 0.1), 2.0), "never under a pixel")
    }

    @Test
    @DisplayName("the background is transparent and the strokes are not")
    fun theBackgroundIsTransparentAndTheStrokesAreNot() {
        val image = render(black)
        assertEquals(0, image.alpha(0, 0))
        assertEquals(0, image.alpha(199, 119))
        assertTrue(image.inkedPixelCount > 300)
    }

    @Test
    @DisplayName("ink takes the scheme's colour")
    fun inkTakesTheSchemesColour() {
        // The wave's first point is (10, 52); the nib there is 3.5 wide, so the pixel under it is covered.
        val dark = render(black).pixel(10, 52)
        val light = render(white).pixel(10, 52)
        assertTrue(dark.a > 200 && dark.rgb == Triple(0, 0, 0), "$dark")
        assertTrue(light.a > 200 && light.rgb == Triple(255, 255, 255), "$light")
    }

    @Test
    @DisplayName("a fixed colour does not move")
    fun aFixedColourDoesNotMove() {
        // The wide marker is a name; the monoline is fixed red. Give the monoline a wide nib to sample it safely.
        val page = InkSamples.page().let { page ->
            page.copy(strokes = page.strokes.mapIndexed { index, stroke -> if (index == 2) stroke.copy(points = stroke.points.map { it.copy(width = 8.0, height = 8.0) }) else stroke })
        }
        for (palette in listOf(black, white)) {
            val sample = render(page, palette).pixel(90, 24)
            assertTrue(sample.a > 240, "$sample")
            assertEquals(Triple(200, 30, 30), sample.rgb)
        }
    }

    @Test
    @DisplayName("a name takes its hue and the accent takes the scheme's")
    fun aNameTakesItsHueAndTheAccentTakesTheSchemes() {
        val image = render(black)
        val marker = image.pixel(60, 91)
        // Yellow, #f5c518, at the marker's share of its colour.
        assertTrue(near(marker.r, 0xF5) && near(marker.g, 0xC5) && near(marker.b, 0x18), "$marker")
        assertTrue(near(image.pixel(100, 60).b, 200) && near(image.pixel(100, 60).r, 20))
        assertTrue(near(render(white).pixel(100, 60).r, 250))
    }

    @Test
    @DisplayName("a marker is translucent and does not darken where it overlaps")
    fun aMarkerIsTranslucentAndDoesNotDarkenWhereItOverlaps() {
        // Three points a hundred apart with a 14 point nib: the pieces between them overlap at each point. The stroke has one opacity throughout.
        val image = render(black)
        val between = image.alpha(60, 91)
        val atJoint = image.alpha(100, 92)
        // opacity 0.5 of a marker's 0.45 of the colour is 57 of 255.
        assertTrue(near(between, 57, 8), "$between")
        assertTrue(abs(atJoint - between) <= 2, "$atJoint against $between")
        val shape = InkRenderer.plan(InkSamples.page(), black).shapes[1]
        assertEquals(0.45 * 0.5, shape.alpha, 1e-12)
    }

    @Test
    @DisplayName("a name nobody knows is ink")
    fun aNameNobodyKnowsIsInk() {
        var page = InkDocument(20.0, 20.0, listOf(InkStroke(color = InkColor.Semantic("chartreuse"), points = listOf(InkPoint(10.0, 10.0, width = 10.0, height = 10.0)))))
        assertEquals(Triple(255, 255, 255), render(page, white).pixel(10, 10).rgb)
        page = page.copy(strokes = listOf(page.strokes[0].copy(ink = InkType("airbrush"))))
        assertTrue(render(page, black).alpha(10, 10) > 200)
    }

    @Test
    @DisplayName("a single point is a dot")
    fun aSinglePointIsADot() {
        val page = InkDocument(20.0, 20.0, listOf(InkStroke(points = listOf(InkPoint(10.0, 10.0, width = 8.0, height = 8.0)))))
        val image = render(page, black)
        assertTrue(image.alpha(10, 10) > 240)
        assertEquals(0, image.alpha(2, 10))
        assertTrue(image.inkedPixelCount > 30)
        assertEquals(12, InkRenderer.plan(page, black).shapes.single().polygons.single().size, "a nib of 8 is a dozen corners")
    }

    @Test
    @DisplayName("two points are a line")
    fun twoPointsAreALine() {
        val page = InkDocument(40.0, 20.0, listOf(InkStroke(points = listOf(InkPoint(5.0, 10.0, width = 4.0, height = 4.0), InkPoint(35.0, 10.0, width = 4.0, height = 4.0)))))
        val image = render(page, black)
        assertTrue(image.alpha(20, 10) > 240)
        assertEquals(0, image.alpha(20, 3))
    }

    @Test
    @DisplayName("a monoline is one width along its length")
    fun aMonolineIsOneWidthAlongItsLength() {
        val points = listOf(InkPoint(5.0, 20.0, width = 2.0, height = 2.0), InkPoint(40.0, 20.0, width = 10.0, height = 10.0), InkPoint(75.0, 20.0, width = 2.0, height = 2.0))
        val pen = InkDocument(80.0, 40.0, listOf(InkStroke(InkType.PEN, points = points)))
        val mono = InkDocument(80.0, 40.0, listOf(InkStroke(InkType.MONOLINE, points = points)))
        // Mean width 4.67: near the ends the pen is 2 wide and the monoline is not, and in the middle the pen is 10 wide and the monoline is not.
        assertTrue(render(pen, black).alpha(10, 17) < 100)
        assertTrue(render(mono, black).alpha(10, 18) > 200)
        assertTrue(render(pen, black).alpha(40, 16) > 200)
        assertEquals(0, render(mono, black).alpha(40, 16))
    }

    @Test
    @DisplayName("a huge canvas is held to 8,192 pixels")
    fun aHugeCanvasIsHeldToEightThousandPixels() {
        val size = InkRenderer.imageSize(InkDocument(50_000.0, 20_000.0), 2.0)
        assertTrue(size.width <= 8192 && size.height <= 8192)
        assertEquals(8192, size.width)
    }

    @Test
    @DisplayName("an empty drawing is transparent")
    fun anEmptyDrawingIsTransparent() {
        assertEquals(0, render(InkDocument(30.0, 30.0), black).inkedPixelCount)
        assertTrue(InkRenderer.plan(InkDocument(30.0, 30.0, listOf(InkStroke(points = emptyList()))), black).shapes.isEmpty())
    }

    @Test
    @DisplayName("a scheme's palette: ink is its text colour, the accent its brand colour, a name its hue")
    fun paletteFromAScheme() {
        for (theme in Theme.ALL) {
            val palette = InkPalette(theme)
            assertEquals(theme.foreground, palette.color(InkColor.INK), theme.name)
            assertEquals(theme.brand, palette.color(InkColor.ACCENT), theme.name)
            assertEquals(Theme.MARK_HUES["yellow"], palette.color(InkColor.Semantic("yellow")), theme.name)
        }
    }

    @Test
    @DisplayName("the smoothing passes through the control points and samples about every half nib")
    fun theSmoothingPassesThroughTheControlPoints() {
        val points = InkSamples.page().strokes[0].points
        val samples = InkRenderer.smooth(points)
        // Catmull-Rom meets each control point at the end of its segment.
        var at = 0
        for (index in 1 until points.size) {
            val distance = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
            at += minOf(16, maxOf(1, Math.ceil(distance / 1.75).toInt()))
            assertEquals(points[index].x, samples[at].x, 1e-9)
            assertEquals(points[index].y, samples[at].y, 1e-9)
        }
        assertEquals(samples.size - 1, at)
        // Two points or fewer are not smoothed.
        assertEquals(2, InkRenderer.smooth(points.take(2)).size)
        assertNull(InkRenderer.shape(InkStroke(points = emptyList()), ThemeColor(0, 0, 0)))
    }

    @Test
    @DisplayName("the hull is counter-clockwise and holds every point")
    fun theHullHoldsEveryPoint() {
        val points = listOf(InkVector(0.0, 0.0), InkVector(4.0, 0.0), InkVector(2.0, 1.0), InkVector(4.0, 3.0), InkVector(0.0, 3.0), InkVector(2.0, 2.0))
        val hull = InkRenderer.hull(points)
        assertEquals(listOf(InkVector(0.0, 0.0), InkVector(4.0, 0.0), InkVector(4.0, 3.0), InkVector(0.0, 3.0)), hull)
    }
}
