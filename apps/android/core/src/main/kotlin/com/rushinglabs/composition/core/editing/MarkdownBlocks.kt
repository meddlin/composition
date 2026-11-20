package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.markdown.JS_SPACE
import com.rushinglabs.composition.core.markdown.JS_SPACE_CHARS
import com.rushinglabs.composition.core.markdown.AsciiCaseless

/**
 * A note's block structure as lezer reads it: a port of the part of @lezer/markdown 1.8.1's block parser (`BlockContext`, its block
 * parsers and the `skipContextMarkup` handlers) that decides where quotes, lists and list items begin and end, with the desktop's
 * Markdown language (CommonMark and GFM). Ported from MarkdownBlocks.swift. `ListContinuation` reads it, because the desktop's list keys
 * read lezer's tree. Leaf blocks are kept whole and opaque (a paragraph, a heading, a code block, an HTML block), except that a fenced
 * code block and an HTML block are told apart; inline syntax is not parsed, apart from finding HTML tags in a paragraph (`htmlCovers`).
 * GFM tables and link reference definitions are not recognised: they are leaf blocks either way, and only the lines they would take from
 * a paragraph after them could differ.
 *
 * The patterns are lezer's, with JavaScript's `\s`, its `$` (`\z`: a JVM's `$` also matches before a final `\r`) and its `i` flag
 * (`AsciiCaseless`: no platform flag folds only A to Z everywhere).
 */
internal object MarkdownBlocks {
    enum class NodeType {
        DOCUMENT, BLOCKQUOTE, BULLET_LIST, ORDERED_LIST, LIST_ITEM, QUOTE_MARK, LIST_MARK,
        FENCED_CODE, CODE_BLOCK, HTML_BLOCK, COMMENT_BLOCK, PROCESSING_BLOCK, LEAF;

        val isMark: Boolean get() = this == QUOTE_MARK || this == LIST_MARK
    }

    class Node(val type: NodeType, val from: Int, val to: Int) {
        var children: List<Node> = emptyList()
        var parent: Node? = null

        /**
         * The document's HTML (blocks, comment blocks and, in paragraphs and headings, tags) as `[from, to)` pairs, which the desktop
         * parses as HTML: there the Markdown language is not active. Set on the document only.
         */
        var html: List<IntArray> = emptyList()

        val nextSibling: Node?
            get() {
                val siblings = parent?.children ?: return null
                val index = siblings.indexOfFirst { it === this }
                return if (index < 0) null else siblings.getOrNull(index + 1)
            }

        /** lezer's `childBefore`: the last child that starts before `pos`. */
        fun childBefore(pos: Int): Node? = children.lastOrNull { it.from < pos }

        /** lezer's `getChild("ListItem", "ListItem")`: the first item after the first item. */
        val secondItem: Node?
            get() {
                val first = children.indexOfFirst { it.type == NodeType.LIST_ITEM }
                if (first < 0) return null
                return children.subList(first + 1, children.size).firstOrNull { it.type == NodeType.LIST_ITEM }
            }

        /** The innermost node that holds `pos`, a node ending there included and one starting there not (lezer's `resolveInner(pos, -1)`). */
        fun resolveInner(pos: Int): Node {
            var node = this
            while (true) node = node.children.lastOrNull { it.from < pos && it.to >= pos } ?: return node
        }

        /** A list with a blank line between its first two items (the desktop's `nonTightList`). */
        fun isLooseList(doc: Doc): Boolean {
            if (type != NodeType.BULLET_LIST && type != NodeType.ORDERED_LIST) return false
            val first = children.firstOrNull() ?: return false
            val second = secondItem ?: return false
            val line1 = doc.lineAt(first.to)
            val line2 = doc.lineAt(second.from)
            val empty = line1.text.all { isJSSpace(it) || it == '>' }
            return line1.number + (if (empty) 0 else 1) < line2.number
        }

        /** `side` -1 asks about the place just before `pos` (an HTML node ending at `pos` counts); 0 asks whether it is HTML on both sides. */
        fun htmlCovers(pos: Int, side: Int): Boolean =
            html.any { (from, to) -> if (side < 0) from < pos && pos <= to else from < pos && pos < to }
    }

    // Parsing

    fun parse(text: String): Node {
        val document = BlockContext(text).run()
        val html = ArrayList<IntArray>()
        fun collect(node: Node) {
            when (node.type) {
                NodeType.HTML_BLOCK, NodeType.COMMENT_BLOCK -> html.add(intArrayOf(node.from, node.to))
                NodeType.LEAF -> html.addAll(InlineHtmlTags.find(text, node.from, node.to))
                else -> {}
            }
            node.children.forEach(::collect)
        }
        collect(document)
        document.html = html
        return document
    }

    /** A mark on a line that a container's markup skipped (a `>`): it goes to the block that is innermost when the line is read. */
    class Mark(val type: NodeType, val from: Int, val to: Int)

    /** A container being parsed (lezer's `CompositeBlock`). */
    class Composite(
        val type: NodeType,
        /** A list item's indentation, a list's marker character. */
        val value: Int,
        val from: Int,
        var end: Int,
    ) {
        val children = ArrayList<Node>()
        var blankFirstLine = false

        fun toNode(end: Int = this.end): Node {
            var to = end
            children.lastOrNull()?.let { to = maxOf(to, it.to) }
            val node = Node(type, from, to)
            node.children = children.toList()
            for (child in children) child.parent = node
            return node
        }
    }

    /** lezer's `Line`. */
    class Line {
        var text = ""
        var baseIndent = 0
        var basePos = 0
        var depth = 0
        var markers = ArrayList<Mark>()
        var pos = 0
        var indent = 0
        var next = -1

        fun forward() {
            if (basePos > pos) forwardInner()
        }

        fun forwardInner() {
            val newPos = skipSpace(basePos)
            indent = countIndent(newPos, pos, indent)
            pos = newPos
            next = if (newPos == text.length) -1 else text[newPos].code
        }

        fun skipSpace(from: Int): Int = skipSpace(text, from)

        fun reset(text: String) {
            this.text = text
            baseIndent = 0
            basePos = 0
            pos = 0
            indent = 0
            forwardInner()
            depth = 1
            markers.clear()
        }

        fun moveBase(to: Int) {
            basePos = to
            baseIndent = countIndent(to, pos, indent)
        }

        fun moveBaseColumn(indent: Int) {
            baseIndent = indent
            basePos = findColumn(indent)
        }

        fun countIndent(to: Int, from: Int = 0, indent: Int = 0): Int {
            var result = indent
            for (i in from until to) result += if (i < text.length && text[i] == '\t') 4 - result % 4 else 1
            return result
        }

        fun findColumn(goal: Int): Int {
            var i = 0
            var indent = 0
            while (i < text.length && indent < goal) {
                indent += if (text[i] == '\t') 4 - indent % 4 else 1
                i++
            }
            return i
        }

        fun char(i: Int): Int = if (i >= 0 && i < text.length) text[i].code else -1
    }

    fun space(ch: Int): Boolean = ch == 32 || ch == 9 || ch == 10 || ch == 13

    fun skipSpace(text: String, from: Int): Int {
        var i = from
        while (i < text.length && space(text[i].code)) i++
        return i
    }

    // Block starts

    fun isFencedCode(line: Line): Int {
        if (line.next != 96 && line.next != 126) return -1
        var pos = line.pos + 1
        while (pos < line.text.length && line.text[pos].code == line.next) pos++
        if (pos < line.pos + 3) return -1
        if (line.next == 96) for (i in pos until line.text.length) if (line.text[i] == '`') return -1
        return pos
    }

    fun isBlockquote(line: Line): Int = if (line.next != 62) -1 else if (line.char(line.pos + 1) == 32) 2 else 1

    fun isHorizontalRule(line: Line, cx: BlockContext, breaking: Boolean): Int {
        if (line.next != 42 && line.next != 45 && line.next != 95) return -1
        var count = 1
        for (pos in line.pos + 1 until maxOf(line.pos + 1, line.text.length)) {
            val ch = line.text[pos].code
            if (ch == line.next) count++ else if (!space(ch)) return -1
        }
        // Setext headings take precedence.
        if (breaking && line.next == 45 && isSetextUnderline(line) > -1 && line.depth == cx.stack.size) return -1
        return if (count < 3) -1 else 1
    }

    fun inList(cx: BlockContext, type: NodeType): Boolean = cx.stack.any { it.type == type }

    fun isBulletList(line: Line, cx: BlockContext, breaking: Boolean): Int =
        if ((line.next == 45 || line.next == 43 || line.next == 42) &&
            (line.pos == line.text.length - 1 || space(line.char(line.pos + 1))) &&
            (!breaking || inList(cx, NodeType.BULLET_LIST) || line.skipSpace(line.pos + 2) < line.text.length)
        ) 1 else -1

    fun isOrderedList(line: Line, cx: BlockContext, breaking: Boolean): Int {
        var pos = line.pos
        var next = line.next
        while (next in 48..57) {
            pos++
            if (pos == line.text.length) return -1
            next = line.text[pos].code
        }
        if (pos == line.pos || pos > line.pos + 9 || (next != 46 && next != 41) ||
            (pos < line.text.length - 1 && !space(line.char(pos + 1))) ||
            (breaking && !inList(cx, NodeType.ORDERED_LIST) &&
                (line.skipSpace(pos + 1) == line.text.length || pos > line.pos + 1 || line.next != 49))
        ) return -1
        return pos + 1 - line.pos
    }

    fun isAtxHeading(line: Line): Int {
        if (line.next != 35) return -1
        var pos = line.pos + 1
        while (pos < line.text.length && line.text[pos] == '#') pos++
        if (pos < line.text.length && !space(line.text[pos].code)) return -1
        val size = pos - line.pos
        return if (size > 6) -1 else size
    }

    fun isSetextUnderline(line: Line): Int {
        if ((line.next != 45 && line.next != 61) || line.indent >= line.baseIndent + 4) return -1
        var pos = line.pos + 1
        while (pos < line.text.length && line.text[pos].code == line.next) pos++
        val end = pos
        while (pos < line.text.length && space(line.text[pos].code)) pos++
        return if (pos == line.text.length) end else -1
    }

    /** A test of a line's text: a pattern as written, or one matched as JavaScript's `i` matches (`AsciiCaseless`). */
    private class LineTest private constructor(private val test: (String) -> Boolean) {
        fun matches(text: String): Boolean = test(text)

        companion object {
            fun exact(pattern: String) = Regex(pattern).let { regex -> LineTest { regex.containsMatchIn(it) } }
            fun caseless(lowerCasePattern: String) = AsciiCaseless(lowerCasePattern).let { regex -> LineTest { regex.containsMatchIn(it) } }
        }
    }

    /**
     * lezer's `HTMLBlockStyle`: how each kind of HTML block starts, what ends it, the node it makes, and whether the line that ends it
     * belongs to it (not so for the kinds a blank line ends).
     */
    private class HtmlStyle(val start: LineTest, val end: LineTest, val type: NodeType, val takesEndLine: Boolean)

    private val emptyLine = LineTest.exact("""^[ \t]*\z""")

    private val htmlBlockStyles: List<HtmlStyle> = listOf(
        HtmlStyle(
            LineTest.caseless("""^<(?:script|pre|style|textarea)(?:$JS_SPACE|>|\z)"""),
            LineTest.caseless("""</(?:script|pre|style|textarea)>"""),
            NodeType.HTML_BLOCK, true,
        ),
        HtmlStyle(LineTest.exact("""^$JS_SPACE*<!--"""), LineTest.exact("""-->"""), NodeType.COMMENT_BLOCK, true),
        HtmlStyle(LineTest.exact("""^$JS_SPACE*<\?"""), LineTest.exact("""\?>"""), NodeType.PROCESSING_BLOCK, true),
        HtmlStyle(LineTest.exact("""^$JS_SPACE*<![A-Z]"""), LineTest.exact(""">"""), NodeType.HTML_BLOCK, true),
        HtmlStyle(LineTest.caseless("""^$JS_SPACE*<!\[cdata\["""), LineTest.exact("""\]\]>"""), NodeType.HTML_BLOCK, true),
        HtmlStyle(
            LineTest.caseless(
                """^$JS_SPACE*</?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:$JS_SPACE|/?>|\z)""",
            ),
            emptyLine, NodeType.HTML_BLOCK, false,
        ),
        HtmlStyle(
            LineTest.caseless(
                """^$JS_SPACE*(?:</[a-z][a-z0-9_-]*$JS_SPACE*>|<[a-z][a-z0-9_-]*($JS_SPACE+[a-z:_][a-z0-9_.-]*(?:$JS_SPACE*=$JS_SPACE*(?:[^${JS_SPACE_CHARS}"'=<>`]+|'[^']*'|"[^"]*"))?)*$JS_SPACE*>)$JS_SPACE*\z""",
            ),
            emptyLine, NodeType.HTML_BLOCK, false,
        ),
    )

    fun isHtmlBlock(line: Line, breaking: Boolean): Int {
        if (line.next != 60) return -1
        val rest = line.text.substring(line.pos)
        val count = htmlBlockStyles.size - (if (breaking) 1 else 0)
        for (i in 0 until count) if (htmlBlockStyles[i].start.matches(rest)) return i
        return -1
    }

    fun getListIndent(line: Line, pos: Int): Int {
        val indentAfter = line.countIndent(pos, line.pos, line.indent)
        val skipped = line.skipSpace(pos)
        val indented = line.countIndent(skipped, pos, indentAfter)
        return if (indented >= indentAfter + 5 || skipped == line.text.length) indentAfter + 1 else indented
    }

    // The parse

    /** lezer's `BlockContext`, for one whole text. */
    class BlockContext(private val units: String) {
        private val to = units.length
        private val line = Line()
        private var atEnd = false
        private var lineStart = 0
        private var absoluteLineEnd = 0
        val stack = arrayListOf(Composite(NodeType.DOCUMENT, 0, 0, 0))
        private val block: Composite get() = stack[stack.size - 1]

        init {
            readLine()
        }

        fun run(): Node {
            while (true) advance()?.let { return it }
        }

        private fun prevLineEnd(): Int = if (atEnd) lineStart else lineStart - 1

        private fun readLine() {
            var end = lineStart
            if (lineStart < to) while (end < to && units[end] != '\n') end++
            absoluteLineEnd = end
            line.reset(if (lineStart < to) units.substring(lineStart, end) else "")
            while (line.depth < stack.size) {
                val cx = stack[line.depth]
                val marks = line.markers.size
                if (!skipMarkup(cx)) {
                    if (line.markers.size > marks) cx.end = line.markers[line.markers.size - 1].to
                    line.forward()
                    break
                }
                line.forward()
                line.depth++
            }
        }

        private fun nextLine(): Boolean {
            lineStart += line.text.length
            if (absoluteLineEnd >= to) {
                atEnd = true
                readLine()
                return false
            }
            lineStart++
            readLine()
            return true
        }

        /** lezer's `DefaultSkipMarkup`: whether the line carries on the container `bl`, moving past its markup. */
        private fun skipMarkup(bl: Composite): Boolean = when (bl.type) {
            NodeType.BLOCKQUOTE -> {
                if (line.next != 62) {
                    false
                } else {
                    line.markers.add(Mark(NodeType.QUOTE_MARK, lineStart + line.pos, lineStart + line.pos + 1))
                    line.moveBase(line.pos + (if (space(line.char(line.pos + 1))) 2 else 1))
                    bl.end = lineStart + line.text.length
                    true
                }
            }
            NodeType.LIST_ITEM -> {
                if (if (line.next < 0) bl.blankFirstLine && bl.children.size == 1 else line.indent < line.baseIndent + bl.value) {
                    false
                } else {
                    line.moveBaseColumn(line.baseIndent + bl.value)
                    true
                }
            }
            NodeType.BULLET_LIST, NodeType.ORDERED_LIST -> {
                if (line.pos == line.text.length || (bl !== block && line.indent >= stack[line.depth + 1].value + line.baseIndent)) {
                    true
                } else if (line.indent >= line.baseIndent + 4) {
                    false
                } else {
                    val size = if (bl.type == NodeType.ORDERED_LIST) isOrderedList(line, this, false) else isBulletList(line, this, false)
                    size > 0 && (bl.type != NodeType.BULLET_LIST || isHorizontalRule(line, this, false) < 0) &&
                        line.char(line.pos + size - 1) == bl.value
                }
            }
            else -> true
        }

        private fun startContext(type: NodeType, start: Int, value: Int = 0) {
            stack.add(Composite(type, value, lineStart + start, lineStart + line.text.length))
        }

        private fun addNode(type: NodeType, from: Int, to: Int = prevLineEnd()) {
            block.children.add(Node(type, from, to))
        }

        private fun finishContext() {
            val cx = stack.removeAt(stack.size - 1)
            block.children.add(cx.toNode())
        }

        private fun finish(): Node {
            while (stack.size > 1) finishContext()
            return block.toNode(end = lineStart)
        }

        /** One step: a block, or the blank lines before one. The document when the text is done. */
        private fun advance(): Node? {
            while (true) {
                var markI = 0
                while (true) {
                    val next = if (line.depth < stack.size) stack[stack.size - 1] else null
                    while (markI < line.markers.size && (next == null || line.markers[markI].from < next.end)) {
                        val mark = line.markers[markI]
                        markI++
                        addNode(mark.type, mark.from, mark.to)
                    }
                    if (next == null) break
                    finishContext()
                }
                if (line.pos < line.text.length) break
                // An empty line.
                if (!nextLine()) return finish()
            }

            val parsers: List<() -> Boolean?> = listOf(::indentedCode, ::fencedCode, ::blockquote, ::horizontalRule, ::bulletList, ::orderedList, ::atxHeading, ::htmlBlock)
            start@ while (true) {
                for (parser in parsers) {
                    val result = parser()
                    if (result != null) {
                        if (result) return null
                        continue
                    }
                    // A container was opened: look for more on the rest of the line.
                    line.forward()
                    continue@start
                }
                break
            }
            if (line.pos == line.text.length) return if (nextLine()) null else finish()

            // A paragraph (or a setext heading), with the lines that carry it on.
            val leafStart = lineStart + line.pos
            var leafEnd = lineStart + line.text.length
            lines@ while (nextLine()) {
                if (line.pos == line.text.length) break
                if (line.indent < line.baseIndent + 4) {
                    if (isAtxHeading(line) >= 0 || isFencedCode(line) >= 0 || isBlockquote(line) >= 0 || isBulletList(line, this, true) >= 0 ||
                        isOrderedList(line, this, true) >= 0 || isHorizontalRule(line, this, true) >= 0 || isHtmlBlock(line, true) >= 0
                    ) break@lines
                }
                if (line.depth >= stack.size && isSetextUnderline(line) >= 0) {
                    nextLine()
                    addNode(NodeType.LEAF, leafStart, prevLineEnd())
                    return null
                }
                leafEnd = lineStart + line.text.length
            }
            addNode(NodeType.LEAF, leafStart, leafEnd)
            return null
        }

        // Each answers null when it opened a container, true when it took a leaf block, false when the line is not its kind.

        private fun indentedCode(): Boolean? {
            val base = line.baseIndent + 4
            if (line.indent < base) return false
            val from = lineStart + line.findColumn(base)
            var to = lineStart + line.text.length
            var pending = ArrayList<Mark>()
            while (nextLine() && line.depth >= stack.size) {
                if (line.pos == line.text.length) {
                    pending.addAll(line.markers)
                } else if (line.indent < base) {
                    break
                } else {
                    pending = ArrayList()
                    to = lineStart + line.text.length
                }
            }
            if (pending.isNotEmpty()) line.markers = ArrayList(pending + line.markers)
            addNode(NodeType.CODE_BLOCK, from, to)
            return true
        }

        private fun fencedCode(): Boolean? {
            val fenceEnd = isFencedCode(line)
            if (fenceEnd < 0) return false
            val from = lineStart + line.pos
            val ch = line.next
            val length = fenceEnd - line.pos
            while (nextLine() && line.depth >= stack.size) {
                var i = line.pos
                if (line.indent - line.baseIndent < 4) while (i < line.text.length && line.text[i].code == ch) i++
                if (i - line.pos >= length && line.skipSpace(i) == line.text.length) {
                    nextLine()
                    break
                }
            }
            addNode(NodeType.FENCED_CODE, from)
            return true
        }

        private fun blockquote(): Boolean? {
            val size = isBlockquote(line)
            if (size < 0) return false
            startContext(NodeType.BLOCKQUOTE, line.pos)
            addNode(NodeType.QUOTE_MARK, lineStart + line.pos, lineStart + line.pos + 1)
            line.moveBase(line.pos + size)
            return null
        }

        private fun horizontalRule(): Boolean? {
            if (isHorizontalRule(line, this, false) < 0) return false
            val from = lineStart + line.pos
            nextLine()
            addNode(NodeType.LEAF, from)
            return true
        }

        private fun bulletList(): Boolean? {
            val size = isBulletList(line, this, false)
            if (size < 0) return false
            if (block.type != NodeType.BULLET_LIST) startContext(NodeType.BULLET_LIST, line.basePos, line.next)
            val newBase = getListIndent(line, line.pos + 1)
            startContext(NodeType.LIST_ITEM, line.basePos, newBase - line.baseIndent)
            addNode(NodeType.LIST_MARK, lineStart + line.pos, lineStart + line.pos + size)
            line.moveBaseColumn(newBase)
            block.blankFirstLine = newBase >= line.text.length
            return null
        }

        private fun orderedList(): Boolean? {
            val size = isOrderedList(line, this, false)
            if (size < 0) return false
            if (block.type != NodeType.ORDERED_LIST) startContext(NodeType.ORDERED_LIST, line.basePos, line.text[line.pos + size - 1].code)
            val newBase = getListIndent(line, line.pos + size)
            startContext(NodeType.LIST_ITEM, line.basePos, newBase - line.baseIndent)
            addNode(NodeType.LIST_MARK, lineStart + line.pos, lineStart + line.pos + size)
            line.moveBaseColumn(newBase)
            block.blankFirstLine = newBase == line.text.length
            return null
        }

        private fun atxHeading(): Boolean? {
            if (isAtxHeading(line) < 0) return false
            val from = lineStart + line.pos
            val to = lineStart + line.text.length
            nextLine()
            addNode(NodeType.LEAF, from, to)
            return true
        }

        private fun htmlBlock(): Boolean? {
            val type = isHtmlBlock(line, false)
            if (type < 0) return false
            val from = lineStart + line.pos
            val style = htmlBlockStyles[type]
            var trailing = style.takesEndLine
            while (!style.end.matches(line.text) && nextLine()) {
                if (line.depth < stack.size) {
                    trailing = false
                    break
                }
            }
            if (trailing) nextLine()
            addNode(style.type, from)
            return true
        }
    }
}

/**
 * The HTML tags in a paragraph, as lezer's inline `HTMLTag` parser finds them: past backslash escapes and code spans, and not an
 * autolink, a comment or a processing instruction (which the desktop does not hand to its HTML parser).
 */
internal object InlineHtmlTags {
    private val autolink = AsciiCaseless(
        """^(?:[a-z][-a-z0-9_+.]+:[^${JS_SPACE_CHARS}>]+|[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)>""",
    )
    private val comment = Regex("""^!--(?:-?>|[\s\S]*?-->)""")
    private val processing = Regex("""^\?[\s\S]*?\?>""")
    private val tag = Regex(
        """^(?:![A-Z][\s\S]*?>|!\[CDATA\[[\s\S]*?\]\]>|/[a-zA-Z][A-Za-z0-9_-]*$JS_SPACE*>|[a-zA-Z][A-Za-z0-9_-]*($JS_SPACE+[a-zA-Z:_][A-Za-z0-9_.:-]*(?:$JS_SPACE*=$JS_SPACE*(?:[^${JS_SPACE_CHARS}"'=<>`]+|'[^']*'|"[^"]*"))?)*$JS_SPACE*/?>)""",
    )

    fun find(text: String, from: Int, to: Int): List<IntArray> {
        if (text.indexOf('<', from).let { it < 0 || it >= to }) return emptyList()
        val found = ArrayList<IntArray>()
        var i = from
        while (i < to) {
            val ch = text[i]
            if (ch == '\\') { // an escape
                i += 2
                continue
            }
            if (ch == '`') { // a code span: a run of backticks, to the next run as long
                var run = i
                while (run < to && text[run] == '`') run++
                val size = run - i
                var j = run
                var close = -1
                while (j < to) {
                    if (text[j] == '`') {
                        var k = j
                        while (k < to && text[k] == '`') k++
                        if (k - j == size) {
                            close = k
                            break
                        }
                        j = k
                    } else {
                        j++
                    }
                }
                i = if (close >= 0) close else run
                continue
            }
            if (ch == '<' && i < to - 1) {
                val after = text.substring(i + 1, to)
                val skipped = autolink.find(after) ?: comment.find(after) ?: processing.find(after)
                if (skipped != null) {
                    i += 1 + skipped.value.length
                    continue
                }
                val html = tag.find(after)
                if (html != null) {
                    found.add(intArrayOf(i, i + 1 + html.value.length))
                    i += 1 + html.value.length
                    continue
                }
            }
            i++
        }
        return found
    }
}
