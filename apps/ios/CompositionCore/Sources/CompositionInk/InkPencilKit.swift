#if canImport(PencilKit)
import CompositionCore
import CoreGraphics
import Foundation
import PencilKit

// PencilKit's drawing to and from the stroke format (docs/architecture/ink.md). Only the points go across: a `PKDrawing` is a list of strokes,
// each an ink and a path of control points, and the format keeps exactly those. What PencilKit keeps beyond that (the pixel eraser's masks,
// a stroke's transform) is baked in on the way out: a transform moves the points, and an erased stretch cuts the stroke in two.
// The PencilKit blob in the PNG stays the lossless copy for the iPad; this is the copy every other reader gets.

extension InkDocument {
    /// What a stored colour is called. PencilKit has no names: black (and near black, which a tool picker's dark swatch can produce) is `ink`, so it turns
    /// white on a dark scheme, and every other colour stays as chosen. A caller that knows more (an accent swatch of its own) passes its own.
    public static func defaultColorName(_ color: CGColor) -> InkColor {
        let rgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?.components ?? [0, 0, 0, 1]
        guard rgb.count >= 3 else { return .ink }
        let (r, g, b) = (Int((rgb[0] * 255).rounded()), Int((rgb[1] * 255).rounded()), Int((rgb[2] * 255).rounded()))
        if max(r, g, b) <= 26 { return .ink }
        return .fixed(ThemeColor(red: min(max(r, 0), 255), green: min(max(g, 0), 255), blue: min(max(b, 0), 255)))
    }

    /// The strokes of `drawing` on a canvas of `size`.
    public init(drawing: PKDrawing, size: CGSize, colorName: (CGColor) -> InkColor = InkDocument.defaultColorName) {
        var strokes: [InkStroke] = []
        for stroke in drawing.strokes {
            let ink = InkType(stroke.ink.inkType)
            let color = colorName(stroke.ink.color.cgColor)
            for piece in Self.pieces(of: stroke) {
                guard !piece.isEmpty else { continue }
                strokes.append(InkStroke(ink: ink, color: color, points: piece))
            }
        }
        self.init(width: Double(size.width), height: Double(size.height), strokes: strokes)
    }

    /// The control points of the stretches of a stroke that show (a pixel-erased stroke is several), with its transform applied.
    private static func pieces(of stroke: PKStroke) -> [[InkPoint]] {
        let path = stroke.path
        let count = path.count
        guard count > 0 else { return [] }
        let transform = stroke.transform
        // A transform that scales also scales the nib; the sign of the determinant does not matter to a size.
        let scale = Double(abs(transform.a * transform.d - transform.b * transform.c)).squareRoot()
        func point(_ control: PKStrokePoint) -> InkPoint {
            let moved = control.location.applying(transform)
            return InkPoint(
                x: Double(moved.x), y: Double(moved.y), t: control.timeOffset * 1000, force: Double(control.force),
                altitude: Double(control.altitude), azimuth: Double(control.azimuth),
                width: Double(control.size.width) * scale, height: Double(control.size.height) * scale, opacity: Double(control.opacity))
        }

        // `maskedPathRanges` are the stretches of the path the mask lets through (the whole path, `0...count-1`, when there is no mask): the
        // pixel eraser leaves a mask with a hole in it, and the hole is the gap between two ranges. Probed on macOS 27: a mask over x 30 to 60 of a
        // path of eleven points ten apart gives `3.0...6.001`; one over the two ends gives `0...3` and `6.001...10`.
        let visible = stroke.maskedPathRanges
        let last = CGFloat(count - 1)
        if visible == [0...last] { return [path.map(point)] }
        return visible.map { range in
            var points = [point(path.interpolatedPoint(at: range.lowerBound))]
            var index = Int(range.lowerBound.rounded(.down)) + 1
            while CGFloat(index) < range.upperBound {
                // A control point within a hundredth of an end is that end.
                if CGFloat(index) - range.lowerBound > 0.01, range.upperBound - CGFloat(index) > 0.01 { points.append(point(path[index])) }
                index += 1
            }
            points.append(point(path.interpolatedPoint(at: range.upperBound)))
            return points
        }
    }

    /// The drawing as PencilKit's: one stroke for each of this one's. `palette` gives the names their colours, as PencilKit has none.
    public func pkDrawing(palette: InkPalette, creationDate: Date = Date()) -> PKDrawing {
        var strokes: [PKStroke] = []
        for stroke in self.strokes where !stroke.points.isEmpty {
            let color = palette.color(for: stroke.color)
            let points = stroke.points.map { point in
                PKStrokePoint(
                    location: CGPoint(x: point.x, y: point.y), timeOffset: point.t / 1000, size: CGSize(width: point.width, height: point.height),
                    opacity: CGFloat(point.opacity), force: CGFloat(point.force), azimuth: CGFloat(point.azimuth), altitude: CGFloat(point.altitude))
            }
            let ink = PKInk(stroke.ink.pencilKit, color: platformColor(color))
            strokes.append(PKStroke(ink: ink, path: PKStrokePath(controlPoints: points, creationDate: creationDate)))
        }
        return PKDrawing(strokes: strokes)
    }
}

#if canImport(UIKit)
import UIKit
typealias PlatformColor = UIColor
#else
import AppKit
typealias PlatformColor = NSColor
#endif

/// An opaque sRGB colour as the platform's own class (`UIColor` has no sRGB initialiser and `NSColor`'s is not its only one, so it goes through `CGColor`).
private func platformColor(_ color: ThemeColor) -> PlatformColor {
    let cgColor = CGColor(srgbRed: CGFloat(color.red) / 255, green: CGFloat(color.green) / 255, blue: CGFloat(color.blue) / 255, alpha: 1)
    #if canImport(UIKit)
    return UIColor(cgColor: cgColor)
    #else
    return NSColor(cgColor: cgColor) ?? NSColor.black
    #endif
}

extension InkType {
    init(_ type: PKInk.InkType) {
        switch type {
        case .pencil: self = .pencil
        case .marker: self = .marker
        case .monoline: self = .monoline
        case .fountainPen: self = .fountainPen
        case .watercolor: self = .watercolor
        case .crayon: self = .crayon
        default: self = .pen
        }
    }

    /// PencilKit's kind of ink; a name PencilKit does not have is a pen.
    var pencilKit: PKInk.InkType {
        switch self {
        case .pencil: .pencil
        case .marker: .marker
        case .monoline: .monoline
        case .fountainPen: .fountainPen
        case .watercolor: .watercolor
        case .crayon: .crayon
        default: .pen
        }
    }
}
#endif
