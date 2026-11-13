import Foundation
import GRDB

// The text of PDFs in the search index (docs/architecture/search.md, "The text of a PDF"): every page of every PDF a note owns, so that a word
// found only in the PDF finds the note, with the page it is first on.
//
// Like the rest of the index it lives in `search.db`, never in `composition.db` (the shared schema) or a backup: it is derived from the files.
// It is kept apart from the notes' own text for three reasons. Reading a big PDF takes seconds, so a rebuild of the notes (`rebuild(from:)`)
// must not throw it away; it is keyed by the file's SHA-256 so a PDF is read once. A page is a row, so a hit can say its page. And its words stay
// out of the vocabulary that typo tolerance searches on every keystroke: a library of books has hundreds of thousands of words, which would
// make every search slow; in a PDF's text a word is found as typed (and the last one as the start of a word), not with typos.
//
// The FTS5 table is contentless (`content=''`): the text is never read back, so it is not stored twice; `contentless_delete=1` (SQLite 3.43,
// iOS 17) lets a PDF's rows be deleted.

/// One note a search found. `pdfPage` (0-based) is set when only its PDF's own text was found, with the page's printed label if it has one.
public struct SearchHit: Equatable, Sendable {
    public var noteId: Int64
    public var pdfPage: Int?
    public var pdfPageLabel: String?

    public init(noteId: Int64, pdfPage: Int? = nil, pdfPageLabel: String? = nil) {
        (self.noteId, self.pdfPage, self.pdfPageLabel) = (noteId, pdfPage, pdfPageLabel)
    }
}

/// Where a PDF's text is in the index.
public enum PdfTextState: String, Sendable {
    /// Its pages are in the index (some may have had no text).
    case indexed
    /// It was read, and not one page had text: a scan, most likely (OCR is not built).
    case noText
    /// It asks for a password; it is read when it is next unlocked in the reader. The password is never kept.
    case locked
    /// PDFKit could not open it.
    case unreadable
}

/// A PDF a note owns, as the index needs to know it: what `reconcilePdfText` is given from `composition.db`'s `documents`.
public struct PdfTextSource: Equatable, Sendable {
    public var documentId: Int64
    public var noteId: Int64
    public var sha256: String

    public init(documentId: Int64, noteId: Int64, sha256: String) {
        (self.documentId, self.noteId, self.sha256) = (documentId, noteId, sha256)
    }

    public init(_ document: StoredDocument) { self.init(documentId: document.id, noteId: document.noteId, sha256: document.sha256) }
}

extension SearchIndex {
    static func createPdfTextTables(_ db: Database) throws {
        try db.execute(sql: """
            CREATE TABLE IF NOT EXISTS pdf_files (
                document_id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL, sha256 TEXT NOT NULL, state TEXT NOT NULL,
                pages INTEGER NOT NULL DEFAULT 0, characters INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS pdf_pages (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, page INTEGER NOT NULL, label TEXT);
            CREATE INDEX IF NOT EXISTS idx_pdf_pages_document ON pdf_pages (document_id, page);
            CREATE VIRTUAL TABLE IF NOT EXISTS pdf_text_fts USING fts5(
                text, tokenize = 'unicode61 remove_diacritics 2', content = '', contentless_delete = 1);
            """)
    }

    // MARK: Keeping it in step with the PDFs

    /// Forgets what is no longer a PDF here (its row is gone, or the file under it changed) and returns the PDFs whose text has to be read: those
    /// never read. A PDF that was locked is not returned (it is read when it is unlocked); one that could not be opened is not tried again until
    /// its file changes.
    public func reconcilePdfText(with documents: [PdfTextSource]) throws -> [PdfTextSource] {
        try pool.write { db in
            let known = try Row.fetchAll(db, sql: "SELECT document_id, note_id, sha256 FROM pdf_files")
            let current = Dictionary(documents.map { ($0.documentId, $0) }, uniquingKeysWith: { first, _ in first })
            var kept = Set<Int64>()
            for row in known {
                let id: Int64 = row["document_id"]
                if let document = current[id], document.sha256 == row["sha256"], document.noteId == row["note_id"] {
                    kept.insert(id)
                } else {
                    try Self.deletePdfText(id, db)
                }
            }
            return documents.filter { !kept.contains($0.documentId) }
        }
    }

    /// Keeps a PDF's pages (replacing any it had), each through `PdfSearchText.pageSearchText`. A PDF none of whose pages has text is `noText`.
    public func storePdfText(documentId: Int64, noteId: Int64, sha256: String, pages: [PdfTextPage]) throws {
        try pool.write { db in
            try Self.deletePdfText(documentId, db)
            let page = try db.makeStatement(sql: "INSERT INTO pdf_pages (document_id, page, label) VALUES (?, ?, ?)")
            let text = try db.makeStatement(sql: "INSERT INTO pdf_text_fts (rowid, text) VALUES (?, ?)")
            var characters = 0
            for entry in pages {
                let indexed = PdfSearchText.pageSearchText(entry.text)
                guard !indexed.isEmpty else { continue }
                characters += indexed.count
                try page.execute(arguments: [documentId, entry.page, entry.label])
                // Folded as a query is (`Typo.fold`): FTS5's `remove_diacritics` takes the accents off Latin letters only, so `Ζεύς` would
                // stay `ζεύς` in the index and the query's `ζευς` would not find it. The text is never shown, so nothing is lost.
                try text.execute(arguments: [db.lastInsertedRowID, Typo.fold(indexed)])
            }
            try db.execute(
                sql: "INSERT INTO pdf_files (document_id, note_id, sha256, state, pages, characters) VALUES (?, ?, ?, ?, ?, ?)",
                arguments: [documentId, noteId, sha256, (characters > 0 ? PdfTextState.indexed : .noText).rawValue, pages.count, characters])
        }
    }

    /// Records that a PDF could not be read (`locked` or `unreadable`), with no text.
    public func markPdfText(documentId: Int64, noteId: Int64, sha256: String, state: PdfTextState) throws {
        try pool.write { db in
            try Self.deletePdfText(documentId, db)
            try db.execute(
                sql: "INSERT INTO pdf_files (document_id, note_id, sha256, state) VALUES (?, ?, ?, ?)", arguments: [documentId, noteId, sha256, state.rawValue])
        }
    }

    /// Where a PDF's text is: nil if it has not been read yet.
    public func pdfTextState(documentId: Int64) throws -> PdfTextState? {
        try pool.read { db in
            try String.fetchOne(db, sql: "SELECT state FROM pdf_files WHERE document_id = ?", arguments: [documentId]).flatMap(PdfTextState.init(rawValue:))
        }
    }

    /// The PDFs' text that is in the index: how many PDFs, pages with text and characters (for Settings and the measurements).
    public func pdfTextTotals() throws -> (files: Int, pages: Int, characters: Int) {
        try pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT COUNT(*) AS files, COALESCE(SUM(characters), 0) AS characters FROM pdf_files WHERE state = 'indexed'")
            let pages = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM pdf_pages") ?? 0
            return (row?["files"] ?? 0, pages, row?["characters"] ?? 0)
        }
    }

    public func removePdfText(documentIds: [Int64]) throws {
        try pool.write { db in for id in documentIds { try Self.deletePdfText(id, db) } }
    }

    private static func deletePdfText(_ documentId: Int64, _ db: Database) throws {
        try db.execute(sql: "DELETE FROM pdf_text_fts WHERE rowid IN (SELECT id FROM pdf_pages WHERE document_id = ?)", arguments: [documentId])
        try db.execute(sql: "DELETE FROM pdf_pages WHERE document_id = ?", arguments: [documentId])
        try db.execute(sql: "DELETE FROM pdf_files WHERE document_id = ?", arguments: [documentId])
    }

    // MARK: Searching

    /// The notes, not in `excluding`, whose PDF has every word of the query on one page (the last word also as the start of a word, phrases as
    /// phrases), each with the first such page. Ordered as the notes' own hits are: most recently updated first. The filters are the query's.
    func pdfTextHits(
        _ query: SearchTerms, excluding: Set<Int64>, limit: Int, filterSQL: String, arguments: [any DatabaseValueConvertible], _ db: Database
    ) throws -> [SearchHit] {
        let lastIndex = query.words.count - 1
        let words = query.words.enumerated().map { index, scalars -> String in
            let word = "\"" + String(String.UnicodeScalarView(scalars.compactMap(Unicode.Scalar.init))) + "\""
            return index == lastIndex && query.endsWithWord ? word + "*" : word
        }
        let units = words + query.phrases.map { SearchTerms.phraseExpression($0) }
        guard !units.isEmpty, limit > 0 else { return [] }
        // SQLite gives the bare columns of the row MIN() chose: the first page, and its label.
        let rows = try Row.fetchAll(
            db,
            sql: """
                SELECT pdf_files.note_id AS note_id, MIN(pdf_pages.page) AS page, pdf_pages.label AS label
                FROM pdf_text_fts
                JOIN pdf_pages ON pdf_pages.id = pdf_text_fts.rowid
                JOIN pdf_files ON pdf_files.document_id = pdf_pages.document_id
                JOIN docs ON docs.id = pdf_files.note_id
                WHERE pdf_text_fts MATCH ?\(filterSQL)
                GROUP BY pdf_files.note_id
                ORDER BY docs.updated_at DESC, docs.id DESC
                """,
            arguments: StatementArguments([units.joined(separator: " AND ")] + arguments))
        var hits: [SearchHit] = []
        for row in rows {
            let id: Int64 = row["note_id"]
            guard !excluding.contains(id) else { continue }
            hits.append(SearchHit(noteId: id, pdfPage: row["page"], pdfPageLabel: row["label"]))
            if hits.count == limit { break }
        }
        return hits
    }
}
