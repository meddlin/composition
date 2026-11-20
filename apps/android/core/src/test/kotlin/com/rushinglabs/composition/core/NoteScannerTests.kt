package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.markdown.MdxElement
import com.rushinglabs.composition.core.markdown.MdxPropValue
import com.rushinglabs.composition.core.markdown.NoteBlock
import com.rushinglabs.composition.core.markdown.NoteHeading
import com.rushinglabs.composition.core.markdown.NoteScanner
import com.rushinglabs.composition.core.markdown.TextRange
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.commonmark.renderer.html.HtmlRenderer
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

// The restricted MDX layer's blocks, ported from NoteScannerTests.swift, and where each block is written, ported from the scanner half
// of BlockRangeTests.swift (the preview's located blocks wait for the preview model, which spike A2 decides).

@DisplayName("The restricted MDX layer: blocks")
class NoteScannerTests {
    private fun markdown(block: NoteBlock) = (block as? NoteBlock.Markdown)?.source

    @Test
    @DisplayName("a note that mentions no component is plain Markdown, scanned for nothing")
    fun plain() {
        val note = NoteScanner.scan("# T\n\nA stray < and { are fine here.\n")
        assertTrue(!note.isMdx && note.isValid && note.elements.isEmpty())
        assertEquals(listOf<NoteBlock>(NoteBlock.Markdown("# T\n\nA stray < and { are fine here.\n")), note.blocks)
        assertEquals(listOf(NoteHeading(1, "T")), note.headings)
    }

    @Test
    @DisplayName("a panel holds what is between its tags, and panels nest")
    fun panels() {
        val note = NoteScanner.scan("before\n\n<Info>\n\nouter\n\n<Warning>\n\ninner\n\n</Warning>\n\n</Info>\n\nafter\n")
        assertTrue(note.isValid)
        assertEquals(3, note.blocks.size)
        assertTrue(markdown(note.blocks[0])!!.contains("before") && markdown(note.blocks[2])!!.contains("after"))
        val info = note.blocks[1] as? NoteBlock.Element ?: fail("not an element")
        assertTrue(info.name == "Info" && info.children.size == 2)
        assertTrue(markdown(info.children[0])!!.contains("outer"))
        val warning = info.children[1] as? NoteBlock.Element ?: fail("no inner element")
        assertTrue(warning.name == "Warning" && markdown(warning.children[0])!!.contains("inner"))
    }

    @Test
    @DisplayName("a tag inside a line of text stays in the text, and a block tag with props is an element without children")
    fun inlineAndSelfClosing() {
        val marked = NoteScanner.scan("Staging resets <Mark color=\"green\">every night</Mark>.\n")
        assertEquals(listOf<NoteBlock>(NoteBlock.Markdown("Staging resets <Mark color=\"green\">every night</Mark>.\n")), marked.blocks)
        assertEquals(listOf(MdxElement("Mark", mapOf("color" to MdxPropValue.Text("green")), false, 0)), marked.elements)

        val image = NoteScanner.scan("<Image src=\"app_data/a.png\" alt=\"A &amp; B\" width=\"50%\" />\n")
        assertEquals(listOf<NoteBlock>(NoteBlock.Element("Image", mapOf("src" to MdxPropValue.Text("app_data/a.png"), "alt" to MdxPropValue.Text("A & B"), "width" to MdxPropValue.Text("50%")), emptyList())), image.blocks)
    }

    @Test
    @DisplayName("a chart keeps its CSV block as its child")
    fun chart() {
        val chart = NoteScanner.scan("<Chart type=\"bar\">\n\n```csv\na,b\n1,2\n```\n\n</Chart>\n").blocks.first() as? NoteBlock.Element ?: fail("no chart")
        assertTrue(chart.name == "Chart" && markdown(chart.children[0])!!.contains("a,b\n1,2"))
    }

    @Test
    @DisplayName("a note that is not valid MDX comes back whole, as Markdown, with the reason")
    fun invalid() {
        val body = "<Info>\n\nnever closed\n"
        val note = NoteScanner.scan(body)
        assertTrue(note.isMdx && !note.isValid && note.error != null)
        assertTrue(note.blocks == listOf<NoteBlock>(NoteBlock.Markdown(body)) && note.elements.isEmpty())
    }

    @Test
    @DisplayName("what code holds is not a tag, a brace or a footnote")
    fun code() {
        val note = NoteScanner.scan("```\n<Foo> {x} [^a]\n```\n\nUse `<Bar>` and `{y}` and `[^a]`.\n\n<Toc />\n")
        assertTrue(note.isValid && note.elements.map { it.name } == listOf("Toc") && note.footnotes.isEmpty())
    }

    @Test
    @DisplayName("footnotes are numbered by where they are cited, whatever they are called")
    fun footnotes() {
        val note = NoteScanner.scan("Second[^b] then first[^a], second again[^b], and none[^x].\n\n[^a]: A.\n[^b]: B.\n[^z]: never cited.\n\n<Footnotes />\n")
        assertEquals(listOf("b", "a"), note.footnotes)
    }

    @Test
    @DisplayName("character references in a prop are read")
    fun entities() {
        assertEquals("a & b <c> \"d\" A B &nope; &", NoteScanner.decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#65; &#x42; &nope; &"))
    }

    @Test
    @DisplayName("a definition leaves the Markdown for the list, its text is kept, and a note without components has footnotes too")
    fun footnoteText() {
        val note = NoteScanner.scan("Second[^b] then first[^a]. Code `[^a]` and none[^x].\n\n[^a]: First, with a [link](https://x.test).\n[^b]: Second\n    over two lines.\n\nEnd.\n")
        assertTrue(!note.isMdx && note.footnotes == listOf("b", "a"))
        assertEquals(mapOf("a" to "First, with a [link](https://x.test).", "b" to "Second\nover two lines."), note.footnoteBodies)
        val text = markdown(note.blocks[0]) ?: ""
        assertTrue(text.contains("Second[^b] then first[^a]."))
        assertTrue(text.contains("`[^a]`") && text.contains("none[^x]."))
        assertTrue(!text.contains("[^a]:") && text.contains("End."))
    }

    @Test
    @DisplayName("frontmatter is split from the body, and a block that is not a mapping is not frontmatter")
    fun frontmatter() {
        val note = "---\ntitle: A note\ntags:\n- x\n- y\n---\n# Body\n"
        assertEquals("title: A note\ntags:\n- x\n- y", NoteFrontmatter.split(note).first)
        assertEquals("# Body\n", NoteFrontmatter.split(note).second)
        assertNull(NoteFrontmatter.split("# No block\n").first)
        val notYaml = "---\njust some words\n---\nafter\n"
        assertTrue(NoteFrontmatter.split(notYaml).first == null && NoteFrontmatter.split(notYaml).second == notYaml)
        assertNull(NoteFrontmatter.split("---\n---\nafter").first)
    }
}

/**
 * Where each top-level block of a note is written: what the Live tab draws a block's picture in place of. Checked over every note of
 * `fixtures/conformance/mdx-notes.json` and the preview showcase, as the note itself and with a frontmatter and `\r\n` line ends: the
 * ranges cover the body (all but the footnotes' own text), never overlap, and the text in each is the block it says.
 */
@DisplayName("Where a note's blocks are written")
class BlockRangeTests {
    private val html = HtmlRenderer.builder().build()

    private fun corpus(): List<Pair<String, String>> {
        val directory = corpusDirectory ?: fail("fixtures/conformance is not found")
        val notes = readJson(File(directory, "mdx-notes.json")).jsonObject.getValue("notes").jsonArray.map {
            it.jsonObject.getValue("name").jsonPrimitive.content to it.jsonObject.getValue("body").jsonPrimitive.content
        }
        return notes + ("preview-showcase" to File(directory, "preview-showcase/note.md").readText())
    }

    /** NSString's `byLines`: lines end at `\r\n`, `\n`, `\r`, U+0085, U+2028 or U+2029. Each line as (start, end) in UTF-16 units. */
    private fun lines(text: String, from: Int): List<Pair<Int, Int>> {
        val result = ArrayList<Pair<Int, Int>>()
        var start = from
        var i = from
        while (i < text.length) {
            val c = text[i]
            if (c == '\n' || c == '\r' || c == '\u0085' || c == '\u2028' || c == '\u2029') {
                result.add(start to i)
                i += if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') 2 else 1
                start = i
            } else i++
        }
        if (start < text.length) result.add(start to text.length)
        return result
    }

    /** The lines no range covers that have something on them, other than a footnote's definition (and the lines that continue one). */
    private fun uncovered(text: String, ranges: List<TextRange>, start: Int): List<String> {
        val covered = BooleanArray(text.length)
        for (range in ranges) for (i in range.location until range.end) covered[i] = true
        val found = ArrayList<String>()
        var inDefinition = false
        for ((from, to) in lines(text, start)) {
            val words = text.substring(from, to)
            val trimmed = words.trim(' ', '\t')
            if (trimmed.isEmpty()) continue
            if (trimmed.startsWith("[^") && trimmed.contains("]:")) inDefinition = true
            else if (inDefinition && (words.startsWith("    ") || words.startsWith("\t"))) {}
            else if (!(from until to).all { covered[it] || text[it] == ' ' || text[it] == '\t' || text[it] == '\r' }) {
                inDefinition = false
                found.add(words)
            } else inDefinition = false
        }
        return found
    }

    private fun check(name: String, text: String, bodyStart: Int, problems: MutableList<String>) {
        val scanned = NoteScanner.scan(NoteFrontmatter.split(text).second, bodyStart)
        if (scanned.blockRanges.size != scanned.blocks.size) problems.add("$name: a range for each block")
        var end = bodyStart
        for (range in scanned.blockRanges) {
            if (range.location < end) problems.add("$name: $range overlaps the block before it, or starts before the body")
            if (range.end > text.length) problems.add("$name: $range runs past the note")
            end = range.end
        }
        uncovered(text, scanned.blockRanges, bodyStart).takeIf { it.isNotEmpty() }?.let { problems.add("$name: lines no block holds: $it") }
        for ((block, range) in scanned.blocks.zip(scanned.blockRanges)) {
            val written = text.substring(range.location, range.end).replace("\r\n", "\n")
            when (block) {
                is NoteBlock.Element -> {
                    if (!written.startsWith("<${block.name}")) problems.add("$name: \"${written.take(40)}\" is <${block.name}>")
                    val atLineStart = range.location == bodyStart || text[range.location - 1] == '\n'
                    if (scanned.isValid && atLineStart && NoteScanner.scan(written).blocks != listOf(block)) problems.add("$name: <${block.name}> scanned alone is the same element")
                }
                is NoteBlock.Markdown -> if (scanned.footnotes.isEmpty() && "[^" !in written) {
                    if (!(written == block.source.trim('\n', '\r') || block.source.contains(written))) problems.add("$name: the run's text is what is written there")
                    val parser = NoteScanner.markdownParser
                    if (html.render(parser.parse(written)) != html.render(parser.parse(block.source))) problems.add("$name: and parses the same")
                }
            }
        }
    }

    @Test
    @DisplayName("every corpus note: ranges cover the body, in order, never overlapping, each holding its block")
    fun corpusNotes() {
        val problems = ArrayList<String>()
        for ((name, text) in corpus()) {
            val body = NoteFrontmatter.split(text).second
            check(name, text, text.length - body.length, problems)
        }
        problems.take(20).forEach(::println)
        assertTrue(problems.isEmpty(), "${problems.size} problems")
    }

    @Test
    @DisplayName("the same with a frontmatter put in front and every line ended by \\r\\n")
    fun shifted() {
        val problems = ArrayList<String>()
        for ((name, body) in corpus().take(60)) {
            val withFront = if (body.startsWith("---\n")) body else "---\ntitle: T é😀\n---\n$body"
            check("$name (frontmatter)", withFront, withFront.length - NoteFrontmatter.split(withFront).second.length, problems)
            val crlf = withFront.replace("\n", "\r\n")
            check("$name (crlf)", crlf, crlf.length - NoteFrontmatter.split(crlf).second.length, problems)
        }
        problems.take(20).forEach(::println)
        assertTrue(problems.isEmpty(), "${problems.size} problems")
        assertNotNull(corpusDirectory)
    }
}
