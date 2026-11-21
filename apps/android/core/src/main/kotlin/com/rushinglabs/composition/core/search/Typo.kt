package com.rushinglabs.composition.core.search

import java.text.Normalizer
import java.util.Locale

// How far a typed word may be from a word in the notes and still count as a match: Meilisearch's rules (measured against
// version 1.53.1 for the iPad's spike S2; ported from TypoMatching.swift). The budget depends on the typed word's length, a swapped
// pair of neighbouring letters is one edit, and the word being typed (the last one) also matches as the start of a longer word. A
// wrong, missing or extra *first letter* costs two edits, not one, so only a word long enough to be allowed two (9 letters) can
// have one: `xubernetes` finds Kubernetes and `ocker` does not find Docker.

internal object Typo {
    /** Edits allowed in a word of `length` letters: none up to 4, one for 5 to 8, two from 9. */
    fun budget(length: Int) = if (length >= 9) 2 else if (length >= 5) 1 else 0

    /** How forgiving a search is of mistakes. The first is Meilisearch's, which the desktop uses; the others are this app's own. */
    data class Rules(
        /** What a wrong, missing or extra first letter costs, in edits. Meilisearch counts it as two. */
        val firstLetterCost: Int,
        /** Whether a word of 3 or 4 letters is allowed one mistake (Meilisearch allows none up to 4). */
        val shortWordsGetOne: Boolean,
    ) {
        fun budget(length: Int) = if (shortWordsGetOne && length in 3..4) 1 else Typo.budget(length)

        companion object {
            val MEILISEARCH = Rules(2, false)
            /** A first-letter mistake costs one edit, like any other. */
            val FORGIVING = Rules(1, false)
            /** What `FORGIVING` falls back to when a search finds nothing: short words may have a mistake too. */
            val FORGIVING_FALLBACK = Rules(1, true)
        }
    }

    private val marks = Regex("\\p{Mn}+")

    /**
     * Words as lowercase, diacritic-free text, which is how the index stores them (FTS5 `unicode61 remove_diacritics 2`). The iPad
     * folds with Foundation's case- and diacritic-insensitive folding; here, decomposition with the marks removed, then lowercase.
     */
    fun fold(text: String): String = marks.replace(Normalizer.normalize(text, Normalizer.Form.NFD), "").lowercase(Locale.ROOT)

    /** Unicode letters, marks and numbers: Foundation's `CharacterSet.alphanumerics`. */
    private fun isAlphanumeric(c: Int): Boolean = when (Character.getType(c).toByte()) {
        Character.UPPERCASE_LETTER, Character.LOWERCASE_LETTER, Character.TITLECASE_LETTER, Character.MODIFIER_LETTER,
        Character.OTHER_LETTER, Character.NON_SPACING_MARK, Character.ENCLOSING_MARK, Character.COMBINING_SPACING_MARK,
        Character.DECIMAL_DIGIT_NUMBER, Character.LETTER_NUMBER, Character.OTHER_NUMBER -> true
        else -> false
    }

    /** The runs of letters and digits in `text`, folded: where the index splits words too. */
    fun words(text: String): List<String> {
        val words = ArrayList<String>()
        val current = StringBuilder()
        fold(text).codePoints().forEach { c ->
            if (isAlphanumeric(c)) current.appendCodePoint(c) else if (current.isNotEmpty()) {
                words.add(current.toString())
                current.clear()
            }
        }
        if (current.isNotEmpty()) words.add(current.toString())
        return words
    }

    /** The edit distance from `word` to `term`, where swapping two neighbouring letters counts once, or null if it is over `limit`. */
    fun distance(word: IntArray, term: IntArray, limit: Int, firstLetterCost: Int = 2): Int? {
        if (kotlin.math.abs(word.size - term.size) > limit) return null
        return search(word, term, limit, prefix = false, first = firstLetterCost)?.first
    }

    /**
     * The smallest edit distance from `word` to any start of `term`, with the shortest such start, or null if it is over `limit`.
     * This is how the word being typed matches: `kubernet` is 0 from `kubernetes`.
     */
    fun prefixDistance(word: IntArray, term: IntArray, limit: Int, firstLetterCost: Int = 2): Pair<Int, Int>? {
        if (term.size + limit < word.size) return null
        return search(word, term, limit, prefix = true, first = firstLetterCost)
    }

    /**
     * Optimal string alignment distance over three rolling rows, giving up once no cell can come back under `limit`. Any edit at
     * the first letter of `a` costs `first`.
     */
    private fun search(a: IntArray, b: IntArray, limit: Int, prefix: Boolean, first: Int): Pair<Int, Int>? {
        val m = a.size
        val n = b.size
        var older = IntArray(n + 1)
        var previous = IntArray(n + 1) { if (it == 0) 0 else it - 1 + first }
        var current = IntArray(n + 1)
        var previousMinimum = 0

        if (m == 0) return if (prefix) 0 to 0 else if (n <= limit) n to n else null
        for (i in 1..m) {
            current[0] = i - 1 + first
            var minimum = i - 1 + first
            for (j in 1..n) {
                val substitution = if (a[i - 1] == b[j - 1]) 0 else if (i == 1) first else 1
                var best = minOf(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitution)
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) best = minOf(best, older[j - 2] + (if (i == 2) first else 1))
                current[j] = best
                if (best < minimum) minimum = best
            }
            // Cells only ever grow from the rows above, so once two rows in a row are all over the limit, it is over.
            if (minimum > limit && previousMinimum > limit) return null
            previousMinimum = minimum
            val spare = older
            older = previous
            previous = current
            current = spare
        }
        if (!prefix) return if (previous[n] <= limit) previous[n] to n else null
        var bestDistance = Int.MAX_VALUE
        var bestLength = 0
        for (j in 0..n) if (previous[j] < bestDistance) { bestDistance = previous[j]; bestLength = j }
        return if (bestDistance <= limit) bestDistance to bestLength else null
    }
}
