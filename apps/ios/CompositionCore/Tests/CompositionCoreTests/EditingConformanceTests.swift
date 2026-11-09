import Foundation
import Testing

@testable import CompositionCore

// Build plan Step 9: the desktop's `completions.ts`, `props.ts`, `snippets.ts`, `indentLines.ts`, `emphasis.ts` and `noteLinks.ts` (with
// `noteRefs.ts`), against the real functions. The inputs are fixtures/conformance/editing-cases.json: 95 texts with a caret at every place in each
// (tags, props and values, quotes, fences, blank lines, emoji, CRLF), snippets, 986 selections to indent or outdent, 1,016 to make bold or italic,
// note links and their escapes; what the desktop made of each, and the catalogues it offers read through its own code, is editing-expected.json
// (see ConformanceTests.swift for how to run this).

private struct Cases: Decodable {
    struct Carets: Decodable { let text: String; let carets: [Int] }
    struct Indent: Decodable { let text: String; let from: Int; let to: Int; let command: String }
    struct Emphasis: Decodable { let text: String; let from: Int; let to: Int; let emphasis: String }
    struct Note: Decodable { let id: Int64; let title: String }
    struct Matching: Decodable { let notes: [Note]; let query: String; let excludeId: Int64? }
    struct Link: Decodable { let label: String; let id: Int64 }
    struct LinkTo: Decodable { let note: Note; let label: String? }
    struct Ref: Decodable { let href: String }
    let tags: [Carets], fronts: [Carets], slashes: [Carets], indents: [Indent], emphasis: [Emphasis], noteTriggers: [Carets], noteMatches: [Matching], links: [Link], linkTo: [LinkTo], refs: [Ref]
    let queries: [String]
}

private struct Item: Decodable, Equatable {
    let name: String
    let label: String?
    let description: String
    let template: String
}

private struct Target: Decodable, Equatable {
    let start: Int, end: Int
    let query: String
    let items: [Item]
    let label: String
}

private struct Trigger: Decodable, Equatable { let start: Int; let query: String }
private struct Edit: Decodable, Equatable {
    struct Selection: Decodable, Equatable { let start: Int, end: Int }
    let start: Int, end: Int
    let text: String
    let selection: Selection
}

private struct Expected: Decodable {
    struct Prop: Decodable, Equatable {
        struct Value: Decodable, Equatable { let value: String; let description: String }
        let name: String
        let description: String
        let values: [Value]
    }

    struct Catalog: Decodable {
        let completions: [Item]
        let props: [String: [Prop]]
        let snippets: [Item]
    }

    struct Expansion: Decodable, Equatable { let text: String; let caret: Int }

    let catalog: Catalog
    let matches: [[String]]
    let expansions: [Expansion]
    let triggers: [[Trigger?]]
    let props: [[Target?]]
    let fronts: [[Target?]]
    let targets: [[Target?]]
    let slashes: [[Target?]]
    let indents: [Edit?]
    let emphasis: [Edit?]
    let noteTriggers: [[Trigger?]]
    let noteMatches: [[Int64]]
    let links: [String]
    let linkTo: [String]
    let refs: [Int64?]
}

private func shown(_ text: String) -> String { String(reflecting: text.count > 50 ? String(text.prefix(50)) + "…" : text) }

private func item(_ completion: EditorCompletion) -> Item { Item(name: completion.name, label: completion.label, description: completion.description, template: completion.template) }

private func target(_ found: CompletionTarget?) -> Target? { found.map { Target(start: $0.start, end: $0.end, query: $0.query, items: $0.items.map(item), label: $0.label) } }

private func edit(_ found: LineEdit?) -> Edit? { found.map { Edit(start: $0.start, end: $0.end, text: $0.text, selection: .init(start: $0.selection.lowerBound, end: $0.selection.upperBound)) } }

@Suite("The typing aids against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct EditingConformanceTests {
    private func load() throws -> (Cases, Expected) {
        let directory = try #require(conformanceDirectory)
        let cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: directory.appendingPathComponent("editing-cases.json")))
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("editing-expected.json")))
        return (cases, expected)
    }

    @Test("the components, props, values and snippets on offer are the desktop's, in its order and its words")
    func catalogues() throws {
        let (_, expected) = try load()
        #expect(MdxCompletions.all.map(item) == expected.catalog.completions)
        #expect(MdxProps.catalog.map(\.component) == expected.catalog.completions.map(\.name))
        for (component, specs) in MdxProps.catalog {
            let want = try #require(expected.catalog.props[component], "\(component)")
            let got = specs.map { Expected.Prop(name: $0.name, description: $0.description, values: $0.values.map { .init(value: $0.value, description: $0.description) }) }
            #expect(got == want, "props of \(component)")
        }
        #expect(target(MarkdownSnippets.findTarget("/", caret: 1))?.items == expected.catalog.snippets)
        let (cases, _) = try load()
        for (index, query) in cases.queries.enumerated() { #expect(MdxCompletions.match(query).map(\.name) == expected.matches[index], "matching \(shown(query))") }
        #expect(MdxCompletions.all.map { MdxCompletions.expand($0) }.map { Expected.Expansion(text: $0.text, caret: $0.caret) } == expected.expansions)
    }

    @Test("a < and the props and values inside a tag are found at every caret as the desktop finds them")
    func tags() throws {
        let (cases, expected) = try load()
        #expect(cases.tags.count == expected.triggers.count)
        var offered = 0
        for (index, entry) in cases.tags.enumerated() {
            for (position, caret) in entry.carets.enumerated() {
                let trigger = MdxCompletions.findTrigger(entry.text, caret: caret).map { Trigger(start: $0.start, query: $0.query) }
                #expect(trigger == expected.triggers[index][position], "trigger in \(shown(entry.text)) at \(caret)")
                let found = target(MdxProps.findTarget(entry.text, caret: caret))
                if found != nil { offered += 1 }
                #expect(found == expected.props[index][position], "props in \(shown(entry.text)) at \(caret)")
            }
        }
        #expect(offered > 60)
    }

    @Test("the frontmatter's missing properties are offered at every caret as the desktop offers them")
    func frontmatter() throws {
        let (cases, expected) = try load()
        var offered = 0
        for (index, entry) in cases.fronts.enumerated() {
            for (position, caret) in entry.carets.enumerated() {
                let found = target(FrontmatterCompletions.findTarget(entry.text, caret: caret))
                if found != nil { offered += 1 }
                #expect(found == expected.fronts[index][position], "frontmatter in \(shown(entry.text)) at \(caret)")
            }
        }
        #expect(offered > 25)
    }

    @Test("what the list offers at the caret (components, props, frontmatter, snippets, in that order) is what the desktop's hook offers")
    func combined() throws {
        let (cases, expected) = try load()
        let texts = cases.tags + cases.fronts + cases.slashes
        #expect(texts.count == expected.targets.count)
        for (index, entry) in texts.enumerated() {
            for (position, caret) in entry.carets.enumerated() {
                #expect(target(MdxCompletions.target(entry.text, caret: caret)) == expected.targets[index][position], "list for \(shown(entry.text)) at \(caret)")
            }
        }
    }

    @Test("snippets after a slash are found at every caret as the desktop finds them")
    func slashes() throws {
        let (cases, expected) = try load()
        for (index, entry) in cases.slashes.enumerated() {
            for (position, caret) in entry.carets.enumerated() {
                #expect(target(MarkdownSnippets.findTarget(entry.text, caret: caret)) == expected.slashes[index][position], "snippets in \(shown(entry.text)) at \(caret)")
            }
        }
    }

    @Test("indenting and outdenting make the edit and the selection indentLines.ts makes, or none")
    func indenting() throws {
        let (cases, expected) = try load()
        #expect(cases.indents.count == expected.indents.count)
        for (index, item) in cases.indents.enumerated() {
            let command = IndentLines.Command(rawValue: item.command)!
            #expect(edit(IndentLines.edit(item.text, from: item.from, to: item.to, command: command)) == expected.indents[index], "\(item.command) \(shown(item.text)) from \(item.from) to \(item.to)")
        }
    }

    @Test("bold and italic make the edit and the selection toggleEmphasis makes, or none")
    func emphasis() throws {
        let (cases, expected) = try load()
        #expect(cases.emphasis.count == expected.emphasis.count)
        for (index, item) in cases.emphasis.enumerated() {
            let kind = EmphasisToggle(rawValue: item.emphasis)!
            #expect(edit(EmphasisToggle.toggle(item.text, from: item.from, to: item.to, kind)) == expected.emphasis[index], "\(item.emphasis) \(shown(item.text)) from \(item.from) to \(item.to)")
        }
    }

    @Test("note links: the [[ trigger, the notes offered, the escaped link and the id read back all match noteLinks.ts and noteRefs.ts")
    func noteLinks() throws {
        let (cases, expected) = try load()
        for (index, entry) in cases.noteTriggers.enumerated() {
            for (position, caret) in entry.carets.enumerated() {
                let got = NoteLinks.findTrigger(entry.text, caret: caret).map { Trigger(start: $0.start, query: $0.query) }
                #expect(got == expected.noteTriggers[index][position], "[[ in \(shown(entry.text)) at \(caret)")
            }
        }
        for (index, item) in cases.noteMatches.enumerated() {
            let notes = item.notes.map { NoteLinks.Candidate(id: $0.id, title: $0.title) }
            #expect(NoteLinks.match(notes, query: item.query, excluding: item.excludeId).map { Int64($0.id) } == expected.noteMatches[index], "notes for \(shown(item.query))")
        }
        for (index, item) in cases.links.enumerated() { #expect(NoteLinks.link(label: item.label, id: item.id) == expected.links[index], "link \(shown(item.label))") }
        for (index, item) in cases.linkTo.enumerated() { #expect(NoteLinks.link(to: .init(id: item.note.id, title: item.note.title), label: item.label) == expected.linkTo[index], "link to \(shown(item.note.title)) as \(String(describing: item.label))") }
        for (index, item) in cases.refs.enumerated() { #expect(NoteLinks.id(fromRef: item.href) == expected.refs[index], "ref \(shown(item.href))") }
    }
}
