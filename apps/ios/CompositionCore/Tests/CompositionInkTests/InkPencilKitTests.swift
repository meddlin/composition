#if canImport(PencilKit)
import CoreGraphics
import Foundation
import PencilKit
import Testing

@testable import CompositionCore
@testable import CompositionInk

#if canImport(UIKit)
import UIKit
typealias Colour = UIColor
typealias Path = UIBezierPath
#else
import AppKit
typealias Colour = NSColor
typealias Path = NSBezierPath
#endif

@Suite("Ink: the PencilKit bridge")
struct InkPencilKitTests {
    let palette = InkPalette(ink: ThemeColor(red: 0, green: 0, blue: 0), accent: ThemeColor(red: 20, green: 90, blue: 200))

    func stroke(_ ink: PKInk.InkType, _ color: Colour, count: Int = 6, dx: Double = 10, transform: CGAffineTransform = .identity) -> PKStroke {
        let points = (0..<count).map { index in
            PKStrokePoint(
                location: CGPoint(x: 20 + Double(index) * dx, y: 30 + Double(index % 3) * 4), timeOffset: Double(index) * 0.01, size: CGSize(width: 3 + CGFloat(index) / 4, height: 3),
                opacity: 1, force: 0.5 + CGFloat(index) / 20, azimuth: 1.1, altitude: 0.9)
        }
        return PKStroke(ink: PKInk(ink, color: color), path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 0)), transform: transform)
    }

    @Test func aPencilKitDrawingBecomesStrokes() throws {
        let drawing = PKDrawing(strokes: [stroke(.pen, Colour(red: 0, green: 0, blue: 0, alpha: 1)), stroke(.marker, Colour(red: 0.96, green: 0.77, blue: 0.09, alpha: 1))])
        let page = InkDocument(drawing: drawing, size: CGSize(width: 300, height: 100))
        #expect((page.width, page.height) == (300, 100))
        #expect(page.strokes.count == 2)
        #expect(page.strokes[0].ink == .pen && page.strokes[0].color == .ink)
        #expect(page.strokes[1].ink == .marker && page.strokes[1].color == .fixed(ThemeColor(red: 245, green: 196, blue: 23)))
        #expect(page.strokes[0].points.count == 6)
        let second = page.strokes[0].points[1]
        #expect(abs(second.x - 30) < 1e-6 && abs(second.y - 34) < 1e-6)
        #expect(abs(second.t - 10) < 1e-6 && abs(second.force - 0.55) < 1e-6)
        // PencilKit keeps the angles and the nib size in less precision than a Double: a tenth of a thousandth is plenty.
        #expect(abs(second.width - 3.25) < 1e-3 && abs(second.azimuth - 1.1) < 1e-3 && abs(second.altitude - 0.9) < 1e-3)
    }

    @Test func everyKindOfInkSurvivesBothWays() throws {
        let kinds: [(PKInk.InkType, InkType)] = [(.pen, .pen), (.pencil, .pencil), (.marker, .marker), (.monoline, .monoline), (.fountainPen, .fountainPen), (.watercolor, .watercolor), (.crayon, .crayon)]
        for (kit, ours) in kinds {
            let page = InkDocument(drawing: PKDrawing(strokes: [stroke(kit, Colour.red)]), size: CGSize(width: 100, height: 100))
            #expect(page.strokes.first?.ink == ours)
            #expect(page.pkDrawing(palette: palette).strokes.first?.ink.inkType == kit)
        }
    }

    @Test func backToPencilKitKeepsThePointsToTheFormatsSteps() throws {
        let original = InkDocument(drawing: PKDrawing(strokes: [stroke(.pen, Colour.black), stroke(.pencil, Colour.blue, count: 20, dx: 3.37)]), size: CGSize(width: 200, height: 100))
        // Through the JSON, as a PNG's chunk would take it.
        let stored = try InkDocument(data: original.jsonData())
        let drawing = stored.pkDrawing(palette: palette)
        #expect(drawing.strokes.count == 2)
        for (index, piece) in drawing.strokes.enumerated() {
            #expect(piece.path.count == stored.strokes[index].points.count)
            for (position, point) in piece.path.enumerated() {
                let expected = stored.strokes[index].points[position]
                #expect(abs(Double(point.location.x) - expected.x) < 1e-4)
                #expect(abs(Double(point.location.y) - expected.y) < 1e-4)
                #expect(abs(point.timeOffset * 1000 - expected.t) < 1e-3)
            }
        }
        // And the points of the original are within the steps of the format of what came back.
        let again = InkDocument(drawing: drawing, size: CGSize(width: 200, height: 100))
        #expect(again.strokes.count == original.strokes.count)
        for (before, after) in zip(original.strokes, again.strokes) {
            #expect(before.ink == after.ink)
            for (a, b) in zip(before.points, after.points) {
                #expect(abs(a.x - b.x) <= 0.0051 && abs(a.y - b.y) <= 0.0051)
                #expect(abs(a.force - b.force) <= 0.0006 && abs(a.t - b.t) <= 0.51)
            }
        }
    }

    @Test func aStrokesTransformIsBakedIn() throws {
        let moved = stroke(.pen, Colour.black, transform: CGAffineTransform(translationX: 100, y: -5).scaledBy(x: 2, y: 2))
        let plain = stroke(.pen, Colour.black)
        let page = InkDocument(drawing: PKDrawing(strokes: [moved]), size: CGSize(width: 400, height: 100))
        let reference = InkDocument(drawing: PKDrawing(strokes: [plain]), size: CGSize(width: 400, height: 100))
        for (a, b) in zip(page.strokes[0].points, reference.strokes[0].points) {
            #expect(abs(a.x - (b.x * 2 + 100)) < 1e-6 && abs(a.y - (b.y * 2 - 5)) < 1e-6)
            #expect(abs(a.width - b.width * 2) < 1e-6)
        }
    }

    /// A line of eleven points ten apart along y = 30, so that x is ten times the path position.
    func line(mask: Path?) -> PKStroke {
        let points = (0..<11).map { PKStrokePoint(location: CGPoint(x: Double($0) * 10, y: 30), timeOffset: Double($0) * 0.01, size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: 1) }
        return PKStroke(ink: PKInk(.pen, color: Colour.black), path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 0)), transform: .identity, mask: mask)
    }

    @Test func aPixelErasedStrokeIsCutAtTheHole() throws {
        // The mask is what shows: two rectangles with a hole between x 30 and 60.
        let mask = Path(rect: CGRect(x: -5, y: 0, width: 35, height: 60))
        mask.append(Path(rect: CGRect(x: 60, y: 0, width: 45, height: 60)))
        let page = InkDocument(drawing: PKDrawing(strokes: [line(mask: mask)]), size: CGSize(width: 100, height: 60))
        #expect(page.strokes.count == 2)
        let (left, right) = (page.strokes[0].points.map(\.x), page.strokes[1].points.map(\.x))
        #expect(abs(left.first! - 0) < 1e-6 && abs(left.last! - 30) < 0.01)
        #expect(left.count == 4) // control points 0, 10, 20 and the cut at 30
        #expect(abs(right.first! - 60) < 0.1 && right.last == 100)
        #expect(right.count >= 5)
        // A hole shows in the stroke: no point lies in the gap.
        #expect((left + right).allSatisfy { $0 <= 30.01 || $0 >= 59.9 })
    }

    @Test func aStrokeWithAMaskThatShowsAllOfItIsOneStroke() throws {
        let mask = Path(rect: CGRect(x: -50, y: -50, width: 300, height: 300))
        let page = InkDocument(drawing: PKDrawing(strokes: [line(mask: mask)]), size: CGSize(width: 100, height: 60))
        #expect(page.strokes.count == 1)
        #expect(page.strokes[0].points.count == 11)
    }

    @Test func colourNamesFollowTheCallersChoice() throws {
        let drawing = PKDrawing(strokes: [stroke(.pen, Colour(red: 0.08, green: 0.35, blue: 0.78, alpha: 1))])
        let blue = ThemeColor(red: 20, green: 89, blue: 199)
        let page = InkDocument(drawing: drawing, size: CGSize(width: 100, height: 100)) { color in
            let parts = color.components ?? []
            return parts.count >= 3 && abs(parts[2] - 0.78) < 0.01 ? .accent : .fixed(blue)
        }
        #expect(page.strokes[0].color == .accent)
        #expect(InkDocument.defaultColorName(Colour.black.cgColor) == .ink)
        #expect(InkDocument.defaultColorName(Colour(red: 0.05, green: 0.05, blue: 0.1, alpha: 1).cgColor) == .ink)
        #expect(InkDocument.defaultColorName(Colour.white.cgColor) == .fixed(ThemeColor(red: 255, green: 255, blue: 255)))
    }
}
#endif
