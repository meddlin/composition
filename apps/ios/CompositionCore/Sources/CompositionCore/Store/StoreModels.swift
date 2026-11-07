import Foundation
import GRDB

// The notebooks and groups that notes live in, the ways a write can be refused, and the two pure rules behind dragging things
// into order: the Swift twins of `notebooksRepo.ts`, `groupsRepo.ts`, `ordering.ts` and `groupMove.ts` (build plan, Step 2).

public struct Notebook: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    /// The name a second device knows this notebook by. Never shown (docs/architecture/data-model.md).
    public var uuid: String
    public var name: String
    public var createdAt: String
    public var updatedAt: String

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        name = row["name"]
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
    }
}

/// A group of notes, which may hold other groups. (Called `Group` on the desktop; that name is SwiftUI's.)
public struct NoteGroup: Equatable, Sendable, FetchableRecord {
    public var id: Int64
    public var uuid: String
    public var name: String
    public var parentId: Int64?
    public var notebookId: Int64?
    public var createdAt: String
    public var updatedAt: String

    public init(id: Int64, uuid: String = "", name: String, parentId: Int64? = nil, notebookId: Int64? = nil, createdAt: String = "", updatedAt: String = "") {
        (self.id, self.uuid, self.name, self.parentId, self.notebookId, self.createdAt, self.updatedAt) = (id, uuid, name, parentId, notebookId, createdAt, updatedAt)
    }

    public init(row: Row) {
        id = row["id"]
        uuid = row["uuid"]
        name = row["name"]
        parentId = row["parent_id"]
        notebookId = row["notebook_id"]
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
    }
}

/// Why a write was refused. The wording is the desktop's, which shows the same text.
public enum StoreError: Error, Equatable, LocalizedError {
    case notFound(String)
    /// `moveGroup` and `placeGroup`: the group or its new parent is gone, or the move would put it inside itself.
    case invalidGroupMove(String)
    /// `moveGroupToNotebook`: the group or the notebook is gone.
    case invalidNotebookMove(String)
    case lastNotebook
    case notebookNotEmpty(Int64)
    case noNotebooks

    public var errorDescription: String? {
        switch self {
        case .notFound(let what): "\(what) not found."
        case .invalidGroupMove, .invalidNotebookMove: "That group can't be moved there."
        case .lastNotebook: "The last notebook can't be deleted."
        case .notebookNotEmpty: "This notebook still has groups or notes — empty it first."
        case .noNotebooks: "There are no notebooks."
        }
    }
}

/// Manual ordering of siblings, `ordering.ts`.
public enum Ordering {
    /// `ids` (a sibling list in display order) with `id` placed immediately before `beforeId`, or last when `beforeId` is nil or
    /// no longer among the siblings. `id` may or may not already be in the list: a move from another group adds it. Dropping
    /// `id` before itself leaves it where it is.
    public static func placeBefore(_ ids: [Int64], _ id: Int64, before beforeId: Int64?) -> [Int64] {
        let rest = ids.filter { $0 != id }
        if beforeId == id { return ids.contains(id) ? ids : rest + [id] }
        guard let beforeId, let at = rest.firstIndex(of: beforeId) else { return rest + [id] }
        return Array(rest[..<at]) + [id] + Array(rest[at...])
    }
}

/// `groupMove.ts`.
public enum GroupMove {
    /// Whether making `newParentId` the parent of group `id` would create a loop: a group cannot become its own parent or sit
    /// beneath one of its descendants.
    public static func wouldCreateCycle(_ parents: [Int64: Int64?], id: Int64, newParentId: Int64?) -> Bool {
        var seen = Set<Int64>()
        var cursor = newParentId
        while let current = cursor, !seen.contains(current) {
            if current == id { return true }
            seen.insert(current)
            cursor = parents[current] ?? nil
        }
        return false
    }
}
