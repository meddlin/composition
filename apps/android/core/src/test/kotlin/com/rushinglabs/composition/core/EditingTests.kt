package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.editing.EmphasisToggle
import com.rushinglabs.composition.core.editing.IndentLines
import com.rushinglabs.composition.core.editing.LineEdit
import com.rushinglabs.composition.core.editing.MarkHighlight
import com.rushinglabs.composition.core.editing.MdxCompletions
import com.rushinglabs.composition.core.editing.NoteLinks
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The typing aids in plain words, ported from EditingTests.swift. The completions, indenting, emphasis and note links are held against the
// desktop's real functions in EditingConformanceTests; the highlight is a smaller rule of our own (see MarkHighlight), so what it does is
// said here.

private fun MarkHighlight.Outcome.edit(): LineEdit = (this as? MarkHighlight.Outcome.Edit)?.edit ?: error("refused: $this")

private fun MarkHighlight.Outcome.refusal(): MarkHighlight.Refusal? = (this as? MarkHighlight.Outcome.Refused)?.refusal

@DisplayName("Typing aids")
class EditingTests {
    @Test
    @DisplayName("a < offers the components that fit, and choosing one leaves the caret where the desktop's template says")
    fun components() {
        val offered = assertNotNull(MdxCompletions.target("Some text <Im", 13))
        assertEquals(listOf("Image"), offered.items.map { it.name })
        assertEquals(10, offered.start)
        assertEquals(13, offered.end)
        val expansion = MdxCompletions.expand(offered.items[0])
        assertEquals("<Image src=\"\" alt=\"\" />", expansion.text)
        assertEquals(12, expansion.caret)
        assertNull(MdxCompletions.target("a<b", 3), "a < inside a word is not a tag")
        assertNull(MdxCompletions.target("a <b\r", 5), "a JVM's $ would have matched before the \\r")
    }

    @Test
    @DisplayName("inside a tag, the props it lacks are offered, and inside the quotes of one, its values")
    fun props() {
        val text = "<Image src=\"x\" "
        val props = assertNotNull(MdxCompletions.target(text, text.length))
        assertEquals(listOf("alt", "title", "width"), props.items.map { it.name })
        val quoted = "<Image width=\"5"
        val values = assertNotNull(MdxCompletions.target(quoted, quoted.length))
        assertEquals(listOf("50%"), values.items.map { it.name })
        assertEquals("width values", values.label)
        assertNull(MdxCompletions.target("```\n<Image \n```", 11), "nothing in a code block")
        val spaced = "<Image\u00A0"
        assertEquals("Image props", MdxCompletions.target(spaced, spaced.length)?.label, "a no-break space ends the tag's name, as JavaScript's \\s does")
    }

    @Test
    @DisplayName("an empty frontmatter line offers the properties the block lacks, and a slash offers snippets")
    fun frontmatterAndSnippets() {
        val note = "---\ntitle: A\n\n---\nbody"
        val missing = assertNotNull(MdxCompletions.target(note, 13))
        assertEquals(listOf("description", "tags", "createdAt", "updatedAt", "headerImage", "headerImageLayout"), missing.items.map { it.name })
        val snippets = assertNotNull(MdxCompletions.target("text\n/ta", 8))
        assertEquals(listOf("table", "tasks"), snippets.items.map { it.name })
        assertEquals("/table", snippets.items[0].label)
        assertNull(MdxCompletions.target("and/or", 4), "not inside a word")
    }

    @Test
    @DisplayName("a [[ lists notes by title, those that start with the words first, and the link carries the id")
    fun noteLinks() {
        val notes = listOf(NoteLinks.Candidate(1, "Trip plan"), NoteLinks.Candidate(2, "Plan B"), NoteLinks.Candidate(3, "Roadmap"), NoteLinks.Candidate(4, ""))
        val trigger = assertNotNull(NoteLinks.findTrigger("see [[pla", 9))
        assertEquals(4, trigger.start)
        assertEquals("pla", trigger.query)
        assertEquals(listOf(2L, 1L), NoteLinks.match(notes, "pla").map { it.id })
        assertEquals(listOf(1L), NoteLinks.match(notes, "pla", excluding = 2).map { it.id }, "not the note being edited")
        assertEquals("[Plan B](note:2)", NoteLinks.link(notes[1]))
        assertEquals("[Untitled](note:4)", NoteLinks.link(notes[3]))
        assertEquals("[a \\[b\\] c](note:5)", NoteLinks.link("a [b]\n  c", 5), "brackets are escaped and a line break becomes a space")
        assertEquals(42L, NoteLinks.id("note:42"))
        assertNull(NoteLinks.id("https://x"))
        assertNull(NoteLinks.id("note:9007199254740992"), "past what JavaScript holds exactly")
    }

    @Test
    @DisplayName("indenting lines puts a tab in front of each, and outdenting takes a tab or up to four spaces off")
    fun indenting() {
        val text = "one\n  two\n\nthree"
        val indented = assertNotNull(IndentLines.edit(text, 0, text.length, IndentLines.Command.INDENT))
        assertEquals("\tone\n\t  two\n\n\tthree", indented.applied(text), "an empty line is left alone")
        val outdented = assertNotNull(IndentLines.edit("\tone\n      two", 0, 12, IndentLines.Command.OUTDENT))
        assertEquals("one\n  two", outdented.applied("\tone\n      two"))
        assertNull(IndentLines.edit("one", 0, 0, IndentLines.Command.OUTDENT), "nothing to take off")
    }

    @Test
    @DisplayName("bold and italic wrap the words, keep the spaces outside, and the same command takes them off")
    fun emphasis() {
        val text = "a  word  b"
        val bold = assertNotNull(EmphasisToggle.toggle(text, 1, 9, EmphasisToggle.BOLD))
        assertEquals("a  **word**  b", bold.applied(text))
        assertEquals(5 to 9, bold.selectionStart to bold.selectionEnd)
        val again = assertNotNull(EmphasisToggle.toggle("a  **word**  b", 5, 9, EmphasisToggle.BOLD))
        assertEquals("a  word  b", again.applied("a  **word**  b"))
        val both = assertNotNull(EmphasisToggle.toggle("**x**", 2, 3, EmphasisToggle.ITALIC))
        assertEquals("***x***", both.applied("**x**"))
        assertNull(EmphasisToggle.toggle("   ", 0, 3, EmphasisToggle.BOLD))
    }

    @Test
    @DisplayName("highlighting wraps the words in a Mark, outside the spaces; the same words again change the colour, and removing leaves the words")
    fun highlighting() {
        val text = "---\ntitle: A\n---\nsome  words here" // two spaces, so the words start after the second
        val from = "---\ntitle: A\n---\nsome".length + 1
        val marked = MarkHighlight.highlight(text, from, from + 7, "green").edit().applied(text)
        assertTrue(marked.endsWith("some  <Mark color=\"green\">words</Mark> here"), marked)
        val at = marked.indexOf("words")
        assertEquals("green", MarkHighlight.existing(marked, at, at + 5)?.color)
        val recoloured = MarkHighlight.highlight(marked, at, at + 5, "pink").edit().applied(marked)
        assertTrue(recoloured.endsWith("some  <Mark color=\"pink\">words</Mark> here"), recoloured)
        val removed = assertNotNull(MarkHighlight.remove(marked, at, at + 5))
        assertEquals(text, removed.applied(marked))
        assertEquals("yellow", MarkHighlight.existing("<Mark>x</Mark>", 6, 7)?.color, "a Mark with no colour is yellow")
    }

    @Test
    @DisplayName("a selection that is not plain words on one line is refused, with the reason")
    fun refusing() {
        fun why(text: String, from: Int, to: Int) = MarkHighlight.highlight(text, from, to, "yellow").refusal()
        assertEquals(MarkHighlight.Refusal.ACROSS_LINES, why("a\nb", 0, 3))
        assertEquals(MarkHighlight.Refusal.IN_FRONTMATTER, why("---\ntitle: A\n---\nx", 4, 9))
        assertEquals(MarkHighlight.Refusal.HAS_MARKUP, why("**bold** text", 0, 8))
        assertEquals(MarkHighlight.Refusal.IN_CODE, why("```\ncode\n```", 4, 8))
        assertEquals(MarkHighlight.Refusal.IN_CODE, why("use `code here` now", 7, 11))
        assertEquals(MarkHighlight.Refusal.IN_TAG, why("<Image src=\"app_data/x.png\" />", 21, 26))
        assertEquals(MarkHighlight.Refusal.NOTHING_SELECTED, why("text", 2, 2))
        assertEquals(MarkHighlight.Refusal.HAS_MARKUP, why("text", 0, 4).let { MarkHighlight.highlight("text", 0, 4, "purple").refusal() }, "not one of the five colours")
    }
}
