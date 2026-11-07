import CompositionCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// What the rest of the screen can ask of the editor's text view: the Find button, and putting pictures in the note.
@MainActor
final class EditorHandle {
    fileprivate weak var textView: NoteTextView?
    /// Where the notes' images are kept, the title the images are named for, and where a problem is shown.
    var location: DataLocation?
    var noteTitle: () -> String = { "" }
    var problem: (String) -> Void = { _ in }

    func presentFind() { textView?.findInteraction?.presentFindNavigator(showingReplace: false) }

    /// Stores each picture and writes the Markdown that shows it at the caret (in place of the selection), as a paste does on the desktop; several go
    /// one to a paragraph. A picture that cannot be stored is reported and left out.
    func insertImages(_ images: [ImageInput]) {
        guard let location, textView != nil, !images.isEmpty else { return }
        let title = noteTitle()
        Task {
            var markdown: [String] = []
            var problems: [String] = []
            for image in images {
                let outcome: Result<String, StoreFailure> = await Task.detached(priority: .userInitiated) {
                    guard let prepared = ImageImport.prepare(image) else { return .failure(StoreFailure(message: "“\(image.fileName)” is not a picture Composition can store.")) }
                    switch StoredImages.store(noteTitle: title, fileName: prepared.fileName, data: prepared.data, in: location) {
                    case .stored(let name): return .success(StoredImages.markdown(forName: name, alt: (prepared.fileName as NSString).deletingPathExtension))
                    case .failed(let message): return .failure(StoreFailure(message: message))
                    }
                }.value
                switch outcome {
                case .success(let line): markdown.append(line)
                case .failure(let failure): problems.append(failure.message)
                }
            }
            if let view = textView, !markdown.isEmpty {
                view.becomeFirstResponder()
                // A picture is never put into the note's frontmatter (a note opens with the caret at the start, which is inside it): it goes just after it.
                let whole = view.nativeText as NSString
                let frontmatterEnd = whole.length - (NoteFrontmatter.parse(whole as String).body as NSString).length
                if view.selectedRange.location < frontmatterEnd { view.selectedRange = NSRange(location: frontmatterEnd, length: 0) }
                let selection = view.selectedRange
                // Each picture is a paragraph of its own: the preview draws a picture that stands alone, and shows only the alt text of one inside a line.
                func newlines(endingAt end: Int) -> Int {
                    var count = 0
                    while count < 2, end - count > 0, whole.character(at: end - count - 1) == 0x0A { count += 1 }
                    return count
                }
                func newlines(startingAt start: Int) -> Int {
                    var count = 0
                    while count < 2, start + count < whole.length, whole.character(at: start + count) == 0x0A { count += 1 }
                    return count
                }
                let atStart = selection.location == 0 || selection.location == frontmatterEnd
                let atEnd = selection.location + selection.length >= whole.length
                let before = atStart ? 2 : newlines(endingAt: selection.location)
                let after = atEnd ? 2 : newlines(startingAt: selection.location + selection.length)
                view.insertText(String(repeating: "\n", count: 2 - before) + markdown.joined(separator: "\n\n") + String(repeating: "\n", count: 2 - after))
            }
            if !problems.isEmpty { problem(problems.joined(separator: "\n")) }
        }
    }

    /// Turns the Markdown images at the caret (or every one the selection touches) into `<Image />` tags, which can say how wide to be: the caret is left
    /// inside the last tag, ready for ` width="50%"`. It goes in as typing does, so undo takes it back in one step.
    func convertImagesToTags() {
        guard let view = textView else { return }
        let selection = view.selectedRange
        guard let edit = MarkdownImages.toMdx(view.nativeText, selectionStart: selection.location, selectionEnd: selection.location + selection.length) else {
            problem("Put the caret in a Markdown image, ![alt](src), or select some, to turn them into <Image /> tags.")
            return
        }
        view.becomeFirstResponder()
        view.selectedRange = NSRange(location: edit.start, length: edit.end - edit.start)
        view.insertText(edit.text)
        view.selectedRange = NSRange(location: edit.start + edit.caret, length: 0)
    }
}

private struct StoreFailure: Error, Sendable { let message: String }

/// A text view whose text keeps to a readable width. Across a whole landscape iPad (1,210 points for an 11-inch) a line of Markdown would be well over a
/// hundred characters, which is hard to read and to write; the text stays about 85 characters wide and sits in the middle, and the empty margins
/// are still part of the view, so a tap or a scroll there works as it does anywhere else. In a narrower view (portrait, or half of Split) nothing changes.
final class NoteTextView: UITextView {
    static let readableWidth: CGFloat = 820
    private static let margin: CGFloat = 12

    /// Pictures pasted from the clipboard go here (set by the editor) instead of the text view's own paste, which has no use for them.
    var pastePictures: (([ImageInput]) -> Void)?

    override func paste(_ sender: Any?) {
        if let pastePictures, let pictures = ImageImport.fromPasteboard() {
            pastePictures(pictures)
        } else {
            super.paste(sender)
        }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(UIResponderStandardEditActions.paste(_:)), pastePictures != nil, UIPasteboard.general.hasImages, !UIPasteboard.general.hasStrings { return true }
        return super.canPerformAction(action, withSender: sender)
    }

    override func layoutSubviews() {
        let side = max(Self.margin, (bounds.width - Self.readableWidth) / 2)
        if abs(textContainerInset.left - side) > 0.5 {
            textContainerInset = UIEdgeInsets(top: 16, left: side, bottom: 16, right: side)
        }
        super.layoutSubviews()
    }
}

/// The Markdown tab (build plan Step 6): a text view on TextKit 2, bound to a note's `NoteSession`. What is typed goes to the session at once and
/// the session saves it (Step 4); the Markdown is coloured as it is typed, a block at a time (Step 5); find is the system's. Two windows on one
/// note share the session, so a change made in the other window shows here. Completion, `[[` links, indenting and the other typing aids are
/// Step 9; the colour schemes, Step 10.
struct NoteEditorView: UIViewRepresentable {
    let session: NoteSession
    let handle: EditorHandle
    /// Where the caret goes when the note opens, in UTF-16 units (the system restores it after the app was ended).
    let initialCaret: Int
    /// A note that was just made: the keyboard comes up at once.
    let focusOnOpen: Bool
    let caretMoved: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(session: session, caretMoved: caretMoved) }

    func makeUIView(context: Context) -> UITextView {
        let view = NoteTextView(usingTextLayoutManager: true)  // TextKit 2. Never touch `layoutManager`: that falls back to TextKit 1.
        view.isFindInteractionEnabled = true
        view.adjustsFontForContentSizeCategory = true
        view.autocapitalizationType = .none
        // Markdown and YAML are damaged by curly quotes and long dashes.
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.smartInsertDeleteType = .no
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        view.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 16, right: 12)
        view.backgroundColor = .systemBackground
        view.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: 16, weight: .regular))
        view.textColor = .label
        view.accessibilityIdentifier = "note-editor"
        view.text = session.text
        view.selectedRange = NSRange(location: min(max(0, initialCaret), (view.text as NSString).length), length: 0)
        view.delegate = context.coordinator
        handle.textView = view
        view.pastePictures = { [weak handle] pictures in handle?.insertImages(pictures) }
        view.addInteraction(UIDropInteraction(delegate: context.coordinator))
        context.coordinator.handle = handle
        context.coordinator.attach(view)
        // The size of the text changed (Settings, Control Centre): the fonts in the colours are stale.
        view.registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { [weak coordinator = context.coordinator] (_: UITextView, _: UITraitCollection) in
            coordinator?.styler?.restyleAll()
        }
        if focusOnOpen { DispatchQueue.main.async { view.becomeFirstResponder() } }
        #if DEBUG || EDITOR_TEST_HOOKS
        // Developer shortcut for scripts: `-pasteImage /path/picture.png` puts that picture in the note as the Photos picker and a paste do.
        if let path = UserDefaults.standard.string(forKey: "pasteImage"), let data = FileManager.default.contents(atPath: path) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak handle] in handle?.insertImages([ImageInput(data: data, fileName: URL(fileURLWithPath: path).lastPathComponent)]) }
        }
        // Developer shortcut for scripts (apps/ios/scripts/autosave-kill-test.sh): `-autotype "text"` types it into the editor.
        if let text = UserDefaults.standard.string(forKey: "autotype") {
            context.coordinator.autotype(text, in: view, interval: UserDefaults.standard.double(forKey: "autotypeInterval"))
        }
        #endif
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) { context.coordinator.caretMoved = caretMoved }

    final class Coordinator: NSObject, UITextViewDelegate, UIDropInteractionDelegate {
        let session: NoteSession
        weak var handle: EditorHandle?
        var caretMoved: (Int) -> Void
        private(set) var styler: MarkdownStyler?
        private weak var textView: UITextView?
        private var observation: NoteSession.Observation?

        init(session: NoteSession, caretMoved: @escaping (Int) -> Void) {
            self.session = session
            self.caretMoved = caretMoved
        }

        func attach(_ view: UITextView) {
            textView = view
            let styler = MarkdownStyler(textView: view)
            self.styler = styler
            styler.reload()
            // Hears every edit of this note, this window's too, which it recognises by the text being the same.
            observation = session.observe { [weak self] text in
                if Thread.isMainThread {
                    MainActor.assumeIsolated { self?.show(text) }
                } else {
                    DispatchQueue.main.async { self?.show(text) }
                }
            }
        }

        /// Another window changed the note: show its text, keeping the caret near where it was.
        @MainActor
        private func show(_ text: String) {
            guard let view = textView, view.nativeText != text else { return }
            let selection = view.selectedRange
            view.text = text
            view.selectedRange = NSRange(location: min(selection.location, (text as NSString).length), length: 0)
            styler?.reload()
        }

        func textViewDidChange(_ textView: UITextView) {
            #if DEBUG || EDITOR_TEST_HOOKS
            let started = ContinuousClock.now
            defer { delegateMilliseconds.append(Double((ContinuousClock.now - started).components.attoseconds) / 1e15) }
            #endif
            #if DEBUG || EDITOR_TEST_HOOKS
            let t0 = ContinuousClock.now
            let text = textView.nativeText
            let t1 = ContinuousClock.now
            session.edit(text, from: observation)
            let t2 = ContinuousClock.now
            styler?.textDidChange()
            let t3 = ContinuousClock.now
            func ms(_ d: Duration) -> Double { Double(d.components.attoseconds) / 1e15 }
            partMilliseconds.append((ms(t1 - t0), ms(t2 - t1), ms(t3 - t2)))
            #else
            session.edit(textView.nativeText, from: observation)
            styler?.textDidChange()
            #endif
        }

        // MARK: Pictures dropped on the text

        func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
            session.hasItemsConforming(toTypeIdentifiers: [UTType.image.identifier]) && !session.hasItemsConforming(toTypeIdentifiers: [UTType.text.identifier])
        }

        func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal { UIDropProposal(operation: .copy) }

        func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
            guard let view = textView else { return }
            // The picture goes where it was dropped.
            if let position = view.closestPosition(to: session.location(in: view)) { view.selectedTextRange = view.textRange(from: position, to: position) }
            let providers = session.items.map(\.itemProvider)
            Task { @MainActor [weak self] in
                var pictures: [ImageInput] = []
                for provider in providers {
                    let data: Data? = await withCheckedContinuation { continuation in
                        _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in continuation.resume(returning: data) }
                    }
                    if let data { pictures.append(ImageInput(data: data, fileName: provider.suggestedName ?? "image")) }
                }
                self?.handle?.insertImages(pictures)
            }
        }

        #if DEBUG || EDITOR_TEST_HOOKS
        /// How long the whole `textViewDidChange` took each time (the session's part and the colouring's), for the speed test.
        private var delegateMilliseconds: [Double] = []
        private var partMilliseconds: [(text: Double, session: Double, styler: Double)] = []
        #endif

        func textViewDidChangeSelection(_ textView: UITextView) { caretMoved(textView.selectedRange.location) }

        /// Leaving the field is a good moment to write: it is cheap, and the keyboard going away often means the app is too.
        func textViewDidEndEditing(_ textView: UITextView) { session.autosaver.flush() }

        #if DEBUG || EDITOR_TEST_HOOKS
        /// Inserts `text` at the end of the note one character at a time, as the keyboard does (`insertText` calls the delegate), and leaves
        /// marker files in the app's tmp folder for the script that is watching: `autotype.progress` (characters so far), `autotype.done`, and
        /// `autotype.stats`, what the colouring measured.
        @MainActor
        func autotype(_ text: String, in view: UITextView, interval: Double) {
            let characters = Array(text)
            let step = interval > 0 ? interval : 0.02
            Task { @MainActor in
                for name in ["autotype.progress", "autotype.done", "autotype.stats"] { try? FileManager.default.removeItem(atPath: NSTemporaryDirectory() + name) }
                try? await Task.sleep(for: .seconds(1))  // the note is on screen and has the keyboard by now
                view.becomeFirstResponder()
                let whole = view.text as NSString
                // At the end of the note, or (`-autotypeMiddle 1`) at the start of a paragraph in the middle of it.
                let at = UserDefaults.standard.bool(forKey: "autotypeMiddle") ? whole.paragraphRange(for: NSRange(location: whole.length / 2, length: 0)).location : whole.length
                view.selectedRange = NSRange(location: at, length: 0)
                for (index, character) in characters.enumerated() {
                    view.insertText(String(character))
                    Self.marker("autotype.progress", "\(index + 1)")
                    try? await Task.sleep(for: .seconds(step))
                }
                Self.marker("autotype.done", "\(characters.count)")
                if let styler {
                    let m = styler.measurements, sorted = m.editMilliseconds.sorted()
                    let delegate = delegateMilliseconds.sorted()
                    let stats = "quick \(m.quickEdits) fallback \(m.fallbackEdits) corrections \(m.corrections) colouring-median \(sorted.isEmpty ? 0 : sorted[sorted.count / 2]) colouring-worst \(sorted.last ?? 0) delegate-median \(delegate.isEmpty ? 0 : delegate[delegate.count / 2]) delegate-p95 \(delegate.isEmpty ? 0 : delegate[delegate.count * 95 / 100]) delegate-worst \(delegate.last ?? 0) fullRead \(m.fullReadMilliseconds) worstStep \(m.worstStepMilliseconds)"
                    func median(_ values: [Double]) -> Double { values.sorted()[values.count / 2] }
                    let parts = partMilliseconds.isEmpty ? "" : " | text \(median(partMilliseconds.map(\.text))) session.edit \(median(partMilliseconds.map(\.session))) styler \(median(partMilliseconds.map(\.styler)))"
                    Self.marker("autotype.stats", stats + parts)
                }
            }
        }

        private static func marker(_ name: String, _ content: String) {
            try? content.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name), atomically: true, encoding: .utf8)
        }
        #endif
    }
}
