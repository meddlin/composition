import Foundation
import GRDB
import Testing

@testable import CompositionCore

// How search finds words in a PDF's own text, against the desktop: fixtures/conformance/pdf-text-search.json holds notes, the PDFs they own
// (their pages as the desktop indexes them) and what a real Meilisearch answered through the desktop's searchIndex.ts for each query
// (apps/web/src/lib/composition/pdfTextSearch.test.ts writes it). The iPad's FTS5 search must find the same notes, in the same order, at the
// same pages, so that a library searches the same on both.

@Suite("Searching a PDF's text against the desktop")
struct PdfTextSearchConformanceTests {
    private static let corpus: JSONObject? = {
        let file = corpusDirectory?.appendingPathComponent("pdf-text-search.json")
        return file.flatMap { try? String(contentsOf: $0, encoding: .utf8) }.flatMap { try? JSONValue(parsing: $0) }?.objectValue
    }()

    private func list(_ name: String) throws -> [JSONObject] {
        let corpus = try #require(Self.corpus, "fixtures/conformance/pdf-text-search.json is missing or is not JSON")
        return try #require(corpus[name]?.arrayValue).compactMap(\.objectValue)
    }

    @Test("every query finds the notes the desktop found, in its order, at its pages")
    func sameAnswers() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let index = try SearchIndex.open(at: scratch.directory.appendingPathComponent("search.db"))
            defer { try? database.close(); try? index.close() }

            var trashed: [Int64] = []
            for note in try list("notes") {
                let id = try #require(note["id"]?.integerValue), updated = try #require(note["updatedAt"]?.stringValue)
                try database.pool.write { db in
                    try db.execute(
                        sql: "INSERT INTO notes (id, title, content, tags, description, created_at, updated_at, notebook_id) VALUES (?, ?, ?, ?, '', ?, ?, 1)",
                        arguments: [id, note["title"]?.stringValue, note["content"]?.stringValue, note["tags"]?.stringValue, updated, updated])
                }
                if note["trashed"] == .bool(true) { trashed.append(Int64(id)) }
            }
            try index.rebuild(from: database)
            try index.remove(ids: trashed)

            for pdf in try list("pdfs") {
                let pages = try #require(pdf["pages"]?.arrayValue).compactMap(\.objectValue).map { page in
                    PdfTextPage(page: try #require(page["page"]?.integerValue), label: page["label"]?.stringValue, text: try #require(page["text"]?.stringValue))
                }
                try index.storePdfText(
                    documentId: Int64(try #require(pdf["documentId"]?.integerValue)), noteId: Int64(try #require(pdf["noteId"]?.integerValue)), sha256: "x", pages: pages)
            }

            for state in try list("states") {
                let documentId = Int64(try #require(state["documentId"]?.integerValue))
                #expect(try index.pdfTextState(documentId: documentId)?.rawValue == state["state"]?.stringValue, "document \(documentId)")
            }

            let results = try list("results")
            #expect(results.count >= 40)
            for result in results {
                let query = try #require(result["query"]?.stringValue)
                let expected = try #require(result["hits"]?.arrayValue).compactMap(\.objectValue).map {
                    SearchHit(noteId: Int64(try #require($0["id"]?.integerValue)), pdfPage: $0["page"]?.integerValue, pdfPageLabel: $0["label"]?.stringValue)
                }
                #expect(try index.searchHits(query) == expected, "\(query)")
            }
        }
    }
}
