import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

// A drawing's trip through a backup (docs/architecture/ink.md, "A backup"): the PNG sits in `app_data/` beside the other stored images, the note names it with an `<Ink>`
// tag, and a restore, here or on the desktop, gives both back unchanged. `fixtures/conformance/ink/backup.tar.gz` is such a backup, made here, which the desktop's own
// restore code reads in `inkBackup.test.ts` (the strokes, and the pictures they draw in every colour scheme). `UPDATE_FIXTURES=1 swift test --filter InkBackup` rewrites it.

@Suite("Ink: a drawing in a backup")
struct InkBackupTests {
    static let title = "Trip plan"
    static let intro = "A sketch from the iPad:"

    /// A data directory with one note holding the sample drawing, backed up to `file`. Returns the PNG as it was stored and the name it was stored under.
    func makeBackup(in folder: URL, to file: URL) throws -> (png: Data, name: String) {
        let location = DataLocation(directory: folder.appendingPathComponent("source", isDirectory: true))
        let database = try CompositionDatabase.open(in: location)
        defer { try? database.close() }
        let png = try InkRenderer.pngData(of: InkSamples.page(), palette: InkPalette(theme: .default), scale: 2)
        guard case .stored(let name) = StoredImages.store(noteTitle: Self.title, fileName: "drawing.png", data: png, in: location) else { throw InkError("the drawing was not stored") }
        let note = try database.createNote(title: Self.title, tags: "sketch")
        let body = "\(Self.intro)\n\n\(InkTag.markdown(forName: name, alt: "A pen wave, a marker line and a dot", width: nil))\n"
        try database.updateNoteContent(id: note.id, content: note.content + body)
        _ = try Backup.create(database: database, location: location, to: file)
        return (png, name)
    }

    /// Restores the backup at `file` into a new data directory, and returns the note's text and the stored PNG it names.
    func restored(_ file: URL, in folder: URL) throws -> (text: String, png: Data, name: String) {
        let target = DataLocation(directory: folder.appendingPathComponent("target", isDirectory: true))
        let staged = try Backup.stage(file, in: target)
        try Backup.apply(staged, to: target)
        let database = try CompositionDatabase.open(in: target)
        defer { try? database.close() }
        let note = try #require(try database.listNotes().first)
        let text = try #require(try database.note(id: note.id)?.content)
        let name = try #require(text.components(separatedBy: "app_data/").dropFirst().first?.components(separatedBy: "\"").first)
        return (text, try Data(contentsOf: target.imagesURL.appendingPathComponent(name)), name)
    }

    @Test func aDrawingSurvivesABackupAndARestoreByteForByte() throws {
        try withScratchFolder { folder in
            let file = folder.appendingPathComponent("backup.tar.gz")
            let (png, name) = try makeBackup(in: folder, to: file)
            let back = try restored(file, in: folder)
            #expect(back.name == name && back.png == png, "the stored file is the same bytes")
            #expect(back.text.contains("<Ink src=\"app_data/\(name)\" alt=\"A pen wave, a marker line and a dot\" />"))
            var contents = try InkPNG.contents(of: back.png)
            #expect(contents.problems.isEmpty)
            #expect(try contents.drawing() == InkSamples.page())
            #expect(InkPNG.pixelsPerPoint(of: back.png) == 2)
        }
    }

    @Test func theCommittedBackupRestoresWithItsDrawing() throws {
        let directory = try #require(InkCorpus.directory)
        let file = directory.appendingPathComponent("backup.tar.gz")
        if ProcessInfo.processInfo.environment["UPDATE_FIXTURES"] != nil {
            try withScratchFolder { folder in
                let scratch = folder.appendingPathComponent("backup.tar.gz")
                _ = try makeBackup(in: folder, to: scratch)
                try? FileManager.default.removeItem(at: file)
                try FileManager.default.copyItem(at: scratch, to: file)
            }
        }
        try withScratchFolder { folder in
            let back = try restored(file, in: folder)
            #expect(back.text.contains(Self.intro) && back.text.contains("title: \(Self.title)"))
            var contents = try InkPNG.contents(of: back.png)
            #expect(contents.problems.isEmpty)
            #expect(try contents.drawing() == InkSamples.page())
            // The name carries a hash of the PNG's bytes, so the file is the one the note names.
            #expect(back.name.hasPrefix("trip-plan-drawing-") && back.name.hasSuffix(".png"))
        }
    }
}
