import CompositionInk
import PDFKit
import PencilKit
import UIKit

// Spike B's lab: the page overlays. PDFKit asks this object for a view to lay over each page as the page comes near the screen (`PDFPageOverlayViewProvider`, iOS 16),
// and tells it when the page goes away. Here the view is a PencilKit canvas. One page's ink is one record (`inks`), kept apart from the canvas that shows it, so that a
// canvas can be dropped when its page leaves and a fresh one filled when the page comes back; `Retention.keep` is the other way, for the cost of the two to be compared.

enum Retention: String, CaseIterable, Identifiable {
    case drop = "Drop a canvas when its page leaves"
    case keep = "Keep every canvas that was made"
    var id: String { rawValue }
}

/// How a page's ink is held while its page is off the screen. PencilKit's own drawing keeps every point as it was drawn (about 70 bytes each); its `dataRepresentation()` is a
/// fraction of that and has to be decoded when the page comes back.
enum InkHolding: String, CaseIterable, Identifiable {
    case drawing = "Hold off-screen ink as PencilKit's drawing"
    case data = "Hold off-screen ink as PencilKit's data (smaller)"
    var id: String { rawValue }
}

@MainActor
final class PdfInkLabOverlays: NSObject, @preconcurrency PDFPageOverlayViewProvider, PKCanvasViewDelegate {
    /// What the overlays have cost so far; a stretch of work reads the difference between two copies.
    struct Stats {
        var created = 0, leftScreen = 0, mostOnScreen = 0, strokesStarted = 0
        var createMilliseconds: [Double] = []
        /// Putting a stored page's ink on a canvas when its page comes back.
        var restoreMilliseconds: [Double] = []
        /// What leaving a page with new ink costs, off the main thread: the stroke format built from PencilKit's drawing, then written as JSON.
        var convertMilliseconds: [Double] = []
        var jsonMilliseconds: [Double] = []
        /// Making PencilKit's data from a page's drawing when it leaves (`InkHolding.data`), on the main thread.
        var holdMilliseconds: [Double] = []
        var jsonBytes: [Int] = []
        var packedBytes: [Int] = []
        var pencilKitBytes: [Int] = []
    }

    var document: PDFDocument?
    var retention = Retention.drop
    var policy = PKCanvasViewDrawingPolicy.pencilOnly
    var tool: PKTool = PKInkingTool(.pen, color: .black, width: 3)
    var usesSystemPicker = false
    var holding = InkHolding.drawing
    /// Whether a page that leaves with new ink has its stroke format built (what the build will do). Off, to see what the canvases and the held ink cost without it.
    var buildsStrokeFormat = true
    /// Whether a canvas is emptied when its page leaves, so that PencilKit has nothing of the page to keep if PDFKit or PencilKit holds on to the canvas itself.
    var emptiesOnLeave = false
    /// PDFKit's page view is built to take no touches, so a canvas inside it is never reached. With this on, the page view is told to take them. (A change to a view PDFKit owns:
    /// the lab's way of finding out whether the overlay approach can work at all.)
    var letTouchesThrough = true
    private(set) var stats = Stats()
    /// Pages whose record is still being built off the main thread.
    private(set) var pendingConversions = 0
    /// One ink record per page, by page index: what is saved, whatever canvas is or is not showing it. A page's ink is here as PencilKit's drawing while its canvas is on
    /// screen (or always, when `holding` is `.drawing`), and in `inkData` as PencilKit's data when `holding` is `.data` and its page has left.
    private(set) var inks: [Int: PKDrawing] = [:]
    private var inkData: [Int: Data] = [:]
    private var counts: [Int: (strokes: Int, points: Int)] = [:]
    /// What each overlay measured against its page the first time it showed (up to twenty pages), to settle the coordinates the build will store ink in.
    private(set) var geometries: [Int: String] = [:]

    private var onScreen: [Int: PKCanvasView] = [:]
    private var kept: [Int: PKCanvasView] = [:]
    private var pageOf: [ObjectIdentifier: Int] = [:]
    private var filled: Set<ObjectIdentifier> = []
    private var changed: Set<Int> = []
    private var quietUntil: CFTimeInterval = 0
    private lazy var picker = PKToolPicker()
    private let converter = DispatchQueue(label: "composition.pdfinklab.converter", qos: .utility)

    var onScreenCount: Int { onScreen.count }
    var keptCount: Int { kept.count }

    func canvas(at index: Int) -> PKCanvasView? { onScreen[index] }

    /// A new book: nothing of the last one is kept.
    func reset() {
        for canvas in Set(onScreen.values).union(kept.values) { picker.removeObserver(canvas) }
        onScreen = [:]
        kept = [:]
        pageOf = [:]
        filled = []
        changed = []
        inks = [:]
        inkData = [:]
        counts = [:]
        stats = Stats()
        geometries = [:]
    }

    /// Forgets the canvases that were kept, for the next pass to start without them.
    func dropKept() {
        kept = [:]
        pageOf = pageOf.filter { id, _ in onScreen.values.contains { ObjectIdentifier($0) == id } }
    }

    /// The view was given its document again, so what was on show is gone without PDFKit saying so. (Every stroke is already in `inks`.)
    func forgetScreen() {
        onScreen = [:]
        pageOf = pageOf.filter { id, _ in kept.values.contains { ObjectIdentifier($0) == id } }
        filled = filled.filter { id in kept.values.contains { ObjectIdentifier($0) == id } }
    }

    /// A stretch of work starts counting its canvases on screen from what is there now.
    func resetPeak() { stats.mostOnScreen = onScreen.count }

    // MARK: Ink

    func setInk(_ drawing: PKDrawing, page index: Int) {
        inks[index] = drawing
        inkData[index] = nil
        counts[index] = Self.tally(drawing)
        changed.insert(index)
        if let canvas = onScreen[index] ?? kept[index] {
            quiet()
            canvas.drawing = drawing
            filled.insert(ObjectIdentifier(canvas))
        }
    }

    func clearAllInk() {
        inks = [:]
        inkData = [:]
        counts = [:]
        changed = []
        for canvas in Set(onScreen.values).union(kept.values) {
            quiet()
            canvas.drawing = PKDrawing()
        }
    }

    /// What the stored ink adds up to.
    var inkTotals: (pages: Int, strokes: Int, points: Int) {
        (counts.count, counts.values.reduce(0) { $0 + $1.strokes }, counts.values.reduce(0) { $0 + $1.points })
    }

    private static func tally(_ drawing: PKDrawing) -> (strokes: Int, points: Int) {
        (drawing.strokes.count, drawing.strokes.reduce(0) { $0 + $1.path.count })
    }

    /// Setting a drawing from code may tell the delegate it changed; that is not the person drawing.
    private func quiet() { quietUntil = CACurrentMediaTime() + 0.3 }

    // MARK: Where a touch goes

    /// How a view looks to the touch system: its class, and what would keep a touch from reaching it.
    static func describe(_ view: UIView) -> String {
        var flags: [String] = []
        if !view.isUserInteractionEnabled { flags.append("no touches") }
        if view.isHidden { flags.append("hidden") }
        if view.alpha < 0.01 { flags.append("clear") }
        if view.clipsToBounds { flags.append("clips") }
        return String(describing: type(of: view)) + (flags.isEmpty ? "" : " (" + flags.joined(separator: ", ") + ")")
    }

    /// The views from `view` up to the top, each with what it does to touches.
    static func chain(from view: UIView?, stoppingAt top: UIView? = nil) -> String {
        var parts: [String] = []
        var current = view
        while let found = current, parts.count < 14 {
            parts.append(describe(found))
            if found === top { break }
            current = found.superview
        }
        return parts.joined(separator: " in ")
    }

    /// What each canvas on show looks like to the touch system: where it is, what draws on it, what is above it, and which view a touch in its middle reaches.
    func canvasDescriptions(in root: UIView) -> [String] {
        onScreen.sorted { $0.key < $1.key }.flatMap { index, canvas -> [String] in
            let frame = canvas.window.map { canvas.convert(canvas.bounds, to: $0) } ?? .zero
            var lines = [String(format: "page %d: canvas on screen at (%.0f, %.0f, %.0f × %.0f), takes touches %@, policy %@, scrolls %@, alpha %.1f", index + 1, frame.origin.x, frame.origin.y, frame.width, frame.height,
                                canvas.isUserInteractionEnabled ? "yes" : "no", canvas.drawingPolicy == .pencilOnly ? "Pencil only" : canvas.drawingPolicy == .anyInput ? "any input" : "default",
                                canvas.isScrollEnabled ? "yes" : "no", canvas.alpha),
                         "  its views, from the canvas up: " + Self.chain(from: canvas, stoppingAt: root)]
            if let window = canvas.window {
                let visible = frame.intersection(root.convert(root.bounds, to: window))
                let point = CGPoint(x: visible.midX, y: visible.midY)
                let hit = window.hitTest(point, with: nil)
                let inside = hit.map { $0 === canvas || $0.isDescendant(of: canvas) } ?? false
                lines.append(String(format: "  a touch at (%.0f, %.0f) inside it reaches: ", point.x, point.y) + (hit.map { Self.chain(from: $0, stoppingAt: root) } ?? "nothing") + (inside ? "  -> the canvas gets it" : "  -> NOT the canvas"))
                lines.append("  the canvas's own hit test at its middle: " + (canvas.hitTest(canvas.convert(point, from: window), with: nil).map { Self.describe($0) } ?? "nothing"))
            }
            return lines
        }
    }

    // MARK: Settings

    /// Pushes the policy, the tool and the picker to the canvases on show.
    func settingsChanged() {
        for canvas in Set(onScreen.values).union(kept.values) {
            canvas.drawingPolicy = policy
            applyTouchSetting(to: canvas)
            if usesSystemPicker {
                if onScreen.values.contains(where: { $0 === canvas }) { showPicker(for: canvas) }
            } else {
                picker.removeObserver(canvas)
                picker.setVisible(false, forFirstResponder: canvas)
                canvas.tool = tool
            }
        }
    }

    private func applyTouchSetting(to canvas: PKCanvasView) {
        canvas.superview?.isUserInteractionEnabled = letTouchesThrough
    }

    private func showPicker(for canvas: PKCanvasView) {
        picker.addObserver(canvas)
        picker.setVisible(true, forFirstResponder: canvas)
        canvas.becomeFirstResponder()
    }

    // MARK: PDFPageOverlayViewProvider

    func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
        guard let document else { return nil }
        let index = document.index(for: page)
        let canvas: PKCanvasView
        if retention == .keep, let existing = kept[index] {
            canvas = existing
        } else {
            canvas = makeCanvas()
            if retention == .keep { kept[index] = canvas }
        }
        pageOf[ObjectIdentifier(canvas)] = index
        return canvas
    }

    func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
        guard let canvas = overlayView as? PKCanvasView, let document else { return }
        let index = document.index(for: page)
        onScreen[index] = canvas
        stats.mostOnScreen = max(stats.mostOnScreen, onScreen.count)
        applyTouchSetting(to: canvas)
        if geometries[index] == nil, geometries.count < 20 {
            // Where two corners of the canvas land in the page's own space (PDFKit's: the crop box's, turned as the page is shown), which says how the canvas's top-left origin maps.
            func mapped(_ point: CGPoint) -> String {
                let there = pdfView.convert(pdfView.convert(point, from: canvas), to: page)
                // (A tenth of a point under zero would print as "-0".)
                return String(format: "(%.0f, %.0f)", abs(there.x) < 0.5 ? 0 : there.x, abs(there.y) < 0.5 ? 0 : there.y)
            }
            let box = page.bounds(for: .cropBox), media = page.bounds(for: .mediaBox)
            geometries[index] = String(format: "page %d: canvas %.0f × %.0f; crop box %.0f × %.0f at (%.0f, %.0f), media box %.0f × %.0f, turned %d°; canvas (0, 0) is page %@, canvas (%.0f, %.0f) is page %@",
                                       index + 1, canvas.bounds.width, canvas.bounds.height, box.width, box.height, box.origin.x, box.origin.y, media.width, media.height, page.rotation,
                                       mapped(.zero), canvas.bounds.width, canvas.bounds.height, mapped(CGPoint(x: canvas.bounds.width, y: canvas.bounds.height)))
        }
        // A canvas not yet filled takes its page's record. (A kept one already has it.)
        let id = ObjectIdentifier(canvas)
        if !filled.contains(id) {
            filled.insert(id)
            // (Decoding PencilKit's data, when that is how the page was held, is part of what coming back costs.)
            let started = CACurrentMediaTime()
            if let ink = inks[index] ?? inkData[index].flatMap({ try? PKDrawing(data: $0) }) {
                quiet()
                canvas.drawing = ink
                stats.restoreMilliseconds.append((CACurrentMediaTime() - started) * 1000)
            }
        }
        if usesSystemPicker { showPicker(for: canvas) }
    }

    func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
        guard let canvas = overlayView as? PKCanvasView, let index = pageOf[ObjectIdentifier(canvas)] else { return }
        onScreen[index] = nil
        stats.leftScreen += 1
        save(canvas, page: index)
        if emptiesOnLeave, !canvas.drawing.strokes.isEmpty {
            quiet()
            canvas.drawing = PKDrawing()
        }
        if usesSystemPicker { picker.removeObserver(canvas) }
        if retention == .drop {
            pageOf[ObjectIdentifier(canvas)] = nil
            filled.remove(ObjectIdentifier(canvas))
        }
    }

    private func makeCanvas() -> PKCanvasView {
        let started = CACurrentMediaTime()
        let canvas = PKCanvasView(frame: .zero)
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        // A scroll view that does not scroll, so that it never takes a finger's drag from the PDF.
        canvas.isScrollEnabled = false
        // The page is white in every scheme, so the ink is drawn for a light page.
        canvas.overrideUserInterfaceStyle = .light
        canvas.drawingPolicy = policy
        canvas.tool = tool
        canvas.delegate = self
        stats.created += 1
        stats.createMilliseconds.append((CACurrentMediaTime() - started) * 1000)
        return canvas
    }

    private struct Snapshot: @unchecked Sendable {
        let drawing: PKDrawing
        let size: CGSize
    }

    /// The page's record, kept up to date as the canvas changes. Leaving a page with new ink builds the stroke format the build will store, off the main thread as the
    /// build will; what that costs is measured here (it is the time the work itself takes, with the rest of the app still running).
    private func save(_ canvas: PKCanvasView, page index: Int) {
        defer { hold(page: index) }
        guard changed.remove(index) != nil else { return }
        let drawing = canvas.drawing
        inks[index] = drawing.strokes.isEmpty ? nil : drawing
        inkData[index] = nil
        counts[index] = drawing.strokes.isEmpty ? nil : Self.tally(drawing)
        guard !drawing.strokes.isEmpty, buildsStrokeFormat else { return }
        let snapshot = Snapshot(drawing: drawing, size: canvas.bounds.size)
        pendingConversions += 1
        // One page at a time, in order, as the build will do it: a book's worth of pages leaving at once must not become a book's worth of work running at once.
        converter.async { [weak self] in
            let started = CACurrentMediaTime()
            let document = InkDocument(drawing: snapshot.drawing, size: snapshot.size)
            let converted = CACurrentMediaTime()
            let json = document.jsonData()
            let written = CACurrentMediaTime()
            let packed = ((try? (json as NSData).compressed(using: .zlib)) as Data?)?.count ?? json.count
            let blob = snapshot.drawing.dataRepresentation().count
            let (convert, write) = ((converted - started) * 1000, (written - converted) * 1000)
            Task { @MainActor in self?.recordConversion(convert: convert, json: write, jsonBytes: json.count, packedBytes: packed, blobBytes: blob) }
        }
    }

    /// With `.data`, the page that has just left keeps PencilKit's data and lets go of the drawing.
    private func hold(page index: Int) {
        guard holding == .data, let live = inks[index] else { return }
        let started = CACurrentMediaTime()
        inkData[index] = live.dataRepresentation()
        stats.holdMilliseconds.append((CACurrentMediaTime() - started) * 1000)
        inks[index] = nil
    }

    private func recordConversion(convert: Double, json: Double, jsonBytes: Int, packedBytes: Int, blobBytes: Int) {
        pendingConversions -= 1
        stats.convertMilliseconds.append(convert)
        stats.jsonMilliseconds.append(json)
        stats.jsonBytes.append(jsonBytes)
        stats.packedBytes.append(packedBytes)
        stats.pencilKitBytes.append(blobBytes)
    }

    // MARK: PKCanvasViewDelegate

    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        guard let index = pageOf[ObjectIdentifier(canvasView)] else { return }
        // The record is always the canvas's latest, so that nothing drawn can be lost to a page leaving.
        let drawing = canvasView.drawing
        inks[index] = drawing.strokes.isEmpty ? nil : drawing
        inkData[index] = nil
        counts[index] = drawing.strokes.isEmpty ? nil : Self.tally(drawing)
        if CACurrentMediaTime() > quietUntil { changed.insert(index) }
    }

    func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) { stats.strokesStarted += 1 }
}
