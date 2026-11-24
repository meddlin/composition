import CompositionCore
import UIKit

extension NSAttributedString.Key {
    /// On a line of a list or a quote in the Live tab: a `LiveListLine`, what its layout fragment draws beside the text.
    static let liveList = NSAttributedString.Key("liveList")
}

/// Lists, task lists and quotes in the Live tab (docs/ipad-live-default-plan.md, Step 4), drawn as the Preview draws them (`MarkdownView`): a muted `•` or the
/// item's number in place of its mark, the Preview's `square` / `checkmark.square.fill` in place of a task's `[ ]` / `[x]`, and a 3-point bar down a quote's
/// left side with the quote's text muted. What is drawn and hidden comes from `LiveModel` (`LiveDecorations.lists`, checked against the desktop's
/// `listDecorations`); only attributes change: the marks are hidden with the half-point clear font, each line is indented by its paragraph style (a line
/// that wraps hangs under the item's text), and `LiveListFragment` draws the rest. On the line the selection is on, the marks show as they are written.
enum LiveLists {
    /// How far each list level is indented, in the body font's size: the desktop's `2em`.
    static func listIndent(_ body: UIFont) -> CGFloat { (body.pointSize * 2).rounded() }
    /// The Preview's quote: a 3-point bar, and 10 points between it and the text.
    static let barWidth: CGFloat = 3
    static let quoteIndent: CGFloat = 13
    /// Between a marker and the item's text: the Preview's `HStack` spacing.
    static let markerGap: CGFloat = 8

    /// Puts the look of the list and quote lines on `range` of `storage` (whole paragraphs, as `LiveOverlay.apply` is given).
    static func apply(_ lines: [LiveDecorations.ListLine], to range: NSRange, in storage: NSTextStorage, look: Look) {
        let text = storage.mutableString
        let body = look.textFont(live: true).uiFont(size: 16)
        let level = listIndent(body)
        for line in lines {
            let paragraph = text.paragraphRange(for: NSRange(location: line.range.location, length: 0))
            guard NSIntersectionRange(paragraph, range).length > 0 || (paragraph.length == 0 && NSLocationInRange(paragraph.location, range)) else { continue }

            // The indent: one level for each list, the bar and its gap for each quote; the bars sit at the start of each quote's level.
            var total: CGFloat = 0
            var bars: [CGFloat] = []
            var starts = false
            for container in line.containers {
                switch container {
                case .quote:
                    bars.append(total)
                    total += quoteIndent
                case .list(let itemStarts, _):
                    total += level
                    starts = starts || itemStarts
                }
            }
            let style = NSMutableParagraphStyle()
            style.headIndent = total
            // Away from the selection the marks are hidden and the marker is drawn in the level to the left of the text; on the selection's line they show as written,
            // starting a level further out, where the marker would be (the desktop's `text-indent`), so the text does not jump sideways.
            let firstIndent = starts && line.active ? total - level : total
            style.firstLineHeadIndent = firstIndent
            // A line of nothing but hidden marks (an empty item) would be a half-point high.
            style.minimumLineHeight = body.lineHeight

            var mark: LiveListLine.Mark?
            if let task = line.task {
                mark = .box(checked: task.checked, offset: task.box.location - paragraph.location)
            } else if let marker = line.marker {
                mark = marker.ordered ? .number(marker.text) : .bullet
            }
            let drawing = LiveListLine(bars: bars, markRight: total - markerGap, firstIndent: firstIndent, mark: mark, font: body, muted: look.uiMutedText, brand: look.uiBrand)
            storage.addAttributes([.paragraphStyle: style, .liveList: drawing], range: paragraph)

            if !bars.isEmpty, let part = inside(line.range, range) {
                // The quote's words muted, as the Preview draws them: the text's own colour, and the colour the Markdown tab gives a quote; what has a colour of its own
                // (code, a link) keeps it.
                let quoteColour = look.theme.syntax.comment.uiColor
                var plain: [NSRange] = []
                storage.enumerateAttribute(.foregroundColor, in: part) { value, run, _ in
                    if (value as? UIColor).map({ $0.isEqual(look.uiForeground) || $0.isEqual(quoteColour) }) ?? true { plain.append(run) }
                }
                for run in plain { storage.addAttribute(.foregroundColor, value: look.uiMutedText, range: run) }
            }
            for hidden in [line.hidden, line.task?.range].compactMap({ $0 }) {
                guard let part = inside(hidden, range) else { continue }
                storage.addAttributes([.font: LiveOverlay.hiddenFont, .foregroundColor: UIColor.clear], range: part)
                storage.removeAttribute(.obliqueness, range: part)
            }
        }
    }

    private static func inside(_ other: NSRange, _ range: NSRange) -> NSRange? {
        let common = NSIntersectionRange(other, range)
        return common.length > 0 ? common : nil
    }
}

/// What a line of a list or a quote draws beside its text: the quotes' bars, and its item's marker or task box.
final class LiveListLine: NSObject {
    enum Mark: Equatable {
        case bullet
        case number(String)
        /// A task's box; `offset` is where its `[` is, from the start of the line.
        case box(checked: Bool, offset: Int)
    }

    /// Where each quote's bar is, from the line's left edge.
    let bars: [CGFloat]
    /// Where the marker's right edge is, from the line's left edge.
    let markRight: CGFloat
    /// Where the first line's text starts, from the line's left edge (its paragraph's `firstLineHeadIndent`).
    let firstIndent: CGFloat
    let mark: Mark?
    let font: UIFont
    let muted: UIColor
    let brand: UIColor

    init(bars: [CGFloat], markRight: CGFloat, firstIndent: CGFloat, mark: Mark?, font: UIFont, muted: UIColor, brand: UIColor) {
        self.bars = bars
        self.markRight = markRight
        self.firstIndent = firstIndent
        self.mark = mark
        self.font = font
        self.muted = muted
        self.brand = brand
    }

    /// The Preview's box, at the body font's size.
    func boxImage(checked: Bool) -> UIImage? {
        let configuration = UIImage.SymbolConfiguration(font: font)
        return UIImage(systemName: checked ? "checkmark.square.fill" : "square", withConfiguration: configuration)?.withTintColor(checked ? brand : muted, renderingMode: .alwaysOriginal)
    }
}

/// A line of a list or a quote: the ordinary layout, and the bars and the marker drawn in the room its indent leaves at the left.
final class LiveListFragment: NSTextLayoutFragment {
    let line: LiveListLine

    init(textElement: NSTextElement, range: NSTextRange?, line: LiveListLine) {
        self.line = line
        super.init(textElement: textElement, range: range)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// The fragment for `textElement` when it is a line of a list or a quote in the Live tab, nil otherwise.
    static func make(for textElement: NSTextElement) -> LiveListFragment? {
        guard let paragraph = textElement as? NSTextParagraph, paragraph.attributedString.length > 0,
            let line = paragraph.attributedString.attribute(.liveList, at: 0, effectiveRange: nil) as? LiveListLine
        else { return nil }
        return LiveListFragment(textElement: textElement, range: textElement.elementRange, line: line)
    }

    /// Where the line's left edge (indent 0) is, in the fragment's own coordinates: the first character's place less the first line's indent. (The fragment's frame
    /// itself starts at the indent, so this is usually negative.)
    var leftEdge: CGFloat {
        guard let first = textLineFragments.first else { return 0 }
        return first.typographicBounds.minX + first.locationForCharacter(at: 0).x - line.firstIndent
    }

    /// The text's own box starts at its indent; the bars and the marker are to the left of it, so the surface is widened to the line's left edge. (From the indent alone:
    /// asking for the line fragments here, while TextKit is laying the paragraph out, hangs the app.)
    override var renderingSurfaceBounds: CGRect {
        let base = super.renderingSurfaceBounds
        let left = min(base.minX, -line.firstIndent - (textLayoutManager?.textContainer?.lineFragmentPadding ?? 0) - 2)
        return base.union(CGRect(x: left, y: min(base.minY, 0), width: base.maxX - left, height: max(base.height, layoutFragmentFrame.height)))
    }

    /// Where the first line's baseline is, from the top of the fragment.
    private var baseline: CGFloat {
        guard let first = textLineFragments.first else { return line.font.ascender }
        return first.typographicBounds.minY + first.glyphOrigin.y
    }

    /// Where the task box is drawn, in the fragment's own coordinates, when the line has one.
    var boxRect: CGRect? {
        guard case .box(let checked, _) = line.mark, let image = line.boxImage(checked: checked) else { return nil }
        let size = image.size
        let middle = baseline - line.font.capHeight / 2
        return CGRect(x: leftEdge + line.markRight - size.width, y: middle - size.height / 2, width: size.width, height: size.height)
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        super.draw(at: point, in: context)
        LiveDrawingFragment.drawFootnoteNumbers(of: self, at: point, in: context)  // a footnote's number in this paragraph (Step 7)
        let height = layoutFragmentFrame.height
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext() }
        line.muted.setFill()
        for bar in line.bars {
            UIRectFill(CGRect(x: point.x + leftEdge + bar, y: point.y, width: LiveLists.barWidth, height: height))
        }
        guard let mark = line.mark else { return }
        switch mark {
        case .bullet, .number:
            let string: String
            let font: UIFont
            if case .number(let number) = mark {
                string = number
                font = UIFont.monospacedDigitSystemFont(ofSize: line.font.pointSize, weight: .regular)
            } else {
                string = "•"
                font = line.font
            }
            let drawn = NSAttributedString(string: string, attributes: [.font: font, .foregroundColor: line.muted])
            let width = drawn.size().width
            drawn.draw(at: CGPoint(x: point.x + leftEdge + line.markRight - width, y: point.y + baseline - font.ascender))
        case .box(let checked, _):
            guard let rect = boxRect, let image = line.boxImage(checked: checked) else { return }
            image.draw(in: rect.offsetBy(dx: point.x, dy: point.y))
        }
    }
}

/// A tap on a drawn task box ticks or unticks it (decision D4): its `x` is written or taken out through the text view, as one step of undo, and the caret stays
/// where it was. The target is 44 points round the box, as far right as the start of the item's text, so that a tap on the words still edits them. Only in the Live
/// tab; the Preview's boxes stay read-only.
///
/// The Pencil has a recogniser of its own (Gate LD4, items 351 and 371): a tap, which waits to be one, lost the Pencil's touch now and then to the text view's own
/// handling of the Pencil, and the caret went into the item instead. `pencil` takes a Pencil touch on a box as it lands, as `LivePencilOpen` does on a drawing, so
/// nothing else has it, and ticks when the Pencil lifts still on that box; a stroke that moves off the box does nothing. (Scribble may not begin there: `LiveScribble`.)
@MainActor
final class LiveTaskTap: NSObject, UIGestureRecognizerDelegate {
    private weak var textView: UITextView?
    private let isLive: () -> Bool
    /// The task drawn at a place in the text, for the selection in force (`MarkdownStyler.drawnTask`): nil when none is.
    private let drawnTask: (Int) -> LiveDecorations.ListLine.Task?
    /// A finger's (or a pointer's) tap.
    private(set) var recognizer: UITapGestureRecognizer!
    /// The Pencil's touch, taken as it lands on a box.
    private(set) var pencil: UILongPressGestureRecognizer!
    /// The box the Pencil landed on, and where.
    private var pencilBox: (offset: Int, at: CGPoint)?
    /// Half the side of the square a finger may land in.
    static let reach: CGFloat = 22

    init(textView: UITextView, isLive: @escaping () -> Bool, drawnTask: @escaping (Int) -> LiveDecorations.ListLine.Task?) {
        self.textView = textView
        self.isLive = isLive
        self.drawnTask = drawnTask
        super.init()
        var pencilTypes = [UITouch.TouchType.pencil]
        #if DEBUG || EDITOR_TEST_HOOKS
        // `-fingerIsPencil 1`: a finger counts as the Pencil here, for the UI tests, which have no Pencil.
        if UserDefaults.standard.bool(forKey: "fingerIsPencil") { pencilTypes.append(.direct) }
        #endif
        recognizer = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        recognizer.allowedTouchTypes = [UITouch.TouchType.direct, .indirect, .indirectPointer].filter { !pencilTypes.contains($0) }.map { NSNumber(value: $0.rawValue) }
        recognizer.delegate = self
        textView.addGestureRecognizer(recognizer)
        pencil = UILongPressGestureRecognizer(target: self, action: #selector(pencilPressed(_:)))
        pencil.minimumPressDuration = 0
        pencil.allowableMovement = .greatestFiniteMagnitude
        pencil.allowedTouchTypes = pencilTypes.map { NSNumber(value: $0.rawValue) }
        pencil.delegate = self
        textView.addGestureRecognizer(pencil)
    }

    /// The box nearest `point` (in the text view) whose target holds it, as the offset of its `[` in the text.
    func box(at point: CGPoint) -> Int? {
        guard let textView, isLive(), let layout = textView.textLayoutManager else { return nil }
        let inset = textView.textContainerInset
        let inContainer = CGPoint(x: point.x - inset.left, y: point.y - inset.top)
        var best: (offset: Int, distance: CGFloat)?
        var seen = Set<ObjectIdentifier>()
        for dy in [0, -Self.reach, Self.reach, -Self.reach / 2, Self.reach / 2] {
            guard let fragment = layout.textLayoutFragment(for: CGPoint(x: inContainer.x, y: inContainer.y + dy)) as? LiveListFragment,
                seen.insert(ObjectIdentifier(fragment)).inserted, let box = fragment.boxRect, case .box(_, let offset) = fragment.line.mark
            else { continue }
            let start = fragment.rangeInElement.location
            let frame = fragment.layoutFragmentFrame
            let rect = box.offsetBy(dx: frame.minX, dy: frame.minY)
            let center = CGPoint(x: rect.midX, y: rect.midY)
            var target = CGRect(x: center.x - Self.reach, y: center.y - Self.reach, width: 2 * Self.reach, height: 2 * Self.reach)
            // No further right than where the item's text starts.
            let textStart = frame.minX + fragment.leftEdge + fragment.line.markRight + LiveLists.markerGap
            target.size.width = min(target.width, max(0, textStart - target.minX))
            guard target.contains(inContainer) else { continue }
            let distance = hypot(inContainer.x - center.x, inContainer.y - center.y)
            let lineStart = layout.offset(from: layout.documentRange.location, to: start)
            if best == nil || distance < best!.distance { best = (lineStart + offset, distance) }
        }
        guard let found = best?.offset, drawnTask(found) != nil else { return nil }
        return found
    }

    #if DEBUG || EDITOR_TEST_HOOKS
    /// Where the drawn boxes are on the screen, in the order of the text (the UI tests tap them: `live-boxes`, with `-liveReport 1`).
    func boxCenters() -> [CGPoint] {
        guard let textView, let layout = textView.textLayoutManager else { return [] }
        let inset = textView.textContainerInset
        var out: [CGPoint] = []
        layout.enumerateTextLayoutFragments(from: layout.documentRange.location, options: []) { fragment in
            if let list = fragment as? LiveListFragment, let box = list.boxRect {
                let frame = list.layoutFragmentFrame
                out.append(textView.convert(CGPoint(x: frame.minX + box.midX + inset.left, y: frame.minY + box.midY + inset.top), to: nil))
            }
            return true
        }
        return out
    }
    #endif

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let textView else { return false }
        return box(at: touch.location(in: textView)) != nil
    }

    /// The text view's own taps (which would move the caret onto the line, where no box is drawn) wait until this one has failed.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        gestureRecognizer === recognizer && other is UITapGestureRecognizer && other !== recognizer
    }

    @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, let textView, let at = box(at: recognizer.location(in: textView)), let task = drawnTask(at) else { return }
        Self.toggle(task, in: textView)
    }

    @objc private func pencilPressed(_ recognizer: UILongPressGestureRecognizer) {
        guard let textView else { return }
        let point = recognizer.location(in: textView)
        switch recognizer.state {
        case .began:
            pencilBox = box(at: point).map { ($0, point) }
        case .ended:
            defer { pencilBox = nil }
            // A tap: the Pencil lifted on the box it landed on, not far from where it landed.
            guard let landed = pencilBox, hypot(point.x - landed.at.x, point.y - landed.at.y) <= Self.reach, box(at: point) == landed.offset,
                let task = drawnTask(landed.offset)
            else { return }
            Self.toggle(task, in: textView)
        case .cancelled, .failed:
            pencilBox = nil
        default:
            break
        }
    }

    /// Ticks or unticks `task` through the text view (so that it is typed text to undo, autosave and the colours), as an undo step of its own, leaving the selection as it was.
    static func toggle(_ task: LiveDecorations.ListLine.Task, in textView: UITextView) {
        let edit = task.toggle
        let text = textView.textStorage.mutableString
        guard NSMaxRange(task.box) <= text.length, text.substring(with: task.box).range(of: #"^\[[ xX]\]$"#, options: .regularExpression) != nil,
            let start = textView.position(from: textView.beginningOfDocument, offset: edit.range.location),
            let end = textView.position(from: start, offset: edit.range.length), let range = textView.textRange(from: start, to: end)
        else { return }
        let selection = textView.selectedRange
        textView.replace(range, withText: edit.text)
        textView.selectedRange = selection
    }
}

#if DEBUG || EDITOR_TEST_HOOKS
/// An element the UI tests read whose label is worked out when it is asked for (after layout), not when the text last changed.
final class LiveProbe: UIView {
    var describe: () -> String = { "" }

    override var accessibilityLabel: String? {
        get { describe() }
        set {}
    }
}
#endif
