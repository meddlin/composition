package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.markdown.TextRange
import org.commonmark.node.Node
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

// What the Live model's edit tests ask of the editor's colours. On the iPad they drive `HighlightModel`, which keeps the note's colours as its
// top-level blocks and, after an edit, re-reads the blocks around it: the window it returns is what the Live model reads again, and comparing it
// with a full read says when a quick read went wrong (a fence typed on one line swallows the lines below it). The colours are another slice of
// the Android port (`MarkdownHighlighter` and `HighlightModel`), so these tests use this stand-in, which keeps the blocks the same way and gives
// the same kind of window: the edit's blocks and one more on each side, widened to whole lines. Where the iPad compares two blocks by their
// colour spans, this compares where each of their nodes is. When the colours are ported, the tests can drive the real one.

internal class EditorBlocks(text: String) {
    /** A top-level block: where it is, and a fingerprint of what the parser made of it, with places relative to its start. */
    private data class Block(val location: Int, val length: Int, val nodes: List<String>) {
        val end get() = location + length

        fun moved(delta: Int) = copy(location = location + delta)

        /** Two blocks read the same when they start at the same place and hold the same nodes; a line break more or less at the end colours nothing. */
        fun sameAs(other: Block) = location == other.location && nodes == other.nodes
    }

    private var blocks: MutableList<Block> = read(text, frontmatter = true).toMutableList()

    /**
     * Brings the blocks up to date with an edit: `range` of the old text became `newLength` units, and `text` is the text now. Re-reads the blocks
     * around the edit, and returns the range of the new text that was read again: whole lines, holding the edit and whole top-level blocks.
     */
    fun edited(range: TextRange, newLength: Int, text: String): TextRange {
        val delta = newLength - range.length
        if (blocks.isEmpty()) {
            blocks = read(text, frontmatter = true).toMutableList()
            return TextRange(0, text.length)
        }
        var first = blocks.indexOfFirst { it.end >= range.location }.let { if (it < 0) blocks.size else it }
        if (first > 0) first--
        first = minOf(first, blocks.size - 1)
        var last = blocks.indexOfLast { it.location <= range.end }
        if (last + 1 < blocks.size) last++
        last = maxOf(last, first)

        val start = minOf(blocks[first].location, range.location)
        val end = maxOf(blocks[last].end, range.end) + delta
        val from = minOf(start, text.length)
        val window = lineRange(text, from, minOf(maxOf(end, start), text.length))
        val reread = read(text.substring(window.location, window.end), frontmatter = window.location == 0).map { it.moved(window.location) }
        for (index in last + 1 until blocks.size) blocks[index] = blocks[index].moved(delta)
        val replaced = blocks.subList(first, last + 1)
        replaced.clear()
        replaced.addAll(reread)
        blocks = joinOverlaps(blocks)
        return window
    }

    /** The places where these blocks are not the ones `older` has: every block one has and the other has not, from both, joined where they touch. */
    fun differences(older: EditorBlocks): List<TextRange> {
        val dirty = ArrayList<TextRange>()
        var i = 0
        var j = 0
        val mine = blocks
        val theirs = older.blocks
        while (i < mine.size || j < theirs.size) {
            if (i < mine.size && j < theirs.size && mine[i].sameAs(theirs[j])) {
                i++
                j++
            } else if (j >= theirs.size || (i < mine.size && mine[i].location < theirs[j].location)) {
                dirty.add(TextRange(mine[i].location, mine[i].length))
                i++
            } else if (i >= mine.size || theirs[j].location < mine[i].location) {
                dirty.add(TextRange(theirs[j].location, theirs[j].length))
                j++
            } else {
                val lower = minOf(mine[i].location, theirs[j].location)
                dirty.add(TextRange(lower, maxOf(mine[i].end, theirs[j].end) - lower))
                i++
                j++
            }
        }
        return dirty.sortedBy { it.location }
    }

    private companion object {
        val parser: Parser = Parser.builder().includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES).build()

        /** The top-level blocks of `text`, the frontmatter (blanked for the parser, its line breaks kept) one of them. */
        fun read(text: String, frontmatter: Boolean): List<Block> {
            val out = ArrayList<Block>()
            var source = text
            if (frontmatter && (text.startsWith("---\n") || text.startsWith("---\r\n"))) {
                val (yaml, body) = NoteFrontmatter.split(text)
                if (yaml != null) {
                    val end = text.length - body.length
                    out.add(Block(0, end, listOf("frontmatter")))
                    source = String(CharArray(end) { val c = text[it]; if (c == '\n' || c == '\r') c else ' ' }) + body
                }
            }
            var child = parser.parse(source).firstChild
            while (child != null) {
                val nodes = ArrayList<String>()
                var lower = Int.MAX_VALUE
                var upper = Int.MIN_VALUE
                fun walk(node: Node) {
                    for (span in node.sourceSpans) {
                        lower = minOf(lower, span.inputIndex)
                        upper = maxOf(upper, span.inputIndex + span.length)
                    }
                    var inner = node.firstChild
                    while (inner != null) {
                        walk(inner)
                        inner = inner.next
                    }
                }
                walk(child)
                if (lower <= upper) {
                    fun fingerprint(node: Node) {
                        nodes.add(node.javaClass.simpleName + node.sourceSpans.joinToString("") { " ${it.inputIndex - lower}+${it.length}" })
                        var inner = node.firstChild
                        while (inner != null) {
                            fingerprint(inner)
                            inner = inner.next
                        }
                    }
                    fingerprint(child)
                    out.add(Block(lower, upper - lower, nodes))
                }
                child = child.next
            }
            return joinOverlaps(out)
        }

        /** Blocks in order and apart: one that starts inside the block before it joins it. */
        fun joinOverlaps(blocks: List<Block>): MutableList<Block> {
            val out = ArrayList<Block>()
            for (block in blocks) {
                val last = out.lastOrNull()
                if (last != null && block.location < last.end) {
                    out[out.lastIndex] = Block(last.location, maxOf(last.end, block.end) - last.location, last.nodes + block.nodes)
                } else {
                    out.add(block)
                }
            }
            return out
        }

        /** The whole lines holding `from` to `to` (`NSString.lineRange(for:)`), their line breaks included. */
        fun lineRange(text: String, from: Int, to: Int): TextRange {
            var start = from
            while (start > 0 && text[start - 1] != '\n' && text[start - 1] != '\r') start--
            var end = if (to > from) to - 1 else from
            if (end < text.length) {
                while (end < text.length && text[end] != '\n' && text[end] != '\r') end++
                if (end < text.length) end += if (text[end] == '\r' && end + 1 < text.length && text[end + 1] == '\n') 2 else 1
            }
            return TextRange(start, end - start)
        }
    }
}

/** `text` with `range` replaced by `insertion`. */
internal fun replacing(text: String, range: TextRange, insertion: String) = text.substring(0, range.location) + insertion + text.substring(range.end)

/** The iPad tests' seeded generator (a 64-bit LCG), so the same seed makes the same edits as there. */
internal class SeededEdits(private var seed: ULong) {
    fun next(below: Int): Int {
        seed = seed * 6364136223846793005uL + 1442695040888963407uL
        return ((seed shr 33) % below.toULong()).toInt()
    }
}
