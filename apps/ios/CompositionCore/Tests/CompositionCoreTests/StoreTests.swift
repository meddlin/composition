import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The store without the desktop at hand: the rules in plain words, and the search index that follows the writes. Every
// operation is checked against the desktop's real code in StoreConformanceTests.

@Suite("Store: notes, groups and notebooks")
struct StoreTests {
    private func open(_ scratch: Scratch, indexed: Bool = false) throws -> (store: NoteStore, database: CompositionDatabase, index: SearchIndex?) {
        let database = try CompositionDatabase.open(at: scratch.databaseURL)
        let index = indexed ? try SearchIndex.open(at: scratch.directory.appendingPathComponent("search.db")) : nil
        try index?.rebuildIfStale(from: database)
        return (NoteStore(database: database, search: index), database, index)
    }

    // MARK: Rules

    @Test("an item dropped before a sibling lands there, before nothing lands last, and before itself stays put")
    func placeBefore() {
        #expect(Ordering.placeBefore([1, 2, 3], 3, before: 1) == [3, 1, 2])
        #expect(Ordering.placeBefore([1, 2, 3], 1, before: nil) == [2, 3, 1])
        #expect(Ordering.placeBefore([1, 2, 3], 2, before: 2) == [1, 2, 3])
        #expect(Ordering.placeBefore([1, 2, 3], 9, before: 2) == [1, 9, 2, 3], "a move from another group adds it")
        #expect(Ordering.placeBefore([1, 2, 3], 2, before: 99) == [1, 3, 2], "a sibling that is gone means last")
        #expect(Ordering.placeBefore([1, 2], 9, before: 9) == [1, 2, 9])
    }

    @Test("a group cannot move into itself or beneath its own descendants")
    func cycles() {
        let parents: [Int64: Int64?] = [1: nil, 2: 1, 3: 2, 4: nil]
        #expect(GroupMove.wouldCreateCycle(parents, id: 1, newParentId: 3))
        #expect(GroupMove.wouldCreateCycle(parents, id: 1, newParentId: 1))
        #expect(!GroupMove.wouldCreateCycle(parents, id: 3, newParentId: 4))
        #expect(!GroupMove.wouldCreateCycle(parents, id: 3, newParentId: nil))
        #expect(!GroupMove.wouldCreateCycle(parents, id: 2, newParentId: 1), "the parent it already has")
    }

    // MARK: Notes

    @Test("a new note has frontmatter, a notebook, and a group's notebook wins")
    func newNote() throws {
        try withScratch { scratch in
            let (store, database, _) = try open(scratch)
            defer { try? database.close() }
            let other = try store.createNotebook(name: "Other")
            let group = try store.createGroup(name: "G", notebookId: other.id)
            let first = try store.createNote(title: "Plain")
            let inGroup = try store.createNote(title: "In a group", groupId: group.id, notebookId: first.notebookId)
            #expect(first.notebookId == (try database.defaultNotebookId()) && first.groupId == nil)
            #expect(inGroup.notebookId == other.id && inGroup.groupId == group.id)
            #expect(first.content.hasPrefix("---\ntitle: Plain\ndescription: ''\ntags: []\ncreatedAt: "))
            #expect(isUuid(first.uuid) && first.createdAt == first.updatedAt)
        }
    }

    @Test("an imported text goes under frontmatter made from its name, or keeps its own, and is found by search")
    func importing() throws {
        try withScratch { scratch in
            let (store, database, index) = try open(scratch, indexed: true)
            defer { try? database.close() }
            let group = try store.createGroup(name: "Inbox")
            let plain = try store.importNote(named: "Trip plan", text: "# Packing\n\nSocks and a zebracorn.\n", groupId: group.id)
            #expect(plain.title == "Trip plan" && plain.groupId == group.id)
            #expect(plain.content.hasPrefix("---\ntitle: Trip plan\n") && plain.content.hasSuffix("---\n# Packing\n\nSocks and a zebracorn.\n"))
            #expect(try index!.search("zebracorn") == [plain.id], "the index follows")

            let own = "---\ntitle: Own title\ndescription: d\ntags:\n- one\ncreatedAt: 2026-01-02\nupdatedAt: 2026-01-02\n---\nBody\n"
            let kept = try store.importNote(named: "file-name", text: own)
            #expect(kept.title == "Own title" && kept.tags == "one" && kept.description == "d" && kept.groupId == nil)
            #expect(kept.content.contains("Body\n") && kept.content.hasPrefix("---\ntitle: Own title\n"))
            #expect(kept.content.contains("createdAt: 2026-01-02"), "the file's own creation date stays in its frontmatter (the column keeps the time the note was made here)")
        }
    }

    @Test("saving rewrites the frontmatter and keeps the columns in step; a bad block leaves them alone")
    func saving() throws {
        try withScratch { scratch in
            let (store, database, _) = try open(scratch)
            defer { try? database.close() }
            let note = try store.createNote(title: "Original")

            let saved = try store.saveNoteContent(id: note.id, content: "---\ntitle: Renamed\ndescription: Short\ntags: one, two\n---\n# Body\n")
            #expect(saved.title == "Renamed" && saved.description == "Short" && saved.tags == "one,two")
            #expect(saved.content.hasPrefix("---\ntitle: Renamed\ndescription: Short\ntags:\n- one\n- two\ncreatedAt: "))
            #expect(saved.content.hasSuffix("---\n# Body\n"))

            let typing = try store.saveNoteContent(id: note.id, content: "---\ntitle: [half typed\n---\n# Body\n")
            #expect(typing.title == "Renamed" && typing.tags == "one,two", "the columns wait for the block to parse again")
            #expect(typing.content.contains("[half typed"), "and the text is kept exactly as typed")

            let blank = try store.saveNoteContent(id: note.id, content: "---\ntitle: ''\n---\nx\n")
            #expect(blank.title == "Renamed", "an empty title keeps the old one")
            #expect(throws: StoreError.notFound("Note 999")) { try store.saveNoteContent(id: 999, content: "x") }
        }
    }

    @Test("moving a note keeps its time; placing puts it in order among its siblings")
    func moving() throws {
        try withScratch { scratch in
            let (store, database, _) = try open(scratch)
            defer { try? database.close() }
            let group = try store.createGroup(name: "G")
            let a = try store.createNote(title: "A", groupId: group.id)
            let b = try store.createNote(title: "B", groupId: group.id)
            let c = try store.createNote(title: "C")

            let moved = try store.moveNote(id: c.id, toGroup: group.id)
            #expect(moved.groupId == group.id && moved.updatedAt == c.updatedAt, "a move is not an edit")

            _ = try store.placeNote(id: c.id, groupId: group.id, before: a.id)
            _ = try store.placeNote(id: b.id, groupId: group.id, before: nil)
            let order = try database.notesInDisplayOrder().filter { $0.groupId == group.id }.map(\.id)
            #expect(order == [c.id, a.id, b.id])
        }
    }

    // MARK: Groups and notebooks

    @Test("groups follow their parent's notebook, refuse a loop, and move whole into another notebook")
    func groups() throws {
        try withScratch { scratch in
            let (store, database, _) = try open(scratch)
            defer { try? database.close() }
            let work = try store.createNotebook(name: "Work")
            let top = try store.createGroup(name: "Top", notebookId: work.id)
            let sub = try store.createGroup(name: "Sub", parentId: top.id)
            let note = try store.createNote(title: "Deep", groupId: sub.id)
            #expect(sub.notebookId == work.id && note.notebookId == work.id)

            #expect(throws: StoreError.invalidGroupMove("Group \(top.id) cannot be moved into itself or one of its sub-groups.")) {
                try store.moveGroup(id: top.id, parentId: sub.id)
            }
            let archive = try store.createNotebook(name: "Archive")
            let moved = try store.moveGroupToNotebook(id: top.id, notebookId: archive.id)
            #expect(moved.notebookId == archive.id)
            #expect(try database.group(id: sub.id)?.notebookId == archive.id)
            #expect(try database.note(id: note.id)?.notebookId == archive.id, "the notes in it go along")
        }
    }

    @Test("the last notebook stays, and a notebook with anything in it cannot be deleted")
    func deletingNotebooks() throws {
        try withScratch { scratch in
            let (store, database, _) = try open(scratch)
            defer { try? database.close() }
            let first = try database.defaultNotebookId()
            let second = try store.createNotebook(name: "Second")
            _ = try store.createGroup(name: "G", notebookId: second.id)
            #expect(throws: StoreError.notebookNotEmpty(second.id)) { try store.deleteNotebook(id: second.id) }
            let empty = try store.createNotebook(name: "Empty")
            try store.deleteNotebook(id: empty.id)
            #expect(try database.listNotebooks().map(\.id) == [first, second.id])

            try database.pool.write { try $0.execute(sql: "DELETE FROM groups") }
            try store.deleteNotebook(id: second.id)
            #expect(throws: StoreError.lastNotebook) { try store.deleteNotebook(id: first) }
        }
    }

    @Test("a group with notes cannot go to the Trash Can, and comes back when it can")
    func trashingGroups() throws {
        try withScratch { scratch in
            let (store, database, _) = try open(scratch)
            defer { try? database.close() }
            let group = try store.createGroup(name: "G")
            let note = try store.createNote(title: "N", groupId: group.id)
            #expect(throws: TrashError.groupNotEmpty(group.id)) { try store.deleteGroup(id: group.id) }
            try store.deleteNote(id: note.id)
            try store.deleteGroup(id: group.id)
            #expect(try store.restoreGroup(id: group.id) == RestoreResult(restoredToTopLevel: false))
            #expect(try store.restoreGroup(id: group.id) == nil, "once only")
        }
    }

    // MARK: Search

    @Test("the search index follows creating, saving, deleting and restoring, and stays marked as current")
    func indexFollows() throws {
        try withScratch { scratch in
            let (store, database, index) = try open(scratch, indexed: true)
            defer { try? index?.close(); try? database.close() }
            let search = try #require(index)

            let note = try store.createNote(title: "Zeppelin")
            #expect(try search.search("zeppelin") == [note.id])

            _ = try store.saveNoteContent(id: note.id, content: "---\ntitle: Zeppelin\ndescription: ''\n---\nA dirigible over the harbour\n")
            #expect(try search.search("dirigible") == [note.id])

            try store.deleteNote(id: note.id)
            #expect(try search.search("zeppelin").isEmpty && search.isCurrent(with: database))

            _ = try store.restoreNote(id: note.id)
            #expect(try search.search("dirigible") == [note.id])
            #expect(try !search.rebuildIfStale(from: database), "nothing changed behind the index's back")
        }
    }

    @Test("an index that was already stale is not blessed by a write")
    func staleStaysStale() throws {
        try withScratch { scratch in
            let (store, database, index) = try open(scratch, indexed: true)
            defer { try? index?.close(); try? database.close() }
            let search = try #require(index)

            // A note arrives some way other than through the store (a restore does this).
            try database.pool.write { db in
                let now = Timestamp.now()
                try db.execute(sql: "INSERT INTO notes (title, content, created_at, updated_at, notebook_id) VALUES ('Sideways', 'sideways', ?, ?, 1)", arguments: [now, now])
            }
            _ = try store.createNote(title: "Through the store")
            #expect(try !search.isCurrent(with: database))
            #expect(try search.rebuildIfStale(from: database), "so the next launch repairs it")
            #expect(try search.search("sideways").count == 1)
        }
    }

    @Test("a broken index never fails a write")
    func brokenIndex() throws {
        try withScratch { scratch in
            let (store, database, index) = try open(scratch, indexed: true)
            defer { try? database.close() }
            try index?.close()
            let note = try store.createNote(title: "Still saved")
            #expect(try database.note(id: note.id)?.title == "Still saved")
        }
    }
}
