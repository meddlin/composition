import Foundation
import Testing

@testable import CompositionCore

@Suite("Search query syntax")
struct SearchQueryTests {
    private func parse(_ raw: String) -> ParsedSearchQuery { SearchQueryParser.parse(raw) }

    @Test("free text stays free text")
    func freeText() {
        #expect(parse("  kubernetes   deep  ") == ParsedSearchQuery(text: "kubernetes deep", filters: [], attributes: nil))
        #expect(parse("").text == "" && parse("   ").text == "")
    }

    @Test("an unquoted value runs up to the next field, so a tag can be several words")
    func values() {
        #expect(parse("tags: web development").meilisearchFilters == ["tags = \"web development\""])
        #expect(parse("async tags: web development") == ParsedSearchQuery(text: "async", filters: [.tag("web development")], attributes: nil))
        #expect(parse("tags:\"web development\" async").text == "async")
        // The text after a value belongs to the value, so this date is "2026-01-01 roadmap": malformed, kept as text.
        let trailing = parse("tag: infra created: >=2026-01-01 roadmap")
        #expect(trailing.filters == [.tag("infra")] && trailing.text == "created: >=2026-01-01 roadmap")
        #expect(parse("roadmap tag: infra created: >=2026-01-01").text == "roadmap", "put free text first instead")
    }

    @Test("keys are case-insensitive, may be written as the frontmatter names, and only count at a word boundary")
    func keys() {
        #expect(parse("TAGS: Software").filters == [.tag("Software")])
        #expect(parse("createdAt: >2026-01-01").filters.count == 1 && parse("createdOn: >2026-01-01").filters.count == 1)
        #expect(parse("metatag:x").text == "metatag:x", "the tag: inside another word is plain text")
        #expect(parse("http://tag:foo").text == "http://tag:foo")
        #expect(parse("title:docker").attributes == ["title"] && parse("title:docker").text == "docker")
    }

    @Test("title and description scope the text to those attributes and join with the rest of it")
    func attributes() {
        let parsed = parse("title: kubernetes description: ownership notes")
        #expect(parsed.attributes == ["title", "description"])
        #expect(parsed.text == "kubernetes ownership notes", "each value runs to the next field")
    }

    @Test("a field with no value yet is ignored")
    func halfTyped() {
        for raw in ["tag:", "tags:  ", "title:", "created:"] {
            #expect(parse(raw) == ParsedSearchQuery(text: "", filters: [], attributes: nil), "\(raw)")
        }
        // A second key right after the first has no space before it, so it is the first one's value.
        #expect(parse("tag: created:").filters == [.tag("created:")])
    }

    @Test("dates: a bare date is the whole UTC day; operators move the bounds; a malformed date stays as text")
    func dates() {
        // 2026-08-01 is 1_785_542_400 seconds after 1970.
        #expect(parse("created: 2026-08-01").meilisearchFilters == ["created_at_ts >= 1785542400", "created_at_ts < 1785628800"])
        #expect(parse("created: =2026-08-01").meilisearchFilters == parse("created: 2026-08-01").meilisearchFilters)
        #expect(parse("created: >2026-08-01").meilisearchFilters == ["created_at_ts >= 1785628800"])
        #expect(parse("created: >=2026-08-01").meilisearchFilters == ["created_at_ts >= 1785542400"])
        #expect(parse("updated: <2026-08-01").meilisearchFilters == ["updated_at_ts < 1785542400"])
        #expect(parse("updated: <=2026-08-01").meilisearchFilters == ["updated_at_ts < 1785628800"])
        for bad in ["created: 2026-02-31", "created: tomorrow", "created: >2026-13-01", "created: 2026-1-1"] {
            #expect(parse(bad).filters.isEmpty && parse(bad).text == String(bad), "\(bad) finds nothing instead of dropping the constraint")
        }
        #expect(parse("created: 2024-02-29").filters.count == 2, "a real leap day")
    }

    @Test("JavaScript's whitespace, not Swift's, separates words")
    func whitespace() {
        #expect(parse("a\u{00A0}b").text == "a b", "a no-break space is a space to JavaScript")
        #expect(parse("a\u{0085}b").text == "a\u{0085}b", "NEL is not")
        #expect(parse("a\u{FEFF}b").text == "a b")
    }
}

/// The Swift parser against the desktop's real `parseSearchQuery`, over every query in search-queries.json.
@Suite("Search query syntax against the desktop", .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct SearchQueryConformanceTests {
    private struct Expected: Decodable {
        let text: String
        let filters: [String]
        let attributesToSearchOn: [String]?
    }

    @Test("makes the same text, filters and attributes for every query")
    func sameAsDesktop() throws {
        let directory = try #require(conformanceDirectory)
        let expected = try JSONDecoder().decode([String: Expected].self, from: Data(contentsOf: directory.appendingPathComponent("search-parse-expected.json")))
        #expect(expected.count > 200)
        for (query, desktop) in expected.sorted(by: { $0.key < $1.key }) {
            let swift = SearchQueryParser.parse(query)
            #expect(swift.text == desktop.text, "text of \(String(reflecting: query))")
            #expect(swift.meilisearchFilters == desktop.filters, "filters of \(String(reflecting: query))")
            #expect(swift.attributes == desktop.attributesToSearchOn, "attributes of \(String(reflecting: query))")
        }
    }
}
