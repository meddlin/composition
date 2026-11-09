import CompositionInk
import PDFKit
import PencilKit
import SwiftUI
import UIKit

// Spike B's lab (docs/pdf-markup-plan.md, "Spike B status"): PencilKit over PDFKit, for the three questions the plan leaves open. Does a finger still scroll and select
// while the Pencil draws on a canvas over the page? Is the ink as quick as Notes'? And does a 500-page book fit in memory when each page near the screen has a canvas?
// The lab is a `PDFView` with a canvas on each page near the screen, a test book (or one of your own from Files), runs that scroll and draw on their own and
// measure, a recording for what you do by hand, a checklist for what only a person can judge, and a report to copy out. It stores nothing: ink lives while the lab is open.

@MainActor @Observable
final class PdfInkLab {
    enum Tool: String, CaseIterable, Identifiable {
        case pen = "Black pen", blue = "Blue pen", marker = "Yellow marker", pixelEraser = "Pixel eraser", strokeEraser = "Stroke eraser", lasso = "Lasso"
        var id: String { rawValue }
        var pkTool: PKTool {
            switch self {
            case .pen: PKInkingTool(.pen, color: .black, width: 3)
            case .blue: PKInkingTool(.pen, color: .systemBlue, width: 3)
            case .marker: PKInkingTool(.marker, color: .systemYellow, width: 18)
            case .pixelEraser: PKEraserTool(.bitmap)
            case .strokeEraser: PKEraserTool(.vector)
            case .lasso: PKLassoTool()
            }
        }
    }

    struct Result: Identifiable {
        let id = UUID()
        let title: String
        let lines: [String]
    }

    static let onSimulator: Bool = {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }()

    // MARK: What the screen shows

    var bookName = "No book yet"
    var pageCount = 0
    /// What the lab is doing (making a book, a run), or nil when it is idle.
    var busy: String?
    var progress: Double?
    var hud = ""
    var results: [Result] = []
    var cases: [String: LabCaseState] = [:]
    var notes = ""
    var recording = false
    var status = ""

    // MARK: Settings (the view's controls; `settingsChanged()` carries them over)

    var canvasesOn = true
    var retention = Retention.drop
    var holding = InkHolding.drawing
    /// Builds the stroke format (JSON) of a page that leaves with new ink, as the build will; off, for the memory of the canvases and the held ink alone.
    var buildsStrokeFormat = true
    /// Empties a canvas as its page leaves (see `PdfInkLabOverlays.emptiesOnLeave`).
    var emptiesOnLeave = false
    /// On the Simulator there is no Pencil, so a finger draws unless it is turned off; on an iPad the Pencil draws and a finger scrolls and selects.
    var fingerDraws = PdfInkLab.onSimulator
    var tool = Tool.pen
    var systemPicker = false
    /// Turns touches back on in PDFKit's page view, which holds the canvases and takes none (see `PdfInkLabOverlays.letTouchesThrough`).
    var touchesThrough = true
    var density = LabInk.Density.dense
    /// How fast the scroll run goes: pages a second (4 is reading, 12 is looking for a page, 30 is a hard flick).
    var speed = 12.0

    var settingsKey: String { "\(canvasesOn)|\(retention.rawValue)|\(holding.rawValue)|\(buildsStrokeFormat)|\(emptiesOnLeave)|\(fingerDraws)|\(tool.rawValue)|\(systemPicker)|\(touchesThrough)" }

    var settingsLine: String {
        [canvasesOn ? "canvases on pages" : "no canvases", canvasesOn ? (retention == .drop ? "dropped when their page leaves" : "all kept") : nil, holding == .data ? "off-screen ink held as PencilKit data" : nil, buildsStrokeFormat ? nil : "stroke format not built", emptiesOnLeave ? "canvas emptied on leaving" : nil,
         touchesThrough ? "page view touches on" : "page view as PDFKit made it", fingerDraws ? "finger draws, two fingers scroll" : "Pencil only", systemPicker ? "system tool picker" : tool.rawValue].compactMap { $0 }.joined(separator: ", ")
    }

    // MARK: Inside

    @ObservationIgnored let overlays = PdfInkLabOverlays()
    @ObservationIgnored private(set) weak var pdfView: PDFView?
    @ObservationIgnored private(set) var document: PDFDocument?
    @ObservationIgnored private var scopedURL: URL?
    @ObservationIgnored private let trace = LabTrace()
    @ObservationIgnored private let frames = LabFrames()
    @ObservationIgnored private let probe = LabTouchProbe(target: nil, action: nil)
    @ObservationIgnored private var touches: [LabTouchSample] = []
    @ObservationIgnored private var collecting = false
    @ObservationIgnored private var appliedRetention = Retention.drop
    @ObservationIgnored private var recordingBefore: PdfInkLabOverlays.Stats?
    @ObservationIgnored private var runTask: Task<Void, Never>?
    @ObservationIgnored private var stopRequested = false
    @ObservationIgnored private var started = false

    init() {
        probe.record = { [weak self] sample in
            guard let self, self.collecting, self.touches.count < 60_000 else { return }
            self.touches.append(sample)
        }
    }

    /// Called by the view that holds the `PDFView`.
    func attach(_ view: PDFView) {
        pdfView = view
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.displaysPageBreaks = true
        view.backgroundColor = .systemGray5
        view.addGestureRecognizer(probe)
        view.pageOverlayViewProvider = canvasesOn ? overlays : nil
        appliedRetention = retention
        settingsChanged()
        if let document { view.document = document }
    }

    /// Opens the book the lab starts with and runs what the launch arguments ask for; then keeps the readout up to date until the screen goes.
    func start() async {
        if !started {
            started = true
            Task { await runLaunchArguments() }
        }
        while !Task.isCancelled {
            refreshReadout()
            try? await Task.sleep(for: .milliseconds(250))
        }
    }

    func close() {
        stopRequested = true
        trace.stop()
        frames.stop()
        frames.onTick = nil
        scopedURL?.stopAccessingSecurityScopedResource()
        scopedURL = nil
    }

    // MARK: Settings

    func settingsChanged() {
        overlays.retention = retention
        overlays.holding = holding
        overlays.buildsStrokeFormat = buildsStrokeFormat
        overlays.emptiesOnLeave = emptiesOnLeave
        overlays.policy = fingerDraws ? .anyInput : .pencilOnly
        overlays.tool = tool.pkTool
        overlays.usesSystemPicker = systemPicker
        overlays.letTouchesThrough = touchesThrough
        overlays.settingsChanged()
        guard let view = pdfView else { return }
        // Where a finger draws it is one finger that draws and two that scroll, as in a drawing app; otherwise a finger scrolls and only the Pencil draws.
        if let scroll = Self.scrollView(in: view) { scroll.panGestureRecognizer.minimumNumberOfTouches = fingerDraws ? 2 : 1 }
        let have = view.pageOverlayViewProvider != nil
        if canvasesOn != have || retention != appliedRetention {
            appliedRetention = retention
            if retention == .drop { overlays.dropKept() }
            view.pageOverlayViewProvider = canvasesOn ? overlays : nil
            // Pages already on show keep the overlays (or none) they had, so the view is given its document again.
            if let document {
                let page = view.currentPage
                overlays.forgetScreen()
                view.document = nil
                view.document = document
                if let page { view.go(to: page) }
            }
        }
    }

    // MARK: Books

    private struct Opened: @unchecked Sendable { let document: PDFDocument? }

    func openGenerated(pages: Int, turned: Bool = false) async {
        guard busy == nil else { return }
        busy = "Making a \(pages)-page book…"
        let url: URL? = await Task.detached(priority: .userInitiated) {
            try? LabBook.make(pages: pages) { done in
                Task { @MainActor in self.progress = Double(done) / Double(pages) }
            }
        }.value
        progress = nil
        guard let url else {
            busy = nil
            status = "The book could not be written."
            return
        }
        await load(url, name: turned ? "Generated book with turned and cropped pages" : "Generated book", turned: turned)
    }

    func open(fileAt url: URL) async {
        guard busy == nil else { return }
        scopedURL?.stopAccessingSecurityScopedResource()
        scopedURL = url.startAccessingSecurityScopedResource() ? url : nil
        let bytes = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        await load(url, name: url.lastPathComponent + (bytes.map { " (\(LabMemory.size($0)))" } ?? ""))
    }

    private func load(_ url: URL, name: String, turned: Bool = false) async {
        busy = "Opening \(name)…"
        let opened = await Task.detached(priority: .userInitiated) { Opened(document: PDFDocument(url: url)) }.value
        busy = nil
        guard let opened = opened.document else {
            status = "That file could not be opened as a PDF."
            return
        }
        guard !opened.isLocked else {
            status = "That PDF is locked; the lab does not ask for a password."
            return
        }
        if turned { LabBook.turnAndCrop(opened) }
        overlays.reset()
        overlays.document = opened
        document = opened
        pageCount = opened.pageCount
        bookName = name
        status = ""
        pdfView?.document = opened
    }

    func jump(to index: Int) {
        guard let document, let page = document.page(at: max(0, min(index, document.pageCount - 1))) else { return }
        pdfView?.go(to: page)
    }

    // MARK: Runs

    func perform(_ label: String, _ body: @MainActor () async -> Void) async {
        guard busy == nil, document != nil else { return }
        stopRequested = false
        busy = label
        await body()
        busy = nil
        progress = nil
    }

    func start(_ label: String, _ body: @escaping @MainActor () async -> Void) {
        runTask = Task { await perform(label, body) }
    }

    func stop() { stopRequested = true }

    private func begin() -> PdfInkLabOverlays.Stats {
        touches = []
        collecting = true
        overlays.resetPeak()
        trace.start()
        frames.start()
        return overlays.stats
    }

    private func finish(_ title: String, before: PdfInkLabOverlays.Stats, extra: [String] = []) {
        collecting = false
        frames.stop()
        frames.onTick = nil
        trace.stop()
        var lines = [frames.line, trace.line] + extra
        lines += overlayLines(before: before, after: overlays.stats)
        if !touches.isEmpty { lines += LabStats.touchLines(touches, frameTargets: frames.targets) }
        results.append(Result(title: "\(title) — \(bookName); \(settingsLine)", lines: lines))
    }

    private func overlayLines(before: PdfInkLabOverlays.Stats, after: PdfInkLabOverlays.Stats) -> [String] {
        guard canvasesOn else { return ["Canvases were off: this is the PDF alone."] }
        func added<T>(_ new: [T], _ old: [T]) -> [T] { Array(new.dropFirst(old.count)) }
        var lines = ["Canvases: \(after.created - before.created) made, \(after.leftScreen - before.leftScreen) left the screen, most on screen at once \(after.mostOnScreen), \(overlays.keptCount) kept now"]
        let made = added(after.createMilliseconds, before.createMilliseconds)
        if !made.isEmpty { lines.append("Making a canvas: \(LabStats.line(made))") }
        let restored = added(after.restoreMilliseconds, before.restoreMilliseconds)
        if !restored.isEmpty { lines.append("Putting a page's ink back on a canvas that came back: \(LabStats.line(restored))") }
        let held = added(after.holdMilliseconds, before.holdMilliseconds)
        if !held.isEmpty { lines.append("Making PencilKit's data from a page's drawing when it leaves (main thread): \(LabStats.line(held))") }
        let converted = added(after.convertMilliseconds, before.convertMilliseconds)
        if !converted.isEmpty {
            lines.append("Leaving a page with new ink (the stroke format built from PencilKit's drawing, off the main thread): \(LabStats.line(converted))")
            lines.append("… then written as JSON: \(LabStats.line(added(after.jsonMilliseconds, before.jsonMilliseconds)))")
            let json = added(after.jsonBytes, before.jsonBytes).map(Double.init)
            let packed = added(after.packedBytes, before.packedBytes).map(Double.init)
            let blob = added(after.pencilKitBytes, before.pencilKitBytes).map(Double.init)
            lines.append("A page's record: JSON \(LabStats.line(json.map { $0 / 1024 }, unit: "KB", digits: 0)); zipped \(LabStats.line(packed.map { $0 / 1024 }, unit: "KB", digits: 0)); PencilKit's own copy \(LabStats.line(blob.map { $0 / 1024 }, unit: "KB", digits: 0))")
        }
        let strokes = after.strokesStarted - before.strokesStarted
        if strokes > 0 { lines.append("Strokes begun by hand or tool in this stretch: \(strokes)") }
        return lines
    }

    /// Until the pages that were left have had their records built (they are built on another thread, so a run would end before they were counted).
    private func waitForConversions() async {
        let end = CACurrentMediaTime() + 120
        while overlays.pendingConversions > 0, CACurrentMediaTime() < end, !stopRequested { try? await Task.sleep(for: .milliseconds(50)) }
    }

    private func settle(_ seconds: Double) async {
        let end = CACurrentMediaTime() + seconds
        while CACurrentMediaTime() < end, !stopRequested { try? await Task.sleep(for: .milliseconds(50)) }
    }

    private func waitForCanvas(_ index: Int) async -> PKCanvasView? {
        let end = CACurrentMediaTime() + 2
        while CACurrentMediaTime() < end, !stopRequested {
            if let canvas = overlays.canvas(at: index), canvas.bounds.width > 0 { return canvas }
            try? await Task.sleep(for: .milliseconds(16))
        }
        return overlays.canvas(at: index)
    }

    /// Scrolls the PDF's own scroll view, which is the first one under the `PDFView` (the canvases are scroll views too, on the pages).
    private static func scrollView(in root: UIView) -> UIScrollView? {
        var queue = [root]
        while !queue.isEmpty {
            let view = queue.removeFirst()
            if view !== root, let scroll = view as? UIScrollView, !(scroll is PKCanvasView) { return scroll }
            queue.append(contentsOf: view.subviews)
        }
        return nil
    }

    /// The scroll run: from the first page to the last at a steady speed, the way a hand flicking through a book goes, measuring memory and frames.
    func scrollThroughEveryPage() async {
        await perform("Scrolling through every page") {
            guard let view = pdfView, document != nil, let scroll = Self.scrollView(in: view), scroll.contentSize.height > 0 else {
                status = "Nothing to scroll."
                return
            }
            jump(to: 0)
            await settle(1.5)
            let pointsPerSecond = scroll.contentSize.height / CGFloat(pageCount) * CGFloat(speed)
            let before = begin()
            let began = CACurrentMediaTime()
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                var finished = false
                frames.onTick = { [weak self, weak scroll] interval in
                    guard let self, let scroll, !finished else { return }
                    let last = max(0, scroll.contentSize.height - scroll.bounds.height)
                    let y = scroll.contentOffset.y + CGFloat(min(interval, 0.1)) * pointsPerSecond
                    self.progress = last > 0 ? Double(y / last) : 1
                    if y >= last || self.stopRequested {
                        finished = true
                        done.resume()
                    } else {
                        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: false)
                    }
                }
            }
            let seconds = CACurrentMediaTime() - began
            await settle(1.0)
            finish("Scroll through all \(pageCount) pages at \(Int(speed)) pages a second",
                   before: before, extra: [String(format: "Pages a second reached: %.1f (asked for %.0f)", Double(pageCount) / seconds, speed)])
        }
    }

    /// The draw run: ink put on the first `count` pages by code, one page at a time, then back to the start. Each page is shown first so that its canvas exists and draws
    /// the ink, as it would under a hand; leaving it saves the page's record and the lab times the conversion. A second stretch visits the same pages again for the cost of coming back.
    func drawOnPages(_ count: Int) async {
        await perform("Drawing on \(count) pages") {
            guard document != nil, canvasesOn else {
                status = "Canvases are off, or there is no book."
                return
            }
            let total = min(count, pageCount)
            overlays.clearAllInk()
            jump(to: 0)
            await settle(1.5)
            let baseline = LabMemory.read()
            let before = begin()
            for index in 0..<total where !stopRequested {
                jump(to: index)
                let size = await waitForCanvas(index)?.bounds.size ?? document?.page(at: index)?.bounds(for: .cropBox).size ?? CGSize(width: 612, height: 792)
                overlays.setInk(LabInk.drawing(page: index, size: size, density: density), page: index)
                progress = Double(index + 1) / Double(total)
                await settle(0.08)
            }
            jump(to: 0)
            await settle(2.0)
            await waitForConversions()
            let after = LabMemory.read()
            let totals = overlays.inkTotals
            finish("Draw on \(total) pages (\(density.rawValue))", before: before, extra: [
                "Ink stored: \(totals.pages) pages, \(totals.strokes) strokes, \(totals.points) points",
                "Memory before the first page \(LabMemory.megabytes(baseline.footprint)), two seconds after the last \(LabMemory.megabytes(after.footprint)): \(LabMemory.megabytes(after.footprint - baseline.footprint)) more for \(total) pages of ink",
            ])

            // Back through the same pages: what each costs to come back to.
            let revisit = begin()
            for index in 0..<total where !stopRequested {
                jump(to: index)
                _ = await waitForCanvas(index)
                progress = Double(index + 1) / Double(total)
                await settle(0.05)
            }
            jump(to: 0)
            await settle(1.0)
            finish("Come back to those \(total) pages", before: revisit)
        }
    }

    /// Starts or ends a recording of what you do by hand: touches, frames, memory and canvases, from the first press to the stop.
    func toggleRecording() {
        if recording {
            recording = false
            if let before = recordingBefore {
                let totals = overlays.inkTotals
                finish("By hand", before: before, extra: ["Ink now stored: \(totals.pages) pages, \(totals.strokes) strokes, \(totals.points) points"])
            }
            recordingBefore = nil
        } else {
            recordingBefore = begin()
            recording = true
        }
    }

    /// One line of memory, labelled by where you are, for the by-hand steps (drawing on 5 pages, and so on).
    func markMemory() {
        let reading = LabMemory.read()
        let totals = overlays.inkTotals
        results.append(Result(title: "Memory mark — page \(currentPage + 1), \(settingsLine)", lines: [
            "Memory \(LabMemory.megabytes(reading.footprint)) · room left \(LabMemory.megabytes(reading.available)) · \(totals.pages) pages with ink, \(totals.points) points · \(overlays.onScreenCount) canvases on screen, \(overlays.keptCount) kept",
        ]))
    }

    /// Which view a touch in the middle of the PDF reaches, and how the canvases on show look to the touch system. For when a touch does not do what was expected.
    func whereTouchesGo() {
        guard let view = pdfView else { return }
        let centre = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        var chain: [String] = []
        var hit = view.hitTest(centre, with: nil)
        while let current = hit, chain.count < 12 {
            chain.append(String(describing: type(of: current)))
            hit = current === view ? nil : current.superview
        }
        var lines = ["A touch at the middle of the PDF reaches: " + PdfInkLabOverlays.chain(from: view.hitTest(centre, with: nil), stoppingAt: view)]
        if let scroll = Self.scrollView(in: view) {
            let pan = scroll.panGestureRecognizer
            lines.append("The PDF's scroll view (\(type(of: scroll))) pans with \(pan.minimumNumberOfTouches)–\(pan.maximumNumberOfTouches) touches, delays content touches \(scroll.delaysContentTouches ? "yes" : "no"), accepts touch types \(pan.allowedTouchTypes.map(\.intValue)) (0 finger, 1 indirect, 2 Pencil, 3 pointer)")
        }
        lines += overlays.canvasDescriptions(in: view)
        if overlays.onScreenCount == 0 { lines.append("No canvas is on screen.") }
        results.append(Result(title: "Where touches go — page \(currentPage + 1), \(settingsLine)", lines: lines))
    }

    func clearInk() {
        overlays.clearAllInk()
        status = "All ink cleared."
    }

    // MARK: Readout

    var currentPage: Int {
        guard let view = pdfView, let page = view.currentPage, let document else { return 0 }
        return document.index(for: page)
    }

    private func refreshReadout() {
        guard document != nil, let view = pdfView else {
            hud = busy ?? "Open a book from the Book menu."
            return
        }
        let reading = LabMemory.read()
        let fit = max(view.scaleFactorForSizeToFit, 0.01)
        let totals = overlays.inkTotals
        hud = "Page \(currentPage + 1) of \(pageCount) · zoom \(Int((view.scaleFactor / fit * 100).rounded()))% · "
            + (canvasesOn ? "canvases on screen \(overlays.onScreenCount), made \(overlays.stats.created), kept \(overlays.keptCount)" : "no canvases")
            + " · memory \(LabMemory.megabytes(reading.footprint)), room left \(LabMemory.megabytes(reading.available)) · ink on \(totals.pages) pages"
    }

    // MARK: Report

    static var deviceName: String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return "Simulator (\(simulated))" }
        var system = utsname()
        uname(&system)
        return withUnsafePointer(to: &system.machine) { $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) } }
    }

    func report() -> String {
        var out = ["PDF ink lab (spike B)", ""]
        let screen = pdfView?.window?.screen
        out.append("Device: \(Self.deviceName) · \(UIDevice.current.systemName) \(UIDevice.current.systemVersion) · \(_isDebugAssertConfiguration() ? "Debug" : "Release") build · up to \(screen?.maximumFramesPerSecond ?? 0) Hz · memory \(LabMemory.megabytes(Int(ProcessInfo.processInfo.physicalMemory)))")
        out.append("Book: \(bookName), \(pageCount) pages")
        out.append("Settings now: \(settingsLine); ink for runs: \(density.rawValue); scroll speed \(Int(speed)) pages a second")
        if !overlays.geometries.isEmpty {
            out.append("Canvas against its page (as each page first showed):")
            out += overlays.geometries.sorted { $0.key < $1.key }.map { "  " + $0.value }
        }
        out.append("")
        out.append("Cases tried by hand:")
        for item in LabCase.all { out.append("  [\((cases[item.id] ?? .untried).rawValue)] \(item.title)") }
        if !notes.isEmpty { out += ["", "Notes: \(notes)"] }
        for result in results {
            out += ["", result.title]
            out += result.lines.map { "  " + $0 }
        }
        return out.joined(separator: "\n")
    }

    // MARK: Launch arguments (developer shortcuts, like the editor lab's)

    /// `-openPdfInkLab 1` opens this screen at launch. `-pdfInkLabPages 30` picks the book (500 by default; `-pdfInkLabTurned 1` turns and crops its first nine pages). `-pdfInkLabRun scroll,draw5,draw50,draw200,where` runs those in order,
    /// `-pdfInkLabSpeed 30`, `-pdfInkLabCanvases 0`, `-pdfInkLabKeep 1`, `-pdfInkLabHold data`, `-pdfInkLabConvert 0` (do not build the stroke format), `-pdfInkLabEmpty 1` (empty a canvas as its page leaves), `-pdfInkLabFinger 0` (Pencil only), `-pdfInkLabTouches 0` and `-pdfInkLabDensity light` set what they use, and `-pdfInkLabReport <file>` writes the report there at the end.
    private func runLaunchArguments() async {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "pdfInkLabCanvases") != nil { canvasesOn = defaults.bool(forKey: "pdfInkLabCanvases") }
        if defaults.bool(forKey: "pdfInkLabKeep") { retention = .keep }
        if defaults.string(forKey: "pdfInkLabHold") == "data" { holding = .data }
        if defaults.bool(forKey: "pdfInkLabEmpty") { emptiesOnLeave = true }
        if defaults.object(forKey: "pdfInkLabConvert") != nil { buildsStrokeFormat = defaults.bool(forKey: "pdfInkLabConvert") }
        if defaults.string(forKey: "pdfInkLabDensity") == "light" { density = .light }
        if defaults.double(forKey: "pdfInkLabSpeed") > 0 { speed = defaults.double(forKey: "pdfInkLabSpeed") }
        if defaults.object(forKey: "pdfInkLabFinger") != nil { fingerDraws = defaults.bool(forKey: "pdfInkLabFinger") }
        if defaults.object(forKey: "pdfInkLabTouches") != nil { touchesThrough = defaults.bool(forKey: "pdfInkLabTouches") }
        settingsChanged()
        let pages = defaults.integer(forKey: "pdfInkLabPages")
        await openGenerated(pages: pages > 0 ? pages : 500, turned: defaults.bool(forKey: "pdfInkLabTurned"))
        guard let script = defaults.string(forKey: "pdfInkLabRun") else { return }
        try? await Task.sleep(for: .seconds(1))
        for step in script.split(separator: ",") {
            switch step {
            case "scroll": await scrollThroughEveryPage()
            case "draw5": await drawOnPages(5)
            case "draw50": await drawOnPages(50)
            case "draw200": await drawOnPages(200)
            case "where": whereTouchesGo()
            default: break
            }
        }
        if let file = defaults.string(forKey: "pdfInkLabReport") { try? report().write(toFile: file, atomically: true, encoding: .utf8) }
    }
}
