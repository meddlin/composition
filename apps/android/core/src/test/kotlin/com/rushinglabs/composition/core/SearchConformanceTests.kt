package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.search.SearchIndex
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertTrue

// The iPad's spike S2 acceptance test, ported from SearchConformanceTests.swift: the search against a real Meilisearch, over the
// notes of `pnpm search:playground` and the queries in fixtures/conformance/search-queries.json. Meilisearch's answers are committed
// (search-expected.json) and were produced through the desktop's own searchIndex.ts. The pass criteria are the iPad's:
//   A  Queries with no typos: the same set of results as Meilisearch wherever it returned fewer than the cap of 50, and on average at
//      least 8 of its top 10 among ours.
//   B  Queries with typos: nothing Meilisearch finds is missed.
//   C  Every query answers in under 200 ms on 1,000 notes.

@DisplayName("Search against Meilisearch")
class SearchConformanceTests {
    private class Comparison(val group: String, val query: String, val meilisearch: List<Long>, val ours: List<Long>) {
        val setEqual get() = meilisearch.toSet() == ours.toSet()
        val capped get() = meilisearch.size >= SearchIndex.RESULT_LIMIT
        val recall get() = if (meilisearch.isEmpty()) 1.0 else meilisearch.toSet().intersect(ours.toSet()).size.toDouble() / meilisearch.size
        val topTenOverlap: Double
            get() {
                val theirs = meilisearch.take(10).toSet()
                return if (theirs.isEmpty()) 1.0 else theirs.intersect(ours.take(10).toSet()).size.toDouble() / theirs.size
            }
    }

    private val typoGroupPrefixes = listOf("typo", "too short")

    private fun groups(directory: File): List<Pair<String, List<String>>> =
        readJson(File(directory, "search-queries.json")).jsonObject.getValue("groups").jsonArray.map { group ->
            val obj = group.jsonObject
            obj.getValue("name").jsonPrimitive.content to obj.getValue("queries").jsonArray.map { it.jsonPrimitive.content }
        }

    private fun answers(directory: File, corpus: String): Map<String, List<Long>> {
        val expected = readJson(File(directory, "search-expected.json")).jsonObject
        return expected.getValue("corpora").jsonObject.getValue(corpus).jsonObject.getValue("results").jsonArray.associate { result ->
            val obj = result.jsonObject
            obj.getValue("query").jsonPrimitive.content to obj.getValue("ids").jsonArray.map { it.jsonPrimitive.long }
        }
    }

    /** A search index over a copy of the generated notes. */
    private fun <T> withIndex(corpus: String, directory: File, scratch: File, body: (SearchIndex) -> T): T {
        val folder = File(scratch, UUID.randomUUID().toString()).apply { mkdirs() }
        val copy = File(folder, "composition.db")
        File(directory, "search-corpus-$corpus.db").copyTo(copy)
        return CompositionDatabase.open(copy).use { database ->
            SearchIndex.open(File(folder, "search.db")).use { index ->
                index.rebuild(database)
                body(index)
            }
        }
    }

    private fun compare(corpus: String, directory: File, index: SearchIndex): List<Comparison> {
        val answers = answers(directory, corpus)
        return groups(directory).flatMap { (group, queries) -> queries.map { Comparison(group, it, answers[it] ?: emptyList(), index.search(it)) } }
    }

    @Test
    @DisplayName("the 100-note corpus: the same results as Meilisearch where no typo is involved, and nothing missed where one is")
    fun acceptance() {
        val directory = requireConformance()
        withScratch { scratch ->
            val all = withIndex("100", directory, scratch) { compare("100", directory, it) }
            val exact = all.filter { c -> typoGroupPrefixes.none { c.group.startsWith(it) } && !c.group.startsWith("phrase") }
            val typos = all.filter { it.group.startsWith("typo") }

            // A: no typos
            val uncapped = exact.filter { !it.capped }
            val different = uncapped.filter { !it.setEqual }
            val withTen = exact.filter { it.meilisearch.size >= 10 }.map { it.topTenOverlap }
            val topTen = withTen.sum() / maxOf(withTen.size, 1)
            println("Search A: same set as Meilisearch for ${uncapped.size - different.size} of ${uncapped.size} exact queries; mean top-10 overlap ${"%.2f".format(Locale.ROOT, topTen)} over ${withTen.size} queries")
            for (c in different.take(20)) println("  differs: \"${c.query}\" [${c.group}] meili ${c.meilisearch.size}, ours ${c.ours.size}; missing ${(c.meilisearch - c.ours.toSet()).take(6)} extra ${(c.ours - c.meilisearch.toSet()).take(6)}")

            // B: typos
            val missed = typos.filter { !it.capped && it.recall < 1 }
            println("Search B: typo queries that miss something Meilisearch finds: ${missed.size} of ${typos.size}")
            for (c in missed.take(20)) println("  misses: \"${c.query}\" ${(c.meilisearch - c.ours.toSet()).sorted()}")
            println("Search, all ${all.size} queries: same set ${all.count { !it.capped && it.setEqual }} of ${all.count { !it.capped }} uncapped; mean recall ${"%.3f".format(Locale.ROOT, all.filter { it.meilisearch.isNotEmpty() }.map { it.recall }.average())}")

            assertTrue(different.isEmpty(), "A: every exact query finds Meilisearch's set (${different.size} differ)")
            assertTrue(topTen >= 0.8, "A: at least 8 of Meilisearch's top 10 in ours")
            assertTrue(missed.isEmpty(), "B: nothing Meilisearch finds is missed (${missed.size} miss)")
        }
    }

    @Test
    @DisplayName("the 1,000-note corpus: answer every query in under 200 ms")
    fun scaleAndSpeed() {
        val directory = requireConformance()
        withScratch { scratch ->
            val started = System.nanoTime()
            withIndex("1000", directory, scratch) { index ->
                val buildMs = (System.nanoTime() - started) / 1e6
                val queries = groups(directory).flatMap { it.second }
                val firstStart = System.nanoTime()
                index.search("kubernetes")  // the first search of a run reads the vocabulary
                val firstMs = (System.nanoTime() - firstStart) / 1e6
                val timings = ArrayList<Pair<String, Double>>()
                repeat(3) {
                    for (query in queries) {
                        val start = System.nanoTime()
                        index.search(query)
                        timings.add(query to (System.nanoTime() - start) / 1e6)
                    }
                }
                val sorted = timings.map { it.second }.sorted()
                val slowest = timings.maxBy { it.second }
                println(String.format(Locale.ROOT, "Search speed, 1,000 notes: index built in %.0f ms; first search %.1f ms; %d searches: median %.1f ms, 95th %.1f ms, slowest %.1f ms (\"%s\")",
                    buildMs, firstMs, timings.size, sorted[sorted.size / 2], sorted[sorted.size * 95 / 100], slowest.second, slowest.first))
                val all = compare("1000", directory, index)
                println("Search, 1,000 notes: same set ${all.count { !it.capped && it.setEqual }} of ${all.count { !it.capped }} uncapped queries (most hit the cap of 50)")
                assertTrue(slowest.second < 200, "C: every query under 200 ms (slowest: \"${slowest.first}\")")
            }
        }
    }
}
