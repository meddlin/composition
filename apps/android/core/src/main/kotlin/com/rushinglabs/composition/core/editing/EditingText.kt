package com.rushinglabs.composition.core.editing

// The typing aids. Their rules are the desktop's (`completions.ts`, `props.ts`, `frontmatterProps.ts`, `snippets.ts`, `indentLines.ts`,
// `emphasis.ts`, `noteLinks.ts`), ported from the iPad's Editing folder and written to give the same answer for every text and caret;
// EditingConformanceTests holds them against the real functions. Offsets are UTF-16 units, as in the desktop's JavaScript and in a
// Kotlin `String`.

/**
 * An edit to a note: `[start, end)` of the text is swapped for `text`, and the selection afterwards is `[selectionStart, selectionEnd)`
 * (the desktop's `IndentEdit`). Offsets are UTF-16 units.
 */
data class LineEdit(val start: Int, val end: Int, val text: String, val selectionStart: Int, val selectionEnd: Int) {
    /** The note with the edit made. */
    fun applied(to: String): String = to.substring(0, start) + text + to.substring(end)
}

/** The few JavaScript string behaviours the ports lean on, so that an offset means the same on both sides. */
internal object JS {
    /** `text.slice(start, end)`: both ends clamped (a negative one counts from the end), and empty when `start >= end`. */
    fun slice(text: String, start: Int, end: Int = text.length): String {
        val length = text.length
        fun clamp(value: Int) = if (value < 0) maxOf(length + value, 0) else minOf(value, length)
        val from = clamp(start)
        val to = clamp(end)
        return if (from >= to) "" else text.substring(from, to)
    }

    /** `text.lastIndexOf(char, from)`: the last index at or before `from` (a negative `from` is 0, so position 0 is still looked at), or -1. */
    fun lastIndex(of: Char, text: String, from: Int): Int {
        var index = minOf(maxOf(from, 0), text.length - 1)
        while (index >= 0) {
            if (text[index] == of) return index
            index--
        }
        return -1
    }

    /** `text.indexOf(char, from)`. */
    fun index(of: Char, text: String, from: Int = 0): Int {
        var index = maxOf(from, 0)
        while (index < text.length) {
            if (text[index] == of) return index
            index++
        }
        return -1
    }

    /**
     * Where the line a caret is on starts: `text.lastIndexOf("\n", caret - 1) + 1`. With the caret at 0 on a text that starts with a line
     * break this is 1, past the caret, as in JavaScript; read it with `slice`, which makes that stretch empty.
     */
    fun lineStart(text: String, caret: Int): Int = lastIndex('\n', text, caret - 1) + 1

    /** JavaScript's `\w`, which is ASCII. */
    fun isWordUnit(c: Char): Boolean = c in '0'..'9' || c in 'A'..'Z' || c in 'a'..'z' || c == '_'
}
