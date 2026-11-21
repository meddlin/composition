package com.rushinglabs.composition.core.yaml


// What the desktop's YAML library (js-yaml 4, the default schema) makes of an unquoted word, and the JavaScript text behaviours
// the desktop's frontmatter code leans on. Ported from YAMLScalars.swift. Both the reader and the writer use it.

/** A parsed YAML value, as js-yaml hands it to the desktop's `frontmatter.ts`. */
internal sealed interface YamlValue {
    data object Null : YamlValue
    data class Bool(val value: Boolean) : YamlValue
    data class Number(val value: Double) : YamlValue
    data class Str(val value: String) : YamlValue
    /** A JavaScript `Date`, in milliseconds since 1970. js-yaml makes one of every unquoted date and timestamp. */
    data class Timestamp(val milliseconds: Double) : YamlValue
    /** Never changed once made, so aliases may share it (as Swift's copy-on-write arrays do). */
    data class Sequence(val items: List<YamlValue>) : YamlValue
    data class Mapping(val mapping: YamlMapping) : YamlValue
}

/**
 * A YAML mapping in the order it was written, with js-yaml's rule that keys are compared as strings. The Swift original is a
 * value type; here a mapping is copied (`snapshot`) wherever Swift would have copied it, which is wherever it is wrapped in a value.
 */
internal class YamlMapping private constructor(
    private val list: ArrayList<Pair<String, YamlValue>>,
    private val positions: HashMap<String, Int>,
) {
    constructor() : this(ArrayList(), HashMap())

    val pairs: List<Pair<String, YamlValue>> get() = list

    fun has(key: String) = positions.containsKey(key)

    operator fun get(key: String): YamlValue? = positions[key]?.let { list[it].second }

    operator fun set(key: String, value: YamlValue) {
        val position = positions[key]
        if (position != null) list[position] = key to value else {
            positions[key] = list.size
            list.add(key to value)
        }
    }

    fun snapshot() = YamlMapping(ArrayList(list), HashMap(positions))
}

/**
 * The YAML 1.1 / js-yaml scalar types an unquoted word can resolve to, tried in js-yaml's order: null, boolean, integer, float,
 * timestamp, merge key. Anything else is a string.
 */
internal object YamlScalars {
    const val MERGE_TAG = "tag:yaml.org,2002:merge"

    /** The type an unquoted `text` resolves to and its value; null when it is a plain string. */
    fun resolve(text: String): Pair<String, YamlValue>? {
        if (isNull(text)) return "tag:yaml.org,2002:null" to YamlValue.Null
        boolean(text)?.let { return "tag:yaml.org,2002:bool" to YamlValue.Bool(it) }
        integer(text)?.let { return "tag:yaml.org,2002:int" to YamlValue.Number(it) }
        float(text)?.let { return "tag:yaml.org,2002:float" to YamlValue.Number(it) }
        timestamp(text)?.let { return "tag:yaml.org,2002:timestamp" to YamlValue.Timestamp(it) }
        if (text == "<<") return MERGE_TAG to YamlValue.Str(text)
        return null
    }

    /** Whether a string would be read back as something other than itself if it were written unquoted. */
    fun readsAsAnotherType(text: String) = resolve(text) != null

    fun isNull(text: String) = text == "~" || text == "null" || text == "Null" || text == "NULL"

    fun boolean(text: String): Boolean? = when (text) {
        "true", "True", "TRUE" -> true
        "false", "False", "FALSE" -> false
        else -> null
    }

    /** `int.js`: decimal digits, or `0b`, `0o`, `0x` digits, with an optional sign; the value must be finite. */
    fun integer(text: String): Double? {
        val units = text.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xFF }
        val count = units.size
        if (count == 0) return null
        fun at(i: Int) = if (i < count) units[i] else 0
        var index = 0
        if (at(0) == 0x2D || at(0) == 0x2B) index = 1
        val negative = at(0) == 0x2D
        var ch = at(index)
        fun finish(magnitude: Double): Double? {
            val value = if (negative) -magnitude else magnitude
            return if (value.isFinite()) value else null
        }
        if (ch == 0x30) {
            if (index + 1 == count) return 0.0
            index += 1
            ch = at(index)
            val radix: Double? = when (ch) { 0x62 -> 2.0; 0x78 -> 16.0; 0x6F -> 8.0; else -> null }
            if (radix != null) {
                index += 1
                var magnitude = 0.0
                var hasDigits = false
                while (index < count) {
                    val digit = digitValue(units[index]) ?: return null
                    if (digit.toDouble() >= radix) return null
                    magnitude = magnitude * radix + digit
                    hasDigits = true
                    index += 1
                }
                return if (hasDigits) finish(magnitude) else null
            }
        }
        var magnitude = 0.0
        var hasDigits = false
        while (index < count) {
            if (units[index] !in 0x30..0x39) return null
            magnitude = magnitude * 10 + (units[index] - 0x30)
            hasDigits = true
            index += 1
        }
        return if (hasDigits) finish(magnitude) else null
    }

    private fun digitValue(unit: Int): Int? = when (unit) {
        in 0x30..0x39 -> unit - 0x30
        in 0x41..0x46 -> unit - 0x41 + 10
        in 0x61..0x66 -> unit - 0x61 + 10
        else -> null
    }

    /** `float.js`: `2.5`, `2.5e4`, `5.`, `.5`, `1e3`, and the `.inf`, `.nan` family, with an optional sign on all but `.nan`. */
    fun float(text: String): Double? {
        val units = text.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xFF }
        val count = units.size
        fun at(i: Int) = if (i < count) units[i] else 0
        fun isDigit(i: Int) = at(i) in 0x30..0x39
        var index = 0

        val specialStart = if (at(0) == 0x2D || at(0) == 0x2B) 1 else 0
        val rest = String(units.drop(minOf(specialStart, count)).map { it.toByte() }.toByteArray(), Charsets.UTF_8)
        if (rest == ".inf" || rest == ".Inf" || rest == ".INF") return if (at(0) == 0x2D) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
        if (specialStart == 0 && (rest == ".nan" || rest == ".NaN" || rest == ".NAN")) return Double.NaN

        if (at(index) == 0x2D || at(index) == 0x2B) index += 1
        if (isDigit(index)) {
            while (isDigit(index)) index += 1
            if (at(index) == 0x2E) {
                index += 1
                while (isDigit(index)) index += 1
            }
        } else if (specialStart == 0 && at(index) == 0x2E && isDigit(index + 1)) {
            index += 1
            while (isDigit(index)) index += 1
        } else {
            return null
        }
        if (at(index) == 0x65 || at(index) == 0x45) {
            index += 1
            if (at(index) == 0x2D || at(index) == 0x2B) index += 1
            if (!isDigit(index)) return null
            while (isDigit(index)) index += 1
        }
        if (index != count) return null
        val value = (if (text.endsWith(".")) text + "0" else text).toDoubleOrNull() ?: return null
        return if (value.isFinite()) value else null
    }

    /**
     * `timestamp.js`: `YYYY-MM-DD`, or a date and time with an optional fraction and zone, as milliseconds since 1970. Out-of-range
     * parts roll over, as `Date.UTC` does (`2026-02-30` is the 2nd of March).
     */
    fun timestamp(text: String): Double? {
        val units = text.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xFF }
        val count = units.size
        var index = 0
        fun at(i: Int) = if (i < count) units[i] else 0
        fun isDigit(i: Int) = at(i) in 0x30..0x39
        fun number(minDigits: Int, maxDigits: Int): Int? {
            var value = 0
            var length = 0
            while (length < maxDigits && isDigit(index)) {
                value = value * 10 + (units[index] - 0x30)
                index += 1
                length += 1
            }
            return if (length >= minDigits) value else null
        }

        val year = number(4, 4) ?: return null
        if (at(index) != 0x2D) return null
        index += 1
        // The date-only form needs two digits each; the timestamp form takes one or two.
        val monthStart = index
        val month = number(1, 2) ?: return null
        if (at(index) != 0x2D) return null
        index += 1
        val dayStart = index
        val day = number(1, 2) ?: return null
        if (index == count) {
            if (index - monthStart != 5 || dayStart - monthStart != 3) return null
            return utc(year, month - 1, day, 0, 0, 0, 0)
        }

        if (at(index) == 0x54 || at(index) == 0x74) {
            index += 1
        } else if (at(index) == 0x20 || at(index) == 0x09) {
            while (at(index) == 0x20 || at(index) == 0x09) index += 1
        } else {
            return null
        }
        val hour = number(1, 2) ?: return null
        if (at(index) != 0x3A) return null
        index += 1
        val minute = number(2, 2) ?: return null
        if (at(index) != 0x3A) return null
        index += 1
        val second = number(2, 2) ?: return null

        var millisecond = 0
        if (at(index) == 0x2E) {
            index += 1
            val fraction = StringBuilder()
            while (isDigit(index)) {
                fraction.append(units[index].toChar())
                index += 1
            }
            if (fraction.isNotEmpty()) millisecond = (fraction.toString() + "00").take(3).toIntOrNull() ?: 0
        }

        var offsetMilliseconds = 0.0
        val beforeZone = index
        while (at(index) == 0x20 || at(index) == 0x09) index += 1
        if (at(index) == 0x5A) {
            index += 1
        } else if (at(index) == 0x2D || at(index) == 0x2B) {
            val negative = at(index) == 0x2D
            index += 1
            val zoneHour = number(1, 2) ?: return null
            var zoneMinute = 0
            if (at(index) == 0x3A) {
                index += 1
                zoneMinute = number(2, 2) ?: return null
            }
            offsetMilliseconds = ((zoneHour * 60 + zoneMinute) * 60_000).toDouble() * (if (negative) -1 else 1)
        } else {
            index = beforeZone
        }
        if (index != count) return null
        val utc = utc(year, month - 1, day, hour, minute, second, millisecond) ?: return null
        return utc - offsetMilliseconds
    }

    /** `Date.UTC`: the years 0 to 99 mean 1900 to 1999, and every part may exceed its range. */
    private fun utc(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int, millisecond: Int): Double? {
        val fullYear = if (year in 0..99) 1900 + year else year
        val totalMonths = fullYear.toLong() * 12 + month
        val normalisedYear = Math.floorDiv(totalMonths, 12L)
        val normalisedMonth = (totalMonths - normalisedYear * 12 + 1).toInt()
        val days = JavaScriptText.daysFromCivil(normalisedYear, normalisedMonth, 1) + (day - 1)
        val seconds = days * 86_400 + hour * 3_600L + minute * 60L + second
        return seconds.toDouble() * 1_000 + millisecond
    }
}
