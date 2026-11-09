import CoreGraphics
import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

// Gate C asks how big a dense page is, to decide whether the stroke JSON can ride in the PNG (docs/ipad-app-design.md, S5). These make a dense page
// without randomness and measure what it costs to write, store, read and draw. The numbers print (run with `swift test --filter InkDensity`),
// and the assertions are only that nothing is absurd: docs/architecture/ink.md has the table.
//
// A real page: Apple Notes' handwriting is some hundreds of strokes of a few dozen points. "Dense" here is ten times that, a page of small
// diagram and tight lecture notes; "extreme" is a page filled edge to edge with sketching.

@Suite("Ink: what a dense page costs")
struct InkDensityTests {
    struct Measure {
        var strokes: Int, points: Int
        var jsonBytes: Int, packedBytes: Int, pngBytes: Int
        var writeMilliseconds: Double, readMilliseconds: Double, renderMilliseconds: Double
    }

    func measure(strokes: Int, pointsEach: Int) throws -> Measure {
        let page = InkSamples.dense(strokes: strokes, pointsEach: pointsEach)
        var start = ContinuousClock.now
        let data = page.jsonData()
        let write = start.duration(to: .now)
        start = .now
        let back = try InkDocument(data: data)
        let read = start.duration(to: .now)
        #expect(back == page)
        let packed = try InkPNG.deflate(data)
        let palette = InkPalette(ink: ThemeColor(red: 0, green: 0, blue: 0), accent: ThemeColor(red: 20, green: 90, blue: 200))
        start = .now
        let png = try InkRenderer.pngData(of: page, palette: palette, scale: 2)
        let render = start.duration(to: .now)
        func ms(_ duration: Duration) -> Double { Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15 }
        return Measure(
            strokes: strokes, points: page.pointCount, jsonBytes: data.count, packedBytes: packed.count, pngBytes: png.count,
            writeMilliseconds: ms(write), readMilliseconds: ms(read), renderMilliseconds: ms(render))
    }

    /// The dense and extreme pages take a minute or more in a debug build, so they run on request: `INK_DENSITY=1 swift test -c release -Xswiftc -enable-testing --filter InkDensity`.
    static let onRequest = ProcessInfo.processInfo.environment["INK_DENSITY"] != nil

    @Test func aPageOfHandwriting() throws { try report(strokes: 500, pointsEach: 40, label: "a page of handwriting") }

    @Test(.enabled(if: InkDensityTests.onRequest, "set INK_DENSITY=1"), arguments: [(3_000, 60, "dense"), (10_000, 80, "extreme")])
    func aDensePage(strokes: Int, pointsEach: Int, label: String) throws { try report(strokes: strokes, pointsEach: pointsEach, label: label) }

    func report(strokes: Int, pointsEach: Int, label: String) throws {
        let result = try measure(strokes: strokes, pointsEach: pointsEach)
        print(String(
            format: "INK DENSITY %@: %d strokes, %d points; JSON %.2f MB, zlib %.2f MB (%.0f%%), PNG file %.2f MB; write %.0f ms, read %.0f ms, render + encode %.0f ms",
            label, result.strokes, result.points, Double(result.jsonBytes) / 1e6, Double(result.packedBytes) / 1e6, Double(result.packedBytes) / Double(result.jsonBytes) * 100,
            Double(result.pngBytes) / 1e6, result.writeMilliseconds, result.readMilliseconds, result.renderMilliseconds))
        #expect(result.packedBytes < result.jsonBytes)
        #expect(result.pngBytes < 64_000_000)
        #expect(result.readMilliseconds < 60_000)
    }
}
