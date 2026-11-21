import Foundation
import GRDB

// Scanned pages and the lines read from them: a port of the desktop's `scansRepo.ts`, with the same SQL and the same refusals, replayed against
// fixtures/conformance/scan/scripts.json (ScanConformanceTests). The rules are `ScanText`. Each operation is one write transaction, and `now` is a
// parameter so a test can say when something happened.

/// A page of a scan, and whether it has been read yet.
public struct ScanPage: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    public var uuid: String
    public var documentId: Int64
    /// 0-based.
    public var page: Int
    /// The engine that read it, nil until it has been read.
    public var engine: String?
    public var recognizedAt: String?
    public var createdAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        documentId = row["document_id"]
        page = row["page"]
        engine = row["engine"]
        recognizedAt = row["recognized_at"]
        createdAt = row["created_at"]
    }
}

/// A line read from a scanned page.
public struct ScanLine: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    public var uuid: String
    public var documentId: Int64
    /// 0-based.
    public var page: Int
    /// Its place in reading order on the page.
    public var line: Int
    /// Its box in raw PDF user space, as marks are kept.
    public var rect: PdfRect
    /// What the engine read.
    public var text: String
    public var confidence: Double
    public var engine: String
    public var status: ScanLineStatus
    /// The person's text, when `status` is `corrected`.
    public var corrected: String?
    public var createdAt: String
    public var updatedAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        documentId = row["document_id"]
        page = row["page"]
        line = row["line"]
        // A box that cannot be read (a file edited by hand) is a point at the origin: the line still says its text.
        rect = (try? JSONValue(parsing: row["rect"] as String)).flatMap(PdfRect.init) ?? PdfRect(x0: 0, y0: 0, x1: 0, y1: 0)
        text = row["text"]
        confidence = row["confidence"]
        engine = row["engine"]
        status = ScanLineStatus(rawValue: row["status"] as String) ?? .held
        corrected = row["corrected"]
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
    }

    /// The text search and quoting may use (`ScanText.searchText`), nil for a held line.
    public var searchText: String? { ScanText.searchText(text: text, status: status, corrected: corrected) }

    /// The text to show for it: the person's when they corrected it.
    public var shownText: String { status == .corrected ? corrected ?? "" : text }
}

/// How far reading a scan has got, and what a person has looked at.
public struct ScanSummary: Equatable, Sendable {
    public var pages = 0
    public var recognized = 0
    public var lines = 0
    public var unchecked = 0
    public var held = 0
    public var checked = 0
    public var corrected = 0
}

extension CompositionDatabase {
    /// The longest engine name kept: it names the engine, its settings and the system it ran on, nothing more.
    public static let maxEngineLength = 200

    private static func checkEngine(_ engine: String) throws -> String {
        let trimmed = JavaScriptText.trim(engine)
        // The desktop counts UTF-16 code units (`engine.length`).
        guard !trimmed.isEmpty, engine.utf16.count <= maxEngineLength else {
            throw InvalidScanError("An engine is named, in at most \(maxEngineLength) characters.")
        }
        return trimmed
    }

    /// Makes a PDF a scan of `pageCount` pages, none read yet. Pages it already has are kept as they are. Returns how many were added. Throws
    /// `InvalidScanError` when the PDF is gone or the count is less than one.
    @discardableResult
    public func addScanPages(documentId: Int64, pageCount: Int, now: Date = Date()) throws -> Int {
        guard pageCount >= 1 else { throw InvalidScanError("A scan has at least one page.") }
        return try pool.write { db in
            guard try Row.fetchOne(db, sql: "SELECT 1 FROM documents WHERE id = ?", arguments: [documentId]) != nil else {
                throw InvalidScanError("That PDF no longer exists.")
            }
            let insert = try db.makeStatement(sql: "INSERT OR IGNORE INTO scan_pages (document_id, page, created_at) VALUES (?, ?, ?)")
            let at = Timestamp.now(now)
            var added = 0
            for page in 0..<pageCount {
                try insert.execute(arguments: [documentId, page, at])
                added += db.changesCount
            }
            return added
        }
    }

    /// Whether a PDF is a scan.
    public func isScan(documentId: Int64) throws -> Bool {
        try pool.read { try Row.fetchOne($0, sql: "SELECT 1 FROM scan_pages WHERE document_id = ? LIMIT 1", arguments: [documentId]) != nil }
    }

    /// The ids of every PDF that is a scan.
    public func scanDocumentIds() throws -> Set<Int64> {
        try pool.read { Set(try Int64.fetchAll($0, sql: "SELECT DISTINCT document_id FROM scan_pages")) }
    }

    /// The pages of a scan, in order.
    public func scanPages(documentId: Int64) throws -> [ScanPage] {
        try pool.read { try ScanPage.fetchAll($0, sql: "SELECT * FROM scan_pages WHERE document_id = ? ORDER BY page", arguments: [documentId]) }
    }

    /// The pages not read yet, of every scan (or of one), oldest scan first and in page order: what reading picks up after a quit.
    public func pendingScanPages(documentId: Int64? = nil) throws -> [(documentId: Int64, page: Int)] {
        try pool.read { db in
            let rows =
                if let documentId {
                    try Row.fetchAll(db, sql: "SELECT document_id, page FROM scan_pages WHERE recognized_at IS NULL AND document_id = ? ORDER BY page", arguments: [documentId])
                } else {
                    try Row.fetchAll(db, sql: "SELECT document_id, page FROM scan_pages WHERE recognized_at IS NULL ORDER BY document_id, page")
                }
            return rows.map { (documentId: $0["document_id"], page: $0["page"]) }
        }
    }

    /// The lines of a scan, or of one page of it, in reading order.
    public func scanLines(documentId: Int64, page: Int? = nil) throws -> [ScanLine] {
        try pool.read { db in
            if let page {
                return try ScanLine.fetchAll(db, sql: "SELECT * FROM scan_lines WHERE document_id = ? AND page = ? ORDER BY line, id", arguments: [documentId, page])
            }
            return try ScanLine.fetchAll(db, sql: "SELECT * FROM scan_lines WHERE document_id = ? ORDER BY page, line, id", arguments: [documentId])
        }
    }

    public func scanLine(id: Int64) throws -> ScanLine? {
        try pool.read { try ScanLine.fetchOne($0, sql: "SELECT * FROM scan_lines WHERE id = ?", arguments: [id]) }
    }

    /// Keeps what an engine read on one page, in one transaction, and marks the page read. Lines a person has looked at (`checked`, `corrected`) are
    /// kept, and a new line mostly under one of them is left out; every other line the page had is replaced. A new line's `line` is its place in
    /// what the engine gave. Lines with no text are not kept. Returns the page's lines. Throws `InvalidScanError` when the page is not a scanned page
    /// of that PDF, or a line or the engine's name is not valid (and then nothing is written).
    @discardableResult
    public func storeRecognition(documentId: Int64, page: Int, engine: String, lines: [RecognizedLineInput], now: Date = Date()) throws -> [ScanLine] {
        let name = try Self.checkEngine(engine)
        let valid = try lines.map(ScanText.validate)
        try pool.write { db in
            guard try Row.fetchOne(db, sql: "SELECT 1 FROM scan_pages WHERE document_id = ? AND page = ?", arguments: [documentId, page]) != nil else {
                throw InvalidScanError("That page is not a scanned page.")
            }
            let kept = try String.fetchAll(
                db, sql: "SELECT rect FROM scan_lines WHERE document_id = ? AND page = ? AND status IN ('checked', 'corrected')", arguments: [documentId, page]
            ).compactMap { (try? JSONValue(parsing: $0)).flatMap(PdfRect.init) }
            try db.execute(sql: "DELETE FROM scan_lines WHERE document_id = ? AND page = ? AND status IN ('unchecked', 'held')", arguments: [documentId, page])
            let insert = try db.makeStatement(
                sql: """
                    INSERT INTO scan_lines (document_id, page, line, rect, text, confidence, engine, status, corrected, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                    """)
            let at = Timestamp.now(now)
            for (index, line) in valid.enumerated() {
                guard let line, !ScanText.coveredByKept(line.rect, kept) else { continue }
                try insert.execute(arguments: [documentId, page, index, line.rect.json.serialized(), line.text, line.confidence, name, line.status.rawValue, at, at])
            }
            try db.execute(
                sql: "UPDATE scan_pages SET engine = ?, recognized_at = ? WHERE document_id = ? AND page = ?", arguments: [name, at, documentId, page])
        }
        return try scanLines(documentId: documentId, page: page)
    }

    /// A person says the line reads as it was read. Returns the line, or nil when there is no such line.
    @discardableResult
    public func checkScanLine(id: Int64, now: Date = Date()) throws -> ScanLine? {
        try pool.write { db in
            try db.execute(sql: "UPDATE scan_lines SET status = 'checked', corrected = NULL, updated_at = ? WHERE id = ?", arguments: [Timestamp.now(now), id])
        }
        return try scanLine(id: id)
    }

    /// A person writes what the line says (on one line; nothing at all when it says nothing). Writing exactly what was read checks the line
    /// instead. Returns the line, or nil when there is no such line.
    @discardableResult
    public func correctScanLine(id: Int64, text: String, now: Date = Date()) throws -> ScanLine? {
        guard let current = try scanLine(id: id) else { return nil }
        let written = ScanText.oneLine(text)
        if written == current.text { return try checkScanLine(id: id, now: now) }
        try pool.write { db in
            try db.execute(
                sql: "UPDATE scan_lines SET status = 'corrected', corrected = ?, updated_at = ? WHERE id = ?", arguments: [written, Timestamp.now(now), id])
        }
        return try scanLine(id: id)
    }

    /// How far reading a scan has got; nil when the PDF is not a scan.
    public func scanSummary(documentId: Int64) throws -> ScanSummary? {
        try pool.read { db in
            guard let pages = try Row.fetchOne(db, sql: "SELECT COUNT(*) AS pages, COUNT(recognized_at) AS recognized FROM scan_pages WHERE document_id = ?", arguments: [documentId]),
                (pages["pages"] as Int) > 0
            else { return nil }
            var summary = ScanSummary(pages: pages["pages"], recognized: pages["recognized"])
            for row in try Row.fetchAll(db, sql: "SELECT status, COUNT(*) AS n FROM scan_lines WHERE document_id = ? GROUP BY status", arguments: [documentId]) {
                let count: Int = row["n"]
                switch ScanLineStatus(rawValue: row["status"] as String) {
                case .unchecked?: summary.unchecked += count
                case .held?: summary.held += count
                case .checked?: summary.checked += count
                case .corrected?: summary.corrected += count
                case nil: break
                }
                summary.lines += count
            }
            return summary
        }
    }

    /// The text of every page of a scan that has some, for search (`ScanText.pageText`), in page order.
    public func scanPageTexts(documentId: Int64) throws -> [(page: Int, text: String)] {
        let lines = try scanLines(documentId: documentId)
        let byPage = Dictionary(grouping: lines, by: \.page)
        return byPage.keys.sorted().compactMap { page in
            let text = ScanText.pageText(byPage[page]!.map { ScanLineText(line: $0.line, text: $0.text, status: $0.status, corrected: $0.corrected) })
            return text.isEmpty ? nil : (page, text)
        }
    }
}
