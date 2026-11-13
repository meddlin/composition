import AppKit
import CompositionCore
@testable import CompositionInk
import PencilKit

// Reads the same drawings with Vision and with PencilKit's reader and writes a Markdown table (docs/architecture/ink.md, "Search"). A foreground app, because
// handwritingd refuses to read for xcodebuild's test host. Arguments: the folder to write `comparison.md` into, then any drawing PNGs to read too.

struct Case {
    var name: String
    var drawing: InkDocument
    var written: String
}

let synthetic: [Case] = {
    var out: [Case] = [
        Case(name: "hello world", drawing: InkHandwriting.write("hello world"), written: "hello world"),
        Case(name: "two lines", drawing: InkHandwriting.write("meeting notes\ncall sam"), written: "meeting notes / call sam"),
        Case(name: "shopping", drawing: InkHandwriting.write("buy milk and eggs"), written: "buy milk and eggs"),
        Case(name: "pangram", drawing: InkHandwriting.write("the quick brown fox\njumps over the lazy dog"), written: "the quick brown fox / jumps over the lazy dog"),
        Case(name: "a name", drawing: InkHandwriting.write("darrien rushing"), written: "darrien rushing"),
        Case(name: "a non-word", drawing: InkHandwriting.write("drien"), written: "drien"),
        Case(name: "nonsense", drawing: InkHandwriting.write("xqzt vbnk"), written: "xqzt vbnk"),
        Case(name: "item 263 words", drawing: InkHandwriting.write("drien fucking\ncall sam"), written: "drien fucking / call sam"),
        Case(name: "pencil ink", drawing: InkHandwriting.write("hello world", ink: .pencil), written: "hello world"),
        Case(name: "upright", drawing: InkHandwriting.write("hello world", slant: 0), written: "hello world"),
        Case(name: "signature", drawing: InkHandwriting.signature(), written: "(loops, no word)"),
        Case(name: "signature small", drawing: InkHandwriting.signature(loops: 6, xHeight: 12), written: "(loops, no word)"),
        Case(name: "scribbles", drawing: InkSamples.page(), written: "(a wave, a line, a dot)"),
        Case(name: "arcs", drawing: InkSamples.dense(strokes: 120, pointsEach: 24), written: "(120 arcs, no word)"),
    ]
    out.append(Case(name: "sketch and caption", drawing: beside(house(), below: InkHandwriting.write("my house")), written: "(a house) / my house"))
    out.append(Case(name: "words and a wave", drawing: beside(InkHandwriting.write("call sam"), right: InkSamples.page()), written: "call sam (a wave beside)"))
    for size in [6.0, 10, 32, 64] {
        out.append(Case(name: "hello world at \(Int(size)) pt", drawing: InkHandwriting.write("hello world", xHeight: size), written: "hello world"))
    }
    return out
}()

/// A house: a box, a roof and a door, as three pen strokes.
func house() -> InkDocument {
    func stroke(_ points: [(Double, Double)]) -> InkStroke {
        InkStroke(points: points.enumerated().map { InkPoint(x: $0.element.0, y: $0.element.1, t: Double($0.offset) * 120, width: 2.4, height: 2.4) })
    }
    return InkDocument(width: 180, height: 170, strokes: [
        stroke([(30, 70), (30, 150), (150, 150), (150, 70), (30, 70)]), stroke([(20, 75), (90, 20), (160, 75)]), stroke([(80, 150), (80, 110), (100, 110), (100, 150)]),
    ])
}

/// `top` with `other` drawn under it (`below`) or to its right (`right`), its strokes moved and its clock after `top`'s.
func beside(_ top: InkDocument, below: InkDocument? = nil, right: InkDocument? = nil) -> InkDocument {
    guard let other = below ?? right else { return top }
    let (dx, dy) = below != nil ? (0.0, top.height) : (top.width, 0.0)
    let start = (top.strokes.flatMap(\.points).map(\.t).max() ?? 0) + 200
    var out = top
    out.strokes += other.strokes.map { stroke in
        var moved = stroke
        moved.points = stroke.points.map { var p = $0; p.x += dx; p.y += dy; p.t += start; return p }
        return moved
    }
    out.width = max(top.width, other.width + dx)
    out.height = max(top.height, other.height + dy)
    return out
}

/// The drawings in the PNGs named on the command line (each carries its strokes), as cases.
func yours(_ paths: [String]) -> [Case] {
    paths.compactMap { path in
        let url = URL(fileURLWithPath: path)
        guard let data = try? Data(contentsOf: url), let drawing = try? InkPNG.contents(of: data).drawing() else {
            FileHandle.standardError.write(Data("no strokes in \(path)\n".utf8))
            return nil
        }
        return Case(name: url.deletingPathExtension().lastPathComponent, drawing: drawing, written: "(yours: \(drawing.transcript.map { "saved alt: " + $0 } ?? "no saved alt"))")
    }
}

func ms(_ duration: Duration) -> String {
    let (seconds, attoseconds) = duration.components
    return String(Int((Double(seconds) * 1000 + Double(attoseconds) / 1e15).rounded()))
}

func cell(_ text: String?) -> String { (text ?? "nil").replacingOccurrences(of: "\n", with: "⏎").replacingOccurrences(of: "|", with: "\\|") }

extension PKStrokeRecognizer {
    /// `SearchResult` is not Sendable, so it cannot leave the actor in Swift 6; it is summarised inside it.
    func searchSummary(_ query: String, fullWordsOnly: Bool = false) async -> String {
        let results = await search(query, fullWordsOnly: fullWordsOnly)
        return "\(results.count) result(s)" + results.map { " [\($0.strokes.count) strokes at \($0.bounds.integral)]" }.joined()
    }
}

@MainActor
func run(into folder: URL, cases: [Case]) async {
    var log = ["macOS \(ProcessInfo.processInfo.operatingSystemVersionString); recognitionVersion \(PKStrokeRecognizer.recognitionVersion); \(PKStrokeRecognizer.supportedLanguages.count) languages: \(PKStrokeRecognizer.supportedLanguages.map(\.minimalIdentifier).sorted().joined(separator: " "))"]
    let english = PencilKitTextRecognizer(preferredLanguages: [Locale.Language(identifier: "en")])
    let warm = InkTranscript.writing(of: InkHandwriting.write("warm"))
    let clock = ContinuousClock()
    let firstVision = await clock.measure { _ = try? await VisionTextRecognizer().lines(in: warm) }
    let firstPK = await clock.measure { _ = try? await english.lines(in: warm) }
    log.append("first call in this process (the model loads): Vision \(ms(firstVision)) ms, PencilKit \(ms(firstPK)) ms")
    log.append("the system languages PencilKit reads with no preference: \(await PencilKitTextRecognizer().recognizer(for: warm).languages.map(\.minimalIdentifier))")
    var table = [
        "| Case | Written | Vision: lines (confidence) | Vision: alt | ms | App active | PencilKit: whole drawing | PencilKit: by line | PencilKit: alt | ms | PencilKit: indexableContent |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for item in cases {
        let writing = InkTranscript.writing(of: item.drawing)
        var visionLines: [InkRecognizedLine] = []
        let visionTime = await clock.measure { visionLines = (try? await VisionTextRecognizer().lines(in: writing)) ?? [] }
        let visionAlt = await InkTranscript.text(of: item.drawing, using: VisionTextRecognizer())
        // handwritingd reads only for the app in front (see README): ask to be in front again, and say whether this app was as the row was read.
        NSApp.activate(ignoringOtherApps: true)
        for _ in 0..<20 where !NSApp.isActive { try? await Task.sleep(for: .milliseconds(25)) }
        let active = NSApp.isActive ? "yes" : "**no**"
        let whole = await english.recognizer(for: writing).recognizedText()
        var byLine: [InkRecognizedLine] = []
        let pkTime = await clock.measure { byLine = (try? await english.lines(in: writing)) ?? [] }
        let pkAlt = await InkTranscript.text(of: item.drawing, using: english)
        let indexable = await english.recognizer(for: writing).indexableContent
        let vision = visionLines.map { "\($0.text) (\(String(format: "%.2f", $0.confidence ?? -1)))" }.joined(separator: " / ")
        table.append("| \(item.name) | \(item.written) | \(cell(vision)) | \(cell(visionAlt)) | \(ms(visionTime)) | \(active) | \(cell(whole)) | \(cell(byLine.map(\.text).joined(separator: " / "))) | \(cell(pkAlt)) | \(ms(pkTime)) | \(cell(indexable)) |")
    }
    let hello = await english.recognizer(for: InkTranscript.writing(of: InkHandwriting.write("hello world")))
    log.append("search in \"hello world\": hello → \(await hello.searchSummary("hello")); hell, whole words only → \(await hello.searchSummary("hell", fullWordsOnly: true)); hell → \(await hello.searchSummary("hell")); zebra → \(await hello.searchSummary("zebra"))")
    let text = log.map { "- " + $0 }.joined(separator: "\n") + "\n\n" + table.joined(separator: "\n") + "\n"
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try? text.write(to: folder.appendingPathComponent("comparison.md"), atomically: true, encoding: .utf8)
}

@MainActor
final class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // handwritingd reads for an app "in an acceptable state": a regular app with a window, in front.
        let window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 380, height: 80), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Reading drawings with Vision and PencilKit…"
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate()
        let arguments = Array(CommandLine.arguments.dropFirst())
        let folder = URL(fileURLWithPath: arguments.first ?? NSTemporaryDirectory(), isDirectory: true)
        let cases = yours(Array(arguments.dropFirst())) + synthetic
        Task { @MainActor in
            await run(into: folder, cases: cases)
            NSApp.terminate(nil)
        }
    }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
