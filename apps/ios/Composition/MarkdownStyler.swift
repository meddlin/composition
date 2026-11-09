import CompositionCore
import UIKit

/// Puts Markdown colours on a text view as its text is typed (build plan Step 6, on Step 5's `HighlightModel`).
///
/// The blocks around an edit are coloured at once, which costs what they hold and not what the note does; a pause of 0.3 s after typing starts a
/// full read off the main thread, and only the blocks it finds the quick reads got wrong are coloured again, in small steps that typing interrupts.
/// Only attributes change, never the characters, so the selection and the undo stack are untouched, and nothing is done while a composition
/// (Scribble, dictation, an input method) is under way. The measurements and the reasoning are in docs/ipad-app-design.md ("Step 5").
///
/// In the Live tab (`setLive`) it does the same and then puts the Live look on what it has coloured (`LiveOverlay`, from a `LiveModel` that follows the
/// same edits and the same corrections), and follows the selection: moving it into or out of a construct changes how that construct looks, and only
/// the constructs it left and the ones it entered are drawn again.
@MainActor
final class MarkdownStyler {
    /// What the styler measured of itself; the Debug speed test reads it.
    struct Measurements {
        var editMilliseconds: [Double] = []
        var quickEdits = 0
        var fallbackEdits = 0
        var corrections = 0
        var fullReadMilliseconds = 0.0
        var worstStepMilliseconds = 0.0
    }

    private(set) var measurements = Measurements()

    private weak var textView: UITextView?
    private var look: Look
    private var palette: Palette
    /// What the colours on the text were made from; nil when that is not known (just loaded, or something changed the text unseen), and the
    /// next full pass then colours all of it.
    private var model: HighlightModel?
    /// The Live tab is the one showing: the text is drawn as it will read, the marks hidden away from the selection.
    private(set) var isLive = false
    /// What the Live look is made from, kept in step with `model` (nil in the other tabs, and until the first full read in this one).
    private var live: LiveModel?
    /// Where the selection was when the text was last drawn: what it has left is what has to be drawn again.
    private var drawnSelection: NSRange?
    /// Called after text has been coloured (the UI tests' view of what the screen shows).
    var didApply: (() -> Void)?
    /// Where the notes' pictures are kept: asked when the Live tab draws one.
    var imageFolder: () -> URL? = { nil }
    /// Gives the paragraphs the Live tab draws a rule or a picture on their layout fragment.
    private let drawingDelegate = LiveDrawingDelegate()
    private nonisolated(unsafe) var pictureObserver: NSObjectProtocol?
    private var widthPass: DispatchWorkItem?
    private var pendingEdits = EditAccumulator()
    private var version = 0
    private var idlePass: DispatchWorkItem?
    private var stepGeneration = 0
    private nonisolated(unsafe) var observer: NSObjectProtocol?
    private let clock = ContinuousClock()

    private static let stepLength = 3_000
    private static let pause: TimeInterval = 0.3
    private static let managedKeys: [NSAttributedString.Key] = [.font, .foregroundColor, .backgroundColor, .strikethroughStyle, .underlineStyle, .obliqueness, .paragraphStyle, .liveDraw]

    init(textView: UITextView, look: Look = .standard) {
        self.textView = textView
        self.look = look
        palette = Palette(look: look, live: false)
        textView.textLayoutManager?.delegate = drawingDelegate
        // A picture the Live tab asked for has come in: the text is drawn again, with it.
        pictureObserver = NotificationCenter.default.addObserver(forName: LiveImages.didLoad, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.isLive, let layout = self.textView?.textLayoutManager else { return }
                layout.invalidateLayout(for: layout.documentRange)
                self.textView?.setNeedsLayout()
            }
        }
        // Every change to the characters, from anywhere: typing, a paste, an undo, a change made in code. (The delegate's `shouldChangeTextIn`
        // is not called for `insertText` or for changes made in code.) A change to attributes only, which is all the colouring does, is not an edit.
        observer = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification, object: textView.textStorage, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated { self?.storageProcessedEditing() }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        if let pictureObserver { NotificationCenter.default.removeObserver(pictureObserver) }
    }

    /// The width of the text view changed (the iPad was turned, the divider was dragged): a picture is as tall as the width allows, so the ones the Live tab
    /// draws are laid out again, a moment after the last change.
    func widthChanged() {
        guard isLive else { return }
        widthPass?.cancel()
        let item = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { self?.redrawPictures() } }
        widthPass = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: item)
    }

    private func redrawPictures() {
        guard isLive, let model, let live, let storage = textView?.textStorage, live.length == storage.length else { return }
        for range in live.drawnPictureRanges { applyColours(to: range, using: model) }
    }

    /// How wide a line of the note's text is.
    private var textWidth: CGFloat {
        guard let container = textView?.textContainer else { return NoteTextView.readableWidth }
        let width = container.size.width - 2 * container.lineFragmentPadding
        return width > 100 ? width : NoteTextView.readableWidth
    }

    // MARK: What the owner calls

    /// The text was replaced in code (a note opened): colour all of it, in the background.
    func reload() {
        model = nil
        pendingEdits = EditAccumulator()
        version += 1
        stepGeneration += 1
        scheduleFullPass(after: 0)
    }

    /// The text size changed: the fonts in the colours are stale.
    func restyleAll() {
        palette = Palette(look: look, live: isLive)
        reload()
    }

    /// The Live tab came to the front, or went: the text is drawn again, all of it, in the new look.
    func setLive(_ on: Bool) {
        guard on != isLive else { return }
        isLive = on
        live = nil
        drawnSelection = nil
        restyleAll()
    }

    /// The colour scheme or the editor's font changed: every colour is made again.
    func apply(_ new: Look) {
        guard new != look else { return }
        look = new
        restyleAll()
    }

    /// The text view reported a change.
    func textDidChange() {
        let started = clock.now
        version += 1
        stepGeneration += 1  // a full pass that is putting colours on stops: the text moved under it
        recolourAfterEdit()
        drawnSelection = textView?.selectedRange
        scheduleFullPass(after: Self.pause)
        measurements.editMilliseconds.append(Self.milliseconds(clock.now - started))
    }

    /// The text view's selection moved. In the Live tab, the constructs it left and the ones it entered change how they look: their marks show or hide.
    func selectionChanged() {
        guard isLive, let textView else { return }
        let now = textView.selectedRange
        let storage = textView.textStorage
        // Not during a composition, and not while the colours are behind the text (an edit was typed and `textDidChange` has not come yet, or the first
        // read is not in): what is drawn then follows from the selection when it is.
        guard textView.markedTextRange == nil, let model, let live, model.length == storage.length, live.length == storage.length else { return }
        defer { drawnSelection = now }
        guard let before = drawnSelection, before != now else { return }
        let left = Set(live.constructRanges(touching: before)), entered = Set(live.constructRanges(touching: now))
        let changed = left.symmetricDifference(entered).sorted { $0.location < $1.location }
        // Nested constructs overlap: draw their union once.
        var ranges: [NSRange] = []
        for range in changed {
            if let last = ranges.last, range.location <= NSMaxRange(last) { ranges[ranges.count - 1] = NSUnionRange(last, range) } else { ranges.append(range) }
        }
        for range in ranges { applyColours(to: range, using: model) }
    }

    // MARK: Quick reads

    private func storageProcessedEditing() {
        guard let storage = textView?.textStorage, storage.editedMask.contains(.editedCharacters) else { return }
        let edited = storage.editedRange
        pendingEdits.record(range: NSRange(location: edited.location, length: edited.length - storage.changeInLength), newLength: edited.length)
    }

    private func recolourAfterEdit() {
        // Not during a composition: the edits wait in `pendingEdits` and are read as one when it ends.
        guard let textView, textView.markedTextRange == nil else { return }
        let storage = textView.textStorage
        guard let merged = pendingEdits.merged, let known = model, known.length - merged.range.length + merged.newLength == storage.length else {
            // An edit nobody described: the pause that follows reads it all.
            pendingEdits = EditAccumulator()
            model = nil
            live = nil
            measurements.fallbackEdits += 1
            return
        }
        pendingEdits = EditAccumulator()
        measurements.quickEdits += 1
        let window = model!.edited(replacing: merged.range, withLength: merged.newLength, in: storage.mutableString)
        live?.edited(replacing: merged.range, withLength: merged.newLength, rereading: window, in: storage.mutableString)
        applyColours(to: window, using: model!)
    }

    /// Puts the colours of `model` on `range` and nothing else: clears what a colour put there before, then sets what the spans there say.
    private func applyColours(to range: NSRange, using model: HighlightModel) {
        guard let storage = textView?.textStorage else { return }
        var range = NSIntersectionRange(range, NSRange(location: 0, length: storage.length))
        guard range.length > 0 else { return }
        // In the Live tab whole paragraphs: what is drawn in place of a paragraph's text is set on the paragraph, and made again as a whole.
        if isLive { range = storage.mutableString.paragraphRange(for: range) }
        storage.beginEditing()
        for key in Self.managedKeys { storage.removeAttribute(key, range: range) }
        storage.addAttributes(palette.base, range: range)
        for span in model.spans(in: range) {
            let clipped = NSIntersectionRange(span.range, range)
            if clipped.length > 0 { storage.addAttributes(palette.attributes(for: span.kind), range: clipped) }
        }
        if isLive, let live, live.length == storage.length {
            let selection = textView?.selectedRange ?? NSRange(location: 0, length: 0)
            LiveOverlay.apply(live.decorations(in: range, selection: selection), to: range, in: storage, context: .init(look: look, imageFolder: imageFolder(), textWidth: textWidth))
        }
        storage.endEditing()
        didApply?()
    }

    // MARK: Corrections after a pause

    private func scheduleFullPass(after delay: TimeInterval) {
        idlePass?.cancel()
        let item = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { self?.runFullPass() } }
        idlePass = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func runFullPass() {
        guard let textView else { return }
        guard textView.markedTextRange == nil else { return scheduleFullPass(after: Self.pause) }  // a composition is under way
        pendingEdits = EditAccumulator()
        let snapshot = textView.nativeText
        let seen = version
        let known = model
        let wantsLive = isLive
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let started = ContinuousClock.now
            let fresh = HighlightModel(text: snapshot)
            let freshLive = wantsLive ? LiveModel(text: snapshot) : nil
            let dirty = known.map { fresh.differences(from: $0) } ?? [NSRange(location: 0, length: fresh.length)]
            let spent = ContinuousClock.now - started
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.version == seen else { return }  // typed again meanwhile: the next pause reads it again
                    self.measurements.fullReadMilliseconds = Self.milliseconds(spent)
                    var dirty = dirty
                    // Highlights, `<Image />` tags and the frontmatter pair across blocks: what the quick reads had moved and what the full read says differ there.
                    if let freshLive, let current = self.live { dirty = Self.joined(dirty + freshLive.differences(from: current)) }
                    if known != nil, !dirty.isEmpty { self.measurements.corrections += 1 }
                    self.beginPuttingOn(fresh, live: freshLive, dirty: dirty)
                }
            }
        }
    }

    /// Puts the colours on in small steps, so that the main thread is never held for more than a fraction of a frame; typing stops it.
    private func beginPuttingOn(_ fresh: HighlightModel, live freshLive: LiveModel?, dirty: [NSRange]) {
        guard let storage = textView?.textStorage else { return }
        guard isLive == (freshLive != nil) else { return scheduleFullPass(after: 0) }  // the tab changed while it was being read
        guard fresh.length == storage.length else { return scheduleFullPass(after: Self.pause) }
        let text = storage.mutableString
        var steps: [NSRange] = []
        for range in dirty {
            var position = range.location
            while position < range.upperBound {
                let end = min(range.upperBound, position + Self.stepLength)
                // End on a line break where there is one, so that a step never cuts a line in two.
                let line = text.lineRange(for: NSRange(location: max(end - 1, position), length: 0))
                let stop = min(max(line.upperBound, end), range.upperBound)
                steps.append(NSRange(location: position, length: stop - position))
                position = stop
            }
        }
        model = fresh
        live = freshLive
        drawnSelection = textView?.selectedRange
        stepGeneration += 1
        putOn(steps, from: 0, using: fresh, generation: stepGeneration)
    }

    private func putOn(_ steps: [NSRange], from index: Int, using fresh: HighlightModel, generation: Int) {
        guard index < steps.count else { return }
        guard generation == stepGeneration, textView?.markedTextRange == nil else {
            // Interrupted: what is on the text is now partly the old colours, so the next full pass starts from nothing.
            model = nil
            live = nil
            return scheduleFullPass(after: Self.pause)
        }
        let started = clock.now
        applyColours(to: steps[index], using: fresh)
        measurements.worstStepMilliseconds = max(measurements.worstStepMilliseconds, Self.milliseconds(clock.now - started))
        DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.putOn(steps, from: index + 1, using: fresh, generation: generation) } }
    }

    /// In order, with ranges that overlap or touch made into one.
    private static func joined(_ ranges: [NSRange]) -> [NSRange] {
        var result: [NSRange] = []
        for range in ranges.sorted(by: { $0.location < $1.location }) {
            if let last = result.last, range.location <= NSMaxRange(last) { result[result.count - 1] = NSUnionRange(last, range) } else { result.append(range) }
        }
        return result
    }

    private static func milliseconds(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
    }

    // MARK: Look

    /// The fonts and attribute sets, made once, because a note has thousands of spans.
    struct Palette {
        let base: [NSAttributedString.Key: Any]
        private let heading, strong, emphasis, strikethrough, inlineCode, codeBlock, linkText, quote, listMarker, rule, tag, mark, frontmatter: [NSAttributedString.Key: Any]

        /// The editor's colours are the desktop's (`.md-heading` is `--syntax-function`, `.md-code` is `--syntax-string`, `.md-marker` is `--syntax-number`, and so on in
        /// `globals.css`), in the scheme in force; the fonts are the family chosen, with code kept monospaced.
        init(look: Look, live: Bool = false) {
            let family = look.editorFont
            let regular = family.uiFont(size: 16)
            let bold = family.uiFont(size: 16, weight: .bold)
            let code = FontFamily.mono.uiFont(size: 16)
            let syntax = look.theme.syntax
            base = [.font: regular, .foregroundColor: look.uiForeground]
            frontmatter = [.foregroundColor: syntax.comment.uiColor]
            // The Live tab draws headings, bold, italic and strikethrough as such, and does not colour them as well (the desktop's Live tab does the same: its
            // colours are for code, links, tags and list and quote marks); `LiveOverlay` sets their fonts, from the font the text has.
            heading = live ? [:] : [.foregroundColor: syntax.function.uiColor, .font: bold]
            strong = live ? [:] : [.font: bold, .foregroundColor: syntax.type.uiColor]
            emphasis = live ? [:] : [.foregroundColor: syntax.attr.uiColor]
            strikethrough = live ? [.strikethroughStyle: NSUnderlineStyle.single.rawValue] : [.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: syntax.comment.uiColor]
            inlineCode = [.foregroundColor: syntax.string.uiColor, .backgroundColor: look.uiMutedFill, .font: code]
            codeBlock = [.foregroundColor: syntax.string.uiColor, .font: code]
            linkText = [.foregroundColor: look.theme.link.uiColor]
            quote = [.foregroundColor: syntax.comment.uiColor]
            listMarker = [.foregroundColor: syntax.number.uiColor, .font: bold]
            rule = [.foregroundColor: syntax.comment.uiColor]
            tag = [.foregroundColor: syntax.keyword.uiColor]
            mark = [.foregroundColor: syntax.comment.uiColor]
        }

        func attributes(for kind: HighlightKind) -> [NSAttributedString.Key: Any] {
            switch kind {
            case .frontmatter: frontmatter
            case .heading: heading
            case .strong: strong
            case .emphasis: emphasis
            case .strikethrough: strikethrough
            case .inlineCode: inlineCode
            case .codeBlock: codeBlock
            case .linkText: linkText
            case .quote: quote
            case .listMarker: listMarker
            case .rule: rule
            case .tag: tag
            case .mark: mark
            }
        }
    }
}
