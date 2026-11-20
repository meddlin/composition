package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.editing.HeadingRailSide
import com.rushinglabs.composition.core.editing.LiveReflow
import com.rushinglabs.composition.core.editing.NoteView
import com.rushinglabs.composition.core.editing.ReflowEdit
import com.rushinglabs.composition.core.editing.ReflowOptions
import com.rushinglabs.composition.core.editing.ReflowSpan
import com.rushinglabs.composition.core.editing.ReflowText
import com.rushinglabs.composition.core.editing.WritingSettings
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Reflow against the desktop's own code; ported from ReflowConformanceTests.swift. fixtures/conformance/reflow.json holds what
// `reflowText.ts`, `liveReflow.ts` and `writing.ts` make of a long list of inputs (apps/web/src/components/notes/reflowConformance.test.ts
// writes it). The file is committed, so a plain `./gradlew :core:test` replays it. See fixtures/conformance/README.md.

private val reflowCorpus: JsonObject? = corpusDirectory?.let { File(it, "reflow.json") }?.takeIf { it.isFile }?.let { readJson(it) as? JsonObject }

private fun section(name: String): List<JsonObject> {
    skipUnless(reflowCorpus != null, "fixtures/conformance/reflow.json is not there")
    return reflowCorpus!!.getValue(name).jsonArray.mapNotNull { it as? JsonObject }
}

private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonElement?.int(): Int? =
    (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.content?.toDoubleOrNull()?.takeIf { it == kotlin.math.truncate(it) }?.toInt()

private fun JsonElement?.bool(): Boolean? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.content?.toBooleanStrictOrNull()

/** What the desktop's settings object says, field by field. */
private fun settings(value: JsonElement?): WritingSettings? {
    val o = value as? JsonObject ?: return null
    val defaults = WritingSettings()
    return WritingSettings(
        rulerEnabled = o["rulerEnabled"].bool() ?: defaults.rulerEnabled,
        rulerColumn = o["rulerColumn"].int() ?: -1,
        reflowEnabled = o["reflowEnabled"].bool() ?: defaults.reflowEnabled,
        reflowColumn = o["reflowColumn"].int() ?: -1,
        reflowKeepsTables = o["reflowKeepsTables"].bool() ?: defaults.reflowKeepsTables,
        wordCountEnabled = o["wordCountEnabled"].bool() ?: defaults.wordCountEnabled,
        headingRailEnabled = o["headingRailEnabled"].bool() ?: defaults.headingRailEnabled,
        headingRailSide = o["headingRailSide"].string()?.let(HeadingRailSide::of) ?: HeadingRailSide.LEFT,
        openNotesIn = o["openNotesIn"].string()?.let(NoteView::of) ?: NoteView.LIVE,
    )
}

private fun shown(text: String): String = "\"" + text.replace("\n", "\\n").replace("\t", "\\t") + "\""

@DisplayName("Reflow against the desktop")
class ReflowConformanceTests {
    @Test
    @DisplayName("a line pushed past the column is broken where the desktop breaks it, the caret goes where the desktop puts it, and the lines it must not break are left whole")
    fun reflow() {
        val cases = section("reflow")
        assertTrue(cases.size > 550)
        val different = ArrayList<String>()
        var edits = 0
        var untouched = 0
        for ((index, entry) in cases.withIndex()) {
            val text = entry["text"].string()!!
            val caret = entry["caret"].int()!!
            val options = ReflowOptions(entry["column"].int()!!, entry["keepTables"] == JsonPrimitive(true))
            val ours = ReflowText.reflowAtCaret(text, caret, options)
            val theirs = (entry["edit"] as? JsonObject)?.let { edit ->
                val editText = edit["text"].string()
                val editCaret = edit["caret"].int()
                if (editText != null && editCaret != null) ReflowEdit(editText, editCaret) else null
            }
            if (theirs == null) untouched++ else edits++
            if (ours != theirs) different.add("#$index ${shown(text)} at $caret, column ${options.column}: ours $ours, desktop $theirs")
        }
        assertTrue(edits > 200 && untouched > 150, "the corpus has both kinds: $edits edits and $untouched lines left alone")
        println("Reflow: ${cases.size - different.size} of ${cases.size} lines agree with the desktop")
        different.take(10).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "${different.size} differ")
    }

    @Test
    @DisplayName("the stretch that changed between two texts is the desktop's, in UTF-16 units")
    fun spans() {
        val cases = section("spans")
        assertTrue(cases.size >= 18)
        val different = ArrayList<String>()
        for (entry in cases) {
            val before = entry["before"].string()!!
            val after = entry["after"].string()!!
            val span = entry["span"] as JsonObject
            val ours = ReflowText.changedSpan(before, after)
            val theirs = ReflowSpan(span["start"].int() ?: -1, span["end"].int() ?: -1, span["insert"].string() ?: "?")
            if (ours != theirs) different.add("${shown(before)} to ${shown(after)}: ours $ours, desktop $theirs")
        }
        println("Reflow, changed spans: ${cases.size - different.size} of ${cases.size} pairs of texts agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
    }

    @Test
    @DisplayName("a keystroke reflows, and a paste, a drop, an undo, a deletion, a return and a half-composed word do not")
    fun typing() {
        val cases = section("typing")
        assertTrue(cases.size > 250)
        val different = ArrayList<String>()
        var reflowed = 0
        var left = 0
        for ((index, entry) in cases.withIndex()) {
            val doc = entry["doc"].string()!!
            val insert = entry["insert"].string()!!
            val from = entry["from"].int()!!
            val to = entry["to"].int()!!
            val caret = entry["caret"].int()!!
            val event = LiveReflow.Event.of(entry["event"].string())
            val options = ReflowOptions(entry["column"].int()!!, entry["keepTables"] == JsonPrimitive(true))

            val edit = LiveReflow.edit(LiveReflow.Change(from, to, insert), doc, caret, event, options)
            val plain = doc.substring(0, from) + insert + doc.substring(to)
            val result = entry["result"] as JsonObject
            val text = edit?.text ?: plain
            val head = edit?.caret ?: caret
            if (edit != null) reflowed++ else left++
            if (text != result["text"].string() || head != result["caret"].int() || (edit != null) != (result["reflowed"] == JsonPrimitive(true))) {
                different.add("#$index ${shown(doc)} + ${shown(insert)} (${entry["event"].string() ?: "no event"}): ours ${shown(text)} at $head, desktop ${result["text"]} at ${result["caret"]}")
            }
        }
        assertTrue(reflowed > 30 && left > 150, "the corpus has both kinds: $reflowed reflowed and $left left")
        println("Reflow, live editor: ${cases.size - different.size} of ${cases.size} changes agree with the desktop")
        different.take(10).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "${different.size} differ")
    }

    @Test
    @DisplayName("an event is typing only when CodeMirror would say so: input.type and the names beneath it, but not a composition")
    fun events() {
        assertEquals(LiveReflow.Event.TYPING, LiveReflow.Event.of("input.type"))
        assertEquals(LiveReflow.Event.TYPING, LiveReflow.Event.of("input.type.autocorrect"))
        assertEquals(LiveReflow.Event.COMPOSING, LiveReflow.Event.of("input.type.compose"))
        assertEquals(LiveReflow.Event.COMPOSING, LiveReflow.Event.of("input.type.compose.end"))
        for (other in listOf("input", "input.paste", "input.drop", "input.typed", "input.types.compose", "delete.backward", "undo", "")) {
            assertEquals(LiveReflow.Event.OTHER, LiveReflow.Event.of(other), other)
        }
        assertEquals(LiveReflow.Event.OTHER, LiveReflow.Event.of(null))
    }

    @Test
    @DisplayName("the ruler and reflow settings are read, and refused, as the desktop reads and refuses them")
    fun writing() {
        val parse = section("writingParse")
        val validate = section("writingValidate")
        assertTrue(parse.size > 60 && validate.size > 60)
        val different = ArrayList<String>()
        for (entry in parse) {
            val input = entry["input"] ?: JsonNull
            val ours = WritingSettings.parse(input)
            if (ours != settings(entry["settings"])) different.add("parseWritingSettings($input): ours $ours, desktop ${entry["settings"]}")
        }
        var refused = 0
        for (entry in validate) {
            val input = entry["input"] ?: JsonNull
            when (val validation = WritingSettings.validate(input)) {
                is WritingSettings.Validation.Valid -> if (validation.settings != settings(entry["settings"])) {
                    different.add("validateWritingSettings($input): ours ${validation.settings}, desktop ${entry["settings"]}")
                }
                is WritingSettings.Validation.Invalid -> {
                    refused++
                    if (validation.message != entry["error"].string()) different.add("validateWritingSettings($input): ours ${validation.message}, desktop ${entry["error"]}")
                }
            }
        }
        assertTrue(refused > 30)
        val total = parse.size + validate.size
        println("Reflow, writing settings: ${total - different.size} of $total settings objects agree with the desktop")
        different.take(10).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "${different.size} differ")
    }
}
