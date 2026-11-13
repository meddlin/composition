import CompositionCore
import Foundation
import PDFKit

// Reads the text of every page of a PDF for search (docs/architecture/search.md, "The text of a PDF"). PDFKit's `PDFPage.string` is the iPad's
// counterpart of pdf.js's `getTextContent`; that the two agree, after `PdfSearchText.pageSearchText`, is checked against the desktop's reading
// of fixtures/conformance/pdf-text.pdf (PdfTextExtractionTests). Slow for a big book (seconds): call it off the main thread, and on a
// `PDFDocument` nothing else is using (a `PDFDocument` is used on one thread at a time).

public enum PdfTextExtractor {
    public enum Outcome: Equatable, Sendable {
        case pages([PdfTextPage])
        /// It asks for a password, and none was given or the one given is wrong.
        case locked
        /// PDFKit cannot open it.
        case unreadable
    }

    /// Opens the file (unlocking it with `password` if it needs one, which is used and not kept) and reads every page.
    public static func read(_ url: URL, password: String? = nil) -> Outcome {
        guard let document = PDFDocument(url: url) else { return .unreadable }
        if document.isLocked {
            guard let password, document.unlock(withPassword: password) else { return .locked }
        }
        return .pages(read(document))
    }

    /// Every page of an open, unlocked document: its text (raw, as PDFKit gives it: "" for a page with none) and its printed label when the PDF
    /// gives one that is not simply the page's number.
    public static func read(_ document: PDFDocument) -> [PdfTextPage] {
        var pages: [PdfTextPage] = []
        pages.reserveCapacity(document.pageCount)
        for index in 0..<document.pageCount {
            // A page's text and its glyph runs are autoreleased; a 600-page book would otherwise hold every page's until the end.
            autoreleasepool {
                guard let page = document.page(at: index) else { return }
                let label = page.label?.trimmingCharacters(in: .whitespacesAndNewlines)
                pages.append(PdfTextPage(page: index, label: label == nil || label == "" || label == String(index + 1) ? nil : label, text: page.string ?? ""))
            }
        }
        return pages
    }
}
