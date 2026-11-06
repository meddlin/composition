import Foundation
import GRDB

// Notes: a port of `notesRepo.ts`, plus the reconciling `saveNoteContent` of `service.ts` (which keeps the title, tags and
// description columns in step with the frontmatter a person is typing). Same SQL as the desktop; see NotebooksStore.swift.

extension CompositionDatabase {
    /// Notes nobody has dragged into place (`position` NULL, which includes every new note) come first, most recently edited
    /// first; hand-placed ones follow in their set order.
    static let noteDisplayOrder = "position IS NOT NULL, position, updated_at DESC, id DESC"

    static let noteColumns = "id, uuid, title, description, content, tags, notebook_id, group_id, created_at, updated_at"

    /// Every note without its text, in the order the sidebar shows them (`listNotes` of `notesRepo.ts`).
    public func notesInDisplayOrder() throws -> [NoteSummary] {
        try pool.read { db in
            try NoteSummary.fetchAll(
                db,
                sql: """
                    SELECT id, uuid, title, tags, notebook_id, group_id, created_at, updated_at
                    FROM notes ORDER BY \(Self.noteDisplayOrder)
                    """)
        }
    }

    /// A new note with frontmatter made from the title and tags. A note in a group is in the group's notebook, whatever the
    /// caller thought.
    @discardableResult
    public func createNote(title: String, tags: String = "", groupId: Int64? = nil, notebookId: Int64? = nil, now: Date = Date()) throws -> NoteDetail {
        try pool.write { db in
            let stamp = Timestamp.now(now)
            let content = NoteFrontmatter.generate(title: title, createdAt: stamp, updatedAt: stamp, tags: NoteFrontmatter.tagsFromString(tags))
            let group = try groupId.flatMap { try Self.fetchGroup(db, $0) }
            let inNotebook = try group?.notebookId ?? notebookId ?? Self.defaultNotebookId(db)
            try db.execute(
                sql: """
                    INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id, notebook_id)
                    VALUES (?, ?, ?, '', ?, ?, ?, ?)
                    """,
                arguments: [title, content, tags, stamp, stamp, groupId, inNotebook])
            guard let note = try Self.fetchNote(db, db.lastInsertedRowID) else { throw StoreError.notFound("The note that was just created") }
            return note
        }
    }

    /// Fallback path: content and `updated_at` only, title, tags and description untouched.
    public func updateNoteContent(id: Int64, content: String, now: Date = Date()) throws {
        try pool.write { try $0.execute(sql: "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", arguments: [content, Timestamp.now(now), id]) }
    }

    /// Full-sync path: content plus the columns synced from parsed frontmatter.
    public func updateNote(id: Int64, content: String, title: String, tags: String, description: String, now: Date = Date()) throws {
        try pool.write { db in
            try db.execute(
                sql: "UPDATE notes SET content = ?, title = ?, tags = ?, description = ?, updated_at = ? WHERE id = ?",
                arguments: [content, title, tags, description, Timestamp.now(now), id])
        }
    }

    /// Saves what the editor holds: parses whatever frontmatter is being typed and reconciles it back into the note's columns,
    /// without ever failing on a mid-edit YAML block. A block that does not parse leaves the title, tags and description as
    /// they were. An empty title keeps the old one, and the frontmatter is rewritten the way the desktop writes it.
    @discardableResult
    public func saveNoteContent(id: Int64, content: String, now: Date = Date()) throws -> NoteDetail {
        try pool.write { db in
            let stamp = Timestamp.now(now)
            let (parsed, body) = NoteFrontmatter.parse(content)
            if let parsed {
                guard let previous = try Self.fetchNote(db, id) else { throw StoreError.notFound("Note \(id)") }
                let reconciled = Frontmatter(
                    title: parsed.title.isEmpty ? previous.title : parsed.title,
                    description: parsed.description,
                    tags: parsed.tags,
                    createdAt: parsed.createdAt.isEmpty ? previous.createdAt : parsed.createdAt,
                    updatedAt: stamp,
                    headerImage: parsed.headerImage)
                try db.execute(
                    sql: "UPDATE notes SET content = ?, title = ?, tags = ?, description = ?, updated_at = ? WHERE id = ?",
                    arguments: [NoteFrontmatter.render(reconciled, body: body), reconciled.title, NoteFrontmatter.tagsToString(reconciled.tags), reconciled.description, stamp, id])
            } else {
                try db.execute(sql: "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", arguments: [content, stamp, id])
            }
            guard let note = try Self.fetchNote(db, id) else { throw StoreError.notFound("Note \(id)") }
            return note
        }
    }

    /// Doesn't bump `updated_at`: a move isn't a content edit, and bumping it would reorder the note just from moving it. Clears
    /// the note's hand-set position, which no longer means anything among new siblings. Into a group means into its notebook;
    /// ungrouped, the note stays in the one it is in.
    @discardableResult
    public func setNoteGroup(id: Int64, groupId: Int64?) throws -> NoteDetail {
        try pool.write { db in
            try db.execute(
                sql: """
                    UPDATE notes SET group_id = ?, position = NULL,
                      notebook_id = COALESCE((SELECT notebook_id FROM groups WHERE id = ?), notebook_id)
                    WHERE id = ?
                    """,
                arguments: [groupId, groupId, id])
            guard let note = try Self.fetchNote(db, id) else { throw StoreError.notFound("Note \(id)") }
            return note
        }
    }

    /// Puts a note in `groupId` immediately before the sibling `beforeId` (last when nil) and fixes the whole sibling list's
    /// order, so what the user sees is what stays. Like `setNoteGroup`, it isn't a content edit.
    @discardableResult
    public func placeNote(id: Int64, groupId: Int64?, before beforeId: Int64?) throws -> NoteDetail {
        try pool.write { db in
            guard try Self.fetchNote(db, id) != nil else { throw StoreError.notFound("Note \(id)") }
            let group = try groupId.flatMap { try Self.fetchGroup(db, $0) }
            let notebookId: Int64?
            if let groupNotebook = group?.notebookId {
                notebookId = groupNotebook
            } else {
                notebookId = try Int64.fetchOne(db, sql: "SELECT notebook_id FROM notes WHERE id = ?", arguments: [id])
            }
            let siblings = try Int64.fetchAll(
                db, sql: "SELECT id FROM notes WHERE group_id IS ? AND notebook_id IS ? ORDER BY \(Self.noteDisplayOrder)",
                arguments: [groupId, notebookId])
            let ordered = Ordering.placeBefore(siblings, id, before: beforeId)
            try db.execute(sql: "UPDATE notes SET group_id = ?, notebook_id = ? WHERE id = ?", arguments: [groupId, notebookId, id])
            for (index, noteId) in ordered.enumerated() {
                try db.execute(sql: "UPDATE notes SET position = ? WHERE id = ?", arguments: [index, noteId])
            }
            guard let note = try Self.fetchNote(db, id) else { throw StoreError.notFound("Note \(id)") }
            return note
        }
    }

    // MARK: Inside a transaction

    static func fetchNote(_ db: Database, _ id: Int64) throws -> NoteDetail? {
        try NoteDetail.fetchOne(db, sql: "SELECT \(noteColumns) FROM notes WHERE id = ?", arguments: [id])
    }
}
