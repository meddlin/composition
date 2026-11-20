package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

// Drawing a drawing without PencilKit, ported from the platform-free half of InkRenderer.swift: everything the renderer works out
// before it touches pixels. On the iPad, CoreGraphics fills the shapes this computes; on Android the app fills them with Canvas (which
// is not on the JVM), encodes the bitmap as a PNG, and hands it to `pngData` to get the density and the ink chunks. The rendering is
// **simplified**: each stroke is the swept outline of its points' nib sizes, with a single opacity for the whole stroke (so overlapping
// parts do not darken, as the textured pencil, crayon and watercolour of PencilKit do not either on their flat parts). The grain and
// bleed of those three are not reproduced. docs/architecture/ink.md records how close this is, from the S5 comparison.
//
// What the app's Canvas does with a `plan`, as CoreGraphics does it in InkRenderer.swift:
//   a bitmap of `plan.size` (ARGB_8888, transparent, or `plan.background` filled), then a matrix that scales the drawing's points to
//   pixels (`plan.size.width / drawing.width` across and `plan.size.height / drawing.height` down: both y down, so no flip); then each
//   shape's polygons as one Path (FillType.WINDING, each polygon a moveTo, lineTos and a close) filled once with its colour at its alpha,
//   antialiased.

/**
 * What the names in a drawing look like on one scheme. `ink` and `accent` follow the scheme; a `<Mark>` colour name is that hue. A fixed
 * colour is as stored on a light scheme and, on a dark one, as PencilKit shows it in a dark interface style (`ThemeColor.darkStyle`),
 * so the preview matches the canvas. (Swift's `init(theme:)` waits for the appearance slice: `ink` is the scheme's foreground,
 * `accent` its brand colour, `darkStyle` whether it is dark.)
 */
data class InkPalette(
    val ink: ThemeColor,
    val accent: ThemeColor,
    val marks: Map<String, ThemeColor> = MARK_HUES,
    /** Whether a fixed colour is drawn as PencilKit draws it in a dark style. */
    val darkStyle: Boolean = false,
) {
    /** A name this palette does not know is drawn as ink. */
    fun color(color: InkColor): ThemeColor = when (color) {
        is InkColor.Fixed -> if (darkStyle) color.color.darkStyle else color.color
        is InkColor.Semantic -> when (color.name) {
            "accent" -> accent
            "ink" -> ink
            else -> marks[color.name] ?: ink
        }
    }

    companion object {
        /** The `<Mark>` hues, the same in every scheme (Swift's `Theme.markHues`, which the appearance slice ports with the rest of `Theme`). */
        val MARK_HUES: Map<String, ThemeColor> = mapOf(
            "yellow" to ThemeColor(0xF5, 0xC5, 0x18),
            "green" to ThemeColor(0x3F, 0xB8, 0x76),
            "blue" to ThemeColor(0x3B, 0x9E, 0xFF),
            "pink" to ThemeColor(0xFF, 0x6F, 0xAE),
            "orange" to ThemeColor(0xFF, 0x8A, 0x2B),
        )
    }
}

/**
 * The colour PencilKit shows for this one in a dark interface style: the lightness of HSL reversed (1 − L), the hue and the saturation
 * kept. Black is white, white is black, a red or a yellow of middling lightness stays as it is, and a navy turns a light blue. Probed on
 * the iPadOS 26.4 Simulator (InkRenderer.swift says how); `renderer.json` holds the pairs.
 */
val ThemeColor.darkStyle: ThemeColor
    get() {
        val r = red.toDouble() / 255
        val g = green.toDouble() / 255
        val b = blue.toDouble() / 255
        val high = swiftMax(swiftMax(r, g), b)
        val low = swiftMin(swiftMin(r, g), b)
        val lightness = (high + low) / 2
        val delta = high - low
        var hue = 0.0
        var saturation = 0.0
        if (delta > 0) {
            saturation = delta / (1 - abs(2 * lightness - 1))
            // Kotlin's `%` on doubles is C's `fmod`, as Swift's `truncatingRemainder` is.
            hue = if (high == r) ((g - b) / delta) % 6 else if (high == g) (b - r) / delta + 2 else (r - g) / delta + 4
            hue *= 60
            if (hue < 0) hue += 360
        }
        val flipped = 1 - lightness
        val chroma = (1 - abs(2 * flipped - 1)) * saturation
        val second = chroma * (1 - abs((hue / 60) % 2 - 1))
        val offset = flipped - chroma / 2
        val (r1, g1, b1) = when {
            hue < 60 -> Triple(chroma, second, 0.0)
            hue < 120 -> Triple(second, chroma, 0.0)
            hue < 180 -> Triple(0.0, chroma, second)
            hue < 240 -> Triple(0.0, second, chroma)
            hue < 300 -> Triple(second, 0.0, chroma)
            else -> Triple(chroma, 0.0, second)
        }
        fun channel(value: Double): Int = roundHalfAway((value + offset) * 255).toInt().coerceIn(0, 255)
        return ThemeColor(channel(r1), channel(g1), channel(b1))
    }

/** A point of a shape, in the drawing's own coordinates (CoreGraphics' CGPoint). */
data class InkVector(val x: Double, val y: Double)

object InkRenderer {
    /** The most pixels a picture of a drawing has on a side. */
    const val MAX_PIXELS = 8192.0

    /** How many pixels a point of the drawing gets: `scale`, reduced when that would pass `MAX_PIXELS` on a side. */
    fun pixelsPerPoint(drawing: InkDocument, scale: Double = 2.0): Double =
        swiftMin(swiftMin(scale, MAX_PIXELS / drawing.width), MAX_PIXELS / drawing.height)

    /** The size of the picture of a drawing at `scale` pixels to a point (reduced when that would pass 8,192 pixels on a side). */
    fun imageSize(drawing: InkDocument, scale: Double = 2.0): InkImageSize {
        val fit = pixelsPerPoint(drawing, scale)
        return InkImageSize(
            swiftMax(1.0, roundHalfAway(drawing.width * fit)).toInt(),
            swiftMax(1.0, roundHalfAway(drawing.height * fit)).toInt(),
        )
    }

    /** Everything a picture of a drawing is: its size in pixels, what is under the ink, and the shapes to fill, in order. */
    class Plan(val size: InkImageSize, val background: ThemeColor?, val shapes: List<StrokeShape>)

    /** The picture of `drawing` in `palette`, on transparent pixels (or on `background`), `scale` pixels to a point. */
    fun plan(drawing: InkDocument, palette: InkPalette, scale: Double = 2.0, background: ThemeColor? = null): Plan =
        Plan(imageSize(drawing, scale), background, drawing.strokes.mapNotNull { shape(it, palette.color(it.color)) })

    /**
     * The PNG a note stores, from the pixels the app drew for `plan(drawing, …)` (`pixels`, any PNG of that size): with the density in
     * the `pHYs` chunk (72 dots to an inch is a pixel to a point), so a reader that cannot use the strokes, and any image viewer, draws
     * the picture at the size of its canvas even when the drawing was too big for the scale (`InkPng.pixelsPerPoint`), and with the
     * strokes (and PencilKit's blob, when there is one) in the ink chunks. Swift's `pngData(of:palette:scale:pencilKit:)` draws the pixels
     * itself first.
     */
    fun pngData(drawing: InkDocument, pixels: ByteArray, pencilKit: ByteArray? = null): ByteArray {
        val dotsPerInch = 72 * InkPng.pixelSize(pixels).width.toDouble() / drawing.width
        return InkPng.embedding(drawing, pencilKit, InkPng.settingDensity(pixels, dotsPerInch))
    }

    // A stroke

    /** How an ink differs from a plain opaque pen: how much of the colour shows, and whether the width is the mean of the points'. */
    data class Style(val alpha: Double, val constantWidth: Boolean) {
        companion object {
            fun of(ink: InkType): Style = when (ink) {
                InkType.MARKER -> Style(0.45, false)
                InkType.PENCIL -> Style(0.8, false)
                InkType.WATERCOLOR -> Style(0.4, false)
                InkType.CRAYON -> Style(0.9, false)
                InkType.MONOLINE -> Style(1.0, true)
                else -> Style(1.0, false)
            }
        }
    }

    /** A point of the smoothed outline: where, and how big the nib is there. */
    data class Sample(val x: Double, val y: Double, val w: Double, val h: Double, val opacity: Double)

    /**
     * What one stroke fills: its polygons as one path (each wound the same way, so the non-zero rule joins them into one shape with one
     * opacity), in `color` at `alpha`.
     */
    class StrokeShape(val polygons: List<List<InkVector>>, val color: ThemeColor, val alpha: Double)

    /** The shape of `stroke` in `color`; null for a stroke with no points, which draws nothing. */
    fun shape(stroke: InkStroke, color: ThemeColor): StrokeShape? {
        if (stroke.points.isEmpty()) return null
        val style = Style.of(stroke.ink)
        var samples = smooth(stroke.points)
        if (style.constantWidth) {
            val mean = stroke.points.fold(0.0) { sum, point -> sum + point.width } / stroke.points.size
            samples = samples.map { it.copy(w = mean, h = mean) }
        }
        val polygons = if (samples.size == 1) {
            listOf(outline(samples[0]))
        } else {
            (1 until samples.size).map { hull(outline(samples[it - 1]) + outline(samples[it])) }
        }
        val opacity = samples.fold(0.0) { sum, sample -> sum + sample.opacity } / samples.size
        return StrokeShape(polygons, color, style.alpha * swiftMin(swiftMax(opacity, 0.0), 1.0))
    }

    /** The points between PencilKit's control points: a Catmull-Rom curve through them, a sample about every half nib width. */
    fun smooth(points: List<InkPoint>): List<Sample> {
        fun sample(point: InkPoint) = Sample(point.x, point.y, swiftMax(point.width, 0.5), swiftMax(point.height, 0.5), point.opacity)
        if (points.size <= 2) return points.map(::sample)
        val out = arrayListOf(sample(points[0]))
        for (index in 0 until points.size - 1) {
            val p0 = points[maxOf(index - 1, 0)]
            val p1 = points[index]
            val p2 = points[index + 1]
            val p3 = points[minOf(index + 2, points.size - 1)]
            val distance = hypot(p2.x - p1.x, p2.y - p1.y)
            val step = swiftMax(0.5, swiftMin(p1.width, p2.width) * 0.5)
            val pieces = minOf(16, maxOf(1, ceil(distance / step).toInt()))
            for (piece in 1..pieces) {
                val t = piece.toDouble() / pieces
                fun spline(a: Double, b: Double, c: Double, d: Double): Double =
                    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
                fun line(a: Double, b: Double): Double = a + (b - a) * t
                out.add(
                    Sample(
                        spline(p0.x, p1.x, p2.x, p3.x), spline(p0.y, p1.y, p2.y, p3.y),
                        swiftMax(line(p1.width, p2.width), 0.5), swiftMax(line(p1.height, p2.height), 0.5), line(p1.opacity, p2.opacity),
                    ),
                )
            }
        }
        return out
    }

    /** The nib at a sample: an ellipse of a dozen corners (six for a nib under 2 points), counter-clockwise. */
    fun outline(sample: Sample): List<InkVector> {
        val corners = if (sample.w < 2 && sample.h < 2) 6 else 12
        return (0 until corners).map { corner ->
            val angle = 2 * PI * corner.toDouble() / corners.toDouble()
            InkVector(sample.x + cos(angle) * sample.w / 2, sample.y + sin(angle) * sample.h / 2)
        }
    }

    /** The convex hull of some points, counter-clockwise in the maths sense (Andrew's monotone chain): what a nib sweeps between two samples. */
    fun hull(points: List<InkVector>): List<InkVector> {
        val sorted = points.sortedWith { a, b -> if (a.x == b.x) a.y.compareTo(b.y) else a.x.compareTo(b.x) }
        fun cross(o: InkVector, a: InkVector, b: InkVector) = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
        val lower = ArrayList<InkVector>()
        for (point in sorted) {
            while (lower.size >= 2 && cross(lower[lower.size - 2], lower[lower.size - 1], point) <= 0) lower.removeAt(lower.size - 1)
            lower.add(point)
        }
        val upper = ArrayList<InkVector>()
        for (point in sorted.asReversed()) {
            while (upper.size >= 2 && cross(upper[upper.size - 2], upper[upper.size - 1], point) <= 0) upper.removeAt(upper.size - 1)
            upper.add(point)
        }
        return lower.dropLast(1) + upper.dropLast(1)
    }
}
