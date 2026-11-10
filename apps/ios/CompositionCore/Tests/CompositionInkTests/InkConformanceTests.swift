import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

// The ink format against the shared corpus in fixtures/conformance/ink (fixtures/conformance/README.md). Unlike the PDF corpus, this one was
// written here first: the TypeScript reader (the desktop and the CLI) does not exist yet, so these files are what it is built against.
//
//   validation.json  what a reader must accept and what it writes back, and what it must refuse (written by hand)
//   drawing.json     the stroke JSON of `InkSamples.page()`, as this code writes it
//   sample.png       the same drawing rendered with the default scheme's ink colour, with the same JSON in its `inKJ` chunk
//   containers.json  what a reader must find in each PNG (sample.png, two-chunks.png, second-chunk-damaged.png, wide.png): the drawing's width, the problems it reports, the pixel density
//
// `UPDATE_FIXTURES=1 swift test --filter InkConformance` rewrites drawing.json and the PNGs; validation.json and containers.json are only ever edited by hand.

@Suite("Ink: the shared corpus")
struct InkConformanceTests {
    @Test func validationCases() throws {
        let directory = try #require(InkCorpus.directory)
        let corpus = try JSONValue(parsing: String(contentsOf: directory.appendingPathComponent("validation.json"), encoding: .utf8))
        let cases = try #require(corpus.objectValue?["cases"]?.arrayValue)
        #expect(cases.count >= 40)
        var refused = 0
        var rewritten: [String] = []
        var different: [String] = []
        for entry in cases {
            let name = entry.objectValue?["name"]?.stringValue ?? "?"
            let input = try #require(entry.objectValue?["input"], "\(name): no input")
            if entry.objectValue?["invalid"] == .bool(true) {
                #expect(throws: InkError.self, "\(name) must be refused") { try InkDocument(json: input) }
                refused += 1
            } else {
                let drawing = try InkDocument(json: input)
                if drawing.json != entry.objectValue?["stored"] { different.append(name) }
                // What is written back is stable: reading it and writing it again changes nothing (the first write already rounded).
                if try InkDocument(json: drawing.json).json != drawing.json { rewritten.append(name) }
            }
        }
        #expect(different == [], "cases that do not write back as `stored`")
        #expect(rewritten == [], "cases that change when written, read and written again")
        #expect(refused >= 30)
    }

    @Test func theCommittedDrawingIsWhatThisCodeWrites() throws {
        let directory = try #require(InkCorpus.directory)
        _ = InkCorpus.regenerated
        let page = InkSamples.page()
        let committed = try JSONValue(parsing: String(contentsOf: directory.appendingPathComponent("drawing.json"), encoding: .utf8))
        #expect(committed == page.json)
        #expect(try InkDocument(json: committed) == page)
    }

    @Test func theCommittedPNGCarriesThatDrawing() throws {
        _ = InkCorpus.regenerated
        let directory = try #require(InkCorpus.directory)
        let png = try Data(contentsOf: directory.appendingPathComponent("sample.png"))
        let contents = try InkPNG.contents(of: png)
        #expect(contents.problems.isEmpty)
        #expect(try contents.drawing() == InkSamples.page())
        let chunk = try #require(contents.strokeJSON)
        let text = try Data(contentsOf: directory.appendingPathComponent("drawing.json"))
        #expect(chunk == text)
    }

    @Test func containerCases() throws {
        _ = InkCorpus.regenerated
        let directory = try #require(InkCorpus.directory)
        let corpus = try JSONValue(parsing: String(contentsOf: directory.appendingPathComponent("containers.json"), encoding: .utf8))
        let cases = try #require(corpus.objectValue?["cases"]?.arrayValue)
        #expect(cases.count >= 4)
        for entry in cases {
            let object = try #require(entry.objectValue)
            let file = try #require(object["file"]?.stringValue)
            let png = try Data(contentsOf: directory.appendingPathComponent(file))
            let contents = try InkPNG.contents(of: png)
            #expect(contents.problems == object["problems"]?.arrayValue?.compactMap(\.stringValue), "\(file): problems")
            #expect(try contents.drawing()?.width == object["width"]?.doubleValue, "\(file): the drawing it carries")
            #expect(InkPNG.pixelsPerPoint(of: png) == object["pixelsPerPoint"]?.doubleValue, "\(file): pixels to a point")
        }
    }

    @Test func rendererTables() throws {
        let directory = try #require(InkCorpus.directory)
        let corpus = try #require(try JSONValue(parsing: String(contentsOf: directory.appendingPathComponent("renderer.json"), encoding: .utf8)).objectValue)
        let inks = try #require(corpus["inks"]?.objectValue)
        #expect(inks.members.count >= 8)
        for (name, value) in inks.members.map({ ($0.key, $0.value) }) {
            let style = InkRenderer.Style(InkType(rawValue: name))
            #expect(Double(style.alpha) == value.objectValue?["alpha"]?.doubleValue, "\(name): alpha")
            #expect(style.constantWidth == (value.objectValue?["oneWidth"] == .bool(true)), "\(name): one width")
        }
        let marks = try #require(corpus["marks"]?.objectValue)
        #expect(Set(marks.members.map(\.key)) == Set(Theme.markHues.keys))
        let palette = InkPalette(ink: ThemeColor(red: 1, green: 2, blue: 3), accent: ThemeColor(red: 4, green: 5, blue: 6))
        for member in marks.members {
            #expect(palette.color(for: .semantic(member.key)).hex == member.value.stringValue, "\(member.key)")
        }
        #expect(corpus["unknownColourName"]?.stringValue == "ink")
        #expect(palette.color(for: .semantic("teal")) == palette.ink)
    }

    @Test func darkStyleColours() throws {
        let directory = try #require(InkCorpus.directory)
        let corpus = try #require(try JSONValue(parsing: String(contentsOf: directory.appendingPathComponent("renderer.json"), encoding: .utf8)).objectValue)
        let pairs = try #require(corpus["darkStyle"]?.objectValue?["pairs"]?.arrayValue)
        #expect(pairs.count >= 12)
        let light = InkPalette(ink: ThemeColor(red: 1, green: 2, blue: 3), accent: ThemeColor(red: 4, green: 5, blue: 6))
        var dark = light
        dark.darkStyle = true
        for pair in pairs {
            let hexes = (pair.arrayValue ?? []).compactMap { $0.stringValue }
            try #require(hexes.count == 2)
            let stored = try #require(ThemeColor(hex: hexes[0]))
            #expect(stored.darkStyle.hex == hexes[1], "\(hexes[0]) on a dark scheme")
            #expect(dark.color(for: .fixed(stored)).hex == hexes[1])
            #expect(light.color(for: .fixed(stored)) == stored, "a light scheme draws it as stored")
            // Names do not change with the scheme's style: `ink` and `accent` come from the scheme, a mark hue is its hue.
            #expect(dark.color(for: .semantic("ink")) == dark.ink)
            #expect(dark.color(for: .semantic("blue")) == Theme.markHues["blue"])
        }
    }
}
