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
//
// `UPDATE_FIXTURES=1 swift test --filter InkConformance` rewrites drawing.json and sample.png; validation.json is only ever edited by hand.

@Suite("Ink: the shared corpus")
struct InkConformanceTests {
    @Test func validationCases() throws {
        let directory = try #require(InkCorpus.directory)
        let corpus = try JSONValue(parsing: String(contentsOf: directory.appendingPathComponent("validation.json"), encoding: .utf8))
        let cases = try #require(corpus.objectValue?["cases"]?.arrayValue)
        #expect(cases.count >= 30)
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
        #expect(refused >= 20)
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
}
