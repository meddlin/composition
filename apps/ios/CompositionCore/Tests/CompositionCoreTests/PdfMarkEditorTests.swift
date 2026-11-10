import Foundation
import Testing

@testable import CompositionCore

// Undo and redo of a PDF's marks, as the desktop's `documentMarks.ts` has them: create, delete and change are steps, 200 deep, in memory; a new change
// ends redo; undoing a delete brings the mark back with its uuid.

@Suite("Undo and redo of a PDF's marks")
struct PdfMarkEditorTests {
    private func with(_ body: (PdfMarkEditor, CompositionDatabase) async throws -> Void) async throws {
        let scratch = try Scratch()
        defer { scratch.remove() }
        let database = try CompositionDatabase.open(at: scratch.databaseURL)
        defer { try? database.close() }
        let store = NoteStore(database: database)
        let note = try store.createNote(title: "Book")
        let document = try database.addDocument(noteId: note.id, fileName: "b.pdf", storedName: "aaaaaaaaaaaa-b.pdf", sha256: String(repeating: "a", count: 64), size: 1, pageCount: 30)
        try await body(PdfMarkEditor(store: store, documentId: document.id), database)
    }

    private func highlight(_ page: Int = 0, _ quote: String = "words") -> PdfMarkInput {
        PdfMarkInput(page: page, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 72, y0: 700, x1: 300, y1: 714)], quote: quote)
    }

    @Test("a mark made can be undone and redone, and comes back as the same mark")
    func createAndUndo() async throws {
        try await with { editor, _ in
            var state = try await editor.state
            #expect(state.marks.isEmpty && !state.canUndo && !state.canRedo)
            state = try await editor.add([highlight()])
            let made = try #require(state.marks.first)
            #expect(state.canUndo && !state.canRedo)
            state = try await editor.undo()
            #expect(state.marks.isEmpty && !state.canUndo && state.canRedo)
            state = try await editor.redo()
            #expect(state.marks == [made], "the same uuid, id and times")
            #expect(state.canUndo && !state.canRedo)
        }
    }

    @Test("a deleted mark comes back with its uuid, so a note's citation of it works again")
    func deleteAndUndo() async throws {
        try await with { editor, _ in
            let made = try #require(try await editor.add([highlight(1), highlight(2)]).marks.first)
            var state = try await editor.delete(id: made.id)
            #expect(state.marks.isEmpty, "a selection over two pages goes as one")
            state = try await editor.undo()
            #expect(state.marks.count == 2 && state.marks[0].uuid == made.uuid && state.marks[0].groupUuid == state.marks[1].groupUuid)
            state = try await editor.undo()
            #expect(state.marks.isEmpty, "the undo before that took back the making")
            state = try await editor.redo()
            #expect(state.marks.count == 2)
            state = try await editor.redo()
            #expect(state.marks.isEmpty, "and the delete is done again")
        }
    }

    @Test("a recoloured mark, a new comment and a retyped note are undone and redone")
    func changes() async throws {
        try await with { editor, _ in
            var state = try await editor.add([highlight()])
            let id = state.marks[0].id
            state = try await editor.update(id: id, changes: PdfMarkChanges(color: "blue"))
            state = try await editor.update(id: id, changes: PdfMarkChanges(comment: "check this"))
            #expect(state.marks[0].color == "blue" && state.marks[0].comment == "check this")
            state = try await editor.undo()
            #expect(state.marks[0].color == "blue" && state.marks[0].comment == "")
            state = try await editor.undo()
            #expect(state.marks[0].color == "yellow")
            state = try await editor.redo()
            state = try await editor.redo()
            #expect(state.marks[0].color == "blue" && state.marks[0].comment == "check this")

            let note = PdfTextNoteBody(rect: PdfRect(x0: 100, y0: 100, x1: 300, y1: 156), text: "first", fontSize: 12)
            state = try await editor.add([PdfMarkInput(page: 3, kind: .text, color: "pink", body: note.json)])
            let noteId = try #require(state.marks.last { $0.kind == .text }?.id)
            var retyped = note
            retyped.text = "second"
            state = try await editor.update(id: noteId, changes: PdfMarkChanges(body: retyped.json))
            #expect(state.marks.last { $0.kind == .text }?.textNote?.text == "second")
            state = try await editor.undo()
            #expect(state.marks.last { $0.kind == .text }?.textNote?.text == "first")
            state = try await editor.redo()
            #expect(state.marks.last { $0.kind == .text }?.textNote?.text == "second")
        }
    }

    @Test("a change that changes nothing is no step, and a new change ends redo")
    func noOpAndRedoEnds() async throws {
        try await with { editor, _ in
            var state = try await editor.add([highlight()])
            let id = state.marks[0].id
            state = try await editor.update(id: id, changes: PdfMarkChanges(color: "yellow"))
            state = try await editor.undo()
            #expect(state.marks.isEmpty, "the first undo took back the making: the colour 'change' was not a step")
            #expect(state.canRedo)
            state = try await editor.add([highlight(5)])
            #expect(!state.canRedo, "a new mark ends redo")
            state = try await editor.redo()
            #expect(state.marks.count == 1, "redo with nothing to redo does nothing")
        }
    }

    @Test("only the last 200 steps are kept")
    func depth() async throws {
        try await with { editor, _ in
            var state = try await editor.state
            for page in 0..<(PdfMarkEditor.depth + 10) { state = try await editor.add([highlight(page % 30)]) }
            #expect(state.marks.count == PdfMarkEditor.depth + 10)
            for _ in 0..<(PdfMarkEditor.depth + 50) { state = try await editor.undo() }
            #expect(state.marks.count == 10 && !state.canUndo, "200 were taken back and the earlier 10 stay")
        }
    }

    @Test("a refused mark makes no step, and a missing mark is not an error")
    func refusals() async throws {
        try await with { editor, _ in
            await #expect(throws: InvalidMarkError.self) { try await editor.add([PdfMarkInput(page: 0, kind: .highlight, color: "plaid", rects: [PdfRect(x0: 1, y0: 1, x1: 9, y1: 9)])]) }
            await #expect(throws: InvalidMarkError.self) { try await editor.add([highlight(99)]) }
            var state = try await editor.state
            #expect(state.marks.isEmpty && !state.canUndo)
            state = try await editor.delete(id: 12345)
            #expect(!state.canUndo)
        }
    }
}
