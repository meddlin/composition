import CompositionCore
import SwiftUI
import UIKit

/// Keeps the two halves of the Split tab at the same place in the note: scrolling the editor scrolls the Preview to the matching spot, and scrolling the
/// Preview scrolls the editor. Matched by where the two tops are in the note's text (`ScrollSync`, in CompositionCore), not by how far down each is
/// scrolled, since pictures, tables and components make the Preview's height very different from the editor's.
///
/// Which side leads: the one a finger (or the trackpad) is moving, and otherwise the editor, which also scrolls by itself as the caret moves and the text is
/// typed, so that the Preview stays with the caret. A scroll this makes is never taken for one to follow back (`applying`), and neither is a scroll of the
/// Preview that nobody made (its content drawn again, a jump from the outline).
@MainActor
@Observable
final class SplitScrollSync {
    /// On while the Split tab shows; turning it on puts the Preview where the editor is.
    var isOn = false {
        didSet {
            guard isOn, !oldValue else { return }
            DispatchQueue.main.async { [weak self] in self?.followEditor() }
        }
    }

    @ObservationIgnored private weak var editor: NoteTextView?
    @ObservationIgnored private weak var preview: UIScrollView?
    @ObservationIgnored private var observation: NSKeyValueObservation?
    /// Where each located block of the Preview is written (`NotePreview.located`), and the length of the text the Preview was made from.
    @ObservationIgnored private var located: [NSRange] = []
    @ObservationIgnored private var textLength = 0
    /// Where the Preview draws each located block, in its scroll content, by its index among them.
    @ObservationIgnored private var frames: [Int: CGRect] = [:]
    /// True while this moves a side, so that the scroll it causes is not followed back.
    @ObservationIgnored private var applying = false

    #if DEBUG || EDITOR_TEST_HOOKS
    /// `-splitSyncReport 1`: where each half's top is in the note's text, for the UI test (`split-sync`).
    @ObservationIgnored let reporting = UserDefaults.standard.bool(forKey: "splitSyncReport")
    private(set) var report = ""
    #endif

    // MARK: What the two halves tell it

    /// The editor scrolled: by a finger, or by itself to keep the caret in sight.
    func editorScrolled(_ view: NoteTextView) {
        editor = view
        guard isOn, !applying, !previewLeads else { return }
        followEditor()
    }

    /// The Preview's scroll view, found under its SwiftUI `ScrollView` (`ScrollViewProbe`).
    func attach(preview view: UIScrollView) {
        guard view !== preview else { return }
        preview = view
        observation = view.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.previewScrolled() }
        }
    }

    /// The Preview was made again from the text (typing, a quarter of a second after the last key).
    func previewChanged(located: [NSRange], textLength: Int) {
        self.located = located
        self.textLength = textLength
    }

    /// The Preview drew its blocks somewhere new (made again, a picture loaded, the window resized): the editor leads, unless a finger is on the Preview.
    func framesChanged(_ frames: [Int: CGRect]) {
        self.frames = frames
        guard isOn, !applying, !previewLeads else { return }
        followEditor()
    }

    private func previewScrolled() {
        // Only a scroll someone made: the Preview also moves when it is drawn again, and when the outline jumps to a heading.
        guard isOn, !applying, previewLeads else { return }
        followPreview()
    }

    // MARK: Following

    private func followEditor() {
        guard let editor, let preview, preview.window != nil, editor.window != nil else { return }
        let top = Self.top(of: editor)
        let marks = previewMarks(preview)
        let matched = ScrollSync.y(atOffset: editor.sourceOffset(atContentY: top), in: marks)
        set(preview, top: ScrollSync.follow(matched: matched, targetMax: Self.maxTop(of: preview), sourceTop: top, sourceMax: Self.maxTop(of: editor)))
        updateReport(marks)
    }

    private func followPreview() {
        guard let editor, let preview, preview.window != nil, editor.window != nil else { return }
        let top = Self.top(of: preview)
        let marks = previewMarks(preview)
        let offset = ScrollSync.offset(atY: top, in: marks)
        let place = { ScrollSync.follow(matched: editor.contentY(atSourceOffset: offset), targetMax: Self.maxTop(of: editor), sourceTop: top, sourceMax: Self.maxTop(of: preview)) }
        set(editor, top: place())
        // TextKit lays out only what is on screen, so a place far from where the editor was is first an estimate: once the editor has laid out where it
        // went, it is put right.
        let corrected = place()
        if abs(corrected - Self.top(of: editor)) > 2 { set(editor, top: corrected) }
        updateReport(marks)
    }

    private func previewMarks(_ preview: UIScrollView) -> [ScrollSync.Mark] {
        let blocks = frames.compactMap { index, frame in
            index < located.count ? ScrollSync.Block(range: located[index], top: frame.minY, bottom: frame.maxY) : nil
        }
        return ScrollSync.marks(blocks: blocks, textLength: textLength, height: preview.contentSize.height)
    }

    // MARK: Scroll views

    private func touched(_ view: UIScrollView?) -> Bool { view.map { $0.isTracking || $0.isDragging } ?? false }

    /// Whether the Preview leads: a finger is on it, or it is still gliding from one and no finger has since taken the editor. (Moving the editor to
    /// follow stops any glide of its own: `setContentOffset` without animation does.)
    private var previewLeads: Bool {
        guard let preview else { return false }
        return touched(preview) || (preview.isDecelerating && !touched(editor))
    }

    /// How far down the content the top of what shows is (below the bars, where the content starts under them).
    private static func top(of view: UIScrollView) -> CGFloat { view.contentOffset.y + view.adjustedContentInset.top }

    /// The furthest `top` can go: the end of the content at the bottom of what shows.
    private static func maxTop(of view: UIScrollView) -> CGFloat {
        view.contentSize.height + view.adjustedContentInset.top + view.adjustedContentInset.bottom - view.bounds.height
    }

    private func set(_ view: UIScrollView, top: CGFloat) {
        let y = top - view.adjustedContentInset.top
        guard abs(view.contentOffset.y - y) > 0.5 else { return }
        applying = true
        view.setContentOffset(CGPoint(x: view.contentOffset.x, y: y), animated: false)
        view.layoutIfNeeded()
        applying = false
    }

    private func updateReport(_ marks: [ScrollSync.Mark]) {
        #if DEBUG || EDITOR_TEST_HOOKS
        guard reporting, let editor, let preview else { return }
        let editorAt = editor.sourceOffset(atContentY: Self.top(of: editor))
        let previewAt = ScrollSync.offset(atY: Self.top(of: preview), in: marks)
        report = String(format: "editor=%.0f preview=%.0f length=%d", editorAt, previewAt, textLength)
        #endif
    }
}

extension NoteTextView {
    /// The place in the text drawn at `y` in the text view's content, in UTF-16 units: fractional inside a line, as far through it as `y` is down it, so that
    /// passing through one line of the editor (a picture's tag) passes evenly through all of what the Preview draws for it.
    func sourceOffset(atContentY y: CGFloat) -> Double {
        guard let layout = textLayoutManager, let content = layout.textContentManager else { return 0 }
        let start = content.documentRange.location
        let length = content.offset(from: start, to: content.documentRange.endLocation)
        let point = y - textContainerInset.top
        guard point > 0 else { return 0 }
        guard let fragment = layout.textLayoutFragment(for: CGPoint(x: 1, y: point)) else {
            // Between paragraphs, or past the end: the nearest place the text view can name.
            guard let position = closestPosition(to: CGPoint(x: 1, y: y)) else { return Double(length) }
            return Double(offset(from: beginningOfDocument, to: position))
        }
        let frame = fragment.layoutFragmentFrame
        let fragmentStart = content.offset(from: start, to: fragment.rangeInElement.location)
        let local = point - frame.minY
        let lines = fragment.textLineFragments
        for (index, line) in lines.enumerated() {
            let bounds = line.typographicBounds
            guard local < bounds.maxY || index == lines.count - 1 else { continue }
            let fraction = min(max((local - bounds.minY) / max(bounds.height, 1), 0), 1)
            let range = line.characterRange
            return min(Double(fragmentStart + range.location) + fraction * Double(range.length), Double(length))
        }
        return Double(fragmentStart)
    }

    /// How far down the text view's content the place `offset` in the text is drawn (the inverse of `sourceOffset(atContentY:)`).
    func contentY(atSourceOffset offset: Double) -> CGFloat {
        guard let layout = textLayoutManager, let content = layout.textContentManager else { return 0 }
        let start = content.documentRange.location
        let length = content.offset(from: start, to: content.documentRange.endLocation)
        let whole = min(max(Int(offset.rounded(.down)), 0), length)
        guard let location = content.location(start, offsetBy: whole) else { return contentSize.height }
        var found = layout.textLayoutFragment(for: location)
        if found == nil, let range = NSTextRange(location: location, end: nil) {
            layout.ensureLayout(for: range)
            found = layout.textLayoutFragment(for: location)
        }
        guard let fragment = found else { return contentSize.height }
        let frame = fragment.layoutFragmentFrame
        let local = offset - Double(content.offset(from: start, to: fragment.rangeInElement.location))
        let lines = fragment.textLineFragments
        for (index, line) in lines.enumerated() {
            let range = line.characterRange
            guard local < Double(NSMaxRange(range)) || index == lines.count - 1 else { continue }
            let fraction = min(max((local - Double(range.location)) / Double(max(range.length, 1)), 0), 1)
            let bounds = line.typographicBounds
            return textContainerInset.top + frame.minY + bounds.minY + fraction * bounds.height
        }
        return textContainerInset.top + frame.minY
    }
}

/// Finds the `UIScrollView` a SwiftUI `ScrollView` is drawn with, from inside its content (iOS 17 has no way to read or set a `ScrollView`'s offset as it
/// moves: `ScrollPosition` and `onScrollGeometryChange` are iOS 18).
struct ScrollViewProbe: UIViewRepresentable {
    let found: (UIScrollView) -> Void

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.found = found
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) { view.found = found }

    final class ProbeView: UIView {
        var found: ((UIScrollView) -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil else { return }
            var ancestor = superview
            while let view = ancestor {
                if let scroll = view as? UIScrollView {
                    found?(scroll)
                    return
                }
                ancestor = view.superview
            }
        }
    }
}

/// Where the Preview draws each block it can say is written somewhere (`NotePreview.locatedIndex`), in its scroll content: what the Split tab's halves
/// are kept together by.
enum PreviewAnchors {
    static let space = "preview-content"
}

struct PreviewAnchorsKey: PreferenceKey {
    static let defaultValue: [Int: CGRect] = [:]
    static func reduce(value: inout [Int: CGRect], nextValue: () -> [Int: CGRect]) { value.merge(nextValue()) { $1 } }
}

extension View {
    /// Says where this block of the Preview is drawn, when it is the located block `index`.
    @ViewBuilder
    func previewAnchor(_ index: Int?) -> some View {
        if let index {
            background(GeometryReader { Color.clear.preference(key: PreviewAnchorsKey.self, value: [index: $0.frame(in: .named(PreviewAnchors.space))]) })
        } else {
            self
        }
    }
}
