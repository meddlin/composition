package com.rushinglabs.composition.core.preview

import com.rushinglabs.composition.core.NoteFrontmatter
import com.rushinglabs.composition.core.markdown.NoteScanner
import com.rushinglabs.composition.core.markdown.SourceMap
import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.markdown.UnitRange
import com.rushinglabs.composition.core.markdown.children
import com.rushinglabs.composition.core.markdown.union
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.node.BlockQuote
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.ThematicBreak

// Syntax colours for the editor, ported from the iPad's MarkdownHighlighter.swift (spike S3): where in a note's text a heading, bold,
// code, a link, a list marker, a component tag and so on are, as UTF-16 ranges a text view can put spans on. It reads the note with
// commonmark-java and its source spans (the iPad: swift-markdown and its source ranges), so it agrees with the preview about what is
// code and what is not. It knows nothing of Android.
//
// `Mark` is the syntax itself (`#`, `**`, backticks, `[` and `](url)`, `>`): what the Live tab would hide away from the caret.
// Spans come outermost first, a node's own span before its marks, so applying them in order lets the later one win.

sealed interface HighlightKind {
    data object Frontmatter : HighlightKind
    data class Heading(val level: Int) : HighlightKind
    data object Strong : HighlightKind
    data object Emphasis : HighlightKind
    data object Strikethrough : HighlightKind
    data object InlineCode : HighlightKind
    data object CodeBlock : HighlightKind
    data object LinkText : HighlightKind
    data object Quote : HighlightKind
    data object ListMarker : HighlightKind
    data object Rule : HighlightKind
    /** A component tag (`<Info>`, `<Toc />`), or any raw HTML. */
    data object Tag : HighlightKind
    /** The syntax characters of the constructs above. */
    data object Mark : HighlightKind
}

data class HighlightSpan(val range: TextRange, val kind: HighlightKind)

/**
 * The spans that belong to one top-level block of the note (a paragraph, a heading, a list, a fenced block, the frontmatter, ...), with
 * the range of text they cover. Blocks are what the editor re-reads, and re-colours, when something inside them is typed.
 */
data class HighlightedBlock(
    val range: TextRange,
    /** Outermost first, as `MarkdownHighlighter.spans` has them; positions are in the whole text. */
    val spans: List<HighlightSpan>,
)

object MarkdownHighlighter {
    /** The spans of `text`, outermost first. */
    fun spans(text: String): List<HighlightSpan> = blocks(text).flatMap { it.spans }

    /**
     * The same spans, grouped by the top-level block each belongs to, in the order of the text. `frontmatter` says whether a `---` block
     * at the very start is frontmatter: it is not when `text` is only a piece taken from the middle of a note.
     */
    fun blocks(text: String, frontmatter: Boolean = true): List<HighlightedBlock> = Builder(text).run(frontmatter)

    private class Builder(private val text: String) {
        private val map = SourceMap(text)
        private val spans = ArrayList<HighlightSpan>()

        fun run(allowed: Boolean): List<HighlightedBlock> {
            val blocks = ArrayList<HighlightedBlock>()
            // The frontmatter is dimmed, and hidden from the parse by blanking it (keeping its line breaks), so offsets stay put. The
            // iPad blanks it a scalar at a time and finds places by line and column; here places are counted in UTF-16 units, so it is
            // blanked a unit at a time, which keeps every later offset where it was (a 😀 becomes two spaces, still a blank line).
            var source = text
            val end = if (allowed) frontmatterEnd(text) else null
            if (end != null) {
                val whole = TextRange(0, end)
                blocks.add(HighlightedBlock(whole, listOf(HighlightSpan(whole, HighlightKind.Frontmatter))))
                source = buildString(text.length) {
                    for (i in 0 until end) append(if (text[i] == '\n' || text[i] == '\r') text[i] else ' ')
                    append(text, end, text.length)
                }
            }
            for (child in NoteScanner.spannedParser.parse(source).children()) {
                spans.clear()
                visit(child)
                if (spans.isEmpty()) continue
                // The block covers what its node says it does and, to be safe, every span found inside it.
                var covered = map.range(child)?.toTextRange()
                for (span in spans) covered = covered?.let { union(it, span.range) } ?: span.range
                val block = HighlightedBlock(covered ?: TextRange(0, 0), spans.toList())
                // The parser's ranges can overlap for odd input (a quote that swallows a fence); a block that starts inside the one before joins it.
                val last = blocks.lastOrNull()
                if (last != null && block.range.location < last.range.end) {
                    blocks[blocks.size - 1] = HighlightedBlock(union(last.range, block.range), last.spans + block.spans)
                } else {
                    blocks.add(block)
                }
            }
            return blocks
        }

        // Positions ---------------------------------------------------------------------------------------------------------------

        private fun range(node: Node): UnitRange? = map.range(node)

        /** The range from `start` to `end`, or null when they are the wrong way round (a child's range can lie outside its parent's). */
        private fun between(start: Int, end: Int): UnitRange? = if (start <= end) UnitRange(start, end) else null

        private fun add(range: UnitRange?, kind: HighlightKind) {
            if (range == null || range.isEmpty) return
            spans.add(HighlightSpan(range.toTextRange(), kind))
        }

        private fun char(i: Int) = text[i].code

        private fun descend(node: Node) {
            for (child in node.children()) visit(child)
        }

        /** A node's span, then the syntax around its children as marks. */
        private fun wrap(node: Node, kind: HighlightKind) {
            val whole = range(node) ?: return descend(node)
            add(whole, kind)
            descend(node)
            val kids = node.children().mapNotNull { range(it) }
            if (kids.isNotEmpty()) {
                add(between(whole.start, kids.first().start), HighlightKind.Mark)
                add(between(kids.last().end, whole.end), HighlightKind.Mark)
            }
        }

        // Nodes -------------------------------------------------------------------------------------------------------------------

        private fun visit(node: Node) {
            when (node) {
                is Heading -> wrap(node, HighlightKind.Heading(node.level))
                is StrongEmphasis -> wrap(node, HighlightKind.Strong)
                is Emphasis -> wrap(node, HighlightKind.Emphasis)
                is Strikethrough -> wrap(node, HighlightKind.Strikethrough)
                is Code -> inlineCode(node)
                is FencedCodeBlock, is IndentedCodeBlock -> codeBlock(node)
                is Link, is Image -> wrapLink(node)
                is BlockQuote -> blockQuote(node)
                is ListItem -> listItem(node)
                is ThematicBreak -> add(range(node), HighlightKind.Rule)
                is HtmlBlock, is HtmlInline -> add(range(node), HighlightKind.Tag)
                else -> descend(node)
            }
        }

        private fun inlineCode(code: Code) {
            val whole = range(code) ?: return
            add(whole, HighlightKind.InlineCode)
            // The backtick runs at each end.
            var left = whole.start
            while (left < whole.end && char(left) == 0x60) left++
            var right = whole.end
            while (right > left && char(right - 1) == 0x60) right--
            add(UnitRange(whole.start, left), HighlightKind.Mark)
            add(UnitRange(right, whole.end), HighlightKind.Mark)
        }

        private fun codeBlock(block: Node) {
            val whole = range(block) ?: return
            add(whole, HighlightKind.CodeBlock)
            // A fenced block: its first and last lines are the fences.
            var start = whole.start
            while (start < whole.end && char(start) == 0x20) start++
            if (!(start < whole.end && (char(start) == 0x60 || char(start) == 0x7E))) return
            var firstEnd = whole.start
            while (firstEnd < whole.end && char(firstEnd) != 0x0A) firstEnd++
            add(UnitRange(whole.start, firstEnd), HighlightKind.Mark)
            var lastStart = whole.end
            while (lastStart > firstEnd && char(lastStart - 1) == 0x0A) lastStart--  // a trailing break is not part of the line
            val lineEnd = lastStart
            while (lastStart > firstEnd && char(lastStart - 1) != 0x0A) lastStart--
            if (lastStart > firstEnd) add(UnitRange(lastStart, lineEnd), HighlightKind.Mark)
        }

        private fun wrapLink(link: Node) {
            val whole = range(link) ?: return descend(link)
            val kids = link.children().mapNotNull { range(it) }
            if (kids.isNotEmpty()) {
                add(between(kids.first().start, kids.last().end), HighlightKind.LinkText)
                descend(link)
                add(between(whole.start, kids.first().start), HighlightKind.Mark)
                add(between(kids.last().end, whole.end), HighlightKind.Mark)
            } else {
                add(whole, HighlightKind.LinkText)
            }
        }

        private fun blockQuote(quote: BlockQuote) {
            val whole = range(quote) ?: return descend(quote)
            add(whole, HighlightKind.Quote)
            descend(quote)
            // The `>` that starts each line of the quote.
            var line = whole.start
            while (line < whole.end) {
                var p = line
                while (p < whole.end && char(p) == 0x20) p++
                while (p < whole.end && char(p) == 0x3E) {
                    add(UnitRange(p, p + 1), HighlightKind.Mark)
                    p++
                    if (p < whole.end && char(p) == 0x20) p++
                }
                while (line < whole.end && char(line) != 0x0A) line++
                line++
            }
        }

        private fun listItem(item: ListItem) {
            val whole = range(item)
            if (whole != null) {
                var p = whole.start
                if (p < text.length && (char(p) == 0x2D || char(p) == 0x2A || char(p) == 0x2B)) {
                    p++
                } else {
                    while (p < text.length && char(p) in 0x30..0x39) p++
                    if (p < text.length && (char(p) == 0x2E || char(p) == 0x29)) p++
                }
                add(UnitRange(whole.start, p), HighlightKind.ListMarker)
                // A task item's `[ ]` or `[x]`.
                var q = p
                while (q < text.length && char(q) == 0x20) q++
                if (item.firstChild is TaskListItemMarker && q + 2 < text.length && char(q) == 0x5B) add(UnitRange(q, q + 3), HighlightKind.ListMarker)
            }
            descend(item)
        }

        companion object {
            /** The end (in UTF-16 units) of a leading `---` block, as `NoteFrontmatter` finds it. */
            private fun frontmatterEnd(text: String): Int? {
                if (!(text.startsWith("---\n") || text.startsWith("---\r\n"))) return null
                val (frontmatter, body) = NoteFrontmatter.split(text)
                if (frontmatter == null) return null
                return text.length - body.length
            }
        }
    }
}
