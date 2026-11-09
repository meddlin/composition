import CryptoKit
import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The PDFs' files and what joins a file to its row, case by case as the desktop's `documents.test.ts` has them (the same inputs and the
// same words), against real files in a scratch folder.

@Suite("PDF files and their rows")
struct DocumentLibraryTests {
    /// A data directory and an inbox to import from, both removed when the test is done.
    private struct Setup {
        let location: DataLocation
        let inbox: URL
        let database: CompositionDatabase
        let store: NoteStore
        let library: DocumentLibrary
        let scratch: Scratch

        init() throws {
            scratch = try Scratch()
            location = DataLocation(directory: scratch.directory.appendingPathComponent("data", isDirectory: true))
            inbox = scratch.directory.appendingPathComponent("inbox", isDirectory: true)
            try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
            database = try CompositionDatabase.open(in: location)
            store = NoteStore(database: database)
            library = DocumentLibrary(store: store, location: location)
        }

        func write(_ name: String, _ content: Data = pdf()) throws -> URL {
            let url = inbox.appendingPathComponent(name)
            try content.write(to: url)
            return url
        }

        func note(_ title: String) throws -> NoteDetail { try store.createNote(title: title) }

        /// What is in `documents/`, hidden half-copies included, sorted.
        var storedFiles: [String] {
            ((try? FileManager.default.contentsOfDirectory(atPath: location.documentsURL.path)) ?? []).sorted()
        }

        func finish() {
            try? database.close()
            scratch.remove()
        }
    }

    private static func pdf(_ extra: String = "") -> Data { Data("%PDF-1.7\n\(extra)\n%%EOF\n".utf8) }

    private func hex(of data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    private func with(_ body: (Setup) throws -> Void) throws {
        let setup = try Setup()
        defer { setup.finish() }
        try body(setup)
    }

    private func added(_ result: ImportDocumentResult, sourceLocation: SourceLocation = #_sourceLocation) throws -> StoredDocument {
        guard case .added(let document) = result else {
            Issue.record("expected the PDF to be added, got \(result)", sourceLocation: sourceLocation)
            throw CocoaError(.fileReadUnknown)
        }
        return document
    }

    // MARK: importDocument

    @Test("copies the PDF into the data directory and gives it to the note, leaving the original where it was")
    func copiesIn() throws {
        try with { setup in
            let note = try setup.note("Textbook")
            let bytes = Self.pdf("one")
            let file = try setup.write("Designing Data.pdf", bytes)

            let document = try added(try setup.library.importDocument(noteId: note.id, from: file, pageCount: 12))

            #expect((document.noteId, document.fileName, document.size, document.pageCount, document.viewState) == (note.id, "Designing Data.pdf", Int64(bytes.count), 12, PdfViewState()))
            #expect(document.sha256 == hex(of: bytes) && isUuid(document.uuid))
            #expect(setup.storedFiles == [document.storedName])
            #expect(document.storedName.range(of: #"^[0-9a-f]{12}-Designing_Data\.pdf$"#, options: .regularExpression) != nil)
            #expect(try Data(contentsOf: setup.location.documentsURL.appendingPathComponent(document.storedName)) == bytes)
            #expect(FileManager.default.fileExists(atPath: file.path), "the original is left alone")
            #expect(try setup.database.documentForNote(note.id) == document)
        }
    }

    @Test("does not know the page count until the reader has counted them")
    func pageCountComesLater() throws {
        try with { setup in
            let note = try setup.note("A")
            let document = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("a.pdf")))
            #expect(document.pageCount == 0)
            try setup.database.setPageCount(id: document.id, pageCount: 41)
            #expect(try setup.database.document(id: document.id)?.pageCount == 41)
            #expect(throws: DocumentError.invalidPageCount) { try setup.database.setPageCount(id: document.id, pageCount: 0) }
        }
    }

    @Test("accepts a PDF with a little junk before the header")
    func acceptsJunk() throws {
        try with { setup in
            let note = try setup.note("A")
            let junk = Data(repeating: 0x20, count: 900) + Self.pdf()
            _ = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("junk.pdf", junk)))
        }
    }

    @Test("refuses a file that is not a PDF, and leaves nothing behind")
    func refusesNonPdfs() throws {
        try with { setup in
            let note = try setup.note("A")
            let files = [
                try setup.write("notes.txt", Data("just text".utf8)), try setup.write("zipped.pdf", Data([0x1f, 0x8b, 8, 0, 1, 2, 3])),
                try setup.write("empty.pdf", Data()), try setup.write("late.pdf", Data(repeating: 0x20, count: 1100) + Self.pdf()),
            ]
            for file in files {
                #expect(try setup.library.importDocument(noteId: note.id, from: file) == .refused("\(file.lastPathComponent): this doesn't look like a PDF."), "\(file.lastPathComponent)")
            }
            #expect(setup.storedFiles.isEmpty)
        }
    }

    @Test("refuses a folder, a file over the size limit and a file that is not there, by name")
    func refusesTheRest() throws {
        try with { setup in
            let note = try setup.note("A")
            let folder = setup.inbox.appendingPathComponent("chapters.pdf")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            #expect(try setup.library.importDocument(noteId: note.id, from: folder) == .refused("chapters.pdf: only files can be imported, not folders."))

            let big = try setup.write("big.pdf", Data())
            let handle = try FileHandle(forWritingTo: big)
            try handle.truncate(atOffset: UInt64(DocumentNames.maxBytes) + 1)  // sparse, so no real disk is used
            try handle.close()
            #expect(try setup.library.importDocument(noteId: note.id, from: big) == .refused("big.pdf: files can be at most 1 GB."))

            #expect(try setup.library.importDocument(noteId: note.id, from: setup.inbox.appendingPathComponent("gone.pdf")) == .refused("gone.pdf: could not be read."))
            #expect(setup.storedFiles.isEmpty)
        }
    }

    @Test("refuses a note that already has a PDF and a note that no longer exists")
    func refusesBadOwners() throws {
        try with { setup in
            let note = try setup.note("A")
            _ = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("first.pdf", Self.pdf("1"))))
            #expect(try setup.library.importDocument(noteId: note.id, from: try setup.write("second.pdf", Self.pdf("2"))) == .refused("That note already has a PDF."))
            #expect(try setup.library.importDocument(noteId: 9999, from: try setup.write("third.pdf", Self.pdf("3"))) == .refused("That note no longer exists."))
            #expect(setup.storedFiles.count == 1, "no copy and no half-copy stays")
        }
    }

    @Test("offers the PDF you already have when the same bytes come in again, copying nothing, and imports a separate copy when asked")
    func duplicates() throws {
        try with { setup in
            let note = try setup.note("First reading"), other = try setup.note("Second reading")
            let first = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("book.pdf")))

            let again = try setup.library.importDocument(noteId: other.id, from: try setup.write("book copy.pdf"))
            #expect(again == .duplicate([first]))
            #expect(setup.storedFiles == [first.storedName], "nothing was copied, and no hidden half-copy is left")

            let copy = try added(try setup.library.importDocument(noteId: other.id, from: try setup.write("book copy.pdf"), allowDuplicate: true))
            #expect(setup.storedFiles.count == 2)
            #expect(try setup.database.documents(sha256: copy.sha256).map(\.noteId) == [note.id, other.id])
        }
    }

    @Test("a file is copied whole, in pieces, whatever its size")
    func copiesBigFiles() throws {
        try with { setup in
            let note = try setup.note("A")
            // a little over three chunks, so the last one is a short one, each piece a different byte so that a piece lost or moved shows
            var bytes = Self.pdf()
            for piece in 1...3 { bytes.append(Data(repeating: UInt8(piece), count: DocumentLibrary.chunkSize)) }
            bytes.append(Data(repeating: 0x7f, count: 12_345))
            let source = try setup.write("big.pdf", bytes)
            let document = try added(try setup.library.importDocument(noteId: note.id, from: source))
            #expect(try document.size == Int64(bytes.count) && document.sha256 == sha256(of: source))
            #expect(try sha256(of: setup.location.documentsURL.appendingPathComponent(document.storedName)) == document.sha256)
        }
    }

    // MARK: documentFile, removeDocument

    @Test("a PDF's file is found by its id, and not when the row or the file is gone or its stored name is not one the app made")
    func findsFiles() throws {
        try with { setup in
            let note = try setup.note("A")
            let document = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("a.pdf")))
            let found = try #require(try setup.library.documentFile(id: document.id))
            #expect(found.url == setup.location.documentsURL.appendingPathComponent(document.storedName) && found.document == document)
            #expect(try setup.library.documentFile(id: 9999) == nil)

            // a row from a backup that names a file outside the folder is not followed
            try setup.database.pool.write { try $0.execute(sql: "UPDATE documents SET stored_name = '../composition.db' WHERE id = ?", arguments: [document.id]) }
            #expect(try setup.library.documentFile(id: document.id) == nil)
            #expect(try setup.library.removeDocument(id: document.id))
            #expect(FileManager.default.fileExists(atPath: setup.location.databaseURL.path), "the database was not removed")

            try FileManager.default.removeItem(at: setup.location.documentsURL.appendingPathComponent(document.storedName))
        }
    }

    @Test("a file deleted behind the app's back is not found")
    func missingFile() throws {
        try with { setup in
            let note = try setup.note("A")
            let document = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("a.pdf")))
            try FileManager.default.removeItem(at: setup.location.documentsURL.appendingPathComponent(document.storedName))
            #expect(try setup.library.documentFile(id: document.id) == nil)
        }
    }

    @Test("removing a PDF deletes its row, marks, bookmarks and file, and only that PDF's; and says so when there is none")
    func removesOne() throws {
        try with { setup in
            let note = try setup.note("Mine"), other = try setup.note("Other")
            let mine = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("mine.pdf", Self.pdf("mine"))))
            let theirs = try added(try setup.library.importDocument(noteId: other.id, from: try setup.write("theirs.pdf", Self.pdf("theirs"))))
            for document in [mine, theirs] {
                try setup.database.addAnnotation(documentId: document.id, PdfMarkInput(page: 0, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 0, y0: 0, x1: 1, y1: 1)]))
                try setup.database.addBookmark(documentId: document.id, page: 0, label: "start")
            }

            #expect(try setup.library.removeDocument(id: mine.id))

            #expect(try setup.database.annotations(documentId: mine.id).isEmpty && setup.database.bookmarks(documentId: mine.id).isEmpty)
            #expect(try setup.database.annotations(documentId: theirs.id).count == 1 && setup.database.bookmarks(documentId: theirs.id).count == 1)
            #expect(setup.storedFiles == [theirs.storedName])
            #expect(try setup.library.removeDocument(id: 9999) == false)
        }
    }

    // MARK: A note's PDF through the Trash Can

    private struct Owned {
        let note: NoteDetail, other: NoteDetail
        let mine: StoredDocument, theirs: StoredDocument
    }

    private func noteWithPdf(_ setup: Setup) throws -> Owned {
        let note = try setup.note("Textbook"), other = try setup.note("Other")
        let mine = try added(try setup.library.importDocument(noteId: note.id, from: try setup.write("mine.pdf", Self.pdf("mine")), pageCount: 5))
        let theirs = try added(try setup.library.importDocument(noteId: other.id, from: try setup.write("theirs.pdf", Self.pdf("theirs")), pageCount: 5))
        try setup.database.addAnnotation(documentId: mine.id, PdfMarkInput(page: 2, kind: .highlight, color: "green", rects: [PdfRect(x0: 0, y0: 0, x1: 9, y1: 9)], quote: "kept"))
        try setup.database.addBookmark(documentId: mine.id, page: 3, label: "later")
        return Owned(note: note, other: other, mine: mine, theirs: theirs)
    }

    @Test("keeps the file and the markup while the note is in the Trash Can, and finds them again when it is restored")
    func followsItsNote() throws {
        try with { setup in
            let owned = try noteWithPdf(setup)
            try setup.store.deleteNote(id: owned.note.id)
            #expect(try setup.database.documentForNote(owned.note.id)?.id == owned.mine.id)
            #expect(try setup.database.annotations(documentId: owned.mine.id).count == 1 && setup.database.bookmarks(documentId: owned.mine.id).count == 1)
            #expect(setup.storedFiles.count == 2)

            // a sweep while it sits in the Trash Can leaves it alone
            try setup.library.removeOrphans()
            #expect(setup.storedFiles.count == 2)

            _ = try setup.store.restoreNote(id: owned.note.id)
            #expect(try setup.database.documentForNote(owned.note.id) == owned.mine)
            #expect(try setup.database.annotations(documentId: owned.mine.id).map(\.quote) == ["kept"])
            #expect(setup.storedFiles.count == 2)
        }
    }

    @Test("deletes the file, the marks and the bookmarks, and only them, when the note is permanently deleted")
    func goesWithItsNote() throws {
        try with { setup in
            let owned = try noteWithPdf(setup)
            try setup.store.deleteNote(id: owned.note.id)

            try setup.library.permanentlyDeleteNote(id: owned.note.id)

            #expect(try setup.database.document(id: owned.mine.id) == nil)
            #expect(try setup.database.annotations(documentId: owned.mine.id).isEmpty && setup.database.bookmarks(documentId: owned.mine.id).isEmpty)
            #expect(setup.storedFiles == [owned.theirs.storedName])
            #expect(try setup.database.document(id: owned.theirs.id) != nil)
        }
    }

    @Test("deletes them when the note outlives the Trash Can's retention window, and keeps one still inside it")
    func goesWhenExpired() throws {
        try with { setup in
            let owned = try noteWithPdf(setup)
            try setup.store.deleteNote(id: owned.note.id)
            try setup.store.deleteNote(id: owned.other.id)
            try setup.database.pool.write { try $0.execute(sql: "UPDATE trashed_notes SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", arguments: [owned.note.id]) }

            try setup.library.purgeExpiredTrash()

            #expect(try setup.database.document(id: owned.mine.id) == nil)
            #expect(try setup.database.document(id: owned.theirs.id) != nil)
            #expect(setup.storedFiles == [owned.theirs.storedName])
        }
    }

    @Test("leaves a live note's PDF alone when the trash is cleaned")
    func liveNotesStay() throws {
        try with { setup in
            let owned = try noteWithPdf(setup)
            try setup.library.purgeExpiredTrash()
            try setup.library.removeOrphans()
            #expect(try setup.database.document(id: owned.mine.id) != nil && setup.storedFiles.count == 2)
        }
    }

    @Test("sweeps the PDF of a note deleted for good behind the app's back, and the marks of a PDF already gone")
    func sweeps() throws {
        try with { setup in
            let owned = try noteWithPdf(setup)
            try setup.database.pool.write { try $0.execute(sql: "DELETE FROM notes WHERE id = ?", arguments: [owned.note.id]) }

            try setup.library.removeOrphans()

            #expect(try setup.database.document(id: owned.mine.id) == nil && setup.database.annotations(documentId: owned.mine.id).isEmpty)
            #expect(setup.storedFiles == [owned.theirs.storedName])

            try setup.database.pool.write { try $0.execute(sql: "DELETE FROM documents WHERE id = ?", arguments: [owned.theirs.id]) }
            try setup.library.removeOrphans()
            #expect(try setup.database.bookmarks(documentId: owned.theirs.id).isEmpty)
        }
    }

    // MARK: importPdf

    @Test("makes a note titled from the file's name, in the group asked for, and gives the PDF to it")
    func importsAsANote() throws {
        try with { setup in
            let notebook = try setup.database.defaultNotebookId()
            let group = try setup.database.createGroup(name: "Reading", notebookId: notebook)
            let outcome = try setup.library.importPdf(from: try setup.write("Designing_Data_Intensive.pdf"), groupId: group.id)

            guard case .added(let note, let document) = outcome else { Issue.record("expected the PDF to be added, got \(outcome)"); return }
            #expect(note.title == "Designing Data Intensive" && note.groupId == group.id)
            #expect(document.noteId == note.id && document.fileName == "Designing_Data_Intensive.pdf")
            #expect(try setup.database.note(id: note.id)?.title == "Designing Data Intensive")
        }
    }

    @Test("leaves no note and no file behind when the file is refused or is a duplicate, and names the note that owns the duplicate")
    func importLeavesNothing() throws {
        try with { setup in
            let notes = try setup.database.listNotes().count

            let refused = try setup.library.importPdf(from: try setup.write("notes.txt", Data("just text".utf8)))
            #expect(refused == .refused("notes.txt: this doesn't look like a PDF."))
            #expect(try setup.database.listNotes().count == notes && setup.database.listTrash().notes.isEmpty, "the note was never shown, so it is not in the Trash Can either")

            let first = try setup.library.importPdf(from: try setup.write("book.pdf"))
            guard case .added(let owner, let document) = first else { Issue.record("expected the PDF to be added"); return }
            let again = try setup.library.importPdf(from: try setup.write("book again.pdf"))
            #expect(again == .duplicate([ExistingPdf(document: document, noteTitle: "book")]))
            #expect(try setup.database.listNotes().count == notes + 1 && setup.database.listTrash().notes.isEmpty)

            // the owner in the Trash Can is still named
            try setup.store.deleteNote(id: owner.id)
            #expect(try setup.library.importPdf(from: try setup.write("book again.pdf")) == .duplicate([ExistingPdf(document: document, noteTitle: "book")]))

            let separate = try setup.library.importPdf(from: try setup.write("book again.pdf"), allowDuplicate: true)
            guard case .added(let second, _) = separate else { Issue.record("expected a separate copy, got \(separate)"); return }
            #expect(second.title == "book again" && setup.storedFiles.count == 2)
            #expect(setup.storedFiles.allSatisfy { !$0.hasPrefix(".") }, "no hidden half-copy is left")
        }
    }
}
