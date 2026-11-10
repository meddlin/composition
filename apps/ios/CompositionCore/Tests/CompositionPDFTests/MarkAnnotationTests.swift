import CompositionCore
import PDFKit
import Testing

@testable import CompositionPDF

// A mark stored in raw PDF user space is drawn by PDFKit where the text is, on every page geometry: the check spike C made with a hand-built
// annotation, now made with the code the reader uses (a selection turned into a mark, the mark into annotations).

@Suite("Marks drawn by PDFKit")
struct MarkAnnotationTests {
    /// "ANCHOR TEXT" on a page of the geometry fixture, as the selection PDFKit finds.
    private func anchor(in document: PDFDocument, page: PDFPage) throws -> PDFSelection {
        try #require(document.findString("ANCHOR TEXT", withOptions: []).first { $0.pages.contains(page) })
    }

    @Test("a highlight, an underline and a strikethrough made from a selection land on the text on all nine page geometries")
    func landOnTheText() throws {
        let document = try geometryDocument()
        #expect(document.pageCount == 9)
        for index in 0..<document.pageCount {
            let page = try #require(document.page(at: index))
            let name = geometryNames[index]
            let selection = try anchor(in: document, page: page)
            let base = render(page)
            let text = try #require(base.extent(scale: renderScale, where: isInk), "\(name): the fixture's text is drawn")

            for kind in [PdfMarkKind.highlight, .underline, .strikethrough] {
                let inputs = SelectionMarks.inputs(for: selection, in: document, kind: kind, color: "yellow")
                #expect(inputs.count == 1 && inputs[0].page == index, "\(name): one mark, on its page")
                let rect = try #require(inputs.first?.rects?.first)
                // Spike C: x and width agree with pdf.js on every page, whatever its rotation.
                #expect(abs(rect.x0 - 100) < 1 && abs((rect.x1 - rect.x0) - 172) < 3, "\(name): the raw rectangle starts at x 100 and is about 172 wide: \(rect)")
                #expect(inputs[0].quote == "ANCHOR TEXT")

                try withMarkWorld { world in
                    let marks = try world.add(inputs)
                    let layer = MarkLayer(document: document)
                    layer.show(marks)
                    defer { layer.show([]) }
                    #expect(layer.annotations(for: marks[0].uuid).count == 1)
                    let marked = render(page)
                    let changed = try #require(marked.changedExtent(from: base, scale: renderScale), "\(name) \(kind): the mark changes the page")
                    // On a page turned a quarter the line runs up or down the screen, so look along the line and across it.
                    let along: (CGRect) -> ClosedRange<Double> = text.width >= text.height ? { $0.minX...$0.maxX } : { $0.minY...$0.maxY }
                    let across: (CGRect) -> ClosedRange<Double> = text.width >= text.height ? { $0.minY...$0.maxY } : { $0.minX...$0.maxX }
                    let slack = 2.5
                    #expect(along(changed).lowerBound <= along(text).lowerBound + slack && along(changed).upperBound >= along(text).upperBound - slack, "\(name) \(kind): along the text: marks \(changed), text \(text)")
                    let thickness = across(text).upperBound - across(text).lowerBound
                    let centre = { (r: ClosedRange<Double>) in (r.lowerBound + r.upperBound) / 2 }
                    let markThickness = across(changed).upperBound - across(changed).lowerBound
                    switch kind {
                    case .highlight:
                        #expect(across(changed).lowerBound <= across(text).lowerBound + slack && across(changed).upperBound >= across(text).upperBound - slack, "\(name) highlight: around the text: \(changed) vs \(text)")
                        #expect(markThickness < thickness + 18 && along(changed).upperBound - along(changed).lowerBound < along(text).upperBound - along(text).lowerBound + 12, "\(name) highlight: not far past it: \(changed) vs \(text)")
                    case .underline:
                        #expect(markThickness < thickness && abs(centre(across(changed)) - centre(across(text))) < thickness, "\(name) underline: a thin line by the text: \(changed) vs \(text)")
                    default:
                        #expect(markThickness < thickness && abs(centre(across(changed)) - centre(across(text))) < thickness / 2, "\(name) strikethrough: a thin line through it: \(changed) vs \(text)")
                    }
                }
            }
        }
    }

    @Test("the annotation carries what the mark says: its kind, uuid, colour, comment and lines relative to its bounds")
    func annotationContents() throws {
        try withMarkWorld { world in
            let lines = [PdfRect(x0: 100, y0: 300, x1: 272, y1: 318), PdfRect(x0: 100, y0: 282, x1: 200, y1: 300)]
            let mark = try world.add([PdfMarkInput(page: 0, kind: .highlight, color: "green", rects: lines, quote: "two lines", comment: "check this")])[0]
            let annotation = try #require(MarkAnnotations.annotations(for: mark).first)
            #expect(annotation.type == "Highlight")
            #expect(MarkAnnotations.markUuid(of: annotation) == mark.uuid)
            #expect(annotation.contents == "check this" && annotation.userName == MarkAnnotations.author)
            #expect(annotation.bounds == CGRect(x: 100, y: 282, width: 172, height: 36))
            // Top-left, top-right, bottom-left, bottom-right of each line, relative to the bounds' origin (spike C).
            let quad = (annotation.quadrilateralPoints ?? []).map { $0.pointValue }
            #expect(quad.count == 8)
            #expect(quad[0] == CGPoint(x: 0, y: 36) && quad[1] == CGPoint(x: 172, y: 36) && quad[2] == CGPoint(x: 0, y: 18) && quad[3] == CGPoint(x: 172, y: 18))
            #expect(quad[4] == CGPoint(x: 0, y: 18) && quad[7] == CGPoint(x: 100, y: 0))
            let green = PdfMarkPaint.paint(for: "green")
            #expect(annotation.color.usingColorSpace(.sRGB).map { abs($0.alphaComponent - CGFloat(green.alpha)) < 0.01 } == true)

            let underline = try world.add([PdfMarkInput(page: 0, kind: .underline, color: "pink", rects: [lines[0]])])[0]
            #expect(try #require(MarkAnnotations.annotations(for: underline).first).type == "Underline")
            let strike = try world.add([PdfMarkInput(page: 0, kind: .strikethrough, color: "blue", rects: [lines[0]])])[0]
            #expect(try #require(MarkAnnotations.annotations(for: strike).first).type == "StrikeOut")
        }
    }

    @Test("a typed note is a FreeText annotation with its words, box and font; ink has no annotation")
    func typedNote() throws {
        try withMarkWorld { world in
            let box = PdfRect(x0: 400, y0: 600, x1: 560, y1: 656)
            let note = try world.add([SelectionMarks.textNote(page: 0, box: box, text: "Remember the second proof", color: "orange", fontSize: 14)])[0]
            let annotation = try #require(MarkAnnotations.annotations(for: note).first)
            #expect(annotation.type == "FreeText" && annotation.contents == "Remember the second proof")
            #expect(annotation.bounds == CGRect(x: 400, y: 600, width: 160, height: 56))
            #expect(annotation.font?.pointSize == 14)
            #expect(MarkAnnotations.markUuid(of: annotation) == note.uuid)

            let ink = try world.add([PdfMarkInput(page: 0, kind: .ink, color: "blue", body: .array([]))])[0]
            #expect(MarkAnnotations.annotations(for: ink).isEmpty)
        }
    }

    @Test("a typed note is drawn on the page, in its box")
    func typedNoteIsDrawn() throws {
        let document = try geometryDocument()
        let page = try #require(document.page(at: 0))
        let base = render(page)
        try withMarkWorld { world in
            let box = PdfRect(x0: 300, y0: 500, x1: 500, y1: 556)
            let note = try world.add([SelectionMarks.textNote(page: 0, box: box, text: "Hello there", color: "yellow")])[0]
            let layer = MarkLayer(document: document)
            layer.show([note])
            defer { layer.show([]) }
            let changed = try #require(render(page).changedExtent(from: base, scale: renderScale))
            // The page is 792 points tall, drawn top-down: the box (y 500 to 556) is 236 to 292 from the top.
            #expect(abs(changed.minX - 300) < 3 && abs(changed.maxX - 500) < 3, "across its box: \(changed)")
            #expect(abs(changed.minY - 236) < 3 && abs(changed.maxY - 292) < 3, "down its box: \(changed)")
        }
    }

    @Test("a selection that runs over lines and pages makes one mark per page with a rectangle per line, and its words")
    func selectionsOverLinesAndPages() throws {
        let document = try makeTextPDF([["First line of page one.", "Second line of page one.", "Third line."], ["Top of page two.", "Next line."]])
        let first = try #require(document.page(at: 0)), second = try #require(document.page(at: 1))
        let selection = try #require(document.selection(from: first, atCharacterIndex: 0, to: second, atCharacterIndex: (second.string ?? "").count - 1))
        let inputs = SelectionMarks.inputs(for: selection, in: document, kind: .highlight, color: "blue")
        #expect(inputs.map(\.page) == [0, 1])
        #expect(inputs[0].rects?.count == 3 && inputs[1].rects?.count == 2, "a rectangle for each line: \(inputs.map { $0.rects?.count ?? 0 })")
        #expect(inputs[0].quote == "First line of page one. Second line of page one. Third line.", "\(inputs[0].quote)")
        #expect(inputs[1].quote.hasPrefix("Top of page two.") && inputs[1].quote.contains("Next line"), "\(inputs[1].quote)")
        // The lines are in order down the page, each below the one before (PDF y runs up).
        let ys = (inputs[0].rects ?? []).map(\.y0)
        #expect(ys == ys.sorted(by: >), "\(ys)")

        try withMarkWorld(pageCount: 2) { world in
            let marks = try world.add(inputs)
            #expect(marks.count == 2 && marks[0].groupUuid != nil && marks[0].groupUuid == marks[1].groupUuid, "stored as one selection")
        }
    }

    @Test("a selection of nothing makes no mark; a stray sliver is not a line")
    func emptySelection() throws {
        let document = try makeTextPDF([["Only line."]])
        #expect(SelectionMarks.inputs(for: PDFSelection(document: document), in: document, kind: .highlight, color: "yellow").isEmpty)
        let selection = try #require(document.findString("line", withOptions: []).first)
        #expect(SelectionMarks.inputs(for: selection, in: document, kind: .highlight, color: "yellow").count == 1)
        #expect(SelectionMarks.inputs(for: selection, in: document, kind: .text, color: "yellow").isEmpty, "a typed note is not made from a selection")
    }

    @Test("the layer follows the stored marks: draws new ones, redraws a changed one, takes off the rest, leaves the page's own links")
    func layerFollows() throws {
        let document = try geometryDocument()
        let page = try #require(document.page(at: 0))
        let link = PDFAnnotation(bounds: CGRect(x: 10, y: 10, width: 40, height: 10), forType: .link, withProperties: nil)
        page.addAnnotation(link)
        defer { page.removeAnnotation(link) }
        let before = page.annotations.count

        try withMarkWorld { world in
            let marks = try world.add([
                PdfMarkInput(page: 0, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 100, y0: 300, x1: 200, y1: 318)], quote: "a"),
                PdfMarkInput(page: 0, kind: .underline, color: "blue", rects: [PdfRect(x0: 100, y0: 280, x1: 200, y1: 296)], quote: "b"),
                PdfMarkInput(page: 8, kind: .strikethrough, color: "pink", rects: [PdfRect(x0: 100, y0: 300, x1: 200, y1: 318)], quote: "c"),
            ])
            let layer = MarkLayer(document: document)
            layer.show(marks)
            #expect(layer.count == 3 && page.annotations.count == before + 2)

            layer.show([marks[0]])
            #expect(layer.count == 1 && page.annotations.count == before + 1 && layer.annotations(for: marks[1].uuid).isEmpty)

            let recoloured = try #require(try world.store.updateAnnotation(id: marks[0].id, changes: PdfMarkChanges(color: "green")))
            let old = layer.annotations(for: marks[0].uuid)
            layer.show([recoloured])
            let new = layer.annotations(for: marks[0].uuid)
            #expect(new.count == 1 && old.first !== new.first && page.annotations.count == before + 1, "replaced, not added to")
            layer.show([recoloured])
            #expect(layer.annotations(for: marks[0].uuid).first === new.first, "the same mark is left alone")

            layer.show([])
            #expect(layer.count == 0 && page.annotations.count == before && page.annotations.contains { $0 === link }, "only the marks go")

            let beyond = MarkLayer(document: try makeTextPDF([["one page"]]))
            beyond.show([marks[2]])
            #expect(beyond.count == 0, "a mark on a page the PDF does not have is not drawn")
        }
    }
}
