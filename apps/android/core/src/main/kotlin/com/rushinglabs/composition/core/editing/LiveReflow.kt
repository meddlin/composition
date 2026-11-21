package com.rushinglabs.composition.core.editing

/**
 * Reflow in the live editor, as in the plain one: a line that typing has pushed past the column is broken there. Only typing does it (a
 * character, or a word an autocorrect puts in); pasting, dropping, deleting, undoing, Enter and composing leave the text as it is. A port
 * of the decision in the desktop's `liveReflow.ts` (through LiveReflow.swift), which is a CodeMirror transaction filter; the breaks
 * themselves are `ReflowText.reflowAtCaret`'s.
 */
object LiveReflow {
    /** What caused a change to the text: the desktop's CodeMirror user events, which `isUserEvent` matches by name and by every name beneath it. */
    enum class Event {
        /** `input.type`: keystrokes, and what an autocorrect types. */
        TYPING,

        /** `input.type.compose`: an input method is mid-word (a Japanese or Chinese keyboard, an accent not yet finished). The text is left alone until it ends. */
        COMPOSING,

        /** Pasting, dropping, deleting, undoing, a return, or no event at all. */
        OTHER;

        companion object {
            fun of(userEvent: String?): Event {
                fun matches(event: String, name: String) = event == name || event.startsWith("$name.")
                if (userEvent == null || !matches(userEvent, "input.type")) return OTHER
                return if (matches(userEvent, "input.type.compose")) COMPOSING else TYPING
            }
        }
    }

    /** One change to a text: the stretch `from until to` (UTF-16 offsets) became `insert`. */
    data class Change(val from: Int, val to: Int, val insert: String)

    /**
     * What the text and the caret become if reflow breaks the line the change left the caret on, or null when the change is to stand as
     * it is: it was not typing, it brought a new line in with it, or the caret's line still fits.
     *
     * `doc` is the text before the change; `caret` is where the caret is after it (the end of what was typed, in a keystroke).
     */
    fun edit(applying: Change, doc: String, caret: Int, event: Event, options: ReflowOptions): ReflowEdit? {
        val from = applying.from.coerceIn(0, doc.length)
        val to = applying.to.coerceIn(from, doc.length)
        val after = doc.substring(0, from) + applying.insert + doc.substring(to)
        return edit(applying.insert, after, caret, event, options)
    }

    /** The same, for a text view that has already made the change: `text` is the text after it, `typed` what was inserted, and `caret` where the caret is now. */
    fun edit(typed: String, text: String, caret: Int, event: Event, options: ReflowOptions): ReflowEdit? {
        if (event != Event.TYPING) return null
        // `inserted.lines > 1`: a line break in what was typed (a pasted paragraph, a return) is not reflowed.
        if (typed.any { it == '\n' || it == '\r' }) return null

        val head = caret.coerceIn(0, text.length)

        // The usual keystroke is nowhere near the column, and that is settled without reading the whole note.
        var lineStart = head
        while (lineStart > 0 && text[lineStart - 1] != '\n') lineStart--
        var lineEnd = head
        while (lineEnd < text.length && text[lineEnd] != '\n') lineEnd++
        if (lineEnd - lineStart <= options.column) return null

        return ReflowText.reflowAtCaret(text, head, options)
    }
}
