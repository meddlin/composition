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
}
