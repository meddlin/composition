import Foundation
import GRDB

// The only way a note or group leaves `notes` and `groups`: it moves to the trash tables, from where it can be restored
// until it is permanently deleted by hand or outlives the retention window. A port of `trashRepo.ts`; the SQL is the
// same text, and the conformance script (apps/ios/conformance/trash-script.json) runs both against one database.
//
// Each operation is one write transaction. `now` is a parameter so a test can say when something was deleted.

extension CompositionDatabase {
    /// Moves a note to the trash, keeping its id and uuid. A note that is already gone is ignored.
    public func trashNote(id: Int64, now: Date = Date()) throws {
        try pool.write { db in
            try db.execute(
                sql: """
                    INSERT OR REPLACE INTO trashed_notes
                      (id, uuid, title, content, tags, description, created_at, updated_at, group_id, notebook_id, deleted_at)
                    SELECT id, uuid, title, content, tags, description, created_at, updated_at, group_id, notebook_id, ?
                    FROM notes WHERE id = ?
                    """,
                arguments: [Timestamp.now(now), id])
            try db.execute(sql: "DELETE FROM notes WHERE id = ?", arguments: [id])
        }
    }

    /// Moves a group to the trash. Refuses a group that still has sub-groups or notes, and changes nothing then.
    public func trashGroup(id: Int64, now: Date = Date()) throws {
        try pool.write { db in
            let children = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM groups WHERE parent_id = ?", arguments: [id]) ?? 0
            let notes = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM notes WHERE group_id = ?", arguments: [id]) ?? 0
            guard children == 0 && notes == 0 else { throw TrashError.groupNotEmpty(id) }
            try db.execute(
                sql: """
                    INSERT OR REPLACE INTO trashed_groups
                      (id, uuid, name, parent_id, notebook_id, created_at, updated_at, deleted_at)
                    SELECT id, uuid, name, parent_id, notebook_id, created_at, updated_at, ?
                    FROM groups WHERE id = ?
                    """,
                arguments: [Timestamp.now(now), id])
            try db.execute(sql: "DELETE FROM groups WHERE id = ?", arguments: [id])
        }
    }

    public func listTrash() throws -> Trash {
        try pool.read { db in
            let notes = try Row.fetchAll(
                db, sql: "SELECT id, title, deleted_at FROM trashed_notes ORDER BY deleted_at DESC, id DESC"
            ).map { row -> TrashedNote in
                let deletedAt: String = row["deleted_at"]
                return TrashedNote(id: row["id"], title: row["title"], deletedAt: deletedAt, expiresAt: TrashRetention.expiry(of: deletedAt))
            }
            let groups = try Row.fetchAll(
                db, sql: "SELECT id, name, deleted_at FROM trashed_groups ORDER BY deleted_at DESC, id DESC"
            ).map { row -> TrashedGroup in
                let deletedAt: String = row["deleted_at"]
                return TrashedGroup(id: row["id"], name: row["name"], deletedAt: deletedAt, expiresAt: TrashRetention.expiry(of: deletedAt))
            }
            return Trash(notes: notes, groups: groups)
        }
    }

    /// Puts a trashed note back, in its original group if that group still exists, otherwise ungrouped. Nil when the
    /// note isn't in the trash (already restored or purged, perhaps by another window).
    public func restoreNote(id: Int64) throws -> RestoreResult? {
        try pool.write { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT * FROM trashed_notes WHERE id = ?", arguments: [id]) else { return nil }
            let originalGroup: Int64? = row["group_id"]
            let originalNotebook: Int64? = row["notebook_id"]

            let group = try originalGroup.flatMap { try Row.fetchOne(db, sql: "SELECT notebook_id FROM groups WHERE id = ?", arguments: [$0]) }
            let groupId = group == nil ? nil : originalGroup
            // In its group's notebook if the group is still there, else the one it was in (if that survives).
            let notebookId = try (group?["notebook_id"] as Int64?) ?? Self.survivingNotebookId(db, originalNotebook)
            // Ids are never reused (AUTOINCREMENT), so keeping it is safe; a clash would mean the database was swapped
            // underneath us, and a fresh id is still correct.
            let idTaken = try Row.fetchOne(db, sql: "SELECT 1 FROM notes WHERE id = ?", arguments: [id]) != nil
            try db.execute(
                sql: """
                    INSERT INTO notes (id, uuid, title, content, tags, description, created_at, updated_at, group_id, notebook_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    idTaken ? nil : id, try Self.restoredUuid(db, table: "notes", row["uuid"]), row["title"] as String,
                    row["content"] as String, row["tags"] as String, row["description"] as String,
                    row["created_at"] as String, row["updated_at"] as String, groupId, notebookId,
                ])
            try db.execute(sql: "DELETE FROM trashed_notes WHERE id = ?", arguments: [id])
            return RestoreResult(restoredToTopLevel: originalGroup != nil && groupId == nil)
        }
    }

    /// Puts a trashed group back under its original parent if that still exists, otherwise at the top level. Nil when the
    /// group isn't in the trash.
    public func restoreGroup(id: Int64) throws -> RestoreResult? {
        try pool.write { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT * FROM trashed_groups WHERE id = ?", arguments: [id]) else { return nil }
            let originalParent: Int64? = row["parent_id"]
            let originalNotebook: Int64? = row["notebook_id"]

            let parent = try originalParent.flatMap { try Row.fetchOne(db, sql: "SELECT notebook_id FROM groups WHERE id = ?", arguments: [$0]) }
            let parentId = parent == nil ? nil : originalParent
            let notebookId = try (parent?["notebook_id"] as Int64?) ?? Self.survivingNotebookId(db, originalNotebook)
            let idTaken = try Row.fetchOne(db, sql: "SELECT 1 FROM groups WHERE id = ?", arguments: [id]) != nil
            try db.execute(
                sql: """
                    INSERT INTO groups (id, uuid, name, parent_id, notebook_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    idTaken ? nil : id, try Self.restoredUuid(db, table: "groups", row["uuid"]), row["name"] as String,
                    parentId, notebookId, row["created_at"] as String, row["updated_at"] as String,
                ])
            try db.execute(sql: "DELETE FROM trashed_groups WHERE id = ?", arguments: [id])
            return RestoreResult(restoredToTopLevel: originalParent != nil && parentId == nil)
        }
    }

    /// Permanently deletes a trashed note.
    public func purgeNote(id: Int64) throws {
        try pool.write { try $0.execute(sql: "DELETE FROM trashed_notes WHERE id = ?", arguments: [id]) }
    }

    /// Permanently deletes a trashed group.
    public func purgeGroup(id: Int64) throws {
        try pool.write { try $0.execute(sql: "DELETE FROM trashed_groups WHERE id = ?", arguments: [id]) }
    }

    /// Permanently deletes everything that has been in the trash longer than the retention window.
    public func purgeExpired(now: Date = Date()) throws {
        let cutoff = TrashRetention.cutoff(now: now)
        try pool.write { db in
            try db.execute(sql: "DELETE FROM trashed_notes WHERE deleted_at < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM trashed_groups WHERE deleted_at < ?", arguments: [cutoff])
        }
    }

    /// The uuid a restored row goes back with: the one it was trashed with. Like its id, it is only given up if something
    /// else already holds it (the database was swapped underneath us), and nil makes the table's trigger issue a fresh one.
    private static func restoredUuid(_ db: Database, table: String, _ uuid: String?) throws -> String? {
        guard let uuid else { return nil }
        let held = try Row.fetchOne(db, sql: "SELECT 1 FROM \(table) WHERE uuid = ?", arguments: [uuid]) != nil
        return held ? nil : uuid
    }

    /// The notebook an item was trashed from if it still exists, else the default one (the lowest id).
    private static func survivingNotebookId(_ db: Database, _ notebookId: Int64?) throws -> Int64 {
        if let notebookId, try Row.fetchOne(db, sql: "SELECT 1 FROM notebooks WHERE id = ?", arguments: [notebookId]) != nil {
            return notebookId
        }
        guard let first = try Int64.fetchOne(db, sql: "SELECT MIN(id) FROM notebooks") else { throw TrashError.noNotebooks }
        return first
    }
}
