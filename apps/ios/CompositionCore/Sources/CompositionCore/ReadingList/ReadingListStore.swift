import Foundation
import GRDB

// The Reading List's links in the notes database: a port of the desktop's `readingListRepo.ts` and `readingListService.ts`, with
// the same SQL, the same refusals and the same words. The `reading_list` table is the desktop's (Schema.readingList), so links
// travel in a backup both ways. Each operation is one write transaction, and `now` is a parameter so a test can say when something
// happened. `fixtures/conformance/reading-list.json` records a session through the desktop's real service; `ReadingListConformanceTests`
// replays it here and compares every row.

/// Why a change to the Reading List was refused, in the desktop's words.
public enum ReadingListError: Error, Equatable, Sendable, LocalizedError {
    /// The link is not one the list takes.
    case badLink(ReadingLinks.Problem)
    /// The link is in the list already: this one.
    case alreadyListed(ReadingItem)
    /// The link was deleted (by another window, or a restore) before the change reached it.
    case gone

    public var errorDescription: String? {
        switch self {
        case .badLink(let problem): problem.errorDescription
        case .alreadyListed(let item): "That link is already in your list: \(item.label)."
        case .gone: "That link is no longer in your list."
        }
    }
}

extension ReadingItem: FetchableRecord {
    public init(row: Row) {
        id = row["id"]
        url = row["url"]
        title = row["title"]
        read = (row["read"] as Int64) == 1
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
    }
}

extension CompositionDatabase {
    /// Every link, oldest first.
    public func readingItems() throws -> [ReadingItem] {
        try pool.read { try ReadingItem.fetchAll($0, sql: "SELECT * FROM reading_list ORDER BY id") }
    }

    public func readingItem(id: Int64) throws -> ReadingItem? {
        try pool.read { try Self.fetchReadingItem($0, id) }
    }

    /// Adds a link at the end, unread and untitled. Throws `.badLink` for an address that is not a web page and `.alreadyListed`
    /// for one already in the list, however it was typed.
    @discardableResult
    public func addReadingItem(_ input: String, now: Date = Date()) throws -> ReadingItem {
        let url: String
        switch ReadingLinks.normalize(input) {
        case .success(let normalized): url = normalized
        case .failure(let problem): throw ReadingListError.badLink(problem)
        }
        return try pool.write { db in
            if let existing = try ReadingItem.fetchOne(db, sql: "SELECT * FROM reading_list WHERE url = ?", arguments: [url]) {
                throw ReadingListError.alreadyListed(existing)
            }
            let stamp = Timestamp.now(now)
            try db.execute(
                sql: "INSERT INTO reading_list (url, title, read, created_at, updated_at) VALUES (?, '', 0, ?, ?)",
                arguments: [url, stamp, stamp])
            guard let item = try Self.fetchReadingItem(db, db.lastInsertedRowID) else { throw ReadingListError.gone }
            return item
        }
    }

    /// Fills in the title of a link that has none, from its page. A link that has a title keeps it, and a title with nothing in it
    /// changes nothing. Throws `.gone` for a link that is not there.
    @discardableResult
    public func setReadingItemTitle(id: Int64, title: String, now: Date = Date()) throws -> ReadingItem {
        try pool.write { db in
            guard let current = try Self.fetchReadingItem(db, id) else { throw ReadingListError.gone }
            guard current.title.isEmpty, let cleaned = ReadingLinks.cleanTitle(title) else { return current }
            try db.execute(
                sql: "UPDATE reading_list SET title = ?, read = ?, updated_at = ? WHERE id = ?",
                arguments: [cleaned, current.read ? 1 : 0, Timestamp.now(now), id])
            return try Self.fetchReadingItem(db, id) ?? current
        }
    }

    /// Marks the link read or unread. Throws `.gone` for a link that is not there.
    @discardableResult
    public func setReadingItemRead(id: Int64, read: Bool, now: Date = Date()) throws -> ReadingItem {
        try pool.write { db in
            guard let current = try Self.fetchReadingItem(db, id) else { throw ReadingListError.gone }
            try db.execute(
                sql: "UPDATE reading_list SET title = ?, read = ?, updated_at = ? WHERE id = ?",
                arguments: [current.title, read ? 1 : 0, Timestamp.now(now), id])
            guard let item = try Self.fetchReadingItem(db, id) else { throw ReadingListError.gone }
            return item
        }
    }

    /// Deletes the link, for good: links do not go to the Trash Can. Deleting one that is already gone is not an error.
    public func deleteReadingItem(id: Int64) throws {
        try pool.write { try $0.execute(sql: "DELETE FROM reading_list WHERE id = ?", arguments: [id]) }
    }

    static func fetchReadingItem(_ db: Database, _ id: Int64) throws -> ReadingItem? {
        try ReadingItem.fetchOne(db, sql: "SELECT * FROM reading_list WHERE id = ?", arguments: [id])
    }
}
