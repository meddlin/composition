import Foundation
import GRDB
import Testing

@testable import CompositionCore

// Ink on a PDF: one record per page, kept out of the list of marks, out of the words a PDF's note is found by, and gone with the PDF.

@Suite("A PDF's ink")
struct PdfInkStoreTests {
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
            note = try store.createNote(title: "Sketchbook")
            document = try database.addDocument(noteId: note.id, fileName: "s.pdf", storedName: "aaaaaaaaaaaa-s.pdf", sha256: String(repeating: "a", count: 64), size: 10, pageCount: 6)
            try index.rebuild(from: database)
        }

        func finish() {
            try? database.close()
            try? index.close()
            scratch.remove()
        }

        func strokes(_ tag: String) -> String { #"{"format":"composition-ink","version":1,"canvas":{"width":612,"height":792},"strokes":[],"tag":"\#(tag)"}"# }
    }

    private func with(_ body: (World) throws -> Void) throws {
        let world = try World()
        defer { world.finish() }
        try body(world)
    }

    @Test("a page's ink is one record: made, replaced in place, and taken away")
    func oneRecordPerPage() throws {
        try with { w in
            #expect(try w.database.inkPages(documentId: w.document.id).isEmpty)
            #expect(try w.database.inkBody(documentId: w.document.id, page: 2) == nil)

            #expect(try w.store.setInk(documentId: w.document.id, page: 2, body: w.strokes("one")))
            let first = try #require(try w.database.annotations(documentId: w.document.id).first)
            #expect(first.kind == .ink && first.page == 2 && first.rects == nil && first.quote.isEmpty && first.comment.isEmpty)
            #expect(try w.database.inkBody(documentId: w.document.id, page: 2) == w.strokes("one"))

            #expect(try w.store.setInk(documentId: w.document.id, page: 2, body: w.strokes("two"), now: Date(timeIntervalSince1970: 5_000)))
            let all = try w.database.annotations(documentId: w.document.id)
            #expect(all.count == 1, "the second save replaced the first")
            #expect(all[0].id == first.id && all[0].uuid == first.uuid && all[0].createdAt == first.createdAt, "the same record: its uuid and the time it was made stay")
            #expect(all[0].updatedAt != first.updatedAt)
            #expect(try w.database.inkBody(documentId: w.document.id, page: 2) == w.strokes("two"))

            #expect(try w.store.setInk(documentId: w.document.id, page: 4, body: w.strokes("page five")))
            #expect(try w.database.inkPages(documentId: w.document.id).keys.sorted() == [2, 4])

            #expect(try w.store.setInk(documentId: w.document.id, page: 2, body: nil) == false)
            #expect(try w.database.inkPages(documentId: w.document.id).keys.sorted() == [4], "a page with no strokes left has no record")
            #expect(try w.store.setInk(documentId: w.document.id, page: 2, body: nil) == false, "taking away what is not there does nothing")
        }
    }

    @Test("a merge that left two records on a page is healed by the next save: the newest is kept")
    func duplicates() throws {
        try with { w in
            for tag in ["old", "new"] {
                try w.database.pool.write {
                    try $0.execute(
                        sql: "INSERT INTO pdf_annotations (document_id, page, kind, color, quote, comment, body, created_at, updated_at) VALUES (?, 1, 'ink', 'ink', '', '', ?, 't', 't')",
                        arguments: [w.document.id, w.strokes(tag)])
                }
            }
            #expect(try w.database.inkBody(documentId: w.document.id, page: 1) == w.strokes("new"), "reads the newest")
            _ = try w.store.setInk(documentId: w.document.id, page: 1, body: w.strokes("healed"))
            #expect(try w.database.annotations(documentId: w.document.id).count == 1)
            #expect(try w.database.inkBody(documentId: w.document.id, page: 1) == w.strokes("healed"))
        }
    }

    @Test("ink is checked like a mark: a page the PDF has, and strokes as a JSON object")
    func checks() throws {
        try with { w in
            #expect(throws: InvalidMarkError.self) { try w.store.setInk(documentId: w.document.id, page: 6, body: w.strokes("past the end")) }
            #expect(throws: InvalidMarkError.self) { try w.store.setInk(documentId: w.document.id, page: -1, body: w.strokes("before the start")) }
            #expect(throws: InvalidMarkError.self) { try w.store.setInk(documentId: w.document.id, page: 0, body: "[1,2,3]") }
            #expect(throws: InvalidMarkError.self) { try w.store.setInk(documentId: w.document.id, page: 0, body: "") }
            #expect(throws: InvalidMarkError.self) { try w.store.setInk(documentId: 9_999, page: 0, body: w.strokes("no such PDF")) }
            let written = try w.database.annotations(documentId: w.document.id)
            #expect(written.isEmpty, "nothing was written")
            let kept = try w.store.setInk(documentId: w.document.id, page: 5, body: " \n" + w.strokes("leading space"))
            #expect(kept, "the last page, and whitespace before the object")
        }
    }

    @Test("the marks the reader holds leave the strokes out; the whole list still has them")
    func outOfTheList() throws {
        try with { w in
            let highlight = PdfMarkInput(page: 0, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 72, y0: 700, x1: 300, y1: 714)], quote: "alpha")
            _ = try w.store.addAnnotations(documentId: w.document.id, [highlight])
            _ = try w.store.setInk(documentId: w.document.id, page: 0, body: w.strokes("on the same page"))
            let state = try #require(Optional(PdfMarkEditor(store: w.store, documentId: w.document.id)))
            let marks = try awaitValue { try await state.state.marks }
            #expect(marks.map(\.kind) == [.highlight], "no ink in the editor's list")
            #expect(try w.database.annotations(documentId: w.document.id, withInk: false).map(\.kind) == [.highlight])
            #expect(try w.database.annotations(documentId: w.document.id).map(\.kind) == [.highlight, .ink], "the whole list, as the corpus reads it")
            #expect(try w.database.annotations(documentId: w.document.id, page: 0, withInk: false).count == 1)
        }
    }

    @Test("ink has no words: a PDF's note is not found by it, nor changed by it")
    func noWords() throws {
        try with { w in
            let entry = try w.index.search("sketchbook")
            _ = try w.store.setInk(documentId: w.document.id, page: 3, body: w.strokes("composition-ink"))
            #expect(try w.database.marksSearchText().isEmpty)
            #expect(try w.index.search("composition").isEmpty, "the strokes' own text is not searched")
            #expect(try w.index.search("sketchbook") == entry)
        }
    }

    @Test("each page's ink is handed over in page order, one at a time")
    func forEach() throws {
        try with { w in
            for page in [4, 0, 2] { _ = try w.store.setInk(documentId: w.document.id, page: page, body: w.strokes("p\(page)")) }
            var seen: [(Int, String)] = []
            try w.database.forEachInk(documentId: w.document.id) { seen.append(($0, $1)) }
            #expect(seen.map(\.0) == [0, 2, 4])
            #expect(seen.map(\.1) == [w.strokes("p0"), w.strokes("p2"), w.strokes("p4")])
        }
    }

    @Test("ink goes with its PDF, as its other marks do")
    func goesWithThePdf() throws {
        try with { w in
            _ = try w.store.setInk(documentId: w.document.id, page: 1, body: w.strokes("kept"))
            try w.database.deleteDocument(id: w.document.id)
            let pages = try w.database.inkPages(documentId: w.document.id)
            #expect(pages.isEmpty, "the PDF's delete took its ink with it")
        }
    }

    @Test("a canvas point is a point of the crop box from its top-left corner, y down")
    func geometry() {
        let plain = PdfInkGeometry.Box(minX: 0, minY: 0, width: 612, height: 792)
        #expect(PdfInkGeometry.userSpace(x: 0, y: 0, in: plain) == (0, 792) && PdfInkGeometry.userSpace(x: 612, y: 792, in: plain) == (612, 0))
        let offset = PdfInkGeometry.Box(minX: 40, minY: 30, width: 400, height: 500)
        let there = PdfInkGeometry.userSpace(x: 100, y: 50, in: offset)
        #expect(there == (140, 480))
        let back = PdfInkGeometry.canvas(x: there.x, y: there.y, in: offset)
        #expect(back.x == 100 && back.y == 50)
    }
}

/// Runs async work from a synchronous test body.
private func awaitValue<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) throws -> T {
    let box = ResultBox<T>()
    let done = DispatchSemaphore(value: 0)
    Task {
        do { box.result = .success(try await work()) } catch { box.result = .failure(error) }
        done.signal()
    }
    done.wait()
    return try box.result!.get()
}

private final class ResultBox<T>: @unchecked Sendable { var result: Result<T, Error>? }
