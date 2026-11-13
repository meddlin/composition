import CompositionCore
import Foundation

@testable import CompositionInk

// Synthetic handwriting for the two readers (InkRecognizerComparisonTests): lowercase print letters, each a few pen strokes in the order a hand makes them, with a slant,
// a wobble and a pen's timing. **Not real handwriting:** it is regular, it has no joins, and nobody's hand looks like it. It shows what each reader does with the
// same strokes, and what each makes of marks that are not words; how either reads *your* writing still needs the iPad (manual item 263).

enum InkHandwriting {
    /// A pen stroke of a letter, in units of the x-height (y up from the baseline).
    typealias Path = [(x: Double, y: Double)]

    /// Points on an ellipse from one angle to another (degrees, counter-clockwise when `to` is bigger, clockwise when it is smaller).
    static func arc(_ cx: Double, _ cy: Double, _ rx: Double, _ ry: Double, _ from: Double, _ to: Double) -> Path {
        let steps = max(4, Int(abs(to - from) / 8))
        return (0...steps).map { index in
            let angle = (from + (to - from) * Double(index) / Double(steps)) * .pi / 180
            return (cx + rx * cos(angle), cy + ry * sin(angle))
        }
    }

    /// A letter: its strokes and its advance.
    struct Letter {
        var strokes: [Path]
        var width: Double
    }

    static let letters: [Character: Letter] = [
        "a": Letter(strokes: [arc(0.4, 0.5, 0.4, 0.5, 20, 340), [(0.8, 1), (0.8, 0)]], width: 0.8),
        "b": Letter(strokes: [[(0, 1.6), (0, 0)], arc(0.4, 0.5, 0.4, 0.5, 180, -180)], width: 0.8),
        "c": Letter(strokes: [arc(0.4, 0.5, 0.4, 0.5, 45, 315)], width: 0.75),
        "d": Letter(strokes: [arc(0.4, 0.5, 0.4, 0.5, 20, 340), [(0.8, 1.6), (0.8, 0)]], width: 0.8),
        "e": Letter(strokes: [[(0.04, 0.5), (0.82, 0.5)] + arc(0.42, 0.5, 0.4, 0.5, 0, 320)], width: 0.82),
        "f": Letter(strokes: [arc(0.55, 1.3, 0.25, 0.3, 30, 180) + [(0.3, 0)], [(0.05, 0.95), (0.6, 0.95)]], width: 0.6),
        "g": Letter(strokes: [arc(0.4, 0.5, 0.4, 0.5, 20, 340), [(0.8, 1), (0.8, -0.3)] + arc(0.45, -0.3, 0.35, 0.3, 0, -160)], width: 0.8),
        "h": Letter(strokes: [[(0, 1.6), (0, 0)], [(0, 0.6)] + arc(0.4, 0.6, 0.4, 0.4, 180, 0) + [(0.8, 0)]], width: 0.8),
        "i": Letter(strokes: [[(0.1, 1), (0.1, 0)], [(0.1, 1.35), (0.12, 1.33)]], width: 0.2),
        "j": Letter(strokes: [[(0.4, 1), (0.4, -0.3)] + arc(0.15, -0.3, 0.25, 0.3, 0, -160), [(0.4, 1.35), (0.42, 1.33)]], width: 0.45),
        "k": Letter(strokes: [[(0, 1.6), (0, 0)], [(0.7, 1), (0, 0.4), (0.75, 0)]], width: 0.75),
        "l": Letter(strokes: [[(0.1, 1.6), (0.1, 0)]], width: 0.2),
        "m": Letter(strokes: [[(0, 1), (0, 0)], [(0, 0.6)] + arc(0.3, 0.6, 0.3, 0.38, 180, 0) + [(0.6, 0)], [(0.6, 0.6)] + arc(0.9, 0.6, 0.3, 0.38, 180, 0) + [(1.2, 0)]], width: 1.2),
        "n": Letter(strokes: [[(0, 1), (0, 0)], [(0, 0.6)] + arc(0.4, 0.6, 0.4, 0.38, 180, 0) + [(0.8, 0)]], width: 0.8),
        "o": Letter(strokes: [arc(0.4, 0.5, 0.4, 0.5, 90, 450)], width: 0.8),
        "p": Letter(strokes: [[(0, 1), (0, -0.6)], arc(0.4, 0.5, 0.4, 0.5, 180, -180)], width: 0.8),
        "q": Letter(strokes: [arc(0.4, 0.5, 0.4, 0.5, 20, 340), [(0.8, 1), (0.8, -0.6)]], width: 0.8),
        "r": Letter(strokes: [[(0, 1), (0, 0)], [(0, 0.6)] + arc(0.35, 0.6, 0.35, 0.4, 180, 60)], width: 0.6),
        "s": Letter(strokes: [arc(0.38, 0.75, 0.34, 0.25, 30, 270) + arc(0.38, 0.25, 0.34, 0.25, 90, -150)], width: 0.75),
        "t": Letter(strokes: [[(0.3, 1.4), (0.3, 0)], [(0, 1), (0.62, 1)]], width: 0.62),
        "u": Letter(strokes: [[(0, 1)] + arc(0.4, 0.4, 0.4, 0.4, 180, 360) + [(0.8, 1), (0.8, 0)]], width: 0.8),
        "v": Letter(strokes: [[(0, 1), (0.4, 0), (0.8, 1)]], width: 0.8),
        "w": Letter(strokes: [[(0, 1), (0.3, 0), (0.6, 0.8), (0.9, 0), (1.2, 1)]], width: 1.2),
        "x": Letter(strokes: [[(0, 1), (0.8, 0)], [(0.8, 1), (0, 0)]], width: 0.8),
        "y": Letter(strokes: [[(0, 1), (0.4, 0)], [(0.8, 1), (0.25, -0.6)]], width: 0.8),
        "z": Letter(strokes: [[(0, 1), (0.8, 1), (0, 0), (0.8, 0)]], width: 0.8),
    ]

    /// `text` (lowercase letters, spaces and line breaks) written at `xHeight` points, a line apart by three of them, on a page with a margin. The pen moves at about
    /// six x-heights a second, lifts for 80 ms between strokes, and has a pen's nib; the letters lean by `slant` and wobble a little, the same way every time.
    static func write(_ text: String, xHeight: Double = 16, slant: Double = 0.18, ink: InkType = .pen) -> InkDocument {
        let margin = 24.0, lineGap = xHeight * 3
        var strokes: [InkStroke] = []
        var time = 0.0, maxX = 0.0
        for (row, line) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let baseline = margin + xHeight * 1.7 + Double(row) * lineGap
            var cursor = 0.0
            for (index, character) in line.enumerated() {
                guard let letter = letters[character] else { cursor += 0.8; continue }
                for path in letter.strokes {
                    var points: [InkPoint] = []
                    var previous: (x: Double, y: Double)?
                    for (x, y) in densified(path) {
                        let wobble = sin((cursor + x) * 7.3 + Double(row + index) * 1.9) * 0.025
                        let px = margin + (cursor + x + y * slant) * xHeight, py = baseline - (y + wobble) * xHeight
                        if let previous { time += hypot(px - previous.x, py - previous.y) / (xHeight * 6) * 1000 }
                        previous = (px, py)
                        let force = 0.45 + 0.15 * sin(Double(points.count) * 0.4)
                        points.append(InkPoint(
                            x: InkDocument.stored(px, step: 0.01), y: InkDocument.stored(py, step: 0.01), t: InkDocument.stored(time, step: 1), force: InkDocument.stored(force, step: 0.001),
                            altitude: 1.1, azimuth: 0.9, width: 2.4, height: 2.4, opacity: 1))
                        maxX = max(maxX, px)
                    }
                    strokes.append(InkStroke(ink: ink, color: .ink, points: points))
                    time += 80
                }
                cursor += letter.width + 0.3
            }
        }
        let rows = Double(text.split(separator: "\n", omittingEmptySubsequences: false).count)
        return InkDocument(width: (maxX + margin).rounded(.up), height: (margin * 2 + xHeight * 2.4 + (rows - 1) * lineGap).rounded(.up), strokes: strokes)
    }

    /// A path with a point at least every tenth of an x-height, as a pen samples it.
    static func densified(_ path: Path) -> Path {
        guard var last = path.first else { return [] }
        var out: Path = [last]
        for next in path.dropFirst() {
            let steps = max(1, Int((hypot(next.x - last.x, next.y - last.y) / 0.1).rounded(.up)))
            for step in 1...steps {
                let f = Double(step) / Double(steps)
                out.append((last.x + (next.x - last.x) * f, last.y + (next.y - last.y) * f))
            }
            last = next
        }
        return out
    }

    /// A made-up cursive signature: one long stroke of loops of uneven size (a prolate trochoid with a drift), then an underline. It is no word in any language, which is
    /// the case Gate C item 263 is about: a reader with a language model may make one of it.
    static func signature(loops: Int = 9, xHeight: Double = 22) -> InkDocument {
        var points: [InkPoint] = []
        let margin = 24.0
        var time = 0.0
        let samples = loops * 24
        var previous: (x: Double, y: Double)?
        for index in 0...samples {
            let t = Double(index) / 24 * 2 * .pi
            let size = 1 + 0.45 * sin(t * 0.37) + (index < 30 ? 0.6 : 0)
            let x = margin + (t * 0.32 - 0.55 * sin(t)) * xHeight, y = margin + xHeight * 2 - (0.6 * size * (1 - cos(t))) * xHeight + t * 0.6
            if let previous { time += hypot(x - previous.x, y - previous.y) / (xHeight * 8) * 1000 }
            previous = (x, y)
            points.append(InkPoint(x: InkDocument.stored(x, step: 0.01), y: InkDocument.stored(y, step: 0.01), t: InkDocument.stored(time, step: 1), force: 0.5, altitude: 1.1, azimuth: 0.9, width: 2.4, height: 2.4))
        }
        let right = points.map(\.x).max() ?? 0, bottom = points.map(\.y).max() ?? 0
        let underline = [InkPoint(x: margin, y: bottom + 10, t: time + 120, width: 2.4, height: 2.4), InkPoint(x: right, y: bottom + 6, t: time + 400, width: 2.4, height: 2.4)]
        return InkDocument(width: (right + margin).rounded(.up), height: (bottom + 10 + margin).rounded(.up), strokes: [
            InkStroke(ink: .pen, color: .ink, points: points), InkStroke(ink: .pen, color: .ink, points: underline),
        ])
    }
}
