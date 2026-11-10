import Foundation

// Where a mark is on its page, in raw PDF user space (docs/pdf-markup-plan.md, "The data model"): the boxes it occupies, the mark under a point,
// and the box of a new typed note. Pure arithmetic on the stored numbers, as the desktop's `boxesOf` and `markAt` are, so a tap is matched to a
// mark without asking a viewer. (A viewer turns a screen point into page space with its own call, and the rectangles are right either way: spike C.)

extension PdfMark {
    /// The rectangles that hold the mark: the lines of a text mark, or the box of a typed note.
    public var boxes: [PdfRect] {
        if let rects { return rects }
        if kind == .text, let body, let note = PdfTextNoteBody(body) { return [note.rect] }
        return []
    }

    /// The typed note's words and box, for a mark that is one.
    public var textNote: PdfTextNoteBody? {
        guard kind == .text, let body else { return nil }
        return PdfTextNoteBody(body)
    }

    /// One rectangle around all the mark's boxes.
    public var union: PdfRect? { PdfMarkGeometry.union(boxes) }
}

public enum PdfMarkGeometry {
    /// The size of a new typed note, in points: wide enough for a line or two at 12 points (the desktop's default).
    public static let noteWidth = 200.0
    public static let noteHeight = 56.0
    public static let noteFontSize = 12.0

    public static func union(_ rects: [PdfRect]) -> PdfRect? {
        guard let first = rects.first else { return nil }
        return rects.dropFirst().reduce(first) { PdfRect(x0: min($0.x0, $1.x0), y0: min($0.y0, $1.y0), x1: max($0.x1, $1.x1), y1: max($0.y1, $1.y1)) }
    }

    /// The mark at a point of its page, for a tap that selects one: the most recently made when several lie there. The edge counts a little out
    /// (`slop`, in points), since a line of highlighted text is a narrow target.
    public static func mark(at x: Double, _ y: Double, among marks: [PdfMark], slop: Double = 2) -> PdfMark? {
        for mark in marks.reversed() where mark.boxes.contains(where: { x >= $0.x0 - slop && x <= $0.x1 + slop && y >= $0.y0 - slop && y <= $0.y1 + slop }) {
            return mark
        }
        return nil
    }

    /// The box of a typed note placed by a tap at (x, y): its top-left corner is the tap, as on the desktop, moved in if it would run off a page
    /// of `pageWidth` by `pageHeight` points (a page is at most 14,400; one of 0 means the size is not known).
    public static func noteBox(tapX x: Double, tapY y: Double, pageWidth: Double, pageHeight: Double) -> PdfRect {
        var x0 = x
        var y1 = y
        if pageWidth > 0 { x0 = max(0, min(x0, pageWidth - noteWidth)) }
        if pageHeight > 0 { y1 = max(noteHeight, min(y1, pageHeight)) }
        return PdfRect(x0: x0, y0: y1 - noteHeight, x1: x0 + noteWidth, y1: y1)
    }
}
