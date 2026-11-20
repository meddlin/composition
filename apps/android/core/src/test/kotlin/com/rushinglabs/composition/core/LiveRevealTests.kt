package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.live.LiveReveal
import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.preview.HighlightKind
import com.rushinglabs.composition.core.preview.HighlightModel
import com.rushinglabs.composition.core.preview.MarkdownHighlighter
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The Live view shows a code block's two fences together while the caret is anywhere in the block, ported from LiveRevealTests.swift. As on the
// iPad, the editor's colours (`MarkdownHighlighter.spans`) say where the block is.

@DisplayName("The Live tab reveals a whole code block")
class LiveRevealTests {
    private val text = "Before the block.\n\n```swift\nlet a = 1\n\nlet b = 2\n```\n\nAfter the block, with `code` inline.\n"

    /** The line holding `offset`, with its line break. */
    private fun line(text: String, offset: Int): TextRange = HighlightModel.lineRange(text, TextRange(offset, 0))

    private fun line(offset: Int) = line(text, offset)

    private fun offset(needle: String) = text.indexOf(needle)

    private val block get() = MarkdownHighlighter.spans(text).first { it.kind == HighlightKind.CodeBlock }.range

    private fun contains(outer: TextRange, inner: TextRange) = outer.location <= inner.location && inner.end <= outer.end

    @Test
    @DisplayName("the caret on a line inside the block shows the whole block, both fences")
    fun insideTheBlock() {
        val spans = MarkdownHighlighter.spans(text)
        for (needle in listOf("let a", "let b")) {
            val revealed = LiveReveal.range(line(offset(needle)), spans)
            assertTrue(contains(revealed, block), "$needle: the block is inside what shows")
            assertTrue(revealed.location <= offset("```swift") && revealed.end >= offset("```\n\nAfter") + 3, "$needle: the opening and the closing fence are inside it")
        }
    }

    @Test
    @DisplayName("an empty line inside the block counts, and so does either fence's own line")
    fun emptyLineAndFences() {
        val spans = MarkdownHighlighter.spans(text)
        val empty = offset("let a = 1\n") + "let a = 1\n".length
        for (place in listOf(empty, offset("```swift"), offset("```\n\nAfter"))) {
            val revealed = LiveReveal.range(line(place), spans)
            assertTrue(revealed.location <= offset("```swift") && revealed.end >= offset("```\n\nAfter") + 3, "from $place")
        }
    }

    @Test
    @DisplayName("outside the block, and for inline code, only the caret's own line shows")
    fun outsideTheBlock() {
        val spans = MarkdownHighlighter.spans(text)
        for (needle in listOf("Before", "After", "`code`")) {
            val own = line(offset(needle))
            assertEquals(own, LiveReveal.range(own, spans), needle)
        }
    }

    @Test
    @DisplayName("with no code block in the note, nothing is widened")
    fun noBlock() {
        val plain = "# Title\n\nSome **bold** text.\n"
        val own = line(plain, 12)
        assertEquals(own, LiveReveal.range(own, MarkdownHighlighter.spans(plain)))
    }
}
