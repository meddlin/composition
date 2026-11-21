package com.rushinglabs.composition.core.preview

import com.rushinglabs.composition.core.NoteFrontmatter
import com.rushinglabs.composition.core.SwiftText
import com.rushinglabs.composition.core.markdown.ChartParse
import com.rushinglabs.composition.core.markdown.ChartSpec
import com.rushinglabs.composition.core.markdown.ImageWidth
import com.rushinglabs.composition.core.markdown.MdxPropValue
import com.rushinglabs.composition.core.markdown.NoteBlock
import com.rushinglabs.composition.core.markdown.NoteChart
import com.rushinglabs.composition.core.markdown.NoteHeading
import com.rushinglabs.composition.core.markdown.NoteImage
import com.rushinglabs.composition.core.markdown.NoteRepo
import com.rushinglabs.composition.core.markdown.NoteScanner
import com.rushinglabs.composition.core.markdown.NoteYouTube
import com.rushinglabs.composition.core.markdown.RepoRef
import com.rushinglabs.composition.core.markdown.ScannedNote
import com.rushinglabs.composition.core.markdown.SourceMap
import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.markdown.YouTubeRef
import com.rushinglabs.composition.core.markdown.children
import org.commonmark.node.Code
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Node
import org.commonmark.node.Text

// What the preview draws, ported from the iPad's NotePreview.swift (spike S4): a note read by `NoteScanner`, turned into blocks a view
// can draw without making any decision of its own. The Markdown comes out of commonmark-java as our own small model (so the app never
// imports it, and a renderer, native or not, can use the same model); the components arrive with their props already read, and the
// notices the desktop shows for props it cannot use (a link that is not a repository, a chart with no numbers) are decided here.

sealed interface MdInline {
    data class Text(val text: String) : MdInline
    data class Code(val code: String) : MdInline
    data class Emphasis(val children: List<MdInline>) : MdInline
    data class Strong(val children: List<MdInline>) : MdInline
    data class Strikethrough(val children: List<MdInline>) : MdInline
    data class Link(val destination: String?, val children: List<MdInline>) : MdInline
    data class Image(val source: String, val alt: String, val title: String?, val width: ImageWidth?) : MdInline
    /** `<Mark color="green">…</Mark>` in a line of text; the colour is as written, and an unknown one is yellow. */
    data class Mark(val color: String?, val children: List<MdInline>) : MdInline
    data object SoftBreak : MdInline
    data object LineBreak : MdInline
}

data class MdListItem(
    /** `[x]` or `[ ]` in front of the item: null for an ordinary item, else whether it is ticked. */
    val checked: Boolean?,
    val blocks: List<MdBlock>,
)

enum class MdColumnAlignment { LEADING, CENTER, TRAILING }

sealed interface MdBlock {
    /** `ordinal` counts the note's headings from 0 in the order they appear: what a table of contents scrolls to. */
    data class Heading(val level: Int, val ordinal: Int, val inlines: List<MdInline>) : MdBlock
    data class Paragraph(val inlines: List<MdInline>) : MdBlock
    data class Code(val language: String?, val text: String) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    /** `start` is a 32-bit number: CommonMark allows an ordered list's first number nine digits at most. */
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<MdListItem>) : MdBlock
    data object Rule : MdBlock
    data class Table(val alignments: List<MdColumnAlignment>, val header: List<List<MdInline>>, val rows: List<List<List<MdInline>>>) : MdBlock
    /** Raw HTML in a note that is not MDX, which the desktop shows as text. */
    data class Html(val html: String) : MdBlock
}

enum class PanelTone { INFO, WARNING }

data class TocEntry(
    /** 0 for a top-level heading, 1 for one nested under it, and so on. */
    val level: Int,
    val text: String,
    /** The heading it scrolls to (`MdBlock.Heading`'s `ordinal`). */
    val ordinal: Int,
)

data class FootnoteEntry(val number: Int, val blocks: List<MdBlock>)

sealed interface PreviewImageSource {
    /** A file stored with the notes, by name in `app_data/`. */
    data class Stored(val name: String) : PreviewImageSource
    data class Remote(val url: String) : PreviewImageSource
}

sealed interface PreviewBlock {
    data class Markdown(val blocks: List<MdBlock>) : PreviewBlock
    data class Panel(val tone: PanelTone, val blocks: List<PreviewBlock>) : PreviewBlock
    data class Toc(val entries: List<TocEntry>) : PreviewBlock
    data class Footnotes(val entries: List<FootnoteEntry>) : PreviewBlock
    /** `<Image>`, `<Drawio>` (a diagram is a stored picture) and `<Ink>` (so is a drawing; the app draws it from its strokes when the picture carries them). */
    data class Image(val source: PreviewImageSource, val alt: String, val title: String?, val width: ImageWidth?, val isDiagram: Boolean) : PreviewBlock
    data class Chart(val spec: ChartSpec, val title: String?, val height: Double) : PreviewBlock
    data class Repo(val ref: RepoRef, val description: String?) : PreviewBlock
    data class YouTube(val ref: YouTubeRef, val title: String) : PreviewBlock
    /** `<Mark>` on lines of its own: what is in it, highlighted. */
    data class Highlight(val color: String?, val blocks: List<PreviewBlock>) : PreviewBlock
    /** Said in words where a component could not be drawn, so the rest of the note stays put. */
    data class Notice(val text: String) : PreviewBlock
}

/**
 * A block of a note's preview and where its source is in the note's text, in UTF-16 units (what a text view counts in): what the Live
 * tab draws in place of that text. A component is one, from its opening tag to the end of its closing one; a run of Markdown between
 * components is one per Markdown block in it (a paragraph, a list, a table), each `Markdown` with that one block, so that the Live tab
 * can draw a table as the Preview does and leave the paragraphs round it to its own look.
 */
data class LocatedBlock(val range: TextRange, val block: PreviewBlock)

data class NotePreview(
    val blocks: List<PreviewBlock>,
    /** Why the note's components are not drawn (it is not valid MDX): shown above the note drawn as plain Markdown. */
    val error: String?,
    val headings: List<NoteHeading>,
    /**
     * The top-level blocks with where they are written, in order, never overlapping: the same blocks as `blocks`, with each run of
     * Markdown split into its own blocks. The footnotes listed at the end of a note with no `<Footnotes />` are written nowhere, and so
     * are not among them.
     */
    val located: List<LocatedBlock> = emptyList(),
    /**
     * The footnotes' definitions as they are written, each run of them (definitions with only blank lines between) a `Footnotes` block
     * of their entries, in the order written, numbered as the list numbers them: what the Live tab draws in place of them. Only
     * definitions that are cited.
     */
    val footnoteDefinitions: List<LocatedBlock> = emptyList(),
) {
    companion object {
        /** The preview of a note's stored text, frontmatter and all. The located blocks' ranges are in `content`. */
        fun make(content: String): NotePreview {
            val body = NoteFrontmatter.split(content).second
            val offset = if (content.endsWith(body)) content.length - body.length else 0
            return make(NoteScanner.scan(body, offset))
        }

        fun make(scanned: ScannedNote): NotePreview {
            val builder = Builder(scanned)
            val (top, located) = builder.buildTop()
            val blocks = top.toMutableList()
            // A note with footnotes and no `<Footnotes />` lists them at the end, as the desktop does.
            if (!builder.placedFootnotes && scanned.footnotes.isNotEmpty()) blocks.add(PreviewBlock.Footnotes(builder.footnoteEntries()))
            var definitions = emptyList<LocatedBlock>()
            if (scanned.footnoteDefinitions.isNotEmpty()) {
                val entries = builder.footnoteEntries()
                definitions = scanned.footnoteDefinitions.mapNotNull { run ->
                    val first = run.firstOrNull() ?: return@mapNotNull null
                    val last = run.last()
                    val range = TextRange(first.range.location, last.range.end - first.range.location)
                    LocatedBlock(range, PreviewBlock.Footnotes(run.map { entries[it.number - 1] }))
                }
            }
            return NotePreview(blocks, scanned.error, scanned.headings, located, definitions)
        }

        /** The text of the code blocks, the text and the inline code in `node`: what a chart's CSV is read from. */
        internal fun codeAndText(node: Node): String = when (node) {
            is FencedCodeBlock -> node.literal
            is IndentedCodeBlock -> node.literal
            is Text -> node.literal
            is Code -> node.literal
            else -> node.children().joinToString("\n") { codeAndText(it) }
        }
    }

    // Components ----------------------------------------------------------------------------------------------------------------

    private class Builder(private val scanned: ScannedNote) {
        private val footnoteNumbers: Map<String, Int> = scanned.footnotes.withIndex().associate { (index, label) -> label to index + 1 }
        private val converter = MarkdownConverter(footnoteNumbers = footnoteNumbers)
        var placedFootnotes = false
            private set

        /**
         * The note's own blocks, as `build` makes them, and the same blocks located in the note: each run of Markdown is parsed once, and
         * its blocks are converted one by one (what `MarkdownConverter.blocks` does) so that each keeps where commonmark-java found it.
         */
        fun buildTop(): Pair<List<PreviewBlock>, List<LocatedBlock>> {
            val blocks = ArrayList<PreviewBlock>()
            val located = ArrayList<LocatedBlock>()
            for ((index, block) in scanned.blocks.withIndex()) {
                when (block) {
                    is NoteBlock.Markdown -> {
                        val document = NoteScanner.spannedParser.parse(block.source)
                        val map = SourceMap(block.source)
                        val locator = scanned.locator(index, block.source)
                        val all = ArrayList<MdBlock>()
                        for (child in document.children()) {
                            val converted = converter.block(child) ?: continue
                            all.add(converted)
                            val written = map.range(child) ?: continue
                            val range = locator?.noteRange(written.start, written.end) ?: continue
                            located.add(LocatedBlock(range, PreviewBlock.Markdown(listOf(converted))))
                        }
                        blocks.add(PreviewBlock.Markdown(all))
                    }
                    is NoteBlock.Element -> {
                        val made = element(block.name, block.props, block.children)
                        blocks += made
                        if (made.size == 1 && index < scanned.blockRanges.size) located.add(LocatedBlock(scanned.blockRanges[index], made[0]))
                    }
                }
            }
            return blocks to located
        }

        fun build(blocks: List<NoteBlock>): List<PreviewBlock> = blocks.flatMap { block ->
            when (block) {
                is NoteBlock.Markdown -> listOf(PreviewBlock.Markdown(converter.blocks(NoteScanner.markdownParser.parse(block.source))))
                is NoteBlock.Element -> element(block.name, block.props, block.children)
            }
        }

        private fun text(props: Map<String, MdxPropValue>, name: String) = (props[name] as? MdxPropValue.Text)?.value

        private fun element(name: String, props: Map<String, MdxPropValue>, children: List<NoteBlock>): List<PreviewBlock> {
            return when (name) {
                "Info" -> listOf(PreviewBlock.Panel(PanelTone.INFO, build(children)))
                "Warning" -> listOf(PreviewBlock.Panel(PanelTone.WARNING, build(children)))
                "Mark" -> listOf(PreviewBlock.Highlight(text(props, "color"), build(children)))
                "Image", "Drawio", "Ink" -> {
                    val src = text(props, "src")?.let(SwiftText::trimSpaces)
                    if (src.isNullOrEmpty()) return emptyList()
                    val source = NoteImage.nameFromRef(src)?.let { PreviewImageSource.Stored(it) } ?: PreviewImageSource.Remote(src)
                    listOf(PreviewBlock.Image(source, text(props, "alt") ?: "", text(props, "title"), NoteImage.parseWidth(text(props, "width")), name == "Drawio"))
                }
                "Toc" -> listOf(PreviewBlock.Toc(tocEntries(text(props, "maxDepth"))))
                "Footnotes" -> {
                    // The first tag holds the list; a second is left empty.
                    if (placedFootnotes) return emptyList()
                    placedFootnotes = true
                    listOf(PreviewBlock.Footnotes(footnoteEntries()))
                }
                "YouTube" -> {
                    val url = text(props, "url")?.let(SwiftText::trim)
                    val ref = NoteYouTube.parse(url, text(props, "start"))
                        ?: return listOf(PreviewBlock.Notice(if (url.isNullOrEmpty()) "YouTube video: add a url" else "Not a YouTube video: $url"))
                    val title = text(props, "title")?.let(SwiftText::trim)
                    listOf(PreviewBlock.YouTube(ref, title?.takeIf { it.isNotEmpty() } ?: "YouTube video"))
                }
                "Repo" -> {
                    val url = text(props, "url")?.let(SwiftText::trim)
                    val ref = NoteRepo.parse(url)
                        ?: return listOf(PreviewBlock.Notice(if (url.isNullOrEmpty()) "Repository: add a url" else "Not a repository address: $url"))
                    val description = text(props, "description")?.let(SwiftText::trim)
                    listOf(PreviewBlock.Repo(ref, description?.takeIf { it.isNotEmpty() }))
                }
                "Chart" -> when (val parsed = NoteChart.parse(text(props, "type"), text(props, "x"), text(props, "y"), csv(children))) {
                    is ChartParse.Failure -> listOf(PreviewBlock.Notice(parsed.message))
                    is ChartParse.Chart -> {
                        val height = text(props, "height")?.let { SwiftText.double(SwiftText.trimSpaces(it)) } ?: 280.0
                        // Swift's `min` and `max`, which keep a NaN as Kotlin's do.
                        listOf(PreviewBlock.Chart(parsed.spec, text(props, "title"), minOf(maxOf(height, 120.0), 800.0)))
                    }
                }
                else -> emptyList()
            }
        }

        /** The CSV of a chart: the code blocks (and text) inside the tag. */
        private fun csv(blocks: List<NoteBlock>): String = blocks.joinToString("\n") { block ->
            when (block) {
                is NoteBlock.Markdown -> codeAndText(NoteScanner.markdownParser.parse(block.source))
                is NoteBlock.Element -> csv(block.children)
            }
        }

        /**
         * The lines of a table of contents. A heading nests under the closest one above it that is shallower; `maxDepth` stops at that
         * heading level, 1 to 6, and is 6 when missing or out of range.
         */
        private fun tocEntries(maxDepth: String?): List<TocEntry> {
            val deepest = maxDepth?.let { SwiftText.int(SwiftText.trimSpaces(it)) } ?: 6L
            val limit = if (deepest in 1L..6L) deepest.toInt() else 6
            val open = ArrayList<Int>()
            val entries = ArrayList<TocEntry>()
            for ((ordinal, heading) in scanned.headings.withIndex()) {
                if (heading.depth > limit) continue
                while (open.isNotEmpty() && open.last() >= heading.depth) open.removeAt(open.size - 1)
                entries.add(TocEntry(open.size, heading.text, ordinal))
                open.add(heading.depth)
            }
            return entries
        }

        fun footnoteEntries(): List<FootnoteEntry> = scanned.footnotes.withIndex().map { (index, label) ->
            val plain = MarkdownConverter(countsHeadings = false, footnoteNumbers = footnoteNumbers)
            FootnoteEntry(index + 1, plain.blocks(NoteScanner.markdownParser.parse(scanned.footnoteBodies[label] ?: "")))
        }
    }
}
