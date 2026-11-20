package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.search.ParsedSearchQuery
import com.rushinglabs.composition.core.search.SearchFilter
import com.rushinglabs.composition.core.search.SearchQueryParser
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The search bar's syntax, ported from SearchQueryTests.swift: the cases written by hand, then every query in
// fixtures/conformance/search-queries.json against what the desktop's real `parseSearchQuery` made of it.

@DisplayName("Search query syntax")
class SearchQueryTests {
    private fun parse(raw: String) = SearchQueryParser.parse(raw)

    @Test
    @DisplayName("free text stays free text")
    fun freeText() {
        assertEquals(ParsedSearchQuery("kubernetes deep", emptyList(), null), parse("  kubernetes   deep  "))
        assertTrue(parse("").text == "" && parse("   ").text == "")
    }

    @Test
    @DisplayName("an unquoted value runs up to the next field, so a tag can be several words")
    fun values() {
        assertEquals(listOf("tags = \"web development\""), parse("tags: web development").meilisearchFilters)
        assertEquals(ParsedSearchQuery("async", listOf(SearchFilter.Tag("web development")), null), parse("async tags: web development"))
        assertEquals("async", parse("tags:\"web development\" async").text)
        // The text after a value belongs to the value, so this date is "2026-01-01 roadmap": malformed, kept as text.
        val trailing = parse("tag: infra created: >=2026-01-01 roadmap")
        assertEquals(listOf<SearchFilter>(SearchFilter.Tag("infra")), trailing.filters)
        assertEquals("created: >=2026-01-01 roadmap", trailing.text)
        assertEquals("roadmap", parse("roadmap tag: infra created: >=2026-01-01").text, "put free text first instead")
    }

    @Test
    @DisplayName("keys are case-insensitive, may be written as the frontmatter names, and only count at a word boundary")
    fun keys() {
        assertEquals(listOf<SearchFilter>(SearchFilter.Tag("Software")), parse("TAGS: Software").filters)
        assertTrue(parse("createdAt: >2026-01-01").filters.size == 1 && parse("createdOn: >2026-01-01").filters.size == 1)
        assertEquals("metatag:x", parse("metatag:x").text, "the tag: inside another word is plain text")
        assertEquals("http://tag:foo", parse("http://tag:foo").text)
        assertEquals(listOf("title"), parse("title:docker").attributes)
        assertEquals("docker", parse("title:docker").text)
    }

    @Test
    @DisplayName("title and description scope the text to those attributes and join with the rest of it")
    fun attributes() {
        val parsed = parse("title: kubernetes description: ownership notes")
        assertEquals(listOf("title", "description"), parsed.attributes)
        assertEquals("kubernetes ownership notes", parsed.text, "each value runs to the next field")
    }

    @Test
    @DisplayName("a field with no value yet is ignored")
    fun halfTyped() {
        for (raw in listOf("tag:", "tags:  ", "title:", "created:")) assertEquals(ParsedSearchQuery("", emptyList(), null), parse(raw), raw)
        // A second key right after the first has no space before it, so it is the first one's value.
        assertEquals(listOf<SearchFilter>(SearchFilter.Tag("created:")), parse("tag: created:").filters)
    }

    @Test
    @DisplayName("dates: a bare date is the whole UTC day; operators move the bounds; a malformed date stays as text")
    fun dates() {
        // 2026-08-01 is 1_785_542_400 seconds after 1970.
        assertEquals(listOf("created_at_ts >= 1785542400", "created_at_ts < 1785628800"), parse("created: 2026-08-01").meilisearchFilters)
        assertEquals(parse("created: 2026-08-01").meilisearchFilters, parse("created: =2026-08-01").meilisearchFilters)
        assertEquals(listOf("created_at_ts >= 1785628800"), parse("created: >2026-08-01").meilisearchFilters)
        assertEquals(listOf("created_at_ts >= 1785542400"), parse("created: >=2026-08-01").meilisearchFilters)
        assertEquals(listOf("updated_at_ts < 1785542400"), parse("updated: <2026-08-01").meilisearchFilters)
        assertEquals(listOf("updated_at_ts < 1785628800"), parse("updated: <=2026-08-01").meilisearchFilters)
        for (bad in listOf("created: 2026-02-31", "created: tomorrow", "created: >2026-13-01", "created: 2026-1-1")) {
            assertTrue(parse(bad).filters.isEmpty() && parse(bad).text == bad, "$bad finds nothing instead of dropping the constraint")
        }
        assertEquals(2, parse("created: 2024-02-29").filters.size, "a real leap day")
    }

    @Test
    @DisplayName("JavaScript's whitespace, not Kotlin's, separates words")
    fun whitespace() {
        assertEquals("a b", parse("a b").text, "a no-break space is a space to JavaScript")
        assertEquals("a\u0085b", parse("a\u0085b").text, "NEL is not")
        assertEquals("a b", parse("a﻿b").text)
    }
}

@DisplayName("Search query syntax against the desktop")
class SearchQueryConformanceTests {
    @Test
    @DisplayName("makes the same text, filters and attributes for every query")
    fun sameAsDesktop() {
        val expected = readJson(File(requireConformance(), "search-parse-expected.json")).jsonObject
        assertTrue(expected.size > 200)
        val different = ArrayList<String>()
        for ((query, desktop) in expected.entries.sortedBy { it.key }) {
            val want = desktop.jsonObject
            val ours = SearchQueryParser.parse(query)
            val attributes = want["attributesToSearchOn"].let { if (it == null || it == JsonNull) null else (it as JsonArray).map { a -> a.jsonPrimitive.content } }
            if (ours.text != want.getValue("text").jsonPrimitive.content) different.add("text of \"$query\": ${ours.text}")
            if (ours.meilisearchFilters != want.getValue("filters").jsonArray.map { it.jsonPrimitive.content }) different.add("filters of \"$query\": ${ours.meilisearchFilters}")
            if (ours.attributes != attributes) different.add("attributes of \"$query\": ${ours.attributes}")
        }
        println("Search query syntax: ${expected.size - different.size} of ${expected.size} queries parsed as the desktop parses them")
        different.forEach(::println)
        assertTrue(different.isEmpty(), "queries that differ: ${different.size}")
    }
}
