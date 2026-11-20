package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.editing.MarkdownBlocks.Node
import com.rushinglabs.composition.core.editing.MarkdownBlocks.NodeType
import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.text.BreakIterator

/**
 * Return continues a list or a quote, and Backspace just after an item's marker takes the marker away: the desktop's Markdown keys,
 * CodeMirror's `insertNewlineContinueMarkup` and `deleteMarkupBackward` (@codemirror/lang-markdown 6.5.2), ported from
 * ListContinuation.swift to answer a `LineEdit`. Both read the note's block structure as lezer reads it (`MarkdownBlocks`), since which
 * marks they write depends on where lezer's list items and quotes begin and end. Null where the desktop's command declines, and the key
 * then does what it always does. Offsets are UTF-16 units; the note's lines end in `\n`.
 *
 * What it does, as the desktop does it:
 * - Return at the end of an item (or in its text) breaks the line and writes the next item's marker: the same bullet, the next number with
 *   the same delimiter (the numbers after it go up by one), `- [ ] ` for a task, `> ` for a quote, with the marks of what holds it (a quote
 *   around a list, a list around a list) kept and the indentation too. Spaces before the caret are taken off the line it leaves.
 * - Return on an empty item takes its marker off: the list ends, or a nested item moves out to the list that holds it. On the second item
 *   of a list whose two items are tight, the desktop first puts a blank line before the item instead (the list becomes loose); Return
 *   again then ends it.
 * - Return on an empty quote line after another empty one ends the quote; on the first it writes another `>`.
 * - Backspace just after an item's marker turns the marker into spaces (a further Backspace takes the spaces): an empty item goes, and an
 *   item with text becomes a further line of the item above. Just after a quote's `> ` it takes the `> ` off.
 */
object ListContinuation {
    /** Return with the caret at `caret`. */
    fun newline(text: String, caret: Int): LineEdit? {
        if (caret < 0 || caret > text.length) return null
        return Commands(Doc(text), MarkdownBlocks.parse(text)).newline(caret)
    }

    /** Backspace with the caret at `caret` and nothing selected. */
    fun deleteBackward(text: String, caret: Int): LineEdit? {
        if (caret <= 0 || caret > text.length) return null
        // The command only ever acts just after a space or the last character of a marker; most Backspaces are elsewhere, and are not
        // worth a parse.
        val before = text[caret - 1]
        if (!isJSSpace(before) && before !in ">-+*.)]") return null
        return Commands(Doc(text), MarkdownBlocks.parse(text)).deleteBackward(caret)
    }
}

/** JavaScript's `\s`. */
internal fun isJSSpace(c: Char): Boolean = JavaScriptText.isWhitespace(c.code)

/** The note's text with its lines (CodeMirror's `doc.lineAt`). */
internal class Doc(val text: String) {
    class Line(val number: Int, val from: Int, val to: Int, val text: String)

    /** Where each line starts. */
    private val starts: IntArray = run {
        val found = arrayListOf(0)
        for ((index, c) in text.withIndex()) if (c == '\n') found.add(index + 1)
        found.toIntArray()
    }

    fun lineAt(position: Int): Line {
        var low = 0
        var high = starts.size - 1
        while (low < high) {
            val mid = (low + high + 1) / 2
            if (starts[mid] <= position) low = mid else high = mid - 1
        }
        val from = starts[low]
        val to = if (low + 1 < starts.size) starts[low + 1] - 1 else text.length
        return Line(low + 1, from, to, text.substring(from, to))
    }

    /** Clamped to the text. */
    fun slice(from: Int, to: Int): String {
        val a = from.coerceIn(0, text.length)
        val b = to.coerceIn(a, text.length)
        return text.substring(a, b)
    }
}

/** `string.slice(from, to)` as JavaScript does it: clamped, and empty when `to` is not past `from`. */
private fun jsSlice(text: String, from: Int, to: Int = text.length): String {
    val a = from.coerceIn(0, text.length)
    val b = to.coerceIn(0, text.length)
    return if (a < b) text.substring(a, b) else ""
}

/**
 * CodeMirror's `countColumn(string, tabSize, to)`: columns up to `to`, a tab reaching the next multiple of `tabSize`, a grapheme cluster
 * (an emoji) counting one.
 */
private fun countColumn(text: String, tabSize: Int, to: Int): Int {
    var clusters: BreakIterator? = null
    var n = 0
    var i = 0
    while (i < to) {
        if (i < text.length && text[i] == '\t') {
            n += tabSize - n % tabSize
            i++
        } else {
            n++
            i = if (i >= text.length) {
                i + 1
            } else {
                val breaks = clusters ?: BreakIterator.getCharacterInstance().also { it.setText(text); clusters = it }
                // Where the cluster starting at `i` ends; mid-cluster (which a column count never starts at) is one unit on.
                if (breaks.isBoundary(i)) breaks.following(i) else i + 1
            }
        }
    }
    return n
}

private class Commands(val doc: Doc, val tree: Node) {
    /** A level of list or quote markup on a line (the desktop's `Context`): the columns are on the line where its node starts. */
    class Context(
        /** The quote, or the list for a list item. */
        val node: Node,
        val from: Int,
        val to: Int,
        val spaceBefore: String,
        val spaceAfter: String,
        val type: String,
        val item: Node?,
    ) {
        fun blank(maxWidth: Int?, trailing: Boolean = true): String {
            val result = StringBuilder(spaceBefore)
            if (node.type == NodeType.BLOCKQUOTE) result.append('>')
            if (maxWidth != null) {
                while (result.length < maxWidth) result.append(' ')
                return result.toString()
            }
            repeat(maxOf(to - from - result.length - spaceAfter.length, 0)) { result.append(' ') }
            if (trailing) result.append(spaceAfter)
            return result.toString()
        }

        fun marker(doc: Doc, add: Int): String {
            var number = ""
            if (node.type == NodeType.ORDERED_LIST && item != null) itemNumber(item, doc)?.let { number = (it.number + add).toString() }
            return spaceBefore + number + type + spaceAfter
        }
    }

    class ItemNumber(val space: Int, val end: Int, val number: Long)

    class Change(val from: Int, val to: Int, val insert: String)

    companion object {
        /** The item's number, and the lengths of the space before it and of the space and the number: `/^(\s*)(\d+)(?=[.)])/` over its first ten characters. */
        fun itemNumber(item: Node, doc: Doc): ItemNumber? {
            val text = doc.slice(item.from, item.from + 10)
            var i = 0
            while (i < text.length && isJSSpace(text[i])) i++
            val digits = i
            while (i < text.length && text[i] in '0'..'9') i++
            if (i == digits || i >= text.length || (text[i] != '.' && text[i] != ')')) return null
            return ItemNumber(digits, i, text.substring(digits, i).toLong())
        }

        class QuoteMatch(val length: Int, val after: String)
        class ListMatch(val length: Int, val before: String, val type: String, val after: String)

        /** `/^ *>( ?)/` */
        fun quoteMatch(s: String): QuoteMatch? {
            var i = 0
            while (i < s.length && s[i] == ' ') i++
            if (i >= s.length || s[i] != '>') return null
            i++
            if (i < s.length && s[i] == ' ') return QuoteMatch(i + 1, " ")
            return QuoteMatch(i, "")
        }

        /** `/^( *)\d+([.)])( *)/` */
        fun orderedMatch(s: String): ListMatch? {
            var i = 0
            while (i < s.length && s[i] == ' ') i++
            val before = s.substring(0, i)
            val digits = i
            while (i < s.length && s[i] in '0'..'9') i++
            if (i == digits || i >= s.length || (s[i] != '.' && s[i] != ')')) return null
            val delimiter = s[i].toString()
            i++
            val spaces = i
            while (i < s.length && s[i] == ' ') i++
            return ListMatch(i, before, delimiter, s.substring(spaces, i))
        }

        /** `/^( *)([-+*])( {1,4}\[[ xX]\])?( +)/`, with the task's box written unticked into the type. */
        fun bulletMatch(s: String): ListMatch? {
            var i = 0
            while (i < s.length && s[i] == ' ') i++
            val before = s.substring(0, i)
            if (i >= s.length || s[i] !in "-+*") return null
            var type = s[i].toString()
            i++
            // The optional box: one to four spaces and `[ ]`, `[x]` or `[X]`, taken only if spaces follow it (the regex backtracks otherwise).
            var j = i
            while (j < s.length && j - i < 4 && s[j] == ' ') j++
            if (j > i && j + 3 <= s.length && s[j] == '[' && s[j + 1] in " xX" && s[j + 2] == ']' && j + 3 < s.length && s[j + 3] == ' ') {
                type += s.substring(i, j) + "[ ]"
                i = j + 3
            }
            val spaces = i
            while (i < s.length && s[i] == ' ') i++
            if (i == spaces) return null
            return ListMatch(i, before, type, s.substring(spaces, i))
        }
    }

    /** The levels of markup around `node`, outermost first; none inside a fenced code block (the desktop's `getContext`). */
    fun context(node: Node): ArrayList<Context> {
        val nodes = ArrayList<Node>()
        var current: Node? = node
        while (current != null) {
            if (current.type == NodeType.FENCED_CODE) return ArrayList()
            if (current.type == NodeType.LIST_ITEM || current.type == NodeType.BLOCKQUOTE) nodes.add(current)
            current = current.parent
        }
        val context = ArrayList<Context>()
        for (level in nodes.asReversed()) {
            val line = doc.lineAt(level.from)
            val startPos = level.from - line.from
            val rest = jsSlice(line.text, startPos)
            val parent = level.parent
            if (level.type == NodeType.BLOCKQUOTE) {
                val match = quoteMatch(rest) ?: continue
                context.add(Context(level, startPos, startPos + match.length, "", match.after, ">", null))
            } else if (level.type == NodeType.LIST_ITEM && parent != null && parent.type == NodeType.ORDERED_LIST) {
                val match = orderedMatch(rest) ?: continue
                var after = match.after
                var length = match.length
                if (after.length >= 4) {
                    after = after.dropLast(4)
                    length -= 4
                }
                context.add(Context(parent, startPos, startPos + length, match.before, after, match.type, level))
            } else if (level.type == NodeType.LIST_ITEM && parent != null && parent.type == NodeType.BULLET_LIST) {
                val match = bulletMatch(rest) ?: continue
                var after = match.after
                var length = match.length
                if (after.length > 4) {
                    after = after.dropLast(4)
                    length -= 4
                }
                context.add(Context(parent, startPos, startPos + length, match.before, after, match.type, level))
            }
        }
        return context
    }

    // Return

    fun newline(pos: Int): LineEdit? {
        // The command is declined where the Markdown language is not active on either side: inside an HTML block or tag, which the
        // desktop hands to its HTML parser.
        if (tree.htmlCovers(pos, side = 0)) return null
        val line = doc.lineAt(pos)
        val context = context(tree.resolveInner(pos))
        while (context.isNotEmpty() && context.last().from > pos - line.from) context.removeAt(context.size - 1)
        val inner = context.lastOrNull() ?: return null
        if (inner.to - inner.spaceAfter.length > pos - line.from) return null
        val emptyLine = pos >= inner.to - inner.spaceAfter.length && jsSlice(line.text, inner.to).all(::isJSSpace)

        // An empty item.
        val item = inner.item
        if (item != null && emptyLine) {
            if (item.from < line.from && !onlySpaceOrQuote(jsSlice(line.text, 0, inner.to))) return null
            val first = inner.node.children.firstOrNull()
            val second = inner.node.secondItem
            val blankBefore = line.from > 0 && onlySpaceOrQuote(doc.lineAt(line.from - 1).text)
            if ((first != null && first.to >= pos) || (second != null && second.to < pos) || blankBefore) {
                // Not the second item, or a blank line before it: take a level of markup off.
                val next = if (context.size > 1) context[context.size - 2] else null
                val delTo: Int
                var insert = ""
                if (next?.item != null) {
                    delTo = line.from + next.from
                    insert = next.marker(doc, add = 1)
                } else {
                    delTo = line.from + (next?.to ?: 0)
                }
                val changes = arrayListOf(Change(delTo, pos, insert))
                if (inner.node.type == NodeType.ORDERED_LIST) renumber(item, changes, offset = -2)
                val nextItem = next?.item
                if (next != null && next.node.type == NodeType.ORDERED_LIST && nextItem != null) renumber(nextItem, changes)
                return edit(changes, delTo + insert.length)
            } else {
                // Move the second item down, making a tight two-item list loose.
                val insert = blankLine(context, line)
                return edit(listOf(Change(line.from, line.from, insert + "\n")), pos + insert.length + 1)
            }
        }

        // Two aligned empty quote lines in a row end the quote.
        if (inner.node.type == NodeType.BLOCKQUOTE && emptyLine && line.from > 0) {
            val previous = doc.lineAt(line.from - 1)
            var end = previous.text.length
            while (end > 0 && isJSSpace(previous.text[end - 1])) end--
            if (end > 0 && previous.text[end - 1] == '>' && end - 1 == inner.from) {
                val first = Change(previous.from + end - 1, previous.to, "")
                val second = Change(line.from + inner.from, line.to, "")
                return edit(listOf(first, second), second.from - (first.to - first.from))
            }
        }

        val changes = ArrayList<Change>()
        if (inner.node.type == NodeType.ORDERED_LIST && item != null) renumber(item, changes)
        val continued = item != null && item.from < line.from
        var insert = ""
        // Unless the line is outdented from the item.
        if (!continued || markupPrefixLength(line.text) >= inner.to) {
            val e = context.size - 1
            for (i in 0..e) {
                insert += if (i == e && !continued) {
                    context[i].marker(doc, add = 1)
                } else {
                    context[i].blank(if (i < e) countColumn(line.text, 4, context[i + 1].from) - insert.length else null)
                }
            }
        }
        var from = pos
        while (from > line.from && isJSSpace(line.text[from - line.from - 1])) from--
        if (inner.node.isLooseList(doc)) insert = blankLine(context, line) + "\n" + insert
        changes.add(Change(from, pos, "\n" + insert))
        return edit(changes, from + insert.length + 1)
    }

    /** `/^[\s>]*$/` */
    private fun onlySpaceOrQuote(s: String): Boolean = s.all { isJSSpace(it) || it == '>' }

    // The length of the match of `^[\s\d.)\-+*>]*` (a comment, since the pattern holds the characters that end a KDoc).
    private fun markupPrefixLength(s: String): Int {
        var i = 0
        while (i < s.length && (isJSSpace(s[i]) || s[i] in '0'..'9' || s[i] in ".)-+*>")) i++
        return i
    }

    /** The markup of the levels around an item for a blank line (the desktop's `blankLine`). */
    private fun blankLine(context: List<Context>, line: Doc.Line): String {
        val e = context.size - 2
        if (e < 0) return ""
        var insert = ""
        for (i in 0..e) {
            insert += context[i].blank(if (i < e) countColumn(line.text, 4, context[i + 1].from) - insert.length else null, trailing = i < e)
        }
        return insert
    }

    /** The numbers of the items after `item` that follow on from it, moved on (the desktop's `renumberList`). */
    private fun renumber(item: Node, changes: MutableList<Change>, offset: Int = 0) {
        var previous = -1L
        var node: Node? = item
        while (node != null) {
            if (node.type == NodeType.LIST_ITEM) {
                val found = itemNumber(node, doc)
                if (found != null) {
                    if (previous >= 0) {
                        if (found.number != previous + 1) return
                        changes.add(Change(node.from + found.space, node.from + found.end, (previous + 2 + offset).toString()))
                    }
                    previous = found.number
                }
            }
            node = node.nextSibling
        }
    }

    // Backspace

    fun deleteBackward(pos: Int): LineEdit? {
        if (tree.htmlCovers(pos, side = -1)) return null
        val line = doc.lineAt(pos)
        val context = context(contextNodeForDelete(pos))
        val inner = context.lastOrNull() ?: return null
        val column = pos - line.from
        val spaceEnd = inner.to - inner.spaceAfter.length + (if (inner.spaceAfter.isEmpty()) 0 else 1)
        // Extra space after the markup goes first.
        if (column > spaceEnd && jsSlice(line.text, spaceEnd, column).all(::isJSSpace)) {
            return edit(listOf(Change(line.from + spaceEnd, pos, "")), line.from + spaceEnd)
        }
        // Only on the line that has the construct's markup, or where there is only indentation before it.
        val item = inner.item
        if (column != spaceEnd || !((item != null && line.from <= item.from) || onlySpaceOrQuote(jsSlice(line.text, 0, inner.to)))) return null
        val start = line.from + inner.from
        // A list item's marker becomes spaces.
        if (item != null && inner.node.from < item.from && !jsSlice(line.text, inner.from, inner.to).all(::isJSSpace)) {
            val insert = inner.blank(countColumn(line.text, 4, inner.to) - countColumn(line.text, 4, inner.from))
            return edit(listOf(Change(start, line.from + inner.to, insert)), start + insert.length)
        }
        // Delete one level of indentation.
        if (start < pos) return edit(listOf(Change(start, pos, "")), start)
        return null
    }

    /**
     * The node whose markup Backspace at `pos` would delete (the desktop's `contextNodeForDelete`): past the marks just before it, and into
     * the last item of a list that ends there.
     */
    private fun contextNodeForDelete(pos: Int): Node {
        var node = tree.resolveInner(pos)
        var scan = pos
        val parent = node.parent
        if (node.type.isMark && parent != null) {
            scan = node.from
            node = parent
        }
        while (true) {
            val previous = node.childBefore(scan) ?: break
            if (previous.type.isMark) {
                scan = previous.from
            } else if (previous.type == NodeType.BULLET_LIST || previous.type == NodeType.ORDERED_LIST) {
                val last = previous.children.lastOrNull() ?: break
                node = last
                scan = last.to
            } else {
                break
            }
        }
        return node
    }

    // The edit

    /** The changes (in the old text, not overlapping) as one replacement from the first to the end of the last, and the caret afterwards. */
    private fun edit(changes: List<Change>, caret: Int): LineEdit {
        val sorted = changes.sortedBy { it.from }
        val start = sorted.first().from
        val end = sorted.maxOf { it.to }
        val out = StringBuilder()
        var at = start
        for (change in sorted) {
            out.append(doc.slice(at, change.from)).append(change.insert)
            at = change.to
        }
        out.append(doc.slice(at, end))
        return LineEdit(start, end, out.toString(), caret, caret)
    }
}
