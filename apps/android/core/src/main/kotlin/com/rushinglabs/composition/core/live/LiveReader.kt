package com.rushinglabs.composition.core.live

import com.rushinglabs.composition.core.live.LiveDecorations.ListLine.Container
import com.rushinglabs.composition.core.markdown.TextRange
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.node.BlockQuote
import org.commonmark.node.Code
import org.commonmark.node.Document
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text
import org.commonmark.node.ThematicBreak

// Reads a note with commonmark-java, ported from LiveReader.swift (which reads it with swift-markdown), and finds what the Live view changes the
// look of: ATX and setext headings, rules, bold, italic, strikethrough and code with their marks, pictures written as `![alt](src "title")`, links,
// code blocks (fenced and indented), and the lines of lists and quotes. The desktop gets these from lezer's syntax tree, so the marks are worked
// out as lezer works them out (a heading's closing `#`s, a rule's whole line, an image's raw address), from the text and not from what the
// CommonMark parser makes of it, because the two disagree on what is in a mark and on what an address is.
//
// Where a node is: commonmark-java gives each node its source spans, one for each line, with `inputIndex` an offset in the text it read in UTF-16
// units, which is what the iPad's `SourceMap` makes of swift-markdown's lines and UTF-8 columns. A node's range is from its first span's start to
// its last span's end. Where cmark (under swift-markdown) starts a block after its indent and commonmark-java at the start of its content (a list
// item, an indented code block), the start is moved to where cmark puts it.

/** A half-open run of the text, `lower` to `upper`: Swift's `Range<Int>`. */
private data class Run(val lower: Int, val upper: Int) {
    val count get() = upper - lower
    val isEmpty get() = upper == lower
}

internal class LiveReader(private val chars: String, private val lines: LineIndex) {
    val headings = ArrayList<HeadingNode>()
    val rules = ArrayList<RuleNode>()
    val styles = ArrayList<StyleNode>()
    val pictures = ArrayList<PictureNode>()
    val codeBlocks = ArrayList<FenceNode>()
    val links = ArrayList<LinkNode>()

    /** How many links and images the walk is inside: a bare address in a link's text or an image's alt is that construct's, not a link of its own. */
    private var linkDepth = 0

    /** The lines of lists and quotes, by where each starts, as the walk finds their containers (outermost first, since a container is visited before what it holds). */
    private val lists = HashMap<Int, ListFacts>()

    /** What a line of a list or a quote is made of (the desktop's `LineInfo`, liveLists.ts). */
    private class ListFacts(val start: Int, val end: Int, var marksEnd: Int) {
        val containers = ArrayList<Container>()

        /** Where the marks at the line's start (`> `, `- `, `1. `) end; the line's start when it has none: `marksEnd`. */
        var marker: LiveDecorations.ListLine.Marker? = null
        var task: LiveDecorations.ListLine.Task? = null
    }

    // Positions

    /** The node's place in the text: from its first source span's start to its last one's end. */
    private fun range(node: Node): Run? {
        val spans = node.sourceSpans
        if (spans.isEmpty()) return null
        val start = spans.first().inputIndex
        val last = spans.last()
        val end = last.inputIndex + last.length
        return if (start <= end) Run(start, end) else null
    }

    /** The end of the line holding `position`: where its text ends, before a `\n` or `\r\n`. */
    private fun lineEnd(position: Int): Int {
        var i = position
        while (i < chars.length && chars[i] != '\n' && chars[i] != '\r') i++
        return i
    }

    private fun isSpace(unit: Char) = unit == ' ' || unit == '\t'

    private fun isLineBreak(unit: Char) = unit == '\n' || unit == '\r'

    private fun string(from: Int, to: Int) = chars.substring(from, to)

    // The walk

    fun visit(node: Node) {
        when (node) {
            is Heading -> {
                (atx(node) ?: setext(node))?.let(headings::add)
                bareAddresses(node)
                descend(node)
            }
            is ThematicBreak -> visitThematicBreak(node)
            is StrongEmphasis -> {
                // `***both***`: cmark gave the strong the emphasis's whole range, `*` marks included; commonmark-java gives each its own, so this is a guard only.
                val parent = node.parent
                val inset = if (parent is Emphasis && range(parent) == range(node)) 1 else 0
                styled(node, LiveStyle.STRONG, delimiter = 2, characters = "*_", inset = inset)
                descend(node)
            }
            is Emphasis -> {
                styled(node, LiveStyle.EMPHASIS, delimiter = 1, characters = "*_")
                descend(node)
            }
            is Strikethrough -> {
                // lezer reads only `~~`; the GFM strikethrough also takes a single `~`.
                styled(node, LiveStyle.STRIKE, delimiter = 2, characters = "~")
                descend(node)
            }
            is Code -> visitInlineCode(node)
            is Image -> visitImage(node)
            is Link -> visitLink(node)
            is Paragraph, is TableCell -> {
                bareAddresses(node)
                descend(node)
            }
            is FencedCodeBlock, is IndentedCodeBlock -> visitCodeBlock(node)
            is BlockQuote -> visitBlockQuote(node)
            is ListItem -> visitListItem(node)
            else -> descend(node)
        }
    }

    private fun descend(node: Node) {
        var child = node.firstChild
        while (child != null) {
            visit(child)
            child = child.next
        }
    }

    // Headings and rules

    /**
     * A setext heading (the desktop's `liveSetext`): a paragraph underlined with `===` (level 1) or `---` (level 2). Each of its lines is drawn as a
     * heading; the underline is its mark, from its first `=` or `-` to its last (lezer's `HeaderMark`), shown dimmed while the selection is in the
     * heading, and otherwise its whole line hidden and drawn with no height.
     */
    private fun setext(heading: Heading): HeadingNode? {
        val range = range(heading) ?: return null
        if (heading.level > 2 || range.count <= 0) return null
        val firstLine = lines.line(range.lower)
        val character = if (heading.level == 1) '=' else '-'

        /** The underline's mark on line `index`, if the line is one: `=` or `-` alone, after space or a quote's `>`, with nothing but space after. */
        fun underline(index: Int): Pair<TextRange, TextRange>? {
            val start = lines.starts[index]
            val end = lineEnd(start)
            var markEnd = end
            while (markEnd > start && isSpace(chars[markEnd - 1])) markEnd--
            var markStart = markEnd
            while (markStart > start && chars[markStart - 1] == character) markStart--
            if (markStart >= markEnd || !(markStart == start || isSpace(chars[markStart - 1]) || chars[markStart - 1] == '>')) return null
            return TextRange(start, end - start) to TextRange(markStart, markEnd - markStart)
        }
        // The underline is the first such line after the heading's first (commonmark-java's range ends on it; cmark's could run on past it).
        val lastReached = lines.line(maxOf(range.lower, range.upper - 1))
        val lastLine = (firstLine + 1 until minOf(lines.starts.size, maxOf(lastReached, firstLine + 1) + 1)).firstOrNull { underline(it) != null }
            ?: return null
        val (underlineLine, mark) = underline(lastLine) ?: return null
        val underlineStart = underlineLine.location
        val underlineEnd = underlineLine.end

        var start = range.lower
        while (start < underlineStart && isSpace(chars[start])) start++
        val textLines = (firstLine until lastLine).map { index ->
            val lineStart = lines.starts[index]
            TextRange(lineStart, lineEnd(lineStart) - lineStart)
        }
        return HeadingNode(
            lines.starts[firstLine], heading.level, TextRange(start, underlineEnd - start), listOf(mark to underlineLine), setextLines = textLines,
        )
    }

    /** An ATX heading as lezer's `parseATXHeading` reads it: the opening `#`s and, when they are preceded by a space and are not the whole line, the closing ones. */
    private fun atx(heading: Heading): HeadingNode? {
        val range = range(heading) ?: return null
        var start = range.lower
        while (start < range.upper && chars[start] == ' ') start++
        var size = 0
        while (start + size < chars.length && chars[start + size] == '#') size++
        if (size !in 1..6) return null
        val end = lineEnd(start)
        if (!(start + size == end || isSpace(chars[start + size]))) return null

        val gap = if (start + size < chars.length && chars[start + size] == ' ') 1 else 0
        val marks = arrayListOf(TextRange(start, size) to TextRange(start, size + gap))

        var endOfSpace = end
        while (endOfSpace > start && isSpace(chars[endOfSpace - 1])) endOfSpace--
        var after = endOfSpace
        while (after > start && chars[after - 1] == '#') after--
        if (after != endOfSpace && after != start && isSpace(chars[after - 1])) {
            val closing = TextRange(after, endOfSpace - after)
            marks.add(closing to closing)
        }
        return HeadingNode(lines.startOfLine(start), size, TextRange(start, end - start), marks)
    }

    private fun visitThematicBreak(rule: ThematicBreak) {
        val range = range(rule) ?: return
        var start = range.lower
        while (start < range.upper && isSpace(chars[start])) start++
        if (start >= chars.length) return
        // The whole line: lezer's rule runs to the end of its line, trailing spaces included.
        rules.add(RuleNode(lines.startOfLine(start), TextRange(start, lineEnd(start) - start)))
    }

    // Styled text

    private fun visitInlineCode(code: Code) {
        val range = range(code) ?: return
        if (range.count < 2) return
        var run = 0
        while (range.lower + run < range.upper && chars[range.lower + run] == '`') run++
        if (run <= 0 || range.count < 2 * run) return
        styles.add(StyleNode(LiveStyle.CODE, TextRange(range.lower, range.count), listOf(TextRange(range.lower, run), TextRange(range.upper - run, run))))
    }

    private fun styled(node: Node, style: LiveStyle, delimiter: Int, characters: String, inset: Int = 0) {
        val whole = range(node) ?: return
        if (whole.count < 2 * (delimiter + inset)) return
        val lower = whole.lower + inset
        val upper = whole.upper - inset
        val first = chars[lower]
        val last = chars[upper - 1]
        if (first !in characters || last !in characters) return
        if (!(0 until delimiter).all { chars[lower + it] == first && chars[upper - 1 - it] == last }) return
        styles.add(StyleNode(style, TextRange(lower, upper - lower), listOf(TextRange(lower, delimiter), TextRange(upper - delimiter, delimiter))))
    }

    // Pictures

    private fun visitImage(image: Image) {
        val range = range(image)
        if (range != null) {
            val found = markdownImage(range.lower, range.upper)
            if (found != null) {
                pictures.add(found)
                return // a drawn picture is not read further: what is in its alt text is not drawn
            }
        }
        linkDepth++
        descend(image)
        linkDepth--
    }

    /**
     * `![alt](src "title")` as lezer's inline link parser reads it, from the raw text: the alt text up to the `]` that closes it, the address (with
     * its `<` `>` taken off) and the title (with its quotes off). Null for a reference image (`![alt][ref]`), which has no address of its own, and
     * for an empty address.
     */
    private fun markdownImage(start: Int, limit: Int): PictureNode? {
        if (!(start + 1 < limit && chars[start] == '!' && chars[start + 1] == '[')) return null
        val i = closingBracket(start + 1, limit) ?: return null
        if (!(i + 1 < limit && chars[i + 1] == '(')) return null
        val target = inlineTarget(i + 1, limit) ?: return null
        if (target.address.isEmpty()) return null
        return PictureNode(TextRange(start, target.end - start), target.address, string(start + 2, i), target.title)
    }

    /** The `]` that closes the `[` at `open`, counting nested brackets and skipping escaped ones; null when there is none before `limit`. */
    private fun closingBracket(open: Int, limit: Int): Int? {
        var depth = 1
        var i = open + 1
        while (i < limit) {
            if (chars[i] == '\\') {
                i += 2
                continue
            }
            if (chars[i] == '[') {
                depth++
            } else if (chars[i] == ']') {
                depth--
                if (depth == 0) return i
            }
            i++
        }
        return null
    }

    private class Target(val address: String, val title: String, val end: Int)

    /**
     * `(src "title")` from the `(` at `paren`: the address as written (with its `<` `>` taken off, and empty for `()`), the title (quotes off), and
     * where the `)` ends. Null when it is not closed as lezer closes it.
     */
    private fun inlineTarget(paren: Int, limit: Int): Target? {
        fun isGap(unit: Char) = unit == ' ' || unit == '\t' || unit == '\n' || unit == '\r'
        fun skipSpace(from: Int): Int {
            var p = from
            while (p < limit && isGap(chars[p])) p++
            return p
        }
        var p = skipSpace(paren + 1)
        // The address.
        val addressStart = p
        if (p < limit && chars[p] == '<') {
            p++
            while (p < limit && chars[p] != '>') {
                if (chars[p] == '<' || chars[p] == '\n') return null
                p++
            }
            if (p >= limit) return null
            p++
        } else {
            var nesting = 0
            var escaped = false
            while (p < limit) {
                val unit = chars[p]
                if (isGap(unit)) break
                if (escaped) {
                    escaped = false
                } else if (unit == '(') {
                    nesting++
                } else if (unit == ')') {
                    if (nesting == 0) break
                    nesting--
                } else if (unit == '\\') {
                    escaped = true
                }
                p++
            }
        }
        var address = string(addressStart, p)
        if (address.startsWith("<") && address.endsWith(">") && address.length >= 2) address = address.substring(1, address.length - 1)

        // An optional title, set off from the address by space; then the `)`.
        var title = ""
        val afterAddress = skipSpace(p)
        p = afterAddress
        val closer = if (p < limit) when (chars[p]) {
            '"' -> '"'
            '\'' -> '\''
            '(' -> ')'
            else -> null
        } else null
        if (afterAddress > addressStart && closer != null) {
            val titleStart = p
            p++
            var escaped = false
            var closed = false
            while (p < limit) {
                val unit = chars[p]
                if (escaped) {
                    escaped = false
                } else if (unit == '\\') {
                    escaped = true
                } else if (unit == closer) {
                    closed = true
                    break
                }
                p++
            }
            if (!closed) return null
            p++
            title = string(titleStart, p)
            title = if (title.length >= 2) title.substring(1, title.length - 1) else ""
            p = skipSpace(p)
        }
        if (!(p < limit && chars[p] == ')')) return null
        return Target(address, title, p + 1)
    }

    // Links

    private fun visitLink(link: Link) {
        val range = range(link)
        if (range != null) linkNode(link, range)?.let(links::add)
        // Its text is still read, so a bold word in a link's text is bold.
        linkDepth++
        descend(link)
        linkDepth--
    }

    /**
     * A link as the desktop's `drawLink` draws it, its marks found in the raw text as lezer finds them: `<url>`, `[text](url "title")`, and
     * `[text][label]`, `[text][]` or `[text]` with a definition (the parser has already found it, and its address is the one followed). Null for what
     * the desktop leaves as written: a footnote's `[^1]`, a link with no text (`[](url)`), an empty address (`[text]()`).
     */
    private fun linkNode(link: Link, range: Run): LinkNode? {
        val start = range.lower
        val limit = range.upper
        if (start >= limit) return null
        if (chars[start] == '<') {
            // `<https://…>` or `<a@b.test>`: the address between the angle brackets.
            if (!(limit - start > 2 && chars[limit - 1] == '>')) return null
            val url = TextRange(start + 1, limit - 1 - (start + 1))
            val open = TextRange(start, 1)
            val close = TextRange(limit - 1, 1)
            return LinkNode(TextRange(start, limit - start), url, href(string(start + 1, limit - 1), bare = true), listOf(open, close), listOf(open, close))
        }
        if (chars[start] != '[') return null
        val close = closingBracket(start, limit) ?: return null
        // `[^1]` is a footnote reference, which the Live view draws as its number, not a link.
        if (start + 1 < limit && chars[start + 1] == '^') return null
        // `[](url)` has no text to draw it as.
        if (close <= start + 1) return null
        val marks = arrayListOf(TextRange(start, 1), TextRange(close, 1))
        val href: String
        var end = close + 1
        val target = if (close + 1 < limit && chars[close + 1] == '(') inlineTarget(close + 1, limit) else null
        if (target != null) {
            if (target.address.isEmpty()) return null
            href = href(target.address, bare = false)
            marks += listOf(TextRange(close + 1, 1), TextRange(target.end - 1, 1))
            end = target.end
        } else {
            // A reference: `[label]` after it (no marks of its own), or nothing.
            if (close + 1 < limit && chars[close + 1] == '[') {
                val labelEnd = closingBracket(close + 1, limit)
                if (labelEnd != null) {
                    if (labelEnd > close + 2 && chars[close + 2] == '^') return null
                    end = labelEnd + 1
                }
            }
            val destination = link.destination
            if (destination.isNullOrEmpty()) return null
            href = destination
        }
        return LinkNode(
            TextRange(start, end - start), TextRange(start + 1, close - start - 1), href, marks,
            listOf(TextRange(start, 1), TextRange(close, end - close)),
        )
    }

    // Bare addresses

    /**
     * The bare addresses in the text of `container` (a paragraph, a heading or a table cell, and what it holds, outside links, images and code),
     * found as lezer's GFM `Autolink` finds them: `www.`, `http://`, `https://`, `mailto:`, `xmpp:` and email addresses. The parser here reads no
     * autolinks of this kind, so these are read from the runs of plain text it leaves: neighbouring text nodes are read as one, so that an address
     * with a `_` or a `*` in it is whole.
     */
    private fun bareAddresses(container: Node) {
        if (linkDepth != 0) return
        val runs = ArrayList<Run>()
        fun collect(node: Node) {
            var child = node.firstChild
            while (child != null) {
                when (child) {
                    is Link, is Image, is Code, is HtmlInline -> range(child)?.let { runs.add(Run(it.upper, it.upper)) }
                    is Text -> range(child)?.let { r ->
                        val last = runs.lastOrNull()
                        if (last != null && last.upper == r.lower && !last.isEmpty) runs[runs.lastIndex] = Run(last.lower, r.upper) else runs.add(r)
                    }
                    is SoftLineBreak, is HardLineBreak -> runs.add(Run(0, 0))
                    else -> collect(child)
                }
                child = child.next
            }
        }
        collect(container)
        for (run in runs) if (!run.isEmpty) scanAddresses(run)
    }

    private fun scanAddresses(run: Run) {
        var pos = run.lower
        while (pos < run.upper) {
            if (pos > 0 && isWord(chars[pos - 1])) {
                pos++
                continue
            }
            val end = addressEnd(pos, run.upper)
            if (end != null && end > pos) {
                val url = TextRange(pos, end - pos)
                links.add(LinkNode(url, url, href(string(pos, end), bare = true), emptyList(), emptyList()))
                pos = end
            } else {
                pos++
            }
        }
    }

    private fun has(prefix: String, pos: Int, limit: Int): Boolean {
        if (pos + prefix.length > limit) return false
        for (k in prefix.indices) if (chars[pos + k] != prefix[k]) return false
        return true
    }

    /** Where a bare address starting at `pos` ends, or null (lezer's `Autolink.parse`). */
    private fun addressEnd(pos: Int, limit: Int): Int? {
        if (has("www.", pos, limit)) return urlEnd(pos + 4, pos, limit)
        if (has("http://", pos, limit)) return urlEnd(pos + 7, pos, limit)
        if (has("https://", pos, limit)) return urlEnd(pos + 8, pos, limit)
        // `[\w.+-]{1,100}@`: an email address.
        var p = pos
        while (p < limit && p - pos < 100 && isEmailLocal(chars[p])) p++
        if (p > pos && p < limit && chars[p] == '@') return emailEnd(pos, limit)
        if (has("mailto:", pos, limit)) return emailEnd(pos + 7, limit)
        if (has("xmpp:", pos, limit)) {
            var end = emailEnd(pos + 5, limit) ?: return null
            // `/[a-zA-Z\d@.]+`: a resource after it.
            if (end < limit && chars[end] == '/') {
                var q = end + 1
                while (q < limit && ((isWord(chars[q]) && chars[q] != '_') || chars[q] == '@' || chars[q] == '.')) q++
                if (q > end + 1) end = q
            }
            return end
        }
        return null
    }

    /** `[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s<]*)?` from `from`, then trailing punctuation taken off (lezer's `autolinkURLEnd`). */
    private fun urlEnd(from: Int, start: Int, limit: Int): Int? {
        var p = from
        val labels = ArrayList<Run>()
        while (true) {
            val labelStart = p
            while (p < limit && isDomain(chars[p])) p++
            if (p <= labelStart) {
                if (labels.isEmpty()) return null
                p = labelStart - 1
                break
            }
            labels.add(Run(labelStart, p))
            if (p < limit && chars[p] == '.' && p + 1 < limit && isDomain(chars[p + 1])) p++ else break
        }
        if (labels.size < 2) return null
        // The last two words of the domain may not hold a `_`.
        if (labels.takeLast(2).any { r -> (r.lower until r.upper).any { chars[it] == '_' } }) return null
        if (p < limit && chars[p] == ':') {
            var q = p + 1
            while (q < limit && chars[q] in '0'..'9') q++
            if (q > p + 1) p = q
        }
        if (p < limit && chars[p] == '/') {
            p++
            while (p < limit && chars[p] !in URL_STOP) p++
        }
        var end = p
        while (end > from) {
            val last = chars[end - 1]
            if (last in TRAILING_PUNCTUATION) {
                end--
            } else if (last == ')' && count(')', start, end) > count('(', start, end)) {
                end--
            } else if (last == ';') {
                end = trailingEntity(start, end) ?: break
            } else {
                break
            }
        }
        return end
    }

    private fun count(unit: Char, from: Int, to: Int): Int = (from until to).count { chars[it] == unit }

    /** Where `&name;`, `&#12;` or `&#x1f;` at the very end of `from..<to` starts. */
    private fun trailingEntity(from: Int, to: Int): Int? {
        var p = to - 2
        while (p >= from && chars[p] != '&') {
            val c = chars[p]
            if (!(isWord(c) || c == '#')) return null
            p--
        }
        if (p < from) return null
        return if (ENTITY_BODY.matches(string(p + 1, to - 1))) p else null
    }

    /** `[\w.+-]+@[\w-]+(\.[\w.-]+)+` from `from`, less a final `.`; null when it ends in `_` or `-` (lezer's `autolinkEmailEnd`). */
    private fun emailEnd(from: Int, limit: Int): Int? {
        var p = from
        while (p < limit && isEmailLocal(chars[p])) p++
        if (!(p > from && p < limit && chars[p] == '@')) return null
        p++
        val domain = p
        while (p < limit && isDomain(chars[p])) p++
        if (p <= domain) return null
        var parts = 0
        while (p < limit && chars[p] == '.') {
            var q = p + 1
            while (q < limit && (isDomain(chars[q]) || chars[q] == '.')) q++
            if (q <= p + 1) break
            p = q
            parts++
        }
        if (parts == 0) return null
        val last = chars[p - 1]
        if (last == '_' || last == '-') return null
        return if (last == '.') p - 1 else p
    }

    // Code blocks

    /**
     * A fenced or an indented code block, as the desktop's `liveCode` reads lezer's `FencedCode` and `CodeBlock`: each of its lines, which of them
     * are fences (the opening one, and the closing one when the block is closed), whether any line is code, and, for an indented block at the top
     * level, the indent of each of its lines (four columns, which the Preview does not show).
     */
    private fun visitCodeBlock(block: Node) {
        val spans = range(block) ?: return
        val fenced = block is FencedCodeBlock
        // cmark starts a fenced block at its fence, and an indented one after the indent of its first line, as lezer's does (so a caret in that
        // indent is outside the block); commonmark-java starts both where the line's content starts, before that indent.
        val range = Run(if (fenced) skipSpaces(spans.lower, spans.upper) else afterIndent(spans.lower, spans.upper), spans.upper)
        var start = range.lower
        while (start < range.upper && chars[start] == ' ') start++
        var end = range.upper
        while (end > range.lower && isLineBreak(chars[end - 1])) end--
        val first = lines.line(range.lower)
        var last = lines.line(maxOf(end, range.lower))
        var starts = lines.starts.copyOfRange(first, last + 1).toList()

        if (!fenced) {
            // An indented block. Its range starts after the indent of its first line, as lezer's does, so a caret in that indent is outside the block.
            val from = range.lower
            val indents = ArrayList<TextRange>()
            if (block.parent is Document) { // at the top level: in a list or a quote the indent is the item's
                for (line in starts) {
                    val indent = indentWidth(line)
                    if (indent > 0 && line + indent < chars.length && !isLineBreak(chars[line + indent])) indents.add(TextRange(line, indent))
                }
            }
            codeBlocks.add(FenceNode(TextRange(from, end - from), emptyList(), starts, emptyList(), hasCode = true, indents = indents))
            return
        }

        val fenceCharacter = chars[start]
        var opening = 0
        while (start + opening < range.upper && chars[start + opening] == fenceCharacter) opening++
        val firstEnd = lineEnd(start)
        // A fence is hidden as its whole line: what is before it on the line (a list item's indent, a quote's `>`) goes with it, as on the desktop.
        val fences = arrayListOf(TextRange(starts[0], firstEnd - starts[0]))
        val fenceLines = arrayListOf(starts[0])
        val lastStart = starts[starts.size - 1]
        if (starts.size > 1) {
            var closing = 0
            var p = lastStart
            while (p < end && (chars[p] == ' ' || chars[p] == '>')) p++ // the indent, or a quote's `>` and its space
            while (p + closing < end && chars[p + closing] == fenceCharacter) closing++
            val onlyFence = (p + closing until end).all { isSpace(chars[it]) }
            if (closing >= opening && onlyFence) {
                fences.add(TextRange(lastStart, lineEnd(lastStart) - lastStart))
                fenceLines.add(lastStart)
            }
        }
        if (fenceLines.size == 1 && (end until chars.length).all { isLineBreak(chars[it]) } && end < chars.length) {
            // Not closed, and nothing after it: it runs to the end of the note, the empty line after a last line break included, as lezer's does.
            end = chars.length
            last = lines.starts.size - 1
            starts = lines.starts.copyOfRange(first, last + 1).toList()
        }
        val hasCode = starts.size > fenceLines.size
        codeBlocks.add(FenceNode(TextRange(range.lower, end - range.lower), fences, starts, fenceLines, hasCode, emptyList()))
    }

    private fun skipSpaces(from: Int, limit: Int): Int {
        var p = from
        while (p < limit && chars[p] == ' ') p++
        return p
    }

    /**
     * Where an indented code block's text starts, as cmark puts it: four columns of indent after `from` (where the line's content starts, inside
     * whatever holds the block), a tab going to the next multiple of four. A tab only partly used is where the block starts.
     */
    private fun afterIndent(from: Int, limit: Int): Int {
        var column = 0
        val lineStart = lines.startOfLine(from)
        for (i in lineStart until from) column = if (chars[i] == '\t') column + 4 - column % 4 else column + 1
        var needed = 4
        var p = from
        while (p < limit && needed > 0) {
            if (chars[p] == ' ') {
                needed--
                column++
            } else if (chars[p] == '\t') {
                val width = 4 - column % 4
                if (width > needed) break
                needed -= width
                column += width
            } else {
                break
            }
            p++
        }
        return p
    }

    /** How many units of indent start the line at `line`, up to four columns (a tab goes to the next multiple of four). */
    private fun indentWidth(line: Int): Int {
        var column = 0
        var i = line
        while (i < chars.length && column < 4) {
            if (chars[i] == ' ') column++ else if (chars[i] == '\t') column += 4 - column % 4 else break
            i++
        }
        return if (column >= 4) i - line else 0
    }

    // Lists and quotes

    // The desktop reads these from lezer's `Blockquote`, `ListItem`, `ListMark`, `QuoteMark` and `TaskMarker` nodes. The parser gives the quotes
    // and the items, and whether an item is a task; the marks are found in the text, where lezer finds them.

    /** The facts of the line starting at `start`, made when first asked for. */
    private fun facts(start: Int): ListFacts = lists.getOrPut(start) { ListFacts(start, lineEnd(start), start) }

    /**
     * The start of each line `range` covers. A container ends where its last line's text ends; a range that ends just after a line break does not
     * take in the line after it.
     */
    private fun lineStarts(lower: Int, upper: Int): List<Int> {
        val first = lines.line(lower)
        val last = lines.line(maxOf(lower, upper - 1))
        return (first..last).map { lines.starts[it] }
    }

    /**
     * Where a container's content ends: the end of its last child (lezer's node ends there; the parser's may take in blank lines after it), or its
     * first line's end when it has no children.
     */
    private fun contentEnd(node: Node, start: Int): Int {
        var end = lineEnd(start)
        var child = node.firstChild
        while (child != null) {
            range(child)?.let { end = maxOf(end, it.upper) }
            child = child.next
        }
        while (end > start && isLineBreak(chars[end - 1])) end--
        return end
    }

    /** How many spaces follow `at`, as the gap between a list mark and its text: one to four, or none at the line's end (the desktop's `gapAfter`). */
    private fun gapAfter(at: Int): Int {
        val rest = lineEnd(at)
        var count = 0
        while (at + count < rest && count < 5 && chars[at + count] == ' ') count++
        // Five or more spaces start an indented code block; the item's text is then one space in.
        return if (count > 4) 1 else count
    }

    private fun visitBlockQuote(quote: BlockQuote) {
        val range = range(quote)
        if (range != null) {
            val lower = skipIndent(range.lower, range.upper)
            val end = contentEnd(quote, lower)
            for (start in lineStarts(lower, maxOf(end, lower + 1))) {
                val line = facts(start)
                // The quote's `>` on this line, after the marks of what holds the quote (and the indentation that carries a list item on): a line taken in lazily has none.
                var p = line.marksEnd
                val holder = line.containers.lastOrNull()
                if (holder is Container.Item && !holder.starts) p = maxOf(p, minOf(start + holder.column, line.end))
                line.containers.add(Container.Quote)
                while (p < line.end && isSpace(chars[p])) p++
                if (p < line.end && chars[p] == '>') {
                    line.marksEnd = maxOf(line.marksEnd, p + 1 + if (p + 1 < chars.length && chars[p + 1] == ' ') 1 else 0)
                }
            }
        }
        descend(quote)
    }

    private fun visitListItem(item: ListItem) {
        val range = range(item)
        // cmark starts an item at its mark; commonmark-java at the indent before it.
        val mark = range?.let { listMark(skipIndent(it.lower, it.upper)) }
        if (range != null && mark != null) {
            val lower = mark.lower
            val first = lines.startOfLine(mark.lower)
            val gap = gapAfter(mark.upper)
            val column = mark.upper + gap - first
            val end = contentEnd(item, lower)
            for (start in lineStarts(lower, maxOf(end, lower + 1))) {
                val line = facts(start)
                line.containers.add(Container.Item(starts = start == first, column = column))
                if (start == first) {
                    line.marksEnd = maxOf(line.marksEnd, mark.upper + gap)
                    line.marker = LiveDecorations.ListLine.Marker(string(mark.lower, mark.upper), ordered = item.parent is OrderedList)
                    if (item.firstChild is TaskListItemMarker) line.task = task(mark.upper, line.end)
                }
            }
        }
        descend(item)
    }

    /** Past the spaces and tabs at `from`, before `limit`: where cmark starts a block whose source span starts at its indent. */
    private fun skipIndent(from: Int, limit: Int): Int {
        var p = from
        while (p < limit && isSpace(chars[p])) p++
        return p
    }

    /** The list mark at `start`: `-`, `*` or `+`, or one to nine digits and a `.` or `)`. */
    private fun listMark(start: Int): Run? {
        if (start >= chars.length) return null
        if (chars[start] == '-' || chars[start] == '*' || chars[start] == '+') return Run(start, start + 1)
        var p = start
        while (p < chars.length && p - start < 9 && chars[p] in '0'..'9') p++
        if (!(p > start && p < chars.length && (chars[p] == '.' || chars[p] == ')'))) return null
        return Run(start, p + 1)
    }

    /** A task's `[ ]`, `[x]` or `[X]` after the item's mark, and the space after it. */
    private fun task(markEnd: Int, end: Int): LiveDecorations.ListLine.Task? {
        var p = markEnd
        while (p < end && isSpace(chars[p])) p++
        if (!(p + 3 <= end && chars[p] == '[' && chars[p + 2] == ']' && (chars[p + 1] == ' ' || chars[p + 1] == 'x' || chars[p + 1] == 'X'))) return null
        val gap = if (p + 3 < chars.length && chars[p + 3] == ' ') 1 else 0
        return LiveDecorations.ListLine.Task(TextRange(p, 3 + gap), TextRange(p, 3), checked = chars[p + 1] != ' ')
    }

    /** The lines of lists and quotes the walk found, in order, with what is hidden on each away from the selection worked out. */
    fun listLines(): List<ListLineNode> = lists.values.sortedBy { it.start }.mapNotNull { line ->
        val inner = line.containers.lastOrNull() ?: return@mapNotNull null
        var end = line.marksEnd
        // A line that carries on an item (its second paragraph, or a wrapped line typed with a break) is indented to the item's text in the
        // source; that indentation goes too, and no further, so an indented code block keeps its own (the desktop's `prefixEnd`).
        if (inner is Container.Item && !inner.starts) {
            val limit = minOf(line.start + inner.column, line.end)
            while (end < limit && isSpace(chars[end])) end++
        }
        ListLineNode(TextRange(line.start, line.end - line.start), line.containers.toList(), end, line.marker, line.task)
    }

    companion object {
        private const val URL_STOP = " \t\n\r\u000C\u000B<"
        private const val TRAILING_PUNCTUATION = "?!.,:*_~"
        private val ENTITY_BODY = Regex("#[0-9]+|#x[a-f0-9]+|[A-Za-z0-9_]+")
        private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.\\-]*:")

        private fun isWord(unit: Char) = unit in '0'..'9' || unit in 'A'..'Z' || unit in 'a'..'z' || unit == '_'
        private fun isEmailLocal(unit: Char) = isWord(unit) || unit == '.' || unit == '+' || unit == '-'
        private fun isDomain(unit: Char) = isWord(unit) || unit == '-'

        /**
         * A link's address as written, made into one to follow (the desktop's `hrefOf`): `<…>` taken off, and, for a bare address or an autolink,
         * a bare `www.` given `http://` and an email `mailto:`.
         */
        fun href(url: String, bare: Boolean): String {
            val address = if (url.startsWith("<") && url.endsWith(">") && url.length >= 2) url.substring(1, url.length - 1) else url
            if (!bare || SCHEME.containsMatchIn(address)) return address
            return if (address.contains("@")) "mailto:$address" else "http://$address"
        }
    }
}
