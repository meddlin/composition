package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.pdf.PdfCitation
import com.rushinglabs.composition.core.pdf.PdfNoteText
import com.rushinglabs.composition.core.pdf.PdfRef
import com.rushinglabs.composition.core.pdf.PdfRefs
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The `pdf:` links of a note against the desktop's own `pdfRefs.ts`, run over the inputs in apps/ios/scripts/pdf-refs-oracle.mjs, ported
// from PdfRefsConformanceTests.swift. The result is committed (fixtures/conformance/pdf-refs.json); `apps/ios/scripts/conformance.sh`
// checks that it is what the desktop makes now.

@DisplayName("PDF links against the desktop")
class PdfRefsConformanceTests {
    private val corpus by lazy { corpusJson("pdf-refs.json") }

    /** `null` or a number from the file, as the optional the Kotlin side takes. */
    private fun optionalInt(value: JsonValue?): Int? = value?.integerValue?.toInt()

    private fun optionalString(value: JsonValue?): String? = value?.stringValue

    private fun labels(value: JsonValue?): List<String>? = value?.arrayValue?.mapNotNull { it.stringValue }

    private fun report(what: String, total: Int, different: List<String>) {
        println("PDF links, $what: ${total - different.size} of $total agree with the desktop")
        different.take(40).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "$what that differ: ${different.size}")
    }

    @Test
    @DisplayName("a target is written as the desktop writes it")
    fun writtenTargets() {
        val all = corpus.entries("refs")
        assertTrue(all.size >= 8)
        val different = ArrayList<String>()
        for (entry in all) {
            val uuid = entry["uuid"]!!.stringValue!!
            val expected = entry["ref"]!!.stringValue!!
            val ours = PdfRefs.ref(uuid, optionalInt(entry["page"]), optionalString(entry["mark"]))
            if (ours != expected) different.add("ours $ours, desktop $expected")
        }
        report("targets written", all.size, different)
    }

    @Test
    @DisplayName("a target is read as the desktop reads it, and what it drops it drops too")
    fun readTargets() {
        val all = corpus.entries("parsed")
        assertTrue(all.size >= 45)
        val different = ArrayList<String>()
        for (entry in all) {
            val href = entry["href"]!!.stringValue!!
            val parsed = PdfRefs.parse(href)
            val ref = entry["ref"]!!
            val wanted = if (ref == JsonValue.Null) null else {
                val expected = ref.objectValue!!
                PdfRef(expected["uuid"]!!.stringValue!!, optionalInt(expected["page"]), optionalString(expected["mark"]))
            }
            if (parsed != wanted) different.add("${shownText(href)}: ours $parsed, desktop $wanted")
        }
        report("targets read", all.size, different)
    }

    @Test
    @DisplayName("text from a PDF is made literal as the desktop makes it")
    fun escaping() {
        val all = corpus.entries("escaped")
        assertTrue(all.size >= 50)
        val different = ArrayList<String>()
        for (entry in all) {
            val raw = entry["text"]!!.stringValue!!
            val escaped = entry["escaped"]!!.stringValue!!
            val ours = PdfRefs.escapeMarkdown(raw)
            if (ours != escaped) different.add("${shownText(raw)}: ours ${shownText(ours)}, desktop ${shownText(escaped)}")
        }
        report("escaped texts", all.size, different)
    }

    @Test
    @DisplayName("a page is named by its printed label when the PDF has one")
    fun pageLabels() {
        val all = corpus.entries("pageLabels")
        assertTrue(all.size >= 30)
        val different = ArrayList<String>()
        for (entry in all) {
            val page = entry["page"]!!.integerValue!!.toInt()
            val expected = entry["label"]!!.stringValue!!
            val ours = PdfRefs.pageLabel(page, labels(entry["labels"]))
            if (ours != expected) different.add("page $page, ${entry["labels"]?.serialized()}: ours ${shownText(ours)}, desktop ${shownText(expected)}")
        }
        report("page labels", all.size, different)
    }

    @Test
    @DisplayName("a link to a PDF, a page citation and a quote block read as the desktop writes them")
    fun writtenCitations() {
        val different = ArrayList<String>()
        val links = corpus.entries("links")
        for (entry in links) {
            val uuid = entry["uuid"]!!.stringValue!!
            val title = entry["title"]!!.stringValue!!
            val ours = PdfRefs.link(uuid, title)
            val expected = entry["link"]!!.stringValue!!
            if (ours != expected) different.add("link ${shownText(title)}: ours ${shownText(ours)}, desktop ${shownText(expected)}")
        }
        val citations = corpus.entries("pageCitations")
        assertTrue(citations.size >= 60)
        for (entry in citations) {
            val uuid = entry["uuid"]!!.stringValue!!
            val title = entry["title"]!!.stringValue!!
            val page = entry["page"]!!.integerValue!!.toInt()
            val ours = PdfRefs.pageCitation(uuid, title, page, labels(entry["labels"]))
            val expected = entry["citation"]!!.stringValue!!
            if (ours != expected) different.add("citation ${shownText(title)} p. $page: ours ${shownText(ours)}, desktop ${shownText(expected)}")
        }
        val blocks = corpus.entries("quoteBlocks")
        assertTrue(blocks.size >= 300)
        for (entry in blocks) {
            val uuid = entry["uuid"]!!.stringValue!!
            val title = entry["title"]!!.stringValue!!
            val quote = entry["quote"]!!.stringValue!!
            val page = entry["page"]!!.integerValue!!.toInt()
            val ours = PdfRefs.quoteBlock(uuid, title, quote, page, optionalString(entry["mark"]), labels(entry["labels"]))
            val expected = entry["block"]!!.stringValue!!
            if (ours != expected) different.add("quote ${shownText(title)} / ${shownText(quote)}: ours ${shownText(ours)}, desktop ${shownText(expected)}")
        }
        report("links, citations and quote blocks", links.size + citations.size + blocks.size, different)
    }

    @Test
    @DisplayName("the pages and marks a note's text cites are the ones the desktop finds")
    fun citedPagesAndMarks() {
        val all = corpus.entries("cited")
        assertTrue(all.size >= 30)
        val different = ArrayList<String>()
        for (entry in all) {
            val text = entry["text"]!!.stringValue!!
            val uuid = entry["uuid"]!!.stringValue!!
            val cites = entry["cites"] == JsonValue.Bool(true)
            if (PdfRefs.cites(text, uuid) != cites) different.add("${shownText(text)} cites $uuid: ours ${!cites}, desktop $cites")
            val expected = entry["citations"]!!.objectValue!!
            val found = PdfRefs.citations(text, uuid)
            val pages = (expected["pages"]?.arrayValue ?: emptyList()).mapNotNull { it.integerValue?.toInt() }
            val marks = (expected["marks"]?.arrayValue ?: emptyList()).mapNotNull { it.stringValue }
            if (found.pages != pages) different.add("pages of ${shownText(text)} for $uuid: ours ${found.pages}, desktop $pages")
            if (found.marks != marks) different.add("marks of ${shownText(text)} for $uuid: ours ${found.marks}, desktop $marks")
        }
        report("cited pages and marks", all.size, different)
    }

    @Test
    @DisplayName("the notes that belong with a PDF are the desktop's, in its order")
    fun notesThatCite() {
        val notes = corpus.entries("notes").map { entry ->
            PdfNoteText(entry["id"]!!.integerValue!!, entry["title"]!!.stringValue!!, entry["content"]!!.stringValue!!, entry["updatedAt"]!!.stringValue!!)
        }
        val all = corpus.entries("citationsFor")
        assertEquals(5, all.size)
        val different = ArrayList<String>()
        for (entry in all) {
            val uuid = entry["uuid"]!!.stringValue!!
            val owner = entry["ownerNoteId"]!!.integerValue!!
            val expected = entry["citations"]!!.arrayValue!!.mapNotNull { it.objectValue }.map { found ->
                PdfCitation(
                    found["noteId"]?.integerValue ?: -1, found["title"]?.stringValue ?: "", found["owner"] == JsonValue.Bool(true),
                    (found["pages"]?.arrayValue ?: emptyList()).mapNotNull { it.integerValue?.toInt() },
                    (found["marks"]?.arrayValue ?: emptyList()).mapNotNull { it.stringValue },
                )
            }
            val ours = PdfRefs.citations(notes, uuid, owner)
            if (ours != expected) different.add("$uuid owned by note $owner: ours $ours, desktop $expected")
        }
        report("notes that cite a PDF", all.size, different)
    }
}
