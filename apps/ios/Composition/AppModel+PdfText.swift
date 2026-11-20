import CompositionCore
import CompositionPDF
import Foundation

// The text of PDFs in Search (docs/architecture/search.md, "The text of a PDF"): every PDF a note owns is read once, in the background, and its
// pages go into the search index, so that a word only in the PDF finds the note. Read when the notes open (PDFs imported before this was built,
// or after a backup was restored), after an import, and after a protected PDF is unlocked in the reader (its password is used for that one
// reading and never kept). One PDF at a time, at a low priority; a search that is showing is run again as each PDF goes in.

extension AppModel {
    /// Reads the text of every PDF whose text is not in the index yet, after anything already queued.
    func indexPdfText() {
        guard let database = store?.database, let index = searchIndexForPdfText else { return }
        let location = location
        queuePdfText { () -> Int in
            let documents = try database.listDocuments()
            let sources = documents.map(PdfTextSource.init)
            let stored = Dictionary(documents.map { ($0.id, $0.storedName) }, uniquingKeysWith: { first, _ in first })
            let scans = try database.scanDocumentIds()
            var read = 0
            for source in try index.reconcilePdfText(with: sources) {
                if Task.isCancelled { break }
                // A scan's pages have no text of their own: its text is what was read from them (AppModel+Scans.swift).
                if scans.contains(source.documentId) {
                    try Self.storeScanText(source, database: database, into: index)
                    read += 1
                    continue
                }
                guard let name = stored[source.documentId] else { continue }
                try Self.readPdfText(source, url: location.documentsURL.appendingPathComponent(name), password: nil, into: index)
                read += 1
            }
            return read
        }
    }

    /// A protected PDF was unlocked in the reader: its text is read now, with the password it was opened with, if it was waiting for that.
    func indexPdfTextAfterUnlock(documentId: Int64, password: String) {
        guard let database = store?.database, let index = searchIndexForPdfText else { return }
        let location = location
        queuePdfText { () -> Int in
            guard try index.pdfTextState(documentId: documentId) == .locked, let document = try database.document(id: documentId) else { return 0 }
            try Self.readPdfText(PdfTextSource(document), url: location.documentsURL.appendingPathComponent(document.storedName), password: password, into: index)
            return 1
        }
    }

    /// A scan's text in Search, made again from the lines read from it so far (after each page is read, and after a line is checked or corrected).
    func indexScanText(documentId: Int64) {
        guard let database = store?.database, let index = searchIndexForPdfText else { return }
        queuePdfText { () -> Int in
            guard let document = try database.document(id: documentId) else { return 0 }
            try Self.storeScanText(PdfTextSource(document), database: database, into: index)
            return 1
        }
    }

    /// A scan's pages' text as Search keeps it: each page's lines that Search may use (`ScanText.pageText`: never a held line). Off the main thread.
    nonisolated private static func storeScanText(_ source: PdfTextSource, database: CompositionDatabase, into index: SearchIndex) throws {
        let pages = try database.scanPageTexts(documentId: source.documentId).map { PdfTextPage(page: $0.page, text: $0.text) }
        try index.storePdfText(documentId: source.documentId, noteId: source.noteId, sha256: source.sha256, pages: pages)
    }

    /// Where a PDF's text is in Search, for the reader's Contents (nil while it has not been read).
    func pdfTextState(documentId: Int64) async -> PdfTextState? {
        guard let index = searchIndexForPdfText else { return nil }
        return try? await Self.perform { try index.pdfTextState(documentId: documentId) }
    }

    /// Opens a search result found in a PDF's text at the page the words are on, with the reader's find bar showing them.
    func openPdfHit(_ noteId: Int64) {
        guard let hit = pdfHits[noteId], let page = hit.pdfPage, let entry = pdfsByUuid.values.first(where: { $0.noteId == noteId }) else { return }
        pdfGoToCount += 1
        pdfGoTo = PdfGoTo(documentId: entry.documentId, page: page, mark: nil, find: PdfSearchText.findText(forQuery: query), sequence: pdfGoToCount)
    }

    /// What a search result found in a PDF says under its title: "In the PDF, p. 212" (the printed page label when the PDF has one), or "In the
    /// scan, p. 3" for words read from a scanned page.
    func pdfHitLine(_ noteId: Int64) -> String? {
        guard let hit = pdfHits[noteId], let page = hit.pdfPage else { return nil }
        let isScan = pdfsByUuid.values.contains { $0.noteId == noteId && scanDocuments.contains($0.documentId) }
        return "In the \(isScan ? "scan" : "PDF"), p. \(hit.pdfPageLabel ?? String(page + 1))"
    }

    // MARK: The queue

    /// Runs `work` off the main thread after whatever was queued before it, then runs the search again if it read anything and one is showing.
    private func queuePdfText(_ work: @escaping @Sendable () throws -> Int) {
        let previous = pdfTextTask
        pdfTextTask = Task { [weak self] in
            await previous?.value
            guard !Task.isCancelled else { return }
            let started = ContinuousClock.now
            let read: Int
            do {
                read = try await Task.detached(priority: .utility, operation: work).value
            } catch {
                NSLog("[search] reading a PDF's text failed: \(error)")
                return
            }
            if read > 0 {
                NSLog("[search] read the text of \(read) PDF(s) in \(started.duration(to: .now))")
                await self?.pdfTextChanged()
            }
        }
    }

    /// Reads one PDF and keeps its text (or why it has none). Off the main thread.
    nonisolated private static func readPdfText(_ source: PdfTextSource, url: URL, password: String?, into index: SearchIndex) throws {
        switch PdfTextExtractor.read(url, password: password) {
        case .pages(let pages):
            try index.storePdfText(documentId: source.documentId, noteId: source.noteId, sha256: source.sha256, pages: pages)
        case .locked:
            try index.markPdfText(documentId: source.documentId, noteId: source.noteId, sha256: source.sha256, state: .locked)
        case .unreadable:
            try index.markPdfText(documentId: source.documentId, noteId: source.noteId, sha256: source.sha256, state: .unreadable)
        }
    }
}
