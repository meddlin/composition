package com.rushinglabs.composition.core.yaml

// The writing half of the desktop's YAML library, for the one shape a note's frontmatter takes: a mapping whose values are
// strings or lists of strings. A port of YAMLWriter.swift, itself a port of js-yaml 4's `dumper.js` with the options the desktop
// passes (`noArrayIndent`, `sortKeys: false`, the default width of 80 and indent of 2). A note saved here must come out byte for
// byte as the desktop would have saved it.

internal object YamlWriter {
    sealed interface Value {
        data class Text(val text: String) : Value
        data class List(val items: kotlin.collections.List<String>) : Value
    }

    private const val INDENT = 2
    private const val LINE_WIDTH = 80

    /** `yaml.dump(object, { noArrayIndent: true })` of a mapping from strings to strings and lists of strings. */
    fun dump(pairs: List<Pair<String, Value>>): String {
        val result = StringBuilder()
        for ((index, pair) in pairs.withIndex()) {
            if (index > 0) result.append("\n")
            result.append(scalar(pair.first, 1, isKey = true))
            when (val value = pair.second) {
                is Value.Text -> result.append(": ").append(scalar(value.text, 1, isKey = false))
                is Value.List -> if (value.items.isEmpty()) result.append(": []") else {
                    // With `noArrayIndent` the dashes sit under the key.
                    result.append(":")
                    for (item in value.items) result.append("\n- ").append(scalar(item, 1, isKey = false))
                }
            }
        }
        return result.append("\n").toString()
    }

    private enum class Style { PLAIN, SINGLE, LITERAL, FOLDED, DOUBLE }

    /** `writeScalar`. */
    private fun scalar(text: String, level: Int, isKey: Boolean): String {
        if (text.isEmpty()) return "''"
        if (deprecatedBoolean(text) || base60(text)) return "'$text'"
        val spaces = INDENT * maxOf(1, level)
        val width = maxOf(minOf(LINE_WIDTH, 40), LINE_WIDTH - spaces)
        return when (chooseStyle(text, singleLineOnly = isKey, width = width, ambiguous = YamlScalars.readsAsAnotherType(text))) {
            Style.PLAIN -> text
            Style.SINGLE -> "'" + text.replace("'", "''") + "'"
            Style.LITERAL -> "|" + blockHeader(text) + dropEndingNewline(indentLines(text, spaces))
            Style.FOLDED -> ">" + blockHeader(text) + dropEndingNewline(indentLines(fold(text, width), spaces))
            Style.DOUBLE -> "\"" + escape(text) + "\""
        }
    }

    /** The old YAML 1.1 spellings of a boolean, which js-yaml quotes so that other readers keep them as text. */
    private fun deprecatedBoolean(text: String) = text in setOf(
        "y", "Y", "yes", "Yes", "YES", "on", "On", "ON", "n", "N", "no", "No", "NO", "off", "Off", "OFF",
    )

    /** `/^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/`: a base-60 number such as `12:30`. */
    private fun base60(text: String): Boolean = Regex("""^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$""").matches(text)

    private fun isPrintable(c: Int) = c in 0x20..0x7E || (c in 0xA1..0xD7FF && c != 0x2028 && c != 0x2029) ||
        (c in 0xE000..0xFFFD && c != 0xFEFF) || c in 0x10000..0x10FFFF

    private fun isWhitespace(c: Int) = c == 0x20 || c == 0x09

    private fun isNsCharOrWhitespace(c: Int) = isPrintable(c) && c != 0xFEFF && c != 0x0D && c != 0x0A

    private fun isPlainSafe(c: Int, previous: Int?): Boolean {
        val nsOrSpace = isNsCharOrWhitespace(c)
        val ns = nsOrSpace && !isWhitespace(c)
        val safe = nsOrSpace && c != 0x23 && !(previous == 0x3A && !ns)
        val hashAfterChar = previous?.let { isNsCharOrWhitespace(it) && !isWhitespace(it) && c == 0x23 } ?: false
        val colonBeforeChar = previous == 0x3A && ns
        return safe || hashAfterChar || colonBeforeChar
    }

    private val indicators = setOf(0x2D, 0x3F, 0x3A, 0x2C, 0x5B, 0x5D, 0x7B, 0x7D, 0x23, 0x26, 0x2A, 0x21, 0x7C, 0x3D, 0x3E, 0x27, 0x22, 0x25, 0x40, 0x60)

    private fun isPlainSafeFirst(c: Int) = isPrintable(c) && c != 0xFEFF && !isWhitespace(c) && c !in indicators

    private fun isPlainSafeLast(c: Int) = !isWhitespace(c) && c != 0x3A

    /** `String.prototype.codePointAt`, with the number of UTF-16 units it spans. */
    private fun codePoint(text: String, index: Int): Pair<Int, Int> {
        val first = text[index].code
        if (first in 0xD800..0xDBFF && index + 1 < text.length) {
            val second = text[index + 1].code
            if (second in 0xDC00..0xDFFF) return ((first - 0xD800) * 0x400 + second - 0xDC00 + 0x10000) to 2
        }
        return first to 1
    }

    /** Whether a block scalar needs an indentation indicator: it starts with newlines and then a space. */
    private fun needsIndentIndicator(text: String): Boolean {
        var index = 0
        while (index < text.length && text[index] == '\n') index++
        return index < text.length && text[index] == ' '
    }

    /** `chooseScalarStyle`. */
    private fun chooseStyle(text: String, singleLineOnly: Boolean, width: Int, ambiguous: Boolean): Style {
        var previous: Int? = null
        var hasLineBreak = false
        var hasFoldableLine = false
        var previousLineBreak = -1
        var plain = isPlainSafeFirst(codePoint(text, 0).first) && isPlainSafeLast(codePoint(text, text.length - 1).first)

        var index = 0
        while (index < text.length) {
            val (c, step) = codePoint(text, index)
            if (c == 0x0A && !singleLineOnly) {
                hasLineBreak = true
                // A foldable line is too long and not more indented.
                hasFoldableLine = hasFoldableLine || (index - previousLineBreak - 1 > width && text[previousLineBreak + 1] != ' ')
                previousLineBreak = index
            } else if (!isPrintable(c)) {
                return Style.DOUBLE
            }
            plain = plain && isPlainSafe(c, previous)
            previous = c
            index += step
        }
        if (!singleLineOnly) {
            hasFoldableLine = hasFoldableLine || (index - previousLineBreak - 1 > width && text[previousLineBreak + 1] != ' ')
        }
        if (!hasLineBreak && !hasFoldableLine) return if (plain && !ambiguous) Style.PLAIN else Style.SINGLE
        return if (hasFoldableLine) Style.FOLDED else Style.LITERAL
    }

    private fun blockHeader(text: String): String {
        val indicator = if (needsIndentIndicator(text)) INDENT.toString() else ""
        val clip = text.endsWith("\n")
        val keep = clip && ((text.length >= 2 && text[text.length - 2] == '\n') || text == "\n")
        val chomp = if (keep) "+" else if (clip) "" else "-"
        return indicator + chomp + "\n"
    }

    private fun dropEndingNewline(text: String) = if (text.endsWith("\n")) text.dropLast(1) else text

    /** Indents every line except the empty ones. */
    private fun indentLines(text: String, spaces: Int): String {
        val pad = " ".repeat(spaces)
        val result = StringBuilder()
        val line = StringBuilder()
        for (char in text) {
            line.append(char)
            if (char == '\n') {
                if (line.toString() != "\n") result.append(pad)
                result.append(line)
                line.clear()
            }
        }
        if (line.isNotEmpty()) result.append(pad).append(line)
        return result.toString()
    }

    /** `foldString`: lines longer than `width` are broken at spaces; runs of newlines keep their meaning when read folded. */
    private fun fold(text: String, width: Int): String {
        val count = text.length
        val firstBreak = text.indexOf('\n').let { if (it < 0) count else it }
        val result = StringBuilder(foldLine(text.substring(0, firstBreak), width))
        var previousMoreIndented = text.firstOrNull() == '\n' || text.firstOrNull() == ' '

        // The rest: each chunk is newlines followed by one content line.
        var index = firstBreak
        while (index < count) {
            var newlineEnd = index
            while (newlineEnd < count && text[newlineEnd] == '\n') newlineEnd++
            var lineEnd = newlineEnd
            while (lineEnd < count && text[lineEnd] != '\n') lineEnd++
            val prefix = text.substring(index, newlineEnd)
            val line = text.substring(newlineEnd, lineEnd)
            val moreIndented = line.firstOrNull() == ' '
            result.append(prefix)
            if (!previousMoreIndented && !moreIndented && line.isNotEmpty()) result.append("\n")
            result.append(foldLine(line, width))
            previousMoreIndented = moreIndented
            index = lineEnd
        }
        return result.toString()
    }

    /** `foldLine`: greedy breaking, picking the longest line under the limit each time, otherwise the shortest line over it. */
    private fun foldLine(line: String, width: Int): String {
        if (line.isEmpty() || line[0] == ' ') return line

        // Break points are a space followed by a non-space.
        val breaks = ArrayList<Int>()
        var i = 0
        while (i + 1 < line.length) {
            if (line[i] == ' ' && line[i + 1] != ' ') {
                breaks.add(i)
                i += 2
            } else {
                i += 1
            }
        }

        var start = 0
        var curr = 0
        val result = StringBuilder()
        for (next in breaks) {
            // Keep the invariant: curr - start <= width.
            if (next - start > width) {
                val end = if (curr > start) curr else next
                result.append("\n").append(line, start, end)
                start = end + 1
            }
            curr = next
        }
        result.append("\n")
        if (line.length - start > width && curr > start) {
            result.append(line, start, curr).append("\n").append(line.substring(curr + 1))
        } else {
            result.append(line.substring(start))
        }
        return result.substring(1)
    }

    private val escapes = mapOf(
        0x00 to "\\0", 0x07 to "\\a", 0x08 to "\\b", 0x09 to "\\t", 0x0A to "\\n", 0x0B to "\\v", 0x0C to "\\f", 0x0D to "\\r",
        0x1B to "\\e", 0x22 to "\\\"", 0x5C to "\\\\", 0x85 to "\\N", 0xA0 to "\\_", 0x2028 to "\\L", 0x2029 to "\\P",
    )

    private fun escape(text: String): String {
        val result = StringBuilder()
        var index = 0
        while (index < text.length) {
            val (c, step) = codePoint(text, index)
            val sequence = escapes[c]
            if (sequence != null) {
                result.append(sequence)
            } else if (isPrintable(c)) {
                result.appendCodePoint(c)
            } else {
                val hex = Integer.toHexString(c).uppercase()
                val (marker, digits) = if (c <= 0xFF) "x" to 2 else if (c <= 0xFFFF) "u" to 4 else "U" to 8
                result.append("\\").append(marker).append("0".repeat(digits - hex.length)).append(hex)
            }
            index += step
        }
        return result.toString()
    }
}
