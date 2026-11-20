package com.rushinglabs.composition.core.preview

import com.rushinglabs.composition.core.SwiftText
import com.rushinglabs.composition.core.markdown.MdxPropValue
import com.rushinglabs.composition.core.markdown.NoteImage
import com.rushinglabs.composition.core.markdown.NoteScanner
import com.rushinglabs.composition.core.markdown.children
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableBody
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableHead
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListBlock
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text
import org.commonmark.node.ThematicBreak

/**
 * commonmark-java's tree as `MdBlock`s: the iPad's `MarkdownConverter`, which reads swift-markdown's. Where the two parsers' trees differ
 * in shape, this reads commonmark-java's the way the iPad reads swift-markdown's: a task item's `[x]` is a `TaskListItemMarker` child
 * here and a property there, and a link reference definition, a node here, is not in swift-markdown's tree at all.
 */
internal class MarkdownConverter(
    private val countsHeadings: Boolean = true,
    /** Footnote numbers by label: a `[^label]` in the text becomes its number in superscript digits (as in the terminal app). */
    private val footnoteNumbers: Map<String, Int> = emptyMap(),
) {
    private var headings = 0

    /**
     * `text` with each citation of a footnote that exists replaced by its number. Done on the parsed text, not the source: the source's
     * `**back up <Mark>first</Mark>**[^a]` would stop closing its bold if the `[` were replaced by a digit.
     */
    private fun numbered(text: String): String {
        if (footnoteNumbers.isEmpty() || !text.contains("[^")) return text
        val out = StringBuilder()
        var rest = text
        while (true) {
            val open = rest.indexOf("[^")
            if (open < 0) break
            out.append(rest, 0, open)
            val after = rest.substring(open + 2)
            val close = after.indexOf(']')
            val label = if (close >= 0) after.substring(0, close) else null
            val number = label?.let { footnoteNumbers[it] }
            if (label != null && label.isNotEmpty() && label.codePoints().noneMatch(SwiftText::isWhitespace) && number != null) {
                out.append(NoteScanner.superscript(number))
                rest = after.substring(close + 1)
            } else {
                out.append("[^")
                rest = after
            }
        }
        return out.append(rest).toString()
    }

    fun blocks(container: Node): List<MdBlock> = container.children().mapNotNull { block(it) }

    fun block(node: Node): MdBlock? = when (node) {
        is Heading -> {
            val ordinal = headings
            if (countsHeadings) headings += 1
            MdBlock.Heading(node.level, ordinal, inlines(node.children()))
        }
        is Paragraph -> MdBlock.Paragraph(inlines(node.children()))
        is FencedCodeBlock -> MdBlock.Code(node.info?.takeIf { it.isNotEmpty() }, node.literal.removeSuffix("\n"))
        is IndentedCodeBlock -> MdBlock.Code(null, node.literal.removeSuffix("\n"))
        is BlockQuote -> MdBlock.Quote(blocks(node))
        is BulletList -> MdBlock.ListBlock(false, 1, items(node))
        is OrderedList -> MdBlock.ListBlock(true, node.markerStartNumber ?: 1, items(node))
        is ThematicBreak -> MdBlock.Rule
        is TableBlock -> table(node)
        is HtmlBlock -> MdBlock.Html(SwiftText.trim(node.literal))
        else -> NoteScanner.plainText(node).takeIf { it.isNotEmpty() }?.let { MdBlock.Paragraph(listOf(MdInline.Text(it))) }
    }

    private fun items(list: ListBlock): List<MdListItem> = list.children().filterIsInstance<ListItem>().map { item ->
        MdListItem((item.firstChild as? TaskListItemMarker)?.isChecked, blocks(item))
    }

    private fun table(table: TableBlock): MdBlock.Table {
        val head = table.children().firstOrNull { it is TableHead }?.firstChild?.children().orEmpty().filterIsInstance<TableCell>()
        val alignments = head.map {
            when (it.alignment) {
                TableCell.Alignment.CENTER -> MdColumnAlignment.CENTER
                TableCell.Alignment.RIGHT -> MdColumnAlignment.TRAILING
                else -> MdColumnAlignment.LEADING
            }
        }
        val header = head.map { inlines(it.children()) }
        val rows = table.children().firstOrNull { it is TableBody }?.children().orEmpty().map { row ->
            row.children().filterIsInstance<TableCell>().map { inlines(it.children()) }
        }
        return MdBlock.Table(alignments, header, rows)
    }

    /** Inline content. `<Mark>` and an inline `<Image>` arrive as raw HTML, found again here by reading each tag. */
    fun inlines(nodes: List<Node>): List<MdInline> {
        val out = ArrayList<MdInline>()
        var i = 0
        while (i < nodes.size) {
            val node = nodes[i]
            i += 1
            if (node is HtmlInline) {
                val tag = NoteScanner.lone(node.literal) ?: continue  // any other HTML: not shown
                if (tag.name == "Mark" && !tag.closing) {
                    // Everything up to the matching `</Mark>` among these siblings is the highlighted text.
                    var depth = 1
                    var j = i
                    while (j < nodes.size) {
                        val inner = (nodes[j] as? HtmlInline)?.let { NoteScanner.lone(it.literal) }
                        if (inner != null && inner.name == "Mark") {
                            depth += if (inner.closing) -1 else 1
                            if (depth == 0) break
                        }
                        j += 1
                    }
                    val color = (tag.props["color"] as? MdxPropValue.Text)?.value
                    out.add(MdInline.Mark(color, inlines(nodes.subList(i, minOf(j, nodes.size)))))
                    i = minOf(j + 1, nodes.size)
                } else if (tag.name == "Image" && !tag.closing) {
                    fun prop(name: String) = (tag.props[name] as? MdxPropValue.Text)?.value
                    val src = prop("src")
                    if (!src.isNullOrEmpty()) out.add(MdInline.Image(src, prop("alt") ?: "", prop("title"), NoteImage.parseWidth(prop("width"))))
                }
                continue
            }
            inline(node)?.let(out::add)
        }
        return out
    }

    private fun inline(node: Node): MdInline? = when (node) {
        is Text -> MdInline.Text(numbered(node.literal))
        is Code -> MdInline.Code(node.literal)
        is Emphasis -> MdInline.Emphasis(inlines(node.children()))
        is StrongEmphasis -> MdInline.Strong(inlines(node.children()))
        is Strikethrough -> MdInline.Strikethrough(inlines(node.children()))
        // swift-markdown has no destination for `[a]()`, where commonmark-java has an empty one.
        is Link -> MdInline.Link(node.destination?.takeIf { it.isNotEmpty() }, inlines(node.children()))
        is Image -> MdInline.Image(node.destination ?: "", NoteScanner.plainText(node), node.title, null)
        is SoftLineBreak -> MdInline.SoftBreak
        is HardLineBreak -> MdInline.LineBreak
        else -> NoteScanner.plainText(node).takeIf { it.isNotEmpty() }?.let { MdInline.Text(it) }
    }
}
