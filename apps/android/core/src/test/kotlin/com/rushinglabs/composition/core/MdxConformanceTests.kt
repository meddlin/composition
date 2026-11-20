package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.markdown.ChartParse
import com.rushinglabs.composition.core.markdown.MdxElement
import com.rushinglabs.composition.core.markdown.MdxPropValue
import com.rushinglabs.composition.core.markdown.NoteChart
import com.rushinglabs.composition.core.markdown.NoteImage
import com.rushinglabs.composition.core.markdown.NoteRepo
import com.rushinglabs.composition.core.markdown.NoteScanner
import com.rushinglabs.composition.core.markdown.NoteYouTube
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The restricted MDX layer and the component helpers against the desktop's real preview pipeline and functions, ported from
// MdxConformanceTests.swift and MdxComponentTests.swift. The notes are fixtures/conformance/mdx-notes.json; what remark-mdx and the
// desktop's own plugins made of each is mdx-expected.json. A note must come out the same way on both sides: valid or not, the
// components with their props, block or inline, the headings and the order of the footnotes. The error messages are not compared.

private fun JsonElement?.stringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it != JsonNull && it.isString }?.content

@DisplayName("Markdown and MDX against the desktop")
class MdxConformanceTests {
    private fun describe(element: MdxElement): String {
        val props = element.props.entries.sortedBy { it.key }.map { (key, value) ->
            when (value) {
                is MdxPropValue.Text -> "$key=\"${value.value}\""
                MdxPropValue.Flag -> key
            }
        }
        return "${if (element.isBlock) "block" else "inline"} ${element.depth} <${element.name}${if (props.isEmpty()) "" else " " + props.joinToString(" ")}>"
    }

    private fun describe(element: JsonObject): String {
        val props = element.getValue("props").jsonObject.entries.sortedBy { it.key }.map { (key, value) ->
            value.stringOrNull()?.let { "$key=\"$it\"" } ?: key
        }
        val flow = element.getValue("flow").jsonPrimitive.boolean
        return "${if (flow) "block" else "inline"} ${element.getValue("depth").jsonPrimitive.int} <${element.getValue("name").jsonPrimitive.content}${if (props.isEmpty()) "" else " " + props.joinToString(" ")}>"
    }

    @Test
    @DisplayName("every note: valid or not, its components and props, block or inline, headings and footnotes")
    fun notes() {
        val directory = requireConformance()
        val notes = readJson(File(directory, "mdx-notes.json")).jsonObject.getValue("notes").jsonArray.map { it.jsonObject }
        val expected = readJson(File(directory, "mdx-expected.json")).jsonObject
        assertEquals(notes.size, expected.size)

        val different = ArrayList<String>()
        for (note in notes) {
            val name = note.getValue("name").jsonPrimitive.content
            val want = expected.getValue(name).jsonObject
            val got = NoteScanner.scan(note.getValue("body").jsonPrimitive.content)
            val problems = ArrayList<String>()
            val wantMdx = want.getValue("mdx").jsonPrimitive.boolean
            val wantValid = want.getValue("valid").jsonPrimitive.boolean
            if (got.isMdx != wantMdx) problems.add("read as MDX: ${got.isMdx}, desktop $wantMdx")
            if (got.isValid != wantValid) problems.add("valid: ${got.isValid} (${got.error ?: ""}), desktop $wantValid (${want["error"].stringOrNull() ?: ""})")
            if (wantMdx && wantValid && got.isValid) {
                val ours = got.elements.map(::describe)
                val theirs = want.getValue("elements").jsonArray.map { describe(it.jsonObject) }
                if (ours != theirs) problems.add("components: $ours, desktop $theirs")
                val ourHeadings = got.headings.map { "${it.depth}:${it.text}" }
                val theirHeadings = want.getValue("headings").jsonArray.map { "${it.jsonObject.getValue("depth").jsonPrimitive.int}:${it.jsonObject.getValue("text").jsonPrimitive.content}" }
                if (ourHeadings != theirHeadings) problems.add("headings: $ourHeadings, desktop $theirHeadings")
                val theirFootnotes = want.getValue("footnotes").jsonArray.map { it.jsonPrimitive.content }
                if (got.footnotes != theirFootnotes) problems.add("footnotes: ${got.footnotes}, desktop $theirFootnotes")
            }
            if (problems.isNotEmpty()) different.add("  $name: " + problems.joinToString("; "))
        }
        println("MDX: ${notes.size - different.size} of ${notes.size} notes agree with the desktop")
        different.forEach(::println)
        assertTrue(different.isEmpty(), "notes that differ: ${different.size}")
    }
}

@DisplayName("Component helpers against the desktop")
class MdxComponentTests {
    @Test
    @DisplayName("every input answered as the desktop answers it")
    fun helpers() {
        val directory = requireConformance()
        val cases = readJson(File(directory, "component-cases.json")).jsonObject
        val expected = readJson(File(directory, "component-expected.json")).jsonObject
        val different = ArrayList<String>()
        fun check(kind: String, input: String, ours: Any?, theirs: Any?) {
            if (ours != theirs) different.add("  $kind \"${input.take(70)}\": ours $ours, desktop $theirs")
        }
        fun number(value: Double) = if (value == Math.floor(value) && !value.isInfinite()) value.toLong().toString() else value.toString()
        fun values(map: Map<String, Double>) = map.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${number(it.value)}" }

        val charts = cases.getValue("chart").jsonArray.map { it.jsonObject }
        for ((index, input) in charts.withIndex()) {
            val want = expected.getValue("chart").jsonArray[index].jsonObject
            val type = input["type"].stringOrNull()
            val x = input["x"].stringOrNull()
            val y = input["y"].stringOrNull()
            val csv = input.getValue("csv").jsonPrimitive.content
            val label = "${type ?: "-"}/${x ?: "-"}/${y ?: "-"}/$csv"
            val theirs = want["error"].stringOrNull()?.let { "error: $it" }
                ?: "${want.getValue("type").jsonPrimitive.content} x=${want.getValue("x").jsonPrimitive.content} y=${want.getValue("y").jsonArray.map { it.jsonPrimitive.content }} " +
                want.getValue("rows").jsonArray.map { row -> row.jsonObject.let { "${it.getValue("label").jsonPrimitive.content}:${values(it.getValue("values").jsonObject.mapValues { v -> v.value.jsonPrimitive.double })}" } }
            val ours = when (val got = NoteChart.parse(type, x, y, csv)) {
                is ChartParse.Failure -> "error: ${got.message}"
                is ChartParse.Chart -> "${got.spec.type.rawValue} x=${got.spec.x} y=${got.spec.y} " + got.spec.rows.map { "${it.label}:${values(it.values)}" }
            }
            check("chart", label, ours, theirs)
        }
        for ((index, url) in cases.getValue("repo").jsonArray.map { it.jsonPrimitive.content }.withIndex()) {
            val want = expected.getValue("repo").jsonArray[index]
            val got = NoteRepo.parse(url)
            check("repo", url, got?.let { "${it.host}|${it.service ?: "-"}|${it.owner}|${it.name}|${it.href}" } ?: "null",
                (want as? JsonObject)?.let { "${it.getValue("host").jsonPrimitive.content}|${it["service"].stringOrNull() ?: "-"}|${it.getValue("owner").jsonPrimitive.content}|${it.getValue("name").jsonPrimitive.content}|${it.getValue("href").jsonPrimitive.content}" } ?: "null")
        }
        for ((index, input) in cases.getValue("youtube").jsonArray.map { it.jsonObject }.withIndex()) {
            val want = expected.getValue("youtube").jsonArray[index]
            val url = input.getValue("url").jsonPrimitive.content
            val start = input["start"].stringOrNull()
            val got = NoteYouTube.parse(url, start)
            check("youtube", "$url start=${start ?: "-"}", got?.let { "${it.id}|${it.start}|${it.embedUrl}|${it.watchUrl}" } ?: "null",
                (want as? JsonObject)?.let { "${it.getValue("id").jsonPrimitive.content}|${it.getValue("start").jsonPrimitive.long}|${it.getValue("embed").jsonPrimitive.content}|${it.getValue("watch").jsonPrimitive.content}" } ?: "null")
        }
        for ((index, value) in cases.getValue("start").jsonArray.map { it.jsonPrimitive.content }.withIndex()) {
            val want = expected.getValue("start").jsonArray[index]
            check("start", value, NoteYouTube.parseStart(value), (want as? JsonPrimitive)?.takeIf { it != JsonNull }?.long)
        }
        for ((index, value) in cases.getValue("width").jsonArray.map { it.jsonPrimitive.content }.withIndex()) {
            val want = expected.getValue("width").jsonArray[index]
            val got = NoteImage.parseWidth(value)
            check("width", value, got?.let { "${number(it.value)}${it.unit.rawValue}" } ?: "null",
                (want as? JsonObject)?.let { "${number(it.getValue("value").jsonPrimitive.double)}${if (it.getValue("unit").jsonPrimitive.content == "%") "%" else "px"}" } ?: "null")
        }
        for ((index, value) in cases.getValue("imageRef").jsonArray.map { it.jsonPrimitive.content }.withIndex()) {
            check("imageRef", value, NoteImage.nameFromRef(value), expected.getValue("imageRef").jsonArray[index].stringOrNull())
        }

        val total = listOf("chart", "repo", "youtube", "start", "width", "imageRef").sumOf { cases.getValue(it).jsonArray.size }
        println("Components: ${total - different.size} of $total inputs answered as the desktop does")
        different.forEach(::println)
        assertTrue(different.isEmpty(), "inputs that differ: ${different.size}")
    }
}
