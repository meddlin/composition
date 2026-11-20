package com.rushinglabs.composition.core.ink

// How big a new drawing's page is (docs/architecture/ink.md, "The page's size"), ported from InkCrop.swift. The canvas the pen draws on
// is as big as the screen, but what is stored is **cut to what was drawn**, with a margin all round: a small sketch is a small picture,
// which the note shows at its own size, and a page of handwriting is as big as the writing. When the drawing is opened again the canvas
// is made roomy (`EDITING_ROOM` all round and never smaller than the screen), and cut again on Done. A handwritten *page*, a note that
// is one tall `<Ink>`, will want the whole page instead: it will keep a size and not use this.
//
// CoreGraphics' CGRect and CGSize become the plain values below, and `swiftMin`/`swiftMax` keep Swift's `min`/`max` (which pass a NaN
// over where Kotlin's return it).

object InkCrop {
    /** What is kept around the ink when a drawing is cut to it, in points. */
    const val PADDING = 16.0
    /** The smallest side of a cut drawing: a lone dot is still something to tap. */
    const val MINIMUM_SIDE = 48.0
    /** The room the canvas gives a stored drawing on every side when it is opened to be edited (and the least it is bigger than the drawing by). */
    const val EDITING_ROOM = 48.0
}

/** A rectangle in a drawing's own coordinates (y down, in points), as CGRect holds one. */
data class InkRect(val x: Double, val y: Double, val width: Double, val height: Double) {
    val minX: Double get() = x
    val minY: Double get() = y
    val maxX: Double get() = x + width
    val maxY: Double get() = y + height
    val midX: Double get() = x + width / 2
    val midY: Double get() = y + height / 2
    val size: InkSize get() = InkSize(width, height)
}

data class InkSize(val width: Double, val height: Double)

/**
 * The smallest rectangle that holds every stroke's ink: each point grown by half its nib's size, and null for a drawing with no points.
 * (The curve drawn between control points can run a little past them; `InkCrop.PADDING` is far more than that.)
 */
val InkDocument.inkBounds: InkRect?
    get() {
        var lowX = Double.POSITIVE_INFINITY
        var lowY = Double.POSITIVE_INFINITY
        var highX = Double.NEGATIVE_INFINITY
        var highY = Double.NEGATIVE_INFINITY
        for (stroke in strokes) {
            for (point in stroke.points) {
                lowX = swiftMin(lowX, point.x - swiftMax(point.width, 0.0) / 2)
                lowY = swiftMin(lowY, point.y - swiftMax(point.height, 0.0) / 2)
                highX = swiftMax(highX, point.x + swiftMax(point.width, 0.0) / 2)
                highY = swiftMax(highY, point.y + swiftMax(point.height, 0.0) / 2)
            }
        }
        if (!(lowX <= highX && lowY <= highY)) return null
        return InkRect(lowX, lowY, highX - lowX, highY - lowY)
    }

/**
 * The rectangle of this drawing's own coordinates that becomes the page when it is cut: the ink and `padding` all round, at least
 * `minimum` on a side (grown round the middle of the ink). Its numbers are at the format's step, so a point moved by its origin lands on
 * the step too. Null for a drawing with no ink.
 */
fun InkDocument.cropBox(padding: Double = InkCrop.PADDING, minimum: Double = InkCrop.MINIMUM_SIDE): InkRect? {
    val ink = inkBounds ?: return null
    val width = swiftMax(ink.width + 2 * padding, minimum)
    val height = swiftMax(ink.height + 2 * padding, minimum)
    val x = ink.midX - width / 2
    val y = ink.midY - height / 2
    return InkRect(
        InkDocument.stored(x, 0.01),
        InkDocument.stored(y, 0.01),
        InkDocument.stored(width, 0.01),
        InkDocument.stored(height, 0.01),
    )
}

/** This drawing with every point moved by (`dx`, `dy`) and a page of `canvas` (nib sizes and the rest stay as they are). */
fun InkDocument.translated(dx: Double, dy: Double, canvas: InkSize): InkDocument = copy(
    width = canvas.width,
    height = canvas.height,
    strokes = strokes.map { stroke -> stroke.copy(points = stroke.points.map { it.copy(x = it.x + dx, y = it.y + dy) }) },
)

/** The drawing cut to its ink; itself when it has none. */
fun InkDocument.cropped(padding: Double = InkCrop.PADDING, minimum: Double = InkCrop.MINIMUM_SIDE): InkDocument {
    val box = cropBox(padding, minimum) ?: return this
    return translated(-box.minX, -box.minY, box.size)
}
