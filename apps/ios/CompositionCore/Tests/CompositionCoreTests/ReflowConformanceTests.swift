import Foundation
import Testing

@testable import CompositionCore

// Reflow against the desktop's own code. fixtures/conformance/reflow.json holds what `reflowText.ts`, `liveReflow.ts` and `writing.ts` make of a long list of
// inputs (apps/web/src/components/notes/reflowConformance.test.ts writes it, and `conformance.sh` checks the desktop still makes the same file). The file is
// committed, so a plain `swift test` replays it. See fixtures/conformance/README.md.

private let corpus: JSONValue? = corpusDirectory
    .flatMap { try? String(contentsOf: $0.appendingPathComponent("reflow.json"), encoding: .utf8) }
    .flatMap { try? JSONValue(parsing: $0) }

private func section(_ name: String) throws -> [JSONObject] {
    let corpus = try #require(corpus, "fixtures/conformance/reflow.json is missing or is not JSON")
    return try #require(corpus.objectValue?[name]?.arrayValue, "section \(name)").compactMap(\.objectValue)
}

/// A JSON value as `JSONSerialization` hands it over, which is what the settings parsers are given.
private func foundation(_ value: JSONValue) -> Any {
    switch value {
    case .null: NSNull()
    case .bool(let flag): NSNumber(value: flag)
    case .number(let number): NSNumber(value: number)
    case .string(let text): text
    case .array(let items): items.map(foundation)
    case .object(let members): Dictionary(members.members.map { ($0.key, foundation($0.value)) }, uniquingKeysWith: { $1 })
    }
}

private func settings(_ value: JSONValue?) -> WritingSettings? {
    guard let o = value?.objectValue else { return nil }
    var out = WritingSettings()
    if case .bool(let b)? = o["rulerEnabled"] { out.rulerEnabled = b }
    out.rulerColumn = o["rulerColumn"]?.integerValue ?? -1
    if case .bool(let b)? = o["reflowEnabled"] { out.reflowEnabled = b }
    out.reflowColumn = o["reflowColumn"]?.integerValue ?? -1
    if case .bool(let b)? = o["reflowKeepsTables"] { out.reflowKeepsTables = b }
    if case .bool(let b)? = o["wordCountEnabled"] { out.wordCountEnabled = b }
    if case .bool(let b)? = o["headingRailEnabled"] { out.headingRailEnabled = b }
    out.headingRailSide = o["headingRailSide"]?.stringValue.flatMap(HeadingRailSide.init(rawValue:)) ?? .left
    return out
}

@Suite("Reflow against the desktop", .enabled(if: corpus != nil, "fixtures/conformance/reflow.json is not there"))
struct ReflowConformanceTests {
    @Test("a line pushed past the column is broken where the desktop breaks it, the caret goes where the desktop puts it, and the lines it must not break are left whole")
    func reflow() throws {
        let cases = try section("reflow")
        #expect(cases.count > 550)
        var different: [String] = []
        var edits = 0, untouched = 0
        for (index, entry) in cases.enumerated() {
            let text = try #require(entry["text"]?.stringValue), caret = try #require(entry["caret"]?.integerValue)
            let options = ReflowOptions(column: try #require(entry["column"]?.integerValue), keepTables: entry["keepTables"] == .bool(true))
            let ours = ReflowText.reflowAtCaret(text, caret: caret, options: options)
            let theirs: ReflowEdit? = entry["edit"]?.objectValue.flatMap { edit in
                edit["text"]?.stringValue.flatMap { text in edit["caret"]?.integerValue.map { ReflowEdit(text: text, caret: $0) } }
            }
            if theirs == nil { untouched += 1 } else { edits += 1 }
            if ours != theirs {
                different.append("#\(index) \(text.debugDescription) at \(caret), column \(options.column): ours \(String(describing: ours)), desktop \(String(describing: theirs))")
            }
        }
        #expect(edits > 200 && untouched > 150, "the corpus has both kinds: \(edits) edits and \(untouched) lines left alone")
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(3))")
    }

    @Test("the stretch that changed between two texts is the desktop's, in UTF-16 units")
    func spans() throws {
        let cases = try section("spans")
        #expect(cases.count >= 18)
        for entry in cases {
            let before = try #require(entry["before"]?.stringValue), after = try #require(entry["after"]?.stringValue)
            let span = try #require(entry["span"]?.objectValue)
            let ours = ReflowText.changedSpan(before: before, after: after)
            let theirs = ReflowSpan(start: span["start"]?.integerValue ?? -1, end: span["end"]?.integerValue ?? -1, insert: span["insert"]?.stringValue ?? "?")
            // A change that splits an emoji's two halves cannot be written as a Swift string; the desktop's own cases of that kind are not in the corpus.
            #expect(ours == theirs, "\(before.debugDescription) to \(after.debugDescription)")
        }
    }

    @Test("a keystroke reflows, and a paste, a drop, an undo, a deletion, a return and a half-composed word do not")
    func typing() throws {
        let cases = try section("typing")
        #expect(cases.count > 250)
        var different: [String] = []
        var reflowed = 0, left = 0
        for (index, entry) in cases.enumerated() {
            let doc = try #require(entry["doc"]?.stringValue), insert = try #require(entry["insert"]?.stringValue)
            let from = try #require(entry["from"]?.integerValue), to = try #require(entry["to"]?.integerValue), caret = try #require(entry["caret"]?.integerValue)
            let event = LiveReflow.Event(userEvent: entry["event"]?.stringValue)
            let options = ReflowOptions(column: try #require(entry["column"]?.integerValue), keepTables: entry["keepTables"] == .bool(true))

            let edit = LiveReflow.edit(applying: .init(from: from, to: to, insert: insert), to: doc, caret: caret, event: event, options: options)
            let units = Array(doc.utf16)
            let plain = String(decoding: Array(units[0..<from]) + Array(insert.utf16) + Array(units[to...]), as: UTF16.self)
            let result = try #require(entry["result"]?.objectValue)
            let text = edit?.text ?? plain, head = edit?.caret ?? caret
            if edit != nil { reflowed += 1 } else { left += 1 }
            if text != result["text"]?.stringValue || head != result["caret"]?.integerValue || (edit != nil) != (result["reflowed"] == .bool(true)) {
                different.append("#\(index) \(doc.debugDescription) + \(insert.debugDescription) (\(entry["event"]?.stringValue ?? "no event")): ours \(text.debugDescription) at \(head), desktop \(String(describing: result["text"]?.stringValue)) at \(String(describing: result["caret"]?.integerValue))")
            }
        }
        #expect(reflowed > 30 && left > 150, "the corpus has both kinds: \(reflowed) reflowed and \(left) left")
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(3))")
    }

    @Test("an event is typing only when CodeMirror would say so: input.type and the names beneath it, but not a composition")
    func events() {
        #expect(LiveReflow.Event(userEvent: "input.type") == .typing)
        #expect(LiveReflow.Event(userEvent: "input.type.autocorrect") == .typing)
        #expect(LiveReflow.Event(userEvent: "input.type.compose") == .composing)
        #expect(LiveReflow.Event(userEvent: "input.type.compose.end") == .composing)
        for other in ["input", "input.paste", "input.drop", "input.typed", "input.types.compose", "delete.backward", "undo", ""] { #expect(LiveReflow.Event(userEvent: other) == .other, "\(other)") }
        #expect(LiveReflow.Event(userEvent: nil) == .other)
    }

    @Test("the ruler and reflow settings are read, and refused, as the desktop reads and refuses them")
    func writing() throws {
        let parse = try section("writingParse"), validate = try section("writingValidate")
        #expect(parse.count > 60 && validate.count > 60)
        for entry in parse {
            let input = foundation(entry["input"] ?? .null)
            #expect(WritingSettings.parse(input) == settings(entry["settings"]), "parseWritingSettings(\(input))")
        }
        var refused = 0
        for entry in validate {
            let input = foundation(entry["input"] ?? .null)
            switch WritingSettings.validate(input) {
            case .valid(let ours):
                #expect(ours == settings(entry["settings"]), "validateWritingSettings(\(input))")
            case .invalid(let message):
                refused += 1
                #expect(message == entry["error"]?.stringValue, "validateWritingSettings(\(input))")
            }
        }
        #expect(refused > 30)
    }
}
