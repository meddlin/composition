import Foundation

/// Reflow in the live editor, as in the plain one: a line that typing has pushed past the column is broken there. Only typing does it (a character, or a
/// word an autocorrect puts in); pasting, dropping, deleting, undoing, Enter and composing leave the text as it is. A port of the decision in the desktop's
/// `liveReflow.ts`, which is a CodeMirror transaction filter; the breaks themselves are `ReflowText.reflowAtCaret`'s.
public enum LiveReflow {
    /// What caused a change to the text: the desktop's CodeMirror user events, which `isUserEvent` matches by name and by every name beneath it.
    public enum Event: Equatable, Sendable {
        /// `input.type`: keystrokes, and what an autocorrect types.
        case typing
        /// `input.type.compose`: an input method is mid-word (a Japanese or Chinese keyboard, an accent not yet finished). The text is left alone until it ends.
        case composing
        /// Pasting, dropping, deleting, undoing, a return, or no event at all.
        case other

        public init(userEvent: String?) {
            func matches(_ event: String, _ name: String) -> Bool { event == name || event.hasPrefix(name + ".") }
            guard let userEvent, matches(userEvent, "input.type") else {
                self = .other
                return
            }
            self = matches(userEvent, "input.type.compose") ? .composing : .typing
        }
    }

    /// One change to a text: the stretch `from..<to` (UTF-16 offsets) became `insert`.
    public struct Change: Equatable, Sendable {
        public var from: Int
        public var to: Int
        public var insert: String

        public init(from: Int, to: Int, insert: String) { (self.from, self.to, self.insert) = (from, to, insert) }
    }

    /// What the text and the caret become if reflow breaks the line the change left the caret on, or nil when the change is to stand as it is:
    /// it was not typing, it brought a new line in with it, or the caret's line still fits.
    ///
    /// `doc` is the text before the change; `caret` is where the caret is after it (the end of what was typed, in a keystroke).
    public static func edit(applying change: Change, to doc: String, caret: Int, event: Event, options: ReflowOptions) -> ReflowEdit? {
        let before = Array(doc.utf16)
        let from = min(max(change.from, 0), before.count), to = min(max(change.to, from), before.count)
        let after = Array(before[0..<from]) + Array(change.insert.utf16) + Array(before[to...])
        return edit(typed: change.insert, into: String(decoding: after, as: UTF16.self), caret: caret, event: event, options: options)
    }

    /// The same, for a text view that has already made the change: `text` is the text after it, `typed` what was inserted, and `caret` where the caret is now.
    public static func edit(typed: String, into text: String, caret: Int, event: Event, options: ReflowOptions) -> ReflowEdit? {
        guard event == .typing else { return nil }
        // `inserted.lines > 1`: a line break in what was typed (a pasted paragraph, a return) is not reflowed.
        if typed.utf16.contains(where: { $0 == 0x0A || $0 == 0x0D }) { return nil }

        let after = Array(text.utf16)
        let head = min(max(caret, 0), after.count)

        // The usual keystroke is nowhere near the column, and that is settled without reading the whole note.
        var lineStart = head
        while lineStart > 0, after[lineStart - 1] != 0x0A { lineStart -= 1 }
        var lineEnd = head
        while lineEnd < after.count, after[lineEnd] != 0x0A { lineEnd += 1 }
        if lineEnd - lineStart <= options.column { return nil }

        return ReflowText.reflowAtCaret(text, caret: head, options: options)
    }
}
