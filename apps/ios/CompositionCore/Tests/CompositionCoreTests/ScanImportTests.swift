import Foundation
import GRDB
import Testing

@testable import CompositionCore

@Suite("Scans: getting them in")
struct ScanImportTests {
    private func urls(_ names: [String]) -> [URL] { names.map { URL(fileURLWithPath: "/tmp/\($0)") } }

    @Test("pictures are in the order a scanner named them")
    func order() {
        let ordered = ScanImport.ordered(urls(["scan_10.jpg", "scan_2.jpg", "Scan_1.jpg", "scan_002.jpg", "cover.jpg"])).map(\.lastPathComponent)
        #expect(ordered == ["cover.jpg", "Scan_1.jpg", "scan_002.jpg", "scan_2.jpg", "scan_10.jpg"])
    }

    @Test("a title comes from what the names share, and not from a scanner's own names")
    func titles() {
        #expect(ScanImport.title(forFiles: urls(["Physics 101 - 001.jpg", "Physics 101 - 002.jpg"])) == "Physics 101")
        #expect(ScanImport.title(forFiles: urls(["Organic_Chem_1.png", "Organic_Chem_2.png"])) == "Organic Chem")
        #expect(ScanImport.title(forFiles: urls(["History essay 3.heic"])) == "History essay")
        #expect(ScanImport.title(forFiles: urls(["scan_001.jpg", "scan_002.jpg"])) == ScanImport.fallbackTitle)
        #expect(ScanImport.title(forFiles: urls(["IMG_4411.HEIC", "IMG_4412.HEIC"])) == ScanImport.fallbackTitle)
        #expect(ScanImport.title(forFiles: urls(["a.jpg", "b.jpg"])) == ScanImport.fallbackTitle)
        #expect(ScanImport.title(forFiles: []) == ScanImport.fallbackTitle)
    }

    @Test("only pictures are taken")
    func pictures() {
        #expect(urls(["a.JPG", "b.heic", "c.tiff", "d.png"]).allSatisfy(ScanImport.isPicture))
        #expect(!urls(["a.pdf", "b.txt", "c"]).contains(where: ScanImport.isPicture))
    }

    @Test("a scan becomes a note that owns its PDF, every page waiting to be read; deleting the note for good takes the scan's rows")
    func importAScan() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let store = NoteStore(database: database)
            let library = DocumentLibrary(store: store, location: DataLocation(directory: scratch.directory))
            let pdf = scratch.directory.appendingPathComponent("Physics.pdf")
            try Data("%PDF-1.4\n%fake but enough for the header check\n".utf8).write(to: pdf)

            guard case .added(let note, let document) = try library.importScan(from: pdf, title: "  Physics 101 ", pageCount: 3) else {
                Issue.record("the scan was not imported")
                return
            }
            #expect(note.title == "Physics 101")
            #expect(document.pageCount == 3 && document.fileName == "Physics.pdf")
            #expect(try database.isScan(documentId: document.id))
            #expect(try database.pendingScanPages().map(\.page) == [0, 1, 2])
            #expect(try library.documentFile(id: document.id) != nil)

            // No title: a name that says what it is.
            guard case .added(let untitled, _) = try library.importScan(from: pdf, title: " ", pageCount: 1) else {
                Issue.record("the second scan was not imported")
                return
            }
            #expect(untitled.title == "Scanned notes")

            try store.deleteNote(id: note.id)
            try library.permanentlyDeleteNote(id: note.id)
            #expect(try !database.isScan(documentId: document.id))
            #expect(try database.pendingScanPages().count == 1)
        }
    }

    @Test("a file that is not a PDF leaves nothing behind")
    func refused() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let store = NoteStore(database: database)
            let library = DocumentLibrary(store: store, location: DataLocation(directory: scratch.directory))
            let notPdf = scratch.directory.appendingPathComponent("x.pdf")
            try Data("hello".utf8).write(to: notPdf)
            let before = try database.notesInDisplayOrder().count
            guard case .refused = try library.importScan(from: notPdf, title: "x", pageCount: 1) else {
                Issue.record("a file that is not a PDF was imported")
                return
            }
            #expect(try database.notesInDisplayOrder().count == before)
            #expect(try database.scanDocumentIds().isEmpty)
        }
    }
}
