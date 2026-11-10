import CompositionCore
import CompositionInk
import CompositionPDF
import PDFKit
import PencilKit
import UIKit

// Ink on a PDF (pdf-markup-plan.md, "Ink on the page"): the Pencil draws on a `PKCanvasView` that PDFKit lays over each page near the screen
// (`PDFPageOverlayViewProvider`, iOS 16), and a page's drawing is kept beside the file as one record of the D9 stroke format (`PdfInkStore.swift`).
// What spike B found (PR #290, in the Simulator) is what this is built on: the canvas is the page's unturned crop box in points, so its points are the page's
// (`PdfInkGeometry`); PDFKit's page view takes no touches, so it is told to while drawing; overlays are cheap to make and drop; a canvas keeps memory after it
// has drawn, so it is emptied when its page leaves; and building the stroke format for many pages at once is what makes memory peak, so pages are converted one at a time.
//
// Not tried with a Pencil. Everything here runs in the Simulator with a finger standing in for it ("Finger draws").

@MainActor
final class PdfInkLayer: NSObject, @preconcurrency PDFPageOverlayViewProvider, PKCanvasViewDelegate {
    /// Reads a page's stored stroke JSON (nil: none), and writes it (nil: the page has no strokes left). Both run off the main thread.
    typealias Read = @Sendable (Int) async -> String?
    typealias Write = @Sendable (Int, String?) async -> Void

    private var document: PDFDocument?
    private var read: Read?
    private var write: Write?
    weak var pdfView: PDFView?

    /// The pages (0-based) that have ink, as the person sees them: stored, or drawn and not yet stored.
    private(set) var pagesWithInk: Set<Int> = []
    /// Said whenever `pagesWithInk` changes.
    var onPagesChanged: (() -> Void)?
    /// Said when a page's ink could not be read or kept, in words for the person.
    var onProblem: ((String) -> Void)?

    // MARK: Mode

    /// The Pencil draws (otherwise the canvases only show what is drawn, and take no touch).
    private(set) var drawing = false
    /// A finger draws too, for an iPad with no Pencil and for the Simulator; a finger then scrolls with two.
    private(set) var fingerDraws = false

    // MARK: Pages

    private var canvases: [Int: PKCanvasView] = [:]
    private var pageOf: [ObjectIdentifier: Int] = [:]
    /// The latest drawing of the pages seen lately, so that a page scrolled back to is instant. Never evicted while it is unsaved.
    private var latest: [Int: PKDrawing] = [:]
    private var recent: [Int] = []
    private static let remembered = 8
    private var dirty: Set<Int> = []
    private var saving: [Int: Int] = [:]
    private var loading: Set<Int> = []
    private var debounce: [Int: Task<Void, Never>] = [:]
    /// Saves run one after another, so the last change to a page is the one that is kept.
    private var chain: Task<Void, Never>?
    private var quietUntil: CFTimeInterval = 0
    /// Waits this long after the last stroke on a page before keeping it (a page that is left is kept at once).
    static let saveDelay: Duration = .milliseconds(1_200)

    private var tool: PKTool = PKInkingTool(.pen, color: .black, width: 3)
    private lazy var picker = PKToolPicker()
    private var pickerShown = false
    /// The system's tool picker (pens, eraser, colours, ruler, undo) is shown while drawing. Off with `-pdfInkNoPicker 1`, which the UI tests use.
    private let usesPicker = !UserDefaults.standard.bool(forKey: "pdfInkNoPicker")

    // MARK: Attaching

    /// The PDF the view shows, known as soon as the view is made, so that every canvas PDFKit asks for can be told its page.
    func use(document: PDFDocument) { self.document = document }

    /// The reader has the marks of the PDF read and so its ink known. Canvases already on a page are filled.
    func attach(pages: Set<Int>, read: @escaping Read, write: @escaping Write) {
        self.read = read
        self.write = write
        pagesWithInk = pages
        onPagesChanged?()
        for (index, canvas) in canvases { fill(canvas, page: index) }
    }

    // MARK: Drawing mode

    func setDrawing(_ on: Bool, fingerDraws finger: Bool) {
        drawing = on
        fingerDraws = finger
        for canvas in canvases.values { configure(canvas) }
        adjustScrolling()
        if on {
            showPicker()
        } else {
            hidePicker()
            flushAll()
        }
    }

    private func configure(_ canvas: PKCanvasView) {
        canvas.drawingPolicy = fingerDraws ? .anyInput : .pencilOnly
        canvas.isUserInteractionEnabled = drawing
        // PDFKit's page view is built to take no touches, so a canvas inside it is never reached (spike B): it takes them while the Pencil draws.
        canvas.superview?.isUserInteractionEnabled = drawing
        if drawing, !usesPicker || !pickerShown { canvas.tool = tool }
    }

    /// While drawing, the Pencil must not also scroll the book, and when a finger draws it scrolls with two. (The PDF's own scroll view accepts the Pencil as well
    /// as fingers, spike B; whether this is enough with a real Pencil is the iPad's to say.)
    private func adjustScrolling() {
        guard let scroll = pdfView?.subviews.compactMap({ $0 as? UIScrollView }).first else { return }
        if drawing {
            scroll.panGestureRecognizer.minimumNumberOfTouches = fingerDraws ? 2 : 1
            scroll.panGestureRecognizer.allowedTouchTypes = fingerDraws ? [] : [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        } else {
            scroll.panGestureRecognizer.minimumNumberOfTouches = 1
            scroll.panGestureRecognizer.allowedTouchTypes = []
        }
    }

    // MARK: The tool picker

    private func showPicker() {
        guard usesPicker else { return }
        for canvas in canvases.values { picker.addObserver(canvas) }
        let current = pdfView?.currentPage.flatMap { document?.index(for: $0) }
        guard let first = (current.flatMap { canvases[$0] }) ?? canvases.sorted(by: { $0.key < $1.key }).first?.value else { return }
        pickerShown = true
        picker.setVisible(true, forFirstResponder: first)
        first.becomeFirstResponder()
    }

    private func hidePicker() {
        guard pickerShown else { return }
        pickerShown = false
        for canvas in canvases.values {
            picker.setVisible(false, forFirstResponder: canvas)
            picker.removeObserver(canvas)
            canvas.resignFirstResponder()
        }
    }

    // MARK: PDFPageOverlayViewProvider

    func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
        let canvas = PKCanvasView(frame: .zero)
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        // A scroll view that does not scroll, so that it never takes a drag from the PDF.
        canvas.isScrollEnabled = false
        // The page is white in every scheme, so the ink is drawn for a light page.
        canvas.overrideUserInterfaceStyle = .light
        canvas.tool = tool
        canvas.delegate = self
        canvas.isAccessibilityElement = false
        if let document { pageOf[ObjectIdentifier(canvas)] = document.index(for: page) }
        return canvas
    }

    func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
        guard let canvas = overlayView as? PKCanvasView, let document else { return }
        let index = document.index(for: page)
        guard index != NSNotFound else { return }
        pageOf[ObjectIdentifier(canvas)] = index
        canvases[index] = canvas
        configure(canvas)
        if pickerShown {
            picker.addObserver(canvas)
            if !canvases.values.contains(where: { $0.isFirstResponder }) {
                picker.setVisible(true, forFirstResponder: canvas)
                canvas.becomeFirstResponder()
            }
        }
        fill(canvas, page: index)
    }

    func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
        guard let canvas = overlayView as? PKCanvasView, let index = pageOf[ObjectIdentifier(canvas)] else { return }
        if canvases[index] === canvas { canvases[index] = nil }
        pageOf[ObjectIdentifier(canvas)] = nil
        persistNow(index)
        if pickerShown { picker.removeObserver(canvas) }
        // What a canvas keeps after it has drawn is most of the memory of ink (spike B): the page's drawing is held in `latest`, a few pages' worth, and nowhere else.
        if !canvas.drawing.strokes.isEmpty {
            quiet()
            canvas.drawing = PKDrawing()
        }
    }

    // MARK: Showing a page's ink

    private func quiet() { quietUntil = CACurrentMediaTime() + 0.3 }

    private func cropSize(of index: Int) -> CGSize? { document?.page(at: index).map { $0.bounds(for: .cropBox).size } }

    private func fill(_ canvas: PKCanvasView, page index: Int) {
        if let known = latest[index] {
            show(known, on: canvas, page: index)
            return
        }
        guard pagesWithInk.contains(index), let read, let size = cropSize(of: index), !loading.contains(index) else { return }
        loading.insert(index)
        Task { [weak self] in
            let body = await read(index)
            // The stroke JSON of a dense page is megabytes: read and turned into PencilKit's drawing off the main thread.
            let decoded = await Task.detached(priority: .userInitiated) { () -> Decoded in
                guard let body else { return Decoded(drawing: nil, failed: false) }
                guard let ink = try? InkDocument(data: Data(body.utf8)) else { return Decoded(drawing: nil, failed: true) }
                return Decoded(drawing: Self.pencilKit(ink, onto: size), failed: false)
            }.value
            guard let self else { return }
            loading.remove(index)
            if decoded.failed { onProblem?("The ink on page \(index + 1) could not be read. It is kept as it is until you draw on that page again.") }
            // A stroke drawn on the page while it was being read is the newer.
            guard let drawing = decoded.drawing, latest[index] == nil, !dirty.contains(index) else { return }
            remember(drawing, page: index)
            if let canvas = canvases[index] { show(drawing, on: canvas, page: index) }
        }
    }

    private struct Decoded: @unchecked Sendable {
        let drawing: PKDrawing?
        let failed: Bool
    }

    /// PencilKit's drawing for stored strokes. A drawing made on another size of canvas than this page's (a page that was replaced) is scaled to it.
    nonisolated private static func pencilKit(_ ink: InkDocument, onto size: CGSize) -> PKDrawing {
        let drawing = ink.pkDrawing(palette: InkAnnotations.pagePalette)
        guard size.width > 0, size.height > 0, abs(ink.width - size.width) > 0.01 || abs(ink.height - size.height) > 0.01 else { return drawing }
        return drawing.transformed(using: CGAffineTransform(scaleX: size.width / ink.width, y: size.height / ink.height))
    }

    private func show(_ drawing: PKDrawing, on canvas: PKCanvasView, page index: Int) {
        quiet()
        canvas.drawing = drawing
        canvas.isAccessibilityElement = !drawing.strokes.isEmpty
        canvas.accessibilityLabel = "Handwriting on page \(index + 1)"
        canvas.accessibilityIdentifier = "pdf-ink-canvas-\(index)"
        canvas.accessibilityValue = "\(drawing.strokes.count) strokes"
        touch(index)
    }

    /// Keeps the most recently used pages' drawings, and lets go of the oldest that are saved and off the screen.
    private func remember(_ drawing: PKDrawing, page index: Int) {
        latest[index] = drawing
        touch(index)
    }

    private func touch(_ index: Int) {
        recent.removeAll { $0 == index }
        recent.append(index)
        while latest.count > Self.remembered, let old = recent.first(where: { canvases[$0] == nil && !dirty.contains($0) && saving[$0] == nil }) {
            latest[old] = nil
            recent.removeAll { $0 == old }
        }
    }

    // MARK: Changes

    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        // Setting a drawing from code tells the delegate it changed; that is not the person drawing.
        guard CACurrentMediaTime() > quietUntil, let index = pageOf[ObjectIdentifier(canvasView)] else { return }
        let current = canvasView.drawing
        remember(current, page: index)
        dirty.insert(index)
        canvasView.isAccessibilityElement = !current.strokes.isEmpty
        canvasView.accessibilityLabel = "Handwriting on page \(index + 1)"
        canvasView.accessibilityIdentifier = "pdf-ink-canvas-\(index)"
        canvasView.accessibilityValue = "\(current.strokes.count) strokes"
        let had = pagesWithInk.contains(index)
        if current.strokes.isEmpty { pagesWithInk.remove(index) } else { pagesWithInk.insert(index) }
        if had != pagesWithInk.contains(index) { onPagesChanged?() }
        debounce[index]?.cancel()
        debounce[index] = Task { [weak self] in
            try? await Task.sleep(for: Self.saveDelay)
            guard !Task.isCancelled else { return }
            self?.persistNow(index)
        }
    }

    // MARK: Keeping it

    /// Every changed page is kept now (drawing is done, or the app is leaving the screen).
    func flushAll() {
        let pages = dirty
        guard !pages.isEmpty else { return }
        // The app may be suspended before the saves finish; ask for the time to finish them.
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "Keep ink") { UIApplication.shared.endBackgroundTask(task) }
        for index in pages { persistNow(index) }
        let last = chain
        Task {
            await last?.value
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    /// Whether any page is changed and not yet kept (a UI test waits for this to be false).
    var hasUnsavedInk: Bool { !dirty.isEmpty || !saving.isEmpty }

    private func persistNow(_ index: Int) {
        debounce[index]?.cancel()
        debounce[index] = nil
        guard dirty.remove(index) != nil, let write, let size = cropSize(of: index) else { return }
        let snapshot = Snapshot(drawing: latest[index] ?? PKDrawing(), size: size)
        saving[index, default: 0] += 1
        let previous = chain
        chain = Task { [weak self] in
            await previous?.value
            // One page at a time, in order: a book's worth of pages converted at once peaked at a gigabyte (spike B).
            let body = await Task.detached(priority: .utility) { () -> String? in
                guard !snapshot.drawing.strokes.isEmpty else { return nil }
                return String(decoding: InkDocument(drawing: snapshot.drawing, size: snapshot.size).jsonData(), as: UTF8.self)
            }.value
            await write(index, body)
            self?.finishedSaving(index)
        }
    }

    private func finishedSaving(_ index: Int) {
        let left = (saving[index] ?? 1) - 1
        saving[index] = left > 0 ? left : nil
        touch(index)
    }

    private struct Snapshot: @unchecked Sendable {
        let drawing: PKDrawing
        let size: CGSize
    }

    // MARK: Taking a page's ink away

    /// Clears a page's ink, on the screen and in the store (the Highlights tab's swipe).
    func clear(page index: Int) {
        remember(PKDrawing(), page: index)
        if let canvas = canvases[index] {
            quiet()
            canvas.drawing = PKDrawing()
            canvas.isAccessibilityElement = false
        }
        pagesWithInk.remove(index)
        onPagesChanged?()
        dirty.insert(index)
        persistNow(index)
    }
}
