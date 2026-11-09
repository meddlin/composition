import CompositionCore
import CoreGraphics
import Foundation

// How big a new drawing's page is (docs/architecture/ink.md, "The page's size"). The canvas the Pencil draws on is as big as the screen, but what is stored is
// **cut to what was drawn**, with a margin all round: a small sketch is a small picture, which the note shows at its own size, and a page of handwriting is as big as
// the writing. When the drawing is opened again the canvas is made roomy (`editingRoom` all round and never smaller than the screen), and cut again on Done.
// A handwritten *page*, a note that is one tall `<Ink>`, will want the whole page instead: it will keep a size and not use this.

public enum InkCrop {
    /// What is kept around the ink when a drawing is cut to it, in points.
    public static let padding = 16.0
    /// The smallest side of a cut drawing: a lone dot is still something to tap.
    public static let minimumSide = 48.0
    /// The room the canvas gives a stored drawing on every side when it is opened to be edited (and the least it is bigger than the drawing by).
    public static let editingRoom = 48.0
}

extension InkDocument {
    /// The smallest rectangle that holds every stroke's ink: each point grown by half its nib's size, and nothing for a drawing with no points. (The curve drawn
    /// between control points can run a little past them; `InkCrop.padding` is far more than that.)
    public var inkBounds: CGRect? {
        var low = (x: Double.infinity, y: Double.infinity), high = (x: -Double.infinity, y: -Double.infinity)
        for stroke in strokes {
            for point in stroke.points {
                low = (min(low.x, point.x - max(point.width, 0) / 2), min(low.y, point.y - max(point.height, 0) / 2))
                high = (max(high.x, point.x + max(point.width, 0) / 2), max(high.y, point.y + max(point.height, 0) / 2))
            }
        }
        guard low.x <= high.x, low.y <= high.y else { return nil }
        return CGRect(x: low.x, y: low.y, width: high.x - low.x, height: high.y - low.y)
    }

    /// The rectangle of this drawing's own coordinates that becomes the page when it is cut: the ink and `padding` all round, at least `minimum` on a side (grown
    /// round the middle of the ink). Its numbers are at the format's step, so a point moved by its origin lands on the step too. Nil for a drawing with no ink.
    public func cropBox(padding: Double = InkCrop.padding, minimum: Double = InkCrop.minimumSide) -> CGRect? {
        guard let ink = inkBounds else { return nil }
        let width = max(ink.width + 2 * padding, minimum), height = max(ink.height + 2 * padding, minimum)
        let x = ink.midX - width / 2, y = ink.midY - height / 2
        return CGRect(x: Self.stored(x, step: 0.01), y: Self.stored(y, step: 0.01), width: Self.stored(width, step: 0.01), height: Self.stored(height, step: 0.01))
    }

    /// This drawing with every point moved by (`dx`, `dy`) and a page of `size` (nib sizes and the rest stay as they are).
    public func translated(dx: Double, dy: Double, canvas size: CGSize) -> InkDocument {
        var moved = self
        moved.width = Double(size.width)
        moved.height = Double(size.height)
        for stroke in moved.strokes.indices {
            for point in moved.strokes[stroke].points.indices {
                moved.strokes[stroke].points[point].x += dx
                moved.strokes[stroke].points[point].y += dy
            }
        }
        return moved
    }

    /// The drawing cut to its ink; itself when it has none.
    public func cropped(padding: Double = InkCrop.padding, minimum: Double = InkCrop.minimumSide) -> InkDocument {
        guard let box = cropBox(padding: padding, minimum: minimum) else { return self }
        return translated(dx: -Double(box.minX), dy: -Double(box.minY), canvas: box.size)
    }
}
