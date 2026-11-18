import Foundation
import Testing

@testable import CompositionCore

// docs/ipad-live-default-plan.md, Step 4: Return continues a list or a quote and Backspace takes an empty item's marker away, as the desktop's
// `insertNewlineContinueMarkup` and `deleteMarkupBackward` (@codemirror/lang-markdown) do. The inputs are fixtures/conformance/list-continuation-cases.json,
// texts each tried with the caret at every place; list-continuation-expected.json holds what the real commands made of each on a real CodeMirror state
// with the desktop's Markdown language (see ConformanceTests.swift for how to run this).

private struct Cases: Decodable { let texts: [String] }

/// A caret place: the caret, and what Return and Backspace made of the text there.
private struct Place: Decodable {
    let caret: Int
    let enter: Outcome?
    let back: Outcome?

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        caret = try container.decode(Int.self)
        enter = try container.decode(Outcome?.self)
        back = try container.decode(Outcome?.self)
    }
}

/// The text afterwards and the caret, or nil where the command declined.
private struct Outcome: Decodable, Equatable {
    let text: String
    let caret: Int

    init(text: String, caret: Int) { (self.text, self.caret) = (text, caret) }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        text = try container.decode(String.self)
        caret = try container.decode(Int.self)
    }
}

private func outcome(_ text: String, _ edit: LineEdit?) -> Outcome? {
    guard let edit else { return nil }
    let units = Array(text.utf16)
    let after = Array(units[..<edit.start]) + Array(edit.text.utf16) + Array(units[edit.end...])
    return Outcome(text: String(decoding: after, as: UTF16.self), caret: edit.selection.lowerBound)
}

@Suite("Return and Backspace in lists and quotes against the desktop", .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct ListContinuationConformanceTests {
    private func load() throws -> ([String], [[Place]]) {
        let directory = try #require(conformanceDirectory)
        let cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: directory.appendingPathComponent("list-continuation-cases.json")))
        let expected = try JSONDecoder().decode([[Place]].self, from: Data(contentsOf: directory.appendingPathComponent("list-continuation-expected.json")))
        return (cases.texts, expected)
    }

    @Test("Return at every caret place does what the desktop's insertNewlineContinueMarkup does")
    func returns() throws {
        let (texts, expected) = try load()
        #expect(texts.count == expected.count)
        var compared = 0
        for (text, places) in zip(texts, expected) {
            for place in places {
                let actual = outcome(text, ListContinuation.newline(text, at: place.caret))
                #expect(actual == place.enter, "Return in \(String(reflecting: text)) at \(place.caret)")
                compared += 1
            }
        }
        #expect(compared > 1000)
    }

    @Test("Backspace at every caret place does what the desktop's deleteMarkupBackward does")
    func backspaces() throws {
        let (texts, expected) = try load()
        for (text, places) in zip(texts, expected) {
            for place in places {
                let actual = outcome(text, ListContinuation.deleteBackward(text, at: place.caret))
                #expect(actual == place.back, "Backspace in \(String(reflecting: text)) at \(place.caret)")
            }
        }
    }
}
