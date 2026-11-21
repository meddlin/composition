package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.editing.CompletionTarget
import com.rushinglabs.composition.core.editing.EditorCompletion
import com.rushinglabs.composition.core.editing.EmphasisToggle
import com.rushinglabs.composition.core.editing.FrontmatterCompletions
import com.rushinglabs.composition.core.editing.IndentLines
import com.rushinglabs.composition.core.editing.LineEdit
import com.rushinglabs.composition.core.editing.MarkdownSnippets
import com.rushinglabs.composition.core.editing.MdxCompletions
import com.rushinglabs.composition.core.editing.MdxProps
import com.rushinglabs.composition.core.editing.NoteLinks
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The desktop's `completions.ts`, `props.ts`, `frontmatterProps.ts`, `snippets.ts`, `indentLines.ts`, `emphasis.ts` and `noteLinks.ts`
// (with `noteRefs.ts`) against the real functions, ported from EditingConformanceTests.swift. The inputs are
// fixtures/conformance/editing-cases.json: texts with a caret at every place in each (tags, props and values, quotes, fences, blank lines,
// emoji, CRLF), snippets, selections to indent or outdent and to make bold or italic, note links and their escapes; what the desktop made
// of each, and the catalogues it offers read through its own code, is editing-expected.json. Our answers are written as the desktop's
// JSON and compared as JSON, and each test gathers every difference before failing.

private fun shown(text: String): String = "\"" + (if (text.length > 50) text.take(50) + "…" else text).replace("\n", "\\n").replace("\r", "\\r") + "\""

private fun json(completion: EditorCompletion): JsonObject = buildJsonObject {
    put("name", completion.name)
    completion.label?.let { put("label", it) }
    put("description", completion.description)
    put("template", completion.template)
}

private fun json(target: CompletionTarget?): JsonElement = target?.let {
    buildJsonObject {
        put("start", it.start)
        put("end", it.end)
        put("query", it.query)
        put("items", JsonArray(it.items.map(::json)))
        put("label", it.label)
    }
} ?: JsonNull

private fun trigger(start: Int, query: String): JsonElement = buildJsonObject {
    put("start", start)
    put("query", query)
}

private fun json(edit: LineEdit?): JsonElement = edit?.let {
    buildJsonObject {
        put("start", it.start)
        put("end", it.end)
        put("text", it.text)
        put("selection", buildJsonObject {
            put("start", it.selectionStart)
            put("end", it.selectionEnd)
        })
    }
} ?: JsonNull

@DisplayName("The typing aids against the desktop")
class EditingConformanceTests {
    private class Fixtures(val cases: JsonObject, val expected: JsonObject) {
        fun cases(key: String) = cases.getValue(key).jsonArray
        fun expected(key: String) = expected.getValue(key).jsonArray

        /** Each `{text, carets}` case with each of its carets. */
        fun carets(key: String) = cases(key).map { it.jsonObject }.map { case ->
            case.getValue("text").jsonPrimitive.content to case.getValue("carets").jsonArray.map { it.jsonPrimitive.int }
        }
    }

    private fun load(): Fixtures {
        val directory = requireConformance()
        return Fixtures(readJson(File(directory, "editing-cases.json")).jsonObject, readJson(File(directory, "editing-expected.json")).jsonObject)
    }

    private fun report(what: String, total: Int, different: List<String>) {
        println("Editing, $what: ${total - different.size} of $total agree with the desktop")
        different.take(40).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "$what that differ: ${different.size}")
    }

    @Test
    @DisplayName("the components, props, values and snippets on offer are the desktop's, in its order and its words")
    fun catalogues() {
        val f = load()
        val catalog = f.expected.getValue("catalog").jsonObject
        val different = ArrayList<String>()
        if (JsonArray(MdxCompletions.all.map(::json)) != catalog.getValue("completions")) different.add("the components")
        val names = catalog.getValue("completions").jsonArray.map { it.jsonObject.getValue("name").jsonPrimitive.content }
        if (MdxProps.catalog.map { it.component } != names) different.add("the components with props: ${MdxProps.catalog.map { it.component }}")
        val props = catalog.getValue("props").jsonObject
        for ((component, specs) in MdxProps.catalog) {
            val ours = JsonArray(specs.map { spec ->
                buildJsonObject {
                    put("name", spec.name)
                    put("description", spec.description)
                    put("values", JsonArray(spec.values.map { buildJsonObject { put("value", it.value); put("description", it.description) } }))
                }
            })
            if (ours != props[component]) different.add("the props of $component")
        }
        val snippets = MarkdownSnippets.findTarget("/", 1)?.items ?: emptyList()
        if (JsonArray(snippets.map(::json)) != catalog.getValue("snippets")) different.add("the snippets")
        for ((index, query) in f.cases("queries").map { it.jsonPrimitive.content }.withIndex()) {
            val want = f.expected("matches")[index].jsonArray.map { it.jsonPrimitive.content }
            val got = MdxCompletions.match(query).map { it.name }
            if (got != want) different.add("matching ${shown(query)}: ours $got, desktop $want")
        }
        val expansions = JsonArray(MdxCompletions.all.map { MdxCompletions.expand(it) }.map { buildJsonObject { put("text", it.text); put("caret", it.caret) } })
        if (expansions != f.expected.getValue("expansions")) different.add("the expansions")
        report("catalogues and matches", 5 + MdxProps.catalog.size + f.cases("queries").size, different)
    }

    @Test
    @DisplayName("a < and the props and values inside a tag are found at every caret as the desktop finds them")
    fun tags() {
        val f = load()
        assertEquals(f.cases("tags").size, f.expected("triggers").size)
        val different = ArrayList<String>()
        var total = 0
        var offered = 0
        for ((index, case) in f.carets("tags").withIndex()) {
            val (text, carets) = case
            for ((position, caret) in carets.withIndex()) {
                total += 2
                val got = MdxCompletions.findTrigger(text, caret)?.let { trigger(it.start, it.query) } ?: JsonNull
                val want = f.expected("triggers")[index].jsonArray[position]
                if (got != want) different.add("trigger in ${shown(text)} at $caret: ours $got, desktop $want")
                val props = json(MdxProps.findTarget(text, caret))
                if (props != JsonNull) offered++
                val wantProps = f.expected("props")[index].jsonArray[position]
                if (props != wantProps) different.add("props in ${shown(text)} at $caret: ours $props, desktop $wantProps")
            }
        }
        assertTrue(offered > 60, "props offered at $offered carets")
        report("triggers and props at carets", total, different)
    }

    @Test
    @DisplayName("the frontmatter's missing properties are offered at every caret as the desktop offers them")
    fun frontmatter() {
        val f = load()
        val different = ArrayList<String>()
        var total = 0
        var offered = 0
        for ((index, case) in f.carets("fronts").withIndex()) {
            val (text, carets) = case
            for ((position, caret) in carets.withIndex()) {
                total++
                val got = json(FrontmatterCompletions.findTarget(text, caret))
                if (got != JsonNull) offered++
                val want = f.expected("fronts")[index].jsonArray[position]
                if (got != want) different.add("frontmatter in ${shown(text)} at $caret: ours $got, desktop $want")
            }
        }
        assertTrue(offered > 25, "properties offered at $offered carets")
        report("frontmatter carets", total, different)
    }

    @Test
    @DisplayName("what the list offers at the caret (components, props, frontmatter, snippets, in that order) is what the desktop's hook offers")
    fun combined() {
        val f = load()
        val texts = f.carets("tags") + f.carets("fronts") + f.carets("slashes")
        assertEquals(texts.size, f.expected("targets").size)
        val different = ArrayList<String>()
        var total = 0
        for ((index, case) in texts.withIndex()) {
            val (text, carets) = case
            for ((position, caret) in carets.withIndex()) {
                total++
                val got = json(MdxCompletions.target(text, caret))
                val want = f.expected("targets")[index].jsonArray[position]
                if (got != want) different.add("list for ${shown(text)} at $caret: ours $got, desktop $want")
            }
        }
        report("completion lists", total, different)
    }

    @Test
    @DisplayName("snippets after a slash are found at every caret as the desktop finds them")
    fun slashes() {
        val f = load()
        val different = ArrayList<String>()
        var total = 0
        for ((index, case) in f.carets("slashes").withIndex()) {
            val (text, carets) = case
            for ((position, caret) in carets.withIndex()) {
                total++
                val got = json(MarkdownSnippets.findTarget(text, caret))
                val want = f.expected("slashes")[index].jsonArray[position]
                if (got != want) different.add("snippets in ${shown(text)} at $caret: ours $got, desktop $want")
            }
        }
        report("slash carets", total, different)
    }

    @Test
    @DisplayName("indenting and outdenting make the edit and the selection indentLines.ts makes, or none")
    fun indenting() {
        val f = load()
        assertEquals(f.cases("indents").size, f.expected("indents").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("indents").withIndex()) {
            val item = element.jsonObject
            val text = item.getValue("text").jsonPrimitive.content
            val from = item.getValue("from").jsonPrimitive.int
            val to = item.getValue("to").jsonPrimitive.int
            val command = item.getValue("command").jsonPrimitive.content
            val got = json(IndentLines.edit(text, from, to, IndentLines.Command.of(command)!!))
            val want = f.expected("indents")[index]
            if (got != want) different.add("$command ${shown(text)} from $from to $to: ours $got, desktop $want")
        }
        report("indents", f.cases("indents").size, different)
    }

    @Test
    @DisplayName("bold and italic make the edit and the selection toggleEmphasis makes, or none")
    fun emphasis() {
        val f = load()
        assertEquals(f.cases("emphasis").size, f.expected("emphasis").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("emphasis").withIndex()) {
            val item = element.jsonObject
            val text = item.getValue("text").jsonPrimitive.content
            val from = item.getValue("from").jsonPrimitive.int
            val to = item.getValue("to").jsonPrimitive.int
            val kind = item.getValue("emphasis").jsonPrimitive.content
            val got = json(EmphasisToggle.toggle(text, from, to, EmphasisToggle.of(kind)!!))
            val want = f.expected("emphasis")[index]
            if (got != want) different.add("$kind ${shown(text)} from $from to $to: ours $got, desktop $want")
        }
        report("emphasis toggles", f.cases("emphasis").size, different)
    }

    @Test
    @DisplayName("note links: the [[ trigger, the notes offered, the escaped link and the id read back all match noteLinks.ts and noteRefs.ts")
    fun noteLinks() {
        val f = load()
        val different = ArrayList<String>()
        var total = 0
        for ((index, case) in f.carets("noteTriggers").withIndex()) {
            val (text, carets) = case
            for ((position, caret) in carets.withIndex()) {
                total++
                val got = NoteLinks.findTrigger(text, caret)?.let { trigger(it.start, it.query) } ?: JsonNull
                val want = f.expected("noteTriggers")[index].jsonArray[position]
                if (got != want) different.add("[[ in ${shown(text)} at $caret: ours $got, desktop $want")
            }
        }
        for ((index, element) in f.cases("noteMatches").withIndex()) {
            total++
            val item = element.jsonObject
            val notes = item.getValue("notes").jsonArray.map {
                NoteLinks.Candidate(it.jsonObject.getValue("id").jsonPrimitive.long, it.jsonObject.getValue("title").jsonPrimitive.content)
            }
            val query = item.getValue("query").jsonPrimitive.content
            val excluding = (item["excludeId"] as? JsonPrimitive)?.takeIf { it != JsonNull }?.long
            val got = NoteLinks.match(notes, query, excluding).map { it.id }
            val want = f.expected("noteMatches")[index].jsonArray.map { it.jsonPrimitive.long }
            if (got != want) different.add("notes for ${shown(query)}: ours $got, desktop $want")
        }
        for ((index, element) in f.cases("links").withIndex()) {
            total++
            val item = element.jsonObject
            val label = item.getValue("label").jsonPrimitive.content
            val got = NoteLinks.link(label, item.getValue("id").jsonPrimitive.long)
            val want = f.expected("links")[index].jsonPrimitive.content
            if (got != want) different.add("link ${shown(label)}: ours ${shown(got)}, desktop ${shown(want)}")
        }
        for ((index, element) in f.cases("linkTo").withIndex()) {
            total++
            val item = element.jsonObject
            val note = item.getValue("note").jsonObject
            val title = note.getValue("title").jsonPrimitive.content
            val label = (item["label"] as? JsonPrimitive)?.takeIf { it != JsonNull }?.content
            val got = NoteLinks.link(NoteLinks.Candidate(note.getValue("id").jsonPrimitive.long, title), label)
            val want = f.expected("linkTo")[index].jsonPrimitive.content
            if (got != want) different.add("link to ${shown(title)} as $label: ours ${shown(got)}, desktop ${shown(want)}")
        }
        for ((index, element) in f.cases("refs").withIndex()) {
            total++
            val href = element.jsonObject.getValue("href").jsonPrimitive.content
            val got = NoteLinks.id(href)
            val want = (f.expected("refs")[index] as? JsonPrimitive)?.takeIf { it != JsonNull }?.long
            if (got != want) different.add("ref ${shown(href)}: ours $got, desktop $want")
        }
        report("note-link cases", total, different)
    }
}
