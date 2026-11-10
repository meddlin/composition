import Foundation
import GRDB

// Ink on a PDF (docs/pdf-markup-plan.md, "Ink on the page"): the Pencil's strokes for a page, kept beside the file as one `pdf_annotations` row of kind `ink` per
// page, whose `body` is that page's stroke JSON (docs/architecture/ink.md, the D9 format, written and read by `CompositionInk`; this module only keeps the text).
//
// The strokes are in the canvas PencilKit gives for a page: points, y down, from the top-left corner of the page's unturned crop box (`PdfInkGeometry`). A page's
// ink is one record because PencilKit draws one drawing per canvas and a canvas is one page; it is replaced whole each time the page's drawing changes.
//
// Ink is kept out of everything that reads marks as a list: a dense page's JSON is megabytes, so the marks the reader holds (`annotations(documentId:withInk:)`
// with `withInk: false`), the words a PDF's note is found by and the Highlights tab never see the strokes. The reader asks for a page's ink when its page comes
// near the screen, and an export asks for one page at a time.

extension CompositionDatabase {
    /// The most text one page's strokes may be (the same limit as a drawing's, `InkLimits.maxJSONBytes`).
    public static let maxInkBytes = 256 * 1024 * 1024

    /// The pages (0-based) that have ink, each with the id of its record. Reads no stroke.
    public func inkPages(documentId: Int64) throws -> [Int: Int64] {
        try pool.read { db in
            let rows = try Row.fetchAll(db, sql: "SELECT page, MAX(id) AS id FROM pdf_annotations WHERE document_id = ? AND kind = 'ink' GROUP BY page", arguments: [documentId])
            return Dictionary(uniqueKeysWithValues: rows.map { (Int($0["page"] as Int64), $0["id"] as Int64) })
        }
    }

    /// A page's stroke JSON, as it is stored (the newest record when a merge left more than one); nil when the page has no ink.
    public func inkBody(documentId: Int64, page: Int) throws -> String? {
        try pool.read { db in
            try String.fetchOne(db, sql: "SELECT body FROM pdf_annotations WHERE document_id = ? AND page = ? AND kind = 'ink' AND body IS NOT NULL ORDER BY id DESC LIMIT 1", arguments: [documentId, page])
        }
    }

    /// Replaces the ink of a page with `body`, or takes it away (`nil`, which is what a page with no strokes left is). There is one record per page: the newest is
    /// changed in place (its uuid and the time it was made stay), and a duplicate that a merge left is removed. Returns whether the page has ink now.
    /// Throws `InvalidMarkError` when the PDF is gone, the page is past its end, or the body is not a JSON object.
    @discardableResult
    public func setInk(documentId: Int64, page: Int, body: String?, now: Date = Date()) throws -> Bool {
        guard page >= 0 else { throw InvalidMarkError("A page is a whole number from 0.") }
        if let body {
            guard body.utf8.count <= Self.maxInkBytes else { throw InvalidMarkError("This page's ink is too large to keep.") }
            guard body.utf8.first(where: { $0 != 0x20 && $0 != 0x0A && $0 != 0x0D && $0 != 0x09 }) == UInt8(ascii: "{") else { throw InvalidMarkError("Ink needs its strokes as the body.") }
        }
        return try pool.write { db in
            try Self.assertPage(db, documentId, page)
            let ids = try Int64.fetchAll(db, sql: "SELECT id FROM pdf_annotations WHERE document_id = ? AND page = ? AND kind = 'ink' ORDER BY id DESC", arguments: [documentId, page])
            guard let body else {
                for id in ids { try db.execute(sql: "DELETE FROM pdf_annotations WHERE id = ?", arguments: [id]) }
                return false
            }
            let stamp = Timestamp.now(now)
            if let newest = ids.first {
                try db.execute(sql: "UPDATE pdf_annotations SET body = ?, updated_at = ? WHERE id = ?", arguments: [body, stamp, newest])
                for id in ids.dropFirst() { try db.execute(sql: "DELETE FROM pdf_annotations WHERE id = ?", arguments: [id]) }
            } else {
                try db.execute(
                    sql: "INSERT INTO pdf_annotations (document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at) VALUES (?, ?, 'ink', 'ink', NULL, '', '', ?, NULL, ?, ?)",
                    arguments: [documentId, page, body, stamp, stamp])
            }
            return true
        }
    }

    /// Hands each page's ink to `body`, in page order, one page read at a time (a book's worth of strokes is never in memory at once).
    public func forEachInk(documentId: Int64, _ body: (_ page: Int, _ json: String) throws -> Void) throws {
        for page in try inkPages(documentId: documentId).keys.sorted() {
            if let json = try inkBody(documentId: documentId, page: page) { try body(page, json) }
        }
    }
}

extension NoteStore {
    /// See `CompositionDatabase.setInk`. Ink has no words, so a PDF's search entry is unchanged by it.
    @discardableResult
    public func setInk(documentId: Int64, page: Int, body: String?, now: Date = Date()) throws -> Bool {
        try database.setInk(documentId: documentId, page: page, body: body, now: now)
    }
}

/// Where a canvas point is on the page, and back. PDFKit lays a `PKCanvasView` over each page as the page's unturned crop box, in points, and turns it with the
/// page; so a canvas point is a point of the crop box counted from its top-left corner with y down, whatever the page's rotation (measured on spike C's nine
/// geometries, docs/pdf-markup-plan.md, "Spike B status"). The page's own coordinates are raw user space, the numbers a mark is stored in, with y up.
public enum PdfInkGeometry {
    /// A page's crop box, in raw user space.
    public struct Box: Equatable, Sendable {
        public var minX: Double
        public var minY: Double
        public var width: Double
        public var height: Double
        public init(minX: Double, minY: Double, width: Double, height: Double) { (self.minX, self.minY, self.width, self.height) = (minX, minY, width, height) }
        public var maxY: Double { minY + height }
    }

    public static func userSpace(x: Double, y: Double, in box: Box) -> (x: Double, y: Double) { (box.minX + x, box.maxY - y) }

    public static func canvas(x: Double, y: Double, in box: Box) -> (x: Double, y: Double) { (x - box.minX, box.maxY - y) }
}
