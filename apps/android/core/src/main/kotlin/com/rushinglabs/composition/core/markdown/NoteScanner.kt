package com.rushinglabs.composition.core.markdown

import org.commonmark.Extension
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.task.list.items.TaskListItemsExtension
import org.commonmark.node.AbstractVisitor
import org.commonmark.node.Code
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.Node
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.Text
import org.commonmark.parser.Parser

// The restricted MDX layer, ported from the iPad's NoteScanner.swift. A Markdown parser reads the CommonMark and GFM part of a note,
// but it has no notion of MDX: a note's `<Info>` arrives as raw HTML. So the tags, and what MDX rejects, are found here, over the
// note's own text; so are the footnotes, as on the iPad (its parser has none, and the numbering must not depend on which one is used).
//
// What it has to agree with is the desktop's preview pipeline (remark-mdx with remarkRestrictMdx): the same notes valid and invalid,
// the same components with the same props, a tag on lines of its own a *block* and one inside a line of text *inline*, the same
// headings, and footnotes numbered in the same order (fixtures/conformance/mdx-notes.json and what the real pipeline made of them).
// Like the desktop, a note that does not mention a component is not scanned at all: it is plain Markdown, where a stray `<` or `{` is fine.
//
// A note that is not valid MDX is not an error to show as a blank page: the caller draws it as plain Markdown, with the reason.

/** A range of a note's text in UTF-16 units (what a text view counts in): the counterpart of the iPad's `NSRange`. */
data class TextRange(val location: Int, val length: Int) {
    val end get() = location + length
}

/** A half-open run `[start, end)` of the code points the scanner reads. */
internal data class Span(val start: Int, val end: Int) {
    val count get() = end - start
    operator fun contains(i: Int) = i in start until end
}

/** A component tag's prop: `alt="x"` is text, a bare `hidden` is a flag. */
sealed interface MdxPropValue {
    data class Text(val value: String) : MdxPropValue
    data object Flag : MdxPropValue
}

/** A component in a note, in the order the opening tags are written. */
data class MdxElement(
    val name: String,
    val props: Map<String, MdxPropValue>,
    /** On lines of its own (a block), as opposed to inside a line of text. */
    val isBlock: Boolean,
    /** How many components it is inside. */
    val depth: Int,
) {
    fun text(prop: String) = (props[prop] as? MdxPropValue.Text)?.value
}

data class NoteHeading(val depth: Int, val text: String)

/** The note split where block components stand: Markdown to draw, and components with what is inside them. */
sealed interface NoteBlock {
    data class Markdown(val source: String) : NoteBlock
    data class Element(val name: String, val props: Map<String, MdxPropValue>, val children: List<NoteBlock>) : NoteBlock
}

/** Where a footnote's citation or definition is in a note's text (UTF-16 units), and its number. */
data class FootnotePlace(val range: TextRange, val number: Int)

class ScannedNote internal constructor(
    /** Whether the note mentions a component, and so was read as MDX. */
    val isMdx: Boolean,
    /** Why it is not valid MDX, if it is not. Then `blocks` is the whole note as plain Markdown. */
    val error: String?,
    val elements: List<MdxElement>,
    val headings: List<NoteHeading>,
    /** The labels of the footnotes in the order they are first cited, which is their number. */
    val footnotes: List<String>,
    /** Each footnote's text by label, as written (its citations are `[^label]` still). */
    val footnoteBodies: Map<String, String>,
    /** The note cut into blocks. The footnotes' own text is not in them: it is in `footnoteBodies`. */
    val blocks: List<NoteBlock>,
    /**
     * Where each of `blocks` is written in the note's text, in UTF-16 units, in the same order: a component from its opening tag to the
     * end of its closing one, a run of Markdown from the start of its first line that is not blank to the end of its last.
     */
    val blockRanges: List<TextRange>,
    /** For each run of Markdown, the pieces of the scanned text it was copied from; empty for a component. */
    internal val runPieces: List<List<Span>>,
    internal val index: SourceIndex,
) {
    val isValid get() = error == null

    /** Each citation of a footnote that has a definition, `[^label]` in the note's text or in a footnote's (not in code), with its number. */
    var footnoteCitations: List<FootnotePlace> = emptyList()
        private set

    /** Each definition of a footnote that is cited, where it is written, in runs: definitions with only blank lines between them are one run. */
    var footnoteDefinitions: List<List<FootnotePlace>> = emptyList()
        private set

    /** Puts the scanner's footnote places into the note's text, numbered as the preview numbers them. */
    internal fun placeFootnotes(places: NoteScanner.FootnoteSpans) {
        val numbers = footnotes.withIndex().associate { (index, label) -> label to index + 1 }
        footnoteCitations = places.citations.mapNotNull { (label, span) -> numbers[label]?.let { FootnotePlace(index.range(span), it) } }
        footnoteDefinitions = places.definitions.map { run -> run.mapNotNull { (label, span) -> numbers[label]?.let { FootnotePlace(index.range(span), it) } } }
    }

    /** What turns places in the text of `blocks[block]` (a run of Markdown) into places in the note, made once for the run. */
    internal fun locator(block: Int, text: String): RunLocator? {
        if (block >= runPieces.size || runPieces[block].isEmpty()) return null
        return RunLocator(runPieces[block], text, index)
    }

    internal class RunLocator(private val pieces: List<Span>, text: String, private val index: SourceIndex) {
        /** UTF-16 offsets of the run's text to its code points. */
        private val utf16: IntArray
        /** How many code points of the run come before each piece. */
        private val before: IntArray

        init {
            val offsets = ArrayList<Int>(text.length + 1)
            offsets.add(0)
            text.codePoints().forEach { offsets.add(offsets.last() + if (it > 0xFFFF) 2 else 1) }
            utf16 = offsets.toIntArray()
            var count = 0
            before = IntArray(pieces.size) { i -> count.also { count += pieces[i].count } }
        }

        private fun codePoint(offset: Int): Int {
            var low = 0
            var high = utf16.size - 1
            while (low < high) {
                val middle = (low + high + 1) / 2
                if (utf16[middle] <= offset) low = middle else high = middle - 1
            }
            return low
        }

        /** A code point of the run's text as one of the scanned text; an end that falls between two pieces belongs to the first. */
        private fun source(k: Int, end: Boolean): Int {
            var low = 0
            var high = pieces.size - 1
            while (low < high) {
                val middle = (low + high + 1) / 2
                if (before[middle] <= k) low = middle else high = middle - 1
            }
            while (end && low > 0 && k <= before[low]) low--
            val piece = pieces[low]
            if (k - before[low] <= piece.count) return piece.start + (k - before[low])
            return pieces.last().end
        }

        fun noteRange(start: Int, end: Int): TextRange {
            val from = index.utf16(source(codePoint(start), end = false))
            val to = index.utf16(source(codePoint(end), end = true))
            return TextRange(from, maxOf(0, to - from))
        }
    }
}

/**
 * Where the code points the scanner reads are in the note's text: UTF-16 units, past the frontmatter, and counting the `\r` of each
 * `\r\n` that the scanner does not see.
 */
internal class SourceIndex(body: String, offset: Int) {
    private val units: IntArray

    init {
        val points = body.codePoints().toArray()
        val list = ArrayList<Int>(points.size + 1)
        var position = offset
        var i = 0
        while (i < points.size) {
            if (points[i] == '\r'.code && i + 1 < points.size && points[i + 1] == '\n'.code) {
                // The scanner reads `\r\n` as `\n`: its `\n` stands for both, so that what ends before it ends before the `\r`.
                list.add(position)
                position += 2
                i += 2
                continue
            }
            list.add(position)
            position += if (points[i] > 0xFFFF) 2 else 1
            i++
        }
        list.add(position)
        units = list.toIntArray()
    }

    /** The UTF-16 offset in the note of code point `k` of the scanned text (its end, for the count of code points). */
    fun utf16(k: Int) = units[k.coerceIn(0, units.size - 1)]

    fun range(span: Span): TextRange {
        val start = utf16(span.start)
        return TextRange(start, utf16(span.end) - start)
    }
}

object NoteScanner {
    /**
     * The tags a note may use: the keys of the desktop's `mdxComponents`. `Ink` is the iPad's own so far (the desktop's catalogue has
     * no handwriting yet).
     */
    val components = listOf("Info", "Warning", "Image", "Drawio", "Ink", "Toc", "Mark", "Footnotes", "YouTube", "Repo", "Chart")

    private val extensions: List<Extension> = listOf(
        TablesExtension.create(), StrikethroughExtension.create(), AutolinkExtension.create(), TaskListItemsExtension.create(),
    )

    /** CommonMark with GFM's tables, strikethrough, autolinks and task lists: what swift-markdown reads on the iPad. No footnotes: they are read here. */
    val markdownParser: Parser = Parser.builder().extensions(extensions).build()

    /** Reads a note's body (its text without the frontmatter). `offset` is where the body starts in the note, in UTF-16 units. */
    fun scan(body: String, offset: Int = 0): ScannedNote {
        val text = body.replace("\r\n", "\n")
        val points = text.codePoints().toArray()
        val index = SourceIndex(body, offset)
        val scanner = Scanner(points, readTags = mentionsComponent(points))
        scanner.run()
        val footnotes = scanner.footnotes()
        if (scanner.readTags && scanner.failure == null) {
            val cut = scanner.blocks(footnotes)
            return ScannedNote(
                isMdx = true, error = null, elements = scanner.elements, headings = headings(markdownRuns(cut.blocks)),
                footnotes = footnotes.order, footnoteBodies = footnotes.bodies, blocks = cut.blocks,
                blockRanges = cut.ranges.map(index::range), runPieces = cut.pieces, index = index,
            ).also { it.placeFootnotes(footnotes.places) }
        }
        // Not MDX (it mentions no component), or not valid MDX: the whole note as plain Markdown, where footnotes still work.
        val plain = Scanner(points, readTags = false)
        plain.run()
        val plainFootnotes = plain.footnotes()
        val whole = plain.blocks(plainFootnotes)
        return ScannedNote(
            isMdx = scanner.readTags, error = scanner.failure, elements = emptyList(), headings = headings(markdownRuns(whole.blocks)),
            footnotes = plainFootnotes.order, footnoteBodies = plainFootnotes.bodies, blocks = whole.blocks,
            blockRanges = whole.ranges.map(index::range), runPieces = whole.pieces, index = index,
        ).also { it.placeFootnotes(plainFootnotes.places) }
    }

    /** The desktop's `usesMdxComponent`: `<` and a component's name, then a space, `/` or `>`. Code does not matter to it. */
    internal fun mentionsComponent(s: IntArray): Boolean {
        val names = components.map { it.codePoints().toArray() }
        for (i in s.indices) {
            if (s[i] != '<'.code) continue
            for (letters in names) {
                val end = i + 1 + letters.size
                if (end >= s.size || !letters.indices.all { s[i + 1 + it] == letters[it] }) continue
                val next = s[end]
                if (next == '/'.code || next == '>'.code || isWhitespace(next)) return true
            }
        }
        return false
    }

    private fun markdownRuns(blocks: List<NoteBlock>): List<String> = blocks.flatMap {
        when (it) {
            is NoteBlock.Markdown -> listOf(it.source)
            is NoteBlock.Element -> markdownRuns(it.children)
        }
    }

    /** Headings in document order, as the desktop lists them for `<Toc />`. */
    internal fun headings(runs: List<String>): List<NoteHeading> {
        val headings = ArrayList<NoteHeading>()
        for (run in runs) {
            markdownParser.parse(run).accept(object : AbstractVisitor() {
                override fun visit(heading: Heading) {
                    headings.add(NoteHeading(heading.level, trim(plainText(heading))))
                }
            })
        }
        return headings
    }

    /** A heading's words as the desktop reads them: the value of each piece of text and of code, with no marks. */
    internal fun plainText(node: Node): String = when (node) {
        is Text -> node.literal
        is Code -> node.literal
        is SoftLineBreak -> "\n"
        is HardLineBreak -> ""
        else -> buildString {
            var child = node.firstChild
            while (child != null) {
                append(plainText(child))
                child = child.next
            }
        }
    }

    /** A lone tag written as text, `<Mark color="green">`, `</Mark>` or `<Image src="a.png" />`, read the way a note's tags are. */
    internal fun lone(html: String): LoneTag? {
        val points = trim(html).codePoints().toArray()
        val tag = (Scanner(points, readTags = true).parseTag(0) as? TagResult.Found)?.tag ?: return null
        if (tag.end != points.size) return null
        return LoneTag(tag.name, tag.closing, tag.selfClosing, tag.props)
    }

    internal data class LoneTag(val name: String, val closing: Boolean, val selfClosing: Boolean, val props: Map<String, MdxPropValue>)

    /** Unicode's White_Space: what Swift's `properties.isWhitespace` and `.whitespacesAndNewlines` both mean here. */
    internal fun isWhitespace(c: Int) = c in 0x09..0x0D || c == 0x20 || c == 0x85 || c == 0xA0 || c == 0x1680 || c in 0x2000..0x200A ||
        c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000

    /** `trimmingCharacters(in: .whitespacesAndNewlines)`. */
    internal fun trim(text: String): String {
        var start = 0
        var end = text.length
        while (start < end && isWhitespace(text[start].code)) start++
        while (end > start && isWhitespace(text[end - 1].code)) end--
        return text.substring(start, end)
    }

    private fun isNameStart(c: Int) = c == '_'.code || c == '$'.code || Character.isAlphabetic(c)

    /** Swift's `numericType != nil`: digits, and any other character with a numeric value. */
    internal fun isNumeric(c: Int): Boolean = Character.getNumericValue(c) != -1 ||
        Character.getType(c).toByte().let { it == Character.DECIMAL_DIGIT_NUMBER || it == Character.LETTER_NUMBER || it == Character.OTHER_NUMBER }

    private fun isNamePart(c: Int) = isNameStart(c) || c == '-'.code || isNumeric(c)

    private fun string(points: IntArray, from: Int, until: Int): String {
        val builder = StringBuilder()
        for (i in from until until) builder.appendCodePoint(points[i])
        return builder.toString()
    }

    // The scanner ------------------------------------------------------------------------------------------------------------

    internal class Tag(
        val closing: Boolean, val selfClosing: Boolean, val name: String, val props: Map<String, MdxPropValue>,
        val start: Int, /** after the `>` */ val end: Int,
    )

    internal sealed interface TagResult {
        data object NotATag : TagResult
        data class Error(val message: String) : TagResult
        class Found(val tag: Tag) : TagResult
    }

    /** What the footnote pass found: their order, their text, and what to cut in the Markdown around them. */
    internal class FootnoteInfo {
        val order = ArrayList<String>()
        val bodies = LinkedHashMap<String, String>()
        var edits: List<Span> = emptyList()
        /** Where the citations in the note's own text are and where each label's first definition is, for `FootnotePlace`. */
        val places = FootnoteSpans()
    }

    internal class FootnoteSpans {
        val citations = ArrayList<Pair<String, Span>>()
        /** In runs: those with only blank lines between them. */
        val definitions = ArrayList<MutableList<Pair<String, Span>>>()
    }

    internal class Cut(val blocks: List<NoteBlock>, val ranges: List<Span>, val pieces: List<List<Span>>)

    private class OpenTag(val name: String, val block: Boolean)

    internal class Scanner(private val s: IntArray, val readTags: Boolean) {
        var failure: String? = null
            private set
        val elements = ArrayList<MdxElement>()
        private val stack = ArrayList<OpenTag>()
        private val flowTags = ArrayList<Tag>()
        /** Where code is, so that footnote marks in it are not marks. */
        private val code = ArrayList<Span>()

        private fun fail(message: String) {
            if (failure == null) failure = message
        }

        private fun at(i: Int) = s[i]
        private fun isChar(i: Int, c: Char) = i < s.size && s[i] == c.code

        private fun lineEnd(from: Int): Int {
            var j = from
            while (j < s.size && s[j] != '\n'.code) j++
            return j
        }

        // Line by line: what is code, then what is in the line

        fun run() {
            var pos = 0
            var previousBlank = true
            var inList = false
            var fence: Pair<Int, Int>? = null  // mark, length
            var inIndented = false
            while (pos < s.size && failure == null) {
                val end = lineEnd(pos)
                var p = pos
                var columns = 0
                var quoted = false
                while (p < end) {
                    when (s[p]) {
                        ' '.code -> columns += 1
                        '\t'.code -> columns += 4 - columns % 4
                        '>'.code -> { quoted = true; columns = 0 }
                        else -> break
                    }
                    p++
                }
                val content = p
                val blank = content >= end

                val open = fence
                if (open != null) {
                    code.add(Span(pos, end))
                    if (closes(open, content, end)) fence = null
                    pos = end + 1
                    previousBlank = false
                    continue
                }
                if (blank) {
                    endParagraph()
                    previousBlank = true
                    pos = end + 1
                    continue
                }
                val opened = opensFence(content, end)
                if (opened != null) {
                    endParagraph()
                    fence = opened
                    code.add(Span(pos, end))
                    pos = end + 1
                    previousBlank = false
                    continue
                }
                if (columns >= 4 && !quoted && (previousBlank || inIndented) && !inList) {
                    inIndented = true
                    code.add(Span(pos, end))
                    pos = end + 1
                    previousBlank = false
                    continue
                }
                inIndented = false
                if (columns < 4) {
                    if (startsListItem(content, end)) inList = true else if (columns == 0 && previousBlank) inList = false
                }
                if (readTags && columns == 0 && !quoted && previousBlank && startsEsm(content, end)) {
                    fail("import and export are not supported.")
                    return
                }
                pos = scanLine(afterListMarkers(content, end))
                previousBlank = false
            }
            if (readTags && failure == null) stack.lastOrNull()?.let { fail("Expected a closing tag for `<${it.name}>`.") }
        }

        private fun opensFence(from: Int, until: Int): Pair<Int, Int>? {
            if (from >= until) return null
            val mark = s[from]
            if (mark != '`'.code && mark != '~'.code) return null
            var n = 0
            while (from + n < until && s[from + n] == mark) n++
            if (n < 3) return null
            // A backtick fence's info string may not contain a backtick (else it is an inline code span).
            if (mark == '`'.code && (from + n until until).any { s[it] == '`'.code }) return null
            return mark to n
        }

        private fun closes(fence: Pair<Int, Int>, from: Int, until: Int): Boolean {
            var n = 0
            while (from + n < until && s[from + n] == fence.first) n++
            if (n < fence.second) return false
            return (from + n until until).all { s[it] == ' '.code || s[it] == '\t'.code }
        }

        /** Where a line's own content begins, past any list markers (`- `, `1. `): a tag alone after a marker is still a block. */
        private fun afterListMarkers(from: Int, end: Int): Int {
            var at = from
            while (startsListItem(at, end)) {
                var j = at
                if (s[j] == '-'.code || s[j] == '*'.code || s[j] == '+'.code) j++ else {
                    while (j < end && isNumeric(s[j])) j++
                    j++
                }
                while (j < end && (s[j] == ' '.code || s[j] == '\t'.code)) j++
                if (j >= end) return from  // an empty item: nothing after the marker
                at = j
            }
            return at
        }

        private fun endParagraph() {
            val open = stack.lastOrNull()
            if (open != null && !open.block) fail("Expected a closing tag for `<${open.name}>` before the end of paragraph.")
        }

        private fun startsListItem(i: Int, end: Int): Boolean {
            if (i >= end) return false
            var j = i
            if (s[j] == '-'.code || s[j] == '*'.code || s[j] == '+'.code) j++ else {
                while (j < end && isNumeric(s[j])) j++
                if (!(j > i && j < end && (s[j] == '.'.code || s[j] == ')'.code))) return false
                j++
            }
            return j >= end || s[j] == ' '.code || s[j] == '\t'.code
        }

        /** `import ` or `export ` at the start of a line of its own: ESM, which an MDX note may not have. */
        private fun startsEsm(i: Int, end: Int): Boolean {
            for (word in listOf("import", "export")) {
                val stop = i + word.length
                if (stop < end && word.indices.all { s[i + it] == word[it].code } && (s[stop] == ' '.code || s[stop] == '\t'.code)) return true
            }
            return false
        }

        /** Reads the rest of a line from `start`, which may carry on over several lines; returns where the next line to read begins. */
        private fun scanLine(start: Int): Int {
            var i = start
            // Tags and nothing else on the line: blocks.
            if (readTags && isChar(i, '<')) {
                val group = tagsAloneOnLine(i)
                if (group != null) {
                    for (tag in group.first) register(tag, block = true)
                    return minOf(group.second + 1, s.size + 1)
                }
            }
            while (i < s.size && failure == null) {
                when {
                    s[i] == '\n'.code -> return i + 1
                    s[i] == '\\'.code -> i += if (i + 1 < s.size && s[i + 1] != '\n'.code) 2 else 1
                    s[i] == '`'.code -> i = skipCodeSpan(i)
                    s[i] == '{'.code && readTags -> fail("{expressions} are not supported.")
                    s[i] == '<'.code && readTags -> when (val result = parseTag(i)) {
                        TagResult.NotATag -> i++
                        is TagResult.Error -> fail(result.message)
                        is TagResult.Found -> {
                            register(result.tag, block = false)
                            i = result.tag.end
                        }
                    }
                    else -> i++
                }
            }
            return s.size + 1
        }

        /** Backticks that open a code span are skipped to its closing run (exactly as many, within the paragraph); without one they are plain characters. */
        private fun skipCodeSpan(i: Int): Int {
            var open = i
            while (open < s.size && s[open] == '`'.code) open++
            val length = open - i
            var k = open
            while (k < s.size) {
                if (s[k] == '\n'.code) {
                    // A blank line ends the paragraph.
                    var j = k + 1
                    while (j < s.size && (s[j] == ' '.code || s[j] == '\t'.code)) j++
                    if (j >= s.size || s[j] == '\n'.code) break
                }
                if (s[k] == '`'.code) {
                    var run = k
                    while (run < s.size && s[run] == '`'.code) run++
                    if (run - k == length) {
                        code.add(Span(i, run))
                        return run
                    }
                    k = run
                } else {
                    k++
                }
            }
            return open
        }

        /** The tags of a line made of tags and white space only, from `i`, and where the last one ends. */
        private fun tagsAloneOnLine(i: Int): Pair<List<Tag>, Int>? {
            val tags = ArrayList<Tag>()
            var p = i
            while (true) {
                if (!isChar(p, '<')) return null
                val tag = (parseTag(p) as? TagResult.Found)?.tag ?: return null
                tags.add(tag)
                p = tag.end
                while (p < s.size && (s[p] == ' '.code || s[p] == '\t'.code)) p++
                if (p >= s.size || s[p] == '\n'.code) return tags to p
            }
        }

        // Tags

        fun parseTag(i: Int): TagResult {
            var p = i + 1
            if (p >= s.size) return TagResult.Error("Unexpected end of file before name.")
            if (isWhitespace(s[p])) return TagResult.NotATag  // `a < b` is text
            var closing = false
            when (s[p]) {
                '/'.code -> {
                    closing = true
                    p++
                    while (p < s.size && isWhitespace(s[p])) p++
                    if (isChar(p, '>')) return TagResult.Error("Fragments (<>…</>) are not supported.")
                }
                '>'.code -> return TagResult.Error("Fragments (<>…</>) are not supported.")
                '!'.code, '?'.code -> return TagResult.Error("Unexpected character `${String(Character.toChars(s[p]))}` before name, expected a character that can start a name.")
            }
            if (p >= s.size || !isNameStart(s[p])) return TagResult.Error("Unexpected character before name, expected a character that can start a name.")
            val nameStart = p
            while (p < s.size && (isNamePart(s[p]) || s[p] == '.'.code || s[p] == ':'.code)) p++
            val name = string(s, nameStart, p)
            if (name !in components) return TagResult.Error("Unknown component <$name>. Available: ${components.joinToString(", ") { "<$it>" }}.")
            if (closing) {
                while (p < s.size && isWhitespace(s[p])) p++
                if (!isChar(p, '>')) return TagResult.Error("Unexpected character in closing tag, expected `>`.")
                return TagResult.Found(Tag(closing = true, selfClosing = false, name = name, props = emptyMap(), start = i, end = p + 1))
            }

            val props = LinkedHashMap<String, MdxPropValue>()
            while (true) {
                while (p < s.size && isWhitespace(s[p])) p++
                if (p >= s.size) return TagResult.Error("Unexpected end of file before attribute name.")
                if (s[p] == '/'.code) {
                    p++
                    while (p < s.size && isWhitespace(s[p])) p++
                    if (!isChar(p, '>')) return TagResult.Error("Unexpected character after self-closing slash, expected `>`.")
                    return TagResult.Found(Tag(closing = false, selfClosing = true, name = name, props = props, start = i, end = p + 1))
                }
                if (s[p] == '>'.code) return TagResult.Found(Tag(closing = false, selfClosing = false, name = name, props = props, start = i, end = p + 1))
                if (s[p] == '{'.code) return TagResult.Error("{expressions} are not supported.")
                if (!isNameStart(s[p])) return TagResult.Error("Unexpected character before attribute name.")
                val attributeStart = p
                while (p < s.size && (isNamePart(s[p]) || s[p] == ':'.code)) p++
                val attribute = string(s, attributeStart, p)
                var q = p
                while (q < s.size && isWhitespace(s[q])) q++
                if (!isChar(q, '=')) {
                    props[attribute] = MdxPropValue.Flag
                    continue
                }
                q++
                while (q < s.size && isWhitespace(s[q])) q++
                if (q >= s.size) return TagResult.Error("Unexpected end of file before attribute value.")
                if (s[q] == '{'.code) return TagResult.Error("{expressions} are not supported.")
                if (s[q] != '"'.code && s[q] != '\''.code) return TagResult.Error("Unexpected character before attribute value, expected a quote.")
                val quote = s[q]
                q++
                val valueStart = q
                while (q < s.size && s[q] != quote) q++
                if (q >= s.size) return TagResult.Error("Unexpected end of file in attribute value.")
                props[attribute] = MdxPropValue.Text(decodeEntities(string(s, valueStart, q)))
                p = q + 1
            }
        }

        private fun register(tag: Tag, block: Boolean) {
            if (tag.closing) {
                val open = stack.lastOrNull() ?: return fail("Unexpected closing slash `/` in tag, expected an open tag first.")
                if (open.name != tag.name) return fail("Unexpected closing tag `</${tag.name}>`, expected corresponding closing tag for `<${open.name}>`.")
                // A tag on lines of its own and one inside a line of text cannot be a pair.
                if (open.block != block) return fail("Expected the closing tag `</${tag.name}>` in the same kind of place as the opening one.")
                stack.removeAt(stack.size - 1)
            } else {
                // A block cannot start inside a line of text that is still open.
                val open = stack.lastOrNull()
                if (block && open != null && !open.block) return fail("Expected a closing tag for `<${open.name}>` before the end of paragraph.")
                elements.add(MdxElement(tag.name, tag.props, block, stack.size))
                if (!tag.selfClosing) stack.add(OpenTag(tag.name, block))
            }
            if (block) flowTags.add(tag)
        }

        // Blocks

        private class OpenElement(val name: String, val props: Map<String, MdxPropValue>, val start: Int) {
            val children = ArrayList<NoteBlock>()
        }

        /**
         * The note cut at its block tags: what is between them is Markdown, and what a pair of tags holds is the element's children.
         * With the top-level blocks' places and, for each run of Markdown, the pieces of the text its own text was copied from.
         */
        fun blocks(footnotes: FootnoteInfo): Cut {
            val root = ArrayList<NoteBlock>()
            val ranges = ArrayList<Span>()
            val pieces = ArrayList<List<Span>>()
            val open = ArrayList<OpenElement>()
            var at = 0

            fun add(block: NoteBlock, range: Span, copied: List<Span> = emptyList()) {
                if (open.isEmpty()) {
                    root.add(block)
                    ranges.add(range)
                    pieces.add(copied)
                } else {
                    open.last().children.add(block)
                }
            }
            fun flush(end: Int) {
                if (at >= end) return
                val (text, copied) = applying(footnotes.edits, Span(at, end))
                if (trim(text).isNotEmpty()) add(NoteBlock.Markdown(text), written(Span(at, end)), copied)
            }
            for (tag in flowTags) {
                flush(tag.start)
                at = tag.end
                if (tag.closing) {
                    val top = open.removeLastOrNull()
                    if (top != null) add(NoteBlock.Element(top.name, top.props, top.children.toList()), Span(top.start, tag.end))
                } else if (tag.selfClosing) {
                    add(NoteBlock.Element(tag.name, tag.props, emptyList()), Span(tag.start, tag.end))
                } else {
                    open.add(OpenElement(tag.name, tag.props, tag.start))
                }
            }
            flush(s.size)
            return Cut(root, ranges, pieces)
        }

        /** `range` less its blank lines at either end: from the start of its first line with something on it to the last thing on its last. */
        private fun written(range: Span): Span {
            var first = range.start
            while (first < range.end && isWhitespace(s[first])) first++
            var last = range.end
            while (last > first && isWhitespace(s[last - 1])) last--
            var start = first
            while (start > range.start && s[start - 1] != '\n'.code) start--
            return Span(start, maxOf(start, last))
        }

        // Footnotes

        /** `s[range]` with the cuts that lie inside it made, and the pieces of `s` that were copied into it, in order. */
        fun applying(cuts: List<Span>, range: Span): Pair<String, List<Span>> {
            val out = StringBuilder()
            val pieces = ArrayList<Span>()
            var at = range.start
            for (cut in cuts.sortedBy { it.start }) {
                if (cut.start < at || cut.end > range.end) continue
                for (i in at until cut.start) out.appendCodePoint(s[i])
                if (at < cut.start) pieces.add(Span(at, cut.start))
                at = cut.end
            }
            for (i in at until range.end) out.appendCodePoint(s[i])
            if (at < range.end) pieces.add(Span(at, range.end))
            return out.toString() to pieces
        }

        private sealed interface Sink {
            data object InText : Sink
            data class Definition(val label: String) : Sink
            data object Ignored : Sink
        }

        private class Mark(val label: String, val span: Span, val sink: Sink)

        /**
         * The footnotes, read here outside code. Footnotes are numbered by where they are first cited (those in a footnote's own text
         * after those in the note), a citation without a definition is text, and a definition nobody cites is not listed. Where a
         * definition is, the Markdown loses it: its text is in `bodies`.
         */
        fun footnotes(): FootnoteInfo {
            val defined = HashSet<String>()
            val seen = ArrayList<Mark>()
            val lines = HashMap<String, MutableList<Span>>()
            val removals = ArrayList<Span>()
            var sink: Sink = Sink.InText
            var span: Span? = null
            /** The label of the definition `span` is, when it is the first one of that label. */
            var spanLabel: String? = null
            val definitionSpans = ArrayList<Pair<String, Span>>()
            var previousBlank = true
            var lineStart = 0

            fun closeSpan() {
                val open = span
                if (open != null) {
                    removals.add(Span(open.start, minOf(open.end, s.size)))
                    // The definition as written: to the end of its last line, the line break after it left out.
                    spanLabel?.let { definitionSpans.add(it to Span(open.start, maxOf(open.start, minOf(open.end - 1, s.size)))) }
                }
                span = null
                spanLabel = null
            }
            fun note(found: List<Pair<String, Span>>, into: Sink) {
                for ((label, range) in found) seen.add(Mark(label, range, into))
            }

            while (lineStart <= s.size) {
                val end = lineEnd(lineStart)
                val next = end + 1
                run line@{
                    if (isCode(lineStart)) {
                        closeSpan()
                        sink = Sink.InText
                        previousBlank = true
                        return@line
                    }
                    var p = lineStart
                    var indent = 0
                    while (p < end && (s[p] == ' '.code || s[p] == '\t'.code)) {
                        indent += if (s[p] == '\t'.code) 4 else 1
                        p++
                    }
                    val blank = p >= end
                    val definition = if (indent < 4) definitionStart(p, end) else null
                    if (definition != null) {
                        closeSpan()
                        // The first definition of a label is the one that counts.
                        sink = if (defined.add(definition.first)) Sink.Definition(definition.first) else Sink.Ignored
                        (sink as? Sink.Definition)?.let { lines.getOrPut(it.label) { ArrayList() }.add(Span(definition.second, end)) }
                        span = Span(lineStart, end + 1)
                        (sink as? Sink.Definition)?.let { spanLabel = it.label }
                        note(marks(definition.second, end), sink)
                        previousBlank = false
                        return@line
                    }
                    if (sink != Sink.InText) {
                        // A definition goes on over indented lines, lazy ones that follow a non-blank line, and blanks between them.
                        if (blank) {
                            previousBlank = true
                            return@line
                        }
                        if (indent >= 4 || !previousBlank) {
                            (sink as? Sink.Definition)?.let { lines.getOrPut(it.label) { ArrayList() }.add(Span(p, end)) }
                            span = span?.copy(end = end + 1)
                            note(marks(p, end), sink)
                            previousBlank = false
                            return@line
                        }
                        closeSpan()
                        sink = Sink.InText
                    }
                    previousBlank = blank
                    if (!blank) note(marks(p, end), Sink.InText)
                }
                lineStart = next
            }
            closeSpan()

            val info = FootnoteInfo()
            fun cite(labels: List<String>) {
                for (label in labels) if (label in defined && label !in info.order) info.order.add(label)
            }
            cite(seen.filter { it.sink == Sink.InText }.map { it.label })
            var index = 0
            while (index < info.order.size) {
                val current = info.order[index]
                cite(seen.filter { (it.sink as? Sink.Definition)?.label == current }.map { it.label })
                index++
            }

            for (label in info.order) {
                info.bodies[label] = (lines[label] ?: emptyList()).joinToString("\n") { trim(string(s, it.start, it.end)) }
            }
            info.edits = removals
            // Those in a footnote's own text too: the list draws them as numbers, and so does the Live tab.
            for (mark in seen) if (mark.label in info.order) info.places.citations.add(mark.label to mark.span)
            for (definition in definitionSpans) {
                if (definition.first !in info.order) continue
                val previous = info.places.definitions.lastOrNull()?.lastOrNull()
                if (previous != null && previous.second.end <= definition.second.start &&
                    (previous.second.end until definition.second.start).all { isWhitespace(s[it]) }
                ) {
                    info.places.definitions.last().add(definition)
                } else {
                    info.places.definitions.add(mutableListOf(definition))
                }
            }
            return info
        }

        private fun isCode(i: Int) = code.any { i in it }

        private fun definitionStart(i: Int, end: Int): Pair<String, Int>? {
            if (!(i + 3 < end && s[i] == '['.code && s[i + 1] == '^'.code)) return null
            var j = i + 2
            while (j < end && s[j] != ']'.code && !isWhitespace(s[j])) j++
            val label = string(s, i + 2, j)
            if (label.isEmpty() || !(j < end && s[j] == ']'.code && j + 1 < end && s[j + 1] == ':'.code)) return null
            return label to j + 2
        }

        /** `[^label]` marks in `[from, until)`, not in code and not backslash-escaped. */
        private fun marks(from: Int, until: Int): List<Pair<String, Span>> {
            val found = ArrayList<Pair<String, Span>>()
            var i = from
            while (i + 2 < until) {
                if (s[i] == '['.code && s[i + 1] == '^'.code && !isCode(i) && (i == 0 || s[i - 1] != '\\'.code)) {
                    var j = i + 2
                    while (j < until && s[j] != ']'.code && !isWhitespace(s[j])) j++
                    if (j > i + 2 && j < until && s[j] == ']'.code) {
                        found.add(string(s, i + 2, j) to Span(i, j + 1))
                        i = j + 1
                        continue
                    }
                }
                i++
            }
            return found
        }
    }

    /** `12` as `¹²`: a citation, which the Markdown would otherwise read as a link if it were `[12]`. */
    fun superscript(number: Int): String {
        val digits = "⁰¹²³⁴⁵⁶⁷⁸⁹"
        return number.toString().filter { it in '0'..'9' }.map { digits[it - '0'] }.joinToString("")
    }

    private val namedEntities = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ")

    /** The character references a prop's value may use. */
    internal fun decodeEntities(text: String): String {
        if ('&' !in text) return text
        val out = StringBuilder()
        var rest = text
        while (true) {
            val amp = rest.indexOf('&')
            if (amp < 0) break
            out.append(rest, 0, amp)
            val after = rest.substring(amp + 1)
            val semicolon = after.indexOf(';')
            // Swift counts the distance in characters; every name that can match is ASCII, so counting UTF-16 units is the same here.
            if (semicolon >= 0 && after.codePointCount(0, semicolon) <= 10) {
                val name = after.substring(0, semicolon)
                val replacement = namedEntities[name]
                    ?: if (name.startsWith("#x") || name.startsWith("#X")) codePointText(name.drop(2).toUIntOrNull(16))
                    else if (name.startsWith("#")) codePointText(name.drop(1).toUIntOrNull())
                    else null
                if (replacement != null) {
                    out.append(replacement)
                    rest = after.substring(semicolon + 1)
                    continue
                }
            }
            out.append('&')
            rest = after
        }
        return out.append(rest).toString()
    }

    /** A Unicode scalar as text, or null when the number is not one (a surrogate, or past U+10FFFF), as Swift's `Unicode.Scalar(_:)`. */
    private fun codePointText(value: UInt?): String? {
        if (value == null || value > 0x10FFFFu || value in 0xD800u..0xDFFFu) return null
        return String(Character.toChars(value.toInt()))
    }
}
