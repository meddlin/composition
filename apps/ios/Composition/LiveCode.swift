import CompositionCore
import UIKit

extension NSAttributedString.Key {
    /// On each line of a code block the Live tab draws on its fill: a `LiveCodeLine`.
    static let liveCode = NSAttributedString.Key("liveCode")
}

/// One line of a code block in the Live tab, as `LiveDrawingFragment` draws its share of the block's fill (docs/ipad-live-default-plan.md, Step 3).
final class LiveCodeLine: NSObject {
    /// The first and the last line of what is drawn: the fill's rounded top and bottom.
    let first: Bool
    let last: Bool
    let fill: UIColor
    /// Where the fill starts, from the line's left edge: the indent the paragraph had before the block's padding was added (a list's, from Step 4).
    let inset: CGFloat

    init(first: Bool, last: Bool, fill: UIColor, inset: CGFloat) {
        self.first = first
        self.last = last
        self.fill = fill
        self.inset = inset
    }

    /// The Preview's code block: a 12-point padding round the code (`MarkdownView`'s `.padding(12)`) and corners of 8.
    static let padding: CGFloat = 12
    static let cornerRadius: CGFloat = 8

    /// Draws this line's part of the fill, behind its text: `rect` is the line's whole paragraph, as wide as a line of the note.
    func drawFill(in rect: CGRect, context: CGContext) {
        var box = rect
        box.origin.x += inset
        box.size.width -= inset
        // A hair beyond the edges shared with the lines above and below, so that no seam shows between two lines of one fill.
        if !first { box.origin.y -= 0.5; box.size.height += 0.5 }
        if !last { box.size.height += 0.5 }
        var corners: UIRectCorner = []
        if first { corners.formUnion([.topLeft, .topRight]) }
        if last { corners.formUnion([.bottomLeft, .bottomRight]) }
        let path = UIBezierPath(roundedRect: box, byRoundingCorners: corners, cornerRadii: CGSize(width: Self.cornerRadius, height: Self.cornerRadius))
        context.saveGState()
        context.setFillColor(fill.cgColor)
        context.addPath(path.cgPath)
        context.fillPath()
        context.restoreGState()
    }
}

/// Code blocks in the Live tab, drawn as the iPad's Preview draws them (Step 3; owner decision I7: no colours by language, as the Preview has none): each
/// line in the code font at the Preview's size (`MarkdownStyler.Palette`), on one rounded fill in the scheme's `surface` colour, 12 points in from its edges.
/// While the selection is outside a fenced block its fence lines are collapsed (decision V2, as the desktop's `liveCode` does); a top-level indented block's
/// indent is hidden the same way. Only attributes change: the characters stay the source.
enum LiveCode {
    /// The height a collapsed fence line keeps: none to see, but a line the caret can still be put on (it then shows, with the rest of the block).
    static let collapsedHeight: CGFloat = 0.5

    static func apply(_ decorations: LiveDecorations, to range: NSRange, in storage: NSTextStorage, look: Look) {
        let text = storage.mutableString
        func paragraph(of position: Int) -> NSRange? {
            guard position >= 0, position < text.length else { return nil }
            let found = text.paragraphRange(for: NSRange(location: position, length: 0))
            return NSIntersectionRange(found, range).length > 0 ? found : nil
        }
        func style(at position: Int) -> NSMutableParagraphStyle {
            (storage.attribute(.paragraphStyle, at: position, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        }

        let fill = look.theme.surface.uiColor
        for block in decorations.codeBlocks {
            for (index, line) in block.lines.enumerated() {
                guard let whole = paragraph(of: line) else { continue }
                let paragraph = style(at: whole.location)
                let inset = paragraph.headIndent
                paragraph.firstLineHeadIndent += LiveCodeLine.padding
                paragraph.headIndent += LiveCodeLine.padding
                paragraph.tailIndent -= LiveCodeLine.padding  // from the trailing edge when 0 or less, from the leading one otherwise: narrower either way
                let first = index == 0, last = index == block.lines.count - 1
                if first { paragraph.paragraphSpacingBefore = LiveCodeLine.padding }
                if last { paragraph.paragraphSpacing = LiveCodeLine.padding }
                storage.addAttributes([.paragraphStyle: paragraph, .liveCode: LiveCodeLine(first: first, last: last, fill: fill, inset: inset)], range: whole)
            }
        }
        for fence in decorations.fencesHidden {
            guard let whole = paragraph(of: fence.location) else { continue }
            let paragraph = style(at: whole.location)
            paragraph.minimumLineHeight = collapsedHeight
            paragraph.maximumLineHeight = collapsedHeight
            paragraph.paragraphSpacing = 0
            paragraph.paragraphSpacingBefore = 0
            storage.addAttribute(.paragraphStyle, value: paragraph, range: whole)
        }
        for indent in decorations.codeIndentsHidden {
            let part = NSIntersectionRange(indent, range)
            guard part.length > 0 else { continue }
            storage.addAttributes([.font: LiveOverlay.hiddenFont, .foregroundColor: UIColor.clear], range: part)
        }
    }
}
