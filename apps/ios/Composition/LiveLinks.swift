import CompositionCore
import UIKit

// Links in the Live tab (Step 2 of docs/ipad-live-default-plan.md). `LiveOverlay` draws a link's words in the link colour, underlined, with `[` and
// `](url "title")` hidden away from the selection (what `LiveModel` says, checked against the desktop's `drawLink`). A `pdf:` link to a PDF not on this
// iPad is struck through and muted, and "(PDF not on this device)" is drawn after it by `LiveLinkFragment`, in room made by kerning the character after the
// link's words: the words are not in the note, so they cannot be text.
//
// Following (owner decisions I1 and I2): a plain tap edits, as in any text. While the selection is in a link a small ↗ sits just after it (`LiveFollowButton`,
// 44 points to hit), and a tap on it follows; with a hardware keyboard or a trackpad, ⌘-tap (and ⌘⇧-tap, there being no "beside" on the iPad) follows at once
// (`LiveLinkTap`). Both call the screen's `LinkFollower`, as the Preview does.

extension NSAttributedString.Key {
    /// On a link's drawn words: the address it follows (a `String`). Not `.link`, which would make the text view draw and follow it its own way.
    static let liveLink = NSAttributedString.Key("liveLink")
    /// On the character after a `pdf:` link whose PDF is not here: the words to draw in the room its kerning makes (a `LiveLinkSuffix`).
    static let liveLinkSuffix = NSAttributedString.Key("liveLinkSuffix")
}

/// What is drawn after a dead `pdf:` link, in the room the kerning of the character it is on makes.
final class LiveLinkSuffix: NSObject {
    let text: NSAttributedString

    init(text: NSAttributedString) {
        self.text = text
    }

    /// The Preview's words for it.
    static let words = " (PDF not on this device)"

    /// The suffix for a link whose words are in `font`, in the muted colour, italic (as the Preview draws it).
    static func make(font: UIFont, color: UIColor) -> LiveLinkSuffix {
        LiveLinkSuffix(text: NSAttributedString(string: words, attributes: [.font: LiveOverlay.italic(of: font).0, .foregroundColor: color]))
    }

    /// The room it needs.
    var width: CGFloat { ceil(text.size().width) }
}

extension LiveOverlay {
    /// What `applyLinks` puts on, for the styler to take off again before it draws a range anew.
    static let linkKeys: [NSAttributedString.Key] = [.underlineColor, .liveLink, .liveLinkSuffix, .kern]

    /// Draws the links in `range`: the link colour, underlined, and `.liveLink` for following; a `pdf:` link whose PDF is not here struck through and muted, with
    /// room made after it for the words that say so.
    static func applyLinks(_ decorations: LiveDecorations, to range: NSRange, in storage: NSTextStorage, look: Look, isHere: (String) -> Bool) {
        for link in decorations.links {
            let words = NSIntersectionRange(link.range, range)
            guard words.length > 0 else { continue }
            if isHere(link.href) {
                storage.addAttributes([
                    .foregroundColor: look.uiLink,
                    .underlineStyle: NSUnderlineStyle.single.rawValue,
                    .underlineColor: look.uiLink.withAlphaComponent(0.5),
                    .liveLink: link.href,
                ], range: words)
                continue
            }
            storage.addAttributes([.foregroundColor: look.uiMutedText, .strikethroughStyle: NSUnderlineStyle.single.rawValue], range: words)
            // The words go after what is drawn of the link: after its words while its marks are hidden (on the hidden `]` or `>`, which is not struck), after its
            // `)` or `>` while they show.
            let anchor = link.active ? NSMaxRange(link.node) - 1 : NSMaxRange(link.range)
            guard anchor >= range.location, anchor < NSMaxRange(range), anchor < storage.length else { continue }
            let font = (storage.attribute(.font, at: words.location, effectiveRange: nil) as? UIFont) ?? UIFont.systemFont(ofSize: 16)
            let suffix = LiveLinkSuffix.make(font: font, color: look.uiMutedText)
            storage.addAttributes([.liveLinkSuffix: suffix, .kern: suffix.width], range: NSRange(location: anchor, length: 1))
        }
    }
}

/// A paragraph's layout fragment that also draws the words after a dead `pdf:` link (`.liveLinkSuffix`), in the room the kerning left for them.
final class LiveLinkFragment: NSTextLayoutFragment {
    /// Whether `paragraph` has anything for this fragment to draw.
    static func wanted(for paragraph: NSAttributedString) -> Bool {
        var found = false
        paragraph.enumerateAttribute(.liveLinkSuffix, in: NSRange(location: 0, length: paragraph.length)) { value, _, stop in
            if value != nil { found = true; stop.pointee = true }
        }
        return found
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        super.draw(at: point, in: context)
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext() }
        for line in textLineFragments {
            let string = line.attributedString
            let range = line.characterRange
            string.enumerateAttribute(.liveLinkSuffix, in: range) { value, run, _ in
                guard let suffix = value as? LiveLinkSuffix else { return }
                let anchor = run.location
                // The kerning is the room after the anchor's own glyph: it ends where the next character starts.
                let next = min(anchor + 1, NSMaxRange(range))
                let end = line.locationForCharacter(at: next).x
                let start = end - suffix.width
                let font = suffix.text.attribute(.font, at: 0, effectiveRange: nil) as? UIFont ?? UIFont.systemFont(ofSize: 16)
                let baseline = line.typographicBounds.minY + line.glyphOrigin.y
                suffix.text.draw(at: CGPoint(x: point.x + line.typographicBounds.minX + start, y: point.y + baseline - font.ascender))
            }
        }
    }
}

// MARK: - Following

/// The ↗ beside the link the selection is in. A subview of the text view, so it scrolls with the text; placed just after the link's last rect, as the `<`
/// list is placed at the caret. It takes taps over 44 points; what is drawn is a 22-point badge in the link colour in the middle of them.
final class LiveFollowButton: UIControl {
    static let size: CGFloat = 44
    static let badge: CGFloat = 22
    /// The address it follows.
    private(set) var href = ""
    var onFollow: ((String) -> Void)?
    private let disc = UIView()
    private let arrow = UIImageView(image: UIImage(systemName: "arrow.up.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .bold)))

    override init(frame: CGRect) {
        super.init(frame: frame)
        disc.isUserInteractionEnabled = false
        disc.layer.cornerRadius = Self.badge / 2
        arrow.tintColor = .white
        arrow.contentMode = .center
        disc.addSubview(arrow)
        addSubview(disc)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityIdentifier = "live-follow-link"
        accessibilityLabel = "Follow link"
        addInteraction(UIPointerInteraction(delegate: nil))
        addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.onFollow?(self.href)
        }, for: .touchUpInside)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        disc.frame = CGRect(x: (bounds.width - Self.badge) / 2, y: (bounds.height - Self.badge) / 2, width: Self.badge, height: Self.badge)
        arrow.frame = disc.bounds
    }

    override var isHighlighted: Bool {
        didSet { disc.alpha = isHighlighted ? 0.6 : 1 }
    }

    func show(href: String, after rect: CGRect, in textView: UITextView, tint: UIColor) {
        self.href = href
        accessibilityValue = href
        disc.backgroundColor = tint
        let side = Self.size
        // Its badge just after the link's end, on its line; kept inside the text view's width.
        let x = min(rect.maxX + 2 - (side - Self.badge) / 2, textView.bounds.width - side)
        frame = CGRect(x: x, y: rect.midY - side / 2, width: side, height: side)
        if superview !== textView { textView.addSubview(self) }
        textView.bringSubviewToFront(self)
        isHidden = false
    }
}

/// Keeps the ↗ beside the link the selection is in, and follows a link on ⌘-tap.
@MainActor
final class LiveLinks: NSObject, UIGestureRecognizerDelegate {
    private weak var textView: UITextView?
    private let button = LiveFollowButton(frame: .zero)
    private let tap = UITapGestureRecognizer()
    /// The link the selection is in, from the styler's model; nil outside the Live tab.
    var activeLink: () -> LiveDecorations.Link? = { nil }
    var follow: (String) -> Bool = { _ in false }
    var tint: () -> UIColor = { .link }
    private var pending = false

    init(textView: UITextView) {
        self.textView = textView
        super.init()
        button.isHidden = true
        button.onFollow = { [weak self] href in _ = self?.follow(href) }
        tap.addTarget(self, action: #selector(tapped(_:)))
        tap.delegate = self
        textView.addGestureRecognizer(tap)
    }

    /// The selection moved, the text changed or was drawn again: the ↗ is put where the link now is, on the next turn of the run loop (once the text is laid out).
    func update() {
        guard !pending else { return }
        pending = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.pending = false
            self.place()
        }
    }

    private func place() {
        guard let textView, let link = activeLink(), let rect = lastRect(of: link.node, in: textView) else {
            button.isHidden = true
            return
        }
        button.show(href: link.href, after: rect, in: textView, tint: tint())
    }

    /// The last rect of `range` on the screen, in the text view's coordinates: where the link ends.
    private func lastRect(of range: NSRange, in textView: UITextView) -> CGRect? {
        guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
            let end = textView.position(from: start, offset: range.length), let textRange = textView.textRange(from: start, to: end)
        else { return nil }
        let rects = textView.selectionRects(for: textRange).map(\.rect).filter { !$0.isEmpty && $0.width > 0 && $0.minX.isFinite }
        // The rects come line by line; the last line's rightmost is where the link ends.
        guard let bottom = rects.map(\.midY).max() else { return nil }
        return rects.filter { abs($0.midY - bottom) < 1 }.max { $0.maxX < $1.maxX }
    }

    /// The address of the link drawn at `point`, if any.
    private func href(at point: CGPoint) -> String? {
        guard let textView, let position = textView.closestPosition(to: point) else { return nil }
        let offset = textView.offset(from: textView.beginningOfDocument, to: position)
        let storage = textView.textStorage
        for index in [offset, offset - 1] where index >= 0 && index < storage.length {
            if let href = storage.attribute(.liveLink, at: index, effectiveRange: nil) as? String { return href }
        }
        return nil
    }

    @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, let href = href(at: recognizer.location(in: textView)) else { return }
        _ = follow(href)
    }

    // MARK: ⌘-tap

    /// Only a tap with ⌘ held (⌘⇧ too) is this recognizer's: any other tap is the text view's, and edits.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive event: UIEvent) -> Bool {
        event.modifierFlags.contains(.command)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let textView else { return false }
        return href(at: touch.location(in: textView)) != nil
    }

    /// While it is deciding, the text view's own taps wait: a ⌘-tap on a link follows it and does not move the caret.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        other.view === textView
    }
}

extension Look {
    /// The link colour of this scheme, for the editor (the Preview's `link`).
    var uiLink: UIColor { theme.link.uiColor }
}
