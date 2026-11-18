#if DEBUG || EDITOR_TEST_HOOKS
import UIKit

/// What the Live tab has made of the text, read back from the text storage: the runs that are hidden, italic, bold, struck, filled (a tint or the faint fill of
/// code), smaller than the text (`small`, the frontmatter), drawn at another size or in the grey text (`dim64`), and the paragraphs a rule or a picture is drawn on (`draw-rule`,
/// `draw-picture`, `draw-pictureAfter`, and for a block `draw-block`, `draw-blockAfter`, with `block-<kind>`, `block-revealed`, `block-pictured` and `block-stale` (drawn with its last good picture) over its source). The UI tests read it from an element of the editor (`live-report`, with `-liveReport 1`), so that they check what the
/// screen is drawing and not only what the model says. For example `hidden:0-2,11-13;italic:20-26;size32:0-9`.
enum LiveReport {
    /// A superscript digit as its plain one (`¹` is 1).
    private static func digit(_ scalar: Unicode.Scalar) -> Int {
        Array("⁰¹²³⁴⁵⁶⁷⁸⁹".unicodeScalars).firstIndex(of: scalar) ?? -1
    }

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
            // A block drawn as a picture (Step 5): `block-table` over all its source, `block-revealed` while its source shows, `block-pictured` once it has a picture.
            if let block = attributes[.liveBlock] as? LiveBlockMark {
                note("block-\(block.kind)", run)
                if block.revealed { note("block-revealed", run) }
                if block.pictured { note("block-pictured", run) }
                if block.stale { note("block-stale", run) }
            }
            // Step 7: a footnote citation drawn as its number (`footnote1` over its hidden source), and a line drawn with no height (a setext heading's underline).
            if let number = attributes[.liveFootnoteRef] as? LiveFootnoteNumber { note("footnote\(number.text.unicodeScalars.map { String(Self.digit($0)) }.joined())", run) }
            if let style = attributes[.paragraphStyle] as? NSParagraphStyle, style.maximumLineHeight > 0, style.maximumLineHeight < 1 { note("flat", run) }
            if LiveOverlay.isHidden(attributes) { return note("hidden", run) }
            let traits = font.fontDescriptor.symbolicTraits
            if traits.contains(.traitItalic) || ((attributes[.obliqueness] as? NSNumber)?.doubleValue ?? 0) > 0 { note("italic", run) }
            if traits.contains(.traitBold) { note("bold", run) }
            if font.pointSize < bodySize - 0.5 { note("small", run) } else if font.pointSize > bodySize + 0.5 { note("size\(Int(font.pointSize.rounded()))", run) }
            if attributes[.backgroundColor] != nil { note("fill", run) }
            // A translucent text colour is the grey text: `dim64` is the foreground at 64%, as the dimmed marks and the frontmatter are.
            if let color = attributes[.foregroundColor] as? UIColor {
                var alpha: CGFloat = 1
                color.getRed(nil, green: nil, blue: nil, alpha: &alpha)
                if alpha < 0.99 { note("dim\(Int((alpha * 100).rounded()))", run) }
            }
            if attributes[.strikethroughStyle] != nil { note("struck", run) }
        }
        // What the text view tells VoiceOver: the length of its value, and the runs of it marked "speak no punctuation" and as headings (candidate B), to be checked against `hidden`.
        if let value = LiveAccessibility.value(of: storage, mode: LiveAccessibility.mode) {
            note("ax-length", NSRange(location: value.length, length: 0))
            value.enumerateAttributes(in: NSRange(location: 0, length: value.length)) { attributes, run, _ in
                if attributes[.accessibilitySpeechPunctuation] as? Bool == false { note("ax-silent", run) }
                if let level = attributes[.accessibilityTextHeadingLevel] as? Int { note("ax-heading\(level)", run) }
            }
        }
        return classes.keys.sorted().map { name in name + ":" + classes[name]!.map { "\($0.location)-\(NSMaxRange($0))" }.joined(separator: ",") }.joined(separator: ";")
    }
}
#endif
