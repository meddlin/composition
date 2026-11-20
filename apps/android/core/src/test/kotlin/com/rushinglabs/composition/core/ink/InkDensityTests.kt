package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.skipUnless
import org.junit.jupiter.api.DisplayName
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Ported from InkDensityTests.swift. Gate C asks how big a dense page is, to decide whether the stroke JSON can ride in the PNG
// (docs/ipad-app-design.md, S5). These make a dense page without randomness and measure what it costs to write, store and read, and to
// work out the shapes to draw (the pixels are the app's Canvas, which is not here). The numbers print, and the assertions are only that
// nothing is absurd: docs/architecture/ink.md has the iPad's table.
//
// A real page: Apple Notes' handwriting is some hundreds of strokes of a few dozen points. "Dense" here is ten times that, a page of
// small diagram and tight lecture notes; "extreme" is a page filled edge to edge with sketching.

@DisplayName("Ink: what a dense page costs")
class InkDensityTests {
    private class Measure(
        val strokes: Int, val points: Int, val jsonBytes: Int, val packedBytes: Int,
        val writeMilliseconds: Double, val readMilliseconds: Double, val shapeMilliseconds: Double,
    )

    private fun measure(strokes: Int, pointsEach: Int): Measure {
        val page = InkSamples.dense(strokes, pointsEach)
        var start = System.nanoTime()
        val data = page.jsonData()
        val write = System.nanoTime() - start
        start = System.nanoTime()
        val back = InkDocument.fromData(data)
        val read = System.nanoTime() - start
        assertEquals(page, back)
        val packed = InkPng.deflate(data)
        val palette = InkPalette(ThemeColor(0, 0, 0), ThemeColor(20, 90, 200))
        start = System.nanoTime()
        val plan = InkRenderer.plan(page, palette, 2.0)
        val shape = System.nanoTime() - start
        assertEquals(strokes, plan.shapes.size)
        return Measure(strokes, page.pointCount, data.size, packed.size, write / 1e6, read / 1e6, shape / 1e6)
    }

    @Test
    @DisplayName("a page of handwriting")
    fun aPageOfHandwriting() = report(500, 40, "a page of handwriting")

    /** The dense and extreme pages take a while, so they run on request: `INK_DENSITY=1 ./gradlew :core:test --tests '*InkDensity*'`. */
    @Test
    @DisplayName("a dense page and an extreme one, on request")
    fun aDensePage() {
        skipUnless(System.getenv("INK_DENSITY") != null, "set INK_DENSITY=1")
        report(3_000, 60, "dense")
        report(10_000, 80, "extreme")
    }

    private fun report(strokes: Int, pointsEach: Int, label: String) {
        val result = measure(strokes, pointsEach)
        println(
            String.format(
                Locale.ROOT,
                "INK DENSITY %s: %d strokes, %d points; JSON %.2f MB, zlib %.2f MB (%.0f%%); write %.0f ms, read %.0f ms, shapes %.0f ms",
                label, result.strokes, result.points, result.jsonBytes / 1e6, result.packedBytes / 1e6, result.packedBytes.toDouble() / result.jsonBytes * 100,
                result.writeMilliseconds, result.readMilliseconds, result.shapeMilliseconds,
            ),
        )
        assertTrue(result.packedBytes < result.jsonBytes)
        assertTrue(result.readMilliseconds < 60_000)
    }
}
