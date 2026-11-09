import Foundation
import GRDB
import Testing

@testable import CompositionCore

// Where a mark is on its page and which mark a tap lands on, from the stored rectangles alone (the desktop's `boxesOf` and `markAt`).

@Suite("Marks on the page: boxes, taps and a new note's box")
struct PdfMarkGeometryTests {
    private func marks(_ body: ([PdfMark]) throws -> Void) throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let store = NoteStore(database: database)
            let note = try store.createNote(title: "Book")
            let document = try database.addDocument(noteId: note.id, fileName: "b.pdf", storedName: "aaaaaaaaaaaa-b.pdf", sha256: String(repeating: "a", count: 64), size: 1, pageCount: 5)
            let first = try store.addAnnotations(documentId: document.id, [PdfMarkInput(page: 0, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 100, y0: 300, x1: 200, y1: 318), PdfRect(x0: 100, y0: 282, x1: 160, y1: 300)], quote: "two lines")])
            let second = try store.addAnnotations(documentId: document.id, [PdfMarkInput(page: 0, kind: .underline, color: "blue", rects: [PdfRect(x0: 150, y0: 300, x1: 250, y1: 318)], quote: "over")])
            let note2 = try store.addAnnotations(documentId: document.id, [PdfMarkInput(page: 0, kind: .text, color: "pink", body: PdfTextNoteBody(rect: PdfRect(x0: 400, y0: 500, x1: 600, y1: 556), text: "hello", fontSize: 12).json)])
            try body(first + second + note2)
        }
    }

    @Test("a mark's boxes are its lines, or its note's box, and the union holds them all")
    func boxes() throws {
        try marks { all in
            #expect(all[0].boxes.count == 2 && all[0].union == PdfRect(x0: 100, y0: 282, x1: 200, y1: 318))
            #expect(all[2].boxes == [PdfRect(x0: 400, y0: 500, x1: 600, y1: 556)] && all[2].textNote?.text == "hello" && all[0].textNote == nil)
        }
    }

    @Test("a tap finds the mark under it, the latest where two overlap, with a little room at the edge")
    func taps() throws {
        try marks { all in
            #expect(PdfMarkGeometry.mark(at: 120, 290, among: all)?.id == all[0].id, "the second line of the highlight")
            #expect(PdfMarkGeometry.mark(at: 170, 310, among: all)?.id == all[1].id, "where the underline lies over the highlight, the one made last")
            #expect(PdfMarkGeometry.mark(at: 120, 310, among: all)?.id == all[0].id)
            #expect(PdfMarkGeometry.mark(at: 500, 520, among: all)?.id == all[2].id, "a typed note")
            #expect(PdfMarkGeometry.mark(at: 98.5, 305, among: all)?.id == all[0].id, "two points past the edge still counts")
            #expect(PdfMarkGeometry.mark(at: 97, 305, among: all) == nil)
            #expect(PdfMarkGeometry.mark(at: 10, 10, among: all) == nil && PdfMarkGeometry.mark(at: 1, 1, among: []) == nil)
            #expect(PdfMarkGeometry.mark(at: 170, 292, among: all) == nil, "inside the union of the two lines, but on no line")
        }
    }

    @Test("a new note's top-left corner is the tap, kept inside the page")
    func newNoteBox() {
        let page = PdfMarkGeometry.noteBox(tapX: 100, tapY: 700, pageWidth: 612, pageHeight: 792)
        #expect(page == PdfRect(x0: 100, y0: 644, x1: 300, y1: 700))
        #expect(PdfMarkGeometry.noteBox(tapX: 500, tapY: 700, pageWidth: 612, pageHeight: 792).x1 == 612, "moved in from the right edge")
        #expect(PdfMarkGeometry.noteBox(tapX: -20, tapY: 700, pageWidth: 612, pageHeight: 792).x0 == 0)
        #expect(PdfMarkGeometry.noteBox(tapX: 50, tapY: 10, pageWidth: 612, pageHeight: 792).y0 == 0, "moved up from the bottom edge")
        #expect(PdfMarkGeometry.noteBox(tapX: 50, tapY: 900, pageWidth: 612, pageHeight: 792).y1 == 792)
        #expect(PdfMarkGeometry.noteBox(tapX: 500, tapY: 10, pageWidth: 0, pageHeight: 0) == PdfRect(x0: 500, y0: -46, x1: 700, y1: 10), "with no page size it is where the tap was")
    }
}
