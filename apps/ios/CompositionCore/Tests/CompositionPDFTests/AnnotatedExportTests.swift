import CompositionCore
import CompositionInk
import Foundation
import PDFKit
import Testing

@testable import CompositionPDF

// Export annotated PDF on the iPad: the copy has the marks as native annotations other apps read, or burned into the pages; the original is never
// written; a protected PDF's copy is protected with the same password; a failure leaves no half a file.

@Suite("Export annotated PDF")
struct AnnotatedExportTests {
    private let source = conformanceDirectory.appendingPathComponent("pdf-geometry.pdf")

    private func scratch() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("composition-export-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// One of each kind of mark on the first `pages` pages of the geometry fixture, made as the app makes them.
    private func marks(in world: MarkWorld, pages: Int = 9) throws -> [PdfMark] {
        let document = try geometryDocument()
        var inputs: [PdfMarkInput] = []
        for index in 0..<pages {
            let selection = try #require(document.findString("ANCHOR TEXT", withOptions: []).first { $0.pages.contains(document.page(at: index)!) })
            inputs += SelectionMarks.inputs(for: selection, in: document, kind: index % 3 == 0 ? .highlight : index % 3 == 1 ? .underline : .strikethrough, color: PdfMarkup.markColors[index % 5])
        }
        inputs.append(SelectionMarks.textNote(page: 0, box: PdfRect(x0: 300, y0: 500, x1: 500, y1: 556), text: "Remember — Привет, Ω ≤ 5", color: "orange"))
        // One at a time: several in one call are one selection that crossed pages, and a typed note is not part of one.
        return try inputs.flatMap { try world.add([$0]) }
    }

    @Test("a native copy holds the marks as annotations with their uuids and words, and draws as the reader does")
    func native() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        try withMarkWorld { world in
            let made = try marks(in: world)
            let target = folder.appendingPathComponent("out.pdf")
            let outcome = try AnnotatedExport.export(source: source, password: nil, marks: made, flatten: false, to: target)
            #expect(outcome == AnnotatedExport.Outcome(written: 10, inkPages: 0, skippedInk: 0, skippedOffPage: 0, passwordProtected: false))

            let copy = try #require(PDFDocument(url: target))
            #expect(copy.pageCount == 9)
            var found: [String: PDFAnnotation] = [:]
            for index in 0..<copy.pageCount {
                for annotation in copy.page(at: index)?.annotations ?? [] { if let uuid = MarkAnnotations.markUuid(of: annotation) { found[uuid] = annotation } }
            }
            #expect(Set(found.keys) == Set(made.map(\.uuid)), "every mark is a native annotation, named by its uuid")
            let types = Set(found.values.compactMap(\.type))
            #expect(types == ["Highlight", "Underline", "StrikeOut", "FreeText"], "\(types)")
            let note = try #require(found[made.last!.uuid])
            #expect(note.contents == "Remember — Привет, Ω ≤ 5", "Latin, Greek, Cyrillic and symbols are kept: PDFKit draws them with the system's fonts")
            #expect(found.values.allSatisfy { $0.userName == MarkAnnotations.author }, "the device owner's name is not written into the copy")

            // Drawn as the reader draws them: page 0 of the copy against the original with the same marks added in memory.
            let original = try geometryDocument()
            let layer = MarkLayer(document: original)
            layer.show(made)
            for index in [0, 1, 2, 6] {
                let expected = render(try #require(original.page(at: index))), actual = render(try #require(copy.page(at: index)))
                // The one difference seen: PDFKit draws a typed note's border a little heavier once it has been written (page 0 has the note, about 1,000 pixels).
                let allowed = index == 0 ? 1_500 : 60
                #expect(actual.differing(from: expected) < allowed, "\(geometryNames[index]): the copy draws as the reader does (\(actual.differing(from: expected)) pixels differ)")
            }
        }
    }

    @Test("a mark's comment is the annotation's contents in the copy")
    func comment() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        try withMarkWorld { world in
            let mark = try world.add([PdfMarkInput(page: 0, kind: .highlight, color: "pink", rects: [PdfRect(x0: 100, y0: 300, x1: 272, y1: 318)], quote: "ANCHOR TEXT", comment: "see the proof")])[0]
            let target = folder.appendingPathComponent("out.pdf")
            try AnnotatedExport.export(source: source, password: nil, marks: [mark], flatten: false, to: target)
            let annotation = try #require(PDFDocument(url: target)?.page(at: 0)?.annotations.first { MarkAnnotations.markUuid(of: $0) == mark.uuid })
            #expect(annotation.contents == "see the proof")
            #expect(annotation.bounds == CGRect(x: 100, y: 300, width: 172, height: 18))
        }
    }

    @Test("a flattened copy has the marks burned in: no annotations, the text still text, and the page looks as it does with the marks")
    func flattened() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        try withMarkWorld { world in
            let made = try marks(in: world)
            let target = folder.appendingPathComponent("flat.pdf")
            let outcome = try AnnotatedExport.export(source: source, password: nil, marks: made, flatten: true, to: target)
            #expect(outcome.written == 10)
            let copy = try #require(PDFDocument(url: target))
            for index in 0..<copy.pageCount {
                let page = try #require(copy.page(at: index))
                #expect(page.annotations.allSatisfy { MarkAnnotations.markUuid(of: $0) == nil }, "\(geometryNames[index]): no mark is left as an annotation")
                #expect((page.string ?? "").contains("ANCHOR TEXT"), "\(geometryNames[index]): the text is still text")
            }
            let original = try geometryDocument()
            let plain = (0..<original.pageCount).map { render(original.page(at: $0)!) }
            let layer = MarkLayer(document: original)
            layer.show(made)
            for index in 0..<copy.pageCount {
                let expected = render(original.page(at: index)!), actual = render(copy.page(at: index)!)
                #expect(actual.differing(from: plain[index]) > 100, "\(geometryNames[index]): the marks are in the page")
                #expect(actual.differing(from: expected) < (index == 0 ? 1_500 : 400), "\(geometryNames[index]): and look as the reader draws them (\(actual.differing(from: expected)) pixels differ)")
            }
        }
    }

    @Test("the original is never written to, and the copy cannot be put over it")
    func originalIsKept() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        let original = folder.appendingPathComponent("original.pdf")
        try FileManager.default.copyItem(at: source, to: original)
        let before = try Data(contentsOf: original)
        try withMarkWorld { world in
            let made = try marks(in: world)
            #expect(throws: AnnotatedExport.Failure.wouldOverwriteTheOriginal) { try AnnotatedExport.export(source: original, password: nil, marks: made, flatten: false, to: original) }
            let link = folder.appendingPathComponent("link.pdf")
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: original)
            #expect(throws: AnnotatedExport.Failure.wouldOverwriteTheOriginal, "a symbolic link to it is it") { try AnnotatedExport.export(source: original, password: nil, marks: made, flatten: false, to: link) }
            try AnnotatedExport.export(source: original, password: nil, marks: made, flatten: false, to: folder.appendingPathComponent("copy.pdf"))
            #expect(try Data(contentsOf: original) == before)
        }
    }

    @Test("a mark on a page the PDF does not have is counted; a failure leaves nothing behind")
    func skipsAndFailures() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        try withMarkWorld(pageCount: 0) { world in
            let ink = try world.add([PdfMarkInput(page: 0, kind: .ink, color: "blue", body: .array([]))])  // not a mark of the list: ignored here
            let high = try world.add([PdfMarkInput(page: 40, kind: .highlight, color: "green", rects: [PdfRect(x0: 1, y0: 1, x1: 9, y1: 9)], quote: "x")])
            let fine = try world.add([PdfMarkInput(page: 1, kind: .highlight, color: "green", rects: [PdfRect(x0: 1, y0: 1, x1: 9, y1: 9)], quote: "y")])
            let target = folder.appendingPathComponent("out.pdf")
            let outcome = try AnnotatedExport.export(source: source, password: nil, marks: ink + high + fine, flatten: false, to: target)
            #expect(outcome.written == 1 && outcome.inkPages == 0 && outcome.skippedInk == 0 && outcome.skippedOffPage == 1)

            let missing = folder.appendingPathComponent("missing.pdf")
            #expect(throws: AnnotatedExport.Failure.cannotOpen) { try AnnotatedExport.export(source: missing, password: nil, marks: [], flatten: false, to: folder.appendingPathComponent("m.pdf")) }
            let unwritable = folder.appendingPathComponent("no-such-folder/out.pdf")
            #expect(throws: AnnotatedExport.Failure.cannotWrite) { try AnnotatedExport.export(source: source, password: nil, marks: fine, flatten: false, to: unwritable) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: folder.path).sorted() == ["out.pdf"], "no half-written copy is left")
        }
    }

    @Test("a page's ink is written as Ink annotations in a native copy and burned in by a flattened one, where it was drawn; a page it cannot read is counted")
    func ink() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        let blue = ThemeColor(red: 0, green: 0, blue: 255)
        func page(_ index: Int, in document: PDFDocument) -> InkDocument {
            let crop = document.page(at: index)!.bounds(for: .cropBox)
            let points = [InkPoint(x: 20, y: 20, width: 6, height: 6), InkPoint(x: 70, y: 20, width: 6, height: 6), InkPoint(x: 120, y: 20, width: 6, height: 6)]
            return InkDocument(width: Double(crop.width), height: Double(crop.height), strokes: [InkStroke(ink: .pen, color: .fixed(blue), points: points)])
        }
        let original = try geometryDocument()
        let drawings = [0: page(0, in: original), 3: page(3, in: original)]
        let reader: @Sendable (Int) throws -> InkDocument? = { [drawings] in drawings[$0] }  // page 5 is "damaged": nil

        let native = folder.appendingPathComponent("native.pdf")
        let outcome = try AnnotatedExport.export(source: source, password: nil, marks: [], inkPages: [0, 3, 5, 40], ink: reader, flatten: false, to: native)
        #expect(outcome.inkPages == 2 && outcome.skippedInk == 1 && outcome.skippedOffPage == 1 && outcome.written == 0, "\(outcome)")
        let copy = try #require(PDFDocument(url: native))
        for index in [0, 3] {
            let inks = (copy.page(at: index)?.annotations ?? []).filter { $0.type == "Ink" }
            #expect(inks.count == 1 && inks[0].userName == MarkAnnotations.author, "page \(index + 1): one Ink annotation, by the app and not the device's owner")
        }
        let untouched = (copy.page(at: 1)?.annotations ?? []).filter { $0.type == "Ink" }
        #expect(untouched.isEmpty, "a page with no ink has no Ink annotation")
        let isBlue: (Int, Int, Int) -> Bool = { r, g, b in b > 180 && r < 90 && g < 90 }
        let nativePage = render(try #require(copy.page(at: 0)))
        let flatTarget = folder.appendingPathComponent("flat.pdf")
        _ = try AnnotatedExport.export(source: source, password: nil, marks: [], inkPages: [0, 3], ink: reader, flatten: true, to: flatTarget)
        let flat = try #require(PDFDocument(url: flatTarget))
        #expect((flat.page(at: 0)?.annotations ?? []).isEmpty, "burned into the page: nothing left to edit")
        let flatPage = render(try #require(flat.page(at: 0)))
        for (name, pixels) in [("native", nativePage), ("flattened", flatPage)] {
            let found = try #require(pixels.extent(scale: renderScale, where: isBlue), "\(name): the stroke is drawn")
            #expect(abs(found.minX - 17) <= 2.5 && abs(found.maxX - 123) <= 2.5 && abs(found.minY - 17) <= 2.5 && abs(found.maxY - 23) <= 2.5, "\(name): \(found)")
        }
        // The turned page (index 3 is rotate270): the corner is the bottom-left one.
        let turned = render(try #require(flat.page(at: 3)))
        let found = try #require(turned.extent(scale: renderScale, where: isBlue))
        #expect(abs(found.minX - 17) <= 2.5 && abs(found.maxY - (Double(turned.height) / renderScale - 20 + 3)) <= 2.5, "rotate270 flattened: \(found)")
        #expect(try FileManager.default.contentsOfDirectory(atPath: folder.path).sorted() == ["flat.pdf", "native.pdf"])
    }

    @Test("a protected PDF is exported with its password and the copy is protected with the same one")
    func protectedPdf() throws {
        let folder = try scratch()
        defer { try? FileManager.default.removeItem(at: folder) }
        let locked = folder.appendingPathComponent("locked.pdf")
        let document = try geometryDocument()
        #expect(document.write(to: locked, withOptions: [.userPasswordOption: "open sesame", .ownerPasswordOption: "owner secret"]))
        #expect(PDFDocument(url: locked)?.isLocked == true)

        try withMarkWorld { world in
            let mark = try world.add([PdfMarkInput(page: 0, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 100, y0: 300, x1: 272, y1: 318)], quote: "ANCHOR TEXT")])
            let target = folder.appendingPathComponent("out.pdf")
            #expect(throws: AnnotatedExport.Failure.needsPassword) { try AnnotatedExport.export(source: locked, password: nil, marks: mark, flatten: false, to: target) }
            #expect(throws: AnnotatedExport.Failure.wrongPassword) { try AnnotatedExport.export(source: locked, password: "nope", marks: mark, flatten: false, to: target) }
            #expect(!FileManager.default.fileExists(atPath: target.path))

            let outcome = try AnnotatedExport.export(source: locked, password: "open sesame", marks: mark, flatten: false, to: target)
            #expect(outcome.passwordProtected && outcome.written == 1)
            let copy = try #require(PDFDocument(url: target))
            #expect(copy.isLocked, "the copy asks for a password")
            #expect(!copy.unlock(withPassword: "nope"))
            #expect(copy.unlock(withPassword: "open sesame"), "and the same one opens it")
            #expect(copy.page(at: 0)?.annotations.contains { MarkAnnotations.markUuid(of: $0) == mark[0].uuid } == true)
            let text = try #require(copy.page(at: 0)?.string)
            #expect(text.contains("ANCHOR TEXT"), "once opened it reads")
        }
    }
}
