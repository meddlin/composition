package com.rushinglabs.composition.core.live

import com.rushinglabs.composition.core.editing.MarkHighlight
import com.rushinglabs.composition.core.markdown.JS_ANY
import com.rushinglabs.composition.core.markdown.JS_SPACE_CHARS
import com.rushinglabs.composition.core.markdown.TextRange
import java.util.regex.Pattern

// What the Live view needs to know of a note's text beyond its Markdown tree, ported from LiveScan.swift: the desktop's `scanOf`
// (liveMarkdown.ts), which reads the text with `tokenizeMarkdown` (markdownTokens.ts, to tell where code is), `markTints` and `markElements`
// (markTints.ts) and `imageElements` (liveImages.ts, for `<Image />` and `<Ink />`; `<Drawio />` is read the same way, the iPad's own).
// Checked as a port: LiveConformanceTests runs the desktop's real code over the same texts. The regular expressions are the desktop's with
// JavaScript's `\w`, `\s`, `\S`, `\b` and `.` written out, because a JVM's and Android's differ from JavaScript's and from each other.

internal object LiveScan {
    data class Tint(val range: TextRange, val color: String)

    /** A highlight's pair of tags. */
    data class MarkElement(val open: TextRange, val close: TextRange) {
        val whole get() = TextRange(open.location, close.end - open.location)
    }

    /** An `<Image … />`, `<Ink … />` or `<Drawio … />` as the text writes it. */
    data class ImageTag(
        val range: TextRange,
        val src: String,
        val alt: String,
        val title: String,
        val width: String,
        /** Which of the three tags it is. */
        val kind: LivePictureKind = LivePictureKind.IMAGE,
    )

    data class Result(
        val tints: List<Tint> = emptyList(),
        val elements: List<MarkElement> = emptyList(),
        val images: List<ImageTag> = emptyList(),
    ) {
        /**
         * Where these places are after `edit` (a range of the old text) was replaced by text `delta` units longer: what is before it stays, what is
         * after it moves, a highlight's tinted stretch that holds the edit takes it in (so typing in a highlight keeps it tinted), and a tag or an
         * `<Image />` that the edit touches is dropped, as it may no longer be one. A full read after a pause puts right what this gets wrong.
         */
        fun shifted(edit: TextRange, delta: Int): Result {
            fun moved(range: TextRange): TextRange? = when {
                range.end <= edit.location -> range
                range.location >= edit.end -> TextRange(range.location + delta, range.length)
                else -> null
            }
            val tints = ArrayList<Tint>()
            for (tint in this.tints) {
                if (tint.range.location <= edit.location && edit.end <= tint.range.end) {
                    tints.add(Tint(TextRange(tint.range.location, tint.range.length + delta), tint.color))
                } else {
                    moved(tint.range)?.let { tints.add(Tint(it, tint.color)) }
                }
            }
            val elements = this.elements.mapNotNull { element ->
                val open = moved(element.open)
                val close = moved(element.close)
                if (open != null && close != null) MarkElement(open, close) else null
            }
            val images = this.images.mapNotNull { image -> moved(image.range)?.let { image.copy(range = it) } }
            return Result(tints, elements, images)
        }

        /** The places in which this and `other` differ: what one has and the other has not, in order, those that overlap or touch made one. */
        fun differences(other: Result): List<TextRange> {
            val found = ArrayList<TextRange>()
            found += symmetricDifference(tints, other.tints).map { it.range }
            found += symmetricDifference(elements, other.elements).map { it.whole }
            found += symmetricDifference(images, other.images).map { it.range }
            return joined(found)
        }
    }

    // JavaScript's `\s`, `\w` and `.`.
    private const val SPACE = JS_SPACE_CHARS
    private const val WORD = "A-Za-z0-9_"
    private const val DOT = JS_ANY

    // The patterns run over a whole note are walked with one `Matcher` and `find()`. Kotlin's `findAll` makes a new `Matcher` for each match, and
    // Android's `Matcher` (ICU's, underneath) copies the whole text each time one is made or reset: on a long note with many highlights that took
    // the emulator more than a second, where the JVM took 30 ms.
    private val markTag = Pattern.compile("""<Mark(?![$WORD])[^<>]*>|</Mark[$SPACE]*>""")
    private val color = Regex("""(?<![$WORD])color="([^"]*)"""")

    /** `<Image … />`, `<Ink … />` or `<Drawio … />`: group 1 is the name. */
    private val imageTag = Pattern.compile("""<(Image|Ink|Drawio)(?![$WORD])[^<>]*/>""")
    private val prop = Regex("""(?<![$WORD])([A-Za-z]+)[$SPACE]*=[$SPACE]*(?:"([^"]*)"|'([^']*)'|\{[$SPACE]*"([^"]*)"[$SPACE]*\})""")

    /** Reads `text`: the highlights' tints and tags, and the `<Image />`, `<Ink />` and `<Drawio />` tags, outside code and frontmatter. */
    fun read(text: String): Result {
        val hasMark = text.contains("<Mark")
        val hasImage = text.contains("<Image") || text.contains("<Ink") || text.contains("<Drawio")
        if (!hasMark && !hasImage) return Result()
        val literal = Literals(MarkdownLiterals.ranges(text))
        var tints = emptyList<Tint>()
        var elements = emptyList<MarkElement>()
        if (hasMark) markUp(text, literal).let { tints = it.first; elements = it.second }
        val images = if (hasImage) imagesIn(text, literal) else emptyList()
        return Result(tints, elements, images)
    }

    private class Open(val color: String) {
        var closed = false
    }

    private class OpenSpan(val range: TextRange, val color: String, val owner: Open)

    /** `markTints` and `markElements` together: they pair tags in the same way. A tag left open, one closed twice and a self-closing one are ignored. */
    private fun markUp(text: String, literal: Literals): Pair<List<Tint>, List<MarkElement>> {
        val open = ArrayList<Pair<Open, TextRange>>()
        val spans = ArrayList<OpenSpan>()
        val elements = ArrayList<MarkElement>()
        var cursor = 0
        val match = markTag.matcher(text)
        while (match.find()) {
            val tag = TextRange(match.start(), match.end() - match.start())
            if (literal.contains(tag.location)) continue
            val source = match.group()
            val closing = source.startsWith("</")
            if (!closing && source.endsWith("/>")) continue
            if (closing && open.isEmpty()) continue

            val owner = open.lastOrNull()?.first
            if (owner != null && tag.location > cursor) spans.add(OpenSpan(TextRange(cursor, tag.location - cursor), owner.color, owner))
            cursor = tag.end
            if (closing) {
                val opened = open.removeAt(open.lastIndex)
                opened.first.closed = true
                elements.add(MarkElement(opened.second, tag))
            } else {
                val given = color.find(source)?.groupValues?.get(1)
                open.add(Open(if (given != null && given in MarkHighlight.colors) given else MarkHighlight.DEFAULT_COLOR) to tag)
            }
        }
        return spans.filter { it.owner.closed }.map { Tint(it.range, it.color) } to elements.sortedBy { it.open.location }
    }

    /** `imageElements`: each complete `<Image … />` (and `<Ink … />`, `<Drawio … />`), with the props it writes as quoted text. One with no `src` is skipped. */
    private fun imagesIn(text: String, literal: Literals): List<ImageTag> {
        val images = ArrayList<ImageTag>()
        val match = imageTag.matcher(text)
        while (match.find()) {
            if (literal.contains(match.start())) continue
            val tag = match.group()
            val props = HashMap<String, String>()
            for (found in prop.findAll(tag)) {
                val name = found.groupValues[1]
                for (group in 2..4) {
                    val value = found.groups[group] ?: continue
                    props[name] = value.value
                    break
                }
            }
            val src = props["src"]
            if (src.isNullOrEmpty()) continue
            val kind = when (match.group(1)) {
                "Ink" -> LivePictureKind.INK
                "Drawio" -> LivePictureKind.DRAWIO
                else -> LivePictureKind.IMAGE
            }
            images.add(ImageTag(TextRange(match.start(), tag.length), src, props["alt"] ?: "", props["title"] ?: "", props["width"] ?: "", kind))
        }
        return images
    }

    /** Whether an index is in a stretch whose tags are not tags (`literalFinder`). */
    class Literals(private val ranges: List<TextRange>) {
        fun contains(index: Int): Boolean {
            var low = 0
            var high = ranges.size
            while (low < high) {
                val middle = (low + high) / 2
                if (ranges[middle].end <= index) low = middle + 1 else high = middle
            }
            return low < ranges.size && ranges[low].location <= index
        }
    }

    // Where code is

    /**
     * `tokenizeMarkdown`, as far as it says where code is: the stretches it calls frontmatter, a fence or code, in order. Line by line,
     * remembering only whether it is inside a fence, as the desktop's does.
     */
    object MarkdownLiterals {
        private val frontmatter = Regex("""^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?""")

        /** The desktop's INLINE, one alternation so the leftmost construct wins: 1 an escape, 2 code, 4 a link, 7 a tag, 8 bold, 9 italic. */
        private val inline: Pattern = Pattern.compile(
            """(\\[\\`*_{}\[\]()#+\-.!<>~|])""" +
                """|((`+)(?!`)$DOT+?(?<!`)\3(?!`))""" +
                """|((!?\[[^\]]*\])(\([^)]*\)))""" +
                """|(</?[A-Za-z][^<>]*>)""" +
                """|(\*\*(?=[^$SPACE])$DOT+?(?<=[^$SPACE])\*\*|(?<![$WORD])__(?=[^$SPACE])$DOT+?(?<=[^$SPACE])__(?![$WORD]))""" +
                """|((?<!\*)\*(?=[^$SPACE*])$DOT+?(?<=[^$SPACE*])\*(?!\*)|(?<![$WORD])_(?=[^${SPACE}_])$DOT+?(?<=[^${SPACE}_])_(?![$WORD]))""",
        )

        /** Past this a line is left plain (`MAX_INLINE_LINE`). */
        private const val MAX_INLINE_LINE = 2000

        private class Fence(val char: Char, val length: Int)

        fun ranges(text: String): List<TextRange> {
            val out = ArrayList<TextRange>()
            var position = 0
            frontmatter.find(text)?.let { block ->
                out.add(TextRange(0, block.value.length))
                position = block.value.length
            }
            var fence: Fence? = null
            while (position < text.length) {
                var end = position
                while (end < text.length && text[end] != '\n') end++
                var lineEnd = end
                if (lineEnd > position && text[lineEnd - 1] == '\r') lineEnd--
                fence = line(text, position, lineEnd, fence, out)
                position = end + 1
            }
            return out
        }

        /** One line; returns the fence the next line is inside, if any. */
        private fun line(text: String, start: Int, end: Int, fence: Fence?, out: MutableList<TextRange>): Fence? {
            fun skipSpaces(from: Int, max: Int): Int {
                var i = from
                while (i < end && i - from < max && text[i] == ' ') i++
                return i
            }

            /** A run of three or more backticks or tildes after up to three spaces: its character, its length and where it ends. */
            fun fenceRun(): Triple<Char, Int, Int>? {
                val i = skipSpaces(start, 3)
                if (i >= end || (text[i] != '`' && text[i] != '~')) return null
                var j = i
                while (j < end && text[j] == text[i]) j++
                return if (j - i >= 3) Triple(text[i], j - i, j) else null
            }

            if (fence != null) {
                val run = fenceRun()
                out.add(TextRange(start, end - start))
                if (run != null && run.first == fence.char && run.second >= fence.length && (run.third until end).all { text[it] == ' ' || text[it] == '\t' }) {
                    return null
                }
                return fence
            }

            fenceRun()?.let { run ->
                val info = text.substring(run.third, end)
                // The rest of the line must be one JavaScript `.` can cross (no `\r`, U+2028 or U+2029), and an info string cannot hold a backtick.
                if (info.none { it == '\r' || it == '\u2028' || it == '\u2029' } && !(run.first == '`' && info.contains('`'))) {
                    out.add(TextRange(start, end - start))
                    return Fence(run.first, run.second)
                }
            }

            // A heading: up to three spaces, one to six `#`, then a space, a tab or the end.
            var i = skipSpaces(start, 3)
            var hashes = 0
            while (i + hashes < end && text[i + hashes] == '#') hashes++
            if (hashes in 1..6 && (i + hashes == end || text[i + hashes] == ' ' || text[i + hashes] == '\t')) return null
            if (isThematicBreak(text, start, end)) return null

            // The quote marks, then the list marker, then the text.
            var rest = start
            i = skipSpaces(start, 3)
            if (i < end && text[i] == '>') {
                while (i < end && text[i] == '>') {
                    i++
                    if (i < end && (text[i] == ' ' || text[i] == '\t')) i++
                }
                rest = i
            }
            i = rest
            while (i < end && (text[i] == ' ' || text[i] == '\t')) i++
            var after = i
            if (after < end && (text[after] == '-' || text[after] == '*' || text[after] == '+')) {
                after++
            } else {
                while (after < end && after - i < 10 && text[after] in '0'..'9') after++
                if (after - i in 1..9 && after < end && (text[after] == '.' || text[after] == ')')) after++ else after = i
            }
            if (after > i && after < end && (text[after] == ' ' || text[after] == '\t')) {
                while (after < end && (text[after] == ' ' || text[after] == '\t')) after++
                rest = after
            }

            if (end - rest > MAX_INLINE_LINE || end <= rest) return null
            // The line alone, as the desktop slices it: a lookbehind does not see before it, nor a lookahead after it. A slice and not a region of
            // the whole note, because Android copies a `Matcher`'s whole text each time it is made or its region set.
            val matcher = inline.matcher(text.substring(rest, end))
            while (matcher.find()) {
                if (matcher.start(1) == -1 && matcher.start(2) != -1) out.add(TextRange(rest + matcher.start(), matcher.end() - matcher.start()))
            }
            return null
        }

        /** Three or more of one of `-`, `*`, `_`, with spaces or tabs between and after them, after up to three spaces (`isThematicBreak`). */
        private fun isThematicBreak(text: String, start: Int, end: Int): Boolean {
            var i = start
            while (i < end && i - start < 3 && text[i] == ' ') i++
            if (i >= end || (text[i] != '-' && text[i] != '*' && text[i] != '_')) return false
            val marker = text[i]
            var count = 0
            while (i < end) {
                if (text[i] == marker) count++ else if (text[i] != ' ' && text[i] != '\t') return false
                i++
            }
            return count >= 3
        }
    }
}

/** What one list has and the other has not, from both. */
internal fun <T> symmetricDifference(a: List<T>, b: List<T>): List<T> {
    val left = a.toSet()
    val right = b.toSet()
    return (left - right).toList() + (right - left).toList()
}

/** Sorted, with ranges that overlap or touch made into one. */
internal fun joined(ranges: List<TextRange>): List<TextRange> {
    val result = ArrayList<TextRange>()
    for (range in ranges.sortedBy { it.location }) {
        val last = result.lastOrNull()
        if (last != null && range.location <= last.end) result[result.lastIndex] = union(last, range) else result.add(range)
    }
    return result
}

/** The smallest range holding both: `NSUnionRange`. */
internal fun union(a: TextRange, b: TextRange): TextRange {
    val start = minOf(a.location, b.location)
    return TextRange(start, maxOf(a.end, b.end) - start)
}
