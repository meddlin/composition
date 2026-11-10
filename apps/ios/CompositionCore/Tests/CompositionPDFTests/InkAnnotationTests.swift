import CompositionCore
import CompositionInk
import Foundation
import PDFKit
import Testing

@testable import CompositionPDF

// A page's ink, written into an exported copy as `Ink` annotations (C21: strokes simplified to paths), lands where it was drawn on every page geometry, in the
// copy as native annotations and in a flattened copy. "Where it was drawn" is the canvas PDFKit lays over a page: the page's unturned crop box with its top-left
// corner as the origin, turned with the page (docs/pdf-markup-plan.md, "Spike B status"), so a stroke near the canvas origin shows at the corner of the page
// that the rotation puts the unturned top-left corner at.

@Suite("A page's ink drawn by PDFKit")
struct InkAnnotationTests {
    /// A colour no page of the fixture has (it is black text and a red square).
    private static let blue = ThemeColor(red: 0, green: 0, blue: 255)
    private static func isBlue(_ r: Int, _ g: Int, _ b: Int) -> Bool { b > 180 && r < 90 && g < 90 }

    private func stroke(_ points: [(Double, Double)], color: ThemeColor = blue, width: Double = 6, opacity: Double = 1, ink: InkType = .pen) -> InkStroke {
        InkStroke(ink: ink, color: .fixed(color), points: points.map { InkPoint(x: $0.0, y: $0.1, width: width, height: width, opacity: opacity) })
    }

    private func drawing(on page: PDFPage, _ strokes: [InkStroke]) -> InkDocument {
        let crop = page.bounds(for: .cropBox)
        return InkDocument(width: Double(crop.width), height: Double(crop.height), strokes: strokes)
    }

    private func draw(_ ink: InkDocument, on page: PDFPage) -> [PDFAnnotation] {
        let annotations = InkAnnotations.annotations(for: ink, on: page)
        for annotation in annotations { page.addAnnotation(annotation) }
        return annotations
    }

    /// Where a stroke from canvas (20, 20) to (120, 20), 6 wide, shows on a page of this rotation, as the page is drawn (top-left origin, y down). PDFKit's pen has
    /// round ends, so the stroke runs half its width (3) past each end.
    private func expected(rotation: Int, width w: Double, height h: Double) -> CGRect {
        switch rotation {
        case 90: CGRect(x: w - 23, y: 17, width: 6, height: 106)
        case 180: CGRect(x: w - 123, y: h - 23, width: 106, height: 6)
        case 270: CGRect(x: 17, y: h - 123, width: 6, height: 106)
        default: CGRect(x: 17, y: 17, width: 106, height: 6)
        }
    }

    @Test("a stroke near the canvas origin shows at the corner the page's rotation puts it on, on all nine page geometries")
    func landsOnTheCorner() throws {
        let document = try geometryDocument()
        for index in 0..<document.pageCount {
            let page = try #require(document.page(at: index))
            let name = geometryNames[index]
            let base = render(page)
            let ink = drawing(on: page, [stroke([(20, 20), (70, 20), (120, 20)])])
            let made = draw(ink, on: page)
            defer { for annotation in made { page.removeAnnotation(annotation) } }
            #expect(made.count == 1 && made[0].type == "Ink", "\(name): one run of strokes is one annotation")

            let marked = render(page)
            let found = try #require(marked.extent(scale: renderScale, where: Self.isBlue), "\(name): the stroke is drawn")
            let shown = CGSize(width: Double(base.width) / renderScale, height: Double(base.height) / renderScale)
            let want = expected(rotation: page.rotation, width: shown.width, height: shown.height)
            let slack = 2.5
            #expect(
                abs(found.minX - want.minX) <= slack && abs(found.minY - want.minY) <= slack && abs(found.maxX - want.maxX) <= slack && abs(found.maxY - want.maxY) <= slack,
                "\(name) (turned \(page.rotation)°, page \(shown)): the stroke should be at \(want) and is at \(found)")
        }
    }

    @Test("a drawing made on another size of canvas is scaled to the page")
    func scaled() throws {
        let document = try geometryDocument()
        let page = try #require(document.page(at: 0))
        let crop = page.bounds(for: .cropBox)
        let half = InkDocument(width: Double(crop.width) / 2, height: Double(crop.height) / 2, strokes: [stroke([(10, 10), (60, 10)], width: 3)])
        let made = draw(half, on: page)
        defer { for annotation in made { page.removeAnnotation(annotation) } }
        let found = try #require(render(page).extent(scale: renderScale, where: Self.isBlue))
        #expect(abs(found.minX - 18.5) <= 2.5 && abs(found.maxX - 121.5) <= 2.5 && abs(found.minY - 18.5) <= 2.5 && abs(found.maxY - 21.5) <= 2.5, "\(found)")
    }

    @Test("strokes that look alike are one annotation, in the order drawn; a different colour, width or opacity starts another")
    func runs() throws {
        let document = try geometryDocument()
        let page = try #require(document.page(at: 0))
        let red = ThemeColor(red: 255, green: 0, blue: 0)
        let strokes = [
            stroke([(10, 10), (50, 10)]), stroke([(10, 30), (50, 30)]),
            stroke([(10, 50), (50, 50)], color: red),
            stroke([(10, 70), (50, 70)], width: 12), stroke([(10, 90), (50, 90)], width: 12),
            stroke([(10, 110), (50, 110)], opacity: 0.3),
            stroke([(10, 130), (50, 130)]),
        ]
        let made = InkAnnotations.annotations(for: drawing(on: page, strokes), on: page)
        #expect(made.count == 5, "blue ×2, red, thick ×2, faint, blue again (the order is kept, so the last is not folded into the first)")
        #expect(made.allSatisfy { $0.type == "Ink" && $0.userName == InkAnnotations.author })
        #expect(made.map { $0.paths?.count ?? 0 } == [2, 1, 2, 1, 1])
    }

    @Test("a dot is drawn, a pen's width is its strokes' average, the page's ink colour is black and an accent is the brand colour")
    func styles() throws {
        let document = try geometryDocument()
        let page = try #require(document.page(at: 0))
        let dot = InkStroke(ink: .pen, color: .fixed(Self.blue), points: [InkPoint(x: 300, y: 600, width: 10, height: 10)])
        let ink = InkStroke(ink: .pen, color: .ink, points: [InkPoint(x: 30, y: 650, width: 4, height: 4), InkPoint(x: 90, y: 650, width: 8, height: 8)])
        let accent = InkStroke(ink: .marker, color: .accent, points: [InkPoint(x: 30, y: 700, width: 4, height: 4), InkPoint(x: 90, y: 700, width: 4, height: 4)])
        let made = draw(drawing(on: page, [dot, ink, accent]), on: page)
        defer { for annotation in made { page.removeAnnotation(annotation) } }
        #expect(made.count == 3)

        // The dot: a blue patch about the pen's size, centred at canvas (300, 600).
        let patch = try #require(render(page).extent(scale: renderScale, where: Self.isBlue))
        #expect(abs(patch.midX - 300) <= 3 && abs(patch.midY - 600) <= 3 && patch.width >= 3, "\(patch)")

        func components(_ annotation: PDFAnnotation) -> [Int] {
            let color = annotation.color.usingColorSpace(.sRGB) ?? annotation.color
            return [color.redComponent, color.greenComponent, color.blueComponent].map { Int(($0 * 255).rounded()) }
        }
        #expect(components(made[1]) == [0, 0, 0], "ink is black on a page")
        let brand = Theme.default.brand
        #expect(components(made[2]) == [brand.red, brand.green, brand.blue], "accent is the brand colour")
        let border = try #require(made[1].border)
        #expect(abs(border.lineWidth - 6) < 0.11, "the average of 4 and 8: \(border.lineWidth)")
    }

    @Test("a page with no strokes writes nothing")
    func empty() throws {
        let document = try geometryDocument()
        let page = try #require(document.page(at: 0))
        #expect(InkAnnotations.annotations(for: drawing(on: page, []), on: page).isEmpty)
        #expect(InkAnnotations.annotations(for: drawing(on: page, [InkStroke(ink: .pen, color: .ink, points: [])]), on: page).isEmpty)
    }
}
