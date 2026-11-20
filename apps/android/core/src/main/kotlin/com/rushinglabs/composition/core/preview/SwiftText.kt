package com.rushinglabs.composition.core.preview

import com.rushinglabs.composition.core.markdown.AsciiCaseless

/**
 * The few Swift text rules the preview's props are read with, spelled out rather than left to Kotlin's, which differ: Kotlin's
 * `toIntOrNull` takes other scripts' digits (`٣`), and `toDoubleOrNull` takes `280d` and needs a `p` in a hex number.
 */
internal object SwiftText {
    /** `CharacterSet.whitespaces`: Unicode's space separators (Zs) and the tab. Not the line breaks. */
    private fun isSpace(c: Char) = c == '\t' || c == ' ' || c == '\u00A0' || c == '\u1680' || c in '\u2000'..'\u200A' ||
        c == '\u202F' || c == '\u205F' || c == '\u3000'

    /** `trimmingCharacters(in: .whitespaces)`. */
    fun trimSpaces(text: String): String {
        var start = 0
        var end = text.length
        while (start < end && isSpace(text[start])) start++
        while (end > start && isSpace(text[end - 1])) end--
        return text.substring(start, end)
    }

    private val integer = Regex("^[+-]?[0-9]+\\z")

    /** Swift's `Int(_:)` (64 bits): an optional sign and ASCII digits, nothing else; null when it does not fit. */
    fun int(text: String): Long? {
        if (!integer.containsMatchIn(text)) return null
        return text.removePrefix("+").toLongOrNull()
    }

    private val decimal = Regex("^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?\\z")
    private val hex = Regex("^([+-]?)0[xX]((?:[0-9a-fA-F]+\\.?[0-9a-fA-F]*|\\.[0-9a-fA-F]+))([pP][+-]?[0-9]+)?\\z")
    private val special = AsciiCaseless("^([+-]?)(inf|infinity|nan)\\z")

    /**
     * Swift's `Double(_:)`, which is C's `strtod` that must read the whole text: decimal with an optional exponent, hexadecimal with an
     * optional `p` exponent, `inf`, `infinity` and `nan` in any case. A number too large is infinite and one too small is zero, as both
     * Swift and Java have it.
     */
    fun double(text: String): Double? {
        if (decimal.containsMatchIn(text)) return text.toDouble()
        hex.find(text)?.let { match ->
            val (sign, digits, exponent) = match.destructured
            return "${sign}0x$digits${exponent.ifEmpty { "p0" }}".toDouble()
        }
        special.find(text)?.let { match ->
            val negative = match.groupValues[1] == "-"
            return if (match.groupValues[2] == "nan") Double.NaN else if (negative) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
        }
        return null
    }
}
