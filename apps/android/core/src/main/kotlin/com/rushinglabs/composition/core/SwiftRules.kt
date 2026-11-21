package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.markdown.AsciiCaseless
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.withSign

// Swift's rules where Kotlin's differ, written out once for the whole core (the README's "Swift's rules, spelled out"): its rounding, its
// `min` and `max`, its white space, and how it reads a number from text. JavaScript's are `JavaScriptText` (yaml/JavaScriptText.kt) and
// markdown/JavaScriptPatterns.kt.

/**
 * Swift's `rounded()`: to the nearest whole number, a half away from zero (`-0.5` is `-1`). Kotlin's `round` takes a half to the even one,
 * and `floor(x + 0.5)` rounds 0.49999999999999994 up; `x - floor(x)` is exact.
 */
internal fun swiftRounded(value: Double): Double {
    val magnitude = abs(value)
    val whole = floor(magnitude)
    return (if (magnitude - whole >= 0.5) whole + 1 else whole).withSign(value)
}

/** Swift's `min`: `y < x ? y : x`, so a NaN second argument is passed over (Kotlin's `min` returns NaN). */
internal fun swiftMin(x: Double, y: Double): Double = if (y < x) y else x

/** Swift's `max`: `y >= x ? y : x`. */
internal fun swiftMax(x: Double, y: Double): Double = if (y >= x) y else x

/**
 * The few Swift text rules the preview's props are read with, spelled out rather than left to Kotlin's, which differ: Kotlin's
 * `toIntOrNull` takes other scripts' digits (`٣`), and `toDoubleOrNull` takes `280d` and needs a `p` in a hex number.
 */
internal object SwiftText {
    /** Unicode's White_Space: Swift's `Character.isWhitespace` and `properties.isWhitespace`, and `CharacterSet.whitespacesAndNewlines`. */
    fun isWhitespace(c: Int): Boolean = c in 0x09..0x0D || c == 0x20 || c == 0x85 || c == 0xA0 || c == 0x1680 || c in 0x2000..0x200A ||
        c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000

    /** `CharacterSet.whitespaces`: Unicode's space separators (Zs) and the tab. Not the line breaks. */
    fun isSpace(c: Int): Boolean = c == 0x09 || c == 0x20 || c == 0xA0 || c == 0x1680 || c in 0x2000..0x200A || c == 0x202F || c == 0x205F ||
        c == 0x3000

    /** `trimmingCharacters(in: .whitespacesAndNewlines)`. */
    fun trim(text: String): String = trimmed(text, ::isWhitespace)

    /** `trimmingCharacters(in: .whitespaces)`. */
    fun trimSpaces(text: String): String = trimmed(text, ::isSpace)

    private inline fun trimmed(text: String, drop: (Int) -> Boolean): String {
        var start = 0
        var end = text.length
        while (start < end && drop(text[start].code)) start++
        while (end > start && drop(text[end - 1].code)) end--
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
