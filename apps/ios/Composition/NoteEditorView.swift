import CompositionCore
import SwiftUI
import UIKit

/// What the rest of the screen can ask of the editor's text view: the Find button.
@MainActor
final class EditorHandle {
    fileprivate weak var textView: UITextView?

    func presentFind() { textView?.findInteraction?.presentFindNavigator(showingReplace: false) }
}

/// A text view whose text keeps to a readable width. Across a whole landscape iPad (1,210 points for an 11-inch) a line of Markdown would be well over a
/// hundred characters, which is hard to read and to write; the text stays about 85 characters wide and sits in the middle, and the empty margins
/// are still part of the view, so a tap or a scroll there works as it does anywhere else. In a narrower view (portrait, or half of Split) nothing changes.
final class NoteTextView: UITextView {
    static let readableWidth: CGFloat = 820
    private static let margin: CGFloat = 12

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
        context.coordinator.attach(view)
        // The size of the text changed (Settings, Control Centre): the fonts in the colours are stale.
        view.registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { [weak coordinator = context.coordinator] (_: UITextView, _: UITraitCollection) in
            coordinator?.styler?.restyleAll()
        }
        if focusOnOpen { DispatchQueue.main.async { view.becomeFirstResponder() } }
        #if DEBUG || EDITOR_TEST_HOOKS
        // Developer shortcut for scripts (apps/ios/scripts/autosave-kill-test.sh): `-autotype "text"` types it into the editor.
        if let text = UserDefaults.standard.string(forKey: "autotype") {
            context.coordinator.autotype(text, in: view, interval: UserDefaults.standard.double(forKey: "autotypeInterval"))
        }
        #endif
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) { context.coordinator.caretMoved = caretMoved }

    final class Coordinator: NSObject, UITextViewDelegate {
        let session: NoteSession
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
