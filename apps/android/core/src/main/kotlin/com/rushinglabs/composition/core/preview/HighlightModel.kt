package com.rushinglabs.composition.core.preview

import com.rushinglabs.composition.core.markdown.TextRange

// Colouring only what was typed, ported from the iPad's HighlightModel.swift (its build plan, Step 5; its risk R13, Android's R3). Reading
// the whole note and re-colouring all of it after every keystroke took 87 ms for a 5,000-line note on the iPad (S3). This keeps the colours
// as a list of the note's top-level blocks, each with the spans inside it, and after an edit re-reads only the blocks around it: the one
// that was typed in, and its neighbours, in case what was typed joined or split them.
//
// A piece read alone can be wrong. A fence typed on one line swallows the lines below it, which are not in the piece; a list that goes on
// past a blank line is two lists to a reader that sees one of them. So after a pause the whole note is read again, off the main thread,
// and `differences` says which blocks the quick read had wrong, and only those are re-coloured. Knowing nothing of Android, this is plain
// text and numbers, and tested against the full read.

/**
 * The text positions touched by a run of edits, as one edit: what to replace in the text as it was, and how long the replacement is now.
 * A text view can change several times before anyone looks (a composition, an undo, a paste with a correction after it).
 */
class EditAccumulator {
    var start = 0
        private set
    /** The end of the touched piece in the text as it was before any of the edits. */
    var oldEnd = 0
        private set
    /** The end of the touched piece in the text as it is now. */
    var newEnd = 0
        private set
    var isEmpty = true
        private set

    /** A run of edits as one: what it replaced in the original text (`range`), and how long the text there is now. */
    data class Merged(val range: TextRange, val newLength: Int)

    /**
     * Notes one more edit: `range` is where it replaced text, in the text as it was just before it, and `newLength` is how long the
     * replacement is.
     */
    fun record(range: TextRange, newLength: Int) {
        if (isEmpty) {
            start = range.location
            oldEnd = range.end
            newEnd = range.location + newLength
            isEmpty = false
            return
        }
        if (range.end > newEnd) {
            // The edit reaches past the touched piece, over text that none of the edits touched: that text joins the piece.
            oldEnd += range.end - newEnd
            newEnd = range.location + newLength
        } else {
            newEnd += newLength - range.length
        }
        start = minOf(start, range.location)
    }

    /** The touched piece as a single edit, or null when nothing was recorded. */
    val merged: Merged? get() = if (isEmpty) null else Merged(TextRange(start, oldEnd - start), newEnd - start)
}

/**
 * The colours of a note as its top-level blocks. Unlike the iPad's, which is a Swift value, this is an object that `edited` changes in
 * place: `copy()` it to keep the colours as they were.
 */
class HighlightModel private constructor(blocks: List<Block>, length: Int) {
    /** A top-level block, with its spans held relative to the start of its range so that moving the block moves them all. */
    internal class Block(var range: TextRange, /** positions relative to `range.location` */ val spans: List<HighlightSpan>) {
        constructor(block: HighlightedBlock) : this(
            block.range,
            block.spans.map { HighlightSpan(TextRange(it.range.location - block.range.location, it.range.length), it.kind) },
        )

        /**
         * Two blocks colour the text the same when they start at the same place and hold the same spans. Their lengths may differ by a
         * line break at the end, depending on whether the text the parser was given ended there, and that colours nothing.
         */
        override fun equals(other: Any?) = other is Block && range.location == other.range.location && spans == other.spans

        override fun hashCode() = 31 * range.location + spans.hashCode()

        fun absolute() = spans.map { HighlightSpan(TextRange(it.range.location + range.location, it.range.length), it.kind) }

        fun copy() = Block(range, spans)
    }

    internal val blocks: MutableList<Block> = blocks.toMutableList()

    /** The length, in UTF-16 units, of the text this describes. */
    var length = length
        private set

    /** Reads all of `text`. */
    constructor(text: String) : this(MarkdownHighlighter.blocks(text).map(::Block), text.length)

    val blockCount get() = blocks.size

    fun copy() = HighlightModel(blocks.map { it.copy() }, length)

    override fun equals(other: Any?) = other is HighlightModel && length == other.length && blocks == other.blocks

    override fun hashCode() = 31 * length + blocks.hashCode()

    override fun toString() = "HighlightModel(length: $length, blocks: ${blocks.size})"

    // After an edit ---------------------------------------------------------------------------------------------------------------

    /**
     * Brings the model up to date with an edit: `range` of the old text became `newLength` units, and `text` is the text now. Re-reads
     * the blocks around the edit (the lines they cover), and returns the range of the new text whose colours must be put on again.
     */
    fun edited(range: TextRange, newLength: Int, text: String): TextRange {
        val delta = newLength - range.length
        length += delta
        if (blocks.isEmpty()) {
            blocks.addAll(MarkdownHighlighter.blocks(text).map(::Block))
            return TextRange(0, text.length)
        }

        // The blocks the edit touches, and one more on each side: what was typed may join them to the block it is next to, or split one.
        var first = firstBlock(endingAtOrAfter = range.location)
        if (first > 0) first -= 1
        first = minOf(first, blocks.size - 1)
        var last = lastBlock(startingAtOrBefore = range.end)
        if (last + 1 < blocks.size) last += 1
        last = maxOf(last, first)

        val start = minOf(blocks[first].range.location, range.location)
        val end = maxOf(blocks[last].range.end, range.end) + delta
        val upper = minOf(maxOf(end, start), text.length)
        val from = minOf(start, text.length)
        val window = lineRange(text, TextRange(from, upper - from))

        val reread = MarkdownHighlighter.blocks(text.substring(window.location, window.end), frontmatter = window.location == 0).map { block ->
            Block(HighlightedBlock(
                TextRange(block.range.location + window.location, block.range.length),
                block.spans.map { HighlightSpan(TextRange(it.range.location + window.location, it.range.length), it.kind) },
            ))
        }

        // Everything after the edit moves by what the edit added or removed; the blocks that were re-read are replaced.
        for (index in (last + 1) until blocks.size) blocks[index].range = TextRange(blocks[index].range.location + delta, blocks[index].range.length)
        val replaced = blocks.subList(first, last + 1)
        replaced.clear()
        replaced.addAll(reread)
        joinOverlaps(maxOf(first - 1, 0), minOf(first + reread.size, blocks.size - 1))
        return window
    }

    /**
     * A re-read piece can start inside the block before it when a block ends in the middle of a line (a frontmatter closed by `---` with
     * text after it on that line). Such blocks are joined, so that blocks always stay in order and apart.
     */
    private fun joinOverlaps(start: Int, end: Int) {
        var index = start + 1
        var stop = end
        while (index <= stop && index < blocks.size) {
            val previous = blocks[index - 1]
            val current = blocks[index]
            if (current.range.location < previous.range.end) {
                val joined = Block(HighlightedBlock(union(previous.range, current.range), previous.absolute() + current.absolute()))
                blocks[index - 1] = joined
                blocks.removeAt(index)
                stop -= 1
            } else {
                index += 1
            }
        }
    }

    /** The index of the first block that ends at or after `position`, or `blocks.size`. */
    private fun firstBlock(endingAtOrAfter: Int): Int {
        var low = 0
        var high = blocks.size
        while (low < high) {
            val middle = (low + high) / 2
            if (blocks[middle].range.end >= endingAtOrAfter) high = middle else low = middle + 1
        }
        return low
    }

    /** The index of the last block that starts at or before `position`, or -1. */
    private fun lastBlock(startingAtOrBefore: Int): Int {
        var low = 0
        var high = blocks.size
        while (low < high) {
            val middle = (low + high) / 2
            if (blocks[middle].range.location <= startingAtOrBefore) low = middle + 1 else high = middle
        }
        return low - 1
    }

    // Reading the colours ---------------------------------------------------------------------------------------------------------

    /**
     * The spans to put on `range`, in the order to put them on (a later one wins), with positions in the whole text. A span may stick
     * out of `range`: clip it to what is being coloured.
     */
    fun spans(range: TextRange): List<HighlightSpan> {
        if (blocks.isEmpty()) return emptyList()
        var first = firstBlock(endingAtOrAfter = range.location)
        val result = ArrayList<HighlightSpan>()
        while (first < blocks.size && blocks[first].range.location < range.end) {
            result += blocks[first].absolute()
            first += 1
        }
        return result
    }

    // Against a full read ---------------------------------------------------------------------------------------------------------

    /**
     * The ranges where this model's colours are not the ones `older` describes, ready to be put on again: every block that one has and
     * the other does not, from both, joined where they touch. With `older` being what is on the text, and this a fresh read of all of
     * it, this is what the quick reads got wrong.
     */
    fun differences(older: HighlightModel): List<TextRange> {
        val dirty = ArrayList<TextRange>()
        var i = 0
        var j = 0
        val mine = blocks
        val theirs = older.blocks
        while (i < mine.size || j < theirs.size) {
            if (i < mine.size && j < theirs.size && mine[i] == theirs[j]) {
                i += 1
                j += 1
            } else if (j >= theirs.size || (i < mine.size && mine[i].range.location < theirs[j].range.location)) {
                dirty.add(mine[i].range)
                i += 1
            } else if (i >= mine.size || theirs[j].range.location < mine[i].range.location) {
                dirty.add(theirs[j].range)
                j += 1
            } else {
                // The same place, but not the same block: both are to be redone.
                dirty.add(union(mine[i].range, theirs[j].range))
                i += 1
                j += 1
            }
        }
        return joined(dirty)
    }

    companion object {
        /** Sorted, with ranges that overlap or touch made into one. */
        internal fun joined(ranges: List<TextRange>): List<TextRange> {
            val result = ArrayList<TextRange>()
            for (range in ranges.sortedBy { it.location }) {
                val last = result.lastOrNull()
                if (last != null && range.location <= last.end) result[result.size - 1] = union(last, range) else result.add(range)
            }
            return result
        }

        private fun isLineEnd(c: Char) = c == '\n' || c == '\r' || c == '\u0085' || c == '\u2028' || c == '\u2029'

        /**
         * NSString's `lineRange(for:)`: the whole lines `range` touches, with the line break that ends the last of them. Lines end at
         * `\n`, `\r`, `\r\n`, U+0085, U+2028 and U+2029, and a `\r\n` is one break.
         */
        internal fun lineRange(text: String, range: TextRange): TextRange {
            var start = minOf(range.location, text.length)
            // Inside a `\r\n`: the `\n` belongs to the line the `\r` ends.
            if (start in 1 until text.length && text[start] == '\n' && text[start - 1] == '\r') start -= 1
            while (start > 0 && !isLineEnd(text[start - 1])) start -= 1
            var end = minOf(if (range.length > 0) range.end - 1 else range.location, text.length)
            while (end < text.length && !isLineEnd(text[end])) end += 1
            if (end < text.length) end += if (text[end] == '\r' && end + 1 < text.length && text[end + 1] == '\n') 2 else 1
            return TextRange(start, maxOf(end, start) - start)
        }
    }
}
