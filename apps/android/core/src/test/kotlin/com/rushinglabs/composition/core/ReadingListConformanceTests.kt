package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.readinglist.PluginSettings
import com.rushinglabs.composition.core.readinglist.ReadingItem
import com.rushinglabs.composition.core.readinglist.ReadingLinks
import com.rushinglabs.composition.core.readinglist.ReadingListException
import com.rushinglabs.composition.core.readinglist.addReadingItem
import com.rushinglabs.composition.core.readinglist.deleteReadingItem
import com.rushinglabs.composition.core.readinglist.readingItems
import com.rushinglabs.composition.core.readinglist.setReadingItemRead
import com.rushinglabs.composition.core.readinglist.setReadingItemTitle
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.Instant
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The Reading List against the desktop's own code, ported from ReadingListConformanceTests.swift. fixtures/conformance/reading-list.json
// holds what `readingList.ts`, `webSettings.ts` and `readingListService.ts` make of a long list of inputs and of one session on a fresh
// database (apps/web/src/lib/composition/readingListConformance.test.ts writes it, and fails when the desktop no longer makes the same
// file). The file is committed, so a plain `./gradlew :core:test` replays it. Each test gathers every difference before failing.

private val corpus: JsonObject? = corpusDirectory?.let { File(it, "reading-list.json") }?.takeIf { it.isFile }?.let { readJson(it).jsonObject }

private fun section(name: String): List<JsonObject> {
    skipUnless(corpus != null, "fixtures/conformance/reading-list.json is not there")
    return corpus!!.getValue(name).jsonArray.map { it.jsonObject }
}

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it != JsonNull && it.isString }?.content

/** A short form of a long input, for a failure message: anything but printable ASCII as `\u{…}`. */
private fun shown(text: String): String {
    val escaped = buildString {
        for (point in text.codePoints()) {
            if (point in 0x20..0x7E) appendCodePoint(point) else append(String.format(Locale.ROOT, "\\u{%X}", point))
        }
    }
    return if (escaped.length > 90) escaped.take(60) + "\u2026(${text.length} units)" else escaped
}

private fun itemJson(item: ReadingItem): JsonElement = JsonObject(
    mapOf(
        "id" to JsonPrimitive(item.id), "url" to JsonPrimitive(item.url), "title" to JsonPrimitive(item.title),
        "read" to JsonPrimitive(item.read), "createdAt" to JsonPrimitive(item.createdAt), "updatedAt" to JsonPrimitive(item.updatedAt),
    ),
)

@DisplayName("The Reading List against the desktop")
class ReadingListConformanceTests {
    private fun report(what: String, total: Int, different: List<String>) {
        println("Reading List, $what: ${total - different.size} of $total agree with the desktop")
        different.take(40).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "$what that differ: ${different.size}")
    }

    @Test
    @DisplayName("the limits, and the plugin is off until someone turns it on")
    fun constants() {
        skipUnless(corpus != null, "fixtures/conformance/reading-list.json is not there")
        val constants = corpus!!.getValue("constants").jsonObject
        assertEquals(constants.getValue("maxUrlLength").jsonPrimitive.long, ReadingLinks.MAX_URL_LENGTH.toLong())
        assertEquals(constants.getValue("maxTitleLength").jsonPrimitive.long, ReadingLinks.MAX_TITLE_LENGTH.toLong())
        assertEquals(constants["enabledWithoutAChoice"] == JsonPrimitive(true), PluginSettings.readingListEnabled(null))
    }

    @Test
    @DisplayName("every link is stored as the desktop stores it, or refused with the desktop's words")
    fun urls() {
        val cases = section("urls")
        assertTrue(cases.size > 150)
        val different = ArrayList<String>()
        for (entry in cases) {
            val input = entry["input"].text()!!
            val got = when (val result = ReadingLinks.normalize(input)) {
                is ReadingLinks.Normalized.Link -> "url " + result.url
                is ReadingLinks.Normalized.Refused -> "error " + result.problem.message
            }
            val expected = entry["url"].text()?.let { "url $it" } ?: ("error " + (entry["error"].text() ?: "?"))
            if (got != expected) different.add("${shown(input)}: ours ${shown(got)}, desktop ${shown(expected)}")
        }
        report("links", cases.size, different)
    }

    @Test
    @DisplayName("a link is called by its host until its page says otherwise")
    fun hostLabels() {
        val different = ArrayList<String>()
        val hosts = section("hostLabels")
        for (entry in hosts) {
            val url = entry["url"].text()!!
            val got = ReadingLinks.hostLabel(url)
            if (got != entry["label"].text()) different.add("${shown(url)}: ours ${shown(got)}, desktop ${entry["label"]}")
        }
        val labels = section("labels")
        for (entry in labels) {
            val url = entry["url"].text()!!
            val title = entry["title"].text()!!
            val got = ReadingLinks.label(url, title)
            if (got != entry["label"].text()) different.add("${shown(url)} ${shown(title)}: ours ${shown(got)}, desktop ${entry["label"]}")
        }
        report("labels", hosts.size + labels.size, different)
    }

    @Test
    @DisplayName("a page title is stored on one line, trimmed and cut, as on the desktop")
    fun titles() {
        val cases = section("titles")
        val different = ArrayList<String>()
        for (entry in cases) {
            val title = entry["title"].text()!!
            val got = ReadingLinks.cleanTitle(title)
            if (got != entry["cleaned"].text()) different.add("${shown(title)}: ours ${got?.let(::shown)}, desktop ${entry["cleaned"]}")
        }
        report("titles", cases.size, different)
    }

    @Test
    @DisplayName("unread links come first, then read ones, each oldest first")
    fun sorting() {
        val cases = section("sorting")
        val different = ArrayList<String>()
        for ((index, entry) in cases.withIndex()) {
            val items = entry.getValue("items").jsonArray.map { element ->
                val item = element.jsonObject
                ReadingItem(item.getValue("id").jsonPrimitive.long, "", read = item["read"] == JsonPrimitive(true))
            }
            val expected = entry.getValue("sorted").jsonArray.map { it.jsonPrimitive.long }
            val got = ReadingLinks.sorted(items).map { it.id }
            if (got != expected) different.add("list $index: ours $got, desktop $expected")
        }
        report("sorted lists", cases.size, different)
    }

    @Test
    @DisplayName("a settings file has the Reading List on only when it says true")
    fun plugins() {
        val cases = section("plugins")
        val different = ArrayList<String>()
        for (entry in cases) {
            val got = PluginSettings.readingListEnabled(entry["plugins"])
            val want = entry["enabled"] == JsonPrimitive(true)
            if (got != want) different.add("${entry["plugins"]}: ours $got, desktop $want")
        }
        report("settings files", cases.size, different)
    }

    @Test
    @DisplayName("a session through the store returns and stores what the desktop's service did, step by step")
    fun script() {
        val steps = section("script")
        assertTrue(steps.size > 20)
        val different = ArrayList<String>()
        withScratch { scratch ->
            CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
                for ((index, step) in steps.withIndex()) {
                    val op = step["op"].text()!!
                    val at = Instant.ofEpochMilli(Timestamp.milliseconds(step["at"].text()!!)!!)
                    val id = (step["id"] as? JsonPrimitive)?.long ?: 0L
                    val result: JsonElement = try {
                        when (op) {
                            "list" -> JsonObject(mapOf("items" to JsonArray(database.readingItems().map(::itemJson))))
                            "add" -> JsonObject(mapOf("item" to itemJson(database.addReadingItem(step["input"].text() ?: "", at))))
                            "setTitle" -> JsonObject(mapOf("item" to itemJson(database.setReadingItemTitle(id, step["title"].text() ?: "", at))))
                            "setRead" -> JsonObject(mapOf("item" to itemJson(database.setReadingItemRead(id, step["read"] == JsonPrimitive(true), at))))
                            "delete" -> {
                                database.deleteReadingItem(id)
                                JsonObject(emptyMap())
                            }
                            else -> error("unknown step $op")
                        }
                    } catch (refused: ReadingListException) {
                        JsonObject(mapOf("error" to JsonPrimitive(refused.message)))
                    }
                    result.difference(step.getValue("result"))?.let { different.add("step $index $op, result: $it") }
                    val rows = JsonArray(database.file.read { db -> db.rows("SELECT * FROM reading_list ORDER BY id") }.map(::json))
                    rows.difference(step.getValue("rows"))?.let { different.add("step $index $op, rows: $it") }
                }
            }
        }
        report("steps", steps.size, different)
    }
}
