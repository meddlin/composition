import Foundation

// What a mark looks like on the page: the numbers the desktop's reader (`MARK_PAINT` in components/pdf/pdfGeometry.ts) and its export
// (`PAINT` in pdfExport.ts) use, so a mark is the same colour in the desktop's reader, in the iPad's, and in an exported copy. A highlight is
// filled (and multiplies into the page); an underline, a strikethrough and the border of a typed note are drawn in the line colour.

public struct PdfMarkPaint: Equatable, Sendable {
    /// 0 to 255.
    public var fill: (red: Int, green: Int, blue: Int)
    /// How much of the fill shows.
    public var alpha: Double
    public var line: (red: Int, green: Int, blue: Int)

    public static func == (a: PdfMarkPaint, b: PdfMarkPaint) -> Bool { a.fill == b.fill && a.alpha == b.alpha && a.line == b.line }

    private static let paints: [String: PdfMarkPaint] = [
        "yellow": PdfMarkPaint(fill: (255, 221, 51), alpha: 0.5, line: (0xd6, 0xa4, 0x00)),
        "green": PdfMarkPaint(fill: (92, 200, 100), alpha: 0.45, line: (0x2f, 0x9e, 0x44)),
        "blue": PdfMarkPaint(fill: (88, 166, 255), alpha: 0.45, line: (0x1c, 0x7e, 0xd6)),
        "pink": PdfMarkPaint(fill: (255, 128, 171), alpha: 0.5, line: (0xd6, 0x33, 0x6c)),
        "orange": PdfMarkPaint(fill: (255, 169, 77), alpha: 0.5, line: (0xe8, 0x59, 0x0c)),
    ]

    /// The paint for a colour name; anything that is not one of the five (a typed note may carry another) is yellow.
    public static func paint(for color: String) -> PdfMarkPaint { paints[color] ?? paints["yellow"]! }

    /// How much of its fill a typed note's box shows (the desktop's 0.85).
    public static let noteAlpha = 0.85
}
