import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

@Suite("Ink: the stroke JSON")
struct InkJSONTests {
    @Test func aDrawingComesBackAsItWent() throws {
        let page = InkSamples.page()
        let back = try InkDocument(data: page.jsonData())
        #expect(back == page)
    }

    @Test func numbersAreWrittenShort() throws {
        let page = InkDocument(width: 100, height: 100, strokes: [InkStroke(points: [InkPoint(x: 0.1 + 0.2, y: 1 / 3, t: 7.0000001, force: 0.30000000000000004)])])
        let text = String(decoding: page.jsonData(), as: UTF8.self)
        // 0.1 + 0.2 and a third, written at a hundredth; the force at a thousandth: no long tails.
        #expect(text.contains("[[0.3,0.33,7,0.3,"))
    }

    @Test func theColumnsAreNamedOnce() throws {
        let text = String(decoding: InkSamples.page().jsonData(), as: UTF8.self)
        #expect(text.components(separatedBy: "\"force\"").count == 2)
        #expect(text.hasPrefix("{\"format\":\"composition-ink\",\"version\":1,\"canvas\":{\"width\":200,\"height\":120},\"fields\":[\"x\",\"y\","))
    }

    @Test func whatIsNotUnderstoodIsKept() throws {
        var page = InkSamples.page()
        page.extra = [.init("author", .string("somebody")), .init("layers", .array([.number(1), .null]))]
        page.strokes[0].extra = [.init("seed", .number(7))]
        page.strokes[0].extraColumns = [InkExtraColumn(name: "tiltX", values: (0..<page.strokes[0].points.count).map { .number(Double($0) / 10) })]
        // The second stroke has no such column: its cells are null, and come back as no column at all? They come back as the column, with nulls.
        let back = try InkDocument(data: page.jsonData())
        #expect(back.extra == page.extra)
        #expect(back.strokes[0].extra == page.strokes[0].extra)
        #expect(back.strokes[0].extraColumns == page.strokes[0].extraColumns)
        #expect(back.strokes[1].extraColumns == [InkExtraColumn(name: "tiltX", values: Array(repeating: .null, count: back.strokes[1].points.count))])
        // And a second round trip changes nothing.
        #expect(try InkDocument(data: back.jsonData()) == back)
    }

    @Test func aNonFinitePointWritesAsTheDefault() throws {
        let page = InkDocument(width: 10, height: 10, strokes: [InkStroke(points: [InkPoint(x: 1, y: 2, force: .nan, width: .infinity)])])
        let back = try InkDocument(data: page.jsonData())
        #expect(back.strokes[0].points[0].force == 1)
        #expect(back.strokes[0].points[0].width == 3)
    }

    @Test func anEditedPointKeepsItsSiblings() throws {
        var back = try InkDocument(data: InkSamples.page().jsonData())
        back.strokes[0].points[0].x += 5
        let again = try InkDocument(data: back.jsonData())
        #expect(again.strokes[0].points[0].x == InkSamples.page().strokes[0].points[0].x + 5)
        #expect(again.strokes[1] == InkSamples.page().strokes[1])
    }

    @Test func tooManyStrokesAreRefused() throws {
        let strokes = String(repeating: "{\"points\":[]},", count: InkLimits.maxStrokes + 1).dropLast()
        let text = "{\"format\":\"composition-ink\",\"version\":1,\"canvas\":{\"width\":10,\"height\":10},\"strokes\":[\(strokes)]}"
        #expect(throws: InkError.self) { try InkDocument(data: Data(text.utf8)) }
    }

    @Test func theBlobIsCurrentUntilTheStrokesChange() throws {
        var page = InkSamples.page()
        #expect(!page.pencilKitBlobIsCurrent)
        page.markPencilKitCurrent()
        #expect(page.pencilKitBlobIsCurrent)
        // It survives being written and read, and marking again does not stack members.
        var back = try InkDocument(data: page.jsonData())
        #expect(back.pencilKitBlobIsCurrent)
        back.markPencilKitCurrent()
        #expect(back.extra.filter { $0.key == "pencilKit" }.count == 1)
        // Another program moves a point and keeps the member it does not know: the blob is stale.
        back.strokes[0].points[0].x += 1
        #expect(!back.pencilKitBlobIsCurrent)
        // Which does not depend on the colour of the page or the order of anything else.
        var other = InkSamples.page()
        other.extra = [.init("author", .string("x"))]
        #expect(other.strokesDigest == InkSamples.page().strokesDigest)
    }

    @Test func damagedTextIsRefused() {
        #expect(throws: InkError.self) { try InkDocument(data: Data("{\"format\":".utf8)) }
        #expect(throws: InkError.self) { try InkDocument(data: Data([0xFF, 0xFE, 0x00])) }
        #expect(throws: InkError.self) { try InkDocument(data: Data()) }
    }

    @Test func colourNames() {
        #expect(InkColor("ink") == .ink)
        #expect(InkColor("accent") == .accent)
        #expect(InkColor("light-blue") == .semantic("light-blue"))
        #expect(InkColor("#ABCDEF") == .fixed(ThemeColor(red: 0xAB, green: 0xCD, blue: 0xEF)))
        #expect(InkColor("#abcdef")?.text == "#abcdef")
        #expect(InkColor("Ink") == nil)
        #expect(InkColor("") == nil)
        #expect(InkColor("#abc") == nil)
        #expect(InkColor(String(repeating: "a", count: 33)) == nil)
    }
}
