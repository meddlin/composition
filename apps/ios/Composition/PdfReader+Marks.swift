import CompositionCore
import CompositionPDF
import PDFKit
import SwiftUI

// M2, typed markup (pdf-markup-plan.md, "The iPad"): highlight, underline, strikethrough and typed notes on a PDF, made from the text the person selects,
// stored beside the file in raw PDF user space (`PdfMarkEditor` over the note store) and drawn by PDFKit as annotations (`MarkLayer`). The file is
// never written. What the reader does with them: a bar of colours and tools over a selection, a card over a mark that is tapped (recolour, comment,
// quote it into the note, delete), a typed note placed with one tap, undo and redo, and a flash for the mark a link names.

/// A mark's card, open over the mark, and where the mark is in the PDF view.
struct MarkCard: Equatable, Identifiable {
    let markId: Int64
    let rect: CGRect
    var id: Int64 { markId }
}

/// A typed note being written, placed on a page in `box` (raw user space), or an existing note being retyped (`markId`). `anchor` is where it is in the view.
struct NoteDraft: Equatable, Identifiable {
    var markId: Int64?
    var page: Int
    var box: PdfRect
    var text: String
    var anchor: CGRect
    /// The same note keeps its identity as it is typed in (the box is where it is, and the text is not part of it).
    var id: String { "\(markId ?? -1)/\(page)/\(box.x0)/\(box.y1)" }
}

/// What puts Markdown into the note shown beside the PDF: a block at its caret (a quote), or a line in the words around it (a page citation). Each
/// answers whether the note's editor was there to take it; when it was not (the Preview tab), the reader appends it to the end of the note.
struct PdfInsertion {
    var block: (String) -> Bool = { _ in false }
    var inline: (String) -> Bool = { _ in false }
    var append: (String) -> Void = { _ in }
}

extension PdfReader {
    var document: StoredDocument { source.document }

    /// The title the PDF is cited by: its own note's.
    var citedTitle: String { app.orderedNotes.first { $0.id == source.document.noteId }?.title ?? source.document.fileName }

    // MARK: Opening the marks

    /// Called once the pages can be read: the marks beside the file are read and drawn.
    func loadMarks() async {
        guard let pdf, editor == nil, let made = app.markEditor(documentId: documentId) else { return }
        editor = made
        layer = MarkLayer(document: pdf)
        do {
            apply(try await made.state)
        } catch {
            app.errorMessage = error.localizedDescription
        }
        marksLoaded = true
        await refreshCitations()
    }

    func apply(_ state: PdfMarkEditor.State) {
        marks = state.marks
        canUndo = state.canUndo
        canRedo = state.canRedo
        layer?.show(state.marks)
        if let open = card, !state.marks.contains(where: { $0.id == open.markId }) { card = nil }
    }

    /// Runs a change to the marks; what it refuses (a mark that breaks a rule) is said.
    private func change(_ work: @escaping @Sendable (PdfMarkEditor) async throws -> PdfMarkEditor.State) async {
        guard let editor else { return }
        do {
            apply(try await work(editor))
            await refreshCitations()
        } catch {
            app.errorMessage = error.localizedDescription
        }
    }

    // MARK: Marking the selection

    /// The selection changed in the PDF view (a long press, a drag of a handle, a tap that lets go of it).
    func selectionChanged() {
        guard let view, let pdf else { return }
        if let current = view.currentSelection, !(current.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            selection = current
            selectionWords = SelectionMarks.words(of: current)
            card = nil
        } else {
            selection = nil
            selectionWords = ""
        }
        _ = pdf
    }

    /// The bar's buttons: highlight, underline or strikethrough the selected words in the colour chosen.
    func markSelection(_ kind: PdfMarkKind) async {
        guard let selection, let pdf else { return }
        let inputs = SelectionMarks.inputs(for: selection, in: pdf, kind: kind, color: color)
        guard !inputs.isEmpty else {
            app.errorMessage = "There is no text there to mark."
            return
        }
        view?.clearSelection()
        self.selection = nil
        selectionWords = ""
        await change { try await $0.add(inputs) }
    }

    // MARK: A mark that is tapped

    /// A tap in the PDF view: places a typed note when one is being placed, opens the card of the mark under it, or closes the card.
    func tapped(at point: CGPoint) {
        guard let view, let pdf, !locked else { return }
        guard let page = view.page(for: point, nearest: false) else {
            card = nil
            return
        }
        let at = view.convert(point, to: page)
        let index = pdf.index(for: page)
        if placingNote {
            placingNote = false
            let crop = page.bounds(for: .cropBox)
            let local = PdfMarkGeometry.noteBox(tapX: Double(at.x - crop.minX), tapY: Double(at.y - crop.minY), pageWidth: Double(crop.width), pageHeight: Double(crop.height))
            let box = PdfRect(x0: local.x0 + Double(crop.minX), y0: local.y0 + Double(crop.minY), x1: local.x1 + Double(crop.minX), y1: local.y1 + Double(crop.minY))
            draft = NoteDraft(markId: nil, page: index, box: box, text: "", anchor: viewRect(of: box, on: page))
            return
        }
        // A tap lands within a few points of a line of text; at a zoomed-out page that is more of the page than at a zoomed-in one.
        let slop = 6 / max(Double(view.scaleFactor), 0.25)
        if let mark = PdfMarkGeometry.mark(at: Double(at.x), Double(at.y), among: marks.filter { $0.page == index }, slop: slop) {
            openCard(mark)
        } else {
            card = nil
        }
    }

    func openCard(_ mark: PdfMark) {
        guard let view, let page = pdf?.page(at: mark.page), let union = mark.union else { return }
        selection = nil
        selectionWords = ""
        view.clearSelection()
        card = MarkCard(markId: mark.id, rect: viewRect(of: union, on: page))
    }

    /// Where a rectangle in a page's raw user space is in the PDF view.
    func viewRect(of rect: PdfRect, on page: PDFPage) -> CGRect {
        guard let view else { return .zero }
        return view.convert(MarkAnnotations.cgRect(rect), from: page)
    }

    var cardMark: PdfMark? { card.flatMap { open in marks.first { $0.id == open.markId } } }

    func recolour(_ mark: PdfMark, to color: String) async {
        self.color = color
        await change { try await $0.update(id: mark.id, changes: PdfMarkChanges(color: color)) }
    }

    func setComment(_ mark: PdfMark, to comment: String) async {
        let text = comment.replacingOccurrences(of: "\n", with: " ")
        guard text != mark.comment else { return }
        await change { try await $0.update(id: mark.id, changes: PdfMarkChanges(comment: text)) }
    }

    func delete(_ mark: PdfMark) async {
        card = nil
        await change { try await $0.delete(id: mark.id) }
    }

    func undo() async { await change { try await $0.undo() } }

    func redo() async { await change { try await $0.redo() } }

    // MARK: Typed notes

    func beginPlacingNote() {
        card = nil
        view?.clearSelection()
        placingNote.toggle()
    }

    /// Retypes a typed note: its card's Edit.
    func edit(_ mark: PdfMark) {
        guard let note = mark.textNote, let page = pdf?.page(at: mark.page) else { return }
        card = nil
        draft = NoteDraft(markId: mark.id, page: mark.page, box: note.rect, text: note.text, anchor: viewRect(of: note.rect, on: page))
    }

    /// The note's editor is done: what was typed is the note (an empty note is not kept, and one retyped to nothing is taken away).
    func commit(_ finished: NoteDraft) async {
        draft = nil
        let text = finished.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = finished.markId {
            guard let mark = marks.first(where: { $0.id == id }), let old = mark.textNote else { return }
            if text.isEmpty {
                await change { try await $0.delete(id: id) }
            } else if text != old.text {
                var body = old
                body.text = text
                let json = body.json
                await change { try await $0.update(id: id, changes: PdfMarkChanges(body: json)) }
            }
        } else if !text.isEmpty {
            let input = SelectionMarks.textNote(page: finished.page, box: finished.box, text: text, color: color)
            await change { try await $0.add([input]) }
        }
    }

    // MARK: Going to a mark

    /// Shows a page, or a mark on it with a flash: what a followed link asks for.
    func show(page: Int?, mark uuid: String?) {
        if let uuid, let mark = marks.first(where: { $0.uuid == uuid }) {
            go(toPage: mark.page)
            // The page has to be on screen for the flash to be seen.
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                flash(mark)
            }
        } else if let page {
            go(toPage: page)
        }
    }

    /// A frame around the mark that goes after a moment (1.6 seconds, as on the desktop).
    func flash(_ mark: PdfMark) {
        flashTask?.cancel()
        clearFlash()
        guard let page = pdf?.page(at: mark.page), let union = mark.union else { return }
        let paint = PdfMarkPaint.paint(for: mark.color)
        let frame = PDFAnnotation(bounds: MarkAnnotations.cgRect(union).insetBy(dx: -4, dy: -4), forType: .square, withProperties: nil)
        frame.color = paint.lineColor
        let border = PDFBorder()
        border.lineWidth = 3
        frame.border = border
        page.addAnnotation(frame)
        flashing = [frame]
        flashPage = page
        flashTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1_600))
            guard !Task.isCancelled else { return }
            self?.clearFlash()
        }
    }

    func clearFlash() {
        for annotation in flashing { flashPage?.removeAnnotation(annotation) }
        flashing = []
    }

    /// What a link asked for, once the PDF is open and its marks are read.
    func takeGoTo() {
        guard restored, marksLoaded, let request = app.pdfGoTo, request.documentId == documentId else { return }
        app.clearPdfGoTo(request.sequence)
        show(page: request.page, mark: request.mark)
    }

    // MARK: Citing

    /// The printed page labels of the PDF, when it has any (a textbook's front matter makes the 44th page "page 42").
    private var labels: [String]? {
        if let pageLabels { return pageLabels }
        guard let pdf, pdf.pageCount > 0 else { return nil }
        let made = (0..<pdf.pageCount).map { pdf.page(at: $0)?.label ?? "" }
        pageLabels = made
        return made
    }

    /// **Quote**: the marked words as a block quote with its citation, in the note beside the PDF.
    func quote(_ mark: PdfMark) {
        guard mark.kind.marksText else { return }
        put(block: PdfRefs.quoteBlock(uuid: document.uuid, title: citedTitle, quote: mark.quote, page: mark.page + 1, mark: mark.uuid, labels: labels), saying: "Quoted into the note.")
        card = nil
    }

    /// **Cite this page**: a link to the page being read, in the words around the caret.
    func citeThisPage() {
        let link = PdfRefs.pageCitation(uuid: document.uuid, title: citedTitle, page: pageIndex + 1, labels: labels)
        if insertion.inline(link) {
            say("Cited page \(pageIndex + 1) at the caret.")
        } else {
            insertion.append(link)
            say("Cited page \(pageIndex + 1) at the end of the note.")
        }
        Task { await refreshCitations() }
    }

    /// Puts a block into the note beside the PDF and says where it went: at the caret of its editor, or at the end of the note when the editor is not showing.
    private func put(block: String, saying message: String) {
        if insertion.block(block) {
            say("\(message) At the caret.")
        } else {
            insertion.append(block)
            say("\(message) At the end of the note.")
        }
        Task { await refreshCitations() }
    }

    func say(_ message: String) {
        notice = message
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }

    /// The notes that belong with the PDF (its own, and those that link to it), read from their text.
    func refreshCitations() async { citations = await app.citations(of: document) }

    /// The marks a note already quotes.
    var quotedMarks: Set<String> { Set(citations.flatMap(\.marks)) }
}
