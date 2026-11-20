package com.rushinglabs.composition.core.search

import com.rushinglabs.composition.core.Timestamp

// The search bar's `field: value` syntax, parsed the way `searchQuery.ts` does it, character for character (ported from
// SearchQuery.swift). Pure, so it is safe to run on every keystroke. The rules are in docs/architecture/search.md; the conformance
// test runs every query in fixtures/conformance/search-queries.json through the desktop's parser and compares.

/** A condition on a note: the parsed form of `tag:` and the date fields. */
sealed interface SearchFilter {
    enum class DateField(val rawValue: String) { CREATED("created_at_ts"), UPDATED("updated_at_ts") }

    data class Tag(val value: String) : SearchFilter
    /** `field >= seconds`, in whole seconds since 1970. */
    data class AtLeast(val field: DateField, val seconds: Long) : SearchFilter
    /** `field < seconds`. */
    data class Before(val field: DateField, val seconds: Long) : SearchFilter

    /** The clause in the form the desktop hands to Meilisearch, which is what the conformance test compares. */
    val meilisearchClause: String
        get() = when (this) {
            is Tag -> "tags = \"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
            // `this.field`: a bare `field` in a getter would be the property's own backing field.
            is AtLeast -> "${this.field.rawValue} >= $seconds"
            is Before -> "${this.field.rawValue} < $seconds"
        }
}

data class ParsedSearchQuery(
    /** Free text to search for. May be empty. */
    val text: String,
    /** Every one must hold. */
    val filters: List<SearchFilter>,
    /** Restricts which attributes `text` is matched against (`title`, `description`); null means all. */
    val attributes: List<String>?,
) {
    val meilisearchFilters: List<String> get() = filters.map { it.meilisearchClause }
}

object SearchQueryParser {
    private sealed interface Field {
        data object Tag : Field
        data class Text(val attribute: String) : Field
        data class Date(val field: SearchFilter.DateField) : Field
    }

    // Lowercased aliases. The frontmatter names (`createdAt`) and the CLI's (`createdOn`) both work. Insertion order is kept, as
    // the first key that matches wins (none is a prefix of another followed by a colon, so the order does not change a result).
    private val fields: Map<String, Field> = linkedMapOf(
        "tag" to Field.Tag, "tags" to Field.Tag,
        "title" to Field.Text("title"), "description" to Field.Text("description"),
        "created" to Field.Date(SearchFilter.DateField.CREATED), "createdat" to Field.Date(SearchFilter.DateField.CREATED),
        "createdon" to Field.Date(SearchFilter.DateField.CREATED),
        "updated" to Field.Date(SearchFilter.DateField.UPDATED), "updatedat" to Field.Date(SearchFilter.DateField.UPDATED),
        "updatedon" to Field.Date(SearchFilter.DateField.UPDATED),
    )
    private val keys: List<IntArray> = fields.keys.map { it.codePoints().toArray() }

    /** JavaScript's `\s` (and `trim`). */
    fun isSpace(c: Int): Boolean = c in 0x09..0x0D || c == 0x20 || c == 0xA0 || c == 0x1680 || c in 0x2000..0x200A ||
        c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF

    private fun text(s: IntArray, from: Int, until: Int): String {
        val builder = StringBuilder()
        for (index in from until until) builder.appendCodePoint(s[index])
        return builder.toString()
    }

    private fun trimmed(s: IntArray, from: Int, until: Int): String {
        var start = from
        var end = until
        while (start < end && isSpace(s[start])) start++
        while (end > start && isSpace(s[end - 1])) end--
        return text(s, start, end)
    }

    /** ASCII lowercasing is enough: every key is ASCII, and a non-ASCII letter must not turn into one (`K`, the Kelvin sign). */
    private fun lowercased(c: Int) = if (c in 0x41..0x5A) c + 0x20 else c

    private fun keyMatches(s: IntArray, at: Int, key: IntArray) =
        at + key.size < s.size && s[at + key.size] == ':'.code && key.indices.all { lowercased(s[at + it]) == key[it] }

    /** A key at `index` followed by its colon (`^(key):\s*`): the field and the index past the colon and any spaces after it. */
    private fun key(s: IntArray, index: Int): Pair<Field, Int>? {
        for (key in keys) {
            if (!keyMatches(s, index, key)) continue
            var next = index + key.size + 1
            while (next < s.size && isSpace(s[next])) next++
            return fields.getValue(String(key, 0, key.size)) to next
        }
        return null
    }

    /** `\s(?:key):` first occurring at or after `from`: the index of that space, or null. */
    private fun nextKey(s: IntArray, from: Int): Int? {
        var i = from
        while (i < s.size) {
            if (isSpace(s[i]) && i + 1 < s.size && keys.any { keyMatches(s, i + 1, it) }) return i
            i++
        }
        return null
    }

    /**
     * The value after a `key:`. A leading double quote delimits it (`tags:"web development"`); otherwise it runs up to the next
     * `key:` or the end of the input. Returns the value and the index just past it.
     */
    private fun readValue(s: IntArray, from: Int): Pair<String, Int> {
        if (from < s.size && s[from] == '"'.code) {
            var close = from + 1
            while (close < s.size && s[close] != '"'.code) close++
            if (close < s.size) return trimmed(s, from + 1, close) to close + 1
            return trimmed(s, minOf(from + 1, s.size), s.size) to s.size
        }
        val end = nextKey(s, from) ?: s.size
        return trimmed(s, minOf(from, s.size), end) to end
    }

    /** `[op]YYYY-MM-DD` over a unix-seconds field, or null if it is not that or not a real date. */
    private fun dateFilters(field: SearchFilter.DateField, raw: String): List<SearchFilter>? {
        var rest = raw
        var op = "="
        for (candidate in listOf(">=", "<=", ">", "<", "=")) {
            if (rest.startsWith(candidate)) {
                op = candidate
                rest = rest.substring(candidate.length)
                break
            }
        }
        if (rest.codePointCount(0, rest.length) != 10 || rest.length != 10 || rest[4] != '-' || rest[7] != '-') return null
        fun digits(from: Int, until: Int): Long? {
            var value = 0L
            for (i in from until until) {
                if (rest[i] !in '0'..'9') return null
                value = value * 10 + (rest[i] - '0')
            }
            return value
        }
        var year = digits(0, 4) ?: return null
        val month = digits(5, 7) ?: return null
        val day = digits(8, 10) ?: return null
        // JavaScript's Date.UTC reads the years 0 to 99 as 1900 to 1999.
        if (year < 100) year += 1900
        // Date.UTC rolls 2026-02-31 over to March; that is malformed here, not a date.
        if (month !in 1..12 || day < 1 || day > Timestamp.daysInMonth(year, month)) return null
        val start = Timestamp.daysFromCivil(year, month, day) * 86_400
        val end = start + 86_400
        return when (op) {
            ">" -> listOf(SearchFilter.AtLeast(field, end))
            ">=" -> listOf(SearchFilter.AtLeast(field, start))
            "<" -> listOf(SearchFilter.Before(field, start))
            "<=" -> listOf(SearchFilter.Before(field, end))
            else -> listOf(SearchFilter.AtLeast(field, start), SearchFilter.Before(field, end))
        }
    }

    fun parse(raw: String): ParsedSearchQuery {
        val s = raw.codePoints().toArray()
        val filters = ArrayList<SearchFilter>()
        val textAttributes = ArrayList<String>()
        val textValues = ArrayList<String>()
        val freeText = ArrayList<String>()

        var i = 0
        while (i < s.size) {
            if (isSpace(s[i])) { i++; continue }
            // Every iteration starts at a word boundary: the start, or just past whitespace or a value.
            val found = key(s, i)
            if (found == null) {
                var end = i
                while (end < s.size && !isSpace(s[end])) end++
                freeText.add(trimmed(s, i, end))
                i = end
                continue
            }
            val (value, end) = readValue(s, found.second)
            val consumed = trimmed(s, i, end)
            i = end

            // A half-typed `tags:` has no value yet: ignore it rather than searching for the word "tags:".
            if (value.isEmpty()) continue

            when (val field = found.first) {
                Field.Tag -> filters.add(SearchFilter.Tag(value))
                is Field.Text -> {
                    if (field.attribute !in textAttributes) textAttributes.add(field.attribute)
                    textValues.add(value)
                }
                // A malformed date stays literal text, so a half-typed date finds nothing instead of silently dropping the constraint.
                is Field.Date -> dateFilters(field.field, value)?.let { filters.addAll(it) } ?: freeText.add(consumed)
            }
        }

        val text = (textValues + freeText).map { val cp = it.codePoints().toArray(); trimmed(cp, 0, cp.size) }.filter { it.isNotEmpty() }.joinToString(" ")
        return ParsedSearchQuery(collapseSpaces(text), filters, textAttributes.ifEmpty { null })
    }

    /** `.replace(/\s+/g, " ")` */
    private fun collapseSpaces(text: String): String {
        val out = StringBuilder()
        var previousWasSpace = false
        text.codePoints().forEach { c ->
            if (isSpace(c)) {
                if (!previousWasSpace) out.append(' ')
                previousWasSpace = true
            } else {
                out.appendCodePoint(c)
                previousWasSpace = false
            }
        }
        return out.toString()
    }
}
