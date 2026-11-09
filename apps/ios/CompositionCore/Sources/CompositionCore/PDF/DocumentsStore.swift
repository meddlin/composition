import Foundation
import GRDB

// The PDFs notes own: a port of `documentsRepo.ts`, with the same SQL and the same refusals (see NotebooksStore.swift). The
// conformance corpus (fixtures/conformance/pdf) runs both against a fresh database. Each operation is one write transaction, and
// `now` is a parameter so a test can say when something happened.
//
// A PDF is a row here and a file in `<application data>/documents/` (`DataLocation.documentsURL`). Writing and removing the file
// is the caller's: `deleteDocument` and `deleteOrphanedDocuments` return the rows they dropped so the caller can remove the files.

/// A PDF a note owns, plus where its bytes are (`storedName`, the file's name in `documents/`) and their hash.
public struct StoredDocument: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    /// The name a second device knows this PDF by, and the one `pdf:` links use.
    public var uuid: String
    /// The owner note, live or in the Trash Can.
    public var noteId: Int64
    /// The name it was imported as.
    public var fileName: String
    public var storedName: String
    public var sha256: String
    /// Bytes.
    public var size: Int64
    /// 0 until the reader has counted them.
    public var pageCount: Int
    public var viewState: PdfViewState
    public var createdAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        noteId = row["note_id"]
        fileName = row["file_name"]
        storedName = row["stored_name"]
        sha256 = row["sha256"]
        size = row["size"]
        pageCount = row["page_count"]
        viewState = PdfViewState(storedJSON: row["view_state"])
        createdAt = row["created_at"]
    }
}

/// Why a PDF can't be given to a note or counted: there is no such note, it already owns one (a note owns at most one PDF), or the
/// pages are fewer than one.
public enum DocumentError: Error, Equatable, LocalizedError {
    case noNote
    case hasDocument
    case invalidPageCount

    public var errorDescription: String? {
        switch self {
        case .noNote: "That note no longer exists."
        case .hasDocument: "That note already has a PDF."
        case .invalidPageCount: "A PDF has at least one page."
        }
    }
}

extension CompositionDatabase {
    static let documentColumns = "id, uuid, note_id, file_name, stored_name, sha256, size, page_count, view_state, created_at"

    public func document(id: Int64) throws -> StoredDocument? {
        try pool.read { try Self.fetchDocument($0, id) }
    }

    public func document(uuid: String) throws -> StoredDocument? {
        try pool.read { try StoredDocument.fetchOne($0, sql: "SELECT \(Self.documentColumns) FROM documents WHERE uuid = ?", arguments: [uuid]) }
    }

    /// The PDF a note owns, whether the note is live or in the Trash Can.
    public func documentForNote(_ noteId: Int64) throws -> StoredDocument? {
        try pool.read { try StoredDocument.fetchOne($0, sql: "SELECT \(Self.documentColumns) FROM documents WHERE note_id = ?", arguments: [noteId]) }
    }

    /// Every PDF with exactly these bytes, oldest first: what a second import of the same file is offered (P16).
    public func documents(sha256: String) throws -> [StoredDocument] {
        try pool.read { try StoredDocument.fetchAll($0, sql: "SELECT \(Self.documentColumns) FROM documents WHERE sha256 = ? ORDER BY id", arguments: [sha256]) }
    }

    /// Every PDF, oldest first: the sidebar marks the notes that own one, and opening a note finds its PDF here.
    public func listDocuments() throws -> [StoredDocument] {
        try pool.read { try StoredDocument.fetchAll($0, sql: "SELECT \(Self.documentColumns) FROM documents ORDER BY id") }
    }

    /// Gives a live note its PDF. Throws `DocumentError.noNote` when the note is gone (one in the Trash Can is gone: it cannot be given
    /// a PDF) and `.hasDocument` when it already has one.
    @discardableResult
    public func addDocument(noteId: Int64, fileName: String, storedName: String, sha256: String, size: Int64, pageCount: Int, now: Date = Date()) throws -> StoredDocument {
        try pool.write { db in
            guard try Row.fetchOne(db, sql: "SELECT 1 FROM notes WHERE id = ?", arguments: [noteId]) != nil else { throw DocumentError.noNote }
            guard try Row.fetchOne(db, sql: "SELECT 1 FROM documents WHERE note_id = ?", arguments: [noteId]) == nil else { throw DocumentError.hasDocument }
            try db.execute(
                sql: """
                    INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [noteId, fileName, storedName, sha256, size, pageCount, Timestamp.now(now)])
            guard let document = try Self.fetchDocument(db, db.lastInsertedRowID) else { throw StoreError.notFound("The PDF that was just added") }
            return document
        }
    }

    /// Records how many pages the reader counted. A PDF imported before it was counted has 0.
    public func setPageCount(id: Int64, pageCount: Int) throws {
        guard pageCount >= 1 else { throw DocumentError.invalidPageCount }
        try pool.write { try $0.execute(sql: "UPDATE documents SET page_count = ? WHERE id = ?", arguments: [pageCount, id]) }
    }

    /// Remembers where the reader was. Keeps the keys it knows and drops the rest (`PdfViewState.normalized`).
    public func setViewState(id: Int64, state: PdfViewState) throws {
        try pool.write { try $0.execute(sql: "UPDATE documents SET view_state = ? WHERE id = ?", arguments: [state.normalized().json.serialized(), id]) }
    }

    /// Drops a PDF's row, its marks and its bookmarks in one transaction, and returns the row so the caller can delete the file.
    @discardableResult
    public func deleteDocument(id: Int64) throws -> StoredDocument? {
        try pool.write { db in
            guard let document = try Self.fetchDocument(db, id) else { return nil }
            try db.execute(sql: "DELETE FROM pdf_annotations WHERE document_id = ?", arguments: [id])
            try db.execute(sql: "DELETE FROM pdf_bookmarks WHERE document_id = ?", arguments: [id])
            try db.execute(sql: "DELETE FROM documents WHERE id = ?", arguments: [id])
            return document
        }
    }

    /// Drops the PDFs whose owner note is neither in `notes` nor in the Trash Can (`trashed_notes`), with their marks and
    /// bookmarks, and returns them so the caller can delete the files. A PDF whose note is in the Trash Can is kept: restoring the
    /// note finds it again by the note's unchanged id. Also drops marks and bookmarks whose PDF is gone.
    @discardableResult
    public func deleteOrphanedDocuments() throws -> [StoredDocument] {
        try pool.write { db in
            let orphans = try StoredDocument.fetchAll(
                db,
                sql: """
                    SELECT \(Self.documentColumns) FROM documents
                    WHERE note_id NOT IN (SELECT id FROM notes)
                      AND note_id NOT IN (SELECT id FROM trashed_notes)
                    """)
            for orphan in orphans {
                try db.execute(sql: "DELETE FROM pdf_annotations WHERE document_id = ?", arguments: [orphan.id])
                try db.execute(sql: "DELETE FROM pdf_bookmarks WHERE document_id = ?", arguments: [orphan.id])
                try db.execute(sql: "DELETE FROM documents WHERE id = ?", arguments: [orphan.id])
            }
            try db.execute(sql: "DELETE FROM pdf_annotations WHERE document_id NOT IN (SELECT id FROM documents)")
            try db.execute(sql: "DELETE FROM pdf_bookmarks WHERE document_id NOT IN (SELECT id FROM documents)")
            return orphans
        }
    }

    // MARK: Inside a transaction

    static func fetchDocument(_ db: Database, _ id: Int64) throws -> StoredDocument? {
        try StoredDocument.fetchOne(db, sql: "SELECT \(documentColumns) FROM documents WHERE id = ?", arguments: [id])
    }
}
