package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.yaml.JavaScriptText

// Breaking a line that has grown past a column, for the editor's reflow setting: a port of the desktop's `reflowText.ts` (through
// ReflowText.swift), checked against it by `ReflowConformanceTests` over fixtures/conformance/reflow.json.
//
// This works on the line being typed, the way a plain-text editor's auto-wrap does: it moves the words past the column onto a new line
// and leaves every other line alone. Lines whose shape matters to Markdown are never broken: frontmatter, code, headings, HTML and JSX,
// and (unless told otherwise) table rows. A continuation line keeps the line's indent and any `>` quote marks, and sits under the text
// of a list item rather than under its bullet.
//
// Offsets are UTF-16 units, as JavaScript counts them and as a Kotlin `String` does, and what counts as white space is JavaScript's,
// not Unicode's: U+FEFF is white space here and U+0085 is not.

data class ReflowOptions(
    /** The most characters a line may hold. */
    val column: Int,
    /** Leave table rows whole. */
    val keepTables: Boolean,
)

/** The text after a break, and where the caret is in it. */
data class ReflowEdit(val text: String, val caret: Int)

/** The stretch of one text that turned into `insert` to make another (UTF-16 offsets). */
data class ReflowSpan(val start: Int, val end: Int, val insert: String)

object ReflowText {
    // JavaScript's character classes

    /** `\s`, `trim()`, `trimStart()` and `trimEnd()`: JavaScript's white space and line terminators. */
    private fun isSpace(c: Char) = JavaScriptText.isWhitespace(c.code)

    private fun isSpaceOrTab(c: Char) = c == ' ' || c == '\t'

    private fun trimmed(line: String, start: Boolean = true, end: Boolean = true): String {
        var from = 0
        var to = line.length
        if (start) while (from < to && isSpace(line[from])) from++
        if (end) while (to > from && isSpace(line[to - 1])) to--
        return line.substring(from, to)
    }

    // The shapes of a line

    /**
     * `PREFIX`: leading white space and quote marks, then an optional list marker (and task checkbox). `lead` is the white space and
     * quote marks, `bulletEnd` is where the marker ends before any checkbox, and `end` where the whole prefix does.
     */
    private class Prefix(val lead: Int, val bulletEnd: Int, val end: Int, val hasMarker: Boolean)

    private fun prefix(line: String): Prefix {
        val n = line.length
        var i = 0
        while (i < n && isSpace(line[i])) i++
        while (i < n && line[i] == '>') {
            i++
            while (i < n && isSpaceOrTab(line[i])) i++
        }
        val lead = i
        val none = Prefix(lead, lead, lead, false)

        // `(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?`
        var k = i
        if (k < n && (line[k] == '-' || line[k] == '*' || line[k] == '+')) {
            k++
        } else {
            var digits = 0
            while (k < n && digits < 9 && line[k] in '0'..'9') {
                k++
                digits++
            }
            if (digits < 1 || k >= n || !(line[k] == '.' || line[k] == ')')) return none
            k++
        }
        var m = k
        while (m < n && isSpaceOrTab(line[m])) m++
        if (m <= k) return none
        val bulletEnd = m
        // The optional task checkbox: `[ ]`, `[x]` or `[X]`, then at least one space or tab.
        if (m + 2 < n && line[m] == '[' && (line[m + 1] == ' ' || line[m + 1] == 'x' || line[m + 1] == 'X') && line[m + 2] == ']') {
            var after = m + 3
            while (after < n && isSpaceOrTab(line[after])) after++
            if (after > m + 3) return Prefix(lead, bulletEnd, after, true)
        }
        return Prefix(lead, bulletEnd, bulletEnd, true)
    }

    /** `FENCE`: up to three white-space characters, then three or more of one fence character. Returns the run of it. */
    private fun fence(line: String): String? {
        val n = line.length
        var i = 0
        while (i < n && i < 3 && isSpace(line[i])) i++
        if (i >= n || !(line[i] == '`' || line[i] == '~')) return null
        val character = line[i]
        var j = i
        while (j < n && line[j] == character) j++
        return if (j - i >= 3) line.substring(i, j) else null
    }

    /** `HEADING`: up to three white-space characters, one to six `#`, then white space or the end. */
    private fun isHeading(line: String): Boolean {
        val n = line.length
        var i = 0
        while (i < n && i < 3 && isSpace(line[i])) i++
        var hashes = 0
        while (i < n && line[i] == '#') {
            i++
            hashes++
        }
        if (hashes !in 1..6) return false
        return i == n || isSpace(line[i])
    }

    /** `TABLE_DELIMITER`: `^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$`, as a scan. */
    private fun isDelimiterRow(line: String): Boolean {
        val n = line.length
        if ('|' !in line) return false
        var i = 0
        fun skipSpace() {
            while (i < n && isSpace(line[i])) i++
        }
        // `:?-+:?\s*`
        fun cell(): Boolean {
            var j = i
            if (j < n && line[j] == ':') j++
            if (j >= n || line[j] != '-') return false
            while (j < n && line[j] == '-') j++
            if (j < n && line[j] == ':') j++
            i = j
            skipSpace()
            return true
        }
        skipSpace()
        if (i < n && line[i] == '|') i++
        skipSpace()
        if (!cell()) return false
        while (i < n && line[i] == '|') {
            val before = i
            i++
            skipSpace()
            if (!cell()) {
                i = before
                break
            }
        }
        if (i < n && line[i] == '|') i++
        skipSpace()
        return i == n
    }

    /** Whether line `i` is inside the frontmatter block at the top of the note. */
    private fun inFrontmatter(lines: List<String>, i: Int): Boolean {
        if (trimmed(lines[0], start = false) != "---") return false
        val close = lines.indices.firstOrNull { it > 0 && trimmed(lines[it], start = false) == "---" } ?: return true
        return i <= close
    }

    /** Whether line `i` is a code fence or sits between a fence's opening and closing lines. */
    private fun inFence(lines: List<String>, i: Int): Boolean {
        var open: String? = null
        for (index in 0..i) {
            val marker = fence(lines[index]) ?: continue
            val current = open
            if (current == null) {
                open = marker
                if (index == i) return true
            } else if (marker[0] == current[0] && marker.length >= current.length && trimmed(lines[index]) == marker) {
                if (index == i) return true
                open = null
            }
        }
        return open != null
    }

    private fun isTableRow(lines: List<String>, i: Int): Boolean {
        val line = lines[i]
        if (trimmed(line, end = false).firstOrNull() == '|') return true
        if ('|' !in line) return false
        // A run of lines with pipes is a table once it has a delimiter row, and the header is the line above it.
        var first = i
        while (first > 0 && '|' in lines[first - 1]) first--
        var last = i
        while (last < lines.size - 1 && '|' in lines[last + 1]) last++
        if (first + 1 > last) return false
        for (d in (first + 1)..last) if (isDelimiterRow(lines[d]) && i >= d - 1) return true
        return false
    }

    /** Whether Markdown would read line `i` as something other than flowing text, so that breaking it changes its meaning. */
    private fun isRigid(lines: List<String>, i: Int, keepTables: Boolean): Boolean {
        val line = lines[i]
        if (inFrontmatter(lines, i) || inFence(lines, i)) return true
        if (isHeading(line) || trimmed(line, end = false).firstOrNull() == '<') return true
        if (keepTables && isTableRow(lines, i)) return true
        // Indented four spaces after a blank line is a code block, unless it is a list item.
        val indented = line.startsWith("    ") || line.firstOrNull() == '\t'
        val listItem = prefix(line).hasMarker
        return indented && !listItem && (i == 0 || trimmed(lines[i - 1]).isEmpty())
    }

    /** The run of spaces to break at: the last one that leaves the line within `column`, else the first one after it. */
    private fun findBreak(line: String, prefixLength: Int, column: Int): IntRange? {
        var best: IntRange? = null
        var index = 0
        while (index < line.length) {
            if (line[index] != ' ') {
                index++
                continue
            }
            var stop = index
            while (stop < line.length && line[stop] == ' ') stop++
            val start = index
            index = stop
            // Nothing to break off before the line's own text starts, or after its last word.
            if (start <= prefixLength || stop >= line.length) continue
            if (start <= column) {
                best = start until stop
            } else {
                return best ?: (start until stop)
            }
        }
        return best
    }

    // Reflow

    /**
     * Breaks the line the caret is on, once or as often as it takes, until it fits in `column` or has nowhere left to break (one long
     * word or URL stays whole). Returns null when the line needs no change.
     */
    fun reflowAtCaret(text: String, caret: Int, options: ReflowOptions): ReflowEdit? {
        val caretAt = caret.coerceIn(0, text.length)
        val start0 = if (caretAt == 0) 0 else text.lastIndexOf('\n', caretAt - 1) + 1
        val end0 = text.indexOf('\n', start0).let { if (it < 0) text.length else it }
        if (end0 - start0 <= options.column) return null

        val lines = text.split('\n')
        val index = (0 until start0).count { text[it] == '\n' }
        if (isRigid(lines, index, options.keepTables)) return null

        val line = lines[index]
        val shape = prefix(line)
        // Continuation lines line up under the list item's text, not under its bullet or checkbox.
        val indent = line.substring(0, shape.lead) + " ".repeat(if (shape.hasMarker) shape.bulletEnd - shape.lead else 0)

        var out = text
        var moved = caretAt
        var start = start0
        var prefixLength = shape.end
        while (true) {
            val end = out.indexOf('\n', start).let { if (it < 0) out.length else it }
            val current = out.substring(start, end)
            if (current.length <= options.column) break
            val found = findBreak(current, prefixLength, options.column) ?: break
            val from = start + found.first
            val to = start + found.last + 1
            out = out.substring(0, from) + "\n" + indent + out.substring(to)
            if (moved >= to) moved += 1 + indent.length - (to - from) else if (moved > from) moved = from + 1 + indent.length
            start = from + 1
            prefixLength = indent.length
        }
        return if (out == text) null else ReflowEdit(out, moved)
    }

    /** The stretch of `before` that turned into `insert` to make `after`: what to hand an editor command so the rest of the text is left alone. */
    fun changedSpan(before: String, after: String): ReflowSpan {
        var start = 0
        while (start < before.length && start < after.length && before[start] == after[start]) start++
        var tail = 0
        while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] == after[after.length - 1 - tail]) tail++
        return ReflowSpan(start, before.length - tail, after.substring(start, after.length - tail))
    }
}
