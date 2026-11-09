import CompositionCore
import Foundation
import PDFKit
import Testing

@testable import CompositionPDF

// What happens to a PDF's own links in an exported copy: kept in a native one; lost in a flattened one (found out here rather than assumed, and said in the export sheet).

@Suite("A PDF's own links in an annotated copy")
struct LinksInTheCopyTests {
    private func pdfWithALink(in folder: URL) throws -> URL {
        let document = try makeTextPDF([["Go to the other page.", "Second line."], ["The other page."]])
        let first = try #require(document.page(at: 0))
        let link = PDFAnnotation(bounds: CGRect(x: 72, y: 700, width: 120, height: 14), forType: .link, withProperties: nil)
        link.destination = PDFDestination(page: try #require(document.page(at: 1)), at: CGPoint(x: 0, y: 700))
        first.addAnnotation(link)
        let url = folder.appendingPathComponent("linked.pdf")
        #expect(document.write(to: url))
        return url
    }

    @Test("a native copy keeps the link, and a flattened one loses it")
    func links() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("composition-links-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let source = try pdfWithALink(in: folder)
        #expect(PDFDocument(url: source)?.page(at: 0)?.annotations.contains { $0.type == "Link" } == true, "the test's PDF has its link")
        try withMarkWorld(pageCount: 2) { world in
            let mark = try world.add([PdfMarkInput(page: 0, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 72, y0: 698, x1: 200, y1: 714)], quote: "Go to the other page.")])
            let native = folder.appendingPathComponent("native.pdf"), flat = folder.appendingPathComponent("flat.pdf")
            try AnnotatedExport.export(source: source, password: nil, marks: mark, flatten: false, to: native)
            try AnnotatedExport.export(source: source, password: nil, marks: mark, flatten: true, to: flat)
            let nativeLinks = PDFDocument(url: native)?.page(at: 0)?.annotations.filter { $0.type == "Link" }.count ?? -1
            let flatLinks = PDFDocument(url: flat)?.page(at: 0)?.annotations.filter { $0.type == "Link" }.count ?? -1
            print("LINKS native copy: \(nativeLinks), flattened copy: \(flatLinks)")
            #expect(nativeLinks == 1, "a native copy keeps the PDF's own links")
            #expect(flatLinks == 0, "PDFKit's burn-in takes every annotation into the page, the PDF's own links with the marks (the desktop's flatten keeps them): \(flatLinks)")
        }
    }
}
