import CompositionCore
import CompositionInk
import UIKit

extension NSAttributedString.Key {
    /// On a paragraph the Live tab draws something on, in place of its text or beside it: a `LiveDrawing`.
    static let liveDraw = NSAttributedString.Key("liveDraw")
}

/// What the Live tab draws on a paragraph (step L4; the way was found in the Editor lab, step L1): a rule across the page, or a picture. The paragraph's text stays
/// in the note, hidden like the marks are (a tiny, clear font); the paragraph is made as tall as what is drawn (`minimumLineHeight`, or `paragraphSpacing` for a
/// picture drawn after its revealed text), and `LiveDrawingFragment` draws in that room. While the selection is on a rule its dashes show and nothing is drawn;
/// while it is on a picture's Markdown that shows, and the picture is drawn after it, as on the desktop.
final class LiveDrawing: NSObject {
    enum Kind: String { case rule, picture, pictureAfter }

    /// A picture: where its file is and how big it is (nil when there is no such file), the words to show in its place then, and how wide the tag asked for it to be.
    /// `kind` and `theme` are for drawings (docs/ipad-live-default-plan.md, Step 1): an `<Ink />` is drawn from its strokes in the theme's colours, `<Drawio />` at
    /// half its pixels; `natural` is the size either is drawn at when its tag gives no width (nil: the pixels, one to a point).
    struct Picture {
        var url: URL
        var label: String
        var pixels: CGSize?
        var width: ImageWidth?
        var kind: LivePictureKind = .image
        var theme: Theme?
        var natural: CGSize?
    }

    let kind: Kind
    let ruleColor: UIColor
    let noticeColor: UIColor
    let picture: Picture?

    init(kind: Kind, ruleColor: UIColor, noticeColor: UIColor, picture: Picture? = nil) {
        self.kind = kind
        self.ruleColor = ruleColor
        self.noticeColor = noticeColor
        self.picture = picture
    }

    /// The height a missing picture's notice takes.
    static let noticeHeight: CGFloat = 24
    /// Room above and below a picture.
    static let margin: CGFloat = 4

    /// How big the picture is drawn in a text `available` points wide: as the Preview draws it (one pixel to a point, never wider than the text, and as wide as its
    /// tag says: a share of the text, or points).
    static func size(of picture: Picture, available: CGFloat) -> CGSize {
        guard let pixels = picture.pixels else { return CGSize(width: available, height: noticeHeight) }
        let natural = picture.natural ?? pixels
        let target: CGFloat
        switch picture.width {
        case .some(let width) where width.unit == .percent: target = available * width.value / 100
        case .some(let width): target = min(width.value, available)
        case .none: target = min(natural.width, available)
        }
        let width = max(1, target)
        return CGSize(width: width, height: width * natural.height / max(natural.width, 1))
    }

    /// The height the paragraph is made, for a picture of `size`.
    static func reserved(for size: CGFloat) -> CGFloat { size + 2 * margin }
}

/// Gives the paragraphs marked `liveDraw` a layout fragment that also draws their rule or picture. Everything else gets the ordinary one.
final class LiveDrawingDelegate: NSObject, NSTextLayoutManagerDelegate {
    func textLayoutManager(_ textLayoutManager: NSTextLayoutManager, textLayoutFragmentFor location: any NSTextLocation, in textElement: NSTextElement) -> NSTextLayoutFragment {
        if let paragraph = textElement as? NSTextParagraph, paragraph.attributedString.length > 0 {
            let drawing = paragraph.attributedString.attribute(.liveDraw, at: 0, effectiveRange: nil) as? LiveDrawing
            let code = paragraph.attributedString.attribute(.liveCode, at: 0, effectiveRange: nil) as? LiveCodeLine
            if drawing != nil || code != nil {
                return LiveDrawingFragment(textElement: textElement, range: textElement.elementRange, drawing: drawing, code: code)
            }
        }
        // A dead `pdf:` link's "(PDF not on this device)" (LiveLinks.swift).
        if let paragraph = textElement as? NSTextParagraph, LiveLinkFragment.wanted(for: paragraph.attributedString) {
            return LiveLinkFragment(textElement: textElement, range: textElement.elementRange)
        }
        if let list = LiveListFragment.make(for: textElement) { return list }
        return NSTextLayoutFragment(textElement: textElement, range: textElement.elementRange)
    }
}

/// A paragraph's layout fragment that also draws a rule across the page or a picture, in the room the paragraph was made tall enough for, or, behind its text,
/// its part of a code block's fill (`LiveCode`).
final class LiveDrawingFragment: NSTextLayoutFragment {
    let drawing: LiveDrawing?
    let code: LiveCodeLine?

    init(textElement: NSTextElement, range: NSTextRange?, drawing: LiveDrawing?, code: LiveCodeLine? = nil) {
        self.drawing = drawing
        self.code = code
        super.init(textElement: textElement, range: range)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// The width of a line of the note's text: the container's, less its padding.
    private var lineWidth: CGFloat {
        let container = textLayoutManager?.textContainer
        return (container?.size.width ?? layoutFragmentFrame.width) - 2 * (container?.lineFragmentPadding ?? 0)
    }

    private var pictureSize: CGSize? { drawing?.picture.map { LiveDrawing.size(of: $0, available: lineWidth) } }

    /// What TextKit will let the fragment draw on. By default it is the box round the (here tiny, hidden) text, so a rule or a picture would be clipped to a sliver
    /// (found in the lab): it is widened to the lines of text and, for a picture drawn after the revealed text, lengthened to take the paragraph's spacing too.
    override var renderingSurfaceBounds: CGRect {
        let base = super.renderingSurfaceBounds
        let padding = textLayoutManager?.textContainer?.lineFragmentPadding ?? 0
        let width = max(lineWidth, base.width - 2 * padding)
        var height = max(base.height, layoutFragmentFrame.height)
        if drawing?.kind == .pictureAfter, let size = pictureSize { height += LiveDrawing.reserved(for: size.height) }
        // From the container's left edge (in the fragment's own coordinates, less its frame's origin), so that a code line's fill is not cut at its indent.
        return base.union(CGRect(x: min(base.minX, -layoutFragmentFrame.minX), y: base.minY, width: width + 2 * padding, height: height))
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        let frame = layoutFragmentFrame
        let padding = textLayoutManager?.textContainer?.lineFragmentPadding ?? 0
        // The start of a line of the note, whatever the paragraph's indent: the container's left edge (`point` is the frame's origin, which an indented
        // paragraph, such as a code line with its padding, moves right) and the padding inside it.
        let left = point.x - frame.minX + padding
        // A code line's fill goes under its text, over the whole paragraph (its padding above or below included).
        code?.drawFill(in: CGRect(x: left, y: point.y, width: lineWidth, height: frame.height), context: context)
        super.draw(at: point, in: context)  // the text itself (hidden, except while the selection is in it)
        guard let drawing else { return }
        switch drawing.kind {
        case .rule:
            context.setStrokeColor(drawing.ruleColor.cgColor)
            context.setLineWidth(1)
            context.move(to: CGPoint(x: left, y: point.y + frame.height / 2))
            context.addLine(to: CGPoint(x: left + lineWidth, y: point.y + frame.height / 2))
            context.strokePath()
        case .picture:
            guard let size = pictureSize else { return }
            drawPicture(in: CGRect(x: left, y: point.y + LiveDrawing.margin, width: size.width, height: size.height), context: context)
        case .pictureAfter:
            // After the text's own lines: the fragment's frame is taller than they are, because it includes the paragraph's spacing, which is where this goes.
            guard let size = pictureSize else { return }
            let textBottom = textLineFragments.map { $0.typographicBounds.maxY }.max() ?? frame.height
            drawPicture(in: CGRect(x: left, y: point.y + textBottom + LiveDrawing.margin, width: size.width, height: size.height), context: context)
        }
    }

    private func drawPicture(in rect: CGRect, context: CGContext) {
        guard let drawing, let picture = drawing.picture else { return }
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext() }
        guard picture.pixels != nil else {
            // No such file, as the desktop's Live tab says it (`Image not found: …`), muted and italic.
            let font = LiveOverlay.italic(of: UIFont.systemFont(ofSize: 15)).0
            NSAttributedString(string: "Image not found: \(picture.label)", attributes: [.font: font, .foregroundColor: drawing.noticeColor])
                .draw(in: CGRect(x: rect.minX, y: rect.minY + 2, width: rect.width, height: rect.height))
            return
        }
        let scale = textLayoutManager?.textContainer.map { _ in UIScreen.main.scale } ?? 2
        if picture.kind == .ink, let theme = picture.theme {
            // From its strokes, in the scheme's colours, as the Preview's `InkPictureView`; a PNG that carries none is drawn as its pixels, below.
            switch LiveImages.shared.strokes(at: picture.url) {
            case .some(let read) where read.document != nil:
                if let image = LiveImages.shared.drawingPicture(of: read.document!, at: picture.url, theme: theme, scale: scale) {
                    image.draw(in: rect)
                } else {
                    drawStandIn(rect)
                }
                return
            case .some: break
            case .none: return drawStandIn(rect)
            }
        }
        if let image = LiveImages.shared.thumbnail(at: picture.url, maxPixel: Int(max(rect.width, rect.height) * scale)) {
            image.draw(in: rect)
        } else {
            drawStandIn(rect)
        }
    }

    /// Not in yet: a faint stand-in of the right size, and the text is drawn again when it is.
    private func drawStandIn(_ rect: CGRect) {
        guard let drawing else { return }
        drawing.noticeColor.withAlphaComponent(0.12).setFill()
        UIBezierPath(roundedRect: rect, cornerRadius: 6).fill()
    }
}
