import CompositionCore
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Scanned pages become an image-only PDF at import (docs/architecture/scans.md): one page per image, each the size of the paper it shows, so the
// PDF reader, Pencil ink, marks, bookmarks, `pdf:` links, export and backup all work on a scan as on any PDF. The file is never written again; the
// text read from it is kept beside it (`scan_lines`).
//
// CoreGraphics only (no UIKit), so it is tested on a Mac. A JPEG goes into the PDF as it is (its bytes, not decoded and encoded again); any other
// picture (HEIC, PNG, TIFF) is made a JPEG first, so a page costs what its JPEG costs.

/// One page to be: a picture file and a turn the person gave it in the import sheet (on top of the turn its EXIF says).
public struct ScanPageSource: Equatable, Sendable {
    public var url: URL
    /// Clockwise quarter turns: 0 to 3.
    public var quarterTurns: Int

    public init(url: URL, quarterTurns: Int = 0) {
        self.url = url
        self.quarterTurns = ((quarterTurns % 4) + 4) % 4
    }
}

/// Why a scan could not be made. The message is safe to show.
public struct ScanPdfError: Error, Equatable, LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public enum ScanPdf {
    /// The quality a picture that is not a JPEG is saved at. Handwriting on paper stays sharp at this and is a fraction of the size of a PNG.
    static let jpegQuality = 0.85
    /// A page whose picture says no believable density is made this tall (or wide) on its long side: US Letter's 11 inches, in points.
    static let defaultLongSide: CGFloat = 792
    /// Densities a scanner writes into a picture (dots per inch); outside these a picture's density is not believed (a phone photo says 72).
    static let believableDensity: ClosedRange<Double> = 100...1200

    // MARK: Making the PDF

    /// Writes the pages, in order, as an image-only PDF at `destination`. Throws `ScanPdfError` naming the first picture that cannot be read.
    public static func write(_ pages: [ScanPageSource], to destination: URL, title: String) throws {
        guard !pages.isEmpty else { throw ScanPdfError("A scan has at least one page.") }
        var info: [CFString: Any] = [kCGPDFContextCreator: "Benchnote"]
        if !title.isEmpty { info[kCGPDFContextTitle] = title }
        guard let context = CGContext(destination as CFURL, mediaBox: nil, info as CFDictionary) else {
            throw ScanPdfError("The scan could not be written.")
        }
        for (index, page) in pages.enumerated() {
            try autoreleasepool {
                let picture = try Picture(page.url, number: index + 1)
                let turned = picture.drawnSize(quarterTurns: page.quarterTurns)
                var box = CGRect(origin: .zero, size: turned)
                context.beginPage(mediaBox: &box)
                context.concatenate(picture.transform(quarterTurns: page.quarterTurns))
                context.draw(picture.image, in: CGRect(origin: .zero, size: picture.storedSize))
                context.endPage()
            }
        }
        context.closePDF()
    }

    /// A picture read for a page: its image as it is stored, how the stored pixels are to be turned to stand upright (EXIF), and its density.
    struct Picture {
        let image: CGImage
        /// EXIF orientation, 1 to 8.
        let orientation: Int
        /// The density the page is drawn at: the picture's own when believable.
        let pointsPerPixel: CGFloat

        init(_ url: URL, number: Int) throws {
            let name = DocumentNames.displayName(url.path)
            guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
                CGImageSourceGetCount(source) > 0,
                let original = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { throw ScanPdfError("Page \(number), \(name): this is not a picture that can be read.") }
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
            orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1

            if CGImageSourceGetType(source) as String? == UTType.jpeg.identifier {
                image = original
            } else {
                // Not a JPEG: encode it as one, and draw that, so the PDF holds a JPEG (CoreGraphics embeds a JPEG-backed image as it is).
                let data = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
                    throw ScanPdfError("Page \(number), \(name): could not be made into a page.")
                }
                CGImageDestinationAddImage(destination, original, [kCGImageDestinationLossyCompressionQuality: ScanPdf.jpegQuality] as CFDictionary)
                guard CGImageDestinationFinalize(destination), let jpeg = CGImageSourceCreateWithData(data, nil),
                    let decoded = CGImageSourceCreateImageAtIndex(jpeg, 0, nil)
                else { throw ScanPdfError("Page \(number), \(name): could not be made into a page.") }
                image = decoded
            }

            let dpi = (properties[kCGImagePropertyDPIWidth] as? NSNumber)?.doubleValue ?? 0
            let longSide = CGFloat(max(image.width, image.height))
            pointsPerPixel = ScanPdf.believableDensity.contains(dpi) ? CGFloat(72 / dpi) : ScanPdf.defaultLongSide / max(longSide, 1)
        }

        /// The stored picture's size in points.
        var storedSize: CGSize { CGSize(width: CGFloat(image.width) * pointsPerPixel, height: CGFloat(image.height) * pointsPerPixel) }

        /// Whether EXIF says the stored pixels lie on their side (orientations 5 to 8).
        var sideways: Bool { orientation >= 5 }

        /// The page's size once the picture stands upright and is turned as the person asked.
        func drawnSize(quarterTurns: Int) -> CGSize {
            let upright = sideways ? CGSize(width: storedSize.height, height: storedSize.width) : storedSize
            return quarterTurns % 2 == 1 ? CGSize(width: upright.height, height: upright.width) : upright
        }

        /// What takes the stored picture, drawn at the origin in `storedSize`, onto its page: EXIF's turn and mirror, then the person's turns.
        /// PDF space has y up, so these are the EXIF matrices for y up.
        func transform(quarterTurns: Int) -> CGAffineTransform {
            let w = storedSize.width, h = storedSize.height
            // The stored picture to upright, in a y-up space (the standard EXIF matrices, flipped for y up).
            let upright: CGAffineTransform
            switch orientation {
            case 2: upright = CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: w, ty: 0)          // mirrored left to right
            case 3: upright = CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: w, ty: h)         // upside down
            case 4: upright = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: h)          // mirrored top to bottom
            case 5: upright = CGAffineTransform(a: 0, b: -1, c: -1, d: 0, tx: h, ty: w)         // mirrored, turned
            case 6: upright = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: w)          // stored a quarter turn anticlockwise
            case 7: upright = CGAffineTransform(a: 0, b: 1, c: 1, d: 0, tx: 0, ty: 0)           // mirrored, turned the other way
            case 8: upright = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: h, ty: 0)          // stored a quarter turn clockwise
            default: upright = .identity
            }
            let uprightSize = sideways ? CGSize(width: h, height: w) : CGSize(width: w, height: h)
            // Then the person's clockwise quarter turns, each about the upright picture's size so far.
            var turn = CGAffineTransform.identity
            var size = uprightSize
            for _ in 0..<quarterTurns {
                // Clockwise on the page (y up): (x, y) goes to (y, width - x).
                turn = turn.concatenating(CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: size.width))
                size = CGSize(width: size.height, height: size.width)
            }
            return upright.concatenating(turn)
        }
    }

    // MARK: A page as a picture, for reading

    /// The most pixels on a page's long side when it is drawn for reading: about 300 dots per inch for US Letter, which is what scanners write and
    /// what reads well, and a size the iPad holds comfortably (11 MB as grey).
    public static let readingLongSide = 3300

    /// A page drawn for an engine to read: grey, white behind, at most `readingLongSide` pixels on its long side, and what takes a point of the
    /// picture (y up, in pixels) back to the page's raw PDF user space, where marks and lines are kept.
    public struct PageImage {
        public let image: CGImage
        public let toPage: CGAffineTransform
    }

    /// Draws page `index` (0-based) of the PDF at `url`, or nil when the file or the page cannot be read.
    public static func pageImage(of url: URL, page index: Int, longSide: Int = readingLongSide) -> PageImage? {
        guard let document = CGPDFDocument(url as CFURL), let page = document.page(at: index + 1) else { return nil }
        return pageImage(of: page, longSide: longSide)
    }

    public static func pageImage(of page: CGPDFPage, longSide: Int = readingLongSide) -> PageImage? {
        let box = page.getBoxRect(.cropBox)
        let rotated = page.rotationAngle % 180 != 0
        let shown = rotated ? CGSize(width: box.height, height: box.width) : box.size
        guard shown.width > 0, shown.height > 0 else { return nil }
        let scale = CGFloat(longSide) / max(shown.width, shown.height)
        let width = max(1, Int((shown.width * scale).rounded())), height = max(1, Int((shown.height * scale).rounded()))
        guard let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { return nil }
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        // The page's own transform into a rectangle of its shown size (it turns a turned page and moves a crop box to the origin), then the scale.
        let drawing = page.getDrawingTransform(.cropBox, rect: CGRect(origin: .zero, size: shown), rotate: 0, preserveAspectRatio: true)
        let pageToPicture = drawing.concatenating(CGAffineTransform(scaleX: CGFloat(width) / shown.width, y: CGFloat(height) / shown.height))
        context.concatenate(pageToPicture)
        context.drawPDFPage(page)
        guard let image = context.makeImage() else { return nil }
        return PageImage(image: image, toPage: pageToPicture.inverted())
    }
}

// MARK: - Reading the lines on a page

/// A line of text an engine found in a picture: its text, how sure it was (0 to 1), and its box in the picture's normalized space (0 to 1, origin
/// at the lower left, as Vision gives it).
public struct ScanRecognizedLine: Equatable, Sendable {
    public var text: String
    public var confidence: Double
    public var box: CGRect

    public init(text: String, confidence: Double, box: CGRect) { (self.text, self.confidence, self.box) = (text, confidence, box) }
}

/// Something that reads the lines of text in a page's picture. `VisionScanRecognizer` is the real one; tests give their own.
public protocol ScanTextRecognizing: Sendable {
    /// The name stored with every line it reads: the engine, its settings and the system it ran on.
    var engine: String { get }
    /// The lines in `image`, in reading order.
    func lines(in image: CGImage) async throws -> [ScanRecognizedLine]
}

public enum ScanRecognition {
    /// Reads page `index` of the scan at `url` and returns its lines as they are stored: each box in the page's raw PDF user space. Nil when the
    /// page cannot be drawn (the file is gone or damaged).
    public static func lines(ofPage index: Int, in url: URL, using recognizer: some ScanTextRecognizing) async throws -> [RecognizedLineInput]? {
        // Drawn and dropped before the engine's own memory peaks: only the picture is kept.
        guard let page = autoreleasepool(invoking: { ScanPdf.pageImage(of: url, page: index) }) else { return nil }
        let found = try await recognizer.lines(in: page.image)
        return inputs(found, imageSize: CGSize(width: page.image.width, height: page.image.height), toPage: page.toPage)
    }

    /// Lines in a picture's normalized space as lines on the page: each corner taken back through `toPage`, and the box around them.
    public static func inputs(_ lines: [ScanRecognizedLine], imageSize: CGSize, toPage: CGAffineTransform) -> [RecognizedLineInput] {
        lines.map { line in
            let pixels = CGRect(x: line.box.minX * imageSize.width, y: line.box.minY * imageSize.height, width: line.box.width * imageSize.width, height: line.box.height * imageSize.height)
            let box = pixels.applying(toPage)
            return RecognizedLineInput(rect: [box.minX, box.minY, box.maxX, box.maxY], text: line.text, confidence: line.confidence)
        }
    }
}

#if canImport(Vision)
import Vision

/// Apple's Vision reading a page: the accurate path with language correction, which is the path that reads handwriting at all (docs/scanned-notes-
/// ocr-research.md). `customWords` biases correction toward words the person uses (their own notes' words), and is used only with correction on.
public struct VisionScanRecognizer: ScanTextRecognizing {
    public let customWords: [String]

    public init(customWords: [String] = []) { self.customWords = customWords }

    public var engine: String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        #if os(iOS)
        let system = "iOS"
        #else
        let system = "macOS"
        #endif
        let revision = VNRecognizeTextRequest.currentRevision
        return "apple-vision/text/\(revision)/accurate/lc\(customWords.isEmpty ? "" : "+words")/\(system) \(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }

    public func lines(in image: CGImage) async throws -> [ScanRecognizedLine] {
        let words = customWords
        return try await Task.detached(priority: .utility) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            if !words.isEmpty { request.customWords = words }
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
            return (request.results ?? []).compactMap { observation in
                observation.topCandidates(1).first.map { ScanRecognizedLine(text: $0.string, confidence: Double($0.confidence), box: observation.boundingBox) }
            }
        }.value
    }
}
#endif
