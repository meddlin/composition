package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.NoteStore
import com.rushinglabs.composition.core.Timestamp
import java.time.Instant

// Ink on a PDF (docs/pdf-markup-plan.md, "Ink on the page"), ported from PdfInkStore.swift: the pen's strokes for a page, kept beside the
// file as one `pdf_annotations` row of kind `ink` per page, whose `body` is that page's stroke JSON (docs/architecture/ink.md, the D9
// format). This file only keeps the text: reading and writing the strokes is the ink format's, which is another slice of the port.
//
// The strokes are in the canvas a reader lays over a page: points, y down, from the top-left corner of the page's unturned crop box
// (`PdfInkGeometry`). A page's ink is one record because one drawing covers one page; it is replaced whole each time the page's drawing
// changes.
//
// Ink is kept out of everything that reads marks as a list: a dense page's JSON is megabytes, so the marks the reader holds
// (`annotations(documentId, withInk = false)`), the words a PDF's note is found by and the Highlights tab never see the strokes. The
// reader asks for a page's ink when its page comes near the screen, and an export asks for one page at a time.

/** The most text one page's strokes may be (the same limit as a drawing's, `InkLimits.maxJSONBytes` on the iPad). */
const val MAX_INK_BYTES = 256 * 1024 * 1024

/** The pages (0-based) that have ink, each with the id of its record. Reads no stroke. */
fun CompositionDatabase.inkPages(documentId: Long): Map<Int, Long> = file.read { db ->
    db.rows("SELECT page, MAX(id) AS id FROM pdf_annotations WHERE document_id = ? AND kind = 'ink' GROUP BY page", documentId)
        .associate { it.long("page").toInt() to it.long("id") }
}

/** A page's stroke JSON, as it is stored (the newest record when a merge left more than one); null when the page has no ink. */
fun CompositionDatabase.inkBody(documentId: Long, page: Int): String? = file.read { db ->
    db.string(
        "SELECT body FROM pdf_annotations WHERE document_id = ? AND page = ? AND kind = 'ink' AND body IS NOT NULL ORDER BY id DESC LIMIT 1",
        documentId, page,
    )
}

/**
 * Replaces the ink of a page with `body`, or takes it away (`null`, which is what a page with no strokes left is). There is one record
 * per page: the newest is changed in place (its uuid and the time it was made stay), and a duplicate that a merge left is removed.
 * Returns whether the page has ink now. Throws `InvalidMarkException` when the PDF is gone, the page is past its end, or the body is not
 * a JSON object.
 */
fun CompositionDatabase.setInk(documentId: Long, page: Int, body: String?, now: Instant = Instant.now()): Boolean {
    if (page < 0) throw InvalidMarkException("A page is a whole number from 0.")
    if (body != null) {
        if (utf8Length(body) > MAX_INK_BYTES) throw InvalidMarkException("This page's ink is too large to keep.")
        if (body.firstOrNull { it != ' ' && it != '\n' && it != '\r' && it != '\t' } != '{') throw InvalidMarkException("Ink needs its strokes as the body.")
    }
    return file.write { db ->
        assertPage(db, documentId, page)
        val ids = db.longs("SELECT id FROM pdf_annotations WHERE document_id = ? AND page = ? AND kind = 'ink' ORDER BY id DESC", documentId, page)
        if (body == null) {
            for (id in ids) db.execute("DELETE FROM pdf_annotations WHERE id = ?", id)
            return@write false
        }
        val stamp = Timestamp.now(now)
        val newest = ids.firstOrNull()
        if (newest != null) {
            db.execute("UPDATE pdf_annotations SET body = ?, updated_at = ? WHERE id = ?", body, stamp, newest)
            for (id in ids.drop(1)) db.execute("DELETE FROM pdf_annotations WHERE id = ?", id)
        } else {
            db.execute(
                "INSERT INTO pdf_annotations (document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at) VALUES (?, ?, 'ink', 'ink', NULL, '', '', ?, NULL, ?, ?)",
                documentId, page, body, stamp, stamp,
            )
        }
        true
    }
}

/** Hands each page's ink to `body`, in page order, one page read at a time (a book's worth of strokes is never in memory at once). */
fun CompositionDatabase.forEachInk(documentId: Long, body: (page: Int, json: String) -> Unit) {
    for (page in inkPages(documentId).keys.sorted()) {
        inkBody(documentId, page)?.let { body(page, it) }
    }
}

/** See `CompositionDatabase.setInk`. Ink has no words, so a PDF's search entry is unchanged by it. */
fun NoteStore.setInk(documentId: Long, page: Int, body: String?, now: Instant = Instant.now()): Boolean = database.setInk(documentId, page, body, now)

/** How many bytes `text` is in UTF-8, without making the bytes (a page's strokes may be hundreds of megabytes). */
private fun utf8Length(text: String): Long {
    var bytes = 0L
    var index = 0
    while (index < text.length) {
        val c = text[index]
        bytes += when {
            c.code < 0x80 -> 1
            c.code < 0x800 -> 2
            Character.isHighSurrogate(c) && index + 1 < text.length && Character.isLowSurrogate(text[index + 1]) -> { index += 1; 4 }
            else -> 3
        }
        index += 1
    }
    return bytes
}

/**
 * Where a canvas point is on the page, and back. A reader lays a drawing canvas over each page as the page's unturned crop box, in points,
 * and turns it with the page; so a canvas point is a point of the crop box counted from its top-left corner with y down, whatever the
 * page's rotation (measured on the iPad, spike C's nine geometries, docs/pdf-markup-plan.md, "Spike B status"). The page's own
 * coordinates are raw user space, the numbers a mark is stored in, with y up.
 */
object PdfInkGeometry {
    /** A page's crop box, in raw user space. */
    data class Box(val minX: Double, val minY: Double, val width: Double, val height: Double) {
        val maxY: Double get() = minY + height
    }

    data class Point(val x: Double, val y: Double)

    fun userSpace(x: Double, y: Double, box: Box): Point = Point(box.minX + x, box.maxY - y)

    fun canvas(x: Double, y: Double, box: Box): Point = Point(x - box.minX, box.maxY - y)
}
