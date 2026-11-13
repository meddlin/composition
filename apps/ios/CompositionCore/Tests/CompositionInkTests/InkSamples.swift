import CompositionCore
import Foundation

@testable import CompositionInk

// Drawings shared by the ink tests, and by the reader comparison in spikes/ink-readers (which links this file, so it imports no test framework).

enum InkSamples {
    /// A small page with one of each thing the format has: a pen wave, a translucent marker in a `<Mark>` colour, a fixed-colour monoline, and a stroke
    /// of the accent. Every number is already at the format's steps, so writing and reading gives the same drawing back.
    static func page() -> InkDocument {
        let wave = (0..<14).map { index in
            InkPoint(x: 10 + Double(index) * 12, y: 40 + (index.isMultiple(of: 2) ? 12 : -12), t: Double(index) * 16, force: 0.5 + Double(index) / 40, altitude: 0.8, azimuth: 1.2, width: 3.5, height: 3.5, opacity: 1)
        }
        let marker = [InkPoint(x: 20, y: 90, width: 14, height: 14, opacity: 0.5), InkPoint(x: 100, y: 92, t: 400, width: 14, height: 14, opacity: 0.5), InkPoint(x: 170, y: 90, t: 800, width: 14, height: 14, opacity: 0.5)]
        let monoline = [InkPoint(x: 20, y: 20, width: 2, height: 2), InkPoint(x: 90, y: 24, t: 300, width: 2, height: 2), InkPoint(x: 160, y: 18, t: 600, width: 2, height: 2)]
        let dot = [InkPoint(x: 100, y: 60, width: 8, height: 8)]
        return InkDocument(width: 200, height: 120, strokes: [
            InkStroke(ink: .pen, color: .ink, points: wave),
            InkStroke(ink: .marker, color: .semantic("yellow"), points: marker),
            InkStroke(ink: .monoline, color: .fixed(ThemeColor(red: 200, green: 30, blue: 30)), points: monoline),
            InkStroke(ink: .pen, color: .accent, points: dot),
        ])
    }

    /// A dense page, made without any randomness: `strokes` strokes of `pointsEach` points, each a small arc somewhere on a tablet-sized page, with the
    /// per-point variation a real Pencil gives (force, tilt, time at 240 samples a second).
    static func dense(strokes: Int, pointsEach: Int) -> InkDocument {
        var out: [InkStroke] = []
        out.reserveCapacity(strokes)
        for stroke in 0..<strokes {
            let originX = Double((stroke * 37) % 780) + 20, originY = Double((stroke * 53) % 1100) + 20
            var points: [InkPoint] = []
            points.reserveCapacity(pointsEach)
            for index in 0..<pointsEach {
                let angle = Double(index) / Double(pointsEach) * .pi
                let wobble = sin(Double(index) * 0.9 + Double(stroke)) * 0.6
                points.append(InkPoint(
                    x: InkDocument.stored(originX + cos(angle) * 18 + wobble, step: 0.01), y: InkDocument.stored(originY + sin(angle) * 12 - wobble, step: 0.01),
                    t: Double(index) * 4, force: InkDocument.stored(0.4 + 0.5 * sin(angle), step: 0.001), altitude: InkDocument.stored(0.9 + 0.1 * cos(angle), step: 0.001),
                    azimuth: InkDocument.stored(1.0 + 0.2 * sin(angle * 2), step: 0.001), width: InkDocument.stored(2.5 + 1.5 * sin(angle), step: 0.01),
                    height: InkDocument.stored(2.5 + 1.5 * sin(angle), step: 0.01), opacity: 1))
            }
            out.append(InkStroke(ink: stroke.isMultiple(of: 9) ? .marker : .pen, color: stroke.isMultiple(of: 5) ? .semantic("blue") : .ink, points: points))
        }
        return InkDocument(width: 834, height: 1194, strokes: out)
    }
}
