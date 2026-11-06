import Foundation
import GRDB

/// A note as the list shows it: no body, so listing a large database stays cheap.
public struct NoteSummary: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    /// The name a second device knows this note by. Never shown (docs/architecture/data-model.md).
    public var uuid: String
    public var title: String
    public var notebookId: Int64?
    public var groupId: Int64?
    public var createdAt: String
    public var updatedAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        title = row["title"]
        notebookId = row["notebook_id"]
        groupId = row["group_id"]
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
    }
}

/// The iPad's `composition.db`: the same file shape the desktop writes, opened through GRDB. Opening runs the additive
/// schema pass (`SchemaPass`), so a database from the desktop, from a backup, or from nothing at all comes up to date.
public final class CompositionDatabase: Sendable {
    let pool: DatabasePool

    private init(pool: DatabasePool) {
        self.pool = pool
    }

    /// Opens (creating if needed) the database at `url`, in WAL mode like the desktop, and brings it up to date.
    public static func open(at url: URL) throws -> CompositionDatabase {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let pool = try DatabasePool(path: url.path)
        try SchemaPass.run(pool)
        return CompositionDatabase(pool: pool)
    }

    /// Flushes the write-ahead log into the main file and closes every connection. Needed before the file is copied or
    /// archived as a backup.
    public func close() throws {
        try pool.close()
    }

    public func listNotes() throws -> [NoteSummary] {
        try pool.read { db in
            try NoteSummary.fetchAll(
                db,
                sql: """
                    SELECT id, uuid, title, notebook_id, group_id, created_at, updated_at
                    FROM notes ORDER BY updated_at DESC, id DESC
                    """)
        }
    }
}
