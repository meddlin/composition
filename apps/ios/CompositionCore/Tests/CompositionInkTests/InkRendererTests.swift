import CoreGraphics
import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

@Suite("Ink: the CoreGraphics renderer")
struct InkRendererTests {
    let black = InkPalette(ink: ThemeColor(red: 0, green: 0, blue: 0), accent: ThemeColor(red: 20, green: 90, blue: 200))
    let white = InkPalette(ink: ThemeColor(red: 255, green: 255, blue: 255), accent: ThemeColor(red: 250, green: 200, blue: 60))

    func render(_ page: InkDocument, _ palette: InkPalette, scale: CGFloat = 1) throws -> CGImage {
        try #require(InkRenderer.image(of: page, palette: palette, scale: scale))
    }

    func render(_ palette: InkPalette, scale: CGFloat = 1) throws -> CGImage {
        try render(InkSamples.page(), palette, scale: scale)
    }

    func near(_ value: Int, _ expected: Int, within slack: Int = 6) -> Bool { abs(value - expected) <= slack }

    @Test func theImageHasTheCanvasSizeTimesTheScale() throws {
        let image = try render(black, scale: 1)
        #expect((image.width, image.height) == (200, 120))
        let big = try render(black, scale: 3)
        #expect((big.width, big.height) == (600, 360))
    }

    @Test func theBackgroundIsTransparentAndTheStrokesAreNot() throws {
        let image = try render(black)
        #expect(pixel(image, x: 0, y: 0).a == 0)
        #expect(pixel(image, x: 199, y: 119).a == 0)
        #expect(inkedPixelCount(image) > 300)
    }

    @Test func inkTakesTheSchemesColour() throws {
        // The wave's first point is (10, 52); the nib there is 3.5 wide, so the pixel under it is covered.
        let dark = pixel(try render(black), x: 10, y: 52)
        let light = pixel(try render(white), x: 10, y: 52)
        #expect(dark.a > 200 && (dark.r, dark.g, dark.b) == (0, 0, 0))
        #expect(light.a > 200 && (light.r, light.g, light.b) == (255, 255, 255))
    }

    @Test func aFixedColourDoesNotMove() throws {
        // The wide marker is a name; the monoline is fixed red. Give the monoline a wide nib to sample it safely.
        var page = InkSamples.page()
        page.strokes[2].points = page.strokes[2].points.map { var point = $0; point.width = 8; point.height = 8; return point }
        for palette in [black, white] {
            let sample = pixel(try render(page, palette), x: 90, y: 24)
            #expect(sample.a > 240)
            #expect((sample.r, sample.g, sample.b) == (200, 30, 30))
        }
    }

    @Test func aNameTakesItsHueAndTheAccentTakesTheSchemes() throws {
        let image = try render(black)
        let marker = pixel(image, x: 60, y: 91)
        // Yellow, #f5c518, at the marker's share of its colour.
        #expect(near(marker.r, 0xF5) && near(marker.g, 0xC5) && near(marker.b, 0x18))
        #expect(near(pixel(image, x: 100, y: 60).b, 200) && near(pixel(image, x: 100, y: 60).r, 20))
        #expect(near(pixel(try render(white), x: 100, y: 60).r, 250))
    }

    @Test func aMarkerIsTranslucentAndDoesNotDarkenWhereItOverlaps() throws {
        // Three points a hundred apart with a 14 point nib: the pieces between them overlap at each point. The stroke has one opacity throughout.
        let image = try render(black)
        let between = pixel(image, x: 60, y: 91).a
        let atJoint = pixel(image, x: 100, y: 92).a
        // opacity 0.5 of a marker's 0.45 of the colour is 57 of 255.
        #expect(near(between, 57, within: 8))
        #expect(atJoint == between || abs(atJoint - between) <= 2)
    }

    @Test func aNameNobodyKnowsIsInk() throws {
        var page = InkDocument(width: 20, height: 20, strokes: [InkStroke(color: .semantic("chartreuse"), points: [InkPoint(x: 10, y: 10, width: 10, height: 10)])])
        let sample = pixel(try render(page, white), x: 10, y: 10)
        #expect((sample.r, sample.g, sample.b) == (255, 255, 255))
        page.strokes[0].ink = InkType(rawValue: "airbrush")
        #expect(pixel(try render(page, black), x: 10, y: 10).a > 200)
    }

    @Test func aSinglePointIsADot() throws {
        let page = InkDocument(width: 20, height: 20, strokes: [InkStroke(points: [InkPoint(x: 10, y: 10, width: 8, height: 8)])])
        let image = try render(page, black)
        #expect(pixel(image, x: 10, y: 10).a > 240)
        #expect(pixel(image, x: 2, y: 10).a == 0)
        #expect(inkedPixelCount(image) > 30)
    }

    @Test func twoPointsAreALine() throws {
        let page = InkDocument(width: 40, height: 20, strokes: [InkStroke(points: [InkPoint(x: 5, y: 10, width: 4, height: 4), InkPoint(x: 35, y: 10, width: 4, height: 4)])])
        let image = try render(page, black)
        #expect(pixel(image, x: 20, y: 10).a > 240)
        #expect(pixel(image, x: 20, y: 3).a == 0)
    }

    @Test func aMonolineIsOneWidthAlongItsLength() throws {
        let points = [InkPoint(x: 5, y: 20, width: 2, height: 2), InkPoint(x: 40, y: 20, width: 10, height: 10), InkPoint(x: 75, y: 20, width: 2, height: 2)]
        let pen = InkDocument(width: 80, height: 40, strokes: [InkStroke(ink: .pen, points: points)])
        let mono = InkDocument(width: 80, height: 40, strokes: [InkStroke(ink: .monoline, points: points)])
        // Mean width 4.67: near the ends the pen is 2 wide and the monoline is not, and in the middle the pen is 10 wide and the monoline is not.
        #expect(pixel(try render(pen, black), x: 10, y: 17).a < 100)
        #expect(pixel(try render(mono, black), x: 10, y: 18).a > 200)
        #expect(pixel(try render(pen, black), x: 40, y: 16).a > 200)
        #expect(pixel(try render(mono, black), x: 40, y: 16).a == 0)
    }

    @Test func aHugeCanvasIsHeldToEightThousandPixels() throws {
        let page = InkDocument(width: 50_000, height: 20_000, strokes: [])
        let image = try #require(InkRenderer.image(of: page, palette: black, scale: 2))
        #expect(image.width <= 8192 && image.height <= 8192)
        #expect(image.width == 8192)
    }

    @Test func anEmptyDrawingIsTransparent() throws {
        let image = try render(InkDocument(width: 30, height: 30), black)
        #expect(inkedPixelCount(image) == 0)
    }

    @Test func paletteFromAScheme() throws {
        for theme in Theme.all {
            let palette = InkPalette(theme: theme)
            #expect(palette.color(for: .ink) == theme.foreground)
            #expect(palette.color(for: .accent) == theme.brand)
            #expect(palette.color(for: .semantic("yellow")) == Theme.markHues["yellow"])
        }
    }
}
