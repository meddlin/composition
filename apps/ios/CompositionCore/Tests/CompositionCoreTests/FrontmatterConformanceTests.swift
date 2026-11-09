import Foundation
import Testing

@testable import CompositionCore

// Build plan, Step 3: the desktop's `frontmatter.ts` (and the js-yaml it stands on), against the real functions. The inputs are
// fixtures/conformance/frontmatter-cases.json: 111 blocks to read (the odd ones too: tabs, anchors, block scalars, bad escapes,
// dates), 123 titles, descriptions and tag lists to write, the header-image edits and the tag helpers. What the desktop made of
// each is frontmatter-expected.json (see ConformanceTests.swift for how to run this).

private struct Cases: Decodable {
    struct Generate: Decodable {
        let title: String, createdAt: String, updatedAt: String, description: String
        let tags: [String]
    }

    struct Header: Decodable {
        struct Image: Decodable { let image: String, layout: String }
        struct Fallback: Decodable { let title: String, createdAt: String, updatedAt: String }
        let content: String
        let header: Image?
        let fallback: Fallback
    }

    struct Tags: Decodable {
        let toString: [[String]]
        let fromString: [String]
    }

    let parse: [String]
    let generate: [Generate]
    let header: [Header]
    let tags: Tags
}

private struct Expected: Decodable {
    struct Parsed: Decodable {
        struct Block: Decodable, Equatable {
            let title: String, description: String
            let tags: [String]
            let createdAt: String, updatedAt: String
            let headerImage: String?
            let headerImageLayout: String?
        }

        let frontmatter: Block?
        let body: String
    }

    struct Tags: Decodable {
        let toString: [String]
        let fromString: [[String]]
    }

    let parse: [Parsed]
    let generate: [String]
    let header: [String]
    let tags: Tags
}

private func shown(_ text: String) -> String { String(reflecting: text.count > 90 ? String(text.prefix(90)) + "…" : text) }

@Suite("Frontmatter against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct FrontmatterConformanceTests {
    private func load() throws -> (Cases, Expected) {
        let directory = try #require(conformanceDirectory)
        let cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: directory.appendingPathComponent("frontmatter-cases.json")))
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("frontmatter-expected.json")))
        return (cases, expected)
    }

    @Test("blocks are read, or refused, as the desktop reads them")
    func reading() throws {
        let (cases, expected) = try load()
        var different: [String] = []
        for (index, content) in cases.parse.enumerated() {
            let want = expected.parse[index]
            let (parsed, body) = NoteFrontmatter.parse(content)
            let ours = parsed.map {
                Expected.Parsed.Block(title: $0.title, description: $0.description, tags: $0.tags, createdAt: $0.createdAt, updatedAt: $0.updatedAt,
                    headerImage: $0.headerImage?.image, headerImageLayout: $0.headerImage?.layout.rawValue)
            }
            if ours != want.frontmatter || body != want.body {
                different.append("  #\(index) \(shown(content)): ours \(ours.map { "\($0)" } ?? "none") body \(shown(body)), desktop \(want.frontmatter.map { "\($0)" } ?? "none") body \(shown(want.body))")
            }
            let split = NoteFrontmatter.split(content)
            if (split.frontmatter != nil) != (want.frontmatter != nil) || split.body != want.body {
                different.append("  #\(index) split disagrees with parse for \(shown(content))")
            }
        }
        print("\nFrontmatter reading: \(cases.parse.count - different.count) of \(cases.parse.count) blocks read as the desktop reads them")
        for line in different { print(line) }
        #expect(different.isEmpty, "blocks that differ: \(different.count)")
    }

    @Test("blocks are written byte for byte as the desktop writes them")
    func writing() throws {
        let (cases, expected) = try load()
        var different: [String] = []
        for (index, item) in cases.generate.enumerated() {
            let ours = NoteFrontmatter.generate(title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, description: item.description, tags: item.tags)
            if ours != expected.generate[index] {
                different.append("  #\(index) \(shown(item.title)) / \(shown(item.description)) / \(item.tags): ours \(shown(ours)), desktop \(shown(expected.generate[index]))")
            }
            // What was written reads back as what was given (the title, description and tags are kept whole).
            let (back, _) = NoteFrontmatter.parse(ours + "body")
            if back?.title != item.title || back?.description != item.description || back?.tags != item.tags.map(JavaScriptText.trim).filter({ !$0.isEmpty }) {
                different.append("  #\(index) does not read back: \(shown(ours))")
            }
        }
        print("\nFrontmatter writing: \(cases.generate.count - different.count) of \(cases.generate.count) blocks written as the desktop writes them")
        for line in different { print(line) }
        #expect(different.isEmpty, "blocks that differ: \(different.count)")
    }

    @Test("header images are set and removed as the desktop does")
    func headerImages() throws {
        let (cases, expected) = try load()
        var different: [String] = []
        for (index, item) in cases.header.enumerated() {
            let header = item.header.map { HeaderImage(image: $0.image, layout: HeaderImageLayout(rawValue: $0.layout) ?? .full) }
            let ours = NoteFrontmatter.withHeaderImage(item.content, header, fallback: (item.fallback.title, item.fallback.createdAt, item.fallback.updatedAt))
            if ours != expected.header[index] { different.append("  #\(index) \(shown(item.content)): ours \(shown(ours)), desktop \(shown(expected.header[index]))") }
        }
        print("\nHeader images: \(cases.header.count - different.count) of \(cases.header.count) edits made as the desktop makes them")
        for line in different { print(line) }
        #expect(different.isEmpty, "edits that differ: \(different.count)")
    }

    @Test("tags are joined and split as the desktop does")
    func tags() throws {
        let (cases, expected) = try load()
        for (index, tags) in cases.tags.toString.enumerated() {
            #expect(NoteFrontmatter.tagsToString(tags) == expected.tags.toString[index], "tagsToString \(tags)")
        }
        for (index, text) in cases.tags.fromString.enumerated() {
            #expect(NoteFrontmatter.tagsFromString(text) == expected.tags.fromString[index], "tagsFromString \(shown(text))")
        }
    }
}
