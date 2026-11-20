package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.yaml.JavaScriptText
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The desktop's `frontmatter.ts` (and the js-yaml it stands on), against the real functions; ported from
// FrontmatterConformanceTests.swift. The inputs are fixtures/conformance/frontmatter-cases.json (111 blocks to read, 123 to write,
// the header-image edits and the tag helpers); what the desktop made of each is frontmatter-expected.json.

@DisplayName("Frontmatter against the desktop")
class FrontmatterConformanceTests {
    private fun load(): Pair<JsonObject, JsonObject> {
        val directory = requireConformance()
        return readJson(File(directory, "frontmatter-cases.json")).jsonObject to readJson(File(directory, "frontmatter-expected.json")).jsonObject
    }

    private fun shown(text: String) = (if (text.length > 90) text.take(90) + "…" else text).replace("\n", "\\n")
    private fun strings(array: JsonArray) = array.map { it.jsonPrimitive.content }

    @Test
    @DisplayName("blocks are read, or refused, as the desktop reads them")
    fun reading() {
        val (cases, expected) = load()
        val inputs = strings(cases.getValue("parse").jsonArray)
        val wants = expected.getValue("parse").jsonArray
        val different = mutableListOf<String>()
        for ((index, content) in inputs.withIndex()) {
            val want = wants[index].jsonObject
            val (parsed, body) = NoteFrontmatter.parse(content)
            val ours = parsed?.let {
                JsonObject(buildMap {
                    put("title", JsonPrimitive(it.title)); put("description", JsonPrimitive(it.description))
                    put("tags", JsonArray(it.tags.map(::JsonPrimitive)))
                    put("createdAt", JsonPrimitive(it.createdAt)); put("updatedAt", JsonPrimitive(it.updatedAt))
                    it.headerImage?.let { header -> put("headerImage", JsonPrimitive(header.image)); put("headerImageLayout", JsonPrimitive(header.layout.rawValue)) }
                })
            } ?: JsonNull
            val theirs = want["frontmatter"]?.let { block ->
                if (block is JsonObject) JsonObject(block.filterValues { it != JsonNull }) else JsonNull
            } ?: JsonNull
            val theirBody = want.getValue("body").jsonPrimitive.content
            if (ours.difference(theirs) != null || body != theirBody) {
                different.add("  #$index ${shown(content)}: ours $ours body ${shown(body)}, desktop $theirs body ${shown(theirBody)}")
            }
            val split = NoteFrontmatter.split(content)
            if ((split.first != null) != (theirs != JsonNull) || split.second != theirBody) different.add("  #$index split disagrees with parse for ${shown(content)}")
        }
        println("Frontmatter reading: ${inputs.size - different.size} of ${inputs.size} blocks read as the desktop reads them")
        different.forEach(::println)
        assertTrue(different.isEmpty(), "blocks that differ: ${different.size}")
    }

    @Test
    @DisplayName("blocks are written byte for byte as the desktop writes them")
    fun writing() {
        val (cases, expected) = load()
        val items = cases.getValue("generate").jsonArray.map { it.jsonObject }
        val wants = strings(expected.getValue("generate").jsonArray)
        val different = mutableListOf<String>()
        for ((index, item) in items.withIndex()) {
            val title = item.getValue("title").jsonPrimitive.content
            val description = item.getValue("description").jsonPrimitive.content
            val tags = strings(item.getValue("tags").jsonArray)
            val ours = NoteFrontmatter.generate(title, item.getValue("createdAt").jsonPrimitive.content, item.getValue("updatedAt").jsonPrimitive.content, description, tags)
            if (ours != wants[index]) different.add("  #$index ${shown(title)} / ${shown(description)} / $tags: ours ${shown(ours)}, desktop ${shown(wants[index])}")
            // What was written reads back as what was given.
            val back = NoteFrontmatter.parse(ours + "body").first
            if (back?.title != title || back.description != description || back.tags != tags.map(JavaScriptText::trim).filter { it.isNotEmpty() }) {
                different.add("  #$index does not read back: ${shown(ours)}")
            }
        }
        println("Frontmatter writing: ${items.size - different.size} of ${items.size} blocks written as the desktop writes them")
        different.forEach(::println)
        assertTrue(different.isEmpty(), "blocks that differ: ${different.size}")
    }

    @Test
    @DisplayName("header images are set and removed as the desktop does")
    fun headerImages() {
        val (cases, expected) = load()
        val items = cases.getValue("header").jsonArray.map { it.jsonObject }
        val wants = strings(expected.getValue("header").jsonArray)
        val different = mutableListOf<String>()
        for ((index, item) in items.withIndex()) {
            val header = (item["header"] as? JsonObject)?.let {
                HeaderImage(it.getValue("image").jsonPrimitive.content, HeaderImageLayout.of(it.getValue("layout").jsonPrimitive.content) ?: HeaderImageLayout.FULL)
            }
            val fallback = item.getValue("fallback").jsonObject
            val ours = NoteFrontmatter.withHeaderImage(
                item.getValue("content").jsonPrimitive.content, header, fallback.getValue("title").jsonPrimitive.content,
                fallback.getValue("createdAt").jsonPrimitive.content, fallback.getValue("updatedAt").jsonPrimitive.content,
            )
            if (ours != wants[index]) different.add("  #$index: ours ${shown(ours)}, desktop ${shown(wants[index])}")
        }
        println("Header images: ${items.size - different.size} of ${items.size} edits made as the desktop makes them")
        different.forEach(::println)
        assertTrue(different.isEmpty(), "edits that differ: ${different.size}")
    }

    @Test
    @DisplayName("tags are joined and split as the desktop does")
    fun tags() {
        val (cases, expected) = load()
        val inputs = cases.getValue("tags").jsonObject
        val wants = expected.getValue("tags").jsonObject
        for ((index, tags) in inputs.getValue("toString").jsonArray.withIndex()) {
            assertEquals(wants.getValue("toString").jsonArray[index].jsonPrimitive.content, NoteFrontmatter.tagsToString(strings(tags.jsonArray)))
        }
        for ((index, text) in inputs.getValue("fromString").jsonArray.withIndex()) {
            assertEquals(strings(wants.getValue("fromString").jsonArray[index].jsonArray), NoteFrontmatter.tagsFromString(text.jsonPrimitive.content))
        }
    }
}
