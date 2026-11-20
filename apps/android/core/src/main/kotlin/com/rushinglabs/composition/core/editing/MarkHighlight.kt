package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.NoteFrontmatter
import com.rushinglabs.composition.core.markdown.insideFence
import com.rushinglabs.composition.core.yaml.JavaScriptText

/**
 * Highlighting words in a note with `<Mark color="…">…</Mark>`, ported from MarkHighlight.swift. This is a **smaller** rule than the
 * desktop's `highlightText.ts`, which reads the note as MDX and puts a pair of tags around every run of plain text a selection touches, so
 * it can cross formatting and paragraphs. Here the selection must be plain words on one line: nothing that Markdown or MDX would read as
 * something else, so that a pair of tags can never change how the rest of the note is read. A selection that is not that is refused with
 * the reason, and the person selects less. There is no oracle for it (the desktop does more); the tests say what it does.
 */
object MarkHighlight {
    val colors: List<String> = MdxProps.highlightColors
    const val DEFAULT_COLOR = "yellow"

    enum class Refusal(val message: String) {
        NOTHING_SELECTED("Select some words to highlight."),
        ACROSS_LINES("Highlight one line at a time: select words that are all on one line."),
        IN_FRONTMATTER("The frontmatter at the top of the note can't be highlighted."),
        IN_CODE("Code can't be highlighted."),
        IN_TAG("Text inside a tag can't be highlighted."),
        HAS_MARKUP("Select just the words, without the marks around them (such as * _ ` [ ] < > { } \\ and &), then highlight."),
    }

    /** What highlighting came to: the edit, or why not. */
    sealed interface Outcome {
        data class Edit(val edit: LineEdit) : Outcome
        data class Refused(val refusal: Refusal) : Outcome
    }

    /** A highlight already in the note: the whole `<Mark …>…</Mark>` and the words inside it, as `[start, end)` in UTF-16 units. */
    data class Existing(val start: Int, val end: Int, val innerStart: Int, val innerEnd: Int, val color: String)

    // The marks a note can hold: the tag the editor writes (a colour, or none).
    private val pair = Regex("""<Mark(?: color="([a-z]*)")?>([^<\n]*)</Mark>""")
    private const val FORBIDDEN = "`*_[]<>{}\\&"

    /** Swift's `Character.isNewline`. */
    private fun isNewline(c: Char) = c == '\n' || c == '\r' || c == '\u000B' || c == '\u000C' || c == '\u0085' || c == '\u2028' || c == '\u2029'

    private fun lineRange(text: String, offset: Int): IntRange {
        val start = JS.lineStart(text, offset)
        val newline = JS.index('\n', text, offset)
        return start until (if (newline == -1) text.length else newline)
    }

    /** The highlight `[start, end)` sits inside, if any (on the line it is on). */
    fun existing(text: String, start: Int, end: Int): Existing? {
        if (start < 0 || end > text.length) return null
        val line = lineRange(text, start)
        val lineText = if (line.isEmpty()) "" else text.substring(line.first, line.last + 1)
        for (match in pair.findAll(lineText)) {
            val wholeStart = line.first + match.range.first
            val wholeEnd = line.first + match.range.last + 1
            if (wholeStart > start || end > wholeEnd) continue
            val inner = match.groups[2]!!.range
            val color = match.groups[1]?.value ?: DEFAULT_COLOR
            val innerStart = line.first + inner.first
            return Existing(wholeStart, wholeEnd, innerStart, innerStart + match.groupValues[2].length, color)
        }
        return null
    }

    /** The edit that highlights the selected words in `color`, or (when they are already highlighted) changes the colour; or why not. */
    fun highlight(text: String, start: Int, end: Int, color: String): Outcome {
        if (color !in colors) return Outcome.Refused(Refusal.HAS_MARKUP)
        if (end > text.length || start < 0 || start >= end) return Outcome.Refused(Refusal.NOTHING_SELECTED)
        val open = "<Mark color=\"$color\">"
        existing(text, start, end)?.let { mark ->
            val selectionStart = mark.start + open.length
            val words = text.substring(mark.innerStart, mark.innerEnd)
            return Outcome.Edit(LineEdit(mark.start, mark.end, "$open$words</Mark>", selectionStart, selectionStart + words.length))
        }
        val selected = text.substring(start, end)
        val trimmed = JavaScriptText.trim(selected)
        if (trimmed.isEmpty()) return Outcome.Refused(Refusal.NOTHING_SELECTED)
        if (selected.any(::isNewline)) return Outcome.Refused(Refusal.ACROSS_LINES)
        val frontmatterEnd = text.length - NoteFrontmatter.parse(text).second.length
        if (start < frontmatterEnd) return Outcome.Refused(Refusal.IN_FRONTMATTER)
        if (trimmed.any { it in FORBIDDEN }) return Outcome.Refused(Refusal.HAS_MARKUP)

        // The words' place in the line: not in code (a fence, an indented block, a code span) and not inside a tag.
        val lineStart = JS.lineStart(text, start)
        val before = JS.slice(text, lineStart, start)
        if (insideFence(text, lineStart) || before.startsWith("    ") || before.startsWith("\t") || before.count { it == '`' } % 2 == 1) {
            return Outcome.Refused(Refusal.IN_CODE)
        }
        val line = lineRange(text, start).let { if (it.isEmpty()) "" else text.substring(it.first, it.last + 1) }
        if (line.startsWith("```") || line.startsWith("~~~")) return Outcome.Refused(Refusal.IN_CODE)
        val tagOpen = before.lastIndexOf('<')
        if (tagOpen >= 0 && before.indexOf('>', tagOpen) < 0) return Outcome.Refused(Refusal.IN_TAG)

        val wordsStart = start + maxOf(selected.indexOf(trimmed), 0)
        val selectionStart = wordsStart + open.length
        return Outcome.Edit(LineEdit(wordsStart, wordsStart + trimmed.length, "$open$trimmed</Mark>", selectionStart, selectionStart + trimmed.length))
    }

    /** The edit that takes the highlight `[start, end)` sits inside off, leaving its words; null when it sits in none. */
    fun remove(text: String, start: Int, end: Int): LineEdit? {
        val mark = existing(text, start, end) ?: return null
        val words = text.substring(mark.innerStart, mark.innerEnd)
        return LineEdit(mark.start, mark.end, words, mark.start, mark.start + words.length)
    }
}
