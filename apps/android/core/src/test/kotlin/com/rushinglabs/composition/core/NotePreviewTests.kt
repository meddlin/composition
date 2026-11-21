package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.markdown.ChartType
import com.rushinglabs.composition.core.markdown.ImageWidth
import com.rushinglabs.composition.core.markdown.YouTubeRef
import com.rushinglabs.composition.core.preview.MdBlock
import com.rushinglabs.composition.core.preview.MdColumnAlignment
import com.rushinglabs.composition.core.preview.MdInline
import com.rushinglabs.composition.core.preview.NotePreview
import com.rushinglabs.composition.core.preview.PanelTone
import com.rushinglabs.composition.core.preview.PreviewBlock
import com.rushinglabs.composition.core.preview.PreviewImageSource
import com.rushinglabs.composition.core.preview.TocEntry
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

// The preview model, ported from NotePreviewTests.swift.

@DisplayName("The preview model")
class NotePreviewTests {
    private fun ordinals(blocks: List<MdBlock>) = blocks.filterIsInstance<MdBlock.Heading>().map { it.ordinal }

    @Test
    @DisplayName("frontmatter is left out, and every component of a note arrives with its props read")
    fun everyComponent() {
        val note = """
            ---
            title: Everything
            ---
            <Toc maxDepth="2" />

            # One

            <Info>

            ## Inside **panel**

            </Info>

            ### Three

            <Image src="app_data/a-3f9c2a71b0de.png" alt="A" width="50%" />
            <Repo url="github.com/meddlin/composition/tree/main" description="A notes app" />
            <YouTube url="https://youtu.be/dQw4w9WgXcQ?t=90" title="Demo" />
            <YouTube url="nope" />
            <Chart type="line" y="n">

            ```csv
            d,n
            a,1
            b,2
            ```

            </Chart>
            <Chart>

            ```csv
            only,words
            x,y
            ```

            </Chart>
            Cited[^a] here.

            [^a]: The footnote.
        """.trimIndent()
        val preview = NotePreview.make(note)
        assertNull(preview.error)

        // The table of contents lists headings 1 and 2 deep, and each scrolls to the heading with its ordinal.
        val toc = preview.blocks[0] as? PreviewBlock.Toc ?: fail("no toc first")
        assertEquals(listOf(TocEntry(0, "One", 0), TocEntry(1, "Inside panel", 1)), toc.entries)

        val one = (preview.blocks[1] as? PreviewBlock.Markdown)?.blocks
        val panel = preview.blocks[2] as? PreviewBlock.Panel
        val panelled = (panel?.blocks?.firstOrNull() as? PreviewBlock.Markdown)?.blocks
        val three = (preview.blocks[3] as? PreviewBlock.Markdown)?.blocks
        if (one == null || panel?.tone != PanelTone.INFO || panelled == null || three == null) fail("blocks are not as expected: ${preview.blocks.take(4)}")
        assertTrue(ordinals(one) == listOf(0) && ordinals(panelled) == listOf(1) && ordinals(three) == listOf(2))

        assertEquals(PreviewBlock.Image(PreviewImageSource.Stored("a-3f9c2a71b0de.png"), "A", null, ImageWidth(50.0, ImageWidth.Unit.PERCENT), false), preview.blocks[4])
        val repo = preview.blocks[5] as? PreviewBlock.Repo ?: fail("no repo")
        assertTrue(repo.ref.label == "meddlin/composition" && repo.ref.service == "GitHub" && repo.ref.href == "https://github.com/meddlin/composition" && repo.description == "A notes app")
        val video = preview.blocks[6] as? PreviewBlock.YouTube ?: fail("no video")
        assertTrue(video.ref == YouTubeRef("dQw4w9WgXcQ", 90) && video.title == "Demo")
        assertEquals(PreviewBlock.Notice("Not a YouTube video: nope"), preview.blocks[7])
        val chart = preview.blocks[8] as? PreviewBlock.Chart ?: fail("no chart")
        assertTrue(chart.spec.type == ChartType.LINE && chart.spec.y == listOf("n") && chart.spec.rows.map { it.label } == listOf("a", "b") && chart.height == 280.0)
        assertEquals(PreviewBlock.Notice("Chart: no column of numbers to draw. Name one with y=\"column\"."), preview.blocks[9])

        // No `<Footnotes />` in the note: the list comes last.
        val rest = (preview.blocks[10] as? PreviewBlock.Markdown)?.blocks
        val words = (rest?.firstOrNull() as? MdBlock.Paragraph)?.inlines ?: fail("no text")
        assertEquals(listOf<MdInline>(MdInline.Text("Cited¹ here.")), words)
        val notes = preview.blocks[11] as? PreviewBlock.Footnotes ?: fail("no footnotes")
        assertTrue(notes.entries.map { it.number } == listOf(1) && notes.entries[0].blocks == listOf(MdBlock.Paragraph(listOf(MdInline.Text("The footnote.")))))
    }

    @Test
    @DisplayName("a highlight in a line of text is a mark around the text it holds")
    fun mark() {
        val preview = NotePreview.make("Resets <Mark color=\"green\">every **night**</Mark>, then <Mark>this</Mark>.\n")
        val inlines = ((preview.blocks[0] as? PreviewBlock.Markdown)?.blocks?.firstOrNull() as? MdBlock.Paragraph)?.inlines ?: fail("no paragraph")
        assertEquals(
            listOf(
                MdInline.Text("Resets "), MdInline.Mark("green", listOf(MdInline.Text("every "), MdInline.Strong(listOf(MdInline.Text("night"))))),
                MdInline.Text(", then "), MdInline.Mark(null, listOf(MdInline.Text("this"))), MdInline.Text("."),
            ),
            inlines,
        )
    }

    @Test
    @DisplayName("a citation after bold text that holds a highlight still closes the bold, and becomes its number")
    fun citationAfterEmphasis() {
        val preview = NotePreview.make("Resets **back up <Mark color=\"yellow\">first</Mark>**[^a] and `[^a]` and [^nope].\n\n[^a]: Note.\n")
        val inlines = ((preview.blocks[0] as? PreviewBlock.Markdown)?.blocks?.firstOrNull() as? MdBlock.Paragraph)?.inlines ?: fail("no paragraph")
        assertEquals(
            listOf(
                MdInline.Text("Resets "), MdInline.Strong(listOf(MdInline.Text("back up "), MdInline.Mark("yellow", listOf(MdInline.Text("first"))))),
                MdInline.Text("¹ and "), MdInline.Code("[^a]"), MdInline.Text(" and [^nope]."),
            ),
            inlines,
        )
    }

    @Test
    @DisplayName("a note that is not valid MDX is drawn as Markdown, with the reason")
    fun invalid() {
        val preview = NotePreview.make("<Info>\n\nnever closed\n")
        assertNotNull(preview.error)
        assertTrue(preview.blocks.size == 1 && preview.blocks[0] is PreviewBlock.Markdown, "not one block of Markdown")
    }

    @Test
    @DisplayName("lists, tasks, tables, quotes and code come through")
    fun markdownBlocks() {
        val preview = NotePreview.make("- [x] done\n- [ ] todo\n\n1. one\n2. two\n\n> quoted\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n```swift\nlet x = 1\n```\n\n---\n")
        val blocks = (preview.blocks[0] as? PreviewBlock.Markdown)?.blocks ?: fail("no markdown")
        assertEquals(6, blocks.size)
        val tasks = blocks[0] as? MdBlock.ListBlock ?: fail("no task list")
        assertTrue(!tasks.ordered)
        assertEquals(listOf(true, false), tasks.items.map { it.checked })
        val numbered = blocks[1] as? MdBlock.ListBlock ?: fail("no numbered list")
        assertTrue(numbered.ordered && numbered.start == 1 && numbered.items.size == 2)
        val table = blocks[3] as? MdBlock.Table ?: fail("no table")
        assertTrue(table.alignments == listOf(MdColumnAlignment.LEADING, MdColumnAlignment.TRAILING) && table.header.size == 2 && table.rows.size == 1)
        assertTrue(blocks[4] == MdBlock.Code("swift", "let x = 1") && blocks[5] == MdBlock.Rule)
    }
}
