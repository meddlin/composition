import CompositionCore
import PDFKit

#if canImport(UIKit)
import UIKit
public typealias PlatformColor = UIColor
public typealias PlatformFont = UIFont
#else
import AppKit
public typealias PlatformColor = NSColor
public typealias PlatformFont = NSFont
#endif

// A PDF's marks as PDFKit annotations (docs/pdf-markup-plan.md, "The iPad"). A mark is stored beside the file in raw PDF user space, the numbers an
// annotation's own `/Rect` and `/QuadPoints` use (spike C), so a stored rectangle is handed to PDFKit as it is: no crop box, rotation or origin to add
// back. The annotations are only ever added to the document in memory for the reader to draw, and to a copy for an export; the file in the library is
// never written. Each carries its mark's uuid as `/NM`, which is how a tap finds the mark and how the export keeps its name.

extension PdfMarkPaint {
    /// The colour a highlight is filled with (it multiplies into the page).
    public func fillColor(alpha: Double? = nil) -> PlatformColor {
        PlatformColor(red: CGFloat(fill.red) / 255, green: CGFloat(fill.green) / 255, blue: CGFloat(fill.blue) / 255, alpha: CGFloat(alpha ?? self.alpha))
    }

    /// The colour of an underline, a strikethrough, and a typed note's border.
    public var lineColor: PlatformColor {
        PlatformColor(red: CGFloat(line.red) / 255, green: CGFloat(line.green) / 255, blue: CGFloat(line.blue) / 255, alpha: 1)
    }
}

public enum MarkAnnotations {
    /// The author written into an exported annotation (PDFKit would otherwise put in the name of the person who owns the device).
    public static let author = "Composition"

    /// The uuid of the mark an annotation draws, if it is one of ours.
    public static func markUuid(of annotation: PDFAnnotation) -> String? {
        (annotation.value(forAnnotationKey: .name) as? String).flatMap { PdfMarkup.isHexUuid($0) ? $0 : nil }
    }

    /// The annotations that draw a mark: one for a text mark (its lines are quadrilaterals of the one annotation) or a typed note, none for ink (a
    /// stroke is drawn by the ink layer, and an export leaves it out). `fontSize` and the colours are the desktop's.
    public static func annotations(for mark: PdfMark) -> [PDFAnnotation] {
        let paint = PdfMarkPaint.paint(for: mark.color)
        switch mark.kind {
        case .highlight, .underline, .strikethrough:
            guard let rects = mark.rects, let union = PdfMarkGeometry.union(rects) else { return [] }
            let type: PDFAnnotationSubtype = mark.kind == .highlight ? .highlight : mark.kind == .underline ? .underline : .strikeOut
            let annotation = PDFAnnotation(bounds: cgRect(union), forType: type, withProperties: nil)
            annotation.color = mark.kind == .highlight ? paint.fillColor() : paint.lineColor
            // QuadPoints are relative to the annotation's bounds in PDFKit (spike C): top-left, top-right, bottom-left, bottom-right for each line.
            annotation.quadrilateralPoints = rects.flatMap { rect -> [NSValue] in
                let (x0, y0, x1, y1) = (rect.x0 - union.x0, rect.y0 - union.y0, rect.x1 - union.x0, rect.y1 - union.y0)
                return [point(x0, y1), point(x1, y1), point(x0, y0), point(x1, y0)]
            }
            finish(annotation, mark)
            return [annotation]
        case .text:
            guard let note = mark.textNote else { return [] }
            let annotation = PDFAnnotation(bounds: cgRect(note.rect), forType: .freeText, withProperties: nil)
            annotation.contents = note.text
            annotation.font = PlatformFont.systemFont(ofSize: CGFloat(note.fontSize ?? PdfMarkGeometry.noteFontSize))
            annotation.fontColor = PlatformColor(white: 0.07, alpha: 1)
            annotation.color = paint.fillColor(alpha: PdfMarkPaint.noteAlpha)
            annotation.alignment = .left
            let border = PDFBorder()
            border.lineWidth = 1
            annotation.border = border
            finish(annotation, mark, contents: false)
            return [annotation]
        case .ink:
            return []
        }
    }

    private static func finish(_ annotation: PDFAnnotation, _ mark: PdfMark, contents: Bool = true) {
        _ = annotation.setValue(mark.uuid, forAnnotationKey: .name)
        annotation.userName = author
        if contents, !mark.comment.isEmpty { annotation.contents = mark.comment }
        annotation.shouldDisplay = true
        annotation.shouldPrint = true
    }

    private static func point(_ x: Double, _ y: Double) -> NSValue {
        #if canImport(UIKit)
        NSValue(cgPoint: CGPoint(x: x, y: y))
        #else
        NSValue(point: CGPoint(x: x, y: y))
        #endif
    }

    public static func cgRect(_ rect: PdfRect) -> CGRect { CGRect(x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0) }

    public static func pdfRect(_ rect: CGRect) -> PdfRect { PdfRect(x0: rect.minX, y0: rect.minY, x1: rect.maxX, y1: rect.maxY) }
}

/// The marks of one PDF as they are drawn on its document: add, change and take away follow the stored marks, nothing else on the pages is touched
/// (the PDF's own links stay). Used from the main thread, with the `PDFView` that shows the document.
public final class MarkLayer {
    public let document: PDFDocument
    private var drawn: [String: (mark: PdfMark, page: PDFPage, annotations: [PDFAnnotation])] = [:]

    public init(document: PDFDocument) { self.document = document }

    /// Makes the pages show exactly these marks: new ones are drawn, changed ones drawn again, and the rest taken off. A mark on a page the
    /// document does not have is not drawn.
    public func show(_ marks: [PdfMark]) {
        let wanted = Dictionary(marks.map { ($0.uuid, $0) }, uniquingKeysWith: { _, last in last })
        for (uuid, entry) in drawn where wanted[uuid] != entry.mark {
            for annotation in entry.annotations { entry.page.removeAnnotation(annotation) }
            drawn[uuid] = nil
        }
        for mark in marks where drawn[mark.uuid] == nil {
            guard let page = document.page(at: mark.page) else { continue }
            let annotations = MarkAnnotations.annotations(for: mark)
            for annotation in annotations { page.addAnnotation(annotation) }
            drawn[mark.uuid] = (mark, page, annotations)
        }
    }

    /// What is drawn for a mark, to flash it or to read where it is on the screen.
    public func annotations(for uuid: String) -> [PDFAnnotation] { drawn[uuid]?.annotations ?? [] }

    public func page(for uuid: String) -> PDFPage? { drawn[uuid]?.page }

    public var count: Int { drawn.count }
}
