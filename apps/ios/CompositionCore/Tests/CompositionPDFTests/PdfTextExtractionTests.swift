import Foundation
import PDFKit
import Testing

@testable import CompositionCore
@testable import CompositionPDF

// PDFKit's reading of fixtures/conformance/pdf-text.pdf against the desktop's pdf.js (fixtures/conformance/pdf-text.json, written by
// apps/ios/scripts/pdf-text-oracle.mjs): after the shared rule, every page has the same words.

@Suite("Reading a PDF's text with PDFKit")
struct PdfTextExtractionTests {
    private let fixture = conformanceDirectory.appendingPathComponent("pdf-text.pdf")

    private func oraclePages() throws -> [(page: Int, words: Set<String>)] {
        let text = try String(contentsOf: conformanceDirectory.appendingPathComponent("pdf-text.json"), encoding: .utf8)
        let pages = try #require(try JSONValue(parsing: text).objectValue?["pages"]?.arrayValue)
        return try pages.map { entry in
            let object = try #require(entry.objectValue)
            return (try #require(object["page"]?.integerValue), Set(try #require(object["words"]?.arrayValue).compactMap(\.stringValue)))
        }
    }

    private func scratch() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("composition-pdf-text-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test("every page has the words pdf.js finds on it, no more and no fewer")
    func sameWordsAsTheDesktop() throws {
        guard case .pages(let pages) = PdfTextExtractor.read(fixture) else {
            Issue.record("the fixture did not open")
            return
        }
        let oracle = try oraclePages()
        #expect(pages.count == oracle.count)
        for (page, words) in oracle {
            let read = try #require(pages.first { $0.page == page })
            // Folded the iPad's way on both sides (`Typo.fold` makes a final ς σ, which JavaScript's toLowerCase does not; query and index fold alike).
            #expect(Set(Typo.words(in: PdfSearchText.pageSearchText(read.text))) == Set(words.map(Typo.fold)), "page \(page)")
        }
    }

    @Test("a page with no text (a scan) reads as empty, and a label is kept only when it is not the page's number")
    func emptyPagesAndLabels() throws {
        guard case .pages(let pages) = PdfTextExtractor.read(fixture) else {
            Issue.record("the fixture did not open")
            return
        }
        #expect(pages[6].text == "")
        #expect(pages.allSatisfy { $0.label == nil }, "the fixture has no labels of its own")
    }

    @Test("a protected PDF is locked without its password and read with it; a file that is not a PDF is unreadable")
    func lockedAndUnreadable() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        let locked = folder.appendingPathComponent("locked.pdf")
        let source = try #require(PDFDocument(url: fixture))
        #expect(source.write(to: locked, withOptions: [.userPasswordOption: "secret", .ownerPasswordOption: "owner-secret"]))

        #expect(PdfTextExtractor.read(locked) == .locked)
        #expect(PdfTextExtractor.read(locked, password: "wrong") == .locked)
        guard case .pages(let pages) = PdfTextExtractor.read(locked, password: "secret") else {
            Issue.record("the right password did not open it")
            return
        }
        #expect(PdfSearchText.pageSearchText(pages[0].text).contains("lighthouse"))

        let notPdf = folder.appendingPathComponent("not.pdf")
        try Data("just text".utf8).write(to: notPdf)
        #expect(PdfTextExtractor.read(notPdf) == .unreadable)
        #expect(PdfTextExtractor.read(folder.appendingPathComponent("missing.pdf")) == .unreadable)
    }

    /// `COMPOSITION_PDF_TEXT_BOOK=/path/book.pdf swift test --filter PdfTextExtractionTests/measure` prints how long a book takes to read and to
    /// index, and how much the index grows (the numbers in docs/architecture/search.md). Skipped without the variable.
    @Test("measure a book", .enabled(if: ProcessInfo.processInfo.environment["COMPOSITION_PDF_TEXT_BOOK"] != nil))
    func measure() throws {
        let book = URL(fileURLWithPath: try #require(ProcessInfo.processInfo.environment["COMPOSITION_PDF_TEXT_BOOK"]))
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        let clock = ContinuousClock()
        var outcome: PdfTextExtractor.Outcome = .unreadable
        let reading = clock.measure { outcome = PdfTextExtractor.read(book) }
        guard case .pages(let pages) = outcome else {
            Issue.record("the book did not open")
            return
        }
        let indexURL = folder.appendingPathComponent("search.db")
        let index = try SearchIndex.open(at: indexURL)
        let empty = try indexSize(folder)
        let indexing = try clock.measure { try index.storePdfText(documentId: 1, noteId: 1, sha256: "x", pages: pages) }
        try index.close()
        let size = try indexSize(folder) - empty
        let characters = pages.reduce(0) { $0 + $1.text.count }
        print("PDF text: \(pages.count) pages, \(characters) characters; read in \(reading), indexed in \(indexing); index grew \(size / 1024) KB")
    }

    private func indexSize(_ folder: URL) throws -> Int {
        try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey]).reduce(0) {
            $0 + ((try $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }
}
