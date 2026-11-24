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

    private static func item(of fragment: LiveDrawingFragment, in textView: UITextView) -> Item? {
        guard let drawing = fragment.drawing, let room = fragment.drawnRoom, let picture = fragment.drawnRect else { return nil }
        let inset = textView.textContainerInset
        let roomInView = CGRect(x: 0, y: room.minY + inset.top, width: textView.bounds.width, height: room.height)
        return Item(drawing: drawing, room: roomInView, picture: picture.offsetBy(dx: inset.left, dy: inset.top))
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
@MainActor
final class LiveScribble: NSObject, UIScribbleInteractionDelegate {
    private weak var textView: NoteTextView?
    /// Whether a drawn task box's target holds the point (in the text view): `LiveTaskTap.box(at:)`.
    var isTaskBox: (CGPoint) -> Bool = { _ in false }

    init(textView: NoteTextView) {
        self.textView = textView
        super.init()
        textView.addInteraction(UIScribbleInteraction(delegate: self))
    }

    /// Whether Scribble may begin at `location` (in the text view's coordinates): not on a drawn item's room, nor on a drawn task box.
    func allows(at location: CGPoint) -> Bool {
        guard let textView else { return true }
        return LiveDrawn.item(at: location, in: textView) == nil && !isTaskBox(location)
    }

    /// Told when Scribble may be about to write, and when it has finished: the Live look is held in between (`MarkdownStyler.scribbleBegan`, Gate LD4, item 352).
    var began: () -> Void = {}
    var finished: () -> Void = {}
    /// Whether the look is held; and a check that lets it go when the Pencil came down but Scribble never wrote (a tap), or its end was never reported.
    private var holding = false
    private var check: Timer?

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
        let allowed = allows(at: location)
        // The look is held from the moment the Pencil comes down: Scribble focuses the text, putting the caret under the Pencil, before it says it is writing.
        if allowed { hold(interaction) }
        return allowed
    }

    func scribbleInteractionWillBeginWriting(_ interaction: UIScribbleInteraction) { hold(interaction) }

    func scribbleInteractionDidFinishWriting(_ interaction: UIScribbleInteraction) { release() }

    private func hold(_ interaction: UIScribbleInteraction) {
        if !holding {
            holding = true
            began()
        }
        check?.invalidate()
        let since = CACurrentMediaTime()
        check = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self, weak interaction] _ in
            MainActor.assumeIsolated {
                // Not writing a moment after the Pencil came down (it was a tap), or no longer writing: let the look go.
                guard let self, interaction?.isHandlingWriting != true, CACurrentMediaTime() - since > 1 else { return }
                self.release()
            }
        }
    }

    private func release() {
        check?.invalidate()
        check = nil
        guard holding else { return }
        holding = false
        finished()
    }

    #if DEBUG || EDITOR_TEST_HOOKS
    /// For the UI tests (`-liveCompose 1`, ⌃⌥S and ⌃⌥D), which cannot write with Scribble: what Scribble tells the delegate as it begins and ends.
    func simulateWriting(_ writing: Bool) {
        if writing {
            holding = true
            began()
        } else {
            release()
        }
    }
    #endif
}

/// A Pencil touch on an `<Ink />` drawing the Live tab draws opens the drawing's canvas, as a tap on it in the Preview does (the owner's choice, 2026-11-19, after item 344:
/// the Pencil draws in the canvas, never in the text). A finger still edits, as decision I6 has it: a tap puts the caret in the drawing's tag. The touch is taken as it
/// lands, so that a stroke begun on the drawing opens it rather than scrolling the note or selecting its text. A drawing whose PNG carries no strokes is a picture,
/// as in the Preview, and is left alone.
@MainActor
final class LivePencilOpen: NSObject, UIGestureRecognizerDelegate {
    private weak var textView: NoteTextView?
    /// Opens the canvas on the stored drawing of that name (the screen's, through `EditorHandle.editInk`).
    var open: (String) -> Void = { _ in }
    private(set) var recognizer: UILongPressGestureRecognizer!

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
    }

    /// The stored name of the drawing whose picture holds `point` (in the text view), when it is one the canvas can open.
    func drawing(at point: CGPoint) -> String? {
        guard let textView, let item = LiveDrawn.item(at: point, in: textView), item.picture.contains(point),
            let picture = item.drawing.picture, picture.kind == .ink, LiveImages.shared.strokes(at: picture.url)?.document != nil
        else { return nil }
        return picture.url.lastPathComponent
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let textView else { return false }
        return drawing(at: touch.location(in: textView)) != nil
    }

    @objc private func pressed(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began, let textView, let name = drawing(at: recognizer.location(in: textView)) else { return }
        open(name)
    }
}
