import Foundation
import GRDB

/// A note as the list shows it: no body, so listing a large database stays cheap.
public struct NoteSummary: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    /// The name a second device knows this note by. Never shown (docs/architecture/data-model.md).
    public var uuid: String
    public var title: String
    /// Comma-joined, the way the database stores them.
    public var tags: String
    public var notebookId: Int64?
    public var groupId: Int64?
    public var createdAt: String
    public var updatedAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        title = row["title"]
        tags = row["tags"]
        notebookId = row["notebook_id"]
        groupId = row["group_id"]
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
    }
}

/// A whole note: what the list shows, and the text.
public struct NoteDetail: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    public var uuid: String
    public var title: String
    public var description: String
    /// The Markdown, frontmatter included, exactly as stored.
    public var content: String
    public var tags: String
    public var notebookId: Int64?
    public var groupId: Int64?
    public var createdAt: String
    public var updatedAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        title = row["title"]
        description = row["description"]
        content = row["content"]
        tags = row["tags"]
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

    /// Opens the database in `location`, creating the data directory if needed.
    public static func open(in location: DataLocation) throws -> CompositionDatabase {
        try open(at: location.databaseURL)
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
                    SELECT id, uuid, title, tags, notebook_id, group_id, created_at, updated_at
                    FROM notes ORDER BY updated_at DESC, id DESC
                    """)
        }
    }

    /// The notes with these ids, in the order given; an id that is not a note is skipped (a search result may have just been trashed).
    public func notes(ids: [Int64]) throws -> [NoteSummary] {
        try pool.read { db in
            var found: [Int64: NoteSummary] = [:]
            // SQLite's limit on variables is far above any page of results, but a long list is read in pieces anyway.
            for start in stride(from: 0, to: ids.count, by: 500) {
                let chunk = Array(ids[start..<min(start + 500, ids.count)])
                let marks = Array(repeating: "?", count: chunk.count).joined(separator: ", ")
                for note in try NoteSummary.fetchAll(
                    db,
                    sql: "SELECT id, uuid, title, tags, notebook_id, group_id, created_at, updated_at FROM notes WHERE id IN (\(marks))",
                    arguments: StatementArguments(chunk))
                {
                    found[note.id] = note
                }
            }
            return ids.compactMap { found[$0] }
        }
    }

    /// The version of the SQLite this database runs on (the system's, on a device).
    public func sqliteVersion() throws -> String {
        try pool.read { try String.fetchOne($0, sql: "SELECT sqlite_version()") ?? "unknown" }
    }

    /// One note with its text, or nil if there is none with this id.
    public func note(id: Int64) throws -> NoteDetail? {
        try pool.read { db in
            try NoteDetail.fetchOne(
                db,
                sql: """
                    SELECT id, uuid, title, description, content, tags, notebook_id, group_id, created_at, updated_at
                    FROM notes WHERE id = ?
                    """,
                arguments: [id])
        }
    }

    /// What the notes look like now, in one short string: how many, the latest change, and the sum of their ids. The search
    /// index stores it when it is built, and a different one later means the notes changed behind its back (a restore, say).
    func notesFingerprint() throws -> String {
        try pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS latest, COALESCE(SUM(id), 0) AS total FROM notes")
            return "\(row?["n"] as Int? ?? 0)|\(row?["latest"] as String? ?? "")|\(row?["total"] as Int? ?? 0)"
        }
    }
}
