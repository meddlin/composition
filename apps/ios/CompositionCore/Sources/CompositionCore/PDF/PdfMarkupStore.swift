import Foundation
import GRDB

// The marks and bookmarks of a PDF: a port of `pdfMarkupRepo.ts`, with the same SQL and the same refusals (see NotebooksStore.swift).
// The conformance corpus (fixtures/conformance/pdf) runs both against a fresh database. Every write is checked by `PdfMarkup` and
// against the PDF's page count (a PDF whose pages have not been counted yet, `page_count` 0, accepts any page), and every mark and
// bookmark gets a uuid from the table's trigger. `pdf:` links name a PDF and a mark by those uuids.
//
// Not pinned by the corpus, so checked by PdfMarkupStoreTests against what the desktop's functions do: `restoreAnnotations` (undo of a
// delete), `marksSearchText` (the words that find a PDF's note) and `notesForPdf` (the notes that cite a PDF, which the desktop reads
// from the notes it already holds in memory).

/// A mark on a PDF. (`PdfAnnotation` on the desktop; that name is too near PDFKit's `PDFAnnotation`.)
public struct PdfMark: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    public var uuid: String
    public var documentId: Int64
    /// 0-based page index.
    public var page: Int
    public var kind: PdfMarkKind
    public var color: String
    public var rects: [PdfRect]?
    public var quote: String
    public var comment: String
    public var body: JSONValue?
    public var groupUuid: String?
    public var createdAt: String
    public var updatedAt: String

    /// Throws when a column holds what no mark of this app has: a kind it does not know, or JSON that is not rectangles or not JSON.
    public init(row: Row) throws {
        id = row["id"]
        uuid = row["uuid"]
        documentId = row["document_id"]
        page = row["page"]
        let kindName: String = row["kind"]
        guard let kind = PdfMarkKind(rawValue: kindName) else { throw InvalidMarkError("Unknown kind of mark: \(kindName).") }
        self.kind = kind
        color = row["color"]
        rects = try (row["rects"] as String?).map { text in
            guard case .array(let items)? = try? JSONValue(parsing: text) else { throw InvalidMarkError("A mark's rectangles are damaged.") }
            return try items.map { item in
                guard let rect = PdfRect(item) else { throw InvalidMarkError("A mark's rectangles are damaged.") }
                return rect
            }
        }
        quote = row["quote"]
        comment = row["comment"]
        body = try (row["body"] as String?).map { text in
            guard let value = try? JSONValue(parsing: text) else { throw InvalidMarkError("A mark's body is damaged.") }
            return value
        }
        groupUuid = row["group_uuid"]
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
    }
}

public struct PdfBookmark: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    public var uuid: String
    public var documentId: Int64
    public var page: Int
    /// One line; empty means the page number is shown.
    public var label: String
    public var createdAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        documentId = row["document_id"]
        page = row["page"]
        label = row["label"]
        createdAt = row["created_at"]
    }
}

extension ValidPdfMark {
    /// What the `rects` column holds.
    var rectsJSON: String? { rects.map { JSONValue.array($0.map(\.json)).serialized() } }

    /// What the `body` column holds.
    var bodyJSON: String? { body?.serialized() }
}

extension CompositionDatabase {
    static let markColumns = "id, uuid, document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at"
    static let bookmarkColumns = "id, uuid, document_id, page, label, created_at"

    // MARK: Marks

    /// The marks of a PDF, or of one page of it, in the order they were made.
    public func annotations(documentId: Int64, page: Int? = nil) throws -> [PdfMark] {
        try pool.read { db in
            if let page {
                return try PdfMark.fetchAll(db, sql: "SELECT \(Self.markColumns) FROM pdf_annotations WHERE document_id = ? AND page = ? ORDER BY id", arguments: [documentId, page])
            }
            return try PdfMark.fetchAll(db, sql: "SELECT \(Self.markColumns) FROM pdf_annotations WHERE document_id = ? ORDER BY page, id", arguments: [documentId])
        }
    }

    public func annotation(id: Int64) throws -> PdfMark? {
        try pool.read { try Self.fetchMark($0, id) }
    }

    public func annotation(uuid: String) throws -> PdfMark? {
        try pool.read { try PdfMark.fetchOne($0, sql: "SELECT \(Self.markColumns) FROM pdf_annotations WHERE uuid = ?", arguments: [uuid]) }
    }

    /// Throws `InvalidMarkError` when the mark breaks the rules, the PDF is gone or the page is past its end; nothing is written then.
    @discardableResult
    public func addAnnotation(documentId: Int64, _ input: PdfMarkInput, now: Date = Date()) throws -> PdfMark {
        let mark = try PdfMarkup.validate(input)
        return try pool.write { db in
            try Self.assertPage(db, documentId, mark.page)
            return try Self.insertMark(db, documentId, mark, Timestamp.now(now))
        }
    }

    /// A selection that crossed pages is one record per page, joined by a group uuid made here: one input is an ordinary mark (no
    /// group), two or more share one, whatever group the inputs name. All or none are stored.
    @discardableResult
    public func addAnnotationGroup(documentId: Int64, _ inputs: [PdfMarkInput], now: Date = Date()) throws -> [PdfMark] {
        if inputs.isEmpty { return [] }
        let groupUuid = inputs.count > 1 ? UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() : nil
        let marks = try inputs.map { input in
            var grouped = input
            grouped.groupUuid = groupUuid
            return try PdfMarkup.validate(grouped)
        }
        return try pool.write { db in
            for mark in marks { try Self.assertPage(db, documentId, mark.page) }
            let stamp = Timestamp.now(now)
            return try marks.map { try Self.insertMark(db, documentId, $0, stamp) }
        }
    }

    /// Changes what the caller names and re-checks the whole mark; its page, kind and group never change. Nil when it is gone.
    @discardableResult
    public func updateAnnotation(id: Int64, changes: PdfMarkChanges, now: Date = Date()) throws -> PdfMark? {
        try pool.write { db in
            guard let current = try Self.fetchMark(db, id) else { return nil }
            let mark = try PdfMarkup.validate(
                PdfMarkInput(
                    page: current.page, kind: current.kind, color: changes.color ?? current.color,
                    rects: changes.rects ?? current.rects, quote: changes.quote ?? current.quote,
                    comment: changes.comment ?? current.comment, body: changes.body ?? current.body, groupUuid: current.groupUuid))
            try db.execute(
                sql: "UPDATE pdf_annotations SET color = ?, rects = ?, quote = ?, comment = ?, body = ?, updated_at = ? WHERE id = ?",
                arguments: [mark.color, mark.rectsJSON, mark.quote, mark.comment, mark.bodyJSON, Timestamp.now(now), id])
            return try Self.fetchMark(db, id)
        }
    }

    /// Deletes a mark, and with it the other parts of the same selection when it crossed pages: the reader shows one highlight, so
    /// one delete removes it. Returns what was removed (empty when it was already gone).
    @discardableResult
    public func deleteAnnotation(id: Int64) throws -> [PdfMark] {
        try pool.write { db in
            guard let mark = try Self.fetchMark(db, id) else { return [] }
            let removed: [PdfMark]
            if let groupUuid = mark.groupUuid {
                removed = try PdfMark.fetchAll(db, sql: "SELECT \(Self.markColumns) FROM pdf_annotations WHERE group_uuid = ? ORDER BY page, id", arguments: [groupUuid])
            } else {
                removed = [mark]
            }
            for row in removed { try db.execute(sql: "DELETE FROM pdf_annotations WHERE id = ?", arguments: [row.id]) }
            return removed
        }
    }

    /// Puts back marks that were deleted, exactly as they were: the same uuid (a note's citation of a mark names it by uuid), the same group, the
    /// same times, and the same id when it is free (ids are never reused, so it is). This is what undoing a delete does. Each is checked as a new
    /// mark would be. A mark whose uuid is already there is left alone, so asking twice, as a redo after an undo may, does no harm. All or none
    /// are put back.
    @discardableResult
    public func restoreAnnotations(documentId: Int64, _ rows: [PdfMark]) throws -> [PdfMark] {
        let checked = try rows.map { row -> (PdfMark, ValidPdfMark) in
            guard PdfMarkup.isHexUuid(row.uuid) else { throw InvalidMarkError("A mark's uuid is 32 lowercase hex characters.") }
            for time in [row.createdAt, row.updatedAt] where time.isEmpty || time.utf16.count > Self.timestampLength {
                throw InvalidMarkError("A mark has the times it was made and changed.")
            }
            let mark = try PdfMarkup.validate(
                PdfMarkInput(page: row.page, kind: row.kind, color: row.color, rects: row.rects, quote: row.quote, comment: row.comment, body: row.body, groupUuid: row.groupUuid))
            return (row, mark)
        }
        return try pool.write { db in
            var restored: [PdfMark] = []
            for (row, mark) in checked {
                try Self.assertPage(db, documentId, mark.page)
                if let existing = try PdfMark.fetchOne(db, sql: "SELECT \(Self.markColumns) FROM pdf_annotations WHERE uuid = ?", arguments: [row.uuid]) {
                    restored.append(existing)
                    continue
                }
                let idFree = try Row.fetchOne(db, sql: "SELECT 1 FROM pdf_annotations WHERE id = ?", arguments: [row.id]) == nil
                try db.execute(
                    sql: """
                        INSERT INTO pdf_annotations (id, uuid, document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                    arguments: [idFree ? row.id : nil, row.uuid, documentId, mark.page, mark.kind.rawValue, mark.color, mark.rectsJSON, mark.quote, mark.comment, mark.bodyJSON, mark.groupUuid, row.createdAt, row.updatedAt])
                guard let inserted = try PdfMark.fetchOne(db, sql: "SELECT \(Self.markColumns) FROM pdf_annotations WHERE uuid = ?", arguments: [row.uuid]) else {
                    throw StoreError.notFound("The mark that was just restored")
                }
                restored.append(inserted)
            }
            return restored
        }
    }

    private static let timestampLength = 40

    // MARK: Search

    /// The words a PDF's owner note is found by, besides its own text: the quotes and comments of its marks, what its text notes say, and its
    /// bookmarks' labels, one per line, by page. Kept apart from the note's content (the search index holds both under the note's id), so
    /// searching "B-tree" finds the textbook's note when a highlight in it says so. With `noteId`, only that note's; otherwise every owner
    /// note's (the whole index is being rebuilt). A note with no words has no entry.
    public func marksSearchText(noteId: Int64? = nil) throws -> [Int64: String] {
        try pool.read { db in
            let filter = noteId == nil ? "" : "WHERE d.note_id = ?"
            let arguments: StatementArguments = noteId.map { [$0] } ?? []
            let marks = try Row.fetchAll(
                db,
                sql: """
                    SELECT d.note_id AS note_id, a.kind AS kind, a.quote AS quote, a.comment AS comment, a.body AS body
                    FROM pdf_annotations a JOIN documents d ON d.id = a.document_id \(filter) ORDER BY d.note_id, a.page, a.id
                    """,
                arguments: arguments)
            let labels = try Row.fetchAll(
                db,
                sql: "SELECT d.note_id AS note_id, b.label AS label FROM pdf_bookmarks b JOIN documents d ON d.id = b.document_id \(filter) ORDER BY d.note_id, b.page, b.id",
                arguments: arguments)

            var lines: [Int64: [String]] = [:]
            func add(_ id: Int64, _ text: String?) {
                guard let text else { return }
                let line = JavaScriptText.trim(text)
                if !line.isEmpty { lines[id, default: []].append(line) }
            }
            for mark in marks {
                let id: Int64 = mark["note_id"]
                if (mark["kind"] as String) == PdfMarkKind.text.rawValue {
                    // A damaged body has no words to find.
                    if let body = (mark["body"] as String?).flatMap({ try? JSONValue(parsing: $0) }) { add(id, body.objectValue?["text"]?.stringValue) }
                } else {
                    add(id, mark["quote"])
                }
                add(id, mark["comment"])
            }
            for label in labels { add(label["note_id"], label["label"]) }
            return lines.mapValues { $0.joined(separator: "\n") }
        }
    }

    // MARK: Citations

    /// The notes that belong with a PDF, with their text: its owner (whether or not its text links to it) and every note whose text contains
    /// `pdf:<uuid>`. `PdfRefs.citations(among:documentUuid:ownerNoteId:)` reads what each cites and puts them in order.
    public func notesForPdf(uuid: String, ownerNoteId: Int64) throws -> [PdfNoteText] {
        try pool.read { db in
            try Row.fetchAll(
                db,
                sql: "SELECT id, title, content, updated_at FROM notes WHERE id = ? OR instr(content, ?) > 0",
                arguments: [ownerNoteId, PdfRefs.scheme + uuid]
            ).map { PdfNoteText(id: $0["id"], title: $0["title"], content: $0["content"], updatedAt: $0["updated_at"]) }
        }
    }

    // MARK: Bookmarks

    public func bookmarks(documentId: Int64) throws -> [PdfBookmark] {
        try pool.read { try PdfBookmark.fetchAll($0, sql: "SELECT \(Self.bookmarkColumns) FROM pdf_bookmarks WHERE document_id = ? ORDER BY page, id", arguments: [documentId]) }
    }

    public func bookmark(id: Int64) throws -> PdfBookmark? {
        try pool.read { try Self.fetchBookmark($0, id) }
    }

    @discardableResult
    public func addBookmark(documentId: Int64, page: Int, label: String = "", now: Date = Date()) throws -> PdfBookmark {
        guard page >= 0 else { throw InvalidMarkError("A page is a whole number from 0.") }
        let text = try PdfMarkup.validateBookmarkLabel(label)
        return try pool.write { db in
            try Self.assertPage(db, documentId, page)
            try db.execute(
                sql: "INSERT INTO pdf_bookmarks (document_id, page, label, created_at) VALUES (?, ?, ?, ?)",
                arguments: [documentId, page, text, Timestamp.now(now)])
            guard let bookmark = try Self.fetchBookmark(db, db.lastInsertedRowID) else { throw StoreError.notFound("The bookmark that was just added") }
            return bookmark
        }
    }

    /// Renames a bookmark. Nil when it is gone.
    @discardableResult
    public func renameBookmark(id: Int64, label: String) throws -> PdfBookmark? {
        let text = try PdfMarkup.validateBookmarkLabel(label)
        return try pool.write { db in
            try db.execute(sql: "UPDATE pdf_bookmarks SET label = ? WHERE id = ?", arguments: [text, id])
            return try Self.fetchBookmark(db, id)
        }
    }

    public func deleteBookmark(id: Int64) throws {
        try pool.write { try $0.execute(sql: "DELETE FROM pdf_bookmarks WHERE id = ?", arguments: [id]) }
    }

    // MARK: Inside a transaction

    static func fetchMark(_ db: Database, _ id: Int64) throws -> PdfMark? {
        try PdfMark.fetchOne(db, sql: "SELECT \(markColumns) FROM pdf_annotations WHERE id = ?", arguments: [id])
    }

    static func fetchBookmark(_ db: Database, _ id: Int64) throws -> PdfBookmark? {
        try PdfBookmark.fetchOne(db, sql: "SELECT \(bookmarkColumns) FROM pdf_bookmarks WHERE id = ?", arguments: [id])
    }

    /// Throws unless the PDF exists and `page` is one of its pages.
    static func assertPage(_ db: Database, _ documentId: Int64, _ page: Int) throws {
        guard let count = try Int.fetchOne(db, sql: "SELECT page_count FROM documents WHERE id = ?", arguments: [documentId]) else {
            throw InvalidMarkError("That PDF no longer exists.")
        }
        if count > 0 && page >= count { throw InvalidMarkError("This PDF has \(count) pages; page \(page) is past the end.") }
    }

    private static func insertMark(_ db: Database, _ documentId: Int64, _ mark: ValidPdfMark, _ stamp: String) throws -> PdfMark {
        try db.execute(
            sql: """
                INSERT INTO pdf_annotations (document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
            arguments: [documentId, mark.page, mark.kind.rawValue, mark.color, mark.rectsJSON, mark.quote, mark.comment, mark.bodyJSON, mark.groupUuid, stamp, stamp])
        guard let inserted = try fetchMark(db, db.lastInsertedRowID) else { throw StoreError.notFound("The mark that was just added") }
        return inserted
    }
}
