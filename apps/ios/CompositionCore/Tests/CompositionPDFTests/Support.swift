import CompositionCore
import Foundation
import PDFKit
import Testing

#if canImport(AppKit)
import AppKit
#endif

// Shared by the PDFKit tests: the nine-geometry PDF of spike C (fixtures/conformance/pdf-geometry.pdf), PDFs made on the fly, marks made through the
// real store, and a page drawn to pixels so a mark's place can be looked at.

/// fixtures/conformance, found from this file.
let conformanceDirectory: URL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("fixtures/conformance", isDirectory: true)

let geometryNames = ["plain", "rotate90", "rotate180", "rotate270", "crop", "media-offset", "crop+rotate90", "media-offset+crop+rotate270", "userunit2"]

func geometryDocument() throws -> PDFDocument {
    try #require(PDFDocument(url: conformanceDirectory.appendingPathComponent("pdf-geometry.pdf")), "fixtures/conformance/pdf-geometry.pdf is missing")
}

/// A scratch folder and a database with one PDF row, so that marks can be made the way the app makes them.
final class MarkWorld {
    let directory: URL
    let database: CompositionDatabase
    let store: NoteStore
    let document: StoredDocument

    init(pageCount: Int) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("composition-pdf-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        database = try CompositionDatabase.open(at: directory.appendingPathComponent("composition.db"))
        store = NoteStore(database: database)
        let note = try store.createNote(title: "Book")
        document = try database.addDocument(noteId: note.id, fileName: "book.pdf", storedName: "aaaaaaaaaaaa-book.pdf", sha256: String(repeating: "a", count: 64), size: 1, pageCount: pageCount)
    }

    func add(_ inputs: [PdfMarkInput]) throws -> [PdfMark] { try store.addAnnotations(documentId: document.id, inputs) }

    func finish() {
        try? database.close()
        try? FileManager.default.removeItem(at: directory)
    }
}

func withMarkWorld<T>(pageCount: Int = 9, _ body: (MarkWorld) throws -> T) throws -> T {
    let world = try MarkWorld(pageCount: pageCount)
    defer { world.finish() }
    return try body(world)
}

// MARK: Pixels

struct Pixels {
    let width: Int
    let height: Int
    let data: [UInt8]

    func at(_ x: Int, _ y: Int) -> (r: Int, g: Int, b: Int) {
        let i = (y * width + x) * 4
        return (Int(data[i]), Int(data[i + 1]), Int(data[i + 2]))
    }

    /// The extent of the pixels `test` picks, in points (the render is `scale` pixels to a point), top-left origin; nil when none.
    func extent(scale: Double, where test: (Int, Int, Int) -> Bool) -> CGRect? {
        var (x0, y0, x1, y1) = (width, height, -1, -1)
        for y in 0..<height {
            for x in 0..<width {
                let c = at(x, y)
                if test(c.r, c.g, c.b) { (x0, y0, x1, y1) = (min(x0, x), min(y0, y), max(x1, x + 1), max(y1, y + 1)) }
            }
        }
        guard x1 >= 0 else { return nil }
        return CGRect(x: Double(x0) / scale, y: Double(y0) / scale, width: Double(x1 - x0) / scale, height: Double(y1 - y0) / scale)
    }

    /// The extent of what differs from `other` by more than `tolerance` (summed over the three channels).
    func changedExtent(from other: Pixels, scale: Double, tolerance: Int = 30) -> CGRect? {
        var (x0, y0, x1, y1) = (width, height, -1, -1)
        for y in 0..<height {
            for x in 0..<width {
                let a = at(x, y), b = other.at(x, y)
                if abs(a.r - b.r) + abs(a.g - b.g) + abs(a.b - b.b) > tolerance { (x0, y0, x1, y1) = (min(x0, x), min(y0, y), max(x1, x + 1), max(y1, y + 1)) }
            }
        }
        guard x1 >= 0 else { return nil }
        return CGRect(x: Double(x0) / scale, y: Double(y0) / scale, width: Double(x1 - x0) / scale, height: Double(y1 - y0) / scale)
    }

    /// How many pixels differ from `other` by more than `tolerance`.
    func differing(from other: Pixels, tolerance: Int = 40) -> Int {
        var count = 0
        for i in stride(from: 0, to: min(data.count, other.data.count), by: 4) {
            if abs(Int(data[i]) - Int(other.data[i])) + abs(Int(data[i + 1]) - Int(other.data[i + 1])) + abs(Int(data[i + 2]) - Int(other.data[i + 2])) > tolerance { count += 1 }
        }
        return count
    }
}

let renderScale = 2.0

/// The page as PDFKit draws it (its marks included), at two pixels to a point, with the rotation applied and the crop box as the page.
func render(_ page: PDFPage) -> Pixels {
    let crop = page.bounds(for: .cropBox)
    let turned = page.rotation % 180 != 0
    let size = CGSize(width: (turned ? crop.height : crop.width) * renderScale, height: (turned ? crop.width : crop.height) * renderScale)
    let image = page.thumbnail(of: size, for: .cropBox)
    var rect = CGRect(origin: .zero, size: image.size)
    let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
    let (w, h) = (cg.width, cg.height)
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let context = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: w, height: h))
    context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    return Pixels(width: w, height: h, data: data)
}

/// Black text pixels (the red square of the fixture is not black).
func isInk(_ r: Int, _ g: Int, _ b: Int) -> Bool { r < 110 && g < 110 && b < 110 }

// MARK: A text PDF made on the fly

/// A PDF of Helvetica 12 pt lines, one array of lines to a page, each line 20 points below the one before, starting 72 points from the top.
func makeTextPDF(_ pages: [[String]], pageSize: CGSize = CGSize(width: 612, height: 792)) throws -> PDFDocument {
    var objects: [Data] = [Data("<< /Type /Catalog /Pages 2 0 R >>".utf8)]
    let kids = pages.indices.map { "\(3 + 2 * $0) 0 R" }.joined(separator: " ")
    objects.append(Data("<< /Type /Pages /Kids [\(kids)] /Count \(pages.count) >>".utf8))
    let font = 3 + 2 * pages.count
    for (index, lines) in pages.enumerated() {
        objects.append(Data("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 \(Int(pageSize.width)) \(Int(pageSize.height))] /Resources << /Font << /F1 \(font) 0 R >> >> /Contents \(4 + 2 * index) 0 R >>".utf8))
        var stream = "BT /F1 12 Tf 14 TL 72 \(Int(pageSize.height) - 72) Td\n"
        for line in lines { stream += "(\(line)) Tj T*\n" }
        stream += "ET"
        objects.append(Data("<< /Length \(stream.utf8.count) >>\nstream\n\(stream)\nendstream".utf8))
    }
    objects.append(Data("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".utf8))
    var out = Data("%PDF-1.6\n".utf8)
    var offsets: [Int] = []
    for (number, body) in objects.enumerated() {
        offsets.append(out.count)
        out.append(Data("\(number + 1) 0 obj\n".utf8))
        out.append(body)
        out.append(Data("\nendobj\n".utf8))
    }
    let xref = out.count
    var table = "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
    for offset in offsets { table += String(format: "%010d 00000 n \n", offset) }
    table += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n"
    out.append(Data(table.utf8))
    return try #require(PDFDocument(data: out))
}
