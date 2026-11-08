import CompositionCore
import PencilKit
import SwiftUI
import UIKit

// Spike S3 (docs/ipad-app-design.md, "The editor"): a `UITextView` on TextKit 2 with Markdown colours as attributes, and the
// experiments the design left open: find, a completion list at the caret, views inside the text (an image, a PencilKit canvas, a
// SwiftUI panel), hiding the syntax away from the caret, and a 5,000-line note. Nothing here is saved: it is a lab, reached from the
// More menu, and not the editor the app will have.

/// How the Live tab's hiding of Markdown syntax is tried.
enum HideMode: String, CaseIterable, Identifiable {
    case off = "Show marks"
    /// The syntax characters get a clear colour and a tiny font, except in the paragraph with the caret.
    case attributes = "Hide: tiny and clear"
    /// The text content storage hands TextKit a paragraph with the syntax left out (the characters then differ from the store's).
    case substitute = "Hide: substitute"

    var id: String { rawValue }
}

struct EditorStats: Equatable {
    var characters = 0
    var lines = 0
    var attachments = 0
    var textKit2 = false
    var parseMilliseconds = 0.0
    var applyMilliseconds = 0.0
    var spans = 0
    var fullLayoutMilliseconds: Double?
    var lastEditMilliseconds = 0.0
    var worstEditMilliseconds = 0.0
    // Colouring only what was typed (build plan Step 5)
    /// Characters the last quick read covered.
    var rereadCharacters = 0
    /// How long the last full read took, off the main thread.
    var fullReadMilliseconds = 0.0
    /// The most time any one step of putting the colours on took on the main thread, and what all the steps of the last full pass took.
    var worstSliceMilliseconds = 0.0
    var sliceTotalMilliseconds = 0.0
    /// How many pauses found something the quick reads had wrong, and how many characters the last one put right.
    var corrections = 0
    var lastCorrectionCharacters = 0
    /// Edits coloured by reading the blocks around them, and edits that could not be (the pause that follows reads the whole note).
    var incrementalEdits = 0
    var fallbackEdits = 0
}

@MainActor
@Observable
final class EditorLab: NSObject, UITextViewDelegate, @MainActor NSTextContentStorageDelegate {
    let textView: UITextView = {
        let view = UITextView(usingTextLayoutManager: true)  // TextKit 2. Never touch `layoutManager`: that falls back to TextKit 1.
        view.isFindInteractionEnabled = true
        view.alwaysBounceVertical = true
        view.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 16, right: 12)
        view.autocorrectionType = .no
        view.autocapitalizationType = .none
        view.smartDashesType = .no
        view.smartQuotesType = .no
        view.adjustsFontForContentSizeCategory = true
        return view
    }()

    private(set) var stats = EditorStats()
    var hideMode = HideMode.off {
        didSet {
            guard hideMode != oldValue else { return }
            configureHiding()
            restyle(force: true)
            // `restyle` leaves no model: read the note again, so that the marks can follow the caret from here on.
            if hideMode == .attributes { scheduleFullPass(after: 0) }
        }
    }
    var completionItems: [String] = []

    private var restylePending = false
    private var lastCaretParagraph = NSRange(location: 0, length: 0)
    // Colouring only what was typed. `model` is what the colours on the text were made from; nil means that is not known (the note was
    // just loaded, or something changed the text unseen), and the next full pass puts them all on.
    private var model: HighlightModel?
    private var pendingEdits = EditAccumulator()
    private var version = 0
    private var idlePass: DispatchWorkItem?
    private var sliceGeneration = 0
    /// What the speed test (and anything else that wants numbers) can read: how long each keystroke's own work took, in milliseconds.
    private(set) var editSamples: [Double] = []
    /// Developer switch for comparing: `-labLegacyColouring 1` colours the whole note after every edit, as the lab did before Step 5.
    private let legacyColouring = UserDefaults.standard.bool(forKey: "labLegacyColouring")
    private var completionList: CompletionList?
    private let clock = ContinuousClock()

    override init() {
        super.init()
        textView.delegate = self
        NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification, object: textView.textStorage, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated { self?.storageProcessedEditing() }
        }
        textView.font = Self.baseFont
        textView.textColor = .label
        textView.backgroundColor = .systemBackground
        stats.textKit2 = textView.textLayoutManager != nil
    }

    // MARK: Look

    static var baseFont: UIFont { UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: 15, weight: .regular)) }
    private static var boldFont: UIFont { UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: 15, weight: .bold)) }
    private static let hiddenFont = UIFont.systemFont(ofSize: 0.5)

    private func attributes(for kind: HighlightKind) -> [NSAttributedString.Key: Any] {
        switch kind {
        case .frontmatter: [.foregroundColor: UIColor.secondaryLabel]
        case .heading: [.foregroundColor: UIColor.systemBlue, .font: Self.boldFont]
        case .strong: [.font: Self.boldFont]
        case .emphasis: [.foregroundColor: UIColor.systemIndigo]
        case .strikethrough: [.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: UIColor.secondaryLabel]
        case .inlineCode: [.foregroundColor: UIColor.systemOrange, .backgroundColor: UIColor.secondarySystemFill]
        case .codeBlock: [.foregroundColor: UIColor.systemOrange]
        case .linkText: [.foregroundColor: UIColor.systemTeal]
        case .quote: [.foregroundColor: UIColor.secondaryLabel]
        case .listMarker: [.foregroundColor: UIColor.systemPink, .font: Self.boldFont]
        case .rule: [.foregroundColor: UIColor.tertiaryLabel]
        case .tag: [.foregroundColor: UIColor.systemPurple]
        case .mark: [.foregroundColor: UIColor.tertiaryLabel]
        }
    }

    private static let managedKeys: [NSAttributedString.Key] = [.font, .foregroundColor, .backgroundColor, .strikethroughStyle, .underlineStyle]

    /// Colours the whole text, at once, on the main thread: what every edit used to do, and what the experimental `substitute` way of hiding
    /// still does. The editor proper colours what was typed (`recolourAfterEdit`) and the rest in a pause (`runFullPass`).
    func restyle(force: Bool = false) {
        guard textView.markedTextRange == nil else { restylePending = true; return }
        restylePending = false
        model = nil
        let start = clock.now
        let text = textView.text ?? ""
        let spans = MarkdownHighlighter.spans(in: text)
        let parsed = clock.now

        let storage = textView.textStorage  // fine under TextKit 2; `layoutManager` is the one to avoid
        let full = NSRange(location: 0, length: storage.length)
        // The caret's line, or the whole code block it is in (both fences show, so it is plain you are inside one).
        let caret = LiveReveal.range(forLine: paragraphRange(around: textView.selectedRange), spans: spans)
        lastCaretParagraph = caret
        storage.beginEditing()
        for key in Self.managedKeys { storage.removeAttribute(key, range: full) }
        storage.addAttributes([.font: Self.baseFont, .foregroundColor: UIColor.label], range: full)
        for span in spans where span.range.upperBound <= storage.length {
            var attrs = attributes(for: span.kind)
            if hideMode == .attributes, span.kind == .mark, NSIntersectionRange(span.range, caret).length == 0, !(span.range.length == 0) {
                attrs = [.font: Self.hiddenFont, .foregroundColor: UIColor.clear]
            }
            storage.addAttributes(attrs, range: span.range)
        }
        storage.endEditing()
        let applied = clock.now

        marks = hideMode == .substitute ? spans.filter { $0.kind == .mark }.map(\.range) : []
        stats.parseMilliseconds = ms(parsed - start)
        stats.applyMilliseconds = ms(applied - parsed)
        stats.spans = spans.count
        refreshCounts()
    }

    private func ms(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
    }

    private func refreshCounts() {
        let text = textView.text ?? ""
        stats.characters = (text as NSString).length
        stats.lines = text.reduce(1) { $1 == "\n" ? $0 + 1 : $0 }
        stats.textKit2 = textView.textLayoutManager != nil
        var found = 0
        textView.textStorage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: textView.textStorage.length)) { value, _, _ in
            if value != nil { found += 1 }
        }
        stats.attachments = found
    }

    private func paragraphRange(around range: NSRange) -> NSRange {
        let ns = (textView.text ?? "") as NSString
        guard ns.length > 0 else { return NSRange(location: 0, length: 0) }
        return ns.paragraphRange(for: NSRange(location: min(range.location, ns.length), length: 0))
    }

    // MARK: Text

    func load(_ text: String) {
        textView.text = text
        textView.undoManager?.removeAllActions()
        textView.selectedRange = NSRange(location: 0, length: 0)
        textView.setContentOffset(.zero, animated: false)
        stats.fullLayoutMilliseconds = nil
        stats.worstEditMilliseconds = 0
        stats.worstSliceMilliseconds = 0
        stats.corrections = 0
        stats.incrementalEdits = 0
        stats.fallbackEdits = 0
        editSamples = []
        model = nil
        pendingEdits = EditAccumulator()
        version += 1
        refreshCounts()
        if hideMode == .substitute { restyle(force: true) } else { scheduleFullPass(after: 0) }
    }

    /// Lays out the whole text, which TextKit 2 otherwise does only for what is on screen: the worst case for a long note.
    func measureFullLayout() {
        guard let layout = textView.textLayoutManager else { return }
        let start = clock.now
        layout.ensureLayout(for: layout.documentRange)
        stats.fullLayoutMilliseconds = ms(clock.now - start)
    }

    func presentFind() { textView.findInteraction?.presentFindNavigator(showingReplace: false) }

    // MARK: UITextViewDelegate

    /// Every change to the characters, from anywhere: typing, a paste, an undo, the completion list, a view put in. (The delegate's
    /// `shouldChangeTextIn` is not called for `insertText` or for changes made in code, so the text storage is asked instead.) A change that
    /// is only to attributes, which is all the colouring does, is not an edit.
    private func storageProcessedEditing() {
        let storage = textView.textStorage
        guard storage.editedMask.contains(.editedCharacters) else { return }
        let edited = storage.editedRange
        pendingEdits.record(range: NSRange(location: edited.location, length: edited.length - storage.changeInLength), newLength: edited.length)
    }

    func textViewDidChange(_ textView: UITextView) {
        let start = clock.now
        version += 1
        sliceGeneration += 1  // a full pass that is putting colours on stops: the text moved under it
        if hideMode == .substitute || legacyColouring {
            restyle()
        } else {
            recolourAfterEdit()
            scheduleFullPass(after: 0.3)
        }
        updateCompletion()
        let elapsed = ms(clock.now - start)
        stats.lastEditMilliseconds = elapsed
        stats.worstEditMilliseconds = max(stats.worstEditMilliseconds, elapsed)
        editSamples.append(elapsed)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        if restylePending, textView.markedTextRange == nil { restyle() }
        // Hiding follows the caret: only the paragraph it left and the one it entered change.
        guard hideMode == .attributes else { return }
        let line = paragraphRange(around: textView.selectedRange)
        // A code block is shown whole while the caret is in it (see `LiveReveal`).
        let paragraph = model.map { LiveReveal.range(forLine: line, spans: $0.spans(in: line)) } ?? line
        guard model != nil else { return scheduleFullPass(after: 0.3) }  // nothing to follow the caret with yet: the pass that makes it also reveals
        guard paragraph != lastCaretParagraph else { return }
        let left = lastCaretParagraph
        lastCaretParagraph = paragraph
        guard let model, textView.markedTextRange == nil else { return }
        applyColours(to: left, using: model)
        applyColours(to: paragraph, using: model)
    }

    // MARK: Speed test

    /// Types `count` characters one at a time into the middle of the note (`insertText`, the path the keyboard takes), then waits for the
    /// pause's full read to finish, and reports how long each keystroke's own colouring took. The same numbers go to `lab-benchmark.json` in
    /// the app's tmp folder, for a script to read. "Ours" is what the editor does in `textViewDidChange`; "whole" adds what UIKit does to
    /// take the character in.
    func runTypingBenchmark(characters count: Int = 400, gap: Duration = .milliseconds(8)) async -> String {
        let ns = (textView.text ?? "") as NSString
        textView.becomeFirstResponder()
        textView.selectedRange = NSRange(location: ns.paragraphRange(for: NSRange(location: ns.length / 2, length: 0)).location, length: 0)
        editSamples = []
        stats.worstSliceMilliseconds = 0
        var whole: [Double] = []
        let phrase = Array("Typing in the middle of a long note, with **bold** and `code` and a [link](https://x.test).\n")
        for index in 0..<count {
            let started = clock.now
            textView.insertText(String(phrase[index % phrase.count]))
            whole.append(ms(clock.now - started))
            try? await Task.sleep(for: gap)
        }
        try? await Task.sleep(for: .seconds(1.5))  // the pause, and the full read after it
        // Then a fence typed on a line of its own: read alone, the blocks around it cannot tell where it ends, so the pause that follows
        // must find what it swallowed and colour that.
        let correctionsBefore = stats.corrections
        for character in "\n```\n" {
            textView.insertText(String(character))
            try? await Task.sleep(for: gap)
        }
        try? await Task.sleep(for: .seconds(1.5))
        let fence: [String: Any] = [
            "corrections": stats.corrections - correctionsBefore, "charactersPutRight": stats.lastCorrectionCharacters,
            "worstSliceMilliseconds": stats.worstSliceMilliseconds, "sliceTotalMilliseconds": stats.sliceTotalMilliseconds,
        ]
        func summary(_ values: [Double]) -> [String: Double] {
            let sorted = values.sorted()
            guard !sorted.isEmpty else { return [:] }
            return ["median": sorted[sorted.count / 2], "p95": sorted[min(sorted.count - 1, sorted.count * 95 / 100)], "max": sorted[sorted.count - 1]]
        }
        let result: [String: Any] = [
            "build": _isDebugAssertConfiguration() ? "Debug" : "Release",
            "lines": stats.lines, "characters": stats.characters, "views": stats.attachments, "keystrokes": count,
            "ours": summary(editSamples), "whole": summary(whole),
            "fullReadMilliseconds": stats.fullReadMilliseconds, "worstSliceMilliseconds": stats.worstSliceMilliseconds,
            "sliceTotalMilliseconds": stats.sliceTotalMilliseconds, "corrections": stats.corrections,
            "lastCorrectionCharacters": stats.lastCorrectionCharacters,
            "incrementalEdits": stats.incrementalEdits, "fallbackEdits": stats.fallbackEdits, "rereadCharacters": stats.rereadCharacters,
            "fence": fence,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])) ?? Data()
        try? data.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("lab-benchmark.json"))
        let ours = summary(editSamples)
        return String(format: "%d keystrokes: ours median %.2f ms, 95%% %.2f, worst %.2f · whole median %.2f, worst %.2f", count, ours["median"] ?? 0, ours["p95"] ?? 0, ours["max"] ?? 0, summary(whole)["median"] ?? 0, summary(whole)["max"] ?? 0)
    }

    // MARK: Colouring only what was typed

    /// For a change nobody described (views put in by the lab): forget what is known and read it all in the background.
    func recolourEverything() {
        model = nil
        pendingEdits = EditAccumulator()
        version += 1
        sliceGeneration += 1
        refreshCounts()
        scheduleFullPass(after: 0)
    }

    /// After an edit: the blocks around it are read again and coloured, which costs what they hold and not what the note does.
    private func recolourAfterEdit() {
        // Not while a composition (Scribble, dictation, an input method) is under way: the edits wait in `pendingEdits`, and are read as one
        // when it ends.
        guard textView.markedTextRange == nil else { return }
        let storage = textView.textStorage
        guard let merged = pendingEdits.merged, let known = model, known.length - merged.range.length + merged.newLength == storage.length else {
            // An edit nobody told us about (the completion list, a pasted view): the pause that follows reads it all.
            let why = pendingEdits.merged == nil ? "no edit seen" : model == nil ? "no model" : "length \(model!.length) vs \(storage.length) after \(pendingEdits.merged!)"
            if stats.fallbackEdits == 0 { NSLog("[colour] first fallback: \(why)") }
            pendingEdits = EditAccumulator()
            model = nil
            stats.fallbackEdits += 1
            return
        }
        pendingEdits = EditAccumulator()
        stats.incrementalEdits += 1
        let window = model!.edited(replacing: merged.range, withLength: merged.newLength, in: storage.mutableString)
        applyColours(to: window, using: model!)
        stats.rereadCharacters = window.length
        let line = paragraphRange(around: textView.selectedRange)
        lastCaretParagraph = LiveReveal.range(forLine: line, spans: model!.spans(in: line))
    }

    /// Puts the colours of `model` on `range` of the text, and nothing else: it clears what a colour put there before, and sets what the
    /// spans there say. Only attributes change (never the characters, and never `attributedText`, which would drop the selection and the
    /// undo stack).
    private func applyColours(to range: NSRange, using model: HighlightModel) {
        let storage = textView.textStorage
        let range = NSIntersectionRange(range, NSRange(location: 0, length: storage.length))
        guard range.length > 0 else { return }
        let caret = lastCaretParagraph
        storage.beginEditing()
        for key in Self.managedKeys { storage.removeAttribute(key, range: range) }
        storage.addAttributes([.font: Self.baseFont, .foregroundColor: UIColor.label], range: range)
        for span in model.spans(in: range) {
            let clipped = NSIntersectionRange(span.range, range)
            guard clipped.length > 0 else { continue }
            var attrs = attributes(for: span.kind)
            if hideMode == .attributes, span.kind == .mark, NSIntersectionRange(span.range, caret).length == 0 {
                attrs = [.font: Self.hiddenFont, .foregroundColor: UIColor.clear]
            }
            storage.addAttributes(attrs, range: clipped)
        }
        storage.endEditing()
    }

    /// A pause after typing: read the whole note, off the main thread, compare it with what the quick reads made, and put right only what
    /// differs (all of it, when the note has just been loaded).
    private func scheduleFullPass(after delay: TimeInterval) {
        idlePass?.cancel()
        let item = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { self?.runFullPass() } }
        idlePass = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func runFullPass() {
        guard textView.markedTextRange == nil else { return scheduleFullPass(after: 0.3) }  // a composition is under way
        pendingEdits = EditAccumulator()
        let snapshot = textView.text ?? ""
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
                    self.stats.fullReadMilliseconds = self.ms(spent)
                    self.beginPuttingOn(fresh, dirty: dirty, hadModel: known != nil)
                }
            }
        }
    }

    /// Puts the colours on in small steps, so that the main thread is never held for more than a fraction of a frame; typing stops it.
    private func beginPuttingOn(_ fresh: HighlightModel, dirty: [NSRange], hadModel: Bool) {
        let storage = textView.textStorage
        guard fresh.length == storage.length else { return scheduleFullPass(after: 0.3) }
        let ns = storage.mutableString
        var pieces: [NSRange] = []
        for range in dirty {
            var position = range.location
            while position < range.upperBound {
                let end = min(range.upperBound, position + Self.sliceLength)
                // End on a line break where there is one, so that a step never cuts a line in two.
                let line = ns.lineRange(for: NSRange(location: max(end - 1, position), length: 0))
                let stop = min(max(line.upperBound, end), range.upperBound)
                pieces.append(NSRange(location: position, length: stop - position))
                position = stop
            }
        }
        if hadModel { stats.corrections += dirty.isEmpty ? 0 : 1 }
        stats.lastCorrectionCharacters = hadModel ? dirty.reduce(0) { $0 + $1.length } : 0
        stats.spans = fresh.blockCount
        model = fresh
        let line = paragraphRange(around: textView.selectedRange)
        lastCaretParagraph = LiveReveal.range(forLine: line, spans: fresh.spans(in: line))
        sliceGeneration += 1
        stats.sliceTotalMilliseconds = 0
        refreshCounts()
        putOn(pieces, from: 0, using: fresh, generation: sliceGeneration)
    }

    private static let sliceLength = 3_000

    private func putOn(_ pieces: [NSRange], from index: Int, using fresh: HighlightModel, generation: Int) {
        guard index < pieces.count else { return }
        guard generation == sliceGeneration, textView.markedTextRange == nil else {
            // Interrupted: what is on the text is now partly the old colours, so the next full pass starts from nothing.
            model = nil
            return scheduleFullPass(after: 0.3)
        }
        let started = clock.now
        applyColours(to: pieces[index], using: fresh)
        let spent = ms(clock.now - started)
        stats.sliceTotalMilliseconds += spent
        stats.worstSliceMilliseconds = max(stats.worstSliceMilliseconds, spent)
        DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.putOn(pieces, from: index + 1, using: fresh, generation: generation) } }
    }

    // MARK: Hiding the syntax, second way

    private var marks: [NSRange] = []

    private func configureHiding() {
        (textView.textLayoutManager?.textContentManager as? NSTextContentStorage)?.delegate = hideMode == .substitute ? self : nil
    }

    func textContentStorage(_ textContentStorage: NSTextContentStorage, textParagraphWith range: NSRange) -> NSTextParagraph? {
        guard hideMode == .substitute, let storage = textContentStorage.textStorage else { return nil }
        let caret = paragraphRange(around: textView.selectedRange)
        guard NSIntersectionRange(range, caret).length == 0 else { return nil }
        let display = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: range))
        for mark in marks.reversed() where NSIntersectionRange(mark, range).length == mark.length {
            display.deleteCharacters(in: NSRange(location: mark.location - range.location, length: mark.length))
        }
        return NSTextParagraph(attributedString: display)
    }

    // MARK: Completion list at the caret

    private static let components = ["Info", "Warning", "Image", "Drawio", "Toc", "Mark", "Footnotes", "YouTube", "Repo", "Chart"]

    /// After a `<` (and letters), lists the components that fit, just under the caret.
    func updateCompletion() {
        let ns = (textView.text ?? "") as NSString
        let caret = textView.selectedRange.location
        guard textView.selectedRange.length == 0, caret <= ns.length else { return hideCompletion() }
        var i = caret
        while i > 0, CharacterSet.letters.contains(UnicodeScalar(ns.character(at: i - 1)) ?? " ") { i -= 1 }
        guard i > 0, ns.character(at: i - 1) == 0x3C else { return hideCompletion() }  // `<`
        let typed = ns.substring(with: NSRange(location: i, length: caret - i)).lowercased()
        let items = Self.components.filter { $0.lowercased().hasPrefix(typed) }
        guard !items.isEmpty, let end = textView.selectedTextRange?.end else { return hideCompletion() }
        completionItems = items
        let rect = textView.caretRect(for: end)
        let list = completionList ?? CompletionList()
        completionList = list
        list.onPick = { [weak self] name in self?.insertComponent(name, replacing: NSRange(location: i, length: caret - i)) }
        list.show(items, near: rect, in: textView)
    }

    private func hideCompletion() {
        completionItems = []
        completionList?.removeFromSuperview()
    }

    private func insertComponent(_ name: String, replacing range: NSRange) {
        let block = ["Info", "Warning", "Chart"].contains(name)
        let text = block ? "\(name)>\n\n\n\n</\(name)>" : "\(name) />"
        textView.textStorage.replaceCharacters(in: range, with: text)
        textView.selectedRange = NSRange(location: range.location + (block ? name.count + 3 : name.count + 1), length: 0)
        hideCompletion()
        textViewDidChange(textView)
    }

    // MARK: Views inside the text

    /// Puts a view in the line at the caret: a picture, a PencilKit canvas or a SwiftUI panel.
    func insertAttachment(_ kind: LabAttachment.Kind) {
        let attachment = LabAttachment(kind: kind)
        let piece = NSMutableAttributedString(string: "\n")
        piece.append(NSAttributedString(attachment: attachment))
        piece.append(NSAttributedString(string: "\n"))
        piece.addAttributes([.font: Self.baseFont], range: NSRange(location: 0, length: 1))
        textView.textStorage.insert(piece, at: textView.selectedRange.location)
        textViewDidChange(textView)
    }
}

// MARK: - Completion list

private final class CompletionList: UIView {
    var onPick: ((String) -> Void)?
    private let stack = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .secondarySystemBackground
        layer.cornerRadius = 10
        layer.borderWidth = 1
        layer.borderColor = UIColor.separator.cgColor
        layer.shadowOpacity = 0.15
        layer.shadowRadius = 8
        stack.axis = .vertical
        stack.alignment = .fill
        addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 4), stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4), stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ items: [String], near caret: CGRect, in textView: UITextView) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for item in items.prefix(6) {
            var configuration = UIButton.Configuration.plain()
            configuration.title = "<\(item)>"
            configuration.baseForegroundColor = .label
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
            let button = UIButton(configuration: configuration, primaryAction: UIAction { [weak self] _ in self?.onPick?(item) })
            button.contentHorizontalAlignment = .leading
            stack.addArrangedSubview(button)
        }
        let size = CGSize(width: 190, height: CGFloat(min(items.count, 6)) * 34 + 8)
        // Under the caret, or above it when that would run off the bottom of the visible text.
        let visibleBottom = textView.contentOffset.y + textView.bounds.height - textView.adjustedContentInset.bottom
        let below = caret.maxY + 4
        let y = below + size.height > visibleBottom ? max(caret.minY - size.height - 4, textView.contentOffset.y) : below
        let x = min(max(caret.minX, textView.textContainerInset.left), textView.bounds.width - size.width - 8)
        frame = CGRect(origin: CGPoint(x: x, y: y), size: size)
        if superview !== textView { textView.addSubview(self) }
    }
}

// MARK: - Views as text attachments

/// A character in the text that is drawn as a view (TextKit 2's `NSTextAttachmentViewProvider`).
final class LabAttachment: NSTextAttachment {
    enum Kind { case picture, ink, panel }
    let kind: Kind

    init(kind: Kind) {
        self.kind = kind
        super.init(data: nil, ofType: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewProvider(for parentView: UIView?, location: any NSTextLocation, textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = LabViewProvider(textAttachment: self, parentView: parentView, textLayoutManager: textContainer?.textLayoutManager, location: location)
        provider.tracksTextAttachmentViewBounds = true
        return provider
    }
}

private final class LabViewProvider: NSTextAttachmentViewProvider {
    private var kind: LabAttachment.Kind { (textAttachment as? LabAttachment)?.kind ?? .picture }

    override func loadView() {
        // TextKit calls this on the main thread; the base class does not say so.
        let kind = self.kind
        view = MainActor.assumeIsolated { Self.makeView(kind) }
    }

    @MainActor private static func makeView(_ kind: LabAttachment.Kind) -> UIView {
        switch kind {
        case .picture:
            let image = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 160)).image { context in
                let colors = [UIColor.systemTeal.cgColor, UIColor.systemIndigo.cgColor] as CFArray
                let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
                context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 400, y: 160), options: [])
            }
            let view = UIImageView(image: image)
            view.contentMode = .scaleAspectFit
            view.layer.cornerRadius = 8
            view.clipsToBounds = true
            return view
        case .ink:
            let canvas = LabCanvasView()
            canvas.drawingPolicy = .anyInput
            canvas.backgroundColor = .secondarySystemBackground
            canvas.isScrollEnabled = false
            canvas.layer.cornerRadius = 8
            return canvas
        case .panel:
            return UIHostingConfiguration { LabPanel() }.makeContentView()
        }
    }

    override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation, textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        let width = max(min(proposedLineFragment.width - 8, 560), 120)
        switch kind {
        case .picture: return CGRect(x: 0, y: 0, width: width, height: width * 0.4)
        case .ink: return CGRect(x: 0, y: 0, width: width, height: 200)
        case .panel: return CGRect(x: 0, y: 0, width: width, height: 96)
        }
    }
}

/// The lab's ink canvas: a grey box that says so, until something is drawn in it (otherwise nothing tells you it can be drawn in).
private final class LabCanvasView: PKCanvasView, PKCanvasViewDelegate {
    private let hint = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        hint.text = "Ink canvas: draw here with the Pencil"
        hint.font = .preferredFont(forTextStyle: .callout)
        hint.textColor = .secondaryLabel
        hint.textAlignment = .center
        hint.isUserInteractionEnabled = false
        addSubview(hint)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        hint.frame = bounds
    }

    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        hint.isHidden = !drawing.strokes.isEmpty
    }
}

private struct LabPanel: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill").foregroundStyle(Color.accentColor)
            Text("A SwiftUI view inside the text. It is a view, so it is selectable only as one character.").font(.callout)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - SwiftUI

struct EditorTextView: UIViewRepresentable {
    let lab: EditorLab
    func makeUIView(context: Context) -> UITextView { lab.textView }
    func updateUIView(_ view: UITextView, context: Context) {}
}

// MARK: - Lab texts

extension EditorLab {
    /// Puts a view in the text every `lines` lines, from the bottom up so earlier positions stay where they are.
    func addAttachments(everyLines lines: Int) {
        let ns = (textView.text ?? "") as NSString
        var offsets: [Int] = []
        var line = 0
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byLines, .substringNotRequired]) { _, range, _, _ in
            line += 1
            if line % lines == 0 { offsets.append(range.upperBound) }
        }
        let kinds: [LabAttachment.Kind] = [.picture, .panel, .picture, .ink]
        for (index, offset) in offsets.enumerated().reversed() {
            let piece = NSMutableAttributedString(string: "\n")
            piece.append(NSAttributedString(attachment: LabAttachment(kind: kinds[index % kinds.count])))
            textView.textStorage.insert(piece, at: offset)
        }
        recolourEverything()
    }
}

enum LabText {
    static let sample = """
        ---
        title: Editor lab
        tags:
        - spike
        createdAt: 2026-11-06
        ---
        # Editor lab

        Type here. Text with **bold**, *emphasis*, ~~strikethrough~~, `inline code` and a [link](https://example.com).
        Staging resets <Mark color="green">every night</Mark>.

        <Info>

        A panel with a list:

        - back up first
        - then deploy

        </Info>

        > A quote, with `code` in it.

        ## Code

        ```swift
        let greeting = "hello"
        ```

        1. one
        2. two
        - [x] done
        - [ ] todo

        ---

        Things to try: type a `<` at the start of a line to open the completion list; write with the Pencil right in the text (Scribble: it must be on in Settings, Apple Pencil); and choose Insert a view, then Ink canvas, and draw in the grey box that appears.

        """

    /// A note of about `lines` lines made of the sample's kinds of text.
    static func big(lines: Int) -> String {
        var out = ["---", "title: Big note", "---", "# Big note", ""]
        var section = 0
        while out.count < lines {
            out += ["## Section \(section)", "", "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/\(section)) with é and 😀. The rest of this line is plain text to make it long enough to wrap onto a second line on an iPad.", "", "- item one", "- item two", "", "> a quote", "", "```", "let x = \(section)", "```", ""]
            section += 1
        }
        return out.joined(separator: "\n")
    }
}
