import CompositionCore
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Drawing a drawing without PencilKit: the stroke JSON turned into pixels with CoreGraphics, in whatever colours a scheme gives the
// semantic names. It serves the PNG fallback (what the CLI and any image viewer show), the thumbnails, and the pages drawn where PencilKit
// is not on screen. It is **simplified**: each stroke is the swept outline of its points' nib sizes, with a single opacity for the whole
// stroke (so overlapping parts do not darken, as the textured pencil, crayon and watercolour of PencilKit do not either on their flat
// parts). The grain and bleed of those three are not reproduced. docs/architecture/ink.md records how close this is, from the S5 comparison.

/// What the names in a drawing look like on one scheme. `ink` and `accent` follow the scheme; a `<Mark>` colour name is that hue.
public struct InkPalette: Equatable, Sendable {
    public var ink: ThemeColor
    public var accent: ThemeColor
    public var marks: [String: ThemeColor]

    public init(ink: ThemeColor, accent: ThemeColor, marks: [String: ThemeColor] = Theme.markHues) {
        (self.ink, self.accent, self.marks) = (ink, accent, marks)
    }

    /// The scheme's text colour for `ink` (so black ink is white on a dark scheme) and its brand colour for `accent`.
    public init(theme: Theme) {
        self.init(ink: theme.foreground, accent: theme.brand)
    }

    /// A name this palette does not know is drawn as ink.
    public func color(for color: InkColor) -> ThemeColor {
        switch color {
        case .fixed(let fixed): fixed
        case .semantic("accent"): accent
        case .semantic(let name): name == "ink" ? ink : (marks[name] ?? ink)
        }
    }
}

public enum InkRenderer {
    // MARK: Drawing

    /// Draws every stroke into `context`, in the drawing's own coordinates (y down, in points). The caller sets up the context's transform.
    public static func draw(_ drawing: InkDocument, in context: CGContext, palette: InkPalette) {
        for stroke in drawing.strokes {
            let color = palette.color(for: stroke.color)
            draw(stroke, color: CGColor(srgbRed: CGFloat(color.red) / 255, green: CGFloat(color.green) / 255, blue: CGFloat(color.blue) / 255, alpha: 1), in: context)
        }
    }

    /// The drawing on transparent pixels, `scale` pixels to a point (reduced when that would pass 8,192 pixels on a side).
    public static func image(of drawing: InkDocument, palette: InkPalette, scale: CGFloat = 2) -> CGImage? {
        let fit = min(scale, 8192 / CGFloat(drawing.width), 8192 / CGFloat(drawing.height))
        let width = max(1, Int((CGFloat(drawing.width) * fit).rounded())), height = max(1, Int((CGFloat(drawing.height) * fit).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
            let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        // y down, as the drawing is.
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: CGFloat(width) / CGFloat(drawing.width), y: -CGFloat(height) / CGFloat(drawing.height))
        context.setLineJoin(.round)
        draw(drawing, in: context, palette: palette)
        return context.makeImage()
    }

    /// The PNG a note stores: the drawing's pixels in this palette, with its strokes (and PencilKit's blob, when there is one) in the ink chunks.
    public static func pngData(of drawing: InkDocument, palette: InkPalette, scale: CGFloat = 2, pencilKit: Data? = nil) throws -> Data {
        guard let image = image(of: drawing, palette: palette, scale: scale) else { throw InkError("The drawing could not be rendered.") }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil) else { throw InkError("The drawing could not be saved as a PNG.") }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw InkError("The drawing could not be saved as a PNG.") }
        return try InkPNG.embedding(drawing: drawing, pencilKit: pencilKit, in: output as Data)
    }

    // MARK: A stroke

    /// How an ink differs from a plain opaque pen: how much of the colour shows, and whether the width is the mean of the points'.
    struct Style {
        var alpha: CGFloat
        var constantWidth: Bool

        init(_ ink: InkType) {
            switch ink {
            case .marker: (alpha, constantWidth) = (0.45, false)
            case .pencil: (alpha, constantWidth) = (0.8, false)
            case .watercolor: (alpha, constantWidth) = (0.4, false)
            case .crayon: (alpha, constantWidth) = (0.9, false)
            case .monoline: (alpha, constantWidth) = (1, true)
            default: (alpha, constantWidth) = (1, false)
            }
        }
    }

    /// A point of the smoothed outline: where, and how big the nib is there.
    struct Sample {
        var x: Double, y: Double, w: Double, h: Double, opacity: Double
    }

    static func draw(_ stroke: InkStroke, color: CGColor, in context: CGContext) {
        guard !stroke.points.isEmpty else { return }
        let style = Style(stroke.ink)
        var samples = smooth(stroke.points)
        if style.constantWidth {
            let mean = stroke.points.reduce(0) { $0 + $1.width } / Double(stroke.points.count)
            for index in samples.indices { (samples[index].w, samples[index].h) = (mean, mean) }
        }

        // One path for the whole stroke, filled once, so a stroke's overlapping parts are one shape with one opacity. Every piece is wound the
        // same way, so the non-zero rule joins them.
        let path = CGMutablePath()
        if samples.count == 1 {
            path.addPolygon(outline(samples[0]))
        } else {
            for index in 1..<samples.count { path.addPolygon(hull(outline(samples[index - 1]) + outline(samples[index]))) }
        }
        let opacity = samples.reduce(0) { $0 + $1.opacity } / Double(samples.count)
        context.saveGState()
        context.setFillColor(color.copy(alpha: style.alpha * CGFloat(min(max(opacity, 0), 1))) ?? color)
        context.addPath(path)
        context.fillPath(using: .winding)
        context.restoreGState()
    }

    /// The points between PencilKit's control points: a Catmull-Rom curve through them, a sample about every half nib width.
    static func smooth(_ points: [InkPoint]) -> [Sample] {
        func sample(_ point: InkPoint) -> Sample { Sample(x: point.x, y: point.y, w: max(point.width, 0.5), h: max(point.height, 0.5), opacity: point.opacity) }
        guard points.count > 2 else { return points.map(sample) }
        var out: [Sample] = [sample(points[0])]
        for index in 0..<(points.count - 1) {
            let p0 = points[max(index - 1, 0)], p1 = points[index], p2 = points[index + 1], p3 = points[min(index + 2, points.count - 1)]
            let distance = hypot(p2.x - p1.x, p2.y - p1.y)
            let step = max(0.5, min(p1.width, p2.width) * 0.5)
            let pieces = min(16, max(1, Int((distance / step).rounded(.up))))
            for piece in 1...pieces {
                let t = Double(piece) / Double(pieces)
                func spline(_ a: Double, _ b: Double, _ c: Double, _ d: Double) -> Double {
                    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
                }
                func line(_ a: Double, _ b: Double) -> Double { a + (b - a) * t }
                out.append(Sample(
                    x: spline(p0.x, p1.x, p2.x, p3.x), y: spline(p0.y, p1.y, p2.y, p3.y),
                    w: max(line(p1.width, p2.width), 0.5), h: max(line(p1.height, p2.height), 0.5), opacity: line(p1.opacity, p2.opacity)))
            }
        }
        return out
    }

    /// The nib at a sample: an ellipse of a dozen corners, counter-clockwise.
    static func outline(_ sample: Sample) -> [CGPoint] {
        let corners = sample.w < 2 && sample.h < 2 ? 6 : 12
        return (0..<corners).map { corner in
            let angle = 2 * Double.pi * Double(corner) / Double(corners)
            return CGPoint(x: sample.x + cos(angle) * sample.w / 2, y: sample.y + sin(angle) * sample.h / 2)
        }
    }

    /// The convex hull of some points, counter-clockwise in the maths sense (Andrew's monotone chain): what a nib sweeps between two samples.
    static func hull(_ points: [CGPoint]) -> [CGPoint] {
        let sorted = points.sorted { $0.x == $1.x ? $0.y < $1.y : $0.x < $1.x }
        func cross(_ o: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat { (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x) }
        var lower: [CGPoint] = []
        for point in sorted {
            while lower.count >= 2, cross(lower[lower.count - 2], lower[lower.count - 1], point) <= 0 { lower.removeLast() }
            lower.append(point)
        }
        var upper: [CGPoint] = []
        for point in sorted.reversed() {
            while upper.count >= 2, cross(upper[upper.count - 2], upper[upper.count - 1], point) <= 0 { upper.removeLast() }
            upper.append(point)
        }
        return Array(lower.dropLast()) + Array(upper.dropLast())
    }
}

private extension CGMutablePath {
    func addPolygon(_ points: [CGPoint]) {
        guard let first = points.first else { return }
        move(to: first)
        points.dropFirst().forEach { addLine(to: $0) }
        closeSubpath()
    }
}
