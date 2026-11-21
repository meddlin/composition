package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.live.LiveDecorations
import com.rushinglabs.composition.core.live.LiveModel
import com.rushinglabs.composition.core.live.LivePictureKind
import com.rushinglabs.composition.core.live.LiveStyle
import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.preview.HighlightModel
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The Live model, ported from LiveModelTests.swift. What it shares with the desktop is checked against the desktop's real code by
// LiveConformanceTests; these are the parts that are the iPad's own, and a few plain examples to read. As on the iPad, the edit tests drive the
// editor's colours (`HighlightModel`): the window they re-read after an edit is what the Live model reads again.

private fun decorations(text: String, caret: Int, end: Int? = null, limit: Int? = null): LiveDecorations =
    LiveModel(text, extrasLimit = limit).decorations(TextRange(caret, (end ?: caret) - caret))

private fun ranges(list: List<TextRange>): List<List<Int>> = list.map { listOf(it.location, it.end) }

private fun range(location: Int, length: Int) = TextRange(location, length)

private val caret0 = TextRange(0, 0)

@DisplayName("The Live model")
class LiveModelTests {
    @Test
    @DisplayName("a bold word hides its marks away from the caret, and shows them, dimmed, while the caret is in it or right after it")
    fun boldMarks() {
        val text = "**some text** and more"
        assertEquals(listOf(listOf(0, 2), listOf(11, 13)), ranges(decorations(text, 20).hidden))
        assertTrue(decorations(text, 20).shown.isEmpty())
        assertEquals(listOf(listOf(0, 2), listOf(11, 13)), ranges(decorations(text, 5).shown))
        assertTrue(decorations(text, 5).hidden.isEmpty())
        assertTrue(decorations(text, 13).hidden.isEmpty()) // right after the closing mark is still the construct
        assertEquals(2, decorations(text, 14).hidden.size) // the next word is not
        assertEquals(2, decorations(text, 15, 20).hidden.size)
        assertTrue(decorations(text, 10, 20).hidden.isEmpty()) // a selection that reaches it
        assertEquals(listOf(LiveDecorations.Style(LiveStyle.STRONG, range(0, 13))), decorations(text, 20).styles)
    }

    @Test
    @DisplayName("a heading is drawn with its `#` and the space after it hidden, and its marks show while the caret is on its line")
    fun heading() {
        val text = "# Title\n\ntext"
        val away = decorations(text, 12)
        assertEquals(listOf(listOf(0, 1)), away.headings.map { listOf(it.line, it.level) })
        assertEquals(listOf(listOf(0, 2)), ranges(away.hidden))
        assertEquals(listOf(listOf(0, 1)), ranges(decorations(text, 3).shown))
    }

    @Test
    @DisplayName("a rule is drawn as a line and its dashes hidden, unless the caret is on them")
    fun rule() {
        val text = "above\n\n---\n\nbelow"
        assertEquals(listOf(7), decorations(text, 0).rules)
        assertEquals(listOf(listOf(7, 10)), ranges(decorations(text, 0).hidden))
        assertTrue(decorations(text, 8).rules.isEmpty())
        assertTrue(decorations(text, 8).hidden.isEmpty())
    }

    @Test
    @DisplayName("a fenced block's fences hide while the selection is outside it, and both show while it is anywhere in it (decision V2)")
    fun fences() {
        val text = "text\n\n```swift\nlet x = 1\n```\n\nafter"
        // The opening fence is 6..14 and the closing one 25..28.
        val both = listOf(listOf(6, 14), listOf(25, 28))
        val outside = decorations(text, 0)
        assertEquals(both, ranges(outside.fencesHidden))
        assertTrue(outside.fencesShown.isEmpty())
        for (caret in listOf(6, 10, 14, 15, 20, 24, 25, 28)) {
            val inside = decorations(text, caret)
            assertEquals(both, ranges(inside.fencesShown), "caret at $caret")
            assertTrue(inside.fencesHidden.isEmpty(), "caret at $caret")
        }
        assertEquals(both, ranges(decorations(text, 29).fencesHidden)) // the blank line after the block is outside it
        assertEquals(both, ranges(decorations(text, 5).fencesHidden))
    }

    @Test
    @DisplayName("a fence that is not closed has only its opening line, and indented code has none")
    fun otherCode() {
        assertEquals(listOf(listOf(0, 3)), ranges(decorations("```\ncode\nmore", 0).fencesShown))
        assertEquals(listOf(listOf(6, 9), listOf(15, 18)), ranges(decorations("text\n\n~~~\ncode\n~~~\n", 0).fencesHidden))
        val indented = decorations("text\n\n    code\n", 0)
        assertTrue(indented.fencesHidden.isEmpty() && indented.fencesShown.isEmpty())
    }

    @Test
    @DisplayName("a fenced block is one fill over its code lines while the selection is elsewhere, and over its fences too while it is in it")
    fun fencedBlockLines() {
        val text = "text\n\n```swift\nlet x = 1\nlet y = 2\n```\n\nafter"
        // Lines start at 0, 5, 6 (the opening fence), 15, 25 and 35 (the closing fence); the block runs from 6 to 38.
        val away = assertNotNull(decorations(text, 0).codeBlocks.firstOrNull())
        assertEquals(range(6, 32), away.range)
        assertTrue(away.lines == listOf(15, 25) && away.fences.isEmpty() && !away.active)
        val inside = assertNotNull(decorations(text, 20).codeBlocks.firstOrNull())
        assertTrue(inside.lines == listOf(6, 15, 25, 35) && inside.fences == listOf(6, 35) && inside.active)
        assertTrue(decorations(text, 0).codeIndentsHidden.isEmpty())
    }

    @Test
    @DisplayName("an indented block at the top level hides its indent while the selection is outside it; one in a list keeps it")
    fun indentedBlockLines() {
        val text = "para\n\n    one\n\tsix\n\nend"
        // The block's lines start at 6 and 14; it starts after the first line's indent (10), as lezer's does.
        val away = decorations(text, 0)
        val block = assertNotNull(away.codeBlocks.firstOrNull())
        assertTrue(block.range == range(6, 12) && block.lines == listOf(6, 14) && block.fences.isEmpty(), "$block")
        assertEquals(listOf(listOf(6, 10), listOf(14, 15)), ranges(away.codeIndentsHidden))
        assertTrue(decorations(text, 12).codeIndentsHidden.isEmpty())
        val listed = decorations("- item\n\n      code\n", 0)
        assertTrue(listed.codeBlocks.firstOrNull()?.lines == listOf(8) && listed.codeIndentsHidden.isEmpty())
    }

    @Test
    @DisplayName("a fence not closed runs to the end of the note, a block with no code keeps its fences, and one in a list hides its fences' whole lines")
    fun unusualBlocks() {
        val open = assertNotNull(decorations("para\n\n```\ncode\n", 0).codeBlocks.firstOrNull())
        assertTrue(open.range == range(6, 9) && open.lines == listOf(10, 15), "$open") // the empty line after the last break too
        assertEquals(listOf(listOf(6, 9)), ranges(decorations("para\n\n```\ncode\n", 0).fencesHidden))
        val empty = decorations("para\n\n```\n```\n", 0)
        assertTrue(empty.fencesHidden.isEmpty() && ranges(empty.fencesShown) == listOf(listOf(6, 9), listOf(10, 13)))
        assertTrue(empty.codeBlocks.firstOrNull()?.lines == listOf(6, 10) && empty.codeBlocks.firstOrNull()?.fences == listOf(6, 10))
        val listed = decorations("- item\n\n  ```\n  code\n  ```\n\nend", 0)
        assertEquals(listOf(listOf(8, 13), listOf(21, 26)), ranges(listed.fencesHidden))
        assertEquals(listOf(14), listed.codeBlocks.firstOrNull()?.lines)
        val quoted = decorations("> ```\n> code\n> ```\n\nend", 22)
        assertTrue(ranges(quoted.fencesHidden) == listOf(listOf(0, 5), listOf(13, 18)) && quoted.codeBlocks.firstOrNull()?.lines == listOf(6))
        // Four spaces before backticks is indented code, not a fence.
        val notFence = decorations("    ```\nafter", 12)
        assertTrue(notFence.fencesHidden.isEmpty() && notFence.codeBlocks.firstOrNull()?.lines == listOf(0) && ranges(notFence.codeIndentsHidden) == listOf(listOf(0, 4)))
    }

    @Test
    @DisplayName("highlight tags and <Image /> tags are read in a note of any length unless a limit is given, and the syntax always")
    fun length() {
        val text = "**bold** <Mark color=\"green\">tint</Mark> <Image src=\"a.png\" />"
        val all = decorations(text, 0)
        assertTrue(all.tints.size == 1 && all.pictures.size == 1)
        val limited = decorations(text, 0, limit = 10)
        assertTrue(limited.tints.isEmpty() && limited.pictures.isEmpty())
        assertEquals(1, limited.styles.size)
        assertEquals(1, decorations(text, 0, limit = null).tints.size)
    }

    @Test
    @DisplayName("a picture is drawn in place of its text, and beside it while the caret is on it")
    fun picture() {
        val text = "![alt text](app_data/img-0123456789ab.png \"A title\") after"
        val away = assertNotNull(decorations(text, 56).pictures.firstOrNull())
        assertFalse(away.active)
        assertEquals(range(0, 52), away.range)
        assertEquals(listOf("app_data/img-0123456789ab.png", "alt text", "A title"), listOf(away.src, away.alt, away.title))
        assertTrue(assertNotNull(decorations(text, 20).pictures.firstOrNull()).active)
    }

    @Test
    @DisplayName("offsets count UTF-16 units, so an emoji is two, and a line break of two characters is one line")
    fun offsets() {
        val text = "😀 **bold**\r\n\r\n# Head"
        val away = decorations(text, 0, 0)
        assertEquals(listOf(listOf(3, 5), listOf(9, 11), listOf(15, 17)), ranges(away.hidden).sortedBy { it[0] })
        assertEquals(listOf(listOf(15, 1)), away.headings.map { listOf(it.line, it.level) })
    }
}

// Following edits and the selection

/** Every fact the model gives for a window, one line each, so that two answers compare. */
private fun facts(decorations: LiveDecorations, window: TextRange? = null): List<String> {
    fun shown(range: TextRange) = window?.let { range.location < it.end && range.end > it.location } ?: true
    fun span(range: TextRange) = "${range.location}-${range.end}"
    val out = ArrayList<String>()
    decorations.headings.filter { shown(it.range) }.forEach { out.add("heading ${it.line} ${it.level} ${span(it.range)}") }
    if (window == null) decorations.rules.forEach { out.add("rule $it") }
    decorations.styles.filter { shown(it.range) }.forEach { out.add("${it.style.rawValue} ${span(it.range)}") }
    decorations.hidden.filter(::shown).forEach { out.add("hidden ${span(it)}") }
    decorations.shown.filter(::shown).forEach { out.add("shown ${span(it)}") }
    decorations.pictures.filter { shown(it.range) }.forEach { out.add("picture ${span(it.range)} ${it.active} ${it.src}") }
    decorations.fencesHidden.filter(::shown).forEach { out.add("fence hidden ${span(it)}") }
    decorations.fencesShown.filter(::shown).forEach { out.add("fence shown ${span(it)}") }
    decorations.codeBlocks.filter { shown(it.range) }.forEach { out.add("code ${span(it.range)} ${it.lines} ${it.fences} ${it.active}") }
    decorations.codeIndentsHidden.filter(::shown).forEach { out.add("indent hidden ${span(it)}") }
    decorations.links.filter { shown(it.node) }.forEach { out.add("link ${span(it.range)} ${it.active} ${it.href}") }
    decorations.lists.filter { shown(it.range) }.forEach { out.add(listFact(it)) }
    return out.sorted()
}

/** A line of a list or a quote, written out: where it is, what it is in, whether the selection is on it, and what is hidden and drawn. */
private fun listFact(line: LiveDecorations.ListLine): String {
    val containers = line.containers.joinToString(" ") {
        when (it) {
            is LiveDecorations.ListLine.Container.Quote -> "Q"
            is LiveDecorations.ListLine.Container.Item -> "L${if (it.starts) "+" else ""}${it.column}"
        }
    }
    var out = "line ${line.range.location}-${line.range.end} [$containers]${if (line.active) " active" else ""}"
    line.hidden?.let { out += " hide ${it.location}-${it.end}" }
    line.marker?.let { out += " marker ${if (it.ordered) it.text else "bullet"}" }
    line.task?.let { out += " task ${it.range.location}-${it.range.end} ${if (it.checked) "x" else "o"}" }
    return out
}

@DisplayName("The Live model follows edits and the selection")
class LiveModelFollowingTests {
    private val sample = """
        # Notes on the Live view

        Some **bold** words, some *italic* ones and `code` too, with a [link](https://x.test).
        A [note](note:12 "Title"), <https://y.test/a> and www.z.test/b, bare.

        - one **two**
        - three *four*

        ## Second heading ##

        > a quote with ~~strike~~ and **bold**

        ```swift
        let x = **not bold**
        ```

        ---

        The end ![alt](pic.png "t") of it.
    """.trimIndent()

    /** Edits as typing makes them (a character, a mark, a line break, a deletion), at places in the middle of the note. */
    @Test
    @DisplayName("after edits, what the model says is what a fresh read says, wherever the selection is")
    fun editsMatchAFreshRead() {
        val random = SeededEdits(0x2545F4914F6CDD1DuL)
        val pieces = listOf("a", " ", "b", "**", "*", "~~", "# ", "- ", "\n", "\n\n", "x y", "_", "`", "> ")
        var text = sample
        var highlights = HighlightModel(text)
        var live = LiveModel(text)
        var compared = 0
        val failures = ArrayList<String>()
        for (step in 0 until 300) {
            val location = random.next(text.length + 1)
            val deleting = random.next(4) == 0 && text.isNotEmpty()
            val range = if (deleting) {
                val at = minOf(location, text.length - 1)
                TextRange(at, minOf(1 + random.next(3), text.length - at))
            } else {
                TextRange(location, 0)
            }
            val insertion = if (deleting) "" else pieces[random.next(pieces.size)]
            text = replacing(text, range, insertion)
            val window = highlights.edited(range, insertion.length, text)
            live.edited(range, insertion.length, window, text)
            // The quick read of a piece can differ from the whole's (a fence typed on a line swallows what is below it): the colours put that right
            // a pause later, and so do these. Only where the colours agree with a fresh read is the model held to it.
            if (HighlightModel(text).differences(highlights).isNotEmpty()) {
                highlights = HighlightModel(text)
                live = LiveModel(text)
                continue
            }
            val fresh = LiveModel(text)
            assertEquals(fresh.length, live.length)
            val selections = listOf(TextRange(0, 0), TextRange(random.next(text.length + 1), 0), TextRange(random.next(text.length + 1), random.next(8)))
            for (selection in selections.filter { it.end <= text.length }) {
                val want = facts(fresh.decorations(selection))
                val got = facts(live.decorations(selection))
                if (want != got) failures.add("after edit $step (${insertion.replace("\n", "\\n")} over $range), selection $selection: ${(want - got.toSet()).take(3)} / ${(got - want.toSet()).take(3)}")
                compared++
                // And the part of the note a window shows, which is what the editor asks for after an edit and when the selection moves.
                val start = random.next(text.length + 1)
                val shownWindow = TextRange(start, minOf(random.next(120), text.length - start))
                if (facts(live.decorations(shownWindow, selection), shownWindow) != facts(fresh.decorations(shownWindow, selection), shownWindow)) {
                    failures.add("after edit $step, window $shownWindow, selection $selection")
                }
            }
        }
        println("Live model: $compared selections after edits compared with a fresh read, ${failures.size} differ")
        assertTrue(failures.isEmpty(), failures.take(10).joinToString("\n"))
        assertTrue(compared > 300, "only $compared compared")
    }

    @Test
    @DisplayName("a window is given everything that touches it, and nothing else")
    fun windows() {
        val live = LiveModel(sample)
        val length = sample.length
        for (selection in listOf(TextRange(0, 0), TextRange(60, 0), TextRange(150, 4))) {
            val whole = live.decorations(selection)
            for (start in 0 until length step 37) {
                val window = TextRange(start, minOf(50, length - start))
                assertEquals(facts(whole, window), facts(live.decorations(window, selection), window), "window $window, selection $selection")
            }
        }
    }

    @Test
    @DisplayName("the constructs a selection touches are the ones whose look changes when it moves")
    fun touching() {
        val live = LiveModel("**bold** and *it* and `code` and # not heading")
        assertEquals(listOf(range(0, 8)), live.constructRanges(TextRange(3, 0)))
        assertEquals(listOf(range(0, 8)), live.constructRanges(TextRange(8, 0)))
        assertTrue(live.constructRanges(TextRange(9, 0)).isEmpty())
        assertEquals(2, live.constructRanges(TextRange(0, 20)).size)
        val nested = LiveModel("**bold *both* bold**")
        assertEquals(2, nested.constructRanges(TextRange(9, 0)).size)
    }
}

// Highlights, pictures and the frontmatter while typing

@DisplayName("The Live model keeps highlights, pictures and the frontmatter right")
class LiveModelDrawnTests {
    private class Editor(var text: String) {
        val highlights = HighlightModel(text)
        val live = LiveModel(text)

        /** Types `insertion` over `range`, the way the editor tells the models: the colours re-read their blocks and the Live model follows. */
        fun type(insertion: String, range: TextRange) {
            text = replacing(text, range, insertion)
            val window = highlights.edited(range, insertion.length, text)
            live.edited(range, insertion.length, window, text)
        }
    }

    private fun tints(model: LiveModel) = model.decorations(caret0).tints.map { "${it.range.location}-${it.range.end} ${it.color}" }

    @Test
    @DisplayName("typing in a highlight keeps it tinted, and typing before it moves it")
    fun tintsFollowTyping() {
        val editor = Editor("first <Mark color=\"green\">tint</Mark> last\n\nsecond paragraph")
        assertEquals(listOf("26-30 green"), tints(editor.live))
        editor.type("ish", TextRange(30, 0)) // at the end of the tinted words
        assertEquals(tints(LiveModel(editor.text)), tints(editor.live))
        editor.type("X", TextRange(28, 0)) // in the middle
        assertEquals(tints(LiveModel(editor.text)), tints(editor.live))
        editor.type("new ", TextRange(0, 0)) // before it
        assertEquals(tints(LiveModel(editor.text)), tints(editor.live))
        editor.type("more", TextRange(editor.text.length, 0)) // in the next paragraph
        assertEquals(tints(LiveModel(editor.text)), tints(editor.live))
    }

    @Test
    @DisplayName("an edit in a tag drops the highlight until the pause, and the full read says what changed")
    fun tagsEditedAndTheFullRead() {
        val editor = Editor("a <Mark color=\"green\">tint</Mark> b")
        editor.type("blue", TextRange(15, 5)) // green becomes blue, inside the tag
        assertEquals(listOf("21-25 green"), tints(editor.live), "the tinted words moved with the edit, in the colour they had")
        val fresh = LiveModel(editor.text)
        assertEquals(listOf("21-25 blue"), tints(fresh))
        // The tag that was edited was dropped (it may no longer be one), and the tint's colour changed: the whole highlight, 2 to 32, is what to draw again.
        assertEquals(listOf(range(2, 30)), fresh.differences(editor.live))
        assertTrue(LiveModel(editor.text).differences(LiveModel(editor.text)).isEmpty())
    }

    @Test
    @DisplayName("a picture stands on its own line or not, and only those are drawn in place")
    fun ownLine() {
        val text = "![a](one.png)\n\ntext ![b](two.png) more\n\n  ![c](three.png)  \n\n<Image src=\"four.png\" />\n\n<Image src=\"five.png\" /> beside"
        val model = LiveModel(text)
        val pictures = model.decorations(caret0).pictures.sortedBy { it.range.location }
        assertEquals(listOf("one.png", "two.png", "three.png", "four.png", "five.png"), pictures.map { it.src })
        assertEquals(listOf(true, false, true, true, false), pictures.map { it.ownLine })
        assertEquals(3, model.drawnPictureRanges.size)
    }

    @Test
    @DisplayName("the frontmatter is one range, from its first character to the end of its closing line")
    fun frontmatter() {
        assertEquals(range(0, 26), LiveModel("---\ntitle: A\ntags:\n- x\n---\n# Body").decorations(caret0).frontmatterRange)
        assertNull(LiveModel("# No frontmatter").decorations(caret0).frontmatterRange)
        assertEquals(range(0, 18), LiveModel("---\r\ntitle: A\r\n---\r\ntext").decorations(caret0).frontmatterRange)
    }

    // Links

    @Test
    @DisplayName("a link away from the selection hides `[` and `](url \"title\")` and is drawn as its words; touching it shows its four marks, dimmed")
    fun link() {
        val text = "see [the note](note:12 \"Title\") here"
        val away = decorations(text, 0)
        assertEquals(listOf(LiveDecorations.Link(range(5, 8), range(4, 27), "note:12", active = false)), away.links)
        assertEquals(listOf(listOf(4, 5), listOf(13, 31)), ranges(away.hidden))
        assertTrue(away.shown.isEmpty())
        for (caret in listOf(4, 8, 13, 20, 31)) {
            val near = decorations(text, caret)
            assertEquals(true, near.links.firstOrNull()?.active, "caret at $caret")
            assertEquals(listOf(listOf(4, 5), listOf(13, 14), listOf(14, 15), listOf(30, 31)), ranges(near.shown), "caret at $caret")
            assertTrue(near.hidden.isEmpty(), "caret at $caret")
        }
        assertEquals(false, decorations(text, 32).links.firstOrNull()?.active)
    }

    @Test
    @DisplayName("an autolink is drawn as its address with `<` `>` hidden, and a bare address as itself; www. is given http:// and an email mailto:")
    fun autolinks() {
        val text = "<https://x.test> or www.y.test, or a@b.test."
        val away = decorations(text, text.length)
        assertEquals(listOf(listOf(1, 15), listOf(20, 30), listOf(35, 43)), away.links.map { listOf(it.range.location, it.range.end) })
        assertEquals(listOf("https://x.test", "http://www.y.test", "mailto:a@b.test"), away.links.map { it.href })
        assertEquals(listOf(listOf(0, 1), listOf(15, 16)), ranges(away.hidden))
        assertEquals(listOf(listOf(0, 1), listOf(15, 16)), ranges(decorations(text, 3).shown))
    }

    @Test
    @DisplayName("a reference link follows its definition; a footnote, an empty link and a link with no text are left as written")
    fun references() {
        val text = "[ref][one], [one], [^1], [](u), [x]()\n\n[one]: https://x.test\n[^1]: a note"
        val away = decorations(text, text.length)
        assertEquals(listOf(listOf(1, 4), listOf(13, 16)), away.links.map { listOf(it.range.location, it.range.end) })
        assertTrue(away.links.all { it.href == "https://x.test" })
        assertEquals(listOf(listOf(0, 1), listOf(4, 10), listOf(12, 13), listOf(16, 17)), ranges(away.hidden))
    }

    @Test
    @DisplayName("a link's address that runs onto the next line is dimmed rather than hidden away from the selection (a line break cannot be hidden)")
    fun linkOverLines() {
        val text = "[a](u\n\"title\") split"
        val away = decorations(text, text.length)
        assertEquals(listOf(listOf(0, 1)), ranges(away.hidden))
        assertEquals(listOf(listOf(2, 14)), ranges(away.shown))
    }

    @Test
    @DisplayName("the links of a window are those that touch it, and they move with an edit before them")
    fun linksMove() {
        val live = LiveModel("first line\n\n[a](u) and [b](v)")
        assertEquals(listOf("u"), live.decorations(TextRange(12, 6), caret0).links.map { it.href })
        live.edited(TextRange(0, 0), 4, TextRange(0, 14), "new first line\n\n[a](u) and [b](v)")
        assertEquals(listOf(17, 28), live.decorations(caret0).links.map { it.range.location })
    }

    // `<Ink />` and `<Drawio />` are pictures too. The `<Ink />` ranges are checked against the desktop by LiveConformanceTests; `<Drawio />` is
    // the iPad's own (the desktop's Live tab leaves it as text), so these say what it does.

    @Test
    @DisplayName("an <Ink /> and a <Drawio /> are pictures of their own kind, outside code, and only on a line of their own drawn in place")
    fun drawingKinds() {
        val text = "<Ink src=\"app_data/a.png\" alt=\"Drawing\" />\n\n<Drawio src=\"app_data/d.png\" alt=\"Flow\" width=\"300\" />\n\n" +
            "<Image src=\"p.png\" />\n\n```\n<Drawio src=\"code.png\" />\n```\n\nsee <Ink src=\"inline.png\" /> here\n\n<Drawiox src=\"no.png\" />"
        val pictures = decorations(text, text.length).pictures.sortedBy { it.range.location }
        assertEquals(listOf("app_data/a.png", "app_data/d.png", "p.png", "inline.png"), pictures.map { it.src })
        assertEquals(listOf(LivePictureKind.INK, LivePictureKind.DRAWIO, LivePictureKind.IMAGE, LivePictureKind.INK), pictures.map { it.kind })
        assertEquals(listOf(true, true, true, false), pictures.map { it.ownLine })
        assertTrue(pictures[1].width == "300" && pictures[1].alt == "Flow")
        assertEquals(3, LiveModel(text).drawnPictureRanges.size)
    }

    @Test
    @DisplayName("the caret on a drawing's tag shows the tag, with the drawing after it")
    fun drawingReveal() {
        val text = "text\n\n<Drawio src=\"d.png\" />\n\nmore"
        val tag = TextRange(text.indexOf("<Drawio src=\"d.png\" />"), "<Drawio src=\"d.png\" />".length)
        assertEquals(listOf(false), decorations(text, 0).pictures.map { it.active })
        assertEquals(listOf(true), decorations(text, tag.location + 3).pictures.map { it.active })
        assertEquals(listOf(true), decorations(text, tag.end).pictures.map { it.active })
    }

    @Test
    @DisplayName("a drawing keeps its kind when an edit before it moves it, and a full read finds a drawing typed")
    fun drawingAfterAnEdit() {
        val live = LiveModel("intro\n\n<Ink src=\"a.png\" />")
        val edited = "intro, longer\n\n<Ink src=\"a.png\" />"
        live.edited(TextRange(5, 0), 8, TextRange(0, 15), edited)
        val moved = live.decorations(caret0).pictures
        assertEquals(listOf(LivePictureKind.INK), moved.map { it.kind })
        assertEquals(listOf(15), moved.map { it.range.location })
        val typed = "$edited\n\n<Drawio src=\"d.png\" />"
        val fresh = LiveModel(typed)
        assertEquals(listOf(LivePictureKind.INK, LivePictureKind.DRAWIO), fresh.decorations(caret0).pictures.map { it.kind })
        assertEquals(listOf(TextRange(typed.indexOf("<Drawio src=\"d.png\" />"), "<Drawio src=\"d.png\" />".length)), fresh.differences(live))
    }
}

// Lists, task lists and quotes. LiveConformanceTests compares them with the desktop's `listDecorations` when the fixture carries its facts;
// these are examples to read, and what is the iPad's own (the tap on a box).
@DisplayName("The Live model's lists, task lists and quotes")
class LiveListTests {
    private fun lists(text: String, caret: Int, end: Int? = null) = decorations(text, caret, end).lists.map(::listFact)

    @Test
    @DisplayName("a bullet's `- ` is hidden away from its line and a bullet drawn in its place; on its line it shows as written")
    fun bullets() {
        val text = "- one\n- two\n\nafter"
        assertEquals(listOf("line 0-5 [L+2] hide 0-2 marker bullet", "line 6-11 [L+2] hide 6-8 marker bullet"), lists(text, 15))
        assertEquals(listOf("line 0-5 [L+2] active", "line 6-11 [L+2] hide 6-8 marker bullet"), lists(text, 3))
        assertEquals(listOf("line 0-5 [L+2] active", "line 6-11 [L+2] hide 6-8 marker bullet"), lists(text, 5), "the end of the line is on it")
        assertEquals("line 6-11 [L+2] active", lists(text, 6)[1], "and so is the start of the next")
        assertTrue(decorations(text, 15).hidden.isEmpty(), "what the lists hide is theirs, not in `hidden`")
    }

    @Test
    @DisplayName("an ordered item keeps its number as written, and the gap after a mark is one to four spaces")
    fun numbers() {
        assertEquals("line 9-16 [L+3] hide 9-12 marker 4)", lists("3. three\n4) four", 0, 0).last())
        assertEquals(listOf("line 0-10 [L+6] active"), lists("10.   wide", 10))
        assertEquals(listOf("line 0-10 [L+6] hide 0-6 marker 10."), lists("10.   wide\n", 11))
        // Five spaces or more start an indented code block in the item: its text is one space in.
        assertEquals(listOf("line 0-11 [L+2] hide 0-2 marker bullet"), lists("-      code\n", 12))
    }

    @Test
    @DisplayName("a nested item is in both lists, and a line that carries an item on hides its indentation up to the item's text")
    fun nesting() {
        val text = "- a\n  - b\n\n    more of b\n\nend"
        assertEquals(
            listOf(
                "line 0-3 [L+2] hide 0-2 marker bullet",
                "line 4-9 [L2 L+4] hide 4-8 marker bullet",
                "line 10-10 [L2 L4]", // the blank line inside the item, which goes on after it
                "line 11-24 [L2 L4] hide 11-15",
            ),
            lists(text, 30),
        )
    }

    @Test
    @DisplayName("a task's box is hidden and drawn away from its line; it shows as written on it")
    fun tasks() {
        val text = "- [ ] open\n- [x] done\n\nend"
        assertEquals(
            listOf("line 0-10 [L+2] hide 0-2 marker bullet task 2-6 o", "line 11-21 [L+2] hide 11-13 marker bullet task 13-17 x"),
            lists(text, 24),
        )
        assertEquals("line 0-10 [L+2] active", lists(text, 4)[0])
        assertEquals(listOf("line 0-11 [L+2] active"), lists("* [X] Upper", 11))
        assertEquals(listOf("line 0-11 [L+2] hide 0-2 marker bullet task 2-6 x"), lists("* [X] Upper\n", 12))
        // Not a task: no space after the box, or something other than a space or an x in it.
        assertTrue(lists("- [ ]\n- [y] no\n- [x]no\n", 21).none { it.contains("task") })
    }

    @Test
    @DisplayName("a tap finds the drawn box at a place in it, and ticking writes an x where the space was, and back")
    fun toggling() {
        val model = LiveModel("- [ ] open\n- [x] done\n\nend")
        val away = TextRange(24, 0)
        val open = assertNotNull(model.task(3, away))
        assertTrue(open.box == range(2, 3) && !open.checked)
        assertTrue(open.toggle.range == range(3, 1) && open.toggle.text == "x")
        val done = assertNotNull(model.task(13, away))
        assertTrue(done.checked && done.toggle.text == " ")
        assertNull(model.task(3, TextRange(8, 0)), "no box is drawn on the caret's line, so there is nothing to tap")
        assertNull(model.task(8, away), "the words after the box are not the box")
    }

    @Test
    @DisplayName("a quote's `> ` is hidden away from its line, one bar for each level, and a lazy line is in the quote with nothing to hide")
    fun quotes() {
        assertEquals(listOf("line 0-5 [Q] hide 0-2", "line 6-13 [Q Q] hide 6-10", "line 14-18 [Q Q]"), lists("> one\n> > two\nlazy\n\nend", 22))
        assertEquals(listOf("line 0-8 [Q L+4] hide 0-4 marker bullet", "line 9-17 [Q L4] hide 9-13"), lists("> - item\n>   more\n\nx", 21))
        // A quote in an item: the line's innermost container is the quote, so its marks are hidden and no bullet is drawn (as on the desktop).
        assertEquals(listOf("line 0-10 [L+2 Q] hide 0-4"), lists("- > quoted\n\nx", 13))
    }

    @Test
    @DisplayName("nothing in the frontmatter is a list")
    fun frontmatter() {
        assertEquals(listOf("line 18-21 [L+2] hide 18-20 marker bullet"), lists("---\ntags:\n- a\n---\n- b\n", 0))
    }

    @Test
    @DisplayName("after edits, the lines of lists and quotes are what a fresh read says")
    fun edits() {
        val random = SeededEdits(0x9E3779B97F4A7C15uL)
        val pieces = listOf("- ", "1. ", "[ ] ", "[x] ", "> ", "  ", "\n", "\n\n", "word", "x")
        var text = "- [ ] one\n- two\n  - three\n\n> quoted\n> > deeper\n\n1. first\n2. second\n"
        var highlights = HighlightModel(text)
        var live = LiveModel(text)
        var compared = 0
        var corrected = 0
        for (step in 0 until 300) {
            val location = random.next(text.length + 1)
            val deleting = random.next(4) == 0 && text.isNotEmpty()
            val range = if (deleting) {
                val at = minOf(location, text.length - 1)
                TextRange(at, minOf(1 + random.next(3), text.length - at))
            } else {
                TextRange(location, 0)
            }
            val insertion = if (deleting) "" else pieces[random.next(pieces.size)]
            text = replacing(text, range, insertion)
            val window = highlights.edited(range, insertion.length, text)
            live.edited(range, insertion.length, window, text)
            if (HighlightModel(text).differences(highlights).isNotEmpty()) {
                highlights = HighlightModel(text)
                live = LiveModel(text)
                continue
            }
            val fresh = LiveModel(text)
            val selection = TextRange(random.next(text.length + 1), 0)
            val want = fresh.decorations(selection).lists
            val got = live.decorations(selection).lists
            if (want != got) {
                // The quick read of a window ended an item or a quote early: the full read a pause later says where, and those lines are drawn again.
                val differing = symmetric(want.map { it.range }.toSet(), got.map { it.range }.toSet()) +
                    want.zip(got).filter { it.first != it.second }.flatMap { listOf(it.first.range, it.second.range) }
                val said = fresh.differences(live)
                assertTrue(
                    differing.all { line -> said.any { overlaps(it, line) || it == line } },
                    "after edit $step: $differing not in $said",
                )
                corrected++
                live = fresh
                continue
            }
            compared++
        }
        println("Live lists: $compared edits agreed at once, $corrected after the pause's correction")
        assertTrue(compared > 100 && corrected < compared / 4, "$compared agreed at once, $corrected after the pause's correction")
    }

    @Test
    @DisplayName("the line a selection is on is one of the constructs it touches, so moving onto or off a list line draws it again")
    fun touching() {
        val model = LiveModel("- one\n- two\n\nend")
        assertTrue(model.constructRanges(TextRange(8, 0)).contains(range(6, 5)))
        assertFalse(model.constructRanges(TextRange(15, 0)).contains(range(6, 5)))
    }

    private fun <T> symmetric(a: Set<T>, b: Set<T>): Set<T> = (a - b) + (b - a)

    private fun overlaps(a: TextRange, b: TextRange) = minOf(a.end, b.end) - maxOf(a.location, b.location) > 0
}
