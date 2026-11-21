package com.rushinglabs.composition.core.pdf

// Where a mark is on its page, in raw PDF user space (docs/pdf-markup-plan.md, "The data model"), ported from PdfMarkGeometry.swift: the
// boxes it occupies, the mark under a point, and the box of a new typed note. Pure arithmetic on the stored numbers, as the desktop's
// `boxesOf` and `markAt` are, so a tap is matched to a mark without asking a viewer. (A viewer turns a screen point into page space with
// its own call, and the rectangles are right either way: spike C.)

/** The rectangles that hold the mark: the lines of a text mark, or the box of a typed note. */
val PdfMark.boxes: List<PdfRect>
    get() {
        rects?.let { return it }
        if (kind == PdfMarkKind.TEXT) body?.let(PdfTextNoteBody::of)?.let { return listOf(it.rect) }
        return emptyList()
    }

/** The typed note's words and box, for a mark that is one. */
val PdfMark.textNote: PdfTextNoteBody?
    get() = if (kind == PdfMarkKind.TEXT) body?.let(PdfTextNoteBody::of) else null

/** One rectangle around all the mark's boxes. */
val PdfMark.union: PdfRect? get() = PdfMarkGeometry.union(boxes)

object PdfMarkGeometry {
    /** The size of a new typed note, in points: wide enough for a line or two at 12 points (the desktop's default). */
    const val NOTE_WIDTH = 200.0
    const val NOTE_HEIGHT = 56.0
    const val NOTE_FONT_SIZE = 12.0

    fun union(rects: List<PdfRect>): PdfRect? {
        val first = rects.firstOrNull() ?: return null
        return rects.drop(1).fold(first) { a, b -> PdfRect(minOf(a.x0, b.x0), minOf(a.y0, b.y0), maxOf(a.x1, b.x1), maxOf(a.y1, b.y1)) }
    }

    /**
     * The mark at a point of its page, for a tap that selects one: the most recently made when several lie there. The edge counts a little
     * out (`slop`, in points), since a line of highlighted text is a narrow target.
     */
    fun markAt(x: Double, y: Double, marks: List<PdfMark>, slop: Double = 2.0): PdfMark? =
        marks.lastOrNull { mark -> mark.boxes.any { x >= it.x0 - slop && x <= it.x1 + slop && y >= it.y0 - slop && y <= it.y1 + slop } }

    /**
     * The box of a typed note placed by a tap at (x, y): its top-left corner is the tap, as on the desktop, moved in if it would run off a
     * page of `pageWidth` by `pageHeight` points (a page is at most 14,400; one of 0 means the size is not known).
     */
    fun noteBox(tapX: Double, tapY: Double, pageWidth: Double, pageHeight: Double): PdfRect {
        var x0 = tapX
        var y1 = tapY
        if (pageWidth > 0) x0 = maxOf(0.0, minOf(x0, pageWidth - NOTE_WIDTH))
        if (pageHeight > 0) y1 = maxOf(NOTE_HEIGHT, minOf(y1, pageHeight))
        return PdfRect(x0, y1 - NOTE_HEIGHT, x0 + NOTE_WIDTH, y1)
    }
}
