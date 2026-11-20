package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.markdown.JS_SPACE
import com.rushinglabs.composition.core.markdown.insideFence
import com.rushinglabs.composition.core.yaml.JavaScriptText

/** The props each component takes, for the editor to offer inside an open tag: a port of `props.ts`, from MdxProps.swift. */
object MdxProps {
    data class Value(val value: String, val description: String)

    data class Spec(
        val name: String,
        val description: String,
        /** Values worth suggesting; the prop may still take others (a width of `320`). */
        val values: List<Value> = emptyList(),
    )

    data class Component(val component: String, val props: List<Spec>)

    val highlightColors = listOf("yellow", "green", "blue", "pink", "orange")
    val chartTypes = listOf("bar", "line", "area", "pie")

    private val imageProps = listOf(
        Spec("src", "Where the picture is: app_data/… or a web address"),
        Spec("alt", "Text for when it can't be seen, and for screen readers"),
        Spec("title", "Tooltip shown when hovering over it"),
        Spec(
            "width", "How wide to draw it: pixels (400) or a share of the note (50%)",
            listOf(
                Value("25%", "A quarter of the note's width"),
                Value("50%", "Half the note's width"),
                Value("75%", "Three quarters of the note's width"),
                Value("100%", "The note's full width"),
                Value("200", "200 pixels wide"),
                Value("400", "400 pixels wide"),
                Value("600", "600 pixels wide"),
                Value("800", "800 pixels wide"),
            ),
        ),
    )

    /** In the desktop's order: the order the components are listed in (`Info`, `Warning`, ...). */
    val catalog: List<Component> = listOf(
        Component("Info", emptyList()),
        Component("Warning", emptyList()),
        Component("Image", imageProps),
        Component("Drawio", listOf(Spec("src", "The stored diagram: app_data/…")) + imageProps.filter { it.name != "src" }),
        Component("Toc", listOf(Spec("maxDepth", "Deepest heading level to list (1 to 6)", (1..6).map { Value("$it", "Stop at level $it headings") }))),
        Component("Mark", listOf(Spec("color", "Highlighter colour", highlightColors.map { Value(it, "Highlight in $it") }))),
        Component("Footnotes", emptyList()),
        Component(
            "YouTube",
            listOf(
                Spec("url", "The video's link (youtube.com/watch…, youtu.be/…) or its 11-character id"),
                Spec(
                    "start", "Where to begin playing: seconds (90), or 1:30, 1m30s",
                    listOf(Value("30", "30 seconds in"), Value("1:00", "One minute in"), Value("5:00", "Five minutes in")),
                ),
                Spec("title", "Names the player for screen readers"),
            ),
        ),
        Component(
            "Repo",
            listOf(
                Spec("url", "The repository's page or clone address (github.com/owner/repo, git@host:owner/repo.git)"),
                Spec("description", "What the repository is for, shown under its name"),
            ),
        ),
        Component(
            "Chart",
            listOf(
                Spec("type", "Kind of chart (bar when left out)", chartTypes.map { Value(it, "A $it chart") }),
                Spec("x", "The column for the labels along the bottom (the first when left out)"),
                Spec("y", "The column(s) to draw, comma-separated (every column of numbers when left out)"),
                Spec("title", "Caption shown above the chart"),
                Spec("height", "How tall to draw it, in pixels (280 when left out)", listOf("200", "280", "400", "600").map { Value(it, "$it pixels tall") }),
            ),
        ),
        Component(
            "Sheet",
            listOf(
                Spec("title", "Caption shown above the sheet"),
                Spec(
                    "totals", "The last row is a totals row, which a column named in a formula (such as [Revenue]) leaves out",
                    listOf(Value("true", "The last row is the table's totals row")),
                ),
                Spec("height", "How tall it may grow before it scrolls, in pixels (360 when left out)", listOf("240", "360", "500", "700").map { Value(it, "$it pixels tall") }),
            ),
        ),
    )

    private fun props(component: String): List<Spec> = catalog.firstOrNull { it.component == component }?.props ?: emptyList()

    // Reading the tag at the caret

    /** How far back from the caret to look for the `<` that opened the tag. */
    private const val LOOKBACK = 1500

    private class QuotedValue(val start: Int, val end: Int, val closed: Boolean)

    private class Attribute(val name: String, val nameStart: Int, val nameEnd: Int) {
        var hasEquals = false
        /** The quoted value, between the quotes; `closed` says whether the closing quote is there yet. */
        var value: QuotedValue? = null
    }

    private class OpenTag(val name: String, val nameEnd: Int, var reach: Int) {
        val attributes = ArrayList<Attribute>()
        // `reach`: the last place the caret can be and still be in this tag: before the `/` or `>` that ends it, or, while that hasn't
        // been typed, where reading stopped (the end of an unclosed value's line, a blank line, the end of the note).
    }

    private val tagStart = Regex("""^<(${catalog.joinToString("|") { it.component }})(?=$JS_SPACE)""")
    private val attributeName = Regex("""[A-Za-z_][A-Za-z0-9_.:-]*""")
    private val equals = Regex("""$JS_SPACE*=$JS_SPACE*""")
    private val whitespace = Regex("""$JS_SPACE*""")
    private val blankLine = Regex("""\n[ \t]*\n""")
    private val whitespaceThenEquals = Regex("""^$JS_SPACE*=""")

    /** The length of `regex`'s match starting exactly at `at`, or null. */
    private fun matchLength(regex: Regex, text: String, at: Int): Int? =
        if (at > text.length) null else regex.matchAt(text, at)?.value?.length

    /** The tag starting at `start` (a `<`), read as far as it goes. Values are taken to end on their own line. */
    private fun readTag(text: String, start: Int): OpenTag? {
        val head = JS.slice(text, start, start + 32)
        val found = tagStart.find(head) ?: return null
        val tag = OpenTag(found.groupValues[1], start + found.value.length, text.length)
        var i = tag.nameEnd
        while (i < text.length) {
            val skippedLength = matchLength(whitespace, text, i) ?: 0
            // MDX can't carry a tag across a blank line, so what follows one isn't this tag's.
            if (blankLine.containsMatchIn(text.substring(i, i + skippedLength))) {
                tag.reach = i
                return tag
            }
            i += skippedLength
            if (i >= text.length) break

            val here = text[i]
            if (here == '>' || (here == '/' && i + 1 < text.length && text[i + 1] == '>')) {
                tag.reach = i
                return tag
            }
            val nameLength = matchLength(attributeName, text, i)
            if (nameLength == null) {
                i++
                continue
            }
            val attribute = Attribute(text.substring(i, i + nameLength), i, i + nameLength)
            i = attribute.nameEnd

            val equalsLength = matchLength(equals, text, i)
            if (equalsLength == null) {
                tag.attributes.add(attribute)
                continue
            }
            attribute.hasEquals = true
            i += equalsLength

            if (i >= text.length || (text[i] != '"' && text[i] != '\'')) {
                tag.attributes.add(attribute)
                continue // an {expression}, or a value not yet started
            }
            val quote = text[i]
            val lineEnd = JS.index('\n', text, i)
            val limit = if (lineEnd == -1) text.length else lineEnd
            val closing = JS.index(quote, text, i + 1)
            val closed = closing != -1 && closing < limit
            attribute.value = QuotedValue(i + 1, if (closed) closing else limit, closed)
            tag.attributes.add(attribute)
            if (!closed) {
                tag.reach = limit
                return tag
            }
            i = closing + 1
        }
        return tag
    }

    /** The `<Component ` the caret is inside of, if any. */
    private fun enclosingTag(text: String, caret: Int): Pair<Int, OpenTag>? {
        val floor = maxOf(0, caret - LOOKBACK)
        var i = caret
        while (i > 0) {
            i = JS.lastIndex('<', text, i - 1)
            if (i < floor || i < 0 || i >= caret) return null
            // Like a tag the user starts typing: not glued to a word, and not part of `<<`.
            if (i > 0 && (JS.isWordUnit(text[i - 1]) || text[i - 1] == '<')) continue
            readTag(text, i)?.let { return i to it }
        }
        return null
    }

    private fun startsWith(candidate: String, typed: String) = candidate.lowercase().startsWith(typed.lowercase())

    /**
     * What to offer at the caret inside a component's open tag: the names of the props the tag doesn't have yet (after a space, or
     * part-way through typing one), or, inside the quotes of a prop with values worth suggesting, those values. Null anywhere else, and in
     * a fenced code block.
     */
    fun findTarget(text: String, caret: Int): CompletionTarget? {
        val (openAt, tag) = enclosingTag(text, caret) ?: return null
        if (insideFence(text, JS.lastIndex('\n', text, openAt - 1) + 1)) return null
        if (caret <= tag.nameEnd || caret > tag.reach) return null
        val specs = props(tag.name)

        val inValue = tag.attributes.firstOrNull { attribute -> attribute.value?.let { it.start <= caret && caret <= it.end } ?: false }
        val value = inValue?.value
        if (inValue != null && value != null) {
            val spec = specs.firstOrNull { it.name == inValue.name }
            val query = JS.slice(text, value.start, caret)
            val items = (spec?.values ?: emptyList()).filter { startsWith(it.value, query) }
                .map { EditorCompletion(it.value, it.value, it.description, "${it.value}\"\$0") }
            // Through the closing quote, which the value brings along, so the caret ends up past it.
            return CompletionTarget(value.start, if (value.closed) value.end + 1 else value.end, query, items, "${spec?.name ?: inValue.name} values")
        }

        val typing = tag.attributes.firstOrNull { it.nameStart < caret && caret <= it.nameEnd }
        if (typing != null && typing.hasEquals) return null
        if (typing == null) {
            // Only in the space between things: not hard against the tag's name, a value, or a `=`.
            val before = if (caret >= 1 && caret - 1 < text.length) text[caret - 1] else null
            val afterEquals = whitespaceThenEquals.containsMatchIn(JS.slice(text, caret))
            if (before == null || !JavaScriptText.isWhitespace(before.code) || afterEquals) return null
        }

        val start = typing?.nameStart ?: caret
        val end = typing?.nameEnd ?: caret
        val query = JS.slice(text, start, caret)
        val present = tag.attributes.filter { it.nameStart != typing?.nameStart || it.nameEnd != typing?.nameEnd }.map { it.name }.toSet()
        // A prop typed right up against the next one needs a space of its own.
        val gap = if (end < text.length && !JavaScriptText.isWhitespace(text[end].code) && text[end] != '/' && text[end] != '>') " " else ""
        val items = specs.filter { it.name !in present && startsWith(it.name, query) }
            .map { EditorCompletion(it.name, it.name, it.description, "${it.name}=\"\$0\"$gap") }
        return CompletionTarget(start, end, query, items, "${tag.name} props")
    }
}
