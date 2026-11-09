import Foundation
import Testing

@testable import CompositionCore

// Docs/ipad-live-view-plan.md, step L2: the Live view's model against the desktop's real `liveDecorations` (liveMarkdown.ts), run on a real CodeMirror
// state with the Markdown language. live-expected.json holds the texts (the hand-made ones of fixtures/conformance/live-cases.json, the MDX notes and
// the preview showcase), the selections tried on each (every caret position of a short text, a seeded sample of a long one) and what the desktop hid,
// showed, styled, drew and tinted for each. See ConformanceTests.swift for how to run this.

private struct Fixture: Decodable {
    struct Text: Decodable {
        let group: String
        let text: String
    }

    struct State: Decodable {
        let t: Int, from: Int, to: Int
    }

    struct Style: Decodable {
        let name: String, from: Int, to: Int
        init(from decoder: Decoder) throws {
            var row = try decoder.unkeyedContainer()
            name = try row.decode(String.self)
            from = try row.decode(Int.self)
            to = try row.decode(Int.self)
        }
    }

    struct Picture: Decodable {
        let from: Int?, to: Int
        let src: String, alt: String, title: String, width: String
        init(from decoder: Decoder) throws {
            var row = try decoder.unkeyedContainer()
            from = try row.decodeNil() ? nil : row.decode(Int.self)
            to = try row.decode(Int.self)
            src = try row.decode(String.self)
            alt = try row.decode(String.self)
            title = try row.decode(String.self)
            width = try row.decode(String.self)
        }
    }

    struct Tint: Decodable {
        let from: Int, to: Int, color: String
        init(from decoder: Decoder) throws {
            var row = try decoder.unkeyedContainer()
            from = try row.decode(Int.self)
            to = try row.decode(Int.self)
            color = try row.decode(String.self)
        }
    }

    struct Expected: Decodable {
        let frontmatterLines: [Int]
        let headings: [[Int]]
        let rules: [Int]
        let styles: [Style]
        let hidden: [[Int]]
        let shown: [[Int]]
        let pictures: [Picture]
        let tints: [Tint]
    }

    let limit: Int
    let texts: [Text]
    let states: [State]
    let expected: [Expected]
}

/// `\r\n` as one `\n`, which is how CodeMirror holds text the desktop slices strings from.
private func unified(_ text: String) -> String { text.replacingOccurrences(of: "\r\n", with: "\n") }

/// What the desktop said, one line for each fact, in a fixed order, so that two answers compare and a difference reads.
private func lines(_ expected: Fixture.Expected) -> [String] {
    var out: [String] = []
    out += expected.frontmatterLines.map { "frontmatter line at \($0)" }
    out += expected.headings.map { "heading at \($0[0]), level \($0[1])" }
    out += expected.rules.map { "rule at \($0)" }
    out += expected.styles.map { "\($0.name) \($0.from)-\($0.to)" }
    out += expected.hidden.map { "hidden \($0[0])-\($0[1])" }
    out += expected.shown.map { "shown \($0[0])-\($0[1])" }
    out += expected.pictures.map { picture in
        let where_ = picture.from.map { "in place of \($0)-\(picture.to)" } ?? "after the text, ending at \(picture.to)"
        return "picture \(where_): src=\(unified(picture.src)) alt=\(unified(picture.alt)) title=\(unified(picture.title)) width=\(picture.width)"
    }
    out += expected.tints.map { "tint \($0.from)-\($0.to) \($0.color)" }
    return out.sorted()
}

private func lines(_ decorations: LiveDecorations) -> [String] {
    var out: [String] = []
    out += decorations.frontmatterLines.map { "frontmatter line at \($0)" }
    out += decorations.headings.map { "heading at \($0.line), level \($0.level)" }
    out += decorations.rules.map { "rule at \($0)" }
    out += decorations.styles.map { "\($0.style.rawValue) \($0.range.location)-\(NSMaxRange($0.range))" }
    out += decorations.hidden.map { "hidden \($0.location)-\(NSMaxRange($0))" }
    out += decorations.shown.map { "shown \($0.location)-\(NSMaxRange($0))" }
    out += decorations.pictures.map { picture in
        let where_ = picture.active ? "after the text, ending at \(NSMaxRange(picture.range))" : "in place of \(picture.range.location)-\(NSMaxRange(picture.range))"
        return "picture \(where_): src=\(unified(picture.src)) alt=\(unified(picture.alt)) title=\(unified(picture.title)) width=\(picture.width)"
    }
    out += decorations.tints.map { "tint \($0.range.location)-\(NSMaxRange($0.range)) \($0.color)" }
    return out.sorted()
}

@Suite("The Live view against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct LiveConformanceTests {
    /// Texts the Swift model and the desktop's lezer-based code read differently, found by running this check and each looked at: the reason is the
    /// difference. Everything else must agree for every selection tried. Keep this list short, and fix a difference rather than add to it.
    static let known: [String: String] = [
        // A bare address with a space in it is not a link, and lezer's autolink takes `https://x.test/*not` before it looks for emphasis, so the
        // `*` inside is not an opener. cmark reads emphasis first and finds `*not italic*`. Only an address written with a space in it does this.
        "inline|[a link](https://x.test/*not italic*) done": "autolinks are read before emphasis by lezer, after it by cmark",
    ]

    @Test("every text, with every selection tried, is hidden, shown, styled, drawn and tinted as the desktop does")
    func agreement() throws {
        let directory = try #require(conformanceDirectory)
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: directory.appendingPathComponent("live-expected.json")))
        #expect(fixture.limit == LiveModel.desktopExtrasLimit)

        var models: [Int: LiveModel] = [:]
        var different: [Int: (count: Int, first: String)] = [:]
        for (index, state) in fixture.states.enumerated() {
            let model = models[state.t] ?? LiveModel(text: fixture.texts[state.t].text)
            models[state.t] = model
            let want = lines(fixture.expected[index])
            let got = lines(model.decorations(selection: NSRange(location: state.from, length: state.to - state.from)))
            guard want != got else { continue }
            let missing = Set(want).subtracting(got).sorted(), extra = Set(got).subtracting(want).sorted()
            let note = "selection \(state.from)-\(state.to): missing \(missing.prefix(4)), extra \(extra.prefix(4))"
            different[state.t] = ((different[state.t]?.count ?? 0) + 1, different[state.t]?.first ?? note)
        }

        var report: [String] = []
        for (t, found) in different.sorted(by: { $0.key < $1.key }) where Self.known[fixture.texts[t].group + "|" + fixture.texts[t].text] == nil {
            let text = fixture.texts[t].text
            report.append("[\(fixture.texts[t].group)] \(String(reflecting: text.count > 100 ? String(text.prefix(100)) + "…" : text))\n    \(found.count) selections differ; first: \(found.first)")
        }
        #expect(report.isEmpty, "\(report.count) of \(fixture.texts.count) texts differ:\n\(report.joined(separator: "\n"))")
    }
}
