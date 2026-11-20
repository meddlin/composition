package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.live.LiveDecorations
import com.rushinglabs.composition.core.live.LiveModel
import com.rushinglabs.composition.core.live.LivePictureKind
import com.rushinglabs.composition.core.markdown.TextRange
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

// The Live view's model against the desktop's real `liveDecorations` (liveMarkdown.ts), run on a real CodeMirror state with the Markdown
// language, ported from LiveConformanceTests.swift. live-expected.json holds the texts (the hand-made ones of fixtures/conformance/live-cases.json,
// the MDX notes and the preview showcase), the selections tried on each (every caret position of a short text, a seeded sample of a long one) and
// what the desktop hid, showed, styled, drew and tinted for each.

private class LiveFixture(val texts: List<Pair<String, String>>, val states: List<Triple<Int, Int, Int>>, val expected: List<JsonObject>?)

private fun loadLive(directory: File, withExpected: Boolean): LiveFixture {
    val root = readJson(File(directory, "live-expected.json")).jsonObject
    val texts = root.getValue("texts").jsonArray.map { it.jsonObject.let { text -> text.string("group")!! to text.string("text")!! } }
    val states = root.getValue("states").jsonArray.map {
        val state = it.jsonObject
        Triple(state.int("t"), state.int("from"), state.int("to"))
    }
    return LiveFixture(texts, states, if (withExpected) root.getValue("expected").jsonArray.map { it.jsonObject } else null)
}

private fun JsonObject.int(key: String) = getValue(key).jsonPrimitive.int
private fun JsonElement.rows(): List<JsonArray> = jsonArray.map { it.jsonArray }
private fun JsonArray.int(index: Int) = this[index].jsonPrimitive.int
private fun JsonArray.text(index: Int) = this[index].jsonPrimitive.content

/** `\r\n` as one `\n`, which is how CodeMirror holds text the desktop slices strings from. */
private fun unified(text: String) = text.replace("\r\n", "\n")

private fun TextRange.span() = "$location-$end"

/**
 * Whether `position` is where a footnote definition's first word starts (`[^a]: A.`). lezer reads such a line as a link definition whose address is
 * that word, and the desktop's `drawLink` lets a footnote definition's address through as a bare one, so it draws `A.` as a link to `http://A.`: not a
 * link anyone wrote. The iPad, and this port, leave it out, so that one link is not compared (a link written in the definition's text is).
 */
private fun isFootnoteDefinitionWord(position: Int, text: String): Boolean {
    var start = minOf(position, text.length)
    while (start > 0 && text[start - 1] != '\n' && text[start - 1] != '\r') start--
    if (!(start + 1 < text.length && text[start] == '[' && text[start + 1] == '^')) return false
    val close = text.indexOf(']', start)
    if (close < 0 || !(close + 1 < text.length && text[close + 1] == ':')) return false
    var word = close + 2
    while (word < text.length && (text[word] == ' ' || text[word] == '\t')) word++
    return word == position
}

/** What the desktop said, one line for each fact, in a fixed order, so that two answers compare and a difference reads. */
private fun wanted(expected: JsonObject, text: String): List<String> {
    val out = ArrayList<String>()
    expected.getValue("frontmatterLines").jsonArray.forEach { out.add("frontmatter line at ${it.jsonPrimitive.int}") }
    expected.getValue("headings").rows().forEach { out.add("heading at ${it.int(0)}, level ${it.int(1)}") }
    expected.getValue("rules").jsonArray.forEach { out.add("rule at ${it.jsonPrimitive.int}") }
    expected.getValue("styles").rows().forEach { out.add("${it.text(0)} ${it.int(1)}-${it.int(2)}") }
    expected.getValue("hidden").rows().forEach { out.add("hidden ${it.int(0)}-${it.int(1)}") }
    expected.getValue("shown").rows().forEach { out.add("shown ${it.int(0)}-${it.int(1)}") }
    fun picture(name: String, row: JsonArray): String {
        val at = if (row[0] is JsonNull) "after the text, ending at ${row.int(1)}" else "in place of ${row.int(0)}-${row.int(1)}"
        return "$name $at: src=${unified(row.text(2))} alt=${unified(row.text(3))} title=${unified(row.text(4))} width=${row.text(5)}"
    }
    expected.getValue("pictures").rows().forEach { out.add(picture("picture", it)) }
    expected["inks"]?.takeIf { it !is JsonNull }?.rows()?.forEach { out.add(picture("ink", it)) }
    expected.getValue("tints").rows().forEach { out.add("tint ${it.int(0)}-${it.int(1)} ${it.text(2)}") }
    expected["footnoteRefs"]?.takeIf { it !is JsonNull }?.rows()?.forEach { out.add("footnote ${it.int(0)}-${it.int(1)} drawn as ${it.int(2)}") }
    expected.getValue("links").rows().filter { !isFootnoteDefinitionWord(it.int(0), text) }
        .forEach { out.add("link ${it.int(0)}-${it.int(1)} ${unified(it.text(2))}") }
    expected["lists"]?.takeIf { it !is JsonNull }?.rows()?.forEach {
        out.add("list line at ${it.int(0)}: ${it.text(1)}${if (it[2].jsonPrimitive.boolean) " starts" else ""}")
    }
    expected["listDrawn"]?.takeIf { it !is JsonNull }?.rows()?.forEach {
        val extra = it.text(3)
        out.add("list ${it.text(0)} ${it.int(1)}-${it.int(2)}${if (extra.isEmpty()) "" else " $extra"}")
    }
    return out.sorted()
}

private fun got(decorations: LiveDecorations, lists: Boolean): List<String> {
    val out = ArrayList<String>()
    decorations.frontmatterLines.forEach { out.add("frontmatter line at $it") }
    decorations.headings.forEach { out.add("heading at ${it.line}, level ${it.level}") }
    decorations.rules.forEach { out.add("rule at $it") }
    decorations.styles.forEach { out.add("${it.style.rawValue} ${it.range.span()}") }
    decorations.hidden.forEach { out.add("hidden ${it.span()}") }
    decorations.shown.forEach { out.add("shown ${it.span()}") }
    // A `<Drawio … />` is the iPad's own: the desktop's Live tab leaves it as its text, so it is not compared. It is read as `<Image />` and
    // `<Ink />` are, which `LiveModelTests` checks.
    for (picture in decorations.pictures) {
        if (picture.kind == LivePictureKind.DRAWIO) continue
        val at = if (picture.active) "after the text, ending at ${picture.range.end}" else "in place of ${picture.range.span()}"
        val name = if (picture.kind == LivePictureKind.INK) "ink" else "picture"
        out.add("$name $at: src=${unified(picture.src)} alt=${unified(picture.alt)} title=${unified(picture.title)} width=${picture.width}")
    }
    decorations.tints.forEach { out.add("tint ${it.range.span()} ${it.color}") }
    decorations.footnoteRefs.forEach { out.add("footnote ${it.range.span()} drawn as ${it.number}") }
    decorations.links.forEach { out.add("link ${it.range.span()} ${unified(it.href)}") }
    if (!lists) return out.sorted()
    for (line in decorations.lists) {
        val kinds = line.containers.joinToString("") { if (it is LiveDecorations.ListLine.Container.Quote) "Q" else "L" }
        val starts = line.containers.any { it is LiveDecorations.ListLine.Container.Item && it.starts }
        out.add("list line at ${line.range.location}: $kinds${if (starts) " starts" else ""}")
        val hidden = line.hidden
        if (hidden != null) {
            val marker = line.marker
            if (marker != null) out.add("list marker ${hidden.span()} ${if (marker.ordered) marker.text else "bullet"}") else out.add("list hidden ${hidden.span()}")
        }
        line.task?.let { out.add("list task ${it.range.span()} ${if (it.checked) "x" else " "}") }
    }
    return out.sorted()
}

private fun shown(text: String) = "\"" + (if (text.length > 100) text.take(100) + "…" else text).replace("\n", "\\n").replace("\r", "\\r") + "\""

@DisplayName("The Live view against the desktop")
class LiveConformanceTests {
    companion object {
        /**
         * Texts this model and the desktop's lezer-based code read differently, found by running this check and each looked at: the reason is the
         * difference. Everything else must agree for every selection tried. Keep this list short, and fix a difference rather than add to it.
         */
        val known: Map<String, String> = mapOf(
            // A bare address with a space in it is not a link, and lezer's autolink takes `https://x.test/*not` before it looks for emphasis, so
            // the `*` inside is not an opener. CommonMark reads emphasis first and finds `*not italic*`. Only an address written with a space does this.
            "inline|[a link](https://x.test/*not italic*) done" to "autolinks are read before emphasis by lezer, after it by CommonMark",
            // (The iPad's list also has `---\ntitle: [unclosed\n---\n# Body **bold**`, a frontmatter whose YAML does not parse, which its note says the
            // desktop drew as frontmatter with a heading inside. The desktop now draws it as no frontmatter, a setext heading under a rule, and so does
            // this: it agrees.)
            // On a setext heading's underline inside a quote (`> ===`), the desktop's lists draw no quote bar over its `> ` (lezer's underline line
            // carries no QuoteMark the lists read), while this draws the bar on every quoted line, this one too.
            "rest|> Quoted\n> ===\n\nx" to "the desktop draws no quote bar on a quoted setext underline's line",
            // lezer makes a link of `[brackets]` whether or not it is defined, and a link may not hold another, so the outer `[…](u)` is not one;
            // drawLink then draws nothing, `[brackets]` having no definition. CommonMark makes the outer one a link, as the iPad's Preview does.
            "links|[nested [brackets]](u)" to "lezer takes the inner `[brackets]` as a link even with no definition; CommonMark makes the outer one the link",
        )

        /** Code blocks this model and the desktop's `liveCode` read differently, each looked at, keyed as `known` is. */
        val knownCode: Map<String, String> = emptyMap()
    }

    @Test
    @DisplayName("every text, with every selection tried, is hidden, shown, styled, drawn and tinted as the desktop does")
    fun agreement() {
        val fixture = loadLive(requireConformance(), withExpected = true)
        val expected = fixture.expected!!
        val models = HashMap<Int, LiveModel>()
        val different = sortedMapOf<Int, Pair<Int, String>>()
        val start = System.nanoTime()
        for ((index, state) in fixture.states.withIndex()) {
            val (t, from, to) = state
            val text = fixture.texts[t].second
            val model = models.getOrPut(t) { LiveModel(text) }
            val want = wanted(expected[index], text)
            val have = got(model.decorations(TextRange(from, to - from)), lists = expected[index]["lists"].let { it != null && it !is JsonNull })
            if (want == have) continue
            val missing = (want.toSet() - have.toSet()).sorted().take(4)
            val extra = (have.toSet() - want.toSet()).sorted().take(4)
            val note = "selection $from-$to: missing $missing, extra $extra"
            val before = different[t]
            different[t] = ((before?.first ?: 0) + 1) to (before?.second ?: note)
        }
        val seconds = (System.nanoTime() - start) / 1e9

        val report = ArrayList<String>()
        var knownSelections = 0
        for ((t, found) in different) {
            val (group, text) = fixture.texts[t]
            if (known.containsKey("$group|$text")) {
                knownSelections += found.first
                continue
            }
            report.add("[$group] ${shown(text)}\n    ${found.first} selections differ; first: ${found.second}")
        }
        val differing = different.values.sumOf { it.first }
        val knownTexts = different.keys.count { known.containsKey(fixture.texts[it].first + "|" + fixture.texts[it].second) }
        println("Live view: ${fixture.states.size - differing} of ${fixture.states.size} selections over ${fixture.texts.size} texts agree with the desktop")
        println("  the other $knownSelections are in the $knownTexts known differences; ${"%.1f".format(java.util.Locale.ROOT, seconds)} s")
        val stale = known.keys.filter { key -> fixture.texts.withIndex().none { (t, text) -> "${text.first}|${text.second}" == key && different.containsKey(t) } }
        stale.forEach { println("  known difference that now agrees: ${shown(it)}") }
        report.take(40).forEach { println("  $it") }
        assertTrue(report.isEmpty(), "${report.size} of ${fixture.texts.size} texts differ:\n${report.joinToString("\n")}")
    }

    /**
     * For the same texts and selections, the lines the desktop draws as a code block (which are its fill's ends, which are fences), the fence lines
     * it collapses and the indents it hides, from its real `codeDecorations` (liveCode.ts).
     */
    @Test
    @DisplayName("every code block, with every selection tried, has its lines, fences and indent drawn and hidden as the desktop does")
    fun codeBlocks() {
        val directory = requireConformance()
        val codeFile = File(directory, "live-code-expected.json")
        skipUnless(codeFile.exists(), "live-code-expected.json is not there: the desktop's liveCode.ts is not in this tree")
        val fixture = loadLive(directory, withExpected = false)
        val code = readJson(codeFile).jsonObject.getValue("expected").jsonArray.map { it.jsonObject }
        assertTrue(code.size == fixture.states.size, "${code.size} code answers for ${fixture.states.size} selections")

        fun want(expected: JsonObject): List<String> =
            (expected.getValue("lines").rows().map { "line ${it.int(0)}: ${it.text(1)}" } + expected.getValue("hidden").rows().map { "indent hidden ${it.int(0)}-${it.int(1)}" }).sorted()

        fun have(decorations: LiveDecorations): List<String> {
            val out = ArrayList<String>()
            for (block in decorations.codeBlocks) {
                for (line in block.lines) {
                    val names = ArrayList<String>()
                    if (line in block.fences) names.add("fence")
                    if (line == block.lines.first()) names.add("first")
                    if (line == block.lines.last()) names.add("last")
                    out.add("line $line: ${names.sorted().joinToString(" ")}")
                }
            }
            decorations.fencesHidden.forEach { out.add("line ${it.location}: hidden") }
            decorations.codeIndentsHidden.forEach { out.add("indent hidden ${it.span()}") }
            return out.sorted()
        }

        val models = HashMap<Int, LiveModel>()
        val different = sortedMapOf<Int, Pair<Int, String>>()
        var blocks = 0
        for ((index, state) in fixture.states.withIndex()) {
            val (t, from, to) = state
            val model = models.getOrPut(t) { LiveModel(fixture.texts[t].second) }
            val wanted = want(code[index])
            val found = have(model.decorations(TextRange(from, to - from)))
            if (wanted.isNotEmpty()) blocks++
            if (wanted == found) continue
            val missing = (wanted.toSet() - found.toSet()).sorted().take(4)
            val extra = (found.toSet() - wanted.toSet()).sorted().take(4)
            val before = different[t]
            different[t] = ((before?.first ?: 0) + 1) to (before?.second ?: "selection $from-$to: missing $missing, extra $extra")
        }
        assertTrue(blocks > 100, "the desktop drew code blocks in only $blocks states")

        val report = ArrayList<String>()
        for ((t, found) in different) {
            val (group, text) = fixture.texts[t]
            if (knownCode.containsKey("$group|$text")) continue
            report.add("[$group] ${shown(text)}\n    ${found.first} selections differ; first: ${found.second}")
        }
        val differing = different.values.sumOf { it.first }
        println("Live view, code blocks: ${fixture.states.size - differing} of ${fixture.states.size} selections agree with the desktop")
        println("  $blocks of them with a code block drawn")
        report.take(40).forEach { println("  $it") }
        assertTrue(report.isEmpty(), "${report.size} of ${fixture.texts.size} texts differ:\n${report.joinToString("\n")}")
    }
}
