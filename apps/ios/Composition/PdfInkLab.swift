import PDFKit
import PencilKit
import SwiftUI

// Spike B's lab (pdf-markup-plan.md, risk X3; build order step 0): does PencilKit over PDFKit work as the iPad's PDF ink needs it to? Three questions,
// asked of a PDF with a `PKCanvasView` over each page that is on screen (the page-overlay provider PDFKit has had since iOS 16):
//
//   1. Can a finger still scroll and select text while the Pencil draws on the canvases over the pages? (The canvases take the Pencil only.)
//   2. Does the ink follow the Pencil as it should (latency), and does the app keep its frames?
//   3. What does it cost to have a canvas on every page of a 500-page PDF? (Only the pages on screen have one; the drawings are kept as data.)
//
// It is a lab, not the reader: nothing here is saved, it makes its own PDFs, and it reads no note. It was run in the Simulator, which has no Pencil: the
// *Any input* switch lets a finger draw there, so the machinery (overlays made and dropped as pages come and go, a finger still scrolling and selecting
// when the canvases are Pencil-only, the drawings kept per page, the memory) is checked; the Pencil itself, and how the ink feels, are the iPad's to say
// (docs/manual-tests/ipad.md, "The PDF ink lab").

@MainActor @Observable
final class PdfInkLab {
    enum Book: String, CaseIterable, Identifiable {
        case small = "12 pages"
        case big = "500 pages"
        var id: String { rawValue }
        var pages: Int { self == .small ? 12 : 500 }
    }

    var book = Book.small
    var document: PDFDocument?
    var making = false
    /// A canvas over each page on screen (off: the plain reader, to compare the memory).
    var overlaysOn = true { didSet { reload() } }
    /// The canvases take the Pencil only (a finger scrolls and selects). On the Simulator, which has no Pencil, *Any input* lets a finger draw.
    var pencilOnly = true { didSet { updatePolicy() } }
    /// Put a stroke of a few hundred points on each page as it comes on screen, to see what drawn pages cost.
    var strokeEveryPage = false

    // What the lab counts.
    private(set) var overlaysLive = 0
    private(set) var overlaysMade = 0
    private(set) var overlaysDropped = 0
    private(set) var overlaysShown = 0
    private(set) var overlaysPeak = 0
    private(set) var pageIndex = 0
    private(set) var selectionLength = 0
    private(set) var strokes = 0
    private(set) var pencilTouches = 0
    private(set) var fingerTouches = 0
    private(set) var pencilSamples = 0
    private(set) var delayMeanMS = 0.0
    private(set) var delayWorstMS = 0.0
    private(set) var worstFrameMS = 0.0
    private(set) var framesOver = 0
    private(set) var footprintMB = 0.0
    private(set) var footprintPeakMB = 0.0
    private(set) var overlayGeometry = "no overlay yet"
    /// What a touch on the PDF landed on (the deepest view under the finger or Pencil), as a hit test says: a canvas, or PDFKit's own view.
    private(set) var lastTouchLanded = "nothing touched yet"
    private(set) var scrollReport = ""
    private(set) var scrolling = false

    @ObservationIgnored weak var view: PDFView?
    @ObservationIgnored fileprivate var canvases: [Int: InkCanvas] = [:]
    @ObservationIgnored fileprivate var drawings: [Int: PKDrawing] = [:]
    @ObservationIgnored private var delaySum = 0.0
    @ObservationIgnored private var delayCount = 0
    @ObservationIgnored private var link: CADisplayLink?
    @ObservationIgnored private var lastFrame: CFTimeInterval = 0
    @ObservationIgnored private var delegateKeepAlive: Overlays?

    // MARK: The PDFs

    private static func file(_ book: Book) -> URL {
        FileManager.default.temporaryDirectory.appending(path: "PdfInkLab-\(book.pages).pdf")
    }

    /// Makes the PDF the first time and keeps it (500 pages of a few lines each, about 2 MB).
    func load() async {
        making = true
        let book = book
        let url = Self.file(book)
        if !FileManager.default.fileExists(atPath: url.path) {
            await Task.detached(priority: .userInitiated) { Self.make(book, at: url) }.value
        }
        document = PDFDocument(url: url)
        drawings = [:]
        canvases = [:]
        strokes = 0
        making = false
        resetCounts()
        sampleMemory()
    }

    nonisolated private static func make(_ book: Book, at url: URL) {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            for page in 1...book.pages {
                context.beginPage()
                ("Page \(page)" as NSString).draw(at: CGPoint(x: 72, y: 60), withAttributes: [.font: UIFont.systemFont(ofSize: 36)])
                for line in 0..<28 {
                    ("Line \(line + 1) of page \(page): the quick brown fox jumps over the lazy dog, again and again and again." as NSString)
                        .draw(at: CGPoint(x: 72, y: 130 + CGFloat(line) * 22), withAttributes: [.font: UIFont.systemFont(ofSize: 13)])
                }
            }
        }
        try? data.write(to: url)
    }

    // MARK: The view and its overlays

    func attach(_ view: PDFView) {
        self.view = view
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.autoScales = true
        view.displaysPageBreaks = true
        view.document = document
        view.accessibilityIdentifier = "ink-lab-pdf"
        // Says what each touch lands on (without taking it from anything).
        ProbeTarget.shared.lab = self
        let probe = UILongPressGestureRecognizer(target: ProbeTarget.shared, action: #selector(ProbeTarget.touched(_:)))
        probe.minimumPressDuration = 0
        probe.cancelsTouchesInView = false
        probe.delaysTouchesBegan = false
        probe.delegate = ProbeTarget.shared
        view.addGestureRecognizer(probe)
        reload()
        startFrames()
    }

    /// Gives the view (or takes from it) the provider of canvases.
    func reload() {
        guard let view else { return }
        canvases = [:]
        overlaysLive = 0
        if overlaysOn {
            let provider = Overlays(lab: self)
            delegateKeepAlive = provider
            view.pageOverlayViewProvider = provider
        } else {
            view.pageOverlayViewProvider = nil
            delegateKeepAlive = nil
        }
        // PDFKit asks again for the overlays of the pages in view when the document is set again.
        let keep = view.document
        view.document = nil
        view.document = keep
    }

    private func updatePolicy() {
        for canvas in canvases.values { canvas.drawingPolicy = pencilOnly ? .pencilOnly : .anyInput }
    }

    fileprivate func overlayMade(_ canvas: InkCanvas, for page: PDFPage) {
        overlaysMade += 1
        canvas.drawingPolicy = pencilOnly ? .pencilOnly : .anyInput
    }

    fileprivate func overlayShown(_ canvas: InkCanvas, index: Int, view: PDFView) {
        canvases[index] = canvas
        overlaysShown += 1
        canvas.pageIndex = index
        canvas.drawing = drawings[index] ?? PKDrawing()
        if strokeEveryPage, canvas.drawing.strokes.isEmpty { canvas.drawing = Self.sampleStroke(on: CGRect(x: 0, y: 0, width: 612, height: 792)) }
        overlaysLive = canvases.count
        overlaysPeak = max(overlaysPeak, overlaysLive)
        let transform = canvas.transform
        overlayGeometry = String(format: "page %d: frame %.0f×%.0f, bounds %.0f×%.0f, transform scale %.2f, view scale %.2f", index + 1, canvas.frame.width, canvas.frame.height, canvas.bounds.width, canvas.bounds.height, transform.a, view.scaleFactor)
        recountStrokes()
    }

    fileprivate func overlayHidden(_ canvas: InkCanvas, index: Int) {
        // What was drawn is kept as data, and the canvas goes with the page.
        if !canvas.drawing.strokes.isEmpty || drawings[index] == nil { drawings[index] = canvas.drawing }
        if canvases[index] === canvas { canvases[index] = nil }
        overlaysDropped += 1
        overlaysLive = canvases.count
        recountStrokes()
    }

    fileprivate func recountStrokes() {
        var live = drawings
        // A canvas that has nothing on it does not hide what is kept for its page.
        for (index, canvas) in canvases where !canvas.drawing.strokes.isEmpty || live[index] == nil { live[index] = canvas.drawing }
        strokes = live.values.reduce(0) { $0 + $1.strokes.count }
    }

    func strokeChanged() { recountStrokes() }

    /// A hundred and fifty points of a wavy line: about what a few words of handwriting weigh.
    private static func sampleStroke(on bounds: CGRect) -> PKDrawing {
        let ink = PKInk(.pen, color: .systemBlue)
        let points = (0..<150).map { step -> PKStrokePoint in
            let t = Double(step) / 149
            let location = CGPoint(x: bounds.width * (0.2 + 0.6 * t), y: bounds.height * 0.5 + 24 * sin(t * 14))
            return PKStrokePoint(location: location, timeOffset: t * 0.8, size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date())
        return PKDrawing(strokes: [PKStroke(ink: ink, path: path)])
    }

    func clearDrawings() {
        drawings = [:]
        for canvas in canvases.values { canvas.drawing = PKDrawing() }
        recountStrokes()
    }

    // MARK: What is counted

    func pageChanged() {
        guard let view, let document, let page = view.currentPage else { return }
        // A page of the book that was just replaced is not in this one (the view and the lab change books a moment apart).
        let index = document.index(for: page)
        guard index != NSNotFound else { return }
        pageIndex = index
    }

    func selectionChanged() { selectionLength = view?.currentSelection?.string?.count ?? 0 }

    fileprivate func touch(_ touch: UITouch, _ event: UIEvent?, moved: Bool) {
        let delay = max(0, (ProcessInfo.processInfo.systemUptime - touch.timestamp) * 1000)
        if touch.type == .pencil {
            if !moved { pencilTouches += 1 }
            let samples = max(event?.coalescedTouches(for: touch)?.count ?? 1, 1)
            pencilSamples += samples
            delaySum += delay
            delayCount += 1
            delayMeanMS = delaySum / Double(delayCount)
            delayWorstMS = max(delayWorstMS, delay)
        } else if !moved {
            fingerTouches += 1
        }
    }

    /// Where a touch in the middle of the PDF would land, asked of the view directly (no touch needed): the views from the deepest up, and where the canvas of the page
    /// there is, in the PDF view's own coordinates. If the canvas is not what a touch lands on, nothing drawn on it can reach it.
    func whereWouldATouchLand() {
        guard let view else { return }
        let point = CGPoint(x: view.bounds.midX, y: view.bounds.height * 0.4)
        touchLanded(on: view.hitTest(point, with: nil), kind: "a probe")
        let rects = canvases.sorted { $0.key < $1.key }.map { index, canvas -> String in
            let box = canvas.convert(canvas.bounds, to: view)
            return String(format: "page %d at x %.0f y %.0f, %.0f×%.0f", index + 1, box.minX, box.minY, box.width, box.height)
        }
        lastTouchLanded += " · the PDF view is \(Int(view.bounds.width))×\(Int(view.bounds.height)), the probe is at x \(Int(point.x)) y \(Int(point.y)) · canvases in it: " + (rects.isEmpty ? "none" : rects.joined(separator: "; "))
        lastTouchLanded += " · policy: " + (pencilOnly ? "Pencil only" : "any input")
    }

    fileprivate func touchLanded(on hit: UIView?, kind: String) {
        var names: [String] = []
        var current = hit
        while let view = current, names.count < 4 {
            names.append(String(describing: type(of: view)))
            current = view.superview
        }
        lastTouchLanded = "\(kind) touch landed on " + names.joined(separator: " in ")
    }

    func resetCounts() {
        overlaysMade = 0
        overlaysDropped = 0
        overlaysShown = 0
        overlaysPeak = overlaysLive
        pencilTouches = 0
        fingerTouches = 0
        pencilSamples = 0
        delaySum = 0
        delayCount = 0
        delayMeanMS = 0
        delayWorstMS = 0
        worstFrameMS = 0
        framesOver = 0
        footprintPeakMB = 0
        scrollReport = ""
        sampleMemory()
    }

    // MARK: Frames and memory

    private func startFrames() {
        guard link == nil else { return }
        let display = CADisplayLink(target: FrameTarget(self), selector: #selector(FrameTarget.tick(_:)))
        display.add(to: .main, forMode: .common)
        link = display
    }

    fileprivate func frame(_ now: CFTimeInterval, expected: CFTimeInterval) {
        defer { lastFrame = now }
        guard lastFrame > 0 else { return }
        let gap = (now - lastFrame) * 1000
        // Only a frame well past its time counts, and only while something is happening: a still screen is not drawn again.
        if gap > expected * 1000 * 1.9, gap < 500 {
            framesOver += 1
            worstFrameMS = max(worstFrameMS, gap)
        }
    }

    func sampleMemory() {
        footprintMB = Self.footprint()
        footprintPeakMB = max(footprintPeakMB, footprintMB)
    }

    /// The memory the system charges the app for (`phys_footprint`, the number Xcode's memory gauge shows).
    private static func footprint() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
    }

    /// Goes down the whole book as a reader paging fast would: to every other page, a moment to draw it, then a nudge down it, so that PDFKit draws the pages on
    /// the way and asks for their canvases (a jump on its own, with no time to draw, gives it no reason to).
    func scrollThroughTheBook() async {
        guard let view, let document, !scrolling else { return }
        scrolling = true
        defer { scrolling = false }
        // *A stroke on every page*: a drawing of one stroke is made for every page of the book first (kept as data, as a book marked on every page would have), and the
        // canvases that are put on pages load theirs.
        if strokeEveryPage {
            for index in 0..<document.pageCount where drawings[index]?.strokes.isEmpty ?? true { drawings[index] = Self.sampleStroke(on: CGRect(x: 0, y: 0, width: 612, height: 792)) }
            recountStrokes()
        }
        resetCounts()
        let before = footprintMB
        let started = ContinuousClock.now
        let scroll = Self.scrollView(in: view)
        var visited = 0
        for index in stride(from: 0, to: document.pageCount, by: 2) {
            guard let page = document.page(at: index) else { continue }
            view.go(to: page)
            try? await Task.sleep(for: .milliseconds(45))
            if let scroll {
                scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: scroll.contentOffset.y + view.bounds.height * 0.5), animated: false)
                try? await Task.sleep(for: .milliseconds(45))
            }
            visited += 1
            if visited % 10 == 0 { sampleMemory() }
        }
        sampleMemory()
        let elapsed = started.duration(to: .now)
        let seconds = Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
        scrollReport = String(
            format: "Went through all %d pages in %.1f s (every other page, %d stops). Canvases: %d made, %d put on a page, %d taken off, at most %d on screen at once. Memory %.0f MB before, %.0f MB at the end, %.0f MB at most. %d slow frames, worst %.0f ms. %d strokes kept.",
            document.pageCount, seconds, visited, overlaysMade, overlaysShown, overlaysDropped, overlaysPeak, before, footprintMB, footprintPeakMB, framesOver, worstFrameMS, strokes)
    }

    /// The scroll view PDFKit scrolls its pages in.
    private static func scrollView(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView, !(scroll is PKCanvasView) { return scroll }
        for child in view.subviews { if let found = scrollView(in: child) { return found } }
        return nil
    }
}

@MainActor
private final class ProbeTarget: NSObject, UIGestureRecognizerDelegate {
    static let shared = ProbeTarget(nil)
    weak var lab: PdfInkLab?

    init(_ lab: PdfInkLab?) { self.lab = lab }

    @objc func touched(_ recogniser: UILongPressGestureRecognizer) {
        guard recogniser.state == .began, let view = recogniser.view else { return }
        lab?.touchLanded(on: view.hitTest(recogniser.location(in: view), with: nil), kind: "a")
    }

    nonisolated func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}

/// CADisplayLink holds its target; this one only passes the beat on.
@MainActor
private final class FrameTarget: NSObject {
    weak var lab: PdfInkLab?

    init(_ lab: PdfInkLab) { self.lab = lab }

    @objc func tick(_ link: CADisplayLink) {
        lab?.frame(link.timestamp, expected: link.targetTimestamp - link.timestamp)
    }
}

/// The canvas over a page: it counts what touches it, by what touched.
final class InkCanvas: PKCanvasView {
    weak var lab: PdfInkLab?
    var pageIndex = 0

    init(lab: PdfInkLab) {
        self.lab = lab
        super.init(frame: .zero)
        backgroundColor = .clear
        isOpaque = false
        isScrollEnabled = false
        tool = PKInkingTool(.pen, color: .systemBlue, width: 3)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches { lab?.touch(touch, event, moved: false) }
        super.touchesBegan(touches, with: event)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches { lab?.touch(touch, event, moved: true) }
        super.touchesMoved(touches, with: event)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesEnded(touches, with: event)
        lab?.strokeChanged()
    }
}

/// PDFKit's page-overlay provider: a canvas for a page when it comes on screen, and the drawing kept when it goes.
@MainActor
private final class Overlays: NSObject, @preconcurrency PDFPageOverlayViewProvider {
    weak var lab: PdfInkLab?

    init(lab: PdfInkLab) { self.lab = lab }

    func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
        guard let lab else { return nil }
        let canvas = InkCanvas(lab: lab)
        lab.overlayMade(canvas, for: page)
        return canvas
    }

    func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
        guard let canvas = overlayView as? InkCanvas, let document = pdfView.document else { return }
        let index = document.index(for: page)
        guard index != NSNotFound else { return }
        lab?.overlayShown(canvas, index: index, view: pdfView)
    }

    func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
        guard let canvas = overlayView as? InkCanvas, let document = pdfView.document else { return }
        let index = document.index(for: page)
        guard index != NSNotFound else { return }
        lab?.overlayHidden(canvas, index: index)
    }
}

// MARK: - The screen

struct PdfInkLabView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var lab = PdfInkLab()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if lab.document == nil {
                    ProgressView(lab.making ? "Making the PDF…" : "").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    InkPdfView(lab: lab).id(lab.book)
                }
                Divider()
                hud
            }
            .navigationTitle("PDF ink lab (spike B)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .principal) {
                    Picker("Book", selection: $lab.book) { ForEach(PdfInkLab.Book.allCases) { Text($0.rawValue).tag($0) } }
                        .pickerStyle(.segmented)
                        .frame(width: 220)
                        .accessibilityIdentifier("ink-lab-book")
                }
            }
        }
        .task(id: lab.book) { await lab.load() }
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewPageChanged)) { _ in lab.pageChanged() }
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewSelectionChanged)) { _ in lab.selectionChanged() }
        .task {
            // Developer shortcut for scripts: `-pdfInkLabBook 500` chooses the big book at launch.
            if UserDefaults.standard.integer(forKey: "pdfInkLabBook") == 500 { lab.book = .big }
        }
    }

    private var hud: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 18) {
                Toggle("Canvas over each page", isOn: $lab.overlaysOn).accessibilityIdentifier("ink-lab-overlays")
                Toggle("Pencil only", isOn: $lab.pencilOnly).accessibilityIdentifier("ink-lab-pencil-only")
                Toggle("A stroke on every page", isOn: $lab.strokeEveryPage).accessibilityIdentifier("ink-lab-stroke-every")
            }
            .font(.callout)
            HStack {
                Button("Scroll through the book") { Task { await lab.scrollThroughTheBook() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(lab.scrolling || lab.document == nil)
                    .accessibilityIdentifier("ink-lab-scroll")
                Button("Where would a touch land?") { lab.whereWouldATouchLand() }.accessibilityIdentifier("ink-lab-probe")
                Button("Count again") { lab.resetCounts() }.accessibilityIdentifier("ink-lab-reset")
                Button("Clear the drawing") { lab.clearDrawings() }.accessibilityIdentifier("ink-lab-clear")
                Button("Memory now") { lab.sampleMemory() }
            }
            .buttonStyle(.bordered)
            Text(report)
                .font(.system(.footnote, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("ink-lab-report")
            if !lab.scrollReport.isEmpty {
                Text(lab.scrollReport).font(.footnote).accessibilityIdentifier("ink-lab-scroll-report")
            }
        }
        .padding(12)
        .background(.bar)
    }

    private var report: String {
        let delay = lab.pencilSamples == 0 ? "no Pencil yet" : String(format: "delivery delay %.1f ms mean, %.1f ms worst over %d samples", lab.delayMeanMS, lab.delayWorstMS, lab.pencilSamples)
        return """
        page \(lab.pageIndex + 1) · canvases on screen \(lab.overlaysLive) (\(lab.overlaysMade) made, \(lab.overlaysShown) shown, \(lab.overlaysDropped) dropped, most at once \(lab.overlaysPeak)) · strokes \(lab.strokes)
        touches on a canvas: Pencil \(lab.pencilTouches), finger \(lab.fingerTouches) · selected \(lab.selectionLength) characters
        \(delay) · slow frames \(lab.framesOver), worst \(String(format: "%.0f", lab.worstFrameMS)) ms · memory \(String(format: "%.0f", lab.footprintMB)) MB (most \(String(format: "%.0f", lab.footprintPeakMB)))
        \(lab.overlayGeometry)
        \(lab.lastTouchLanded)
        """
    }
}

private struct InkPdfView: UIViewRepresentable {
    let lab: PdfInkLab

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        lab.attach(view)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}
