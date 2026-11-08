import Foundation
import Testing

@testable import CompositionCore

// Build plan Step 8, in plain words; ImagesConformanceTests holds the same rules against the desktop's real functions.

private let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])
private let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2])

@Suite("Images in notes")
struct ImagesTests {
    @Test("the bytes say what an image is, and a HEIC photo, SVG or short input is none of the four")
    func sniffing() {
        #expect(StoredImages.sniff(png) == .png && StoredImages.sniff(jpeg) == .jpg)
        #expect(StoredImages.sniff(Data("GIF89a12".utf8)) == .gif)
        #expect(StoredImages.sniff(Data("RIFF\0\0\0\0WEBPVP8 ".utf8)) == .webp)
        let heic = Data([0, 0, 0, 0x18]) + Data("ftypheic".utf8)
        #expect(StoredImages.sniff(heic) == nil, "converted to JPEG by the app before it gets here")
        #expect(StoredImages.sniff(Data("<svg/>".utf8)) == nil && StoredImages.sniff(Data()) == nil)
    }

    @Test("a file is named for its note, its own name and its bytes")
    func naming() {
        let name = StoredImages.fileName(noteTitle: "Trip Plan", fileName: "Route Map.JPG", data: png, type: .png)
        #expect(name.hasPrefix("trip-plan-route-map-") && name.hasSuffix(".png") && name.count == "trip-plan-route-map-".count + 12 + 4)
        #expect(StoredImages.fileName(noteTitle: "日本語", fileName: "../../etc/passwd", data: png, type: .png).hasPrefix("note-passwd-"), "nothing usable falls back, and a path never escapes")
        #expect(StoredImages.isImageName(name) && !StoredImages.isImageName("../x.png") && !StoredImages.isImageName("x.txt"))
    }

    @Test("an image is stored once: the same bytes reuse the file, and the Markdown and tag point at it")
    func storing() throws {
        try withScratch { scratch in
            let location = DataLocation(directory: scratch.directory)
            guard case .stored(let name) = StoredImages.store(noteTitle: "Trip", fileName: "map.png", data: png, in: location) else { Issue.record("not stored"); return }
            #expect(StoredImages.store(noteTitle: "Trip", fileName: "map.png", data: png, in: location) == .stored(name: name))
            let files = try FileManager.default.contentsOfDirectory(atPath: location.imagesURL.path)
            let tag = try StoredImages.tag(forName: name)
            #expect(files == [name], "no temporary file is left behind")
            #expect(StoredImages.markdown(forName: name, alt: "map") == "![map](app_data/\(name))")
            #expect(tag == "<Image src=\"app_data/\(name)\" alt=\"\" />")
            #expect(StoredImages.findRefs(in: "see ![map](app_data/\(name)) and ![gone](app_data/gone.png)") == [name, "gone.png"])
        }
    }

    @Test("an empty, unsupported or too large image is refused with the desktop's words")
    func refusing() throws {
        try withScratch { scratch in
            let location = DataLocation(directory: scratch.directory)
            #expect(StoredImages.store(noteTitle: "T", fileName: "f.png", data: Data(), in: location) == .failed("That image is empty."))
            #expect(StoredImages.store(noteTitle: "T", fileName: "f.txt", data: Data("text".utf8), in: location) == .failed("Only PNG, JPEG, GIF, and WebP images are supported."))
            #expect(StoredImages.store(noteTitle: "T", fileName: "f.png", data: png, in: location, maxBytes: 5) == .failed("Images can be at most \(JavaScriptText.numberString(5.0 / 1_048_576)) MB."), "the number is written the way JavaScript writes it")
            let ten = Data(repeating: 0, count: 10 * 1_048_576 + 1)
            #expect(StoredImages.store(noteTitle: "T", fileName: "f.png", data: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] + ten, in: location, maxBytes: 10 * 1_048_576) == .failed("Images can be at most 10 MB."))
            #expect(!FileManager.default.fileExists(atPath: location.imagesURL.path), "nothing was written")
        }
    }

    @Test("alt text falls back to words from the name, and brackets and line breaks never get into it")
    func altText() {
        #expect(StoredImages.alt(forName: "trip-plan-route-map-3f9c2a71b0de.png") == "trip plan route map")
        #expect(StoredImages.markdown(forName: "a-0123456789ab.jpg", alt: nil) == "![a](app_data/a-0123456789ab.jpg)")
        #expect(StoredImages.markdown(forName: "a-0123456789ab.jpg", alt: "  [one]\ntwo  ") == "![one two](app_data/a-0123456789ab.jpg)")
    }

    @Test("a Markdown image becomes an Image tag that can say how wide to be, and the caret waits inside it")
    func conversion() throws {
        let text = "before ![a map](app_data/x.png \"Route\") after"
        let edit = try #require(MarkdownImages.toMdx(text, selectionStart: 12, selectionEnd: 12))
        #expect(edit.text == "<Image src=\"app_data/x.png\" alt=\"a map\" title=\"Route\" />")
        #expect(String(text.dropFirst(edit.start).dropLast(text.count - edit.end)) == "![a map](app_data/x.png \"Route\")")
        #expect(edit.caret == edit.text.count - 3, "before ` />`, ready for width=")
        #expect(MarkdownImages.toMdx(text, selectionStart: 0, selectionEnd: 0) == nil, "the caret is not on the image")
        #expect(MarkdownImages.toMdx("```\n![a](x.png)\n```", selectionStart: 0, selectionEnd: 19) == nil, "code is left alone")
    }

    @Test("an image stored by the app goes into a backup and comes out of it")
    func inABackup() throws {
        try withScratch { scratch in
            let source = DataLocation(directory: scratch.directory.appendingPathComponent("source"))
            try FileManager.default.createDirectory(at: source.directory, withIntermediateDirectories: true)
            let database = try CompositionDatabase.open(at: source.databaseURL)
            defer { try? database.close() }
            guard case .stored(let name) = StoredImages.store(noteTitle: "Trip", fileName: "map.png", data: png, in: source) else { Issue.record("not stored"); return }
            let summary = try Backup.create(database: database, location: source, to: scratch.directory.appendingPathComponent("backup.tar.gz"))
            #expect(summary.counts.images == 1)
            let staged = try Backup.stage(summary.file, in: DataLocation(directory: scratch.directory.appendingPathComponent("target")))
            #expect(staged.counts.images == 1)
            let restored = try Data(contentsOf: staged.directory.appendingPathComponent("app_data").appendingPathComponent(name))
            #expect(restored == png)
        }
    }

    @Test("the stored images are listed newest first with who uses them, and the picker narrows them by words of the name")
    func theLibrary() throws {
        try withScratch { scratch in
            let location = DataLocation(directory: scratch.directory)
            #expect(StoredImages.list(in: location).isEmpty, "no folder is no images")
            guard case .stored(let trip) = StoredImages.store(noteTitle: "Trip Plan", fileName: "route map.png", data: png, in: location),
                case .stored(let recipe) = StoredImages.store(noteTitle: "Recipes", fileName: "pasta.jpg", data: jpeg, in: location)
            else { Issue.record("not stored"); return }
            let folder = location.imagesURL
            try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1_000_000)], ofItemAtPath: folder.appendingPathComponent(trip).path)
            try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 2_000_000)], ofItemAtPath: folder.appendingPathComponent(recipe).path)
            try Data("x".utf8).write(to: folder.appendingPathComponent("notes.txt"))
            try Data("x".utf8).write(to: folder.appendingPathComponent(".\(trip).tmp"))

            let notes = [NoteText(id: 4, title: "Plan", content: "![map](app_data/\(trip))"), NoteText(id: 3, title: "Other", content: "no pictures")]
            let library = StoredImages.library(in: location) { notes }
            #expect(library.map(\.name) == [recipe, trip], "newest first; the text file and the half-written one are left out")
            #expect(library.map(\.usedIn) == [[], [ImageUse(id: 4, title: "Plan")]])
            #expect(library.map(\.size) == [jpeg.count, png.count])

            #expect(StoredImages.match(library, query: "trip map").map(\.name) == [trip], "every word, anywhere in the name")
            #expect(StoredImages.match(library, query: "  ").map(\.name) == [recipe, trip], "nothing typed offers all of them, in the order given")
            #expect(StoredImages.match(library, query: "RECIPES").map(\.name) == [recipe], "case does not matter")
            #expect(StoredImages.match(library, query: "nothing").isEmpty)
        }
    }

    @Test("the notes are read only when there is an image to say who uses")
    func notesAreReadOnDemand() throws {
        try withScratch { scratch in
            let location = DataLocation(directory: scratch.directory)
            var reads = 0
            _ = StoredImages.library(in: location) { reads += 1; return [] }
            #expect(reads == 0)
        }
    }

    @Test("a note's texts come with its id and title, in the order the sidebar shows them")
    func noteTexts() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.directory.appendingPathComponent("composition.db"))
            defer { try? database.close() }
            let first = try database.createNote(title: "First")
            let second = try database.createNote(title: "Second", now: Date().addingTimeInterval(5))
            _ = try database.saveNoteContent(id: first.id, content: "---\ntitle: First\n---\n![x](app_data/x-0123456789ab.png)", now: Date().addingTimeInterval(10))
            let texts = try database.noteTexts()
            #expect(texts.map(\.id) == [first.id, second.id], "the last edited first")
            #expect(texts.first?.title == "First" && texts.first?.content.contains("app_data/x-0123456789ab.png") == true)
            #expect(StoredImages.usage(in: texts)["x-0123456789ab.png"] == [ImageUse(id: first.id, title: "First")])
        }
    }

    @Test("sizes and counts are written as the picker writes them")
    func labels() {
        #expect(StoredImages.sizeLabel(bytes: 0) == "0 B" && StoredImages.sizeLabel(bytes: 1023) == "1023 B")
        #expect(StoredImages.sizeLabel(bytes: 812 * 1024) == "812 KB" && StoredImages.sizeLabel(bytes: 1536) == "2 KB")
        #expect(StoredImages.sizeLabel(bytes: 5 * 1_048_576 + 400_000) == "5.4 MB")
        #expect(StoredImages.sizeLabel(bytes: 1_310_720) == "1.3 MB", "1.25 MB: the larger tenth, as JavaScript's toFixed picks it")
        #expect(StoredImages.usageLabel(count: 0) == "Not used in any note" && StoredImages.usageLabel(count: 1) == "Used in 1 note" && StoredImages.usageLabel(count: 4) == "Used in 4 notes")
    }
}
