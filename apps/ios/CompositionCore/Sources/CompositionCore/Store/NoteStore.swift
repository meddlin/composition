import Foundation

// What the app calls to change notes, groups and notebooks: the data operations of the desktop's `service.ts`, one for one,
// on top of the repository ports (NotesStore.swift and its neighbours). Writing a note also keeps the search index in step:
// the one place the repositories don't reach.
//
// Indexing is derived state, as on the desktop (docs/architecture/search.md): a failure to index must never fail or roll back a
// write, so it is logged and swallowed, and a stale index is repaired by `rebuildIfStale` on the next launch. The index is only
// marked as matching the notes when it matched them before the write; one that was already stale stays marked stale.

public final class NoteStore: Sendable {
    public let database: CompositionDatabase
    private let search: SearchIndex?

    public init(database: CompositionDatabase, search: SearchIndex? = nil) {
        self.database = database
        self.search = search
    }

    // MARK: Notes

    public func createNote(title: String, groupId: Int64? = nil, notebookId: Int64? = nil, now: Date = Date()) throws -> NoteDetail {
        try write({ try database.createNote(title: title, groupId: groupId, notebookId: notebookId, now: now) }) { index, note in
            try index.upsert([Self.indexed(note)])
        }
    }

    /// Saves what the editor holds (see `CompositionDatabase.saveNoteContent`) and re-indexes the note.
    public func saveNoteContent(id: Int64, content: String, now: Date = Date()) throws -> NoteDetail {
        try write({ try database.saveNoteContent(id: id, content: content, now: now) }) { index, note in
            try index.upsert([Self.indexed(note)])
        }
    }

    /// Moves the note to the Trash Can rather than erasing it. It leaves the search index straight away, and comes back into
    /// it if restored.
    public func deleteNote(id: Int64, now: Date = Date()) throws {
        try write({ try database.trashNote(id: id, now: now) }) { index, _ in try index.remove(ids: [id]) }
    }

    public func restoreNote(id: Int64) throws -> RestoreResult? {
        try write({ try database.restoreNote(id: id) }) { index, restored in
            guard restored != nil else { return }
            if let note = try database.note(id: id) {
                try index.upsert([Self.indexed(note)])
            } else {
                // The note came back under a new id (its own was taken), so there is nothing to add by the old one: start the index over.
                try index.rebuild(from: database)
            }
        }
    }

    public func moveNote(id: Int64, toGroup groupId: Int64?) throws -> NoteDetail {
        try database.setNoteGroup(id: id, groupId: groupId)
    }

    public func placeNote(id: Int64, groupId: Int64?, before beforeId: Int64?) throws -> NoteDetail {
        try database.placeNote(id: id, groupId: groupId, before: beforeId)
    }

    // MARK: Groups

    public func createGroup(name: String, parentId: Int64? = nil, notebookId: Int64? = nil, now: Date = Date()) throws -> NoteGroup {
        try database.createGroup(name: name, parentId: parentId, notebookId: notebookId, now: now)
    }

    public func renameGroup(id: Int64, name: String, now: Date = Date()) throws -> NoteGroup {
        try database.renameGroup(id: id, name: name, now: now)
        return try existing(database.group(id: id), "Group \(id)")
    }

    /// Moves the group to the Trash Can. Refuses (`TrashError.groupNotEmpty`) while it has sub-groups or notes.
    public func deleteGroup(id: Int64, now: Date = Date()) throws {
        try database.trashGroup(id: id, now: now)
    }

    public func restoreGroup(id: Int64) throws -> RestoreResult? {
        try database.restoreGroup(id: id)
    }

    /// Reparents a group; refuses (`StoreError.invalidGroupMove`) a move into itself or a descendant, or of a group that is gone.
    public func moveGroup(id: Int64, parentId: Int64?, now: Date = Date()) throws -> NoteGroup {
        try database.moveGroup(id: id, parentId: parentId, now: now)
        return try existing(database.group(id: id), "Group \(id)")
    }

    public func moveGroupToNotebook(id: Int64, notebookId: Int64, now: Date = Date()) throws -> NoteGroup {
        try database.moveGroupToNotebook(id: id, notebookId: notebookId, now: now)
        return try existing(database.group(id: id), "Group \(id)")
    }

    public func placeGroup(id: Int64, parentId: Int64?, before beforeId: Int64?, now: Date = Date()) throws -> NoteGroup {
        try database.placeGroup(id: id, parentId: parentId, before: beforeId, now: now)
        return try existing(database.group(id: id), "Group \(id)")
    }

    // MARK: Notebooks

    public func createNotebook(name: String, now: Date = Date()) throws -> Notebook {
        try database.createNotebook(name: name, now: now)
    }

    public func renameNotebook(id: Int64, name: String, now: Date = Date()) throws -> Notebook {
        try database.renameNotebook(id: id, name: name, now: now)
        return try existing(database.notebook(id: id), "Notebook \(id)")
    }

    /// Puts a notebook before another (last when `beforeId` is nil) and returns the notebooks in their new order.
    public func placeNotebook(id: Int64, before beforeId: Int64?) throws -> [Notebook] {
        try database.placeNotebook(id: id, before: beforeId)
        return try database.listNotebooks()
    }

    /// Deletes an empty notebook; refuses the last one (`StoreError.lastNotebook`) and one with anything in it (`notebookNotEmpty`).
    public func deleteNotebook(id: Int64) throws {
        try database.deleteNotebook(id: id)
    }

    // MARK: Keeping the index in step

    private static func indexed(_ note: NoteDetail) -> IndexedNote {
        IndexedNote(id: note.id, title: note.title, description: note.description, content: note.content, tags: note.tags, createdAt: note.createdAt, updatedAt: note.updatedAt)
    }

    private func existing<T>(_ value: T?, _ what: String) throws -> T {
        guard let value else { throw StoreError.notFound(what) }
        return value
    }

    /// Runs `change`, then `reindex`, and marks the index as matching the notes if it did before. The write's own errors
    /// are thrown; the index's are logged.
    private func write<T>(_ change: () throws -> T, reindex: (SearchIndex, T) throws -> Void) throws -> T {
        let wasCurrent = (try? search?.isCurrent(with: database)) ?? false
        let result = try change()
        if let search {
            do {
                try reindex(search, result)
                if wasCurrent { try search.markCurrent(with: database) }
            } catch {
                NSLog("[search] indexing failed: \(error)")
            }
        }
        return result
    }
}
