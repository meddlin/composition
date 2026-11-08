import Foundation
import Testing

@testable import CompositionCore

// Spike S4: the restricted MDX layer against the desktop's real preview pipeline (docs/ipad-app-design.md, "Markdown and
// MDX"). The notes are apps/ios/conformance/mdx-notes.json; what remark-mdx and the desktop's own plugins made of each is
// mdx-expected.json, written by apps/web/scripts/ios-conformance-fixtures.test.ts (see ConformanceTests.swift for how to run
// this). A note must come out the same way on both sides: valid or not, the components with their props, block or inline,
// the headings and the order of the footnotes. The error *messages* are not compared; they are the desktop's words.

private struct NotesFile: Decodable {
    struct Note: Decodable {
        let name: String
        let body: String
    }
    let notes: [Note]
}

private struct Expected: Decodable {
    struct Element: Decodable {
        let name: String
        let props: [String: String?]
        let flow: Bool
        let depth: Int
    }
    struct Heading: Decodable {
        let depth: Int
        let text: String
    }
    let mdx: Bool
    let valid: Bool
    let error: String?
    let elements: [Element]
    let headings: [Heading]
    let footnotes: [String]
}

@Suite("Markdown and MDX against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct MdxConformanceTests {
    private func describe(_ element: MdxElement) -> String {
        let props = element.props.sorted { $0.key < $1.key }.map { key, value in
            switch value {
            case .text(let text): "\(key)=\(String(reflecting: text))"
            case .flag: key
            }
        }
        return "\(element.isBlock ? "block" : "inline") \(element.depth) <\(element.name)\(props.isEmpty ? "" : " " + props.joined(separator: " "))>"
    }

    private func describe(_ element: Expected.Element) -> String {
        let props = element.props.sorted { $0.key < $1.key }.map { key, value in
            value.map { "\(key)=\(String(reflecting: $0))" } ?? key
        }
        return "\(element.flow ? "block" : "inline") \(element.depth) <\(element.name)\(props.isEmpty ? "" : " " + props.joined(separator: " "))>"
    }

    @Test("every note: valid or not, its components and props, block or inline, headings and footnotes")
    func notes() throws {
        let directory = try #require(conformanceDirectory)
        let notes = try JSONDecoder().decode(NotesFile.self, from: Data(contentsOf: directory.appendingPathComponent("mdx-notes.json"))).notes
        let expected = try JSONDecoder().decode([String: Expected].self, from: Data(contentsOf: directory.appendingPathComponent("mdx-expected.json")))
        #expect(expected.count == notes.count)

        var different: [String] = []
        for note in notes {
            let want = try #require(expected[note.name], "no answer for \(note.name)")
            let got = NoteScanner.scan(note.body)
            var problems: [String] = []
            if got.isMdx != want.mdx { problems.append("read as MDX: \(got.isMdx), desktop \(want.mdx)") }
            if got.isValid != want.valid { problems.append("valid: \(got.isValid) (\(got.error ?? "")), desktop \(want.valid) (\(want.error ?? ""))") }
            if want.mdx && want.valid && got.isValid {
                let ours = got.elements.map { describe($0) }, theirs = want.elements.map { describe($0) }
                if ours != theirs { problems.append("components: \(ours), desktop \(theirs)") }
                let ourHeadings = got.headings.map { "\($0.depth):\($0.text)" }, theirHeadings = want.headings.map { "\($0.depth):\($0.text)" }
                if ourHeadings != theirHeadings { problems.append("headings: \(ourHeadings), desktop \(theirHeadings)") }
                if got.footnotes != want.footnotes { problems.append("footnotes: \(got.footnotes), desktop \(want.footnotes)") }
            }
            if !problems.isEmpty { different.append("  \(note.name): " + problems.joined(separator: "; ")) }
        }
        print("\nS4 MDX: \(notes.count - different.count) of \(notes.count) notes agree with the desktop")
        for line in different { print(line) }
        #expect(different.isEmpty, "notes that differ: \(different.count)")
    }
}
