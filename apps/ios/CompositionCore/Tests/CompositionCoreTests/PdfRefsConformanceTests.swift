import Foundation
import Testing

@testable import CompositionCore

// The `pdf:` links of a note against the desktop's own `pdfRefs.ts`, run over the inputs in apps/ios/scripts/pdf-refs-oracle.mjs. The result is
// committed (fixtures/conformance/pdf-refs.json), so a plain `swift test` replays it; `apps/ios/scripts/conformance.sh` first checks that it is
// what the desktop makes now.

@Suite("PDF links against the desktop")
struct PdfRefsConformanceTests {
    private static let corpus: JSONValue? = {
        let file = corpusDirectory?.appendingPathComponent("pdf-refs.json")
        return file.flatMap { try? String(contentsOf: $0, encoding: .utf8) }.flatMap { try? JSONValue(parsing: $0) }
    }()

    private func cases(_ name: String) throws -> [JSONObject] {
        let corpus = try #require(Self.corpus, "fixtures/conformance/pdf-refs.json is missing or is not JSON")
        return try #require(corpus.objectValue?[name]?.arrayValue).compactMap(\.objectValue)
    }

    /// `null` or a number from the file, as the optional the Swift side takes.
    private func optionalInt(_ value: JSONValue?) -> Int? { value?.integerValue }

    private func optionalString(_ value: JSONValue?) -> String? { value?.stringValue }

    private func labels(_ value: JSONValue?) -> [String]? { value?.arrayValue?.compactMap(\.stringValue) }

    @Test("a target is written as the desktop writes it")
    func writtenTargets() throws {
        let all = try cases("refs")
        #expect(all.count >= 8)
        for entry in all {
            let uuid = try #require(entry["uuid"]?.stringValue), expected = try #require(entry["ref"]?.stringValue)
            #expect(PdfRefs.ref(uuid: uuid, page: optionalInt(entry["page"]), mark: optionalString(entry["mark"])) == expected)
        }
    }

    @Test("a target is read as the desktop reads it, and what it drops it drops too")
    func readTargets() throws {
        let all = try cases("parsed")
        #expect(all.count >= 45)
        for entry in all {
            let href = try #require(entry["href"]?.stringValue)
            let parsed = PdfRefs.parse(href)
            if case .null? = entry["ref"] {
                #expect(parsed == nil, "\(href.debugDescription) is not a pdf link")
            } else {
                let expected = try #require(entry["ref"]?.objectValue, "\(href.debugDescription)")
                let wanted = PdfRef(uuid: try #require(expected["uuid"]?.stringValue), page: optionalInt(expected["page"]), mark: optionalString(expected["mark"]))
                #expect(parsed == wanted, "\(href.debugDescription)")
            }
        }
    }

    @Test("text from a PDF is made literal as the desktop makes it")
    func escaping() throws {
        let all = try cases("escaped")
        #expect(all.count >= 50)
        for entry in all {
            let raw = try #require(entry["text"]?.stringValue), escaped = try #require(entry["escaped"]?.stringValue)
            #expect(PdfRefs.escapeMarkdown(raw) == escaped, "\(raw.debugDescription)")
        }
    }

    @Test("a page is named by its printed label when the PDF has one")
    func pageLabels() throws {
        let all = try cases("pageLabels")
        #expect(all.count >= 30)
        for entry in all {
            let page = try #require(entry["page"]?.integerValue), expected = try #require(entry["label"]?.stringValue)
            #expect(PdfRefs.pageLabel(page: page, labels: labels(entry["labels"])) == expected, "page \(page), \(String(describing: entry["labels"]))")
        }
    }

    @Test("a link to a PDF, a page citation and a quote block read as the desktop writes them")
    func writtenCitations() throws {
        for entry in try cases("links") {
            let uuid = try #require(entry["uuid"]?.stringValue), title = try #require(entry["title"]?.stringValue)
            #expect(PdfRefs.link(uuid: uuid, title: title) == (try #require(entry["link"]?.stringValue)), "\(title.debugDescription)")
        }
        let citations = try cases("pageCitations")
        #expect(citations.count >= 60)
        for entry in citations {
            let uuid = try #require(entry["uuid"]?.stringValue), title = try #require(entry["title"]?.stringValue), page = try #require(entry["page"]?.integerValue)
            #expect(PdfRefs.pageCitation(uuid: uuid, title: title, page: page, labels: labels(entry["labels"])) == (try #require(entry["citation"]?.stringValue)), "\(title.debugDescription) p. \(page)")
        }
        let blocks = try cases("quoteBlocks")
        #expect(blocks.count >= 300)
        for entry in blocks {
            let uuid = try #require(entry["uuid"]?.stringValue), title = try #require(entry["title"]?.stringValue)
            let quote = try #require(entry["quote"]?.stringValue), page = try #require(entry["page"]?.integerValue)
            let made = PdfRefs.quoteBlock(uuid: uuid, title: title, quote: quote, page: page, mark: optionalString(entry["mark"]), labels: labels(entry["labels"]))
            #expect(made == (try #require(entry["block"]?.stringValue)), "\(title.debugDescription) / \(quote.debugDescription)")
        }
    }

    @Test("the pages and marks a note's text cites are the ones the desktop finds")
    func citedPagesAndMarks() throws {
        let all = try cases("cited")
        #expect(all.count >= 30)
        for entry in all {
            let text = try #require(entry["text"]?.stringValue), uuid = try #require(entry["uuid"]?.stringValue)
            #expect(PdfRefs.cites(text, uuid: uuid) == (entry["cites"] == .bool(true)), "\(text.debugDescription)")
            let expected = try #require(entry["citations"]?.objectValue)
            let found = PdfRefs.citations(inText: text, of: uuid)
            #expect(found.pages == (expected["pages"]?.arrayValue ?? []).compactMap(\.integerValue), "pages of \(text.debugDescription) for \(uuid)")
            #expect(found.marks == (expected["marks"]?.arrayValue ?? []).compactMap(\.stringValue), "marks of \(text.debugDescription) for \(uuid)")
        }
    }

    @Test("the notes that belong with a PDF are the desktop's, in its order")
    func notesThatCite() throws {
        let notes = try cases("notes").map { entry in
            PdfNoteText(
                id: Int64(try #require(entry["id"]?.integerValue)), title: try #require(entry["title"]?.stringValue),
                content: try #require(entry["content"]?.stringValue), updatedAt: try #require(entry["updatedAt"]?.stringValue))
        }
        let all = try cases("citationsFor")
        #expect(all.count == 5)
        for entry in all {
            let uuid = try #require(entry["uuid"]?.stringValue), owner = Int64(try #require(entry["ownerNoteId"]?.integerValue))
            let expected = try #require(entry["citations"]?.arrayValue).compactMap(\.objectValue).map { found in
                PdfCitation(
                    noteId: Int64(found["noteId"]?.integerValue ?? -1), title: found["title"]?.stringValue ?? "", owner: found["owner"] == .bool(true),
                    pages: (found["pages"]?.arrayValue ?? []).compactMap(\.integerValue), marks: (found["marks"]?.arrayValue ?? []).compactMap(\.stringValue))
            }
            #expect(PdfRefs.citations(among: notes, documentUuid: uuid, ownerNoteId: owner) == expected, "\(uuid) owned by note \(owner)")
        }
    }
}
