import Foundation
import GRDB

// Notebooks: a port of `notebooksRepo.ts`. The SQL is the same text, and the conformance script
// (fixtures/conformance/store-script.json) runs both against one database. Each operation is one write transaction, and `now`
// is a parameter so a test can say when something happened.

extension CompositionDatabase {
    /// In the order they were dragged into (NULL until then: the order they were made). The desktop also hands rows an older CLI
    /// wrote to the first notebook here; the iPad has no older CLI, and opening the database already did that.
    static let notebookDisplayOrder = "position IS NULL, position, id"

    static let notebookColumns = "id, uuid, name, created_at, updated_at"

    public func listNotebooks() throws -> [Notebook] {
        try pool.read { db in
            try Notebook.fetchAll(db, sql: "SELECT \(Self.notebookColumns) FROM notebooks ORDER BY \(Self.notebookDisplayOrder)")
        }
    }

    public func notebook(id: Int64) throws -> Notebook? {
        try pool.read { try Self.fetchNotebook($0, id) }
    }

    /// The notebook that takes anything whose own is gone (a restored item, a note made with none chosen): the first one.
    public func defaultNotebookId() throws -> Int64 {
        try pool.read { try Self.defaultNotebookId($0) }
    }

    @discardableResult
    public func createNotebook(name: String, now: Date = Date()) throws -> Notebook {
        try pool.write { db in
            let stamp = Timestamp.now(now)
            try db.execute(sql: "INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, ?, ?)", arguments: [name, stamp, stamp])
            guard let notebook = try Self.fetchNotebook(db, db.lastInsertedRowID) else {
                throw StoreError.notFound("The notebook that was just created")
            }
            return notebook
        }
    }

    /// Puts a notebook immediately before another (last when `beforeId` is nil) and fixes the whole list's order.
    public func placeNotebook(id: Int64, before beforeId: Int64?) throws {
        try pool.write { db in
            let ids = try Int64.fetchAll(db, sql: "SELECT id FROM notebooks ORDER BY \(Self.notebookDisplayOrder)")
            guard ids.contains(id) else { throw StoreError.notFound("Notebook \(id)") }
            for (index, notebookId) in Ordering.placeBefore(ids, id, before: beforeId).enumerated() {
                try db.execute(sql: "UPDATE notebooks SET position = ? WHERE id = ?", arguments: [index, notebookId])
            }
        }
    }

    public func renameNotebook(id: Int64, name: String, now: Date = Date()) throws {
        try pool.write { try $0.execute(sql: "UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?", arguments: [name, Timestamp.now(now), id]) }
    }

    /// Deletes an empty notebook for good. Like a group, one with anything in it is refused (the Trash Can holds notes and
    /// groups, not notebooks), and the last notebook stays: everything has to live somewhere.
    public func deleteNotebook(id: Int64) throws {
        try pool.write { db in
            let notebooks = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM notebooks") ?? 0
            if notebooks <= 1 { throw StoreError.lastNotebook }
            let groups = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM groups WHERE notebook_id = ?", arguments: [id]) ?? 0
            let notes = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM notes WHERE notebook_id = ?", arguments: [id]) ?? 0
            if groups + notes > 0 { throw StoreError.notebookNotEmpty(id) }
            // Trashed items that were in it come back to the default notebook if restored.
            try db.execute(sql: "DELETE FROM notebooks WHERE id = ?", arguments: [id])
        }
    }

    // MARK: Inside a transaction

    static func fetchNotebook(_ db: Database, _ id: Int64) throws -> Notebook? {
        try Notebook.fetchOne(db, sql: "SELECT \(notebookColumns) FROM notebooks WHERE id = ?", arguments: [id])
    }

    static func defaultNotebookId(_ db: Database) throws -> Int64 {
        guard let first = try Int64.fetchOne(db, sql: "SELECT MIN(id) FROM notebooks") else { throw StoreError.noNotebooks }
        return first
    }
}
