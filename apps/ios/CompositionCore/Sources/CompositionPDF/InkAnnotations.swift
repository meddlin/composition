import CompositionCore
import CompositionInk
import PDFKit

#if canImport(UIKit)
import UIKit
typealias PlatformPath = UIBezierPath
#else
import AppKit
typealias PlatformPath = NSBezierPath
#endif

// A page's ink (the D9 stroke JSON, docs/architecture/ink.md) as native `Ink` annotations, for an exported copy (docs/pdf-markup-plan.md, "Export annotated PDF"
// and C21). The reader never draws these: on screen a page's ink is PencilKit's own drawing on a canvas over the page. In a copy for other apps every stroke is
// a path, so what PencilKit draws with texture (pencil, crayon, watercolor) and with pressure (a pen's width along its length) is **simplified**: one colour, one
// width (the strokes' average) and one opacity for the whole stroke, joined by straight lines between the points the Pencil sent.
//
// A stroke's points are canvas points (y down from the crop box's top-left corner, `PdfInkGeometry`); an annotation is in the page's raw user space, which is where
// every other mark of the PDF is, so it is turned over once here and nothing about the page's rotation, crop or origin has to be known again.

public enum InkAnnotations {
    /// What ink looks like on a page: black, the page being white in every scheme, and the brand colour where a stroke asks for `accent`.
    public static let pagePalette = InkPalette(ink: ThemeColor(red: 0, green: 0, blue: 0), accent: Theme.default.brand)

    /// The author written into an exported annotation, as for the other marks.
    public static let author = MarkAnnotations.author

    /// The annotations that draw `ink` on `page`: one per run of strokes that look alike (an annotation has one colour and one width), in the order they were
    /// drawn. A stroke is a polyline in the page's raw user space.
    public static func annotations(for ink: InkDocument, on page: PDFPage, palette: InkPalette = pagePalette) -> [PDFAnnotation] {
        let crop = page.bounds(for: .cropBox)
        let box = PdfInkGeometry.Box(minX: Double(crop.minX), minY: Double(crop.minY), width: Double(crop.width), height: Double(crop.height))
        // The canvas is the crop box; a drawing that was made on another size (a page that was replaced) is scaled to this one.
        let (sx, sy) = (box.width / ink.width, box.height / ink.height)

        var runs: [(style: Style, strokes: [[CGPoint]])] = []
        for stroke in ink.strokes where !stroke.points.isEmpty {
            let style = Style(stroke, palette: palette)
            let points = stroke.points.map { point -> CGPoint in
                let there = PdfInkGeometry.userSpace(x: point.x * sx, y: point.y * sy, in: box)
                return CGPoint(x: there.x, y: there.y)
            }
            if let last = runs.last, last.style == style {
                runs[runs.count - 1].strokes.append(points)
            } else {
                runs.append((style, [points]))
            }
        }
        return runs.map { annotation(style: $0.style, strokes: $0.strokes) }
    }

    /// What makes two strokes one annotation.
    struct Style: Equatable {
        var color: ThemeColor
        /// In tenths of a point, so that two pens of a width that differs by a hair are one.
        var width: Int
        /// In hundredths.
        var opacity: Int

        init(_ stroke: InkStroke, palette: InkPalette) {
            color = palette.color(for: stroke.color)
            let count = Double(stroke.points.count)
            let width = stroke.points.reduce(0) { $0 + ($1.width + $1.height) / 2 } / count
            let opacity = stroke.points.reduce(0) { $0 + $1.opacity } / count
            self.width = max(1, Int((width * 10).rounded()))
            self.opacity = max(1, min(100, Int((opacity * 100).rounded())))
        }
    }

    private static func annotation(style: Style, strokes: [[CGPoint]]) -> PDFAnnotation {
        let half = CGFloat(style.width) / 20
        var extent = CGRect.null
        for stroke in strokes { for point in stroke { extent = extent.union(CGRect(x: point.x, y: point.y, width: 0, height: 0)) } }
        // The annotation's bounds hold every path (and the pen's own width past the ends); the paths are counted from its origin.
        let bounds = extent.insetBy(dx: -(half + 1), dy: -(half + 1))
        let annotation = PDFAnnotation(bounds: bounds, forType: .ink, withProperties: nil)
        annotation.color = PlatformColor(
            red: CGFloat(style.color.red) / 255, green: CGFloat(style.color.green) / 255, blue: CGFloat(style.color.blue) / 255, alpha: CGFloat(style.opacity) / 100)
        let border = PDFBorder()
        border.lineWidth = CGFloat(style.width) / 10
        annotation.border = border
        for stroke in strokes {
            let path = PlatformPath()
            let shifted = stroke.map { CGPoint(x: $0.x - bounds.minX, y: $0.y - bounds.minY) }
            path.move(to: shifted[0])
            if shifted.count == 1 {
                // A dot: a line of no length draws nothing, so it is a hair long.
                path.line(toPoint: CGPoint(x: shifted[0].x + 0.01, y: shifted[0].y))
            }
            for point in shifted.dropFirst() { path.line(toPoint: point) }
            annotation.add(path)
        }
        annotation.userName = author
        annotation.shouldDisplay = true
        annotation.shouldPrint = true
        return annotation
    }
}

extension PlatformPath {
    /// UIKit's and AppKit's paths name the same step differently.
    fileprivate func line(toPoint point: CGPoint) {
        #if canImport(UIKit)
        addLine(to: point)
        #else
        line(to: point)
        #endif
    }
}
