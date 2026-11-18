#if DEBUG || EDITOR_TEST_HOOKS
import CompositionCore
import UIKit

/// Step 5's spike (docs/ipad-live-default-plan.md): every top-level block of the open note rendered as the Live tab renders a block's picture (`LiveBlockRenderer`, the
/// Preview's own views through `ImageRenderer`), whether the Live tab draws that kind yet or not, written to a folder as PNGs with a `spike.json` of their sizes and how long
/// each took. `-liveBlockSpike <folder>`.
@MainActor
enum LiveBlockSpike {
    static func run(in view: UITextView, look: Look, imageFolder: URL?, to folder: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let container = view.textContainer
        let width = max(200, container.size.width - 2 * container.lineFragmentPadding)
        let preview = NotePreview.make(content: view.textStorage.string)
        var rows: [[String: Any]] = []
        for (index, located) in preview.located.enumerated() {
            let name = describe(located.block)
            let started = ContinuousClock.now
            let image = LiveBlockRenderer.render(located.block, width: width, look: look, traits: view.traitCollection, imageFolder: imageFolder)
            let spent = ContinuousClock.now - started
            let milliseconds = Double(spent.components.seconds) * 1000 + Double(spent.components.attoseconds) / 1e15
            let file = String(format: "%02d-%@.png", index, name)
            if let data = image?.pngData() { try? data.write(to: folder.appendingPathComponent(file)) }
            rows.append(["index": index, "kind": name, "range": NSStringFromRange(located.range), "width": image?.size.width ?? 0, "height": image?.size.height ?? 0,
                         "milliseconds": milliseconds, "file": file, "drawnInLive": LiveBlockKinds.kind(of: located.block) != nil])
        }
        let data = (try? JSONSerialization.data(withJSONObject: ["textWidth": width, "blocks": rows], options: [.prettyPrinted, .sortedKeys])) ?? Data()
        try? data.write(to: folder.appendingPathComponent("spike.json"))
    }

    private static func describe(_ block: PreviewBlock) -> String {
        switch block {
        case .markdown(let blocks):
            guard let first = blocks.first else { return "markdown" }
            switch first {
            case .heading: return "heading"
            case .paragraph: return "paragraph"
            case .code: return "code"
            case .quote: return "quote"
            case .list: return "list"
            case .rule: return "rule"
            case .table: return "table"
            case .html: return "html"
            }
        case .panel(let tone, _): return tone == .info ? "info" : "warning"
        case .toc: return "toc"
        case .footnotes: return "footnotes"
        case .image: return "image"
        case .chart: return "chart"
        case .repo: return "repo"
        case .youtube: return "youtube"
        case .highlight: return "highlight"
        case .notice: return "notice"
        }
    }
}
#endif
