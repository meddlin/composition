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

    /// A link's drawn text and the address it follows (Step 2 of docs/ipad-live-default-plan.md).
    struct Link: Decodable {
        let from: Int, to: Int, href: String
        init(from decoder: Decoder) throws {
            var row = try decoder.unkeyedContainer()
            from = try row.decode(Int.self)
            to = try row.decode(Int.self)
            href = try row.decode(String.self)
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
        /// Each `<Ink … />` the desktop draws from its strokes (InkWidget), in the form of a picture. Optional, so that a folder written before Step 1 still reads.
        let inks: [Picture]?
        let tints: [Tint]
        let links: [Link]
    }

    let texts: [Text]
    let states: [State]
    let expected: [Expected]
}

/// `\r\n` as one `\n`, which is how CodeMirror holds text the desktop slices strings from.
private func unified(_ text: String) -> String { text.replacingOccurrences(of: "\r\n", with: "\n") }

/// What the desktop said, one line for each fact, in a fixed order, so that two answers compare and a difference reads.
/// Whether `position` is where a footnote definition's first word starts (`[^a]: A.`). lezer reads such a line as a link definition whose address is that
/// word, and the desktop's `drawLink` lets a footnote definition's address through as a bare one, so it draws `A.` as a link to `http://A.`: not a link
/// anyone wrote. The iPad leaves footnotes alone until Step 7 of docs/ipad-live-default-plan.md draws them, so that one link is not compared (a link
/// written in the definition's text is).
private func isFootnoteDefinitionWord(_ position: Int, in text: String) -> Bool {
    let units = Array(text.utf16)
    var start = min(position, units.count)
    while start > 0, units[start - 1] != 0x0A, units[start - 1] != 0x0D { start -= 1 }
    guard start + 1 < units.count, units[start] == 0x5B, units[start + 1] == 0x5E, let close = units[start...].firstIndex(of: 0x5D),
        close + 1 < units.count, units[close + 1] == 0x3A
    else { return false }
    var word = close + 2
    while word < units.count, units[word] == 0x20 || units[word] == 0x09 { word += 1 }
    return word == position
}

private func lines(_ expected: Fixture.Expected, text: String) -> [String] {
    var out: [String] = []
    out += expected.frontmatterLines.map { "frontmatter line at \($0)" }
    out += expected.headings.map { "heading at \($0[0]), level \($0[1])" }
    out += expected.rules.map { "rule at \($0)" }
    out += expected.styles.map { "\($0.name) \($0.from)-\($0.to)" }
    out += expected.hidden.map { "hidden \($0[0])-\($0[1])" }
    out += expected.shown.map { "shown \($0[0])-\($0[1])" }
    func line(_ name: String, _ picture: Fixture.Picture) -> String {
        let where_ = picture.from.map { "in place of \($0)-\(picture.to)" } ?? "after the text, ending at \(picture.to)"
        return "\(name) \(where_): src=\(unified(picture.src)) alt=\(unified(picture.alt)) title=\(unified(picture.title)) width=\(picture.width)"
    }
    out += expected.pictures.map { line("picture", $0) }
    out += (expected.inks ?? []).map { line("ink", $0) }
    out += expected.tints.map { "tint \($0.from)-\($0.to) \($0.color)" }
    out += expected.links.filter { !isFootnoteDefinitionWord($0.from, in: text) }.map { "link \($0.from)-\($0.to) \(unified($0.href))" }
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
    // A `<Drawio … />` is the iPad's own (docs/ipad-live-default-plan.md, Step 1): the desktop's Live tab leaves it as its text, so it is not compared.
    // It is read as `<Image />` and `<Ink />` are, which `LiveModelTests` checks.
    out += decorations.pictures.filter { $0.kind != .drawio }.map { picture in
        let where_ = picture.active ? "after the text, ending at \(NSMaxRange(picture.range))" : "in place of \(picture.range.location)-\(NSMaxRange(picture.range))"
        let name = picture.kind == .ink ? "ink" : "picture"
        return "\(name) \(where_): src=\(unified(picture.src)) alt=\(unified(picture.alt)) title=\(unified(picture.title)) width=\(picture.width)"
    }
    out += decorations.tints.map { "tint \($0.range.location)-\(NSMaxRange($0.range)) \($0.color)" }
    out += decorations.links.map { "link \($0.range.location)-\(NSMaxRange($0.range)) \(unified($0.href))" }
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
        // lezer makes a link of `[brackets]` whether or not it is defined, and a link may not hold another, so the outer `[…](u)` is not one; drawLink
        // then draws nothing, `[brackets]` having no definition. CommonMark (cmark) makes the outer one a link, and so does the iPad's Preview.
        "links|[nested [brackets]](u)": "lezer takes the inner `[brackets]` as a link even with no definition; cmark makes the outer one the link",
    ]

    @Test("every text, with every selection tried, is hidden, shown, styled, drawn and tinted as the desktop does")
    func agreement() throws {
        let directory = try #require(conformanceDirectory)
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: directory.appendingPathComponent("live-expected.json")))

        var models: [Int: LiveModel] = [:]
        var different: [Int: (count: Int, first: String)] = [:]
        for (index, state) in fixture.states.enumerated() {
            let model = models[state.t] ?? LiveModel(text: fixture.texts[state.t].text)
            models[state.t] = model
            let want = lines(fixture.expected[index], text: fixture.texts[state.t].text)
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

    /// Code blocks the Swift model and the desktop's `liveCode` read differently, each looked at, keyed as `known` is.
    static let knownCode: [String: String] = [:]

    /// docs/ipad-live-default-plan.md, Step 3: for the same texts and selections, the lines the desktop draws as a code block (which are its fill's
    /// ends, which are fences), the fence lines it collapses and the indents it hides, from its real `codeDecorations` (liveCode.ts). That module
    /// comes with the desktop's Step 3 (its PR #324); a tree without it writes no `live-code-expected.json`, and this is skipped.
    @Test("every code block, with every selection tried, has its lines, fences and indent drawn and hidden as the desktop does")
    func codeBlocks() throws {
        let directory = try #require(conformanceDirectory)
        let codeFile = directory.appendingPathComponent("live-code-expected.json")
        guard FileManager.default.fileExists(atPath: codeFile.path) else {
            print("live-code-expected.json is not there: the desktop's liveCode.ts (its Step 3) is not in this tree yet, so code blocks are not compared")
            return
        }
        struct Code: Decodable {
            struct Line: Decodable {
                let start: Int, names: String
                init(from decoder: Decoder) throws {
                    var row = try decoder.unkeyedContainer()
                    start = try row.decode(Int.self)
                    names = try row.decode(String.self)
                }
            }
            struct Expected: Decodable {
                let lines: [Line]
                let hidden: [[Int]]
            }
            let expected: [Expected]
        }
        // Only the texts and the selections of live-expected.json (the desktop's later steps change the rest of it).
        struct Texts: Decodable {
            let texts: [Fixture.Text]
            let states: [Fixture.State]
        }
        let fixture = try JSONDecoder().decode(Texts.self, from: Data(contentsOf: directory.appendingPathComponent("live-expected.json")))
        let code = try JSONDecoder().decode(Code.self, from: Data(contentsOf: codeFile))
        #expect(code.expected.count == fixture.states.count)

        func want(_ expected: Code.Expected) -> [String] {
            (expected.lines.map { "line \($0.start): \($0.names)" } + expected.hidden.map { "indent hidden \($0[0])-\($0[1])" }).sorted()
        }
        func got(_ decorations: LiveDecorations) -> [String] {
            var out: [String] = []
            for block in decorations.codeBlocks {
                for line in block.lines {
                    var names: [String] = []
                    if block.fences.contains(line) { names.append("fence") }
                    if line == block.lines.first { names.append("first") }
                    if line == block.lines.last { names.append("last") }
                    out.append("line \(line): \(names.sorted().joined(separator: " "))")
                }
            }
            out += decorations.fencesHidden.map { "line \($0.location): hidden" }
            out += decorations.codeIndentsHidden.map { "indent hidden \($0.location)-\(NSMaxRange($0))" }
            return out.sorted()
        }

        var models: [Int: LiveModel] = [:]
        var different: [Int: (count: Int, first: String)] = [:]
        var blocks = 0
        for (index, state) in fixture.states.enumerated() {
            let model = models[state.t] ?? LiveModel(text: fixture.texts[state.t].text)
            models[state.t] = model
            let wanted = want(code.expected[index])
            let found = got(model.decorations(selection: NSRange(location: state.from, length: state.to - state.from)))
            if !wanted.isEmpty { blocks += 1 }
            guard wanted != found else { continue }
            let missing = Set(wanted).subtracting(found).sorted(), extra = Set(found).subtracting(wanted).sorted()
            let note = "selection \(state.from)-\(state.to): missing \(missing.prefix(4)), extra \(extra.prefix(4))"
            different[state.t] = ((different[state.t]?.count ?? 0) + 1, different[state.t]?.first ?? note)
        }
        #expect(blocks > 100, "the desktop drew code blocks in only \(blocks) states")

        var report: [String] = []
        for (t, found) in different.sorted(by: { $0.key < $1.key }) where Self.knownCode[fixture.texts[t].group + "|" + fixture.texts[t].text] == nil {
            let text = fixture.texts[t].text
            report.append("[\(fixture.texts[t].group)] \(String(reflecting: text.count > 100 ? String(text.prefix(100)) + "…" : text))\n    \(found.count) selections differ; first: \(found.first)")
        }
        #expect(report.isEmpty, "\(report.count) of \(fixture.texts.count) texts differ:\n\(report.joined(separator: "\n"))")
    }
}
