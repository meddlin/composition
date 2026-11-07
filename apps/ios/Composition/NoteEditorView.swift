import CompositionCore
import SwiftUI
import UIKit

/// A plain text view on a note's `NoteSession` (build plan Step 4, spike S6): what is typed goes to the session at once, and the
/// session saves it. There is no colouring, no completion and nothing else yet; the real editor (Step 6) is built on the lab's
/// text view and keeps this wiring. Two windows on one note share the session, so a change made in the other window shows here.
struct NoteEditorView: UIViewRepresentable {
    let session: NoteSession
    /// Where the caret goes when the note opens, in UTF-16 units (the system restores it after the app was ended).
    let initialCaret: Int
    let caretMoved: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(session: session, caretMoved: caretMoved) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: 16, weight: .regular))
        view.adjustsFontForContentSizeCategory = true
        view.autocapitalizationType = .none
        // Markdown and YAML are damaged by curly quotes and long dashes.
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.smartInsertDeleteType = .no
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        view.accessibilityIdentifier = "note-editor"
        view.text = session.text
        view.selectedRange = NSRange(location: min(max(0, initialCaret), (view.text as NSString).length), length: 0)
        view.delegate = context.coordinator
        context.coordinator.attach(view)
        DispatchQueue.main.async { view.becomeFirstResponder() }
        #if DEBUG
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
        private weak var textView: UITextView?
        private var observation: NoteSession.Observation?

        init(session: NoteSession, caretMoved: @escaping (Int) -> Void) {
            self.session = session
            self.caretMoved = caretMoved
        }

        func attach(_ view: UITextView) {
            textView = view
            // Hears every edit of this note, this window's too, which it recognises by the text being the same.
            observation = session.observe { [weak self] text in
                if Thread.isMainThread {
                    MainActor.assumeIsolated { self?.show(text) }
                } else {
                    DispatchQueue.main.async { self?.show(text) }
                }
            }
        }

        @MainActor
        private func show(_ text: String) {
            guard let view = textView, view.text != text else { return }
            let selection = view.selectedRange
            view.text = text
            let length = (text as NSString).length
            view.selectedRange = NSRange(location: min(selection.location, length), length: 0)
        }

        #if DEBUG
        /// Inserts `text` at the end of the note one character at a time, as the keyboard does (`insertText` calls the delegate), and
        /// leaves marker files in the app's tmp folder for the script that is watching: `autotype.progress` (characters so far) and
        /// `autotype.done`.
        @MainActor
        func autotype(_ text: String, in view: UITextView, interval: Double) {
            let characters = Array(text)
            let step = interval > 0 ? interval : 0.02
            Task { @MainActor in
                for name in ["autotype.progress", "autotype.done"] { try? FileManager.default.removeItem(atPath: NSTemporaryDirectory() + name) }
                try? await Task.sleep(for: .seconds(1))  // the note is on screen and has the keyboard by now
                view.becomeFirstResponder()
                view.selectedRange = NSRange(location: (view.text as NSString).length, length: 0)
                for (index, character) in characters.enumerated() {
                    view.insertText(String(character))
                    Self.marker("autotype.progress", "\(index + 1)")
                    try? await Task.sleep(for: .seconds(step))
                }
                Self.marker("autotype.done", "\(characters.count)")
            }
        }

        private static func marker(_ name: String, _ content: String) {
            try? content.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name), atomically: true, encoding: .utf8)
        }
        #endif

        func textViewDidChange(_ textView: UITextView) { session.edit(textView.text) }

        func textViewDidChangeSelection(_ textView: UITextView) { caretMoved(textView.selectedRange.location) }

        /// Leaving the field is a good moment to write: it is cheap, and the keyboard going away often means the app is too.
        func textViewDidEndEditing(_ textView: UITextView) { session.autosaver.flush() }
    }
}
