import CompositionCore
import UIKit

/// What the Live tab does to the text on top of the Markdown colours (docs/ipad-live-view-plan.md, step L3): headings drawn large and bold, bold and
/// italic as such, code smaller on its faint fill, strikethrough, and the marks (`#`, `**`, `~~`, backticks, a code block's fences) hidden, except where the
/// selection is, where they show, dimmed. Only attributes change, never the characters, so the selection, undo and saving are untouched. A hidden mark
/// is the lab's "tiny and clear" (a half-point font in no colour), which the iPad showed to work: the caret, the arrow keys, Scribble and VoiceOver
/// all keep working on it.
///
/// What is drawn comes from `LiveModel` (checked against the desktop's own `liveDecorations`); this puts it on a range of the text storage, after the
/// Markdown colours are on it, building each font from the one the text already has, so that bold in italic in a heading is all three.
enum LiveOverlay {
    /// The font of a hidden mark: too small to see or to take room, and the characters stay in the text.
    static let hiddenFont = UIFont.systemFont(ofSize: 0.5)

    /// How many times the size of the text a heading is drawn (`.cm-live-h1` and the others of the desktop's Live tab).
    static func headingScale(_ level: Int) -> CGFloat {
        switch level {
        case 1: 2
        case 2: 1.5
        case 3: 1.25
        default: 1
        }
    }

    /// Puts the Live look on `range` of `storage`. `decorations` are what the model says for a window that holds `range`, for the selection in force.
    static func apply(_ decorations: LiveDecorations, to range: NSRange, in storage: NSTextStorage, look: Look) {
        func inside(_ other: NSRange) -> NSRange? {
            let common = NSIntersectionRange(other, range)
            return common.length > 0 ? common : nil
        }

        for heading in decorations.headings {
            guard let part = inside(heading.range) else { continue }
            transformFonts(in: part, of: storage) { scaled(bold($0), by: headingScale(heading.level)) }
        }
        for style in decorations.styles {
            guard let part = inside(style.range) else { continue }
            switch style.style {
            case .strong: transformFonts(in: part, of: storage) { bold($0) }
            case .emphasis: italicize(part, of: storage)
            case .strike: storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: part)
            case .code: transformFonts(in: part, of: storage) { scaled($0, by: 0.9) }
            }
        }
        for mark in decorations.shown {
            guard let part = inside(mark) else { continue }
            storage.addAttribute(.foregroundColor, value: look.uiMutedText, range: part)
            storage.removeAttribute(.obliqueness, range: part)
            transformFonts(in: part, of: storage) { regular($0) }
        }
        for mark in decorations.hidden + decorations.fencesHidden {
            guard let part = inside(mark) else { continue }
            hide(part, in: storage)
        }
    }

    private static func hide(_ range: NSRange, in storage: NSTextStorage) {
        storage.addAttributes([.font: hiddenFont, .foregroundColor: UIColor.clear], range: range)
        storage.removeAttribute(.obliqueness, range: range)
    }

    // MARK: Fonts

    /// Replaces the font of each run of `range` with what `transform` makes of it (a run is where the font is one).
    private static func transformFonts(in range: NSRange, of storage: NSTextStorage, _ transform: (UIFont) -> UIFont) {
        var runs: [(NSRange, UIFont)] = []
        storage.enumerateAttribute(.font, in: range) { value, run, _ in
            if let font = value as? UIFont, font.pointSize > 1 { runs.append((run, font)) }  // a hidden mark keeps its tiny font
        }
        for (run, font) in runs { storage.addAttribute(.font, value: transform(font), range: run) }
    }

    static func scaled(_ font: UIFont, by factor: CGFloat) -> UIFont { factor == 1 ? font : font.withSize(font.pointSize * factor) }

    /// The bold of `font`, at its size and in its family. The system gives bold by symbolic trait; where it does not (the monospaced face), by weight.
    static func bold(_ font: UIFont) -> UIFont {
        if font.fontDescriptor.symbolicTraits.contains(.traitBold) { return font }
        if let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitBold)) {
            let made = UIFont(descriptor: descriptor, size: font.pointSize)
            if made.fontDescriptor.symbolicTraits.contains(.traitBold) { return made }
        }
        let weighted = font.fontDescriptor.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.bold]])
        return UIFont(descriptor: weighted, size: font.pointSize)
    }

    /// `font` as it is for text with no emphasis: neither bold nor italic.
    static func regular(_ font: UIFont) -> UIFont {
        let traits = font.fontDescriptor.symbolicTraits.subtracting([.traitBold, .traitItalic])
        guard let descriptor = font.fontDescriptor.withSymbolicTraits(traits) else { return font }
        return UIFont(descriptor: descriptor, size: font.pointSize)
    }

    /// Italic over `range`: the font's own italic, and for a face that has none (the system's monospaced one) the same font slanted.
    private static func italicize(_ range: NSRange, of storage: NSTextStorage) {
        var runs: [(NSRange, UIFont)] = []
        storage.enumerateAttribute(.font, in: range) { value, run, _ in
            if let font = value as? UIFont, font.pointSize > 1 { runs.append((run, font)) }
        }
        for (run, font) in runs {
            let (italic, slanted) = italic(of: font)
            storage.addAttribute(.font, value: italic, range: run)
            if slanted { storage.addAttribute(.obliqueness, value: 0.2, range: run) }
        }
    }

    /// The italic of `font`, at its size and weight; `slanted` is true when the face has none and the same font is returned, to be slanted with `.obliqueness`.
    static func italic(of font: UIFont) -> (UIFont, slanted: Bool) {
        if let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic)) {
            let made = UIFont(descriptor: descriptor, size: font.pointSize)
            let name = made.fontName.lowercased()
            if name.contains("italic") || name.contains("oblique") { return (made, false) }
        }
        return (font, true)
    }
}
