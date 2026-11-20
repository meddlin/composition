package com.rushinglabs.composition.core.readinglist

import java.text.Normalizer

// UTS #46 (Unicode IDNA Compatibility Processing) ToASCII, with the options the URL Standard's "domain to ASCII" uses: no hyphen
// checks, bidi and joiner checks on, STD3 rules off, nontransitional, no DNS length check. A port of `tr46` (the URL Standard's
// reference implementation, jsdom's) with its tables, which apps/android/scripts/generate-uts46-data.mjs writes into
// `uts46.txt` beside this class.
//
// The iPad hands this step to Foundation's IDNA, and a JVM's `java.net.IDN` is IDNA 2003 (it turns `ß` into `ss` and drops a zero
// width joiner, where the desktop keeps the first and refuses the second), while Android's ICU is not on a JVM; so the core carries
// its own, and the JVM and Android make the same hosts. The tables are tr46 6.0.0's, Unicode 16.0, the version of the mapping table in
// Node 24's own URL parser (ada 4.0). On a JVM this port gives tr46 6.0.0's answer for every domain tried (each code point in six
// surroundings, and 400,000 random domains); only NFC comes from the platform (`java.text.Normalizer`).
//
// Where Node 24's `new URL` (and so the desktop) answers otherwise, it is ada that is off the standard, and this follows the standard:
// ada's bidi classes and combining marks are older than its mapping table (some 1,300 code points added in Unicode 14 to 16 are
// read as older Unicode read them), ada checks the bidi rule only in labels that hold right-to-left letters themselves, where UTS #46
// checks every label of a domain that has any (`1and1.مصر`), and a joiner after a virama lets the rest of its label skip the joiner
// and bidi checks. None of these are in the corpus. ASCII hosts are another matter: see `WebAddress.domainToAscii`.

internal object Uts46 {
    private const val VALID: Byte = 0
    private const val MAPPED: Byte = 1
    private const val DEVIATION: Byte = 2
    private const val DISALLOWED: Byte = 3
    private const val IGNORED: Byte = 4

    private const val ZWNJ = 0x200C
    private const val ZWJ = 0x200D

    /** A set of code points as sorted, separate ranges. */
    class CodePointSet(private val firsts: IntArray, private val lasts: IntArray) {
        operator fun contains(codePoint: Int): Boolean {
            var low = 0
            var high = firsts.size - 1
            while (low <= high) {
                val middle = (low + high) ushr 1
                when {
                    codePoint < firsts[middle] -> high = middle - 1
                    codePoint > lasts[middle] -> low = middle + 1
                    else -> return true
                }
            }
            return false
        }
    }

    private class Tables(
        /** Where each row of the mapping table starts; a row runs to the next one's start. */
        val starts: IntArray,
        val statuses: ByteArray,
        val mappings: Array<String?>,
        val sets: Map<String, CodePointSet>,
    ) {
        fun row(codePoint: Int): Int {
            var low = 0
            var high = starts.size - 1
            while (low < high) {
                val middle = (low + high + 1) ushr 1
                if (starts[middle] <= codePoint) low = middle else high = middle - 1
            }
            return low
        }

        fun status(codePoint: Int): Byte = statuses[row(codePoint)]

        fun set(name: String): CodePointSet = sets[name] ?: error("uts46.txt has no set $name")
    }

    private val tables: Tables by lazy(::load)

    private fun load(): Tables {
        val stream = Uts46::class.java.getResourceAsStream("uts46.txt") ?: error("uts46.txt is missing from the core")
        val starts = ArrayList<Int>()
        val statuses = ArrayList<Byte>()
        val mappings = ArrayList<String?>()
        val sets = HashMap<String, CodePointSet>()
        stream.bufferedReader(Charsets.UTF_8).useLines { lines ->
            for (line in lines) {
                if (line.isEmpty() || line.startsWith("#")) continue
                val fields = line.split(' ')
                if (fields[0] == "set") {
                    val ranges = if (fields.size > 2) fields[2].split(',') else emptyList()
                    val firsts = IntArray(ranges.size)
                    val lasts = IntArray(ranges.size)
                    for ((index, range) in ranges.withIndex()) {
                        val dash = range.indexOf('-')
                        firsts[index] = range.substring(0, dash).toInt(16)
                        lasts[index] = range.substring(dash + 1).toInt(16)
                    }
                    sets[fields[1]] = CodePointSet(firsts, lasts)
                    continue
                }
                starts.add(fields[0].substringBefore('-').toInt(16))
                statuses.add(
                    when (fields[1]) {
                        "V" -> VALID
                        "M" -> MAPPED
                        "D" -> DEVIATION
                        "X" -> DISALLOWED
                        "I" -> IGNORED
                        else -> error("uts46.txt: unknown status in $line")
                    },
                )
                mappings.add(
                    if (fields.size > 2) buildString { for (field in fields.drop(2)) appendCodePoint(field.toInt(16)) } else null,
                )
            }
        }
        return Tables(starts.toIntArray(), statuses.toByteArray(), mappings.toTypedArray(), sets)
    }

    /** `domain` as ASCII, or null where the URL Standard's "domain to ASCII" fails (an empty result is the caller's to refuse). */
    fun toAscii(domain: String): String? {
        val (labels, failed) = process(domain)
        if (failed) return null
        val out = ArrayList<String>(labels.size)
        for (label in labels) {
            out.add(if (label.any { it.code >= 0x80 }) "xn--" + (Punycode.encode(label) ?: return null) else label)
        }
        return out.joinToString(".")
    }

    /** UTS #46 Processing: map, normalize, break into labels, then convert and validate each. */
    private fun process(domain: String): Pair<List<String>, Boolean> {
        val mapped = Normalizer.normalize(map(domain), Normalizer.Form.NFC)
        val labels = mapped.split('.').toMutableList()
        val isBidi = isBidiDomain(labels)
        var failed = false
        for (index in labels.indices) {
            var label = labels[index]
            if (label.startsWith("xn--")) {
                if (label.any { it.code >= 0x80 }) {
                    failed = true
                    continue
                }
                val decoded = Punycode.decode(label.substring(4))
                if (decoded == null) {
                    failed = true
                    continue
                }
                label = decoded
                labels[index] = label
                if (label.isEmpty() || label.none { it.code >= 0x80 }) failed = true
            }
            if (failed) continue
            if (!isValidLabel(label, isBidi)) failed = true
        }
        return labels to failed
    }

    /** Step 1: each code point valid, mapped, kept as a deviation (nontransitional), dropped when ignored, or kept to fail later. */
    private fun map(domain: String): String {
        val tables = tables
        val out = StringBuilder(domain.length)
        var index = 0
        while (index < domain.length) {
            val codePoint = domain.codePointAt(index)
            index += Character.charCount(codePoint)
            val row = tables.row(codePoint)
            when (tables.statuses[row]) {
                IGNORED -> {}
                MAPPED -> out.append(tables.mappings[row])
                else -> out.appendCodePoint(codePoint)
            }
        }
        return out.toString()
    }

    private fun codePoints(text: String): IntArray = text.codePoints().toArray()

    private fun isBidiDomain(labels: List<String>): Boolean {
        val domain = labels.joinToString(".") { label ->
            if (label.startsWith("xn--")) Punycode.decode(label.substring(4)) ?: "" else label
        }
        val bidi = tables.set("bidiDomain")
        return codePoints(domain).any { it in bidi }
    }

    /** UTS #46 section 4.1, Validity Criteria, with the URL Standard's options. */
    private fun isValidLabel(label: String, isBidi: Boolean): Boolean {
        if (label.isEmpty()) return true
        // 1. NFC.
        if (Normalizer.normalize(label, Normalizer.Form.NFC) != label) return false
        // 2 and 3 are the hyphen checks, which are off. 4: without them, no label may begin with "xn--".
        if (label.startsWith("xn--")) return false
        // 5. No full stop.
        if ('.' in label) return false
        val points = codePoints(label)
        val tables = tables
        // 6. Not a combining mark first.
        if (points[0] in tables.set("combiningMarks")) return false
        // 7. Every code point valid, or a deviation (nontransitional).
        for (point in points) {
            val status = tables.status(point)
            if (status != VALID && status != DEVIATION) return false
        }
        // 8. The ContextJ rules for the joiners (RFC 5892, appendix A).
        val virama = tables.set("combiningClassVirama")
        var last = 0
        for ((index, point) in points.withIndex()) {
            if (point != ZWNJ && point != ZWJ) continue
            if (index > 0) {
                if (points[index - 1] in virama) continue
                if (point == ZWNJ) {
                    var next = -1
                    for (later in index + 1 until points.size) if (points[later] == ZWNJ) { next = later; break }
                    if (validZwnj(points, last, if (next < 0) points.size else next)) {
                        last = index + 1
                        continue
                    }
                }
            }
            return false
        }
        // 9. The bidi rule (RFC 5893, section 2), in a domain that has right-to-left labels.
        if (isBidi) {
            val rtl = when (points[0]) {
                in tables.set("bidiS1LTR") -> false
                in tables.set("bidiS1RTL") -> true
                else -> return false
            }
            if (rtl) {
                if (!points.all { it in tables.set("bidiS2") }) return false
                if (!endsWith(points, tables.set("bidiS3.0"), tables.set("bidiS3.1"))) return false
                if (points.any { it in tables.set("bidiS4EN") } && points.any { it in tables.set("bidiS4AN") }) return false
            } else {
                if (!points.all { it in tables.set("bidiS5") }) return false
                if (!endsWith(points, tables.set("bidiS6.0"), tables.set("bidiS6.1"))) return false
            }
        }
        return true
    }

    /** tr46's `validZWNJ`, `[L or D][T]*ZWNJ[T]*[R or D]`, found anywhere in `points[from, until)`. */
    private fun validZwnj(points: IntArray, from: Int, until: Int): Boolean {
        val before = tables.set("validZWNJ.0")
        val transparentBefore = tables.set("validZWNJ.1")
        val transparentAfter = tables.set("validZWNJ.2")
        val after = tables.set("validZWNJ.3")
        for (at in from until until) {
            if (points[at] != ZWNJ) continue
            var left = false
            var index = at - 1
            while (index >= from) {
                if (points[index] in before) { left = true; break }
                if (points[index] !in transparentBefore) break
                index -= 1
            }
            if (!left) continue
            index = at + 1
            while (index < until) {
                if (points[index] in after) return true
                if (points[index] !in transparentAfter) break
                index += 1
            }
        }
        return false
    }

    /** `[first][rest]*$` found in `points`: after some code point of `first`, nothing but `rest` to the end. */
    private fun endsWith(points: IntArray, first: CodePointSet, rest: CodePointSet): Boolean {
        for (index in points.indices.reversed()) {
            if (points[index] in first) return true
            if (points[index] !in rest) return false
        }
        return false
    }
}

/** RFC 3492's Punycode, as `punycode.js` 2.3 (which tr46 uses) encodes and decodes it, errors included. */
internal object Punycode {
    private const val BASE = 36
    private const val T_MIN = 1
    private const val T_MAX = 26
    private const val SKEW = 38
    private const val DAMP = 700
    private const val INITIAL_BIAS = 72
    private const val INITIAL_N = 128
    private const val MAX_INT = 2_147_483_647L

    private fun adapt(delta: Long, numPoints: Long, firstTime: Boolean): Long {
        var k = 0L
        var d = if (firstTime) delta / DAMP else delta shr 1
        d += d / numPoints
        while (d > (BASE - T_MIN) * T_MAX shr 1) {
            d /= BASE - T_MIN
            k += BASE
        }
        return k + (BASE - T_MIN + 1) * d / (d + SKEW)
    }

    private fun basicToDigit(unit: Int): Int = when (unit) {
        in 0x30..0x39 -> 26 + (unit - 0x30)
        in 0x41..0x5A -> unit - 0x41
        in 0x61..0x7A -> unit - 0x61
        else -> BASE
    }

    private fun digitToBasic(digit: Long): Char = if (digit < 26) ('a' + digit.toInt()) else ('0' + (digit - 26).toInt())

    private fun threshold(k: Long, bias: Long): Long = if (k <= bias) T_MIN.toLong() else if (k >= bias + T_MAX) T_MAX.toLong() else k - bias

    /** The Unicode a Punycode label (without `xn--`) stands for, or null where `punycode.decode` throws. Works on UTF-16 units, as it does. */
    fun decode(input: String): String? {
        val output = ArrayList<Int>()
        var basic = input.lastIndexOf('-')
        if (basic < 0) basic = 0
        for (j in 0 until basic) {
            if (input[j].code >= 0x80) return null
            output.add(input[j].code)
        }
        var i = 0L
        var n = INITIAL_N.toLong()
        var bias = INITIAL_BIAS.toLong()
        var index = if (basic > 0) basic + 1 else 0
        while (index < input.length) {
            val oldi = i
            var w = 1L
            var k = BASE.toLong()
            while (true) {
                if (index >= input.length) return null
                val digit = basicToDigit(input[index++].code).toLong()
                if (digit >= BASE) return null
                if (digit > (MAX_INT - i) / w) return null
                i += digit * w
                val t = threshold(k, bias)
                if (digit < t) break
                val baseMinusT = BASE - t
                if (w > MAX_INT / baseMinusT) return null
                w *= baseMinusT
                k += BASE
            }
            val out = output.size + 1L
            bias = adapt(i - oldi, out, oldi == 0L)
            if (i / out > MAX_INT - n) return null
            n += i / out
            i %= out
            output.add(i.toInt(), n.toInt())
            i += 1
        }
        // `String.fromCodePoint` refuses anything past U+10FFFF.
        if (output.any { it > 0x10FFFF }) return null
        return buildString { for (point in output) appendCodePoint(point) }
    }

    /** The Punycode for a label (without `xn--`), or null where `punycode.encode` throws (an overflow). */
    fun encode(text: String): String? {
        val input = text.codePoints().toArray()
        val output = StringBuilder()
        for (point in input) if (point < 0x80) output.append(point.toChar())
        val basicLength = output.length.toLong()
        var handled = basicLength
        if (basicLength > 0) output.append('-')
        var n = INITIAL_N.toLong()
        var delta = 0L
        var bias = INITIAL_BIAS.toLong()
        while (handled < input.size) {
            var m = MAX_INT
            for (point in input) if (point >= n && point < m) m = point.toLong()
            val handledPlusOne = handled + 1
            if (m - n > (MAX_INT - delta) / handledPlusOne) return null
            delta += (m - n) * handledPlusOne
            n = m
            for (point in input) {
                if (point < n && ++delta > MAX_INT) return null
                if (point.toLong() == n) {
                    var q = delta
                    var k = BASE.toLong()
                    while (true) {
                        val t = threshold(k, bias)
                        if (q < t) break
                        val qMinusT = q - t
                        val baseMinusT = BASE - t
                        output.append(digitToBasic(t + qMinusT % baseMinusT))
                        q = qMinusT / baseMinusT
                        k += BASE
                    }
                    output.append(digitToBasic(q))
                    bias = adapt(delta, handledPlusOne, handled == basicLength)
                    delta = 0
                    handled += 1
                }
            }
            delta += 1
            n += 1
        }
        return output.toString()
    }
}
