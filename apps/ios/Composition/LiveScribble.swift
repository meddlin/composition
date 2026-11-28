import UIKit

/// What the Live tab draws in place of text, found by where it is on the screen: a picture (an image, an `<Ink />` drawing, a `<Drawio />` diagram) or a block drawn as a
/// picture (a table, a component, the frontmatter's header), from the fragments `LiveDrawingDelegate` makes. Rules are left out: a rule is a line of text's height.
@MainActor
enum LiveDrawn {
    /// A drawn item, in the text view's coordinates: `room` is the band across the view that it takes (`LiveDrawingFragment.drawnRoom`), `picture` the picture itself.
    struct Item {
        let drawing: LiveDrawing
        let room: CGRect
        let picture: CGRect
    }

    /// The drawn item whose room holds `point` (in the text view's coordinates), or nil, also when the Live tab is not the one showing. Only how far down the point is
    /// counts: writing in the margin beside a picture would land in its hidden source as surely as writing on it.
    static func item(at point: CGPoint, in textView: NoteTextView) -> Item? {
        guard textView.isLive, let layout = textView.textLayoutManager else { return nil }
        let inset = textView.textContainerInset
        let inContainer = CGPoint(x: max(0, point.x - inset.left), y: point.y - inset.top)
        guard let fragment = layout.textLayoutFragment(for: inContainer) as? LiveDrawingFragment, let found = item(of: fragment, in: textView),
            found.room.minY <= point.y, point.y < found.room.maxY
        else { return nil }
        return found
    }

    /// The picture of the block whose source is `source`, where it is laid out now: after its last line while it shows its source, in its first paragraph while it does
    /// not. What the ↗s of a `<Toc />`'s entries and a footnote list's ↩s are placed by (Gate LD7).
    static func item(ofBlock source: NSRange, in textView: NoteTextView) -> Item? {
        guard textView.isLive, source.length > 0, let layout = textView.textLayoutManager, let content = layout.textContentManager else { return nil }
        for offset in [NSMaxRange(source) - 1, source.location] {
            guard let location = content.location(content.documentRange.location, offsetBy: offset) else { continue }
            layout.ensureLayout(for: NSTextRange(location: location))
            if let fragment = layout.textLayoutFragment(for: location) as? LiveDrawingFragment, let block = fragment.drawing?.block,
                NSIntersectionRange(block.source, source).length > 0, let found = item(of: fragment, in: textView)
            {
                return found
            }
        }
        return nil
    }

    private static func item(of fragment: LiveDrawingFragment, in textView: UITextView) -> Item? {
        guard let drawing = fragment.drawing, let room = fragment.drawnRoom, let picture = fragment.drawnRect else { return nil }
        let inset = textView.textContainerInset
        let roomInView = CGRect(x: 0, y: room.minY + inset.top, width: textView.bounds.width, height: room.height)
        return Item(drawing: drawing, room: roomInView, picture: picture.offsetBy(dx: inset.left, dy: inset.top))
    }

    /// Whether a Pencil touch on this picture opens a canvas (`LivePencilOpen`), and so whether it has the border that says so: an `<Ink />` whose PNG carries its
    /// strokes. A picture, a diagram, or a drawing with no strokes in it (drawn as its pixels, as in the Preview) has no canvas.
    static func opensCanvas(_ picture: LiveDrawing.Picture) -> Bool {
        picture.kind == .ink && LiveImages.shared.strokes(at: picture.url)?.document != nil
    }

    #if DEBUG || EDITOR_TEST_HOOKS
    /// Every drawn item laid out now, in the order of the text (for `live-drawn`, with `-liveReport 1`).
    static func all(in textView: NoteTextView) -> [Item] {
        guard textView.isLive, let layout = textView.textLayoutManager else { return [] }
        var out: [Item] = []
        layout.enumerateTextLayoutFragments(from: layout.documentRange.location, options: []) { fragment in
            if let fragment = fragment as? LiveDrawingFragment, let found = item(of: fragment, in: textView) { out.append(found) }
            return true
        }
        return out
    }
    #endif
}

/// Scribble may not begin over anything the Live tab draws in place of its source (Gate LD1, item 344 of docs/manual-tests/ipad.md). Scribble writes into the text
/// under the Pencil, and under a drawing that is its hidden tag: an "x" drawn over an `<Ink />` became " X" after the tag, which made the drawing a picture inside a line
/// of text, which Live leaves as its tag (item 122), so the drawing was gone. The text view installs Scribble itself; a `UIScribbleInteraction` of our own added to it is
/// how a text view says where Scribble may not begin (WWDC20, "Meet Scribble for iPad"). Everywhere else, the lines just above and below a picture included, it writes
/// as always. The Markdown tab shows every tag as text, so there it is never stopped.
///
/// Nor may it begin on a task box the Live tab draws (Gate LD4, items 351 and 371): there Scribble took a Pencil tap meant for the box as writing (a dot, which became
/// a period in the item) or as a tap of its own (the caret in the item), and the box ticked only when the tap reached `LiveTaskTap` first. Refused there, the Pencil's
/// touch is an ordinary touch, which `LiveTaskTap` takes. The box's target ends where the item's words begin, so Scribble writes on the words as always.
///
/// While Scribble writes, the Live look is held as it was drawn (Gate LD4, item 352). Scribble's "may I begin here?" is not only asked when the Pencil comes down:
/// PencilKit asks it all the while the Pencil hovers over the text (`PKTextInputHoverController hoverController:didUpdate:` →
/// `PKTextInputSingleElementFinder findSingleElementAtPosition:…` → `PKTextInputElement shouldBeginAtLocation:` → our delegate; read in the iOS 26.4 runtime's
/// PencilKit). Held on those questions, the look stood still for as long as the Pencil hovered and a second after: a finger's tap on a drawing put the caret in its
/// tag, but the tag never showed (item 372, steps 4 and 5, on an iPad with Pencil hover). The look is now held on that question only while the Pencil is not
/// hovering (`pencilHovers`, from a hover recogniser), which is when it has come down; and a hold that such a question began, with nothing written, ends as the
/// Pencil hovers again.
@MainActor
final class LiveScribble: NSObject, UIScribbleInteractionDelegate, UIGestureRecognizerDelegate {
    private weak var textView: NoteTextView?
    /// Whether a drawn task box's target holds the point (in the text view): `LiveTaskTap.box(at:)`.
    var isTaskBox: (CGPoint) -> Bool = { _ in false }
    private var interaction: UIScribbleInteraction!
    /// Hears the Pencil hover over the text (and a pointer's: then the look is held from when Scribble writes, a moment later than from when the Pencil lands).
    private(set) var hover: UIHoverGestureRecognizer!

    init(textView: NoteTextView) {
        self.textView = textView
        super.init()
        interaction = UIScribbleInteraction(delegate: self)
        textView.addInteraction(interaction)
        hover = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
        hover.delegate = self
        textView.addGestureRecognizer(hover)
    }

    /// Whether Scribble may begin at `location` (in the text view's coordinates): not on a drawn item's room, nor on a drawn task box.
    func allows(at location: CGPoint) -> Bool {
        guard let textView else { return true }
        return LiveDrawn.item(at: location, in: textView) == nil && !isTaskBox(location)
    }

    /// Told when Scribble may be about to write, and when it has finished: the Live look is held in between (`MarkdownStyler.scribbleBegan`, Gate LD4, item 352).
    var began: () -> Void = {}
    var finished: () -> Void = {}
    /// What the look is held for: the Pencil came down where Scribble may begin (`landed`), or Scribble is writing (`writing`); nil when it is not held. And a check
    /// that lets it go when the Pencil came down but Scribble never wrote (a tap), or its end was never reported.
    private enum Hold { case landed, writing }
    private var holding: Hold?
    private var check: Timer?
    /// Whether the Pencil hovers over the text now, so that Scribble's questions are PencilKit's hover, not the Pencil coming down.
    private(set) var pencilHovers = false

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
        let allowed = allows(at: location)
        // The look is held from the moment the Pencil comes down: Scribble focuses the text, putting the caret under the Pencil, before it says it is writing. Not
        // while the Pencil only hovers: PencilKit asks this then too, over and over.
        if allowed && !pencilHovers { hold(.landed) }
        return allowed
    }

    func scribbleInteractionWillBeginWriting(_ interaction: UIScribbleInteraction) { hold(.writing) }

    func scribbleInteractionDidFinishWriting(_ interaction: UIScribbleInteraction) { release() }

    @objc private func hovered(_ recognizer: UIHoverGestureRecognizer) {
        pencilHovered(recognizer.state == .began || recognizer.state == .changed)
    }

    /// The Pencil hovers (or no longer does). A hold that a question began, with nothing being written, is let go: the question was the hover's (the first hover
    /// event can reach PencilKit before this recogniser), or the Pencil came down and lifted again without writing.
    func pencilHovered(_ hovering: Bool) {
        pencilHovers = hovering
        if hovering, holding == .landed, !interaction.isHandlingWriting { release() }
    }

    /// The hover recogniser hears the hover alongside the text view's own (its pointer effects among them).
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    private func hold(_ reason: Hold) {
        if holding == nil { began() }
        if holding != .writing { holding = reason }
        check?.invalidate()
        let since = CACurrentMediaTime()
        check = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                // Not writing a moment after the Pencil came down (it was a tap), or no longer writing: let the look go.
                guard let self, !self.interaction.isHandlingWriting, CACurrentMediaTime() - since > 1 else { return }
                self.release()
            }
        }
    }

    private func release() {
        check?.invalidate()
        check = nil
        guard holding != nil else { return }
        holding = nil
        finished()
    }

    #if DEBUG || EDITOR_TEST_HOOKS
    /// For the UI tests (`-liveCompose 1`, ⌃⌥S and ⌃⌥D), which cannot write with Scribble: what Scribble tells the delegate as it begins and ends.
    func simulateWriting(_ writing: Bool) {
        if writing {
            if holding == nil { began() }
            holding = .writing
        } else {
            release()
        }
    }

    /// ⌃⌥H, with `-liveCompose 1`: from then on the Pencil hovers over the text, as PencilKit and UIKit tell this of it, ten times a second: Scribble's question at a
    /// place of the text where it may begin (the first one before the hover is heard, as on the iPad), then the hover. The UI tests have no Pencil to hover.
    private var hovering: Timer?
    func simulateHovering() {
        guard hovering == nil else { return }
        hovering = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let textView = self.textView, textView.isLive else { return }
                let top = textView.contentOffset.y + textView.textContainerInset.top
                let place = stride(from: top + 10, to: top + textView.bounds.height - 20, by: 20).map { CGPoint(x: textView.bounds.width - 40, y: $0) }
                    .first { self.allows(at: $0) }
                if let place { _ = self.scribbleInteraction(self.interaction, shouldBeginAt: place) }
                self.pencilHovered(true)
            }
        }
    }
    #endif
}

/// A Pencil touch on an `<Ink />` drawing the Live tab draws opens the drawing's canvas, as a tap on it in the Preview does (the owner's choice, 2026-11-19, after item 344:
/// the Pencil draws in the canvas, never in the text). A finger still edits, as decision I6 has it: a tap puts the caret in the drawing's tag. The touch is taken as it
/// lands, so that a stroke begun on the drawing opens it rather than scrolling the note or selecting its text. A drawing whose PNG carries no strokes is a picture,
/// as in the Preview, and is left alone.
///
/// What says so (the owner's ask after item 372): such a drawing has a thin border round it (`LiveDrawingFragment.drawCanvasBorder`), and the moment the Pencil lands
/// on it, it looks pressed, as a button does (`press`), a beat before the canvas opens.
@MainActor
final class LivePencilOpen: NSObject, UIGestureRecognizerDelegate {
    private weak var textView: NoteTextView?
    /// Opens the canvas on the stored drawing of that name (the screen's, through `EditorHandle.editInk`).
    var open: (String) -> Void = { _ in }
    private(set) var recognizer: UILongPressGestureRecognizer!
    /// The pressed look, over the drawing the Pencil landed on, until the canvas has opened.
    private let press = UIView()
    /// How long the pressed look shows before the canvas opens: long enough to be seen, short enough that the canvas still answers the Pencil at once.
    static let pressBeat: TimeInterval = {
        #if DEBUG || EDITOR_TEST_HOOKS
        // `-livePressBeat <seconds>`: the UI tests hold the pressed look long enough to see and photograph it.
        let asked = UserDefaults.standard.double(forKey: "livePressBeat")
        if asked > 0 { return asked }
        #endif
        return 0.12
    }()

    init(textView: NoteTextView) {
        self.textView = textView
        super.init()
        recognizer = UILongPressGestureRecognizer(target: self, action: #selector(pressed(_:)))
        recognizer.minimumPressDuration = 0
        recognizer.allowableMovement = .greatestFiniteMagnitude
        var types = [UITouch.TouchType.pencil]
        #if DEBUG || EDITOR_TEST_HOOKS
        // `-fingerIsPencil 1`: a finger counts as the Pencil here, for the UI tests, which have no Pencil.
        if UserDefaults.standard.bool(forKey: "fingerIsPencil") { types.append(.direct) }
        #endif
        recognizer.allowedTouchTypes = types.map { NSNumber(value: $0.rawValue) }
        recognizer.delegate = self
        textView.addGestureRecognizer(recognizer)
        press.isUserInteractionEnabled = false
        press.isAccessibilityElement = false
        press.layer.cornerRadius = LiveDrawingFragment.borderRadius
        press.layer.cornerCurve = .continuous
        #if DEBUG || EDITOR_TEST_HOOKS
        // `-liveReport 1`: the pressed look is an element the UI tests can find (`live-drawing-pressed`); VoiceOver never meets it in the app itself.
        if UserDefaults.standard.bool(forKey: "liveReport") {
            press.isAccessibilityElement = true
            press.accessibilityIdentifier = "live-drawing-pressed"
            press.accessibilityLabel = "pressed"
        }
        #endif
    }

    /// The stored name of the drawing whose picture holds `point` (in the text view), when it is one the canvas can open, and where its picture is.
    func drawing(at point: CGPoint) -> (name: String, picture: CGRect)? {
        guard let textView, let item = LiveDrawn.item(at: point, in: textView), item.picture.contains(point),
            let picture = item.drawing.picture, LiveDrawn.opensCanvas(picture)
        else { return nil }
        return (picture.url.lastPathComponent, item.picture)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let textView else { return false }
        return drawing(at: touch.location(in: textView)) != nil
    }

    @objc private func pressed(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began, let textView, let found = drawing(at: recognizer.location(in: textView)) else { return }
        showPress(over: found.picture, in: textView)
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.pressBeat) { [weak self] in
            guard let self else { return }
            self.open(found.name)
            self.hidePress()
        }
    }

    /// The pressed look: the drawing dimmed a little under the scheme's link colour, with its border drawn firmer in that colour, as a button looks while held.
    private func showPress(over picture: CGRect, in textView: NoteTextView) {
        let tint = textView.look.uiLink
        let outset = LiveDrawingFragment.borderOutset + LiveDrawingFragment.borderWidth / 2
        press.layer.removeAllAnimations()
        press.frame = picture.insetBy(dx: -outset, dy: -outset)
        press.backgroundColor = tint.withAlphaComponent(0.14)
        press.layer.borderColor = tint.cgColor
        press.layer.borderWidth = 2
        press.alpha = 1
        press.transform = .identity
        if press.superview !== textView { textView.addSubview(press) }
        textView.bringSubviewToFront(press)
    }

    private func hidePress() {
        UIView.animate(withDuration: 0.2, delay: 0.15, options: [.beginFromCurrentState]) {
            self.press.alpha = 0
        } completion: { [weak self] finished in
            if finished { self?.press.removeFromSuperview() }
        }
    }
}
