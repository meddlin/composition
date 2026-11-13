import Foundation
import GRDB
import Testing

@testable import CompositionCore

@Suite("A PDF's own text in the search index")
struct PdfTextIndexTests {
    private func insert(_ db: CompositionDatabase, _ title: String, content: String = "", tags: String = "", updated: String = "2026-01-01T00:00:00.000Z") throws -> Int64 {
        try db.pool.write { conn in
            try conn.execute(
                sql: "INSERT INTO notes (title, content, tags, description, created_at, updated_at, notebook_id) VALUES (?, ?, ?, '', ?, ?, 1)",
                arguments: [title, content, tags, updated, updated])
            return conn.lastInsertedRowID
        }
    }

    private func world(_ body: (CompositionDatabase, SearchIndex) throws -> Void) throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let index = try SearchIndex.open(at: scratch.directory.appendingPathComponent("search.db"))
            defer { try? database.close(); try? index.close() }
            try body(database, index)
        }
    }

    private let book = [
        PdfTextPage(page: 0, label: "i", text: "Preface"),
        PdfTextPage(page: 1, label: "ii", text: ""),
        PdfTextPage(page: 2, label: "1", text: "The lighthouse keeper\ncounted quetzals."),
        PdfTextPage(page: 3, label: "2", text: "More quetzals and a harbour."),
    ]

    @Test("a word only in the PDF finds its note, with the first page it is on and that page's label")
    func findsByPage() throws {
        try world { database, index in
            let owner = try insert(database, "Birds of the coast")
            try index.rebuild(from: database)
            try index.storePdfText(documentId: 7, noteId: owner, sha256: "a", pages: book)
            #expect(try index.searchHits("quetzals") == [SearchHit(noteId: owner, pdfPage: 2, pdfPageLabel: "1")])
            #expect(try index.searchHits("harbour").first?.pdfPage == 3)
            #expect(try index.search("quetz") == [owner], "the last word is the start of a word")
            #expect(try index.search("\"lighthouse keeper\"") == [owner], "a phrase")
            #expect(try index.search("\"keeper lighthouse\"").isEmpty)
            #expect(try index.search("lighthouse harbour").isEmpty, "every word has to be on one page")
            #expect(try index.search("quetzals harb") == [owner])
            #expect(try index.search("quetzal harbour").isEmpty, "only the last word is the start of a word, as in a note's own text")
            #expect(try index.search("quetzls").isEmpty, "no typo tolerance in a PDF's text")
            #expect(try index.searchHits("birds") == [SearchHit(noteId: owner)], "the note's own words are found without a page")
        }
    }

    @Test("notes found in their own text come first; a note found both ways is listed once, without a page")
    func ownTextFirst() throws {
        try world { database, index in
            let owner = try insert(database, "A book", updated: "2026-03-01T00:00:00.000Z")
            let other = try insert(database, "Field notes", content: "saw quetzals today", updated: "2026-01-01T00:00:00.000Z")
            let both = try insert(database, "Quetzals", updated: "2026-02-01T00:00:00.000Z")
            try index.rebuild(from: database)
            try index.storePdfText(documentId: 1, noteId: owner, sha256: "a", pages: book)
            try index.storePdfText(documentId: 2, noteId: both, sha256: "b", pages: book)
            #expect(try index.searchHits("quetzals") == [SearchHit(noteId: both), SearchHit(noteId: other), SearchHit(noteId: owner, pdfPage: 2, pdfPageLabel: "1")])
        }
    }

    @Test("PDF hits are ordered most recently updated first, and follow the query's filters")
    func orderAndFilters() throws {
        try world { database, index in
            let old = try insert(database, "Old book", tags: "birds", updated: "2025-01-01T00:00:00.000Z")
            let new = try insert(database, "New book", tags: "sea", updated: "2026-05-01T00:00:00.000Z")
            try index.rebuild(from: database)
            try index.storePdfText(documentId: 1, noteId: old, sha256: "a", pages: book)
            try index.storePdfText(documentId: 2, noteId: new, sha256: "b", pages: book)
            #expect(try index.search("quetzals") == [new, old])
            #expect(try index.search("quetzals tag: birds") == [old])
            #expect(try index.search("quetzals updated: <2026-01-01") == [old])
            #expect(try index.search("title: quetzals").isEmpty, "a title: search is about titles")
        }
    }

    @Test("a note in the Trash Can is not found by its PDF's text, and is again once restored")
    func trashed() throws {
        try world { database, index in
            let owner = try insert(database, "Book")
            try index.rebuild(from: database)
            try index.storePdfText(documentId: 1, noteId: owner, sha256: "a", pages: book)
            try index.remove(ids: [owner])
            #expect(try index.search("quetzals").isEmpty)
            try index.rebuild(from: database)
            #expect(try index.search("quetzals") == [owner], "rebuilding the notes keeps the PDFs' text")
        }
    }

    @Test("states: indexed, no text (a scan), locked, unreadable; storing again replaces")
    func states() throws {
        try world { database, index in
            let owner = try insert(database, "Book")
            try index.rebuild(from: database)
            #expect(try index.pdfTextState(documentId: 1) == nil)
            try index.storePdfText(documentId: 1, noteId: owner, sha256: "a", pages: [PdfTextPage(page: 0, text: "  \n "), PdfTextPage(page: 1, text: "")])
            #expect(try index.pdfTextState(documentId: 1) == .noText)
            try index.markPdfText(documentId: 1, noteId: owner, sha256: "a", state: .locked)
            #expect(try index.pdfTextState(documentId: 1) == .locked)
            try index.storePdfText(documentId: 1, noteId: owner, sha256: "a", pages: book)
            #expect(try index.pdfTextState(documentId: 1) == .indexed)
            #expect(try index.pdfTextTotals().pages == 3)
            try index.storePdfText(documentId: 1, noteId: owner, sha256: "a", pages: [PdfTextPage(page: 0, text: "only cormorants")])
            #expect(try index.search("quetzals").isEmpty, "the old pages are gone")
            #expect(try index.search("cormorants") == [owner])
            #expect(try index.pdfTextTotals().pages == 1)
        }
    }

    @Test("the reader's find bar gets the query's phrase, or else its longest word, without filters")
    func findText() {
        #expect(PdfSearchText.findText(forQuery: "quetzals") == "quetzals")
        #expect(PdfSearchText.findText(forQuery: "the lighthouse keeper") == "lighthouse")
        #expect(PdfSearchText.findText(forQuery: "keeper house") == "keeper", "a tie goes to the first")
        #expect(PdfSearchText.findText(forQuery: "old \"lighthouse   keeper\" harbour") == "lighthouse keeper")
        #expect(PdfSearchText.findText(forQuery: "quetzals tag: birds") == "quetzals")
        #expect(PdfSearchText.findText(forQuery: "tag: birds") == "")
        #expect(PdfSearchText.findText(forQuery: "Zürich, café") == "Zürich")
    }

    @Test("reconciling forgets PDFs that are gone or changed and returns those not yet read; locked and unreadable ones wait")
    func reconcile() throws {
        try world { database, index in
            let a = try insert(database, "A"), b = try insert(database, "B"), c = try insert(database, "C")
            try index.rebuild(from: database)
            try index.storePdfText(documentId: 1, noteId: a, sha256: "s1", pages: book)
            try index.storePdfText(documentId: 2, noteId: b, sha256: "s2", pages: book)
            try index.markPdfText(documentId: 3, noteId: c, sha256: "s3", state: .locked)
            try index.markPdfText(documentId: 4, noteId: c, sha256: "s4", state: .unreadable)

            let sources = [
                PdfTextSource(documentId: 1, noteId: a, sha256: "s1"),  // unchanged
                PdfTextSource(documentId: 2, noteId: b, sha256: "changed"),  // a new file under the same row
                PdfTextSource(documentId: 3, noteId: c, sha256: "s3"),  // locked: waits for the reader
                PdfTextSource(documentId: 4, noteId: c, sha256: "s4"),  // unreadable: not tried again
                PdfTextSource(documentId: 5, noteId: c, sha256: "s5"),  // new
            ]
            let toRead = try index.reconcilePdfText(with: sources)
            #expect(toRead.map(\.documentId) == [2, 5])
            #expect(try index.pdfTextState(documentId: 2) == nil)
            #expect(try index.search("quetzals") == [a])

            #expect(try index.reconcilePdfText(with: []).isEmpty)
            #expect(try index.pdfTextState(documentId: 1) == nil, "a PDF that is gone is forgotten")
            #expect(try index.search("quetzals").isEmpty)
        }
    }
}
