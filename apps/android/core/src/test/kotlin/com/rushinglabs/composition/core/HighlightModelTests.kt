package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.preview.EditAccumulator
import com.rushinglabs.composition.core.preview.HighlightKind
import com.rushinglabs.composition.core.preview.HighlightModel
import com.rushinglabs.composition.core.preview.MarkdownHighlighter
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.util.Locale
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Colouring only what was typed, ported from HighlightModelTests.swift (the iPad's build plan, Step 5). The quick read of the blocks around
// an edit is checked against reading the whole note again, on the notes of the MDX corpus and on random typing. `typingSpeed` is
// Android's own: the iPad's risk R13 (Android's R3), timed as the iPad's lab timed it.

@DisplayName("Incremental colouring")
class HighlightModelTests {
    companion object {
        /** The notes the MDX conformance uses: real-looking Markdown with every component in it. */
        private val notes: List<String> by lazy {
            val directory = corpusDirectory ?: return@lazy emptyList()
            readJson(File(directory, "mdx-notes.json")).jsonObject.getValue("notes").jsonArray.map { it.jsonObject.getValue("body").jsonPrimitive.content }
        }

        private fun replacing(text: String, range: TextRange, replacement: String) = text.substring(0, range.location) + replacement + text.substring(range.end)

        private fun percent(part: Int, whole: Int) = String.format(Locale.ROOT, "%.1f", part * 100.0 / whole)
    }

    /** Replaces `range` of `text` with `replacement`, and brings `model` up to date; returns the new text and what was re-read. */
    private fun edit(model: HighlightModel, text: String, range: TextRange, replacement: String): Pair<String, TextRange> {
        val updated = replacing(text, range, replacement)
        val window = model.edited(range, replacement.length, updated)
        return updated to window
    }

    private fun invariants(model: HighlightModel, text: String, context: String = "") {
        assertEquals(text.length, model.length, "the length follows the text $context")
        var end = 0
        for (block in model.blocks) {
            assertTrue(block.range.location >= end, "blocks are in order and do not overlap $context")
            assertTrue(block.range.end <= model.length, "a block is inside the text $context")
            for (span in block.absolute()) {
                assertTrue(span.range.location >= block.range.location && span.range.end <= block.range.end, "a span is inside its block $context")
            }
            end = block.range.end
        }
    }

    private fun intersection(a: TextRange, b: TextRange): TextRange {
        val start = maxOf(a.location, b.location)
        val end = minOf(a.end, b.end)
        return if (end > start) TextRange(start, end - start) else TextRange(0, 0)
    }

    // Blocks -------------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("the blocks hold every span, in order, each inside its block")
    fun blocks() {
        for (note in notes.take(40)) {
            val blocks = MarkdownHighlighter.blocks(note)
            assertEquals(MarkdownHighlighter.spans(note), blocks.flatMap { it.spans })
            invariants(HighlightModel(note), note)
        }
        assertTrue(notes.size > 100, "the corpus was found")
    }

    @Test
    @DisplayName("a piece of a note is not frontmatter, even if it starts with dashes")
    fun piece() {
        val text = "---\ntitle: x\n---\nbody\n"
        assertEquals(HighlightKind.Frontmatter, MarkdownHighlighter.blocks(text, frontmatter = true).first().spans.first().kind)
        assertTrue(MarkdownHighlighter.blocks(text, frontmatter = false).flatMap { it.spans }.none { it.kind == HighlightKind.Frontmatter })
    }

    // Editing ------------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("typing in a paragraph re-reads the paragraph and its neighbours, and nothing else")
    fun local() {
        val text = (0 until 300).joinToString("\n") { "Paragraph $it has **bold** and `code` in it.\n" }
        val model = HighlightModel(text)
        val spot = text.indexOf("Paragraph 150 ") + 5
        val (updated, window) = edit(model, text, TextRange(spot, 0), "x")
        assertTrue(window.length < 400, "three paragraphs, not the note: $window")
        assertTrue(spot >= window.location && spot < window.end)
        assertEquals(HighlightModel(updated), model, "the quick read agrees with the full one")
        invariants(model, updated)
    }

    @Test
    @DisplayName("the blocks after an edit move with it")
    fun shifting() {
        val text = "# One\n\nTwo **b**\n\nThree\n\n- four\n- five\n\n> six\n"
        val model = HighlightModel(text)
        val (updated, _) = edit(model, text, TextRange(8, 0), "inserted words ")
        assertEquals(HighlightModel(updated), model)
        val (shorter, _) = edit(model, updated, TextRange(0, 8), "")
        assertEquals(HighlightModel(shorter), model)
        invariants(model, shorter)
    }

    @Test
    @DisplayName("a fence typed on one line is wrong when read alone, and the full read finds what it swallowed")
    fun fence() {
        val text = "intro\n\nfirst **paragraph**\n\nsecond paragraph with `code`\n\n```\nend\n```\n"
        val model = HighlightModel(text)
        // A fence typed above two paragraphs: the quick read of the neighbourhood sees it too, but cannot see where it ends.
        val at = text.indexOf("first")
        val (updated, _) = edit(model, text, TextRange(at, 0), "```\n")
        val full = HighlightModel(updated)
        val wrong = full.differences(model)
        assertTrue(model != full || wrong.isEmpty())
        // Whatever the quick read got wrong is exactly what `differences` names: putting those ranges right makes the models the same.
        assertTrue(wrong.all { it.location >= 0 && it.end <= full.length })
    }

    @Test
    @DisplayName("a note that is read again after nothing changed has no differences")
    fun noDifferences() {
        val text = notes.firstOrNull() ?: "text"
        val model = HighlightModel(text)
        assertTrue(HighlightModel(text).differences(model).isEmpty())
    }

    @Test
    @DisplayName("on the notes of the corpus the quick read of a typed character agrees with the full one almost always")
    fun agreement() {
        var agreed = 0
        var total = 0
        val disagreements = ArrayList<String>()
        for ((index, note) in notes.withIndex()) {
            if (note.length <= 20) continue
            for (step in 1..6) {
                val at = note.length * step / 7
                for ((range, replacement) in listOf(TextRange(at, 0) to "x", TextRange(at, 0) to "\n", TextRange(at, 1) to "")) {
                    val model = HighlightModel(note)
                    val (updated, _) = edit(model, note, range, replacement)
                    total += 1
                    if (model == HighlightModel(updated)) agreed += 1 else if (disagreements.size < 8) disagreements.add("note $index at $at ${reflecting(replacement)}")
                }
            }
        }
        println("Incremental colouring: the quick read agreed with the full read in $agreed of $total edits (${percent(agreed, total)}%)")
        for (line in disagreements) println("  differs: $line")
        assertTrue(agreed.toDouble() / total > 0.9, "the quick read is right for ${percent(agreed, total)}% of edits")
    }

    /** A small generator that gives the same edits on every run, so that a failure can be reproduced. */
    private class Seeded(private var state: ULong) {
        fun next(): ULong {
            state = state * 6_364_136_223_846_793_005uL + 1_442_695_040_888_963_407uL
            return (state shr 11) or (state shl 53)
        }

        /** A number in `low..high`. */
        fun int(low: Int, high: Int) = low + (next() % (high - low + 1).toULong()).toInt()

        fun bool() = next() and 1uL == 1uL
    }

    /** `rangeOfComposedCharacterSequences`: a text view never splits a surrogate pair. */
    private fun composed(text: String, range: TextRange): TextRange {
        var start = range.location
        var end = range.end
        if (start in 1 until text.length && text[start].isLowSurrogate() && text[start - 1].isHighSurrogate()) start -= 1
        if (end in 1 until text.length && text[end].isLowSurrogate() && text[end - 1].isHighSurrogate()) end += 1
        return TextRange(start, end - start)
    }

    @Test
    @DisplayName("thousands of random edits, with the characters that make Markdown, keep the model in order and the right length")
    fun randomTyping() {
        val alphabet = listOf("a", "b", " ", "\n", "\n\n", "#", "*", "`", "```\n", "-", "> ", "<Info>", "</Info>", "1. ", "[", "](x)", "é", "😀", "---\n", "|", "~~", "    ")
        val start = "---\ntitle: x\n---\nstart\n\n# Head\n\n- a\n- b\n\n> q\n\n```\ncode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nend\n"
        var agreed = 0
        var total = 0
        for (seed in 1..20) {
            val generator = Seeded(seed.toULong() * 7919uL)
            var text = start
            var model = HighlightModel(text)
            val canvas = painted(model)
            for (step in 0 until 200) {
                val length = text.length
                val location = generator.int(0, length)
                val removed = if (generator.bool() && length > 0) minOf(generator.int(1, 4), length - location) else 0
                val replacement = if (removed > 0 && generator.bool()) "" else alphabet[generator.int(0, alphabet.size - 1)]
                val range = composed(text, TextRange(location, removed))
                edit(canvas, range, replacement.length)
                val (updated, window) = edit(model, text, range, replacement)
                text = updated
                paint(model, canvas, listOf(window))
                invariants(model, text, "seed $seed step $step")
                total += 1
                if (model == HighlightModel(text)) agreed += 1
                // The pause after typing, every few edits: the colours must then be exactly a full read's.
                if (step % 5 == 4) {
                    val full = HighlightModel(text)
                    paint(full, canvas, full.differences(model))
                    model = full
                    assertEquals(painted(full), canvas, "seed $seed step $step")
                }
            }
        }
        println("Incremental colouring, random typing: the quick read agreed in $agreed of $total edits (${percent(agreed, total)}%)")
        assertTrue(agreed.toDouble() / total > 0.9)
    }

    // The whole scheme, on a simulated text view -------------------------------------------------------------------------------------

    /** What a text view holds for each UTF-16 unit: the kinds of colour put on it, in the order they were put on. */
    private class Canvas(val units: MutableList<List<HighlightKind>>) {
        override fun equals(other: Any?) = other is Canvas && units == other.units
        override fun hashCode() = units.hashCode()
        override fun toString() = "Canvas(${units.size} units)"
    }

    /** Puts the colours of `model` on `ranges`, as the editor does: clears each range, then sets the spans that touch it, clipped to it. */
    private fun paint(model: HighlightModel, canvas: Canvas, ranges: List<TextRange>) {
        for (asked in ranges) {
            val range = intersection(asked, TextRange(0, canvas.units.size))
            for (unit in range.location until range.end) canvas.units[unit] = emptyList()
            for (span in model.spans(range)) {
                val clipped = intersection(span.range, range)
                for (unit in clipped.location until clipped.end) canvas.units[unit] = canvas.units[unit] + span.kind
            }
        }
    }

    private fun painted(model: HighlightModel): Canvas {
        val canvas = Canvas(MutableList(model.length) { emptyList() })
        paint(model, canvas, listOf(TextRange(0, model.length)))
        return canvas
    }

    /** An edit to the canvas as a text view makes it: the characters that go in take the colours of the one before them. */
    private fun edit(canvas: Canvas, range: TextRange, newLength: Int) {
        val inherited = if (range.location > 0) canvas.units[range.location - 1] else emptyList()
        val replaced = canvas.units.subList(range.location, range.end)
        replaced.clear()
        replaced.addAll(List(newLength) { inherited })
    }

    @Test
    @DisplayName("quick reads, then putting right only what differs, leave exactly the colours a full read gives")
    fun correctionRepairsEverything() {
        var checked = 0
        var repaired = 0
        for (note in notes) {
            if (note.length <= 20) continue
            for (step in 1..5) {
                val at = note.length * step / 6
                for ((range, replacement) in listOf(TextRange(at, 0) to "x", TextRange(at, 0) to "\n```\n", TextRange(at, 1) to "")) {
                    val model = HighlightModel(note)
                    val canvas = painted(model)
                    val updated = replacing(note, range, replacement)
                    edit(canvas, range, replacement.length)
                    val window = model.edited(range, replacement.length, updated)
                    paint(model, canvas, listOf(window))
                    val full = HighlightModel(updated)
                    val dirty = full.differences(model)
                    if (dirty.isNotEmpty()) repaired += 1
                    paint(full, canvas, dirty)
                    checked += 1
                    assertEquals(painted(full), canvas, "note at $at ${reflecting(replacement)}")
                }
            }
        }
        println("Incremental colouring: $checked edits, $repaired needed the pause's correction, and all $checked of $checked edits ended with the full read's colours")
        assertTrue(repaired > 0, "some edits do need correcting: a fence typed above text")
    }

    // Merged edits -------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a run of edits merged into one replaces the same text")
    fun accumulator() {
        val generator = Random(2026)
        repeat(500) {
            var text = "The quick brown fox jumps over the lazy dog, and then some more text follows"
            val original = text
            val accumulator = EditAccumulator()
            repeat(generator.nextInt(1, 7)) {
                val location = generator.nextInt(0, text.length + 1)
                val removed = generator.nextInt(0, minOf(4, text.length - location) + 1)
                val replacement = listOf("", "x", "abc", "\n\n")[generator.nextInt(4)]
                accumulator.record(TextRange(location, removed), replacement.length)
                text = replacing(text, TextRange(location, removed), replacement)
            }
            val merged = assertNotNull(accumulator.merged)
            val replacement = text.substring(merged.range.location, merged.range.location + merged.newLength)
            assertEquals(text, replacing(original, merged.range, replacement), "merged $merged")
        }
        assertNull(EditAccumulator().merged)
    }

    // Android's own: R13 timed ---------------------------------------------------------------------------------------------------------

    /** A 5,000-line note like the iPad lab's typing test (5,034 lines, about 100,000 characters): headings, paragraphs, lists, a fence. */
    private fun longNote(): String {
        val lines = mutableListOf("---", "title: Typing speed", "---", "# A long note", "")
        var section = 0
        while (lines.size < 5_000) {
            lines += listOf(
                "## Section $section", "",
                "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/$section) with é and 😀, long enough to wrap on a phone.", "",
                "- item one with ~~struck~~ words", "- [x] a task", "",
            )
            if (section % 10 == 0) lines += listOf("```kotlin", "val x = $section", "```", "")
            section += 1
        }
        return lines.joinToString("\n")
    }

    private fun median(values: List<Double>) = values.sorted()[values.size / 2]

    private fun ms(value: Double) = String.format(Locale.ROOT, "%.2f", value)

    @Test
    @DisplayName("typing in a 5,000-line note: the whole note against the blocks around each keystroke (R13), timed")
    fun typingSpeed() {
        var text = longNote()
        val lineCount = text.count { it == '\n' } + 1
        // The whole note, as the editor did before Step 5 on every keystroke (and as the pause's full read does, off the main thread).
        repeat(3) { MarkdownHighlighter.blocks(text) }  // warm
        val whole = List(7) {
            val started = System.nanoTime()
            HighlightModel(text)
            (System.nanoTime() - started) / 1e6
        }

        // 400 keystrokes typed into a paragraph in the middle, each followed by the model's quick read of the blocks around it.
        val model = HighlightModel(text)
        var caret = text.indexOf("Some **bold**", text.length / 2) + 4  // after "Some", in the first paragraph past the middle
        val typed = "and more words typed here "
        val perKeystroke = ArrayList<Double>()
        repeat(450) { index ->
            val character = typed[index % typed.length].toString()
            val updated = replacing(text, TextRange(caret, 0), character)
            val started = System.nanoTime()
            model.edited(TextRange(caret, 0), 1, updated)
            val spent = (System.nanoTime() - started) / 1e6
            if (index >= 50) perKeystroke.add(spent)  // the first 50 warm the code up
            text = updated
            caret += 1
        }
        val full = HighlightModel(text)
        assertEquals(full, model, "the typing was all inside one paragraph, so the quick reads are right")
        val sorted = perKeystroke.sorted()
        println(
            "Timings: R13, a $lineCount-line note of ${text.length} UTF-16 units: the whole note read ${ms(median(whole))} ms (median of 7); " +
                "the blocks around a keystroke ${ms(median(perKeystroke))} ms median, ${ms(sorted[sorted.size * 95 / 100])} ms 95th percentile, " +
                "${ms(sorted.last())} ms worst (${perKeystroke.size} keystrokes)",
        )
        assertTrue(median(perKeystroke) < median(whole), "the blocks around an edit cost less than the whole note")
        assertNotEquals(0, model.blockCount)
    }
}
