package com.rushinglabs.composition.core.json

import com.rushinglabs.composition.core.yaml.JavaScriptText

// JSON that keeps what it was given, ported from JSONValue.swift. A PDF mark stores JSON in three columns (`rects`, `body`,
// `view_state`), and a drawing's stroke JSON is whatever the drawing code made: it must come back as it went in, members in their
// order and numbers written the way JavaScript's `JSON.stringify` writes them (`JavaScriptText.numberString`), so the same mark or
// drawing is the same text on the desktop, the iPad and Android. kotlinx.serialization's `JsonObject` keeps the order but formats
// numbers its own way and keeps a repeated key's first place with its first value, which is why this exists.

/** A JSON value. Two objects are equal when they hold the same members, in whatever order, as JSON means it. */
sealed class JsonValue {
    data object Null : JsonValue()

    data class Bool(val value: Boolean) : JsonValue()

    /** A number, compared as Swift and JavaScript compare doubles: `0` equals `-0`. */
    class Number(val value: Double) : JsonValue() {
        override fun equals(other: Any?): Boolean = other is Number && other.value == value
        override fun hashCode(): Int = (if (value == 0.0) 0.0 else value).hashCode()
        override fun toString(): String = "Number(${JavaScriptText.numberString(value)})"
    }

    data class Text(val value: String) : JsonValue()

    data class Array(val items: List<JsonValue>) : JsonValue()

    /** An object whose members keep the order they were written in. A key given twice keeps its first place and its last value, as `JSON.parse` does. */
    class Object(members: List<JsonMember> = emptyList()) : JsonValue() {
        val members: List<JsonMember>

        init {
            val placed = HashMap<String, Int>()
            val unique = ArrayList<JsonMember>(members.size)
            for (member in members) {
                val at = placed[member.key]
                if (at != null) {
                    unique[at] = member
                } else {
                    placed[member.key] = unique.size
                    unique.add(member)
                }
            }
            this.members = unique
        }

        constructor(vararg pairs: Pair<String, JsonValue>) : this(pairs.map { JsonMember(it.first, it.second) })

        operator fun get(key: String): JsonValue? = members.firstOrNull { it.key == key }?.value

        override fun equals(other: Any?): Boolean =
            other is Object && other.members.size == members.size && members.all { other[it.key] == it.value }

        override fun hashCode(): Int = members.sumOf { it.key.hashCode() xor it.value.hashCode() }

        override fun toString(): String = "Object(${members.joinToString { "${it.key}=${it.value}" }})"
    }

    val doubleValue: Double? get() = (this as? Number)?.value

    /** A whole number a JavaScript `Number.isSafeInteger` accepts, or null. */
    val integerValue: Long?
        get() {
            val value = (this as? Number)?.value ?: return null
            if (!value.isFinite() || value != kotlin.math.truncate(value) || kotlin.math.abs(value) > 9_007_199_254_740_991.0) return null
            return value.toLong()
        }

    val stringValue: String? get() = (this as? Text)?.value

    val objectValue: Object? get() = this as? Object

    val arrayValue: List<JsonValue>? get() = (this as? Array)?.items

    /** Compact, members in their order, as `JSON.stringify` writes it (a number that is not finite, which JSON cannot hold, is `null`). */
    fun serialized(): String = StringBuilder().also { write(it) }.toString()

    private fun write(out: StringBuilder) {
        when (this) {
            Null -> out.append("null")
            is Bool -> out.append(if (value) "true" else "false")
            is Number -> out.append(if (value.isFinite()) JavaScriptText.numberString(value) else "null")
            is Text -> writeString(value, out)
            is Array -> {
                out.append('[')
                items.forEachIndexed { index, item ->
                    if (index > 0) out.append(',')
                    item.write(out)
                }
                out.append(']')
            }
            is Object -> {
                out.append('{')
                members.forEachIndexed { index, member ->
                    if (index > 0) out.append(',')
                    writeString(member.key, out)
                    out.append(':')
                    member.value.write(out)
                }
                out.append('}')
            }
        }
    }

    companion object {
        /**
         * Strict JSON: no comments, no trailing commas, one value and nothing after it. A number too large for a double is refused (it
         * has no JSON form to write back), and a lone surrogate in a string becomes U+FFFD, as it does in a Swift string.
         */
        fun parse(text: String): JsonValue {
            val parser = Parser(text.encodeToByteArray())
            parser.skipSpace()
            val value = parser.value()
            parser.skipSpace()
            if (parser.index != parser.bytes.size) throw JsonParseError(parser.index)
            return value
        }

        private fun writeString(text: String, out: StringBuilder) {
            out.append('"')
            for (c in text) {
                when {
                    c == '"' -> out.append("\\\"")
                    c == '\\' -> out.append("\\\\")
                    c == '\b' -> out.append("\\b")
                    c.code == 0x0C -> out.append("\\f")
                    c == '\n' -> out.append("\\n")
                    c == '\r' -> out.append("\\r")
                    c == '\t' -> out.append("\\t")
                    c.code < 0x20 -> out.append("\\u").append(c.code.toString(16).padStart(4, '0'))
                    else -> out.append(c)
                }
            }
            out.append('"')
        }
    }
}

data class JsonMember(val key: String, val value: JsonValue)

/** Where the text stopped being JSON, in UTF-8 bytes from its start. */
class JsonParseError(val offset: Int) : Exception("Not JSON at byte $offset")

private class Parser(val bytes: ByteArray) {
    var index = 0
    var depth = 0

    private fun fail() = JsonParseError(index)

    private fun at(position: Int): Int = bytes[position].toInt() and 0xFF

    fun skipSpace() {
        while (index < bytes.size && at(index).let { it == 0x20 || it == 0x09 || it == 0x0A || it == 0x0D }) index++
    }

    fun value(): JsonValue {
        if (index >= bytes.size) throw fail()
        return when (at(index).toChar()) {
            '{' -> obj()
            '[' -> array()
            '"' -> JsonValue.Text(string())
            't' -> { literal("true"); JsonValue.Bool(true) }
            'f' -> { literal("false"); JsonValue.Bool(false) }
            'n' -> { literal("null"); JsonValue.Null }
            else -> JsonValue.Number(number())
        }
    }

    private fun literal(word: String) {
        if (index + word.length > bytes.size || word.indices.any { at(index + it) != word[it].code }) throw fail()
        index += word.length
    }

    private fun obj(): JsonValue {
        depth++
        try {
            if (depth > MAX_DEPTH) throw fail()
            index++
            val members = ArrayList<JsonMember>()
            skipSpace()
            if (index < bytes.size && at(index) == '}'.code) { index++; return JsonValue.Object() }
            while (true) {
                skipSpace()
                if (index >= bytes.size || at(index) != '"'.code) throw fail()
                val key = string()
                skipSpace()
                if (index >= bytes.size || at(index) != ':'.code) throw fail()
                index++
                skipSpace()
                members.add(JsonMember(key, value()))
                skipSpace()
                if (index >= bytes.size) throw fail()
                if (at(index) == ','.code) { index++; continue }
                if (at(index) != '}'.code) throw fail()
                index++
                return JsonValue.Object(members)
            }
        } finally {
            depth--
        }
    }

    private fun array(): JsonValue {
        depth++
        try {
            if (depth > MAX_DEPTH) throw fail()
            index++
            val items = ArrayList<JsonValue>()
            skipSpace()
            if (index < bytes.size && at(index) == ']'.code) { index++; return JsonValue.Array(items) }
            while (true) {
                skipSpace()
                items.add(value())
                skipSpace()
                if (index >= bytes.size) throw fail()
                if (at(index) == ','.code) { index++; continue }
                if (at(index) != ']'.code) throw fail()
                index++
                return JsonValue.Array(items)
            }
        } finally {
            depth--
        }
    }

    private fun string(): String {
        index++
        val raw = java.io.ByteArrayOutputStream()
        val start = index
        // The common case, a string with no escapes, is one slice of the input.
        while (true) {
            if (index >= bytes.size) throw fail()
            val byte = at(index)
            if (byte == '"'.code) { index++; return bytes.decodeToString(start, index - 1) }
            if (byte == '\\'.code || byte < 0x20) break
            index++
        }
        raw.write(bytes, start, index - start)
        while (true) {
            if (index >= bytes.size) throw fail()
            val byte = at(index)
            index++
            when {
                byte == '"'.code -> return raw.toByteArray().decodeToString()
                byte < 0x20 -> { index--; throw fail() }
                byte == '\\'.code -> {
                    if (index >= bytes.size) throw fail()
                    val escape = at(index)
                    index++
                    when (escape.toChar()) {
                        '"' -> raw.write('"'.code)
                        '\\' -> raw.write('\\'.code)
                        '/' -> raw.write('/'.code)
                        'b' -> raw.write(0x08)
                        'f' -> raw.write(0x0C)
                        'n' -> raw.write(0x0A)
                        'r' -> raw.write(0x0D)
                        't' -> raw.write(0x09)
                        'u' -> raw.write(String(Character.toChars(unicodeEscape())).encodeToByteArray())
                        else -> { index--; throw fail() }
                    }
                }
                else -> raw.write(byte)
            }
        }
    }

    /** What follows `\u`: four hex digits, and a second `\uXXXX` when the first is a high surrogate. A lone surrogate is U+FFFD. */
    private fun unicodeEscape(): Int {
        val first = hex4()
        if (first in 0xD800..0xDBFF) {
            if (index + 1 < bytes.size && at(index) == '\\'.code && at(index + 1) == 'u'.code) {
                val saved = index
                index += 2
                val second = hex4()
                if (second in 0xDC00..0xDFFF) return 0x10000 + ((first - 0xD800) shl 10) + (second - 0xDC00)
                index = saved
            }
            return 0xFFFD
        }
        return if (first in 0xDC00..0xDFFF) 0xFFFD else first
    }

    private fun hex4(): Int {
        if (index + 4 > bytes.size) throw fail()
        var value = 0
        repeat(4) {
            val digit = hexDigit(at(index)) ?: throw fail()
            value = value * 16 + digit
            index++
        }
        return value
    }

    private fun hexDigit(byte: Int): Int? = when (byte) {
        in 0x30..0x39 -> byte - 0x30
        in 0x61..0x66 -> byte - 0x61 + 10
        in 0x41..0x46 -> byte - 0x41 + 10
        else -> null
    }

    /** `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?` */
    private fun number(): Double {
        val start = index
        fun digits(): Int {
            var count = 0
            while (index < bytes.size && at(index) in 0x30..0x39) { index++; count++ }
            return count
        }
        if (index < bytes.size && at(index) == '-'.code) index++
        if (index >= bytes.size || at(index) !in 0x30..0x39) throw fail()
        if (at(index) == '0'.code) index++ else digits()
        if (index < bytes.size && at(index) == '.'.code) {
            index++
            if (digits() == 0) throw fail()
        }
        if (index < bytes.size && (at(index) == 'e'.code || at(index) == 'E'.code)) {
            index++
            if (index < bytes.size && (at(index) == '+'.code || at(index) == '-'.code)) index++
            if (digits() == 0) throw fail()
        }
        val value = bytes.decodeToString(start, index).toDouble()
        if (!value.isFinite()) {
            index = start
            throw fail()
        }
        return value
    }

    companion object {
        /** Deeper than any real mark; stops a damaged or hostile file from overflowing the stack. */
        const val MAX_DEPTH = 256
    }
}
