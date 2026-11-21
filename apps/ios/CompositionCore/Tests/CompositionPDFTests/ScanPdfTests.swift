import CompositionCore
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import PDFKit
import Testing
import UniformTypeIdentifiers

@testable import CompositionPDF

// Pictures into an image-only PDF, and a scan's page back into a picture for reading (ScanPdf.swift).

private final class Folder {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("composition-scan-tests-\(UUID().uuidString)", isDirectory: true)
    init() throws { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true) }
    deinit { try? FileManager.default.removeItem(at: url) }
    func file(_ name: String) -> URL { url.appendingPathComponent(name) }
}

/// A white picture of `width` by `height` pixels with a black block in its stored top-left corner (a sixth of each side) and, if given, words.
private func picture(width: Int, height: Int, words: String? = nil, fontSize: CGFloat = 60) throws -> CGImage {
    let context = try #require(CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
    context.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.setFillColor(red: 0, green: 0, blue: 0, alpha: 1)
    context.fill(CGRect(x: 0, y: height - height / 6, width: width / 6, height: height / 6))
    if let words {
        let font = CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: words, attributes: [kCTFontAttributeName as NSAttributedString.Key: font]))
        context.textPosition = CGPoint(x: CGFloat(width) * 0.1, y: CGFloat(height) * 0.5)
        CTLineDraw(line, context)
    }
    return try #require(context.makeImage())
}

private func write(_ image: CGImage, to url: URL, type: UTType, properties: [CFString: Any] = [:]) throws {
    let destination = try #require(CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    #expect(CGImageDestinationFinalize(destination))
}

/// The share of dark pixels in each quarter of a grey picture: top-left, top-right, bottom-left, bottom-right (as seen).
private func darkQuarters(_ image: CGImage) -> [Double] {
    let width = image.width, height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height)
    let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    var dark = [0.0, 0, 0, 0]
    // Row 0 of the buffer is the top of the picture as seen.
    for row in 0..<height {
        for column in 0..<width where pixels[row * width + column] < 128 {
            dark[(row < height / 2 ? 0 : 2) + (column < width / 2 ? 0 : 1)] += 1
        }
    }
    let quarter = Double(width * height) / 4
    return dark.map { $0 / quarter }
}

@Suite("Scans: pictures into a PDF")
struct ScanPdfTests {
    @Test("a JPEG goes into the PDF as it is, and a page is the size of the paper its density says")
    func aJpegIsEmbeddedAsItIs() throws {
        let folder = try Folder()
        let jpeg = folder.file("page.jpg")
        // US Letter at 150 dots per inch.
        try write(try picture(width: 1275, height: 1650, words: "Lecture four"), to: jpeg, type: .jpeg, properties: [
            kCGImagePropertyDPIWidth: 150, kCGImagePropertyDPIHeight: 150, kCGImageDestinationLossyCompressionQuality: 0.7,
        ])
        let pdf = folder.file("scan.pdf")
        try ScanPdf.write([ScanPageSource(url: jpeg)], to: pdf, title: "Physics")

        let jpegSize = try #require(try FileManager.default.attributesOfItem(atPath: jpeg.path)[.size] as? Int)
        let pdfSize = try #require(try FileManager.default.attributesOfItem(atPath: pdf.path)[.size] as? Int)
        #expect(pdfSize < jpegSize + 8_000, "the JPEG's bytes and a little PDF around them: \(pdfSize) for a \(jpegSize)-byte JPEG")

        let document = try #require(PDFDocument(url: pdf))
        #expect(document.pageCount == 1)
        let box = try #require(document.page(at: 0)).bounds(for: .mediaBox)
        #expect(abs(box.width - 612) < 0.01 && abs(box.height - 792) < 0.01, "8.5 by 11 inches: \(box)")
        #expect(document.page(at: 0)?.string?.isEmpty ?? true, "an image-only page has no text of its own")
        #expect(document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String == "Physics")
    }

    @Test("a PNG with no density is made a JPEG, and its page is 11 inches on its long side")
    func aPngBecomesAJpegPage() throws {
        let folder = try Folder()
        let png = folder.file("page.png")
        try write(try picture(width: 1000, height: 1400), to: png, type: .png)
        let pdf = folder.file("scan.pdf")
        try ScanPdf.write([ScanPageSource(url: png)], to: pdf, title: "")
        let pngSize = try #require(try FileManager.default.attributesOfItem(atPath: png.path)[.size] as? Int)
        let pdfSize = try #require(try FileManager.default.attributesOfItem(atPath: pdf.path)[.size] as? Int)
        let box = try #require(PDFDocument(url: pdf)?.page(at: 0)).bounds(for: .mediaBox)
        #expect(abs(box.height - 792) < 0.01 && abs(box.width - 792 * 1000 / 1400) < 0.01, "\(box)")
        let data = try Data(contentsOf: pdf)
        #expect(data.range(of: Data("/DCTDecode".utf8)) != nil, "the page's picture is a JPEG (\(pdfSize) bytes from a \(pngSize)-byte PNG)")
    }

    @Test("pages keep their order, and something that is not a picture is named")
    func orderAndRefusal() throws {
        let folder = try Folder()
        var pages: [ScanPageSource] = []
        for (index, size) in [(800, 1000), (1000, 800), (600, 600)].enumerated() {
            let url = folder.file("p\(index).jpg")
            try write(try picture(width: size.0, height: size.1), to: url, type: .jpeg)
            pages.append(ScanPageSource(url: url))
        }
        let pdf = folder.file("scan.pdf")
        try ScanPdf.write(pages, to: pdf, title: "")
        let document = try #require(PDFDocument(url: pdf))
        #expect(document.pageCount == 3)
        let shapes = (0..<3).map { document.page(at: $0)!.bounds(for: .mediaBox) }.map { $0.width < $0.height ? "tall" : $0.width > $0.height ? "wide" : "square" }
        #expect(shapes == ["tall", "wide", "square"])

        let text = folder.file("notes.txt")
        try Data("not a picture".utf8).write(to: text)
        #expect(throws: ScanPdfError("Page 2, notes.txt: this is not a picture that can be read.")) {
            try ScanPdf.write([pages[0], ScanPageSource(url: text)], to: folder.file("bad.pdf"), title: "")
        }
        #expect(throws: ScanPdfError.self) { try ScanPdf.write([], to: folder.file("none.pdf"), title: "") }
    }

    @Test("every EXIF orientation and every turn the person gives stands the page up as the picture is seen")
    func orientations() throws {
        let folder = try Folder()
        // The stored picture is wide (1200 by 800) with its block in the stored top-left corner.
        let stored = try picture(width: 1200, height: 800)
        for orientation in 1...8 {
            let url = folder.file("o\(orientation).jpg")
            try write(stored, to: url, type: .jpeg, properties: [kCGImagePropertyOrientation: orientation])
            // What ImageIO itself shows for this file: the picture as a person sees it.
            let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil))
            let seen = try #require(CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 600,
            ] as CFDictionary))
            let seenQuarters = darkQuarters(seen)
            let seenCorner = try #require(seenQuarters.indices.max { seenQuarters[$0] < seenQuarters[$1] })

            for turns in 0..<4 {
                let pdf = folder.file("o\(orientation)-t\(turns).pdf")
                try ScanPdf.write([ScanPageSource(url: url, quarterTurns: turns)], to: pdf, title: "")
                let page = try #require(ScanPdf.pageImage(of: pdf, page: 0, longSide: 600))
                let quarters = darkQuarters(page.image)
                let corner = try #require(quarters.indices.max { quarters[$0] < quarters[$1] })
                // Corners clockwise: top-left 0, top-right 1, bottom-right 3, bottom-left 2.
                let clockwise = [0, 1, 3, 2]
                let expected = clockwise[(clockwise.firstIndex(of: seenCorner)! + turns) % 4]
                #expect(corner == expected, "orientation \(orientation), \(turns) turns: the block is in quarter \(corner), not \(expected)")
                let wideSeen = seen.width > seen.height
                let wideNow = page.image.width > page.image.height
                #expect(wideNow == (turns % 2 == 0 ? wideSeen : !wideSeen), "orientation \(orientation), \(turns) turns: the page's shape")
            }
        }
    }

    @Test("a line found in a page's picture is kept in the page's own PDF space")
    func linesMapToPdfSpace() throws {
        let folder = try Folder()
        let jpeg = folder.file("page.jpg")
        try write(try picture(width: 1275, height: 1650), to: jpeg, type: .jpeg, properties: [kCGImagePropertyDPIWidth: 150, kCGImagePropertyDPIHeight: 150])
        let pdf = folder.file("scan.pdf")
        try ScanPdf.write([ScanPageSource(url: jpeg)], to: pdf, title: "")
        let page = try #require(ScanPdf.pageImage(of: pdf, page: 0))
        #expect(max(page.image.width, page.image.height) == ScanPdf.readingLongSide)
        let lines = ScanRecognition.inputs(
            [ScanRecognizedLine(text: "x", confidence: 1, box: CGRect(x: 0.1, y: 0.8, width: 0.5, height: 0.05))],
            imageSize: CGSize(width: page.image.width, height: page.image.height), toPage: page.toPage)
        let rect = try #require(lines.first?.rect)
        for (got, wanted) in zip(rect, [61.2, 633.6, 367.2, 673.2]) { #expect(abs(got - wanted) < 0.5, "\(rect)") }
    }

    @Test("a page of a PDF with a crop box and a turn maps back to its own user space")
    func turnedAndCroppedPagesMapBack() throws {
        let document = try #require(CGPDFDocument(conformanceDirectory.appendingPathComponent("pdf-geometry.pdf") as CFURL))
        for index in 0..<document.numberOfPages {
            let page = try #require(document.page(at: index + 1))
            let picture = try #require(ScanPdf.pageImage(of: page, longSide: 1000))
            // The crop box's corners, through the picture and back, are where they started.
            let crop = page.getBoxRect(.cropBox)
            let pictureToPage = picture.toPage
            let pageToPicture = pictureToPage.inverted()
            for corner in [CGPoint(x: crop.minX, y: crop.minY), CGPoint(x: crop.maxX, y: crop.maxY)] {
                let there = corner.applying(pageToPicture)
                #expect(there.x >= -1 && there.y >= -1 && there.x <= CGFloat(picture.image.width) + 1 && there.y <= CGFloat(picture.image.height) + 1, "\(geometryNames[index])")
                let back = there.applying(pictureToPage)
                #expect(abs(back.x - corner.x) < 0.01 && abs(back.y - corner.y) < 0.01, "\(geometryNames[index])")
            }
        }
    }

    #if canImport(Vision)
    @Test("Vision reads the words on a scanned page, and its line lands where the words were drawn")
    func visionReadsAScan() async throws {
        let folder = try Folder()
        let jpeg = folder.file("page.jpg")
        try write(try picture(width: 1275, height: 1650, words: "Entropy always increases", fontSize: 64), to: jpeg, type: .jpeg, properties: [
            kCGImagePropertyDPIWidth: 150, kCGImagePropertyDPIHeight: 150,
        ])
        let pdf = folder.file("scan.pdf")
        try ScanPdf.write([ScanPageSource(url: jpeg)], to: pdf, title: "")
        let recognizer = VisionScanRecognizer()
        #expect(recognizer.engine.hasPrefix("apple-vision/text/"))
        // Vision needs an inference context that a virtual machine (a CI runner) may not have; where it cannot run, the test says so and
        // passes, as it has nothing to check (as InkTranscriptTests). A file that cannot be read (nil) is still a failure.
        let read: [RecognizedLineInput]?
        do { read = try await ScanRecognition.lines(ofPage: 0, in: pdf, using: recognizer) } catch {
            print("Vision cannot read text here, so this test checked nothing: \(error)")
            return
        }
        let lines = try #require(read)
        let line = try #require(lines.first { $0.text.lowercased().contains("entropy") }, "read: \(lines.map(\.text))")
        #expect(line.confidence >= ScanText.floor)
        // The words were drawn from 10 % across, with their baseline half way up: y = 396 points on a 792-point page.
        #expect(abs(line.rect[0] - 61.2) < 15, "\(line.rect)")
        #expect(line.rect[1] < 400 && line.rect[3] > 396, "\(line.rect)")
    }
    #endif
}
