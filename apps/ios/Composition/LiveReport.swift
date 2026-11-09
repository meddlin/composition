#if DEBUG || EDITOR_TEST_HOOKS
import UIKit

/// What the Live tab has made of the text, read back from the text storage: the runs that are hidden, italic, bold, struck, filled (a tint or the faint fill of
/// code), smaller than the text (`small`, the frontmatter) or drawn at another size, and the paragraphs a rule or a picture is drawn on (`draw-rule`,
/// `draw-picture`, `draw-pictureAfter`). The UI tests read it from an element of the editor (`live-report`, with `-liveReport 1`), so that they check what the
/// screen is drawing and not only what the model says. For example `hidden:0-2,11-13;italic:20-26;size32:0-9`.
enum LiveReport {
    static func make(from storage: NSTextStorage, bodySize: CGFloat) -> String {
        var classes: [String: [NSRange]] = [:]
        func note(_ name: String, _ range: NSRange) {
            if let last = classes[name]?.last, NSMaxRange(last) == range.location {
                classes[name]![classes[name]!.count - 1] = NSUnionRange(last, range)
            } else {
                classes[name, default: []].append(range)
            }
        }
        storage.enumerateAttributes(in: NSRange(location: 0, length: storage.length)) { attributes, run, _ in
            guard let font = attributes[.font] as? UIFont else { return }
            if let drawing = attributes[.liveDraw] as? LiveDrawing { note("draw-\(drawing.kind.rawValue)", run) }
            if font.pointSize < 1 { return note("hidden", run) }
            let traits = font.fontDescriptor.symbolicTraits
            if traits.contains(.traitItalic) || ((attributes[.obliqueness] as? NSNumber)?.doubleValue ?? 0) > 0 { note("italic", run) }
            if traits.contains(.traitBold) { note("bold", run) }
            if font.pointSize < bodySize - 0.5 { note("small", run) } else if font.pointSize > bodySize + 0.5 { note("size\(Int(font.pointSize.rounded()))", run) }
            if attributes[.backgroundColor] != nil { note("fill", run) }
            if attributes[.strikethroughStyle] != nil { note("struck", run) }
        }
        return classes.keys.sorted().map { name in name + ":" + classes[name]!.map { "\($0.location)-\(NSMaxRange($0))" }.joined(separator: ",") }.joined(separator: ";")
    }
}
#endif
