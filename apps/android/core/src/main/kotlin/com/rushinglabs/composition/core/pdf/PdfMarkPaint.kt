package com.rushinglabs.composition.core.pdf

// What a mark looks like on the page, ported from PdfMarkPaint.swift: the numbers the desktop's reader (`MARK_PAINT` in
// components/pdf/pdfGeometry.ts) and its export (`PAINT` in pdfExport.ts) use, so a mark is the same colour in the desktop's reader, in
// the iPad's, in Android's and in an exported copy. A highlight is filled (and multiplies into the page); an underline, a strikethrough
// and the border of a typed note are drawn in the line colour.

/** A colour as 0 to 255 for each of red, green and blue. */
data class PdfRgb(val red: Int, val green: Int, val blue: Int)

data class PdfMarkPaint(
    val fill: PdfRgb,
    /** How much of the fill shows. */
    val alpha: Double,
    val line: PdfRgb,
) {
    companion object {
        private val paints = mapOf(
            "yellow" to PdfMarkPaint(PdfRgb(255, 221, 51), 0.5, PdfRgb(0xd6, 0xa4, 0x00)),
            "green" to PdfMarkPaint(PdfRgb(92, 200, 100), 0.45, PdfRgb(0x2f, 0x9e, 0x44)),
            "blue" to PdfMarkPaint(PdfRgb(88, 166, 255), 0.45, PdfRgb(0x1c, 0x7e, 0xd6)),
            "pink" to PdfMarkPaint(PdfRgb(255, 128, 171), 0.5, PdfRgb(0xd6, 0x33, 0x6c)),
            "orange" to PdfMarkPaint(PdfRgb(255, 169, 77), 0.5, PdfRgb(0xe8, 0x59, 0x0c)),
        )

        /** The paint for a colour name; anything that is not one of the five (a typed note may carry another) is yellow. */
        fun paint(color: String): PdfMarkPaint = paints[color] ?: paints.getValue("yellow")

        /** How much of its fill a typed note's box shows (the desktop's 0.85). */
        const val NOTE_ALPHA = 0.85
    }
}
