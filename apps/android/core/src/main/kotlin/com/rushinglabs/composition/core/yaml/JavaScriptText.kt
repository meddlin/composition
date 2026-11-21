package com.rushinglabs.composition.core.yaml

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import kotlin.math.floor

/**
 * JavaScript's rules where Kotlin's differ, written out once for the whole core: its white space, how it writes a number, `Math.round`
 * and `toFixed`, its dates, and `String(value)` for what YAML holds. Its regular expressions' classes are in markdown/JavaScriptPatterns.kt;
 * Swift's rules are in SwiftRules.kt.
 */
internal object JavaScriptText {
    /** `String.prototype.trim`'s white space and line terminators. */
    fun isWhitespace(c: Int): Boolean = c in 0x09..0x0D || c == 0x20 || c == 0xA0 || c == 0x1680 || c in 0x2000..0x200A ||
        c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF

    fun trim(text: String): String {
        var start = 0
        var end = text.length
        while (start < end && isWhitespace(text[start].code)) start++
        while (end > start && isWhitespace(text[end - 1].code)) end--
        return text.substring(start, end)
    }

    /**
     * `Number.prototype.toString()` for the numbers YAML can hold. The shortest digits that read back as the same number, found
     * with exact decimal arithmetic so the JVM and Android agree, then laid out by ECMAScript's rules.
     */
    fun numberString(value: Double): String {
        if (value.isNaN()) return "NaN"
        if (value == 0.0) return "0"
        if (value.isInfinite()) return if (value < 0) "-Infinity" else "Infinity"
        if (value < 0) return "-" + numberString(-value)

        val exact = BigDecimal(value)
        var shortest = exact
        for (precision in 1..17) {
            val rounded = exact.round(MathContext(precision, RoundingMode.HALF_EVEN))
            if (rounded.toDouble() == value) { shortest = rounded; break }
        }
        val unscaled = shortest.unscaledValue().abs().toString()
        var digits = unscaled.trimEnd('0').ifEmpty { "0" }
        // value = 0.digits × 10^n
        val n = unscaled.length - shortest.scale()
        val k = digits.length

        if (k <= n && n <= 21) return digits + "0".repeat(n - k)
        if (0 < n && n <= 21) return digits.substring(0, n) + "." + digits.substring(n)
        if (-6 < n && n <= 0) return "0." + "0".repeat(-n) + digits
        val e = n - 1
        val sign = if (e < 0) "-" else "+"
        if (k == 1) return digits + "e" + sign + kotlin.math.abs(e)
        digits = digits.first() + "." + digits.drop(1)
        return digits + "e" + sign + kotlin.math.abs(e)
    }

    /**
     * `Math.round`: a half goes toward +infinity (-0.5 is 0), which `Math.rint` and `roundToLong` do not do. `x - floor(x)` is exact,
     * unlike `floor(x + 0.5)`, which rounds 0.49999999999999994 up.
     */
    fun round(value: Double): Double {
        val down = floor(value)
        return if (value - down >= 0.5) down + 1 else down
    }

    /**
     * `Number.prototype.toFixed(digits)`: the multiple of 10^-digits nearest the double's exact value, the larger one when two are as near
     * (away from zero, as the sign is taken off first). The exact value comes from `BigDecimal`; `String.format` would take a tie to the even
     * one and round the shortest digits rather than the exact value.
     */
    fun toFixed(value: Double, digits: Int): String {
        if (value.isNaN()) return "NaN"
        if (value >= 1e21 || value <= -1e21) return numberString(value)
        if (value < 0) return "-" + toFixed(-value, digits)
        return BigDecimal(value).setScale(digits, RoundingMode.HALF_UP).toPlainString()
    }

    /** `Date.prototype.toISOString()`. */
    fun isoString(milliseconds: Double): String {
        val total = milliseconds.toLong()
        val dayLength = 86_400_000L
        var days = total / dayLength
        var inDay = total % dayLength
        if (inDay < 0) {
            inDay += dayLength
            days -= 1
        }
        val (year, month, day) = civilFromDays(days)
        fun pad(number: Long, width: Int) = number.toString().padStart(width, '0')
        val yearText = if (year in 0..9999) pad(year, 4) else (if (year < 0) "-" else "+") + pad(kotlin.math.abs(year), 6)
        val time = "${pad(inDay / 3_600_000, 2)}:${pad(inDay / 60_000 % 60, 2)}:${pad(inDay / 1_000 % 60, 2)}.${pad(inDay % 1_000, 3)}"
        return "$yearText-${pad(month, 2)}-${pad(day, 2)}T${time}Z"
    }

    /** Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's algorithm); `month` is 1 to 12. */
    fun daysFromCivil(year: Long, month: Int, day: Int): Long {
        val y = if (month <= 2) year - 1 else year
        val era = (if (y >= 0) y else y - 399) / 400
        val yearOfEra = y - era * 400
        val monthPart = (month + 9) % 12
        val dayOfYear = (153 * monthPart + 2) / 5 + day - 1
        val dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    fun civilFromDays(days: Long): Triple<Long, Long, Long> {
        val z = days + 719_468
        val era = (if (z >= 0) z else z - 146_096) / 146_097
        val dayOfEra = z - era * 146_097
        val yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        val y = yearOfEra + era * 400
        val dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        val monthPart = (5 * dayOfYear + 2) / 153
        val day = dayOfYear - (153 * monthPart + 2) / 5 + 1
        val month = if (monthPart < 10) monthPart + 3 else monthPart - 9
        return Triple(if (month <= 2) y + 1 else y, month, day)
    }

    /**
     * `String(value)` for what YAML can hold: arrays join their items with commas (a null item is empty), mappings are
     * `[object Object]`. A date prints as ISO text. Stops after 100,000 items, as a list built from aliases of aliases can name
     * more than fit in memory.
     */
    fun string(value: YamlValue): String {
        val budget = intArrayOf(100_000)
        return string(value, budget)
    }

    private fun string(value: YamlValue, budget: IntArray): String {
        budget[0] -= 1
        if (budget[0] < 0) return ""
        return when (value) {
            YamlValue.Null -> "null"
            is YamlValue.Bool -> if (value.value) "true" else "false"
            is YamlValue.Number -> numberString(value.value)
            is YamlValue.Str -> value.value
            is YamlValue.Timestamp -> isoString(value.milliseconds)
            is YamlValue.Sequence -> {
                val parts = ArrayList<String>()
                for (item in value.items) {
                    if (budget[0] < 0) break
                    parts.add(if (item == YamlValue.Null) "" else string(item, budget))
                }
                parts.joinToString(",")
            }
            is YamlValue.Mapping -> "[object Object]"
        }
    }
}
