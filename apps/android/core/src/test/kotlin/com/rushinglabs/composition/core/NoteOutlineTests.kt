package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.preview.MdBlock
import com.rushinglabs.composition.core.preview.NoteOutline
import com.rushinglabs.composition.core.preview.NotePreview
import com.rushinglabs.composition.core.preview.PreviewBlock
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// A note's outline, ported from the "Outline" suite of PolishScreensTests.swift.

@DisplayName("Outline")
class NoteOutlineTests {
    @Test
    @DisplayName("a plain note lists its headings in order, with the place of each in the whole text")
    fun plain() {
        val text = "---\ntitle: T\n---\n\n# One\n\ntext\n\n## Two *bold*\n\n### Three\n"
        val outline = NoteOutline.make(text)
        assertEquals(listOf("One", "Two bold", "Three"), outline.map { it.text })
        assertTrue(outline.map { it.level } == listOf(1, 2, 3) && outline.map { it.ordinal } == listOf(0, 1, 2))
        val offsets = outline.mapNotNull { it.offset }
        assertEquals(3, offsets.size)
        for ((offset, level) in offsets.zip(listOf(1, 2, 3))) {
            assertEquals('#', text[offset], "the first character is the #")
            assertTrue(text.substring(offset, offset + level).all { it == '#' })
        }
    }

    @Test
    @DisplayName("a # inside a code fence is no heading, and a setext heading is one")
    fun fencesAndSetext() {
        val text = "```\n# not a heading\n```\n\nTitle\n=====\n\n## After\n"
        val outline = NoteOutline.make(text)
        assertTrue(outline.map { it.text } == listOf("Title", "After") && outline.map { it.level } == listOf(1, 2))
        assertEquals(text.indexOf("Title"), outline.first().offset)
    }

    @Test
    @DisplayName("offsets count UTF-16 units, so text before a heading in another script or an emoji does not shift it")
    fun utf16() {
        val text = "日本語 🙂 first line\n\n## Section\n"
        val outline = NoteOutline.make(text)
        assertTrue(outline.size == 1 && outline[0].offset == text.indexOf("## Section"))
    }

    @Test
    @DisplayName("a note with no headings has no outline, and the heading being read is the last one at or before the top of the view")
    fun none() {
        assertTrue(NoteOutline.make("just words\n").isEmpty())
        assertTrue(NoteOutline.make("").isEmpty())
        val headings = NoteOutline.make("# A\n\nx\n\n# B\n\ny\n\n# C\n")
        val b = headings[1].offset!!
        assertEquals("A", NoteOutline.current(headings, 0)?.text)
        assertEquals("A", NoteOutline.current(headings, b - 1)?.text)
        assertEquals("B", NoteOutline.current(headings, b)?.text)
        assertEquals("C", NoteOutline.current(headings, 10_000)?.text)
        assertNull(NoteOutline.current(emptyList(), 5))
    }

    @Test
    @DisplayName("the numbering is the preview's: the ordinals are the ones the preview's headings carry")
    fun ordinalsAgreeWithThePreview() {
        val text = "# A\n\n## B\n\ntext\n\n## C\n"
        val preview = NotePreview.make(text)
        val ordinals = preview.blocks.filterIsInstance<PreviewBlock.Markdown>().flatMap { it.blocks }.filterIsInstance<MdBlock.Heading>().map { it.ordinal }
        assertEquals(NoteOutline.make(text).map { it.ordinal }, ordinals)
    }
}
