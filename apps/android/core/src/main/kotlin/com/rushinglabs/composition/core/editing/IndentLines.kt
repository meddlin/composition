package com.rushinglabs.composition.core.editing

/** Indenting and outdenting the lines under the selection, the way a code editor does: a port of `indentLines.ts`, from IndentLines.swift. */
object IndentLines {
    enum class Command(val rawValue: String) {
        INDENT("indent"), OUTDENT("outdent");

        companion object {
            fun of(rawValue: String): Command? = entries.firstOrNull { it.rawValue == rawValue }
        }
    }

    /** The width of the leading spaces one outdent takes off a line that is indented with spaces, not a tab. */
    private const val SPACE_INDENT = 4

    /** How many characters an outdent takes off the front of `line`: a tab, or up to four spaces. */
    private fun outdentWidth(line: String): Int {
        if (line.firstOrNull() == '\t') return 1
        var width = 0
        while (width < SPACE_INDENT && width < line.length && line[width] == ' ') width++
        return width
    }

    private class Line(val offset: Int, val delta: Int, val text: String)

    /**
     * Indents or outdents every line the selection touches: a selection that ends at the very start of a line does not touch that line, an
     * empty line is not indented, and the selection stays on the same text. Null when nothing would change.
     */
    fun edit(text: String, from: Int, to: Int, command: Command): LineEdit? {
        val start = JS.lastIndex('\n', text, from - 1) + 1
        val lastChar = if (to > from && to - 1 >= 0 && to - 1 < text.length && text[to - 1] == '\n') to - 1 else to
        val found = JS.index('\n', text, maxOf(lastChar, 0))
        val end = if (found == -1) text.length else found

        // Each line, and by how much its front grows (or, below zero, shrinks).
        val lines = ArrayList<Line>()
        var offset = start
        val slice = if (start >= end) "" else text.substring(start, end)
        for (line in slice.split('\n')) {
            val delta = if (command == Command.INDENT) (if (line.isEmpty()) 0 else 1) else -outdentWidth(line)
            lines.add(Line(offset, delta, line))
            offset += line.length + 1
        }
        if (lines.all { it.delta == 0 }) return null

        val out = StringBuilder()
        for ((index, item) in lines.withIndex()) {
            if (index > 0) out.append('\n')
            if (item.delta > 0) out.append('\t').append(item.text) else out.append(item.text, -item.delta, item.text.length)
        }

        // Where a position of the old text lands: past the edits before it, and (for a caret inside the front of a line that lost it) no
        // further back than the line's start. A position at a line's start stays there on indent.
        fun move(position: Int): Int {
            var shift = 0
            for (item in lines) {
                if (position < item.offset) break
                val column = position - item.offset
                shift += when {
                    position > item.offset + item.text.length -> item.delta
                    item.delta > 0 -> if (column > 0) item.delta else 0
                    else -> maxOf(item.delta, -column)
                }
            }
            return position + shift
        }
        return LineEdit(start, end, out.toString(), move(from), move(to))
    }
}
