import CoreGraphics
import Foundation
import ImageIO
import Testing

@testable import CompositionCore
@testable import CompositionInk

@Suite("Ink: the PNG that carries its strokes")
struct InkPNGTests {
    let palette = InkPalette(ink: ThemeColor(red: 0, green: 0, blue: 0), accent: ThemeColor(red: 20, green: 90, blue: 200))

    func png(_ page: InkDocument = InkSamples.page(), pencilKit: Data? = nil) throws -> Data {
        try InkRenderer.pngData(of: page, palette: palette, scale: 2, pencilKit: pencilKit)
    }

    /// Replaces the payload of the first chunk of `type`, and writes the CRC that goes with it unless `keepCRC`.
    func patched(_ data: Data, chunk type: String, keepCRC: Bool = false, _ change: (inout Data) -> Void) throws -> Data {
        var out = data
        let chunk = try #require(try InkPNG.walk(data).first { $0.type == type })
        var body = Data(data[(chunk.start + 8)..<(chunk.end - 4)])
        change(&body)
        precondition(body.count == chunk.end - chunk.start - 12, "a patch keeps the payload's size")
        out.replaceSubrange((chunk.start + 8)..<(chunk.end - 4), with: body)
        if !keepCRC {
            var crc = InkPNG.crc(of: out[(chunk.start + 4)..<(chunk.end - 4)])
            withUnsafeBytes(of: &crc) { out.replaceSubrange((chunk.end - 4)..<chunk.end, with: Data($0.reversed())) }
        }
        return out
    }

    @Test func theStrokesComeBackFromThePNG() throws {
        let blob = Data((0..<5000).map { UInt8($0 % 251) })
        var contents = try InkPNG.contents(of: try png(pencilKit: blob))
        #expect(try contents.drawing() == InkSamples.page())
        #expect(contents.pencilKit == blob)
        #expect(contents.problems.isEmpty)
        contents = try InkPNG.contents(of: try png())
        #expect(contents.pencilKit == nil)
    }

    @Test func anyImageViewerStillSeesThePixels() throws {
        let data = try png()
        #expect(StoredImages.sniff(data) == .png)
        let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
        let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        #expect((image.width, image.height) == (400, 240))
        #expect(inkedPixelCount(image) > 500)
    }

    @Test func theChunksSitBeforeTheEnd() throws {
        let types = try InkPNG.walk(try png(pencilKit: Data([1, 2, 3]))).map(\.type)
        #expect(types.first == "IHDR")
        #expect(types.suffix(3) == ["inKJ", "inKP", "IEND"])
        #expect(types.contains("IDAT"))
        // Private, ancillary, and unsafe to copy: the name's four case bits.
        for name in [InkPNG.jsonChunk, InkPNG.pencilKitChunk] {
            let bytes = Array(name.utf8)
            #expect(bytes[0] & 0x20 != 0, "ancillary")
            #expect(bytes[1] & 0x20 != 0, "private")
            #expect(bytes[2] & 0x20 == 0, "reserved bit")
            #expect(bytes[3] & 0x20 == 0, "unsafe to copy")
        }
    }

    @Test func embeddingAgainReplacesTheOldChunks() throws {
        let first = try png(pencilKit: Data([9, 9, 9]))
        var other = InkSamples.page()
        other.strokes.removeLast()
        let second = try InkPNG.embedding(drawing: other, pencilKit: nil, in: first)
        let types = try InkPNG.walk(second).map(\.type)
        #expect(types.filter { $0 == "inKJ" }.count == 1)
        #expect(!types.contains("inKP"))
        #expect(try InkPNG.contents(of: second).drawing() == other)
        let bare = try InkPNG.embedding(drawing: nil, pencilKit: nil, in: second)
        #expect(try InkPNG.walk(bare).map(\.type).allSatisfy { $0 != "inKJ" && $0 != "inKP" })
        #expect(try InkPNG.contents(of: bare).drawing() == nil)
    }

    @Test func aDamagedChunkIsReportedAndThePixelsStay() throws {
        let data = try png(pencilKit: Data([1, 2, 3]))
        let flipped = try patched(data, chunk: "inKJ", keepCRC: true) { $0[$0.count - 3] ^= 0xFF }
        let contents = try InkPNG.contents(of: flipped)
        #expect(contents.strokeJSON == nil)
        #expect(contents.problems == ["The inKJ chunk is damaged."])
        #expect(contents.pencilKit == Data([1, 2, 3]))
        let source = try #require(CGImageSourceCreateWithData(flipped as CFData, nil))
        #expect(CGImageSourceCreateImageAtIndex(source, 0, nil) != nil)
    }

    @Test func aNewerChunkIsLeftAlone() throws {
        let data = try patched(try png(), chunk: "inKJ") { $0[0] = 2 }
        let contents = try InkPNG.contents(of: data)
        #expect(contents.strokeJSON == nil)
        #expect(contents.problems == ["The inKJ chunk is from a newer version."])
    }

    @Test func textThatDoesNotUnpackIsReported() throws {
        // Flip a byte inside the zlib stream and write the CRC to match, so the chunk is intact but its contents are not.
        let data = try patched(try png(), chunk: "inKJ") { $0[$0.count / 2] ^= 0x55 }
        let contents = try InkPNG.contents(of: data)
        #expect(contents.strokeJSON == nil)
        #expect(contents.problems == ["The inKJ chunk does not unpack."])
    }

    @Test func aLengthThatLiesIsRefused() throws {
        // The unpacked size is the first four bytes after the version; claim a size the stream does not hold.
        let data = try patched(try png(), chunk: "inKJ") { $0[1] = 0x10 }
        #expect(try InkPNG.contents(of: data).problems == ["The inKJ chunk does not unpack."])
        let huge = try patched(try png(), chunk: "inKJ") { $0[1] = 0xFF }
        #expect(try InkPNG.contents(of: huge).problems == ["The inKJ chunk does not unpack."])
    }

    @Test func somethingThatIsNotAPNGIsRefused() throws {
        #expect(throws: InkError.self) { try InkPNG.contents(of: Data("not a picture, but long enough to try".utf8)) }
        #expect(throws: InkError.self) { try InkPNG.contents(of: Data()) }
        let whole = try png()
        #expect(throws: InkError.self) { try InkPNG.contents(of: whole.prefix(whole.count - 20)) }
        #expect(throws: InkError.self) { try InkPNG.embedding(drawing: InkSamples.page(), pencilKit: nil, in: Data(repeating: 0, count: 64)) }
    }

    @Test func aPNGWithoutInkIsOrdinary() throws {
        let bare = try InkPNG.embedding(drawing: nil, pencilKit: nil, in: try png())
        let contents = try InkPNG.contents(of: bare)
        #expect(contents == InkPNG.Contents())
    }

    @Test func theTagNamesTheStoredPicture() throws {
        #expect(InkTag.markdown(forName: "trip-drawing-0123456789ab.png") == "<Ink src=\"app_data/trip-drawing-0123456789ab.png\" alt=\"Drawing\" width=\"80%\" />")
        #expect(InkTag.markdown(forName: "a.png", alt: "a \"quoted\" <b>\nname", width: "50%").contains("alt=\"a quoted bname\""))
        let text = "before\n\n<Ink src=\"app_data/old.png\" alt=\"Drawing\" width=\"80%\" />\n\nand again ![x](app_data/old.png)"
        let changed = InkTag.replacing("old.png", with: "new.png", in: text)
        #expect(changed.contains("app_data/new.png") && !changed.contains("old.png"))
    }

    @Test func aStoredFileIsOnlyInkIfItCarriesInk() throws {
        try withScratchFolder { folder in
            let withInk = folder.appendingPathComponent("a.png")
            try png().write(to: withInk)
            let plain = folder.appendingPathComponent("b.png")
            try InkPNG.embedding(drawing: nil, pencilKit: nil, in: try png()).write(to: plain)
            let notPNG = folder.appendingPathComponent("c.jpg")
            try Data([0xFF, 0xD8, 0xFF, 0xE0]).write(to: notPNG)
            #expect(InkTag.contents(ofFileAt: withInk)?.strokeJSON != nil)
            #expect(InkTag.contents(ofFileAt: plain) == nil)
            #expect(InkTag.contents(ofFileAt: notPNG) == nil)
            #expect(InkTag.contents(ofFileAt: folder.appendingPathComponent("missing.png")) == nil)
        }
    }
}

func withScratchFolder<T>(_ body: (URL) throws -> T) throws -> T {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("composition-ink-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    return try body(folder)
}
