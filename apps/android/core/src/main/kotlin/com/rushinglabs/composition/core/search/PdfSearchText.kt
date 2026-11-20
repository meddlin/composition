package com.rushinglabs.composition.core.search

import com.rushinglabs.composition.core.SwiftText
import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.text.BreakIterator
import java.text.Normalizer
import java.util.Locale

// The text of a PDF's pages as search keeps it, ported from PdfSearchText.swift: a port of `pageSearchText` in the desktop's `pdfText.ts`,
// replaying fixtures/conformance/pdf-text.json (PdfTextConformanceTests). The page's raw text comes from a PDF text reader (the app's,
// not the core's); this is the rule every side applies to it before it is indexed.

/** One page of a PDF's own text, as read from the file: 0-based, with its printed label if the PDF gives one. */
data class PdfTextPage(val page: Int, val label: String? = null, val text: String)

object PdfSearchText {
    private const val SOFT_HYPHEN = '\u00AD'

    /**
     * The words of one page as they are indexed: line breaks made `\n` whatever they were, compatibility forms made plain (NFKC: `ﬁ` is
     * `fi`, full-width letters are letters), each line trimmed, soft hyphens dropped except at a line's end, empty lines dropped. A word
     * broken over two lines with a hyphen is also added whole, after the page's lines (`extrac-` / `tion` adds `extraction`). A page with no
     * text is "".
     */
    fun pageSearchText(raw: String): String {
        val unified = raw.replace("\r\n", "\n").replace("\r", "\n")
        val lines = Normalizer.normalize(unified, Normalizer.Form.NFKC)
            .split("\n")
            .map { withoutInnerSoftHyphens(JavaScriptText.trim(it)) }
            .filter { it.isNotEmpty() }
        val joined = ArrayList<String>()
        for (index in 0 until lines.size - 1) {
            val start = brokenStart(lines[index]) ?: continue
            val end = brokenEnd(lines[index + 1]) ?: continue
            joined.add(start + end)
        }
        return (lines + (if (joined.isEmpty()) emptyList() else listOf(joined.joinToString(" ")))).joinToString("\n")
    }

    /**
     * What a search result found in a PDF's text puts in the reader's find bar, which looks for one run of text: the query's first quoted
     * phrase, or else its longest word (every word is on the page found, but not always side by side). Filters (`tag:` …) are left out.
     * "" for none.
     */
    fun findText(query: String): String {
        val text = SearchQueryParser.parse(query).text
        val parts = text.split("\"")
        // The odd pieces were between quotes.
        val phrase = parts.withIndex().firstOrNull { it.index % 2 == 1 && SwiftText.trimSpaces(it.value).isNotEmpty() }?.value
        if (phrase != null) return splitOnWhiteSpace(phrase).joinToString(" ")
        // Words are runs of characters (as a person sees them) that are letters or numbers; the longest wins, the first of a tie.
        var best = ""
        var bestCount = 0
        val word = StringBuilder()
        var count = 0
        fun endWord() {
            if (count > bestCount) {
                best = word.toString()
                bestCount = count
            }
            word.clear()
            count = 0
        }
        forEachCharacter(text) { character ->
            val first = character.codePointAt(0)
            if (Character.isAlphabetic(first) || isNumber(first)) {
                word.append(character)
                count += 1
            } else {
                endWord()
            }
        }
        endWord()
        return best
    }

    /** `line.replace(/\u00AD(?!$)/gu, "")` */
    private fun withoutInnerSoftHyphens(line: String): String {
        if (SOFT_HYPHEN !in line) return line
        val out = StringBuilder()
        line.forEachIndexed { index, c -> if (c != SOFT_HYPHEN || index == line.length - 1) out.append(c) }
        return out.toString()
    }

    private fun isLetter(codePoint: Int): Boolean = when (Character.getType(codePoint).toByte()) {
        Character.UPPERCASE_LETTER, Character.LOWERCASE_LETTER, Character.TITLECASE_LETTER, Character.MODIFIER_LETTER, Character.OTHER_LETTER -> true
        else -> false
    }

    /** `/(\p{L}+)[-\u00AD\u2010]$/u`: the letters before a hyphen that ends the line. */
    private fun brokenStart(line: String): String? {
        val points = line.codePoints().toArray()
        val last = points.lastOrNull() ?: return null
        if (last != '-'.code && last != SOFT_HYPHEN.code && last != 0x2010) return null
        var start = points.size - 1
        while (start > 0 && isLetter(points[start - 1])) start -= 1
        if (start >= points.size - 1) return null
        return String(points, start, points.size - 1 - start)
    }

    /** `/^(\p{Ll}+)/u`: the lowercase letters a line starts with. */
    private fun brokenEnd(line: String): String? {
        val out = StringBuilder()
        for (point in line.codePoints()) {
            if (Character.getType(point) != Character.LOWERCASE_LETTER.toInt()) break
            out.appendCodePoint(point)
        }
        return out.toString().ifEmpty { null }
    }

    /** Swift's `Character.isNumber`: the first scalar has a numeric type (a digit, a numeral letter, a fraction, …). */
    private fun isNumber(codePoint: Int): Boolean = when (Character.getType(codePoint).toByte()) {
        Character.DECIMAL_DIGIT_NUMBER, Character.LETTER_NUMBER, Character.OTHER_NUMBER -> true
        else -> false
    }

    /** Each character as a person sees it (an extended grapheme cluster), as Swift walks a `String`. */
    private fun forEachCharacter(text: String, body: (String) -> Unit) {
        val breaks = BreakIterator.getCharacterInstance(Locale.ROOT)
        breaks.setText(text)
        var start = breaks.first()
        var end = breaks.next()
        while (end != BreakIterator.DONE) {
            body(text.substring(start, end))
            start = end
            end = breaks.next()
        }
    }

    private fun splitOnWhiteSpace(text: String): List<String> {
        val words = ArrayList<String>()
        val current = StringBuilder()
        for (c in text) {
            if (SwiftText.isWhitespace(c.code)) {
                if (current.isNotEmpty()) words.add(current.toString())
                current.clear()
            } else current.append(c)
        }
        if (current.isNotEmpty()) words.add(current.toString())
        return words
    }

    /** How many characters a person sees in `text` (Swift's `String.count`): what the index reports as a PDF's size. */
    internal fun characterCount(text: String): Int {
        var count = 0
        forEachCharacter(text) { count += 1 }
        return count
    }
}
