import Foundation
import GRDB

// Groups: a port of `groupsRepo.ts`, with the same SQL and the same refusals (see NotebooksStore.swift).

extension CompositionDatabase {
    /// Hand-placed groups first, in their set order; the rest (new ones too) by name.
    static let groupDisplayOrder = "position IS NULL, position, name, id"

    static let groupColumns = "id, uuid, name, parent_id, notebook_id, created_at, updated_at"

    public func listGroups() throws -> [NoteGroup] {
        try pool.read { try NoteGroup.fetchAll($0, sql: "SELECT \(Self.groupColumns) FROM groups ORDER BY \(Self.groupDisplayOrder)") }
    }

    public func group(id: Int64) throws -> NoteGroup? {
        try pool.read { try Self.fetchGroup($0, id) }
    }

    /// A sub-group is always in its parent's notebook; a top-level group goes in `notebookId` (the default notebook when none is given).
    @discardableResult
    public func createGroup(name: String, parentId: Int64? = nil, notebookId: Int64? = nil, now: Date = Date()) throws -> NoteGroup {
        try pool.write { db in
            let stamp = Timestamp.now(now)
            let parent = try parentId.flatMap { try Self.fetchGroup(db, $0) }
            let inNotebook = try parent?.notebookId ?? notebookId ?? Self.defaultNotebookId(db)
            try db.execute(
                sql: "INSERT INTO groups (name, parent_id, notebook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                arguments: [name, parentId, inNotebook, stamp, stamp])
            guard let group = try Self.fetchGroup(db, db.lastInsertedRowID) else { throw StoreError.notFound("The group that was just created") }
            return group
        }
    }

    public func renameGroup(id: Int64, name: String, now: Date = Date()) throws {
        try pool.write { try $0.execute(sql: "UPDATE groups SET name = ?, updated_at = ? WHERE id = ?", arguments: [name, Timestamp.now(now), id]) }
    }

    /// Reparents a group (nil = top level); refuses to create a loop in the hierarchy. It lands after any hand-placed siblings,
    /// since its old position meant nothing there.
    public func moveGroup(id: Int64, parentId: Int64?, now: Date = Date()) throws {
        try pool.write { db in
            try Self.assertCanMove(db, id, parentId)
            try db.execute(
                sql: "UPDATE groups SET parent_id = ?, position = NULL, updated_at = ? WHERE id = ?",
                arguments: [parentId, Timestamp.now(now), id])
            try Self.adoptParentNotebook(db, id, parentId)
        }
    }

    /// Moves a group, with its sub-groups and notes, into another notebook, where it becomes a top-level group (last among
    /// them). Works the same for a sub-group, which leaves its parent behind.
    public func moveGroupToNotebook(id: Int64, notebookId: Int64, now: Date = Date()) throws {
        try pool.write { db in
            if try Self.fetchGroup(db, id) == nil { throw StoreError.invalidNotebookMove("Group \(id) not found.") }
            if try Self.fetchNotebook(db, notebookId) == nil { throw StoreError.invalidNotebookMove("Notebook \(notebookId) not found.") }
            try db.execute(
                sql: "UPDATE groups SET parent_id = NULL, position = NULL, updated_at = ? WHERE id = ?",
                arguments: [Timestamp.now(now), id])
            try Self.setSubtreeNotebook(db, id, notebookId)
        }
    }

    /// Puts a group under `parentId` immediately before its sibling `beforeId` (last when nil) and fixes the whole sibling
    /// list's order. Same refusals as `moveGroup`; a group may also be placed within the parent it already has, which just
    /// reorders it.
    public func placeGroup(id: Int64, parentId: Int64?, before beforeId: Int64?, now: Date = Date()) throws {
        try pool.write { db in
            try Self.assertCanMove(db, id, parentId)
            // The notebook it ends up in: its new parent's, or the one it is already top-level in.
            let anchor = try Self.fetchGroup(db, parentId ?? id)
            let notebookId = anchor?.notebookId
            let siblings = try Int64.fetchAll(
                db, sql: "SELECT id FROM groups WHERE parent_id IS ? AND notebook_id = ? ORDER BY \(Self.groupDisplayOrder)",
                arguments: [parentId, notebookId])
            let ordered = Ordering.placeBefore(siblings, id, before: beforeId)
            try db.execute(sql: "UPDATE groups SET parent_id = ?, updated_at = ? WHERE id = ?", arguments: [parentId, Timestamp.now(now), id])
            try Self.adoptParentNotebook(db, id, parentId)
            for (index, groupId) in ordered.enumerated() {
                try db.execute(sql: "UPDATE groups SET position = ? WHERE id = ?", arguments: [index, groupId])
            }
        }
    }

    /// Whether a group has no sub-groups and no notes directly in it.
    public func groupIsEmpty(id: Int64) throws -> Bool {
        try pool.read { db in
            let children = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM groups WHERE parent_id = ?", arguments: [id]) ?? 0
            let notes = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM notes WHERE group_id = ?", arguments: [id]) ?? 0
            return children == 0 && notes == 0
        }
    }

    // MARK: Inside a transaction

    static func fetchGroup(_ db: Database, _ id: Int64) throws -> NoteGroup? {
        try NoteGroup.fetchOne(db, sql: "SELECT \(groupColumns) FROM groups WHERE id = ?", arguments: [id])
    }

    /// Throws unless `parentId` (nil = top level) is a legal new parent for group `id`.
    private static func assertCanMove(_ db: Database, _ id: Int64, _ parentId: Int64?) throws {
        if try fetchGroup(db, id) == nil { throw StoreError.invalidGroupMove("Group \(id) not found.") }
        if let parentId, try fetchGroup(db, parentId) == nil { throw StoreError.invalidGroupMove("Group \(parentId) not found.") }
        var parents: [Int64: Int64?] = [:]
        for row in try Row.fetchAll(db, sql: "SELECT id, parent_id FROM groups") { parents[row["id"]] = row["parent_id"] as Int64? }
        if GroupMove.wouldCreateCycle(parents, id: id, newParentId: parentId) {
            throw StoreError.invalidGroupMove("Group \(id) cannot be moved into itself or one of its sub-groups.")
        }
    }

    /// A group moved under another one joins that group's notebook, taking everything in it along.
    private static func adoptParentNotebook(_ db: Database, _ id: Int64, _ parentId: Int64?) throws {
        guard let parentId, let parent = try fetchGroup(db, parentId), let notebookId = parent.notebookId else { return }
        try setSubtreeNotebook(db, id, notebookId)
    }

    /// Puts group `id`, all its sub-groups and every note in any of them into `notebookId`.
    private static func setSubtreeNotebook(_ db: Database, _ id: Int64, _ notebookId: Int64) throws {
        var ids = [id]
        var index = 0
        while index < ids.count {
            for child in try Int64.fetchAll(db, sql: "SELECT id FROM groups WHERE parent_id = ?", arguments: [ids[index]]) where !ids.contains(child) {
                ids.append(child)
            }
            index += 1
        }
        let marks = Array(repeating: "?", count: ids.count).joined(separator: ", ")
        try db.execute(sql: "UPDATE groups SET notebook_id = ? WHERE id IN (\(marks))", arguments: StatementArguments([notebookId] + ids))
        try db.execute(sql: "UPDATE notes SET notebook_id = ? WHERE group_id IN (\(marks))", arguments: StatementArguments([notebookId] + ids))
    }
}
