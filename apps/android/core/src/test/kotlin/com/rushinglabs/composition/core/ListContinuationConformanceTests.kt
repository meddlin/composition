package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.editing.LineEdit
import com.rushinglabs.composition.core.editing.ListContinuation
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Return continues a list or a quote and Backspace takes an empty item's marker away, as the desktop's `insertNewlineContinueMarkup` and
// `deleteMarkupBackward` (@codemirror/lang-markdown) do; ported from ListContinuationConformanceTests.swift. The inputs are
// fixtures/conformance/list-continuation-cases.json, texts each tried with the caret at every place; list-continuation-expected.json holds,
// for each place, `[caret, Return's outcome, Backspace's outcome]`, an outcome being `[text afterwards, caret]` from the real commands on a
// real CodeMirror state with the desktop's Markdown language, or null where the command declined.

/** The text afterwards and the caret, as the fixture writes it. */
private fun outcome(text: String, edit: LineEdit?): JsonElement =
    edit?.let { JsonArray(listOf(JsonPrimitive(it.applied(text)), JsonPrimitive(it.selectionStart))) } ?: JsonNull

private fun shown(text: String): String = "\"" + text.replace("\n", "\\n").replace("\t", "\\t") + "\""

@DisplayName("Return and Backspace in lists and quotes against the desktop")
class ListContinuationConformanceTests {
    private fun load(): Pair<List<String>, List<List<JsonArray>>> {
        val directory = requireConformance()
        val texts = readJson(File(directory, "list-continuation-cases.json")).jsonObject.getValue("texts").jsonArray.map { it.jsonPrimitive.content }
        val expected = readJson(File(directory, "list-continuation-expected.json")).jsonArray.map { places -> places.jsonArray.map { it.jsonArray } }
        return texts to expected
    }

    private fun check(key: String, slot: Int, command: (String, Int) -> LineEdit?) {
        val (texts, expected) = load()
        assertEquals(texts.size, expected.size)
        val different = ArrayList<String>()
        var compared = 0
        for ((text, places) in texts.zip(expected)) {
            for (place in places) {
                val caret = place[0].jsonPrimitive.int
                val got = outcome(text, command(text, caret))
                if (got != place[slot]) different.add("$key in ${shown(text)} at $caret: ours $got, desktop ${place[slot]}")
                compared++
            }
        }
        assertTrue(compared > 1000, "$compared caret places")
        println("Lists, $key: ${compared - different.size} of $compared caret places agree with the desktop")
        different.take(40).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "$key places that differ: ${different.size}")
    }

    @Test
    @DisplayName("Return at every caret place does what the desktop's insertNewlineContinueMarkup does")
    fun returns() = check("Return", 1, ListContinuation::newline)

    @Test
    @DisplayName("Backspace at every caret place does what the desktop's deleteMarkupBackward does")
    fun backspaces() = check("Backspace", 2, ListContinuation::deleteBackward)
}
