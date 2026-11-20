package com.rushinglabs.composition.core.live

import com.rushinglabs.composition.core.NoteFrontmatter
import com.rushinglabs.composition.core.markdown.NoteScanner
import com.rushinglabs.composition.core.markdown.TextRange
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.task.list.items.TaskListItemsExtension
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

// The Live view's model, ported from LiveModel.swift. The Live view is the Markdown editor with its syntax hidden away from the caret: a note
// drawn as it will read, the marks (`#`, `**`, `~~`, backticks, a rule's dashes, a highlight's tags) showing only where you are writing. This is
// the part that needs no text view: from the note's text and a selection, which ranges are hidden and which shown, which are styled, which lines
// are headings or rules, which stretches are tinted and which pictures are drawn. The desktop's `liveDecorations` (liveMarkdown.ts) is the spec,
// and LiveConformanceTests run it, on a real CodeMirror state, over the same texts and selections. Offsets are UTF-16 units, as in a text view.
// The desktop works on text with one `\n` for each line break (CodeMirror reads `\r\n` as one); this reads the text as it is, and its offsets
// are the text's.
//
// Code blocks are drawn as the desktop's `liveCode` draws them, and checked against it the same way (`live-code-expected.json`): a fenced block's
// two fences are hidden while the selection is elsewhere and both shown while it is anywhere in the block (the iPad's decision V2), a block with
// no code keeps its fences, and a top-level indented block's indent is hidden like a fence. Colours are the Markdown editor's, so not here.

/** How the Live view draws a styled run of text. */
enum class LiveStyle(val rawValue: String) {
    STRONG("strong"), EMPHASIS("emphasis"), STRIKE("strike"), CODE("code"),
}

/**
 * Which tag writes a picture, which says how it is drawn: `![…](…)` and `<Image />` as the picture, `<Ink />` from the drawing's strokes in the
 * scheme's colours (its PNG when it carries none), and `<Drawio />` at half its pixel size unless the tag gives a width, as the Preview draws each.
 */
enum class LivePictureKind { IMAGE, INK, DRAWIO }

/** What the Live view does to a note for one selection. Ranges are in the note's text; each list is in the order the note holds them. */
data class LiveDecorations(
    /** The start of each line of the frontmatter (it is drawn set apart, and never hidden). */
    val frontmatterLines: List<Int> = emptyList(),
    /** The whole frontmatter, from its first character to the end of its last line, when the note has one. */
    val frontmatterRange: TextRange? = null,
    val headings: List<Heading> = emptyList(),
    /** The start of the line of each rule that is drawn as a line (a rule the selection is on shows its dashes and is not drawn). */
    val rules: List<Int> = emptyList(),
    val styles: List<Style> = emptyList(),
    /** Marks that are not drawn at all. */
    val hidden: List<TextRange> = emptyList(),
    /** Marks that show, dimmed, because the selection is in their construct. */
    val shown: List<TextRange> = emptyList(),
    val pictures: List<Picture> = emptyList(),
    val tints: List<Tint> = emptyList(),
    /**
     * A fenced block's fences (each its whole line), hidden while the selection is outside the block, and shown while it is in it (decision V2).
     * A block with nothing between its fences keeps them, as on the desktop: hidden, it would be nothing at all.
     */
    val fencesHidden: List<TextRange> = emptyList(),
    val fencesShown: List<TextRange> = emptyList(),
    val codeBlocks: List<CodeBlock> = emptyList(),
    /** A top-level indented block's indent on each line (four columns), hidden while the selection is outside the block, as the desktop hides it. */
    val codeIndentsHidden: List<TextRange> = emptyList(),
    val links: List<Link> = emptyList(),
    /** The lines of lists and quotes. What they hide is here and not in `hidden`, because it is drawn over. */
    val lists: List<ListLine> = emptyList(),
    /** The start of each line drawn with no height: a setext heading's underline while the selection is not in the heading (it is in `hidden` too). */
    val collapsedLines: List<Int> = emptyList(),
    /**
     * Each footnote citation drawn as its number: `[^label]` hidden, and the Preview's superscript number drawn in its place. One the selection
     * touches shows its source, dimmed, and is in `shown` instead.
     */
    val footnoteRefs: List<FootnoteRef> = emptyList(),
) {
    data class Heading(
        /** The start of the heading's line. */
        val line: Int,
        val level: Int,
        /** The whole line, from its start to the end of its text: what is drawn large. */
        val range: TextRange,
    )

    data class Style(val style: LiveStyle, val range: TextRange)

    data class Picture(
        /** The text that writes the picture: `![alt](src "title")`, `<Image … />`, `<Ink … />` or `<Drawio … />`. */
        val range: TextRange,
        /**
         * Nothing but space is on its line with it: such a picture is drawn in place of its text. One in the middle of a sentence (the desktop draws
         * it inline) is left as its text, because drawing it in the line would need something in the text that is not its characters.
         */
        val ownLine: Boolean = false,
        /** The selection is on that text. It stays showing, and the picture is drawn after it; otherwise the picture is drawn in its place. */
        val active: Boolean,
        val src: String,
        val alt: String,
        val title: String,
        val width: String,
        val kind: LivePictureKind = LivePictureKind.IMAGE,
    )

    data class Tint(
        val range: TextRange,
        /** One of `MdxProps.highlightColors`. */
        val color: String,
    )

    /**
     * A line of a list or a quote (the desktop's `listDecorations`, liveLists.ts). Every such line is indented one level for each list and quote it
     * is in, and has a bar down its left side for each quote. Away from the selection the marks at its start (`> `, `- `, `1. `, and the
     * indentation that carries an item on) are hidden, and a bullet, a number or a checkbox is drawn in their place.
     */
    data class ListLine(
        /** The line, from its start to the end of its text. */
        val range: TextRange,
        /** The lists and quotes the line is in, outermost first. */
        val containers: List<Container>,
        /** The selection reaches the line (ends included): its marks show as they are written, and nothing is drawn in their place. */
        val active: Boolean,
        /** Away from the selection, the marks and the indentation at the line's start, when there are any. */
        val hidden: TextRange? = null,
        /** Away from the selection, on the line an item starts on (when that item is the innermost thing the line is in): its marker. */
        val marker: Marker? = null,
        /** Away from the selection, a task's box, drawn as a checkbox; a tap on it ticks or unticks it (decision D4). */
        val task: Task? = null,
    ) {
        sealed interface Container {
            data object Quote : Container

            /** A list item: `starts` on the line the item starts on, and `column` is how far into that line its text starts. */
            data class Item(val starts: Boolean, val column: Int) : Container
        }

        /** What is drawn in place of an item's mark: its number as written (`3.`, `3)`), or a bullet. */
        data class Marker(val text: String, val ordered: Boolean)

        /** A task's `[ ]` or `[x]`. */
        data class Task(
            /** The box and the space after it: what is hidden. */
            val range: TextRange,
            /** The three characters of the box, `[`, the space or `x`, `]`. */
            val box: TextRange,
            val checked: Boolean,
        ) {
            /** What ticking or unticking the box writes: its middle character becomes `x`, or a space (the desktop's `toggleTask`). */
            val toggle: Edit get() = Edit(TextRange(box.location + 1, 1), if (checked) " " else "x")
        }

        data class Edit(val range: TextRange, val text: String)
    }

    /** A link: `[text](url "title")`, `[text][label]`, `<url>` or a bare address. */
    data class Link(
        /** What is drawn as the link: a link's words, or an address (an autolink's, without its `<` `>`, or a bare one). */
        val range: TextRange,
        /** The whole construct, marks and address included. */
        val node: TextRange,
        /** The address to follow, as the desktop's `hrefOf` makes it (`www.…` given `http://`, an email `mailto:`). */
        val href: String,
        /** The selection touches it: its marks show, dimmed, and it can be followed with the ↗ beside it. */
        val active: Boolean,
    )

    /** A code block, drawn as the Preview draws one: its lines in the code font on one rounded fill. */
    data class CodeBlock(
        /** The block, from the start of its first line to the end of its last. */
        val range: TextRange,
        /**
         * The start of each line drawn on the fill, in order: the fences' lines too while they show, but not while they are hidden. The first and
         * the last are the fill's rounded ends.
         */
        val lines: List<Int>,
        /** The lines among `lines` that are fences (they show only while the selection is in the block). */
        val fences: List<Int>,
        /** The selection is in the block. */
        val active: Boolean,
    )

    data class FootnoteRef(val range: TextRange, val number: Int)
}

// The constructs the reader finds, which the selection reveals.

/** Everything in the note that the selection can reveal, in one list ordered by where it starts. */
internal sealed interface Construct {
    val node: TextRange

    /** The same construct `delta` units further on in the text. */
    fun shifted(delta: Int): Construct
}

private fun TextRange.moved(delta: Int) = TextRange(location + delta, length)

internal data class HeadingNode(
    val line: Int,
    val level: Int,
    override val node: TextRange,
    /**
     * Each mark as it shows (`first`), and as it hides (`second`: the space after the opening `#`s goes with them, or the title would sit
     * indented). A setext heading's one mark is its underline, hidden as its whole line.
     */
    val marks: List<Pair<TextRange, TextRange>>,
    /** A setext heading's lines of text, each drawn as a heading (null for an ATX heading, which is one line). */
    val setextLines: List<TextRange>? = null,
) : Construct {
    override fun shifted(delta: Int) = HeadingNode(
        line + delta, level, node.moved(delta), marks.map { it.first.moved(delta) to it.second.moved(delta) }, setextLines?.map { it.moved(delta) },
    )
}

internal data class RuleNode(val line: Int, override val node: TextRange) : Construct {
    override fun shifted(delta: Int) = RuleNode(line + delta, node.moved(delta))
}

internal data class StyleNode(val style: LiveStyle, override val node: TextRange, val marks: List<TextRange>) : Construct {
    override fun shifted(delta: Int) = StyleNode(style, node.moved(delta), marks.map { it.moved(delta) })
}

internal data class PictureNode(override val node: TextRange, val src: String, val alt: String, val title: String) : Construct {
    override fun shifted(delta: Int) = copy(node = node.moved(delta))
}

/** A code block, fenced or indented. */
internal data class FenceNode(
    override val node: TextRange,
    /** The fences' whole lines (none for an indented block). */
    val fences: List<TextRange>,
    /** The start of each of the block's lines, fences included. */
    val lines: List<Int>,
    val fenceLines: List<Int>,
    /** A line that is not a fence: what is left to show when the fences are hidden. */
    val hasCode: Boolean,
    /** A top-level indented block's indent on each line. */
    val indents: List<TextRange>,
) : Construct {
    override fun shifted(delta: Int) = FenceNode(
        node.moved(delta), fences.map { it.moved(delta) }, lines.map { it + delta }, fenceLines.map { it + delta }, hasCode, indents.map { it.moved(delta) },
    )
}

internal data class LinkNode(
    override val node: TextRange,
    /** What is drawn in the link colour. */
    val text: TextRange,
    val href: String,
    /** The marks that show, dimmed, while the selection touches the link (`[`, `]`, `(`, `)`; `<` `>`). */
    val marks: List<TextRange>,
    /** What is hidden while it does not (`[`, and `](url "title")` or `][label]`; `<` `>`). A part that runs over a line break is dimmed instead. */
    val hide: List<TextRange>,
) : Construct {
    override fun shifted(delta: Int) = LinkNode(node.moved(delta), text.moved(delta), href, marks.map { it.moved(delta) }, hide.map { it.moved(delta) })
}

/** A line of a list or a quote, as the desktop's `readLines` (liveLists.ts) makes it: `node` is the line, from its start to the end of its text. */
internal data class ListLineNode(
    override val node: TextRange,
    val containers: List<LiveDecorations.ListLine.Container>,
    /** Where the marks and indentation at the line's start end (the desktop's `prefixEnd`): what is hidden away from the selection. */
    val prefixEnd: Int,
    val marker: LiveDecorations.ListLine.Marker?,
    val task: LiveDecorations.ListLine.Task?,
) : Construct {
    override fun shifted(delta: Int) = ListLineNode(
        node.moved(delta), containers, prefixEnd + delta, marker, task?.let { it.copy(range = it.range.moved(delta), box = it.box.moved(delta)) },
    )
}

class LiveModel private constructor(private val extrasLimit: Int?, private var state: State) {
    /** Reads `text`. `extrasLimit` is the length beyond which highlights and `<Image />` tags are not read; null (the default, as on the desktop) reads them in any note. */
    constructor(text: String, extrasLimit: Int? = null) : this(extrasLimit, State.of(text, extrasLimit))

    /** Everything the model holds, made again whole when an edit cannot be followed. */
    private class State(
        val chars: StringBuilder,
        val constructs: ArrayList<Construct>,
        /** `reach[i]` is how far any of the first `i + 1` constructs reaches: it never goes down, so the first construct that reaches a place is found by search. */
        var reach: IntArray,
        var frontmatterLines: List<Int>,
        var scan: LiveScan.Result,
        /**
         * The footnote citations that have a definition, numbered as the Preview numbers them. They are numbered by the whole note, so, like `scan`,
         * they are moved with the edits between full reads and made right by the next one.
         */
        var footnoteRefs: List<LiveDecorations.FootnoteRef>,
    ) {
        companion object {
            fun of(text: String, extrasLimit: Int?): State {
                val read = read(text, frontmatter = true)
                val scan = if (extrasLimit == null || text.length <= extrasLimit) LiveScan.read(text) else LiveScan.Result()
                return State(StringBuilder(text), ArrayList(read.first), reach(read.first), read.second, scan, footnoteRefs(text))
            }
        }
    }

    /** The length of the text, in UTF-16 units. */
    val length: Int get() = state.chars.length

    private val chars get() = state.chars
    private val constructs get() = state.constructs

    companion object {
        /** CommonMark with GFM's tables, strikethrough and task lists, with where each node is: what swift-markdown reads on the iPad (no autolinks: the reader finds bare addresses as lezer does). */
        private val parser: Parser = Parser.builder()
            .extensions(listOf(TablesExtension.create(), StrikethroughExtension.create(), TaskListItemsExtension.create()))
            .includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES)
            .build()

        /** The citations of footnotes in `text` (a whole note), with their numbers: `NoteScanner`'s, which are the Preview's. */
        internal fun footnoteRefs(text: String): List<LiveDecorations.FootnoteRef> {
            if (!text.contains("[^")) return emptyList()
            val body = NoteFrontmatter.split(text).second
            val offset = if (text.endsWith(body)) text.length - body.length else 0
            return NoteScanner.scan(body, offset).footnoteCitations.map { LiveDecorations.FootnoteRef(it.range, it.number) }
        }

        /**
         * The constructs of `text`, with positions in it, and the lines of its frontmatter. `frontmatter` says whether a `---` block at the very start is
         * frontmatter: it is not when `text` is only a piece taken from the middle of a note.
         */
        private fun read(text: String, frontmatter: Boolean): Pair<List<Construct>, List<Int>> {
            val lines = LineIndex(text)

            // The frontmatter is YAML, not Markdown: it is left out of the read (its text blanked, its line breaks kept) and drawn set apart. It is
            // blanked unit by unit, so that every offset the parser gives is one in `text`.
            val body = if (frontmatter) NoteFrontmatter.split(text).second else text
            val frontmatterEnd = text.length - body.length
            var frontmatterLines = emptyList<Int>()
            var source = text
            if (frontmatterEnd > 0) {
                val last = lines.line(minOf(frontmatterEnd - 1, text.length))
                frontmatterLines = lines.starts.copyOfRange(0, last + 1).toList()
                val head = CharArray(frontmatterEnd) { val c = text[it]; if (c == '\n' || c == '\r') c else ' ' }
                source = String(head) + body
            }

            val reader = LiveReader(text, lines)
            reader.visit(parser.parse(source))
            val constructs = ArrayList<Construct>()
            constructs += reader.headings
            constructs += reader.rules
            constructs += reader.styles
            constructs += reader.pictures
            constructs += reader.codeBlocks
            constructs += reader.links
            constructs += reader.listLines()
            constructs.sortBy { it.node.location }
            return constructs to frontmatterLines
        }

        private fun reach(constructs: List<Construct>): IntArray {
            var farthest = 0
            return IntArray(constructs.size) {
                farthest = maxOf(farthest, constructs[it].node.end)
                farthest
            }
        }

        /** What a line of a list or a quote looks like with the selection on it (`active`) or away from it, as the desktop's `listDecorations` decides. */
        private fun listLine(line: ListLineNode, active: Boolean): LiveDecorations.ListLine {
            val out = LiveDecorations.ListLine(line.node, line.containers, active)
            if (active) return out
            val hidden = if (line.prefixEnd > line.node.location) TextRange(line.node.location, line.prefixEnd - line.node.location) else null
            val innermost = line.containers.lastOrNull()
            val marker = if (innermost is LiveDecorations.ListLine.Container.Item && innermost.starts) line.marker else null
            return out.copy(hidden = hidden, marker = marker, task = line.task)
        }
    }

    // After an edit

    /**
     * Brings the model up to date with an edit: `range` of the old text became `newLength` units, `text` is the text now, and `window` (in the new
     * text) is the part of it to read again, which must hold the edit and whole top-level blocks (what the editor's colours re-read). Everything
     * after the window moves with the edit; what the window holds is read again. The places of highlights and `<Image />` tags are moved with the
     * edit (see `LiveScan.Result.shifted`) and made right again when a `LiveModel` is made again from the whole text (the full read a pause after
     * typing, and `differences` says what that changed), because they pair across blocks.
     */
    fun edited(range: TextRange, newLength: Int, window: TextRange, text: String) {
        val delta = newLength - range.length
        val oldWindow = TextRange(window.location, window.length - delta)
        if (range.location < 0 || range.end > length || oldWindow.length < 0 || window.location < 0 || window.end > text.length ||
            range.location + newLength > text.length
        ) {
            state = State.of(text, extrasLimit)
            return
        }
        chars.replace(range.location, range.end, text.substring(range.location, range.location + newLength))
        state.scan = state.scan.shifted(range, delta)
        // A citation the edit touches may be one no longer: it is left out until the full read. Those after it move.
        state.footnoteRefs = state.footnoteRefs.mapNotNull { ref ->
            when {
                ref.range.end <= range.location -> ref
                ref.range.location >= range.end -> LiveDecorations.FootnoteRef(ref.range.moved(delta), ref.number)
                else -> null
            }
        }

        // What starts in the old window is dropped, and what starts after it moves; what starts before it stays (and should end before it).
        val low = firstIndex(oldWindow.location)
        val high = firstIndex(oldWindow.end)
        for (index in high until constructs.size) constructs[index] = constructs[index].shifted(delta)
        val fresh = read(text.substring(window.location, window.end), frontmatter = window.location == 0)
        val replaced = constructs.subList(low, high)
        replaced.clear()
        replaced.addAll(fresh.first.map { it.shifted(window.location) })
        state.reach = reach(constructs)
        if (window.location == 0) state.frontmatterLines = fresh.second
    }

    /** The index of the first construct that starts at or after `position`. */
    private fun firstIndex(position: Int): Int {
        var low = 0
        var high = constructs.size
        while (low < high) {
            val middle = (low + high) / 2
            if (constructs[middle].node.location >= position) high = middle else low = middle + 1
        }
        return low
    }

    /** Calls `body` for each construct that starts at or before `start` and reaches at least `reaching`, in order. */
    private inline fun forEachConstruct(start: Int, reaching: Int, body: (Construct) -> Unit) {
        val reach = state.reach
        var low = 0
        var high = reach.size
        while (low < high) {
            val middle = (low + high) / 2
            if (reach[middle] >= reaching) high = middle else low = middle + 1
        }
        var index = low
        while (index < constructs.size && constructs[index].node.location <= start) {
            if (constructs[index].node.end >= reaching) body(constructs[index])
            index++
        }
    }

    // Reading

    /** What the Live view does to the whole note while `selection` (a caret is a range of length 0) is where it is. */
    fun decorations(selection: TextRange): LiveDecorations = decorations(TextRange(0, length), selection, wholeNote = true)

    /**
     * What the Live view does to the part of the note in `window` (everything that touches it), while `selection` is where it is. A construct that is
     * only partly in the window is given whole: clip it to what is being drawn.
     */
    fun decorations(window: TextRange, selection: TextRange): LiveDecorations = decorations(window, selection, wholeNote = false)

    private fun decorations(window: TextRange, selection: TextRange, wholeNote: Boolean): LiveDecorations {
        val low = selection.location
        val high = selection.end

        /** Whether the selection reaches `from`...`to`, ends included: `**bold**|` still shows its marks, `**bold** |` does not. */
        fun touches(range: TextRange) = low <= range.end && high >= range.location
        fun inWindow(range: TextRange) = wholeNote || (range.location < window.end && range.end > window.location)

        val headings = ArrayList<LiveDecorations.Heading>()
        val rules = ArrayList<Int>()
        val styles = ArrayList<LiveDecorations.Style>()
        val hidden = ArrayList<TextRange>()
        val shown = ArrayList<TextRange>()
        val pictures = ArrayList<LiveDecorations.Picture>()
        val fencesHidden = ArrayList<TextRange>()
        val fencesShown = ArrayList<TextRange>()
        val codeBlocks = ArrayList<LiveDecorations.CodeBlock>()
        val codeIndentsHidden = ArrayList<TextRange>()
        val links = ArrayList<LiveDecorations.Link>()
        val lists = ArrayList<LiveDecorations.ListLine>()
        val collapsedLines = ArrayList<Int>()
        val footnoteRefs = ArrayList<LiveDecorations.FootnoteRef>()

        forEachConstruct(window.end - 1, window.location + 1) { construct ->
            when (construct) {
                is HeadingNode -> {
                    val active = touches(construct.node)
                    val textLines = construct.setextLines
                    if (textLines != null) {
                        // A setext heading: each line of its text is a heading's line, and away from the selection its underline's line is hidden and has no height.
                        for (line in textLines) headings.add(LiveDecorations.Heading(line.location, construct.level, line))
                        for ((markShown, markHidden) in construct.marks) {
                            if (active) {
                                shown.add(markShown)
                            } else {
                                hidden.add(markHidden)
                                collapsedLines.add(markHidden.location)
                            }
                        }
                    } else {
                        headings.add(LiveDecorations.Heading(construct.line, construct.level, TextRange(construct.line, construct.node.end - construct.line)))
                        for ((markShown, markHidden) in construct.marks) if (active) shown.add(markShown) else hidden.add(markHidden)
                    }
                }
                is RuleNode -> if (!touches(construct.node)) {
                    rules.add(construct.line)
                    hidden.add(construct.node)
                }
                is StyleNode -> {
                    styles.add(LiveDecorations.Style(construct.style, construct.node))
                    val active = touches(construct.node)
                    for (mark in construct.marks) if (mark.length > 0) (if (active) shown else hidden).add(mark)
                }
                is PictureNode -> pictures.add(
                    LiveDecorations.Picture(
                        construct.node, isOwnLine(construct.node), touches(construct.node), construct.src, construct.alt, construct.title, width = "",
                    ),
                )
                is FenceNode -> {
                    val active = touches(construct.node)
                    val hideFences = !active && construct.hasCode
                    (if (hideFences) fencesHidden else fencesShown).addAll(construct.fences)
                    if (!active) codeIndentsHidden.addAll(construct.indents)
                    val drawn = if (hideFences) construct.lines.filter { it !in construct.fenceLines } else construct.lines
                    val from = construct.lines.firstOrNull() ?: construct.node.location
                    codeBlocks.add(
                        LiveDecorations.CodeBlock(TextRange(from, construct.node.end - from), drawn, if (hideFences) emptyList() else construct.fenceLines, active),
                    )
                }
                is LinkNode -> {
                    val active = touches(construct.node)
                    links.add(LiveDecorations.Link(construct.text, construct.node, construct.href, active))
                    if (active) {
                        shown.addAll(construct.marks)
                    } else {
                        for (part in construct.hide) if (part.length > 0) (if (containsLineBreak(part)) shown else hidden).add(part)
                    }
                }
                is ListLineNode -> lists.add(listLine(construct, touches(construct.node)))
            }
        }

        for (image in state.scan.images) {
            if (!inWindow(image.range)) continue
            pictures.add(
                LiveDecorations.Picture(image.range, isOwnLine(image.range), touches(image.range), image.src, image.alt, image.title, image.width, image.kind),
            )
        }
        val tints = state.scan.tints.filter { inWindow(it.range) }.map { LiveDecorations.Tint(it.range, it.color) }
        for (ref in state.footnoteRefs) {
            if (!inWindow(ref.range)) continue
            if (touches(ref.range)) shown.add(ref.range) else footnoteRefs.add(ref)
        }
        for (element in state.scan.elements) {
            val whole = element.whole
            if (!inWindow(whole)) continue
            val active = touches(whole)
            for (tag in listOf(element.open, element.close)) {
                // A tag that runs over a line break cannot be hidden, so it is left showing, dimmed like the rest.
                if (active || containsLineBreak(tag)) shown.add(tag) else hidden.add(tag)
            }
        }
        return LiveDecorations(
            frontmatterLines = state.frontmatterLines.filter { wholeNote || (it >= window.location && it < window.end) },
            frontmatterRange = frontmatterRange,
            headings = headings, rules = rules, styles = styles, hidden = hidden, shown = shown, pictures = pictures, tints = tints,
            fencesHidden = fencesHidden, fencesShown = fencesShown, codeBlocks = codeBlocks, codeIndentsHidden = codeIndentsHidden, links = links,
            lists = lists, collapsedLines = collapsedLines, footnoteRefs = footnoteRefs,
        )
    }

    /**
     * The task box drawn at `position` (a box's three characters, or the space after it), with the selection where it is: what a tap on the box ticks
     * or unticks. Null when no box is drawn there (the selection is on its line, or there is no task).
     */
    fun task(position: Int, selection: TextRange): LiveDecorations.ListLine.Task? {
        var found: LiveDecorations.ListLine.Task? = null
        forEachConstruct(position, position) { construct ->
            if (construct !is ListLineNode) return@forEachConstruct
            val task = construct.task ?: return@forEachConstruct
            if (!(position >= task.range.location && position < task.range.end) && position != task.box.location) return@forEachConstruct
            val active = selection.location <= construct.node.end && selection.end >= construct.node.location
            if (listLine(construct, active).task != null) found = task
        }
        return found
    }

    /** The places of the constructs `selection` touches (ends included): the text whose look changes when the selection moves in or out of them. */
    fun constructRanges(selection: TextRange): List<TextRange> {
        val found = ArrayList<TextRange>()
        forEachConstruct(selection.end, selection.location) { found.add(it.node) }
        for (element in state.scan.elements) {
            val whole = element.whole
            if (whole.location <= selection.end && whole.end >= selection.location) found.add(whole)
        }
        for (image in state.scan.images) if (image.range.location <= selection.end && image.range.end >= selection.location) found.add(image.range)
        for (ref in state.footnoteRefs) if (ref.range.location <= selection.end && ref.range.end >= selection.location) found.add(ref.range)
        return found
    }

    /**
     * Where the pictures drawn in place of their text are: those with nothing but space on their line. They are what has to be laid out again when
     * the width of the text changes, because a picture is as tall as its width allows.
     */
    val drawnPictureRanges: List<TextRange>
        get() {
            val found = ArrayList<TextRange>()
            for (construct in constructs) if (construct is PictureNode && isOwnLine(construct.node)) found.add(construct.node)
            for (image in state.scan.images) if (isOwnLine(image.range)) found.add(image.range)
            return found.sortedBy { it.location }
        }

    /**
     * The places where this model and `older` (what is on the text) differ in what the Live look draws beyond the Markdown: highlights, `<Image />`
     * tags, footnote numbers and the frontmatter. The Markdown's own constructs are what the editor's colours compare.
     */
    fun differences(older: LiveModel): List<TextRange> {
        val found = ArrayList(state.scan.differences(older.state.scan))
        // The lines of lists and quotes: a quick read of a window can end an item or a quote early (a line it takes in lazily, below the window),
        // and the colours do not show it.
        found += symmetricDifference(listLineNodes, older.listLineNodes).map { it.node }
        if (frontmatterRange != older.frontmatterRange) found += listOfNotNull(frontmatterRange, older.frontmatterRange)
        // Footnote numbers pair across the note: a citation typed early renumbers every one after it.
        found += symmetricDifference(state.footnoteRefs, older.state.footnoteRefs).map { it.range }
        return found
    }

    private val listLineNodes: List<ListLineNode> get() = constructs.filterIsInstance<ListLineNode>()

    /** The whole frontmatter, from its first character to the end of its last line. */
    private val frontmatterRange: TextRange?
        get() {
            val first = state.frontmatterLines.firstOrNull() ?: return null
            var end = state.frontmatterLines.last()
            while (end < chars.length && chars[end] != '\n' && chars[end] != '\r') end++
            return TextRange(first, end - first)
        }

    /** Nothing but space and tabs is on the line with `range`. */
    private fun isOwnLine(range: TextRange): Boolean {
        var before = range.location
        while (before > 0 && chars[before - 1] != '\n' && chars[before - 1] != '\r') {
            if (chars[before - 1] != ' ' && chars[before - 1] != '\t') return false
            before--
        }
        var after = range.end
        while (after < chars.length && chars[after] != '\n' && chars[after] != '\r') {
            if (chars[after] != ' ' && chars[after] != '\t') return false
            after++
        }
        return true
    }

    private fun containsLineBreak(range: TextRange): Boolean = (range.location until range.end).any { chars[it] == '\n' || chars[it] == '\r' }
}

/** Where lines start, as CodeMirror counts them: a `\n`, a `\r\n` or a lone `\r` ends a line. */
internal class LineIndex(text: CharSequence) {
    val starts: IntArray

    init {
        val found = ArrayList<Int>()
        found.add(0)
        var i = 0
        while (i < text.length) {
            if (text[i] == '\n') {
                found.add(i + 1)
            } else if (text[i] == '\r') {
                if (i + 1 < text.length && text[i + 1] == '\n') i++
                found.add(i + 1)
            }
            i++
        }
        starts = found.toIntArray()
    }

    /** The index of the line holding `position`. */
    fun line(position: Int): Int {
        var low = 0
        var high = starts.size
        while (low < high) {
            val middle = (low + high) / 2
            if (starts[middle] <= position) low = middle + 1 else high = middle
        }
        return maxOf(low - 1, 0)
    }

    fun startOfLine(position: Int): Int = starts[line(position)]
}
