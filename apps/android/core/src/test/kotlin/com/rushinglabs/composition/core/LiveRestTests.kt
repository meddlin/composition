package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.live.LiveDecorations
import com.rushinglabs.composition.core.live.LiveModel
import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.preview.NotePreview
import com.rushinglabs.composition.core.preview.PreviewBlock
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

// "The rest" of the Live view, ported from LiveRestTests.swift: setext headings and footnote citations drawn as their numbers. What the desktop
// also draws (setext headings, the citations) is checked against it in LiveConformanceTests; these are examples to read, and the iPad's own
// parts (the definitions, the numbering being the Preview's).

private fun decorations(text: String, caret: Int, end: Int? = null): LiveDecorations = LiveModel(text).decorations(TextRange(caret, (end ?: caret) - caret))

private fun ranges(list: List<TextRange>): List<List<Int>> = list.map { listOf(it.location, it.end) }

@DisplayName("The Live model: setext headings and footnotes")
class LiveRestTests {
    // Setext headings

    @Test
    @DisplayName("a paragraph underlined with `===` is a level 1 heading, `---` a level 2; the underline's line is hidden and collapsed away from the caret")
    fun setextLevels() {
        val text = "Title\n=====\n\nSub\n---\n\nbody"
        val away = decorations(text, text.length)
        assertEquals(listOf(listOf(0, 1), listOf(13, 2)), away.headings.map { listOf(it.line, it.level) })
        assertEquals(listOf(listOf(0, 5), listOf(13, 16)), away.headings.map { ranges(listOf(it.range))[0] })
        assertEquals(listOf(listOf(6, 11), listOf(17, 20)), ranges(away.hidden))
        assertEquals(listOf(6, 17), away.collapsedLines)
        assertTrue(away.rules.isEmpty()) // `---` under a paragraph is an underline, not a rule
    }

    @Test
    @DisplayName("the underline shows, dimmed, while the caret is anywhere in the heading, its text or its underline, and nowhere else")
    fun setextReveal() {
        val text = "Title\n=====\n\nbody"
        for (caret in listOf(0, 3, 5, 6, 9, 11)) {
            val inside = decorations(text, caret)
            assertEquals(listOf(listOf(6, 11)), ranges(inside.shown), "caret at $caret")
            assertTrue(inside.hidden.isEmpty() && inside.collapsedLines.isEmpty(), "caret at $caret")
        }
        assertEquals(listOf(listOf(6, 11)), ranges(decorations(text, 12).hidden)) // the blank line after it
    }

    @Test
    @DisplayName("a heading over two lines draws both; the mark is from the first `=` to the last, trailing spaces left out of it but not out of the hidden line")
    fun setextTwoLines() {
        val text = "One\ntwo\n  ===  \n\nx"
        val away = decorations(text, 18)
        assertEquals(listOf(listOf(0, 1), listOf(4, 1)), away.headings.map { listOf(it.line, it.level) })
        assertEquals(listOf(listOf(8, 15)), ranges(away.hidden))
        assertEquals(listOf(listOf(10, 13)), ranges(decorations(text, 1).shown))
    }

    @Test
    @DisplayName("`---` after a blank line is a rule, and the frontmatter's closing `---` is not an underline")
    fun setextAmbiguity() {
        val rule = "above\n\n---\n\nbelow"
        assertTrue(decorations(rule, 0).headings.isEmpty())
        assertEquals(listOf(7), decorations(rule, 0).rules)

        val frontmatter = "---\ntitle: A\n---\nText\n---\n"
        val away = decorations(frontmatter, 0)
        assertEquals(listOf(0, 4, 13), away.frontmatterLines)
        assertEquals(listOf(listOf(17, 2)), away.headings.map { listOf(it.line, it.level) })
        assertEquals(listOf(22), away.collapsedLines)
    }

    @Test
    @DisplayName("a setext heading typed in place is redrawn by the quick read: the underline's window takes in the paragraph above it")
    fun setextTyped() {
        val model = LiveModel("Title\n\nbody")
        val text = "Title\n===\n\nbody"
        model.edited(TextRange(6, 0), 4, TextRange(0, text.length), text)
        val made = model.decorations(TextRange(15, 0))
        assertEquals(listOf(listOf(0, 1)), made.headings.map { listOf(it.line, it.level) })
        assertEquals(listOf(6), made.collapsedLines)
    }

    // Footnotes

    @Test
    @DisplayName("a citation away from the caret is hidden and drawn as its number, the Preview's; the caret on it shows it, dimmed")
    fun citation() {
        val text = "Words[^a] and more[^b].\n\n[^b]: Second.\n[^a]: First."
        val away = decorations(text, 12)
        assertEquals(listOf(listOf(5, 9, 1), listOf(18, 22, 2)), away.footnoteRefs.map { listOf(it.range.location, it.range.end, it.number) })
        assertFalse(away.shown.contains(TextRange(5, 4)))
        val on = decorations(text, 7)
        assertEquals(listOf(2), on.footnoteRefs.map { it.number })
        assertTrue(ranges(on.shown).contains(listOf(5, 9)))
    }

    @Test
    @DisplayName("a citation with no definition, one in code and an escaped one are left as written")
    fun notCitations() {
        val text = "One[^x] `[^a]` \\[^a] and[^a].\n\n[^a]: Note."
        assertEquals(listOf(listOf(24, 1)), decorations(text, 0).footnoteRefs.map { listOf(it.range.location, it.number) })
    }

    @Test
    @DisplayName("numbers follow the order of first citation, as the Preview's do, and a citation typed before renumbers the rest after the full read")
    fun numbering() {
        val text = "A[^two] B[^one] C[^two].\n\n[^one]: 1\n[^two]: 2"
        assertEquals(listOf(1, 2, 1), decorations(text, 0).footnoteRefs.map { it.number })
        val preview = NotePreview.make(text)
        val list = assertIs<PreviewBlock.Footnotes>(preview.blocks.lastOrNull(), "no list")
        assertEquals(listOf(1, 2), list.entries.map { it.number })

        val before = LiveModel("x[^b]\n\n[^a]: A\n[^b]: B")
        val after = LiveModel("[^a]x[^b]\n\n[^a]: A\n[^b]: B")
        assertTrue(after.differences(before).isNotEmpty())
    }

    @Test
    @DisplayName("an edit moves the citations after it and drops one it touches, until the full read")
    fun citationsFollowEdits() {
        val model = LiveModel("a[^1] b[^1]\n\n[^1]: N")
        model.edited(TextRange(0, 0), 2, TextRange(0, 14), "XXa[^1] b[^1]\n\n[^1]: N")
        assertEquals(listOf(3, 9), model.decorations(TextRange(0, 0)).footnoteRefs.map { it.range.location })
    }

    @Test
    @DisplayName("the frontmatter is counted in a citation's place")
    fun citationAfterFrontmatter() {
        assertEquals(listOf(18), decorations("---\ntitle: T\n---\nA[^n]\n\n[^n]: N", 0).footnoteRefs.map { it.range.location })
    }

    @Test
    @DisplayName("definitions are located in runs, each run the Preview's list of their entries, in the order written")
    fun definitionRuns() {
        val text = "A[^a] B[^b] C[^c].\n\n[^b]: Bee.\n\n[^a]: Ay\n    more.\n\nBetween.\n\n[^c]: Cee.\n[^z]: Nobody cites this."
        val preview = NotePreview.make(text)
        assertEquals(
            listOf("[^b]: Bee.\n\n[^a]: Ay\n    more.", "[^c]: Cee."),
            preview.footnoteDefinitions.map { text.substring(it.range.location, it.range.end) },
        )
        val first = assertIs<PreviewBlock.Footnotes>(preview.footnoteDefinitions[0].block, "not a list")
        assertEquals(listOf(2, 1), first.entries.map { it.number })
    }

    @Test
    @DisplayName("definitions' places are in the note's text, frontmatter and `\\r\\n` counted")
    fun definitionPlacesCRLF() {
        val text = "---\r\ntitle: T\r\n---\r\nA[^n]\r\n\r\n[^n]: N\r\n"
        val preview = NotePreview.make(text)
        assertEquals(listOf("[^n]: N"), preview.footnoteDefinitions.map { text.substring(it.range.location, it.range.end) })
        assertEquals(listOf(21), LiveModel(text).decorations(TextRange(0, 0)).footnoteRefs.map { it.range.location })
    }
}
