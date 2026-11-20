package com.rushinglabs.composition.core.markdown

import org.commonmark.node.Block
import org.commonmark.node.Document
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.Heading
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.ListBlock
import org.commonmark.node.ListItem
import org.commonmark.node.Node

// Where things are in a note's text, ported from the iPad's SourceMap.swift. swift-markdown reports a line and a UTF-8 column, which the
// Swift turns into UTF-16 offsets. commonmark-java (with `NoteScanner.spannedParser`) reports, for each node, a source span per line it is
// on: a line index and a column that already counts UTF-16 units of that line. Everything built on it (the highlighter, the preview's
// located blocks, the Live model) wants offsets in the whole text, in UTF-16 units, which is what a text view counts in.
//
// The two parsers agree on what a note means but not always on where a block starts and ends, and the iPad's offsets are cmark's. So a
// block's range is turned into cmark's, by the rules cmark's `finalize` follows (checked against the iPad on the corpus and on edge cases):
//
// - A block starts at its first character that is not a space or a tab (commonmark-java starts a list item, a list or a heading at the
//   indentation before it); an indented code block starts four columns in, a tab counting to the next multiple of four.
// - A list, a list item or an indented code block, which go on over blank lines, ends at the end of the line before the line that ends it,
//   blank or not; at the end of the note, at the end of its last line.
// - A setext heading, and a fenced code block that is never closed, ends at the end of the line that ends it (cmark's quirk), which is the
//   next block's first line; at the end of the note, at the end of its own last line.
//
// Inline nodes keep commonmark-java's places. Where cmark's differ, cmark is wrong: after a link reference definition its inline places
// are a line out, and it gives `***a***`'s emphasis and strong the same range.

/** A half-open run `[start, end)` of a text's UTF-16 units: the counterpart of the iPad's `Range<Int>`. */
internal data class UnitRange(val start: Int, val end: Int) {
    val count get() = end - start
    val isEmpty get() = end <= start
    fun toTextRange() = TextRange(start, end - start)
}

internal class SourceMap(val text: String) {
    /** Where each line starts, in UTF-16 units. Lines end where commonmark-java (and cmark) end them: at `\n`, `\r\n` or `\r`. */
    private val lineStarts: IntArray
    /** Where each line's content ends, before its line break. */
    private val lineEnds: IntArray

    /** How many lines the parser reads: a line break at the very end starts no line of its own. */
    private val lineCount: Int

    init {
        val starts = ArrayList<Int>()
        val ends = ArrayList<Int>()
        starts.add(0)
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '\n' || c == '\r') {
                ends.add(i)
                i += if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') 2 else 1
                starts.add(i)
            } else {
                i++
            }
        }
        ends.add(text.length)
        lineStarts = starts.toIntArray()
        lineEnds = ends.toIntArray()
        lineCount = if (lineStarts.last() < text.length) lineStarts.size else lineStarts.size - 1
    }

    /** The offset in the text of `column` (UTF-16 units, from 0) of line `line` (from 0). */
    fun offset(line: Int, column: Int): Int {
        val start = if (line in lineStarts.indices) lineStarts[line] else text.length
        return minOf(start + maxOf(column, 0), text.length)
    }

    private fun lineEnd(line: Int) = if (line in lineEnds.indices) lineEnds[line] else text.length

    /** Where `node` is written, as the iPad (cmark) has it; null when the parser gave it no place. */
    fun range(node: Node): UnitRange? {
        val spans = node.sourceSpans
        if (spans.isEmpty()) return null
        var start = Int.MAX_VALUE
        var end = Int.MIN_VALUE
        for (span in spans) {
            val from = offset(span.lineIndex, span.columnIndex)
            start = minOf(start, from)
            end = maxOf(end, minOf(from + span.length, text.length))
        }
        if (node is Block) {
            start = if (node is IndentedCodeBlock) fourColumnsIn(start) else firstNonSpace(start, end)
            end = cmarkEnd(node, end)
        }
        return if (start <= end) UnitRange(start, end) else null
    }

    private fun firstNonSpace(from: Int, end: Int): Int {
        var i = from
        while (i < end && (text[i] == ' ' || text[i] == '\t')) i++
        return i
    }

    /** Past four columns of indentation, as cmark reads an indented code block: a tab it would split is where the block starts. */
    private fun fourColumnsIn(from: Int): Int {
        var i = from
        var columns = 0
        while (columns < 4 && i < text.length) {
            val width = when (text[i]) {
                ' ' -> 1
                '\t' -> 4 - columns % 4
                else -> return i
            }
            if (columns + width > 4) return i
            columns += width
            i++
        }
        return i
    }

    private fun firstLine(node: Node) = node.sourceSpans.firstOrNull()?.lineIndex

    private fun lastLine(node: Node) = node.sourceSpans.lastOrNull()?.lineIndex

    /** The line whose reading ends `node`: the line its next block starts on, or the one that ends what holds it; null at the end of the note. */
    private fun endingLine(node: Node): Int? {
        var sibling = node.next
        while (sibling != null) {
            firstLine(sibling)?.let { return it }
            sibling = sibling.next
        }
        val parent = node.parent ?: return null
        return if (parent is Document) null else endingLine(parent)
    }

    private fun cmarkEnd(node: Block, end: Int): Int {
        val last = lastLine(node) ?: return end
        return when {
            node is ListBlock || node is ListItem || node is IndentedCodeBlock -> {
                val ending = endingLine(node)
                if (ending == null) maxOf(end, lineEnd(lineCount - 1)) else maxOf(end, lineEnd(ending - 1))
            }
            node is Heading && isSetext(node) -> if (last + 1 < lineCount) lineEnd(last + 1) else end
            node is FencedCodeBlock && node.closingFenceLength == null -> {
                // Its last line is its opening fence's and one per line of code (blank lines among them have no span).
                val final = (firstLine(node) ?: last) + node.literal.count { it == '\n' }
                if (final + 1 < lineCount) lineEnd(final + 1) else maxOf(end, lineEnd(final))
            }
            else -> end
        }
    }

    /** A heading underlined with `=` or `-`: one that does not start with `#`. */
    private fun isSetext(heading: Heading): Boolean {
        val span = heading.sourceSpans.firstOrNull() ?: return false
        val from = offset(span.lineIndex, span.columnIndex)
        val at = firstNonSpace(from, minOf(from + span.length, text.length))
        return at >= text.length || text[at] != '#'
    }
}

/** A node's children, in order. */
internal fun Node.children(): List<Node> {
    val result = ArrayList<Node>()
    var child = firstChild
    while (child != null) {
        result.add(child)
        child = child.next
    }
    return result
}
