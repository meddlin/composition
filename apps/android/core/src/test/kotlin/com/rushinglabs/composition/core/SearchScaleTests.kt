package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.search.IndexedNote
import com.rushinglabs.composition.core.search.SearchIndex
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertTrue

// How typo search grows with the number of different words in the notes, which is what its cost depends on (each typed word is
// looked up against all of them). Ported from SearchScaleTests.swift: the generated notes are random pronounceable words, a larger
// and flatter vocabulary than real notes have. The 200 ms target is checked up to 20,000 different words; 100,000 runs when
// SEARCH_SCALE_FULL is set (and is printed, not checked).

@DisplayName("Search at scale")
class SearchScaleTests {
    /** SplitMix64, so a run is repeatable on every platform. */
    private class Seeded(private var state: Long) {
        fun next(): Long {
            state += -0x61c8864680b583ebL
            var z = state
            z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L
            z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L
            return z xor (z ushr 31)
        }

        fun int(range: IntRange): Int = range.first + java.lang.Long.remainderUnsigned(next(), (range.last - range.first + 1).toLong()).toInt()
        fun <T> pick(list: List<T>): T = list[int(list.indices)]
        fun bool(): Boolean = next() < 0
    }

    private val consonants = "bcdfghjklmnprstvwz".toList()
    private val vowels = "aeiou".toList()

    private fun makeWords(count: Int, random: Seeded): List<String> {
        val words = HashSet<String>()
        while (words.size < count) {
            val syllables = random.int(2..5)
            val word = (0 until syllables).joinToString("") { "${random.pick(consonants)}${random.pick(vowels)}" } + (if (random.bool()) random.pick(consonants).toString() else "")
            words.add(word)
        }
        return words.sorted()
    }

    /** One edit in the middle of the word (the first letter costs two, which a plain one-edit test should not hit). */
    private fun misspelt(word: String, random: Seeded): String {
        val letters = word.toCharArray()
        val i = random.int(1 until letters.size)
        letters[i] = if (letters[i] == 'x') 'q' else 'x'
        return String(letters)
    }

    private fun run(distinctWords: Int, checked: Boolean) {
        val random = Seeded(distinctWords.toLong())
        val pool = makeWords(distinctWords, random)
        withScratch { scratch ->
            SearchIndex.open(File(scratch, "search.db")).use { index ->
                // 1,000 notes of 120 words each, drawn so that every word of the pool appears somewhere.
                val notes = ArrayList<IndexedNote>()
                var cursor = 0
                for (id in 1..1000) {
                    val words = ArrayList<String>()
                    repeat(120) { words.add(pool[cursor % pool.size]); cursor += 1 + random.int(0..maxOf(1, pool.size / 400)) }
                    val title = (0 until 3).joinToString(" ") { random.pick(pool) }
                    notes.add(IndexedNote(id.toLong(), title, "", words.joinToString(" "), "", "2026-01-01T00:00:00.000Z", Timestamp.string(1_767_225_600_000 + id * 1000L)))
                }
                val built = System.nanoTime()
                index.upsert(notes)
                val buildMs = (System.nanoTime() - built) / 1e6

                val queries = ArrayList<String>()
                val longWords = pool.filter { it.length >= 5 }
                repeat(60) {
                    val word = random.pick(longWords)
                    queries += listOf(word, misspelt(word, random), word.take(4), word + " " + random.pick(pool), misspelt(word, random) + " " + random.pick(pool).take(3))
                }
                val first = System.nanoTime()
                index.search(queries[0])
                val firstMs = (System.nanoTime() - first) / 1e6
                val timings = queries.map { query ->
                    val start = System.nanoTime()
                    index.search(query)
                    query to (System.nanoTime() - start) / 1e6
                }
                val sorted = timings.map { it.second }.sorted()
                val slowest = timings.maxBy { it.second }
                println(String.format(Locale.ROOT, "Search scale: %7d different words, 1,000 notes: indexed in %6.0f ms; first search %6.1f ms; %d searches: median %5.1f ms, 95th %5.1f ms, slowest %6.1f ms (\"%s\")",
                    distinctWords, buildMs, firstMs, timings.size, sorted[sorted.size / 2], sorted[sorted.size * 95 / 100], slowest.second, slowest.first))
                if (checked) assertTrue(slowest.second < 200, "every query under 200 ms with $distinctWords different words (slowest: \"${slowest.first}\")")
            }
        }
    }

    @Test
    @DisplayName("answers in well under 200 ms with 2,000 different words")
    fun twoThousandWords() = run(2_000, checked = true)

    @Test
    @DisplayName("answers in well under 200 ms with 20,000 different words")
    fun twentyThousandWords() = run(20_000, checked = true)

    @Test
    @DisplayName("reports how it does with 100,000 different words (when SEARCH_SCALE_FULL is set)")
    fun hundredThousandWords() {
        skipUnless(System.getenv("SEARCH_SCALE_FULL") != null, "SEARCH_SCALE_FULL is not set")
        run(100_000, checked = false)
    }
}
