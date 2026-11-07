import CompositionCore
import UIKit

/// Puts Markdown colours on a text view as its text is typed (build plan Step 6, on Step 5's `HighlightModel`).
///
/// The blocks around an edit are coloured at once, which costs what they hold and not what the note does; a pause of 0.3 s after typing starts a
/// full read off the main thread, and only the blocks it finds the quick reads got wrong are coloured again, in small steps that typing interrupts.
/// Only attributes change, never the characters, so the selection and the undo stack are untouched, and nothing is done while a composition
/// (Scribble, dictation, an input method) is under way. The measurements and the reasoning are in docs/ipad-app-design.md ("Step 5").
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
    private var palette = Palette()
    /// What the colours on the text were made from; nil when that is not known (just loaded, or something changed the text unseen), and the
    /// next full pass then colours all of it.
    private var model: HighlightModel?
    private var pendingEdits = EditAccumulator()
    private var version = 0
    private var idlePass: DispatchWorkItem?
    private var stepGeneration = 0
    private nonisolated(unsafe) var observer: NSObjectProtocol?
    private let clock = ContinuousClock()

    private static let stepLength = 3_000
    private static let pause: TimeInterval = 0.3
    private static let managedKeys: [NSAttributedString.Key] = [.font, .foregroundColor, .backgroundColor, .strikethroughStyle, .underlineStyle]

    init(textView: UITextView) {
        self.textView = textView
        // Every change to the characters, from anywhere: typing, a paste, an undo, a change made in code. (The delegate's `shouldChangeTextIn`
        // is not called for `insertText` or for changes made in code.) A change to attributes only, which is all the colouring does, is not an edit.
        observer = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification, object: textView.textStorage, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated { self?.storageProcessedEditing() }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
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
        palette = Palette()
        reload()
    }

    /// The text view reported a change.
    func textDidChange() {
        let started = clock.now
        version += 1
        stepGeneration += 1  // a full pass that is putting colours on stops: the text moved under it
        recolourAfterEdit()
        scheduleFullPass(after: Self.pause)
        measurements.editMilliseconds.append(Self.milliseconds(clock.now - started))
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
            measurements.fallbackEdits += 1
            return
        }
        pendingEdits = EditAccumulator()
        measurements.quickEdits += 1
        let window = model!.edited(replacing: merged.range, withLength: merged.newLength, in: storage.mutableString)
        applyColours(to: window, using: model!)
    }

    /// Puts the colours of `model` on `range` and nothing else: clears what a colour put there before, then sets what the spans there say.
    private func applyColours(to range: NSRange, using model: HighlightModel) {
        guard let storage = textView?.textStorage else { return }
        let range = NSIntersectionRange(range, NSRange(location: 0, length: storage.length))
        guard range.length > 0 else { return }
        storage.beginEditing()
        for key in Self.managedKeys { storage.removeAttribute(key, range: range) }
        storage.addAttributes(palette.base, range: range)
        for span in model.spans(in: range) {
            let clipped = NSIntersectionRange(span.range, range)
            if clipped.length > 0 { storage.addAttributes(palette.attributes(for: span.kind), range: clipped) }
        }
        storage.endEditing()
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
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let started = ContinuousClock.now
            let fresh = HighlightModel(text: snapshot)
            let dirty = known.map { fresh.differences(from: $0) } ?? [NSRange(location: 0, length: fresh.length)]
            let spent = ContinuousClock.now - started
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.version == seen else { return }  // typed again meanwhile: the next pause reads it again
                    self.measurements.fullReadMilliseconds = Self.milliseconds(spent)
                    if known != nil, !dirty.isEmpty { self.measurements.corrections += 1 }
                    self.beginPuttingOn(fresh, dirty: dirty)
                }
            }
        }
    }

    /// Puts the colours on in small steps, so that the main thread is never held for more than a fraction of a frame; typing stops it.
    private func beginPuttingOn(_ fresh: HighlightModel, dirty: [NSRange]) {
        guard let storage = textView?.textStorage else { return }
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
        stepGeneration += 1
        putOn(steps, from: 0, using: fresh, generation: stepGeneration)
    }

    private func putOn(_ steps: [NSRange], from index: Int, using fresh: HighlightModel, generation: Int) {
        guard index < steps.count else { return }
        guard generation == stepGeneration, textView?.markedTextRange == nil else {
            // Interrupted: what is on the text is now partly the old colours, so the next full pass starts from nothing.
            model = nil
            return scheduleFullPass(after: Self.pause)
        }
        let started = clock.now
        applyColours(to: steps[index], using: fresh)
        measurements.worstStepMilliseconds = max(measurements.worstStepMilliseconds, Self.milliseconds(clock.now - started))
        DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.putOn(steps, from: index + 1, using: fresh, generation: generation) } }
    }

    private static func milliseconds(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
    }

    // MARK: Look

    /// The fonts and attribute sets, made once, because a note has thousands of spans.
    struct Palette {
        let base: [NSAttributedString.Key: Any]
        private let heading, strong, emphasis, strikethrough, inlineCode, codeBlock, linkText, quote, listMarker, rule, tag, mark, frontmatter: [NSAttributedString.Key: Any]

        init() {
            let metrics = UIFontMetrics(forTextStyle: .body)
            let regular = metrics.scaledFont(for: .monospacedSystemFont(ofSize: 16, weight: .regular))
            let bold = metrics.scaledFont(for: .monospacedSystemFont(ofSize: 16, weight: .bold))
            base = [.font: regular, .foregroundColor: UIColor.label]
            frontmatter = [.foregroundColor: UIColor.secondaryLabel]
            heading = [.foregroundColor: UIColor.systemBlue, .font: bold]
            strong = [.font: bold]
            emphasis = [.foregroundColor: UIColor.systemIndigo]
            strikethrough = [.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: UIColor.secondaryLabel]
            inlineCode = [.foregroundColor: UIColor.systemOrange, .backgroundColor: UIColor.secondarySystemFill]
            codeBlock = [.foregroundColor: UIColor.systemOrange]
            linkText = [.foregroundColor: UIColor.systemTeal]
            quote = [.foregroundColor: UIColor.secondaryLabel]
            listMarker = [.foregroundColor: UIColor.systemPink, .font: bold]
            rule = [.foregroundColor: UIColor.tertiaryLabel]
            tag = [.foregroundColor: UIColor.systemPurple]
            mark = [.foregroundColor: UIColor.tertiaryLabel]
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
