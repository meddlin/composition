import CoreGraphics
import Darwin
import Foundation
import os
import PDFKit
import PencilKit
import UIKit

// Spike B's lab, the parts that need no view (pdf-markup-plan.md, "Spike B status"): a test book that is written on the device, ink to put on its pages,
// the meters (memory, frames, touches) and the list of cases to try by hand. `PdfInkLab` runs them; `PdfInkLabView` shows them.

// MARK: A test book

/// A book written on the device with CoreGraphics, so that it needs no bundled file and its text can be selected (the glyphs are real text, as in a textbook).
enum LabBook {
    static let pageSize = CGSize(width: 612, height: 792)

    private static let words = (
        "the of and to in is that for it as with was on be by at this are from or an which have had not but what all were when we there can your their said each she do how if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part over new sound take only little work know place year live me back give most very after thing our just name good sentence man think say great where help through much before line right too mean old any same tell boy follow came want show also around form three small set put end does another well large must big even such because turn here why ask went men read need land different home us move try kind hand picture again change off play spell air away animal house point page letter mother answer found study still learn should world"
    ).split(separator: " ").map(String.init)

    private struct Random {
        var state: UInt64
        mutating func next(_ bound: Int) -> Int {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((state >> 33) % UInt64(bound))
        }
    }

    /// Where a book of this many pages is kept (made again if the file is gone; the caches folder is the system's to clear).
    static func cachedURL(pages: Int) -> URL {
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("PdfInkLab", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("lab-book-\(pages)-v1.pdf")
    }

    /// The book of `pages` pages: a running head, about 45 lines of text, a chapter title every tenth page and a drawn figure every seventh. Written to a partial name
    /// and renamed, so that a half-made file is never opened. `progress` gets the number of pages written so far.
    static func make(pages: Int, progress: @Sendable (Int) -> Void) throws -> URL {
        let url = cachedURL(pages: pages)
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let partial = url.appendingPathExtension("partial")
        try? FileManager.default.removeItem(at: partial)
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [kCGPDFContextTitle as String: "Spike B test book (\(pages) pages)", kCGPDFContextCreator as String: "Composition PDF ink lab"]
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize), format: format)
        try renderer.writePDF(to: partial) { context in
            for number in 1...pages {
                context.beginPage()
                draw(page: number, of: pages, context: context)
                if number % 10 == 0 || number == pages { progress(number) }
            }
        }
        try FileManager.default.moveItem(at: partial, to: url)
        return url
    }

    /// The first nine pages turned and cropped in every way spike C's fixture does (quarter turns, a crop box inside the media box and away from its corner), for the canvases
    /// on them to be measured. Done on the document in memory; the file is not changed.
    static func turnAndCrop(_ document: PDFDocument) {
        let turns = [0, 90, 180, 270, 0, 90, 180, 270, 0]
        for (index, turn) in turns.enumerated() {
            guard let page = document.page(at: index) else { break }
            if index >= 4 { page.setBounds(index == 8 ? CGRect(x: 0, y: 0, width: 300, height: 400) : CGRect(x: 50, y: 40, width: 500, height: 700), for: .cropBox) }
            page.rotation = turn
        }
    }

    private static func draw(page number: Int, of total: Int, context: UIGraphicsPDFRendererContext) {
        let cg = context.cgContext
        let body = UIFont(name: "TimesNewRomanPSMT", size: 11) ?? .systemFont(ofSize: 11)
        let small = UIFont.systemFont(ofSize: 8)
        let grey = UIColor(white: 0.35, alpha: 1)

        // Running head and foot, in the margins where a book has them.
        ("Spike B test book" as NSString).draw(at: CGPoint(x: 54, y: 30), withAttributes: [.font: small, .foregroundColor: grey])
        let foot = "Page \(number) of \(total)" as NSString
        foot.draw(at: CGPoint(x: pageSize.width - 54 - foot.size(withAttributes: [.font: small]).width, y: pageSize.height - 40), withAttributes: [.font: small, .foregroundColor: grey])

        var top: CGFloat = 54
        if number % 10 == 1 {
            ("Chapter \(number / 10 + 1)" as NSString).draw(at: CGPoint(x: 54, y: top), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 26)])
            top += 48
        }
        // A figure now and then, so that a page is not only text: a frame, a curve and a gradient.
        if number % 7 == 0 {
            let frame = CGRect(x: 54, y: top, width: pageSize.width - 108, height: 150)
            cg.saveGState()
            cg.addRect(frame)
            cg.clip()
            let colors = [UIColor(red: 0.8, green: 0.9, blue: 1, alpha: 1).cgColor, UIColor(red: 1, green: 0.9, blue: 0.7, alpha: 1).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: frame.origin, end: CGPoint(x: frame.maxX, y: frame.maxY), options: [])
            }
            cg.setStrokeColor(UIColor.darkGray.cgColor)
            cg.setLineWidth(1.5)
            cg.move(to: CGPoint(x: frame.minX, y: frame.midY))
            for step in 0...60 {
                let x = frame.minX + frame.width * CGFloat(step) / 60
                cg.addLine(to: CGPoint(x: x, y: frame.midY + 50 * sin(CGFloat(step) / 6 + CGFloat(number))))
            }
            cg.strokePath()
            cg.restoreGState()
            cg.setStrokeColor(UIColor.black.cgColor)
            cg.setLineWidth(0.5)
            cg.stroke(frame)
            top += 166
        }

        // The text: sentences of eight to sixteen words, drawn as one justified block.
        var random = Random(state: UInt64(number) &* 2_654_435_761 &+ 7)
        var text = ""
        while text.count < 4_400 {
            let sentence = (0..<(8 + random.next(9))).map { _ in words[random.next(words.count)] }.joined(separator: " ")
            text += sentence.prefix(1).uppercased() + sentence.dropFirst() + ". "
            if random.next(6) == 0 { text += "\n" }
        }
        let style = NSMutableParagraphStyle()
        style.alignment = .justified
        style.lineSpacing = 1.6
        style.paragraphSpacing = 4
        let area = CGRect(x: 54, y: top, width: pageSize.width - 108, height: pageSize.height - top - 60)
        (text as NSString).draw(with: area, options: [.usesLineFragmentOrigin], attributes: [.font: body, .paragraphStyle: style], context: nil)
    }
}

// MARK: Ink to put on a page

/// Handwriting-like strokes made by a formula, to fill pages without a hand: lines of small waves, as a page of notes looks to a stroke counter. Real handwriting is
/// denser in time and in force; the points and strokes are what PencilKit and the stroke format pay for, and those can be counted here.
enum LabInk {
    enum Density: String, CaseIterable, Identifiable {
        case light = "Light (2,500 points a page)"
        case dense = "Dense (19,000 points a page)"
        var id: String { rawValue }
        var lines: Int { self == .light ? 10 : 26 }
        var strokesPerLine: Int { self == .light ? 5 : 8 }
        var pointsPerStroke: Int { self == .light ? 50 : 90 }
    }

    /// A page of `size` (the canvas's, in page points) covered in strokes, the same for the same page number.
    static func drawing(page: Int, size: CGSize, density: Density) -> PKDrawing {
        var state = UInt64(page + 1) &* 0x9E37_79B9_7F4A_7C15
        func unit() -> CGFloat {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return CGFloat((state >> 40) & 0xFFFF) / 65_535
        }
        let margin: CGFloat = 54
        let gap = (size.height - 2 * margin) / CGFloat(density.lines)
        let run = (size.width - 2 * margin) / CGFloat(density.strokesPerLine)
        var strokes: [PKStroke] = []
        for line in 0..<density.lines {
            for index in 0..<density.strokesPerLine {
                let left = margin + CGFloat(index) * run
                let baseline = margin + CGFloat(line) * gap + gap / 2
                let phase = unit() * 6.28, amplitude = 2 + unit() * 5
                var points: [PKStrokePoint] = []
                for step in 0..<density.pointsPerStroke {
                    let along = CGFloat(step) / CGFloat(density.pointsPerStroke - 1)
                    let x = left + along * run * 0.9
                    let y = baseline + sin(along * 14 + phase) * amplitude + (unit() - 0.5) * 0.6
                    points.append(PKStrokePoint(location: CGPoint(x: x, y: y), timeOffset: Double(step) * 0.008, size: CGSize(width: 3, height: 3), opacity: 1, force: 0.4 + unit() * 0.4, azimuth: 0, altitude: .pi / 2))
                }
                let ink = PKInk(.pen, color: index % 4 == 3 ? .systemBlue : .black)
                strokes.append(PKStroke(ink: ink, path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSinceReferenceDate: 0))))
            }
        }
        return PKDrawing(strokes: strokes)
    }
}

// MARK: Meters

enum LabMemory {
    /// This process's own task port (the C global is shared mutable state to Swift 6, but it never changes).
    private nonisolated(unsafe) static let taskPort: mach_port_t = mach_task_self_

    struct Reading: Sendable {
        /// What the system counts against the app (`phys_footprint`, the number Xcode's memory gauge shows), in bytes.
        let footprint: Int
        /// What the app may still use before the system ends it (`os_proc_available_memory`), in bytes; 0 where the system does not say (the Simulator).
        let available: Int
    }

    static func read() -> Reading {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let status = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(taskPort, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return Reading(footprint: status == KERN_SUCCESS ? Int(info.phys_footprint) : 0, available: os_proc_available_memory())
    }

    static func megabytes(_ bytes: Int) -> String { bytes == 0 ? "n/a" : String(format: "%.0f MB", Double(bytes) / 1_048_576) }
    static func size(_ bytes: Int) -> String { bytes >= 1_048_576 ? String(format: "%.1f MB", Double(bytes) / 1_048_576) : String(format: "%.0f KB", Double(bytes) / 1024) }
}

/// Memory sampled four times a second over a stretch of work.
@MainActor
final class LabTrace {
    struct Sample { let at: CFTimeInterval; let reading: LabMemory.Reading }
    private(set) var samples: [Sample] = []
    private var task: Task<Void, Never>?

    func start() {
        task?.cancel()
        samples = []
        mark()
        task = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                self?.mark()
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        mark()
    }

    func mark() { samples.append(Sample(at: CACurrentMediaTime(), reading: LabMemory.read())) }

    var line: String {
        guard let first = samples.first, let last = samples.last else { return "no memory samples" }
        let peak = samples.map(\.reading.footprint).max() ?? 0
        let lowest = samples.map(\.reading.available).filter { $0 > 0 }.min()
        return "memory \(LabMemory.megabytes(first.reading.footprint)) at the start, \(LabMemory.megabytes(peak)) at the peak, \(LabMemory.megabytes(last.reading.footprint)) at the end"
            + (lowest.map { " · room left at its lowest \(LabMemory.megabytes($0))" } ?? " · room left not reported here")
            + " (\(samples.count) samples)"
    }
}

/// Every frame the screen makes, from a display link: how long each took, which were late, and when each was due (for the touch timings).
@MainActor
final class LabFrames: NSObject {
    struct Summary {
        var seconds = 0.0, frames = 0, late = 0, dropped = 0
        var worstMilliseconds = 0.0
        var hertz = 0
    }

    /// Called every frame with the seconds since the last one.
    var onTick: (@MainActor (CFTimeInterval) -> Void)?
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var began: CFTimeInterval = 0
    private(set) var summary = Summary()
    /// When each frame was due, ascending.
    private(set) var targets: [CFTimeInterval] = []

    var isRunning: Bool { link != nil }

    func start() {
        stop()
        summary = Summary()
        targets = []
        last = 0
        began = CACurrentMediaTime()
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    @discardableResult
    func stop() -> Summary {
        link?.invalidate()
        link = nil
        if began > 0 { summary.seconds = CACurrentMediaTime() - began }
        began = 0
        return summary
    }

    @objc private func tick(_ link: CADisplayLink) {
        let expected = max(link.targetTimestamp - link.timestamp, 0.001)
        summary.hertz = Int((1 / expected).rounded())
        targets.append(link.targetTimestamp)
        if targets.count > 60_000 { targets.removeFirst(10_000) }
        if last > 0 {
            let interval = link.timestamp - last
            summary.frames += 1
            if interval > expected * 1.5 {
                summary.late += 1
                summary.dropped += max(0, Int((interval / expected).rounded()) - 1)
            }
            summary.worstMilliseconds = max(summary.worstMilliseconds, interval * 1000)
            onTick?(interval)
        }
        last = link.timestamp
    }

    var line: String {
        let s = summary
        return String(format: "%.1f s · %d frames at about %d Hz · %d late (more than half a frame over), %d dropped, worst frame %.0f ms", s.seconds, s.frames, s.hertz, s.late, s.dropped, s.worstMilliseconds)
    }
}

/// One touch the lab saw: when the hardware made it and when the app was given it, in `CACurrentMediaTime`'s clock.
struct LabTouchSample: Sendable {
    let isPencil: Bool
    let made: CFTimeInterval
    let received: CFTimeInterval
}

/// Watches every touch on the PDF without taking part: it never recognises anything, so it cannot stop the scroll, the selection or the Pencil.
final class LabTouchProbe: UIGestureRecognizer, UIGestureRecognizerDelegate {
    var record: (@MainActor (LabTouchSample) -> Void)?

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    private func note(_ touches: Set<UITouch>, _ event: UIEvent) {
        let now = CACurrentMediaTime()
        for touch in touches {
            // The coalesced touches are the samples between two deliveries: the hardware reads faster than the screen draws.
            for sample in event.coalescedTouches(for: touch) ?? [touch] {
                record?(LabTouchSample(isPencil: sample.type == .pencil, made: sample.timestamp, received: now))
            }
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { note(touches, event) }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { note(touches, event) }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}

enum LabStats {
    /// "median 1.2 · p95 3.4 · max 9.0 ms (n = 120)".
    static func line(_ values: [Double], unit: String = "ms", digits: Int = 1) -> String {
        guard !values.isEmpty else { return "none" }
        let sorted = values.sorted()
        func format(_ v: Double) -> String { String(format: "%.\(digits)f", v) }
        return "median \(format(sorted[sorted.count / 2])) · p95 \(format(sorted[min(sorted.count - 1, sorted.count * 95 / 100)])) · max \(format(sorted[sorted.count - 1])) \(unit) (n = \(sorted.count))"
    }

    /// The touch timings: how long the app took to be given each sample, and how soon after it was given one a frame was due.
    static func touchLines(_ samples: [LabTouchSample], frameTargets: [CFTimeInterval]) -> [String] {
        var lines: [String] = []
        for (name, group) in [("Pencil", samples.filter(\.isPencil)), ("Finger", samples.filter { !$0.isPencil })] where !group.isEmpty {
            let delivery = group.map { ($0.received - $0.made) * 1000 }
            // The first frame due after the app had the sample is the soonest one that could show it.
            let soonest: [Double] = group.compactMap { sample in
                var low = 0, high = frameTargets.count
                while low < high {
                    let middle = (low + high) / 2
                    if frameTargets[middle] >= sample.received { high = middle } else { low = middle + 1 }
                }
                return low < frameTargets.count ? (frameTargets[low] - sample.made) * 1000 : nil
            }
            lines.append("\(name) samples: \(group.count). Hardware to the app: \(line(delivery)). Hardware to the soonest frame that could show it: \(line(soonest))")
        }
        return lines.isEmpty ? ["No touches were seen in this window."] : lines
    }
}

// MARK: The cases to try by hand

struct LabCase: Identifiable {
    let id: String
    let title: String
    let lookFor: String

    static let all: [LabCase] = [
        LabCase(id: "scroll-margin", title: "A finger scrolls from a blank margin", lookFor: "The pages move and nothing is drawn."),
        LabCase(id: "scroll-ink", title: "A finger scrolls from on top of a drawn stroke", lookFor: "The pages move; the stroke is neither smudged nor moved."),
        LabCase(id: "scroll-text", title: "A finger scrolls from on top of the text", lookFor: "The pages move; no word is selected by the drag."),
        LabCase(id: "pencil-text", title: "The Pencil draws across the text", lookFor: "A stroke appears; the page does not scroll and no word is selected."),
        LabCase(id: "pencil-edge", title: "The Pencil draws across the edge between two pages", lookFor: "What happens to the part of the stroke past the page's edge: cut, or carried to the other page? (Either is workable; say which.)"),
        LabCase(id: "select-press", title: "A long press on a word with a finger selects it", lookFor: "The word is selected, with handles and the copy menu, while canvases are on the pages."),
        LabCase(id: "select-drag", title: "Drag the selection handles over several lines and onto the next page", lookFor: "The selection follows; the canvases do not catch the drag."),
        LabCase(id: "select-pencil", title: "With a selection showing, draw with the Pencil", lookFor: "The stroke is drawn; whether the selection stays or clears (say which)."),
        LabCase(id: "palm", title: "Rest the side of your hand on the glass while drawing", lookFor: "No marks from the palm; no scrolling or zooming from it."),
        LabCase(id: "pinch", title: "Pinch to zoom to about 300%, then draw", lookFor: "The strokes stay sharp (not blurred) and under the Pencil tip at that zoom; the line is as thick on the page as at 100%."),
        LabCase(id: "zoom-pan", title: "Zoomed in, pan with a finger and draw again", lookFor: "Strokes drawn before stay on the same words."),
        LabCase(id: "restore", title: "Draw on page 3, scroll to page 60 and back", lookFor: "The stroke is back, in the same place, and nothing flashes or pops in late."),
        LabCase(id: "jump", title: "Use Go to page 400 and draw there at once", lookFor: "A canvas is ready when the page shows; the first stroke is not lost."),
        LabCase(id: "rotate", title: "Draw, then turn the iPad to the other orientation", lookFor: "The strokes stay on the same words; nothing is cut off or doubled."),
        LabCase(id: "turned", title: "Draw on the turned and cropped pages (Book menu, the book with turned and cropped pages)", lookFor: "On each of the first nine pages the stroke appears under the Pencil tip and stays on the same words after you scroll away and back."),
        LabCase(id: "erase", title: "Pixel eraser, stroke eraser and lasso", lookFor: "Each works on the page you are on."),
        LabCase(id: "picker", title: "Turn on System tool picker (Canvases menu) and use it", lookFor: "The picker shows and its tool applies to the page in view; moving to another page keeps it."),
        LabCase(id: "latency", title: "Latency next to Notes", lookFor: "Write the same word here and in Notes: does the line follow the tip as closely? (No number: say better, same, or worse, and by how much you can tell.)"),
    ]
}

enum LabCaseState: String, CaseIterable, Identifiable {
    case untried = "Not tried", fine = "Fine", problem = "Problem"
    var id: String { rawValue }
}
