import CompositionCore
import CompositionInk
import Foundation
import PDFKit

// Export annotated PDF on the iPad (docs/pdf-markup-plan.md, "Export annotated PDF"): a copy of the PDF with the marks in it, for other apps. The
// file in the library is never written to. Two modes, as on the desktop: native (the marks are Highlight, Underline, StrikeOut and FreeText
// annotations that other apps draw and can still edit; PDFKit writes each with an appearance stream) and flattened (PDFKit burns the annotations
// into the pages, so every viewer shows the same and nothing can be edited). A page's ink is written as `Ink` annotations (`InkAnnotations`), its textured
// strokes simplified to plain paths (C21); it is handed over one page at a time, so a book's worth of strokes is never in memory at once.

public enum AnnotatedExport {
    public struct Outcome: Equatable, Sendable {
        /// Marks written into the copy, and pages of ink.
        public var written = 0
        public var inkPages = 0
        /// Pages of ink that could not be read (damaged text, or newer than this app), and marks or ink on a page this PDF does not have.
        public var skippedInk = 0
        public var skippedOffPage = 0
        /// The copy is protected by the original's password.
        public var passwordProtected = false
    }

    public enum Failure: Error, Equatable, LocalizedError {
        case cannotOpen
        case needsPassword
        case wrongPassword
        case wouldOverwriteTheOriginal
        case cannotWrite

        public var errorDescription: String? {
            switch self {
            case .cannotOpen: "This PDF can't be read."
            case .needsPassword: "This PDF needs its password. Open it in the reader first."
            case .wrongPassword: "That password did not open the PDF."
            case .wouldOverwriteTheOriginal: "The copy can't be written over the PDF in the library."
            case .cannotWrite: "The annotated copy could not be written."
            }
        }
    }

    /// Writes the copy to `target` (next to its final name first, then renamed into place, so a failure leaves no half a PDF).
    /// `password` is the one the PDF opens with, if it needs one; the copy is then protected with the same password.
    @discardableResult
    /// `inkPages` are the pages (0-based) that have ink and `ink` reads one of them (nil when it cannot be read); both are called here, on the caller's thread.
    public static func export(
        source: URL, password: String?, marks: [PdfMark], inkPages: [Int] = [], ink: @Sendable (Int) throws -> InkDocument? = { _ in nil }, flatten: Bool, to target: URL
    ) throws -> Outcome {
        guard target.resolvingSymlinksInPath().standardizedFileURL != source.resolvingSymlinksInPath().standardizedFileURL else { throw Failure.wouldOverwriteTheOriginal }
        guard let document = PDFDocument(url: source) else { throw Failure.cannotOpen }
        var protected = false
        if document.isLocked {
            guard let password, !password.isEmpty else { throw Failure.needsPassword }
            guard document.unlock(withPassword: password) else { throw Failure.wrongPassword }
            protected = true
        }
        var outcome = Outcome()
        for mark in marks {
            // (A page's ink is not among the marks: it comes through `ink`.)
            guard mark.kind != .ink else { continue }
            guard let page = document.page(at: mark.page) else {
                outcome.skippedOffPage += 1
                continue
            }
            let annotations = MarkAnnotations.annotations(for: mark)
            for annotation in annotations { page.addAnnotation(annotation) }
            if !annotations.isEmpty { outcome.written += 1 }
        }
        for index in inkPages.sorted() {
            guard let page = document.page(at: index) else {
                outcome.skippedOffPage += 1
                continue
            }
            guard let drawing = try ink(index), !drawing.isEmpty else {
                outcome.skippedInk += 1
                continue
            }
            for annotation in InkAnnotations.annotations(for: drawing, on: page) { page.addAnnotation(annotation) }
            outcome.inkPages += 1
        }

        var options: [PDFDocumentWriteOption: Any] = [:]
        if flatten { options[.burnInAnnotationsOption] = true }
        if protected, let password {
            // The same password opens the copy; a made-up owner password, kept by no one, stops the limits being lifted.
            options[.userPasswordOption] = password
            options[.ownerPasswordOption] = UUID().uuidString
            outcome.passwordProtected = true
        }

        let partial = target.deletingLastPathComponent().appendingPathComponent(".\(target.lastPathComponent).part")
        try? FileManager.default.removeItem(at: partial)
        guard document.write(to: partial, withOptions: options.isEmpty ? nil : options) else {
            try? FileManager.default.removeItem(at: partial)
            throw Failure.cannotWrite
        }
        do {
            if FileManager.default.fileExists(atPath: target.path) {
                _ = try FileManager.default.replaceItemAt(target, withItemAt: partial)
            } else {
                try FileManager.default.moveItem(at: partial, to: target)
            }
        } catch {
            try? FileManager.default.removeItem(at: partial)
            throw Failure.cannotWrite
        }
        return outcome
    }
}
