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
@MainActor
final class LiveScribble: NSObject, UIScribbleInteractionDelegate {
    private weak var textView: NoteTextView?

    init(textView: NoteTextView) {
        self.textView = textView
        super.init()
        textView.addInteraction(UIScribbleInteraction(delegate: self))
    }

    /// Whether Scribble may begin at `location` (in the text view's coordinates): not on a drawn item's room.
    func allows(at location: CGPoint) -> Bool {
        guard let textView else { return true }
        return LiveDrawn.item(at: location, in: textView) == nil
    }

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool { allows(at: location) }
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
