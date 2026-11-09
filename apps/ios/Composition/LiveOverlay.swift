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
///
/// Step L4 added the rest of the desktop's Live tab: the frontmatter set apart (smaller and muted), `<Mark>` tinted behind its words (its tags hidden like `**`
/// is), a rule drawn as a line and a picture drawn in place of the Markdown or `<Image />` that writes it (`LiveDrawing`).
enum LiveOverlay {
    /// What putting the look on needs to know besides the model's answer.
    struct Context {
        var look: Look
        /// Where the notes' pictures are kept, and how wide a line of the note's text is (a picture is as tall as that width makes it).
        var imageFolder: URL?
        var textWidth: CGFloat
    }

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

    /// Puts the Live look on `range` of `storage`. `decorations` are what the model says for a window that holds `range`, for the selection in force. `range`
    /// is whole paragraphs: what is drawn in place of a paragraph's text is set on the paragraph, and is made again as a whole.
    static func apply(_ decorations: LiveDecorations, to range: NSRange, in storage: NSTextStorage, context: Context) {
        let look = context.look
        func inside(_ other: NSRange) -> NSRange? {
            let common = NSIntersectionRange(other, range)
            return common.length > 0 ? common : nil
        }

        if let frontmatter = decorations.frontmatterRange, let part = inside(frontmatter) {
            // Set apart: smaller, and muted, and never hidden (the desktop's `.cm-live-frontmatter`).
            transformFonts(in: part, of: storage) { scaled($0, by: 0.85) }
            storage.addAttribute(.foregroundColor, value: look.uiMutedText, range: part)
        }
        for tint in decorations.tints {
            guard let part = inside(tint.range) else { continue }
            // Behind the words, but not over the faint fill of code, which has its own.
            var plain: [NSRange] = []
            storage.enumerateAttribute(.backgroundColor, in: part) { value, run, _ in if value == nil { plain.append(run) } }
            for run in plain { storage.addAttribute(.backgroundColor, value: look.uiMarkTint(tint.color), range: run) }
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
        drawRulesAndPictures(decorations, in: range, of: storage, context: context)
    }

    /// A rule is a line and a picture is a picture, in place of the text that writes it: the text is hidden, and its paragraph is made tall enough, and marked for
    /// `LiveDrawingFragment`. While the selection is on a picture's Markdown that stays, and the picture is drawn after it.
    private static func drawRulesAndPictures(_ decorations: LiveDecorations, in range: NSRange, of storage: NSTextStorage, context: Context) {
        let text = storage.mutableString
        let look = context.look
        func paragraph(of position: Int) -> NSRange? {
            guard position >= 0, position < text.length else { return nil }
            let found = text.paragraphRange(for: NSRange(location: position, length: 0))
            return NSIntersectionRange(found, range).length > 0 ? found : nil
        }

        for line in decorations.rules {
            guard let whole = paragraph(of: line) else { continue }
            let style = NSMutableParagraphStyle()
            style.minimumLineHeight = 28
            let drawing = LiveDrawing(kind: .rule, ruleColor: look.uiRule, noticeColor: look.uiMutedText)
            storage.addAttributes([.paragraphStyle: style, .liveDraw: drawing], range: whole)
        }

        for picture in decorations.pictures where picture.ownLine {
            guard let whole = paragraph(of: picture.range.location) else { continue }
            // A stored picture only: nothing is fetched from the network, as in the Preview, so another address stays its text.
            guard let name = NoteImage.name(fromRef: picture.src), let folder = context.imageFolder else { continue }
            let url = folder.appendingPathComponent(name)
            let drawn = LiveDrawing.Picture(url: url, label: picture.alt.isEmpty ? name : picture.alt, pixels: LiveImages.shared.pixelSize(of: url), width: NoteImage.parseWidth(picture.width))
            let size = LiveDrawing.size(of: drawn, available: context.textWidth)
            let style = NSMutableParagraphStyle()
            if picture.active {
                // The Markdown shows, and the picture is drawn after it.
                style.paragraphSpacing = LiveDrawing.reserved(for: size.height)
                storage.addAttributes([.paragraphStyle: style, .liveDraw: LiveDrawing(kind: .pictureAfter, ruleColor: look.uiRule, noticeColor: look.uiMutedText, picture: drawn)], range: whole)
            } else {
                style.minimumLineHeight = LiveDrawing.reserved(for: size.height)
                storage.addAttributes([.paragraphStyle: style, .liveDraw: LiveDrawing(kind: .picture, ruleColor: look.uiRule, noticeColor: look.uiMutedText, picture: drawn)], range: whole)
                if let words = inside(picture.range, of: range) { hide(words, in: storage) }
            }
        }
    }

    private static func inside(_ other: NSRange, of range: NSRange) -> NSRange? {
        let common = NSIntersectionRange(other, range)
        return common.length > 0 ? common : nil
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
