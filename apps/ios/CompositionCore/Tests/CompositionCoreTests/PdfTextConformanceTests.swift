import Foundation
import GRDB
import Testing

@testable import CompositionCore

// A PDF's own text in search, against the desktop: fixtures/conformance/pdf-text.json is what the desktop's `pdfText.ts` and pdf.js make of a list
// of page texts and of fixtures/conformance/pdf-text.pdf (apps/ios/scripts/pdf-text-oracle.mjs). It is committed, so a plain `swift test` replays
// it; `apps/ios/scripts/conformance.sh` first checks that it is what the desktop makes now. PDFKit's reading of the same PDF is checked in
// CompositionPDFTests (`PdfTextExtractionTests`).

let pdfTextCorpus: JSONValue? = {
    let file = corpusDirectory?.appendingPathComponent("pdf-text.json")
    return file.flatMap { try? String(contentsOf: $0, encoding: .utf8) }.flatMap { try? JSONValue(parsing: $0) }
}()

func pdfTextCorpusEntries(_ name: String) throws -> [JSONObject] {
    let corpus = try #require(pdfTextCorpus, "fixtures/conformance/pdf-text.json is missing or is not JSON")
    return try #require(corpus.objectValue?[name]?.arrayValue).compactMap(\.objectValue)
}

@Suite("A PDF's text against the desktop")
struct PdfTextConformanceTests {
    @Test("a page's text is made what the desktop makes it, exactly")
    func cases() throws {
        let all = try pdfTextCorpusEntries("cases")
        #expect(all.count >= 50)
        for entry in all {
            let input = try #require(entry["input"]?.stringValue), output = try #require(entry["output"]?.stringValue)
            #expect(PdfSearchText.pageSearchText(input) == output, "input: \(input.debugDescription)")
        }
    }

    @Test("every word the desktop reads on a page of the fixture finds the PDF's note, at the first page that has it")
    func everyWordFinds() throws {
        let pages = try pdfTextCorpusEntries("pages")
        #expect(pages.count == 8)
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let index = try SearchIndex.open(at: scratch.directory.appendingPathComponent("search.db"))
            defer { try? database.close(); try? index.close() }
            let note = try NoteStore(database: database).createNote(title: "Fixture")
            try index.rebuild(from: database)
            let texts = try pages.map { PdfTextPage(page: try #require($0["page"]?.integerValue), text: try #require($0["text"]?.stringValue)) }
            try index.storePdfText(documentId: 1, noteId: note.id, sha256: "f", pages: texts)

            var firstPage: [String: Int] = [:]
            for entry in pages {
                let page = try #require(entry["page"]?.integerValue)
                for word in try #require(entry["words"]?.arrayValue).compactMap(\.stringValue) where firstPage[word] == nil { firstPage[word] = page }
            }
            #expect(firstPage.count > 60)
            // Words the note's own title or text has are found there first, without a page.
            let own = Set(Typo.words(in: note.title + "\n" + note.content))
            for (word, page) in firstPage where !own.contains(word) {
                let hits = try index.searchHits("\"\(word)\"")
                #expect(hits.map(\.noteId) == [note.id], "\(word)")
                #expect(hits.first?.pdfPage == page, "\(word) is first on page \(page)")
            }
        }
    }
}
