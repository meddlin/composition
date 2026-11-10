import Foundation
import GRDB
import Testing

@testable import CompositionCore

// What the corpus (fixtures/conformance/pdf) does not pin, checked against what the desktop's functions do: undo of a delete
// (`restoreAnnotations`), the words a PDF's note is found by (`marksSearchText`), the notes that cite a PDF, and the search index keeping
// in step with the marks (`searchIndex.ts`'s `noteToDocument`, `service.ts`'s `reindexOwnerSoon`).

@Suite("A PDF's marks: undo, search and citations")
struct PdfMarkupStoreTests {
    private struct World {
        let database: CompositionDatabase
        let index: SearchIndex
        let store: NoteStore
        let note: NoteDetail
        let document: StoredDocument
        let scratch: Scratch

        init() throws {
            scratch = try Scratch()
            database = try CompositionDatabase.open(at: scratch.databaseURL)
            index = try SearchIndex.open(at: scratch.directory.appendingPathComponent("search.db"))
            store = NoteStore(database: database, search: index)
            note = try store.createNote(title: "Designing Data")
            document = try database.addDocument(noteId: note.id, fileName: "dd.pdf", storedName: "aaaaaaaaaaaa-dd.pdf", sha256: String(repeating: "a", count: 64), size: 10, pageCount: 20)
            try index.rebuild(from: database)
        }

        func finish() {
            try? database.close()
            try? index.close()
            scratch.remove()
        }

        func highlight(page: Int = 0, quote: String = "", comment: String = "", color: String = "yellow") -> PdfMarkInput {
            PdfMarkInput(page: page, kind: .highlight, color: color, rects: [PdfRect(x0: 72, y0: 700, x1: 300, y1: 714)], quote: quote, comment: comment)
        }

        func textNote(page: Int = 0, _ text: String) -> PdfMarkInput {
            PdfMarkInput(
                page: page, kind: .text, color: "yellow",
                body: PdfTextNoteBody(rect: PdfRect(x0: 400, y0: 600, x1: 560, y1: 656), text: text, fontSize: 12).json)
        }
    }

    private func with(_ body: (World) throws -> Void) throws {
        let world = try World()
        defer { world.finish() }
        try body(world)
    }

    // MARK: Undo of a delete

    @Test("a deleted mark comes back with its uuid, id, group and times, and a second restore does nothing")
    func restore() throws {
        try with { w in
            let made = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(page: 1, quote: "alpha"), w.highlight(page: 2, quote: "beta")], now: Date(timeIntervalSince1970: 1_000))
            #expect(made.count == 2 && made[0].groupUuid != nil && made[0].groupUuid == made[1].groupUuid)
            let removed = try w.store.deleteAnnotation(id: made[0].id)
            #expect(removed.count == 2, "a selection that crossed pages goes as one")
            #expect(try w.database.annotations(documentId: w.document.id).isEmpty)

            let back = try w.store.restoreAnnotations(documentId: w.document.id, removed)
            #expect(back == made, "exactly as they were: uuid, id, group, times")
            #expect(try w.database.annotations(documentId: w.document.id) == made)
            #expect(try w.store.restoreAnnotations(documentId: w.document.id, removed) == made, "asking twice does no harm")
            #expect(try w.database.annotations(documentId: w.document.id).count == 2)
        }
    }

    @Test("a restored mark takes a new id when its own was taken, and keeps its uuid")
    func restoreWhenIdIsTaken() throws {
        try with { w in
            let first = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(quote: "one")])[0]
            try w.store.deleteAnnotation(id: first.id)
            // The table is AUTOINCREMENT, so the id is not reused; force the clash by putting another mark on it.
            try w.database.pool.write {
                try $0.execute(
                    sql: "INSERT INTO pdf_annotations (id, document_id, page, kind, color, rects, quote, comment, created_at, updated_at) VALUES (?, ?, 0, 'highlight', 'green', '[[1,1,2,2]]', 'other', '', 't', 't')",
                    arguments: [first.id, w.document.id])
            }
            let back = try w.store.restoreAnnotations(documentId: w.document.id, [first])
            #expect(back.count == 1 && back[0].uuid == first.uuid && back[0].id != first.id)
        }
    }

    @Test("a restore is checked like a new mark, and all of it or none is put back")
    func restoreIsChecked() throws {
        try with { w in
            let good = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(page: 1, quote: "good")])[0]
            try w.store.deleteAnnotation(id: good.id)
            var badUuid = good
            badUuid.uuid = "NOT-A-UUID"
            #expect(throws: InvalidMarkError.self) { try w.store.restoreAnnotations(documentId: w.document.id, [badUuid]) }
            var noTimes = good
            noTimes.createdAt = ""
            #expect(throws: InvalidMarkError.self) { try w.store.restoreAnnotations(documentId: w.document.id, [noTimes]) }
            var pastTheEnd = good
            pastTheEnd.page = 20
            #expect(throws: InvalidMarkError.self) { try w.store.restoreAnnotations(documentId: w.document.id, [good, pastTheEnd]) }
            #expect(try w.database.annotations(documentId: w.document.id).isEmpty, "the good one was not put back alone")
        }
    }

    // MARK: The words a PDF's note is found by

    @Test("quotes, comments, text notes and bookmark labels, one a line, by page, as the desktop reads them")
    func marksText() throws {
        try with { w in
            _ = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(page: 3, quote: " later quote ", comment: "second comment")])
            _ = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(page: 1, quote: "B-tree", comment: "see chapter 3")])
            _ = try w.store.addAnnotations(documentId: w.document.id, [w.textNote(page: 2, "remember this")])
            _ = try w.store.addAnnotations(documentId: w.document.id, [PdfMarkInput(page: 4, kind: .underline, color: "blue", rects: [PdfRect(x0: 1, y0: 1, x1: 9, y1: 9)], quote: "   ")])
            _ = try w.store.addBookmark(documentId: w.document.id, page: 5, label: "Replication")
            _ = try w.store.addBookmark(documentId: w.document.id, page: 6)
            let words = try #require(try w.database.marksSearchText(noteId: w.note.id)[w.note.id])
            #expect(words == "B-tree\nsee chapter 3\nremember this\nlater quote\nsecond comment\nReplication")
            #expect(try w.database.marksSearchText()[w.note.id] == words, "every owner note's, for a rebuild, is the same")
        }
    }

    @Test("a note with no marks has no entry; a damaged text-note body has no words")
    func noWords() throws {
        try with { w in
            #expect(try w.database.marksSearchText().isEmpty)
            let other = try w.store.createNote(title: "Other")
            #expect(try w.database.marksSearchText(noteId: other.id).isEmpty)
            let mark = try w.store.addAnnotations(documentId: w.document.id, [w.textNote("fine")])[0]
            try w.database.pool.write { try $0.execute(sql: "UPDATE pdf_annotations SET body = '{not json' WHERE id = ?", arguments: [mark.id]) }
            #expect(try w.database.marksSearchText().isEmpty)
        }
    }

    // MARK: Search

    @Test("searching for a word in a highlight finds the PDF's note, and not before or after the mark exists")
    func searchFindsTheOwner() throws {
        try with { w in
            #expect(try w.index.search("replication").isEmpty)
            let mark = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(page: 2, quote: "Replication keeps copies of the same data on several machines", comment: "leader and follower")])[0]
            #expect(try w.index.search("replication") == [w.note.id], "a word in the quote")
            #expect(try w.index.search("follower") == [w.note.id], "a word in the comment")
            #expect(try w.index.search("designing") == [w.note.id], "its own title still finds it")

            _ = try w.store.updateAnnotation(id: mark.id, changes: PdfMarkChanges(comment: "quorum reads"))
            #expect(try w.index.search("follower").isEmpty, "a changed comment is searched in its new words")
            #expect(try w.index.search("quorum") == [w.note.id])

            let text = try w.store.addAnnotations(documentId: w.document.id, [w.textNote(page: 4, "Tombstones")])[0]
            #expect(try w.index.search("tombstones") == [w.note.id], "a typed note's words")
            _ = text

            let bookmark = try w.store.addBookmark(documentId: w.document.id, page: 7, label: "Consensus")
            #expect(try w.index.search("consensus") == [w.note.id], "a bookmark's label")
            try w.store.renameBookmark(id: bookmark.id, label: "Raft")
            #expect(try w.index.search("consensus").isEmpty && (try w.index.search("raft")) == [w.note.id])
            try w.store.deleteBookmark(id: bookmark.id)
            #expect(try w.index.search("raft").isEmpty)

            try w.store.deleteAnnotation(id: mark.id)
            #expect(try w.index.search("replication").isEmpty, "a deleted mark is no longer searched")
            try w.store.restoreAnnotations(documentId: w.document.id, [mark])
            #expect(try w.index.search("replication") == [w.note.id], "undoing the delete finds it again, by the words it had when it was deleted")
        }
    }

    @Test("editing the owner note keeps the marks' words in its entry, and a rebuild puts them in")
    func ownerEditsAndRebuilds() throws {
        try with { w in
            _ = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(quote: "linearizable")])
            _ = try w.store.saveNoteContent(id: w.note.id, content: NoteFrontmatter.render(Frontmatter(title: "Designing Data", description: "", tags: [], createdAt: w.note.createdAt, updatedAt: w.note.updatedAt), body: "My own thoughts on storage"))
            #expect(try w.index.search("storage") == [w.note.id])
            #expect(try w.index.search("linearizable") == [w.note.id], "a save does not drop the marks' words")
            try w.index.rebuild(from: w.database)
            #expect(try w.index.search("linearizable") == [w.note.id], "nor does a rebuild")
            try w.store.deleteNote(id: w.note.id)
            #expect(try w.index.search("linearizable").isEmpty, "a note in the Trash Can is not searched, marks and all")
            _ = try w.store.restoreNote(id: w.note.id)
            #expect(try w.index.search("linearizable") == [w.note.id], "restored, it is found by them again")
        }
    }

    @Test("a PDF's note is not found by a word in another PDF's marks")
    func otherPdfs() throws {
        try with { w in
            let second = try w.store.createNote(title: "Second book")
            let other = try w.database.addDocument(noteId: second.id, fileName: "s.pdf", storedName: "bbbbbbbbbbbb-s.pdf", sha256: String(repeating: "b", count: 64), size: 10, pageCount: 5)
            _ = try w.store.addAnnotations(documentId: other.id, [w.highlight(quote: "monads")])
            #expect(try w.index.search("monads") == [second.id])
        }
    }

    // MARK: Which notes cite a PDF

    @Test("the notes that cite a PDF are found by its uuid in their text, owner first")
    func citingNotes() throws {
        try with { w in
            let uuid = w.document.uuid
            let chapter = try w.store.createNote(title: "Chapter 3")
            let mark = try w.store.addAnnotations(documentId: w.document.id, [w.highlight(page: 4, quote: "data outlives code")])[0]
            let text = NoteFrontmatter.render(
                Frontmatter(title: "Chapter 3", description: "", tags: [], createdAt: chapter.createdAt, updatedAt: chapter.updatedAt),
                body: PdfRefs.quoteBlock(uuid: uuid, title: "Designing Data", quote: mark.quote, page: 5, mark: mark.uuid))
            _ = try w.store.saveNoteContent(id: chapter.id, content: text)
            _ = try w.store.createNote(title: "Unrelated")

            let notes = try w.database.notesForPdf(uuid: uuid, ownerNoteId: w.note.id)
            #expect(Set(notes.map(\.id)) == [w.note.id, chapter.id])
            let citations = PdfRefs.citations(among: notes, documentUuid: uuid, ownerNoteId: w.note.id)
            #expect(citations.map(\.noteId) == [w.note.id, chapter.id] && citations[0].owner)
            #expect(citations[1].pages == [5] && citations[1].marks == [mark.uuid])
        }
    }
}
