import CompositionCore
import PDFKit

// A selection of a PDF's text as marks: one per page, one rectangle per line, in raw PDF user space, with the words as the quote
// (docs/pdf-markup-plan.md, "The data model"; the desktop's `selectionMarks.ts`). PDFKit's line selections report their bounds in the page's own
// space, which spike C found is the space an annotation's `/Rect` is in on all nine page geometries (x and width agree with pdf.js; vertically the
// line box is PDFKit's, a font's descent taller than pdf.js's baseline, and a stored rectangle keeps what the viewer that made it captured).

public enum SelectionMarks {
    /// A line shorter or narrower than this is a stray box, not text (points).
    private static let smallest = 0.5

    /// The marks a selection makes in a given kind and colour: none when it holds no text. A selection that crosses pages makes one for each; the
    /// store ties them with a group uuid.
    public static func inputs(for selection: PDFSelection, in document: PDFDocument, kind: PdfMarkKind, color: String) -> [PdfMarkInput] {
        guard kind.marksText else { return [] }
        var pages: [Int] = []
        var rects: [Int: [PdfRect]] = [:]
        var words: [Int: [String]] = [:]
        for line in selection.selectionsByLine() {
            let text = collapse(line.string ?? "")
            for page in line.pages {
                let index = document.index(for: page)
                guard index != NSNotFound else { continue }
                let bounds = line.bounds(for: page)
                guard bounds.width >= smallest, bounds.height >= smallest, !text.isEmpty else { continue }
                if rects[index] == nil { pages.append(index) }
                rects[index, default: []].append(MarkAnnotations.pdfRect(bounds))
                words[index, default: []].append(text)
            }
        }
        return pages.sorted().map { index in
            PdfMarkInput(page: index, kind: kind, color: color, rects: rects[index], quote: words[index, default: []].joined(separator: " "))
        }
    }

    /// The words of a selection, one line of text, for a button that quotes it.
    public static func words(of selection: PDFSelection) -> String { collapse(selection.string ?? "") }

    /// A typed note on `page` in `box`, as the input the store takes.
    public static func textNote(page: Int, box: PdfRect, text: String, color: String, fontSize: Double = PdfMarkGeometry.noteFontSize) -> PdfMarkInput {
        PdfMarkInput(page: page, kind: .text, color: color, body: PdfTextNoteBody(rect: box, text: text, fontSize: fontSize).json)
    }

    private static func collapse(_ text: String) -> String { PdfRefs.collapse(text) }
}
