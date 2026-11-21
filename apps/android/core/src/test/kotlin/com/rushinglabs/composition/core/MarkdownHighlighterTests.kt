package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.preview.HighlightKind
import com.rushinglabs.composition.core.preview.HighlightSpan
import com.rushinglabs.composition.core.preview.MarkdownHighlighter
import org.junit.jupiter.api.DisplayName
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The editor's syntax colours, ported from MarkdownHighlighterTests.swift (with its HighlighterCRLFTests). The spans are written as the
// Swift writes them, `kind: "text"`, so the expectations read the same in both.

/** A kind as Swift prints it: `heading(level: 2)`, `inlineCode`. */
internal fun describe(kind: HighlightKind): String = when (kind) {
    is HighlightKind.Heading -> "heading(level: ${kind.level})"
    else -> kind.toString().replaceFirstChar { it.lowercase() }
}

/** Swift's `String(reflecting:)` of a string: quoted, with its backslashes, quotes and line breaks escaped. */
internal fun reflecting(text: String): String = buildString {
    append('"')
    for (c in text) when (c) {
        '\\' -> append("\\\\")
        '"' -> append("\\\"")
        '\n' -> append("\\n")
        '\r' -> append("\\r")
        '\t' -> append("\\t")
        else -> append(c)
    }
    append('"')
}

@DisplayName("The editor's syntax colours")
class MarkdownHighlighterTests {
    /** `kind: text` for each span, the text being what the span's range covers. */
    private fun found(text: String): List<String> =
        MarkdownHighlighter.spans(text).map { "${describe(it.kind)}: ${reflecting(text.substring(it.range.location, it.range.end))}" }

    @Test
    @DisplayName("a heading, its emphasis and the marks around them")
    fun heading() {
        val spans = found("## Title *em*\n")
        assertTrue("heading(level: 2): \"## Title *em*\"" in spans, "$spans")
        assertTrue("emphasis: \"*em*\"" in spans)
        assertTrue("mark: \"## \"" in spans)
        assertEquals(2, spans.count { it == "mark: \"*\"" })
    }

    @Test
    @DisplayName("bold, strikethrough and code, with the backticks as marks")
    fun inline() {
        val spans = found("a **bold** ~~gone~~ `x` and ``y ` z``\n")
        assertTrue("strong: \"**bold**\"" in spans && spans.count { it == "mark: \"**\"" } == 2, "$spans")
        assertTrue("strikethrough: \"~~gone~~\"" in spans && spans.count { it == "mark: \"~~\"" } == 2)
        assertTrue("inlineCode: \"`x`\"" in spans && "inlineCode: \"``y ` z``\"" in spans)
        assertEquals(2, spans.count { it == "mark: \"``\"" })
    }

    @Test
    @DisplayName("a fenced block, its fences, a link, a quote and the list markers")
    fun blocks() {
        val code = found("```swift\nlet x = 1\n```\n")
        assertTrue("codeBlock: \"```swift\\nlet x = 1\\n```\"" in code || "codeBlock: \"```swift\\nlet x = 1\\n```\\n\"" in code, "$code")
        assertTrue("mark: \"```swift\"" in code && "mark: \"```\"" in code)

        val link = found("see [text](https://x.test) now\n")
        assertTrue("linkText: \"text\"" in link && "mark: \"[\"" in link && "mark: \"](https://x.test)\"" in link, "$link")

        val quote = found("> a\n> b\n")
        assertTrue(quote.count { it == "mark: \">\"" } == 2 && quote.any { it.startsWith("quote:") }, "$quote")

        val list = found("- one\n1. two\n- [x] done\n")
        assertTrue(list.count { it == "listMarker: \"-\"" } == 2 && "listMarker: \"1.\"" in list && "listMarker: \"[x]\"" in list, "$list")
    }

    @Test
    @DisplayName("component tags, in a line of text or on lines of their own")
    fun tags() {
        val block = found("<Info>\n\nx\n\n</Info>\n")
        assertTrue("tag: \"<Info>\"" in block && "tag: \"</Info>\"" in block, "$block")
        val inline = found("a <Mark color=\"green\">b</Mark> c\n")
        assertTrue("tag: \"<Mark color=\\\"green\\\">\"" in inline && "tag: \"</Mark>\"" in inline, "$inline")
    }

    @Test
    @DisplayName("frontmatter is its own span and is not read as Markdown")
    fun frontmatter() {
        val spans = found("---\ntitle: A\ntags:\n- x\n---\n# H\n")
        assertEquals("frontmatter: \"---\\ntitle: A\\ntags:\\n- x\\n---\\n\"", spans.first())
        assertTrue("heading(level: 1): \"# H\"" in spans)
        assertTrue(spans.none { it.startsWith("listMarker") }, "the list in the frontmatter is not a list")
    }

    @Test
    @DisplayName("ranges are UTF-16 offsets, also after text that is two, three and four bytes long")
    fun unicode() {
        val spans = found("é 日本 😀 **b** and `c`\n")
        assertTrue("strong: \"**b**\"" in spans && "inlineCode: \"`c`\"" in spans, "$spans")
    }

    @Test
    @DisplayName("a 5,000-line note is read in a time to report (and never slow enough to be a problem)")
    fun large() {
        val lines = mutableListOf("---", "title: Big", "---", "# Big note", "")
        for (i in 0 until 1_000) {
            lines += listOf("## Section $i", "", "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/$i) with é and 😀.", "", "- item one", "- item two", "")
        }
        val text = lines.joinToString("\n")
        val lineCount = text.split("\n").size
        assertTrue(lineCount > 7_000)
        MarkdownHighlighter.spans(text)  // warm: the first read also loads the parser's classes
        val started = System.nanoTime()
        val spans: List<HighlightSpan> = MarkdownHighlighter.spans(text)
        val ms = (System.nanoTime() - started) / 1_000_000.0
        println("Timings: S3 highlighter: ${text.length} UTF-16 units, $lineCount lines, ${spans.size} spans in ${String.format(Locale.ROOT, "%.1f", ms)} ms")
        assertTrue(spans.size > 10_000)
        assertTrue(ms < 5_000)
    }
}

@DisplayName("The highlighter and a note with Windows line breaks")
class HighlighterCRLFTests {
    @Test
    @DisplayName("frontmatter with \\r\\n line breaks does not move the spans that follow it")
    fun frontmatterWithCRLF() {
        val body = "# Title\r\n\r\nSome **bold** text.\r\n"
        val unix = "---\ntitle: A\ntags:\n- x\n---\n" + "# Title\n\nSome **bold** text.\n"
        val windows = "---\r\ntitle: A\r\ntags:\r\n- x\r\n---\r\n" + body
        fun texts(text: String) =
            MarkdownHighlighter.spans(text).filter { it.kind != HighlightKind.Frontmatter }.map { text.substring(it.range.location, it.range.end) }
        // The same spans over the same words, whichever line breaks the note has.
        assertEquals(texts(unix), texts(windows).map { it.replace("\r\n", "\n") })
    }
}
