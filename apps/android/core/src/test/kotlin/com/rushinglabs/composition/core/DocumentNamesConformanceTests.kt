package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.pdf.DocumentNames
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertTrue

// The names and checks around a PDF's file against the desktop's own `attachmentNames.ts` and `documentNames.ts`, run over the inputs in
// apps/ios/scripts/document-names-oracle.mjs, ported from DocumentNamesConformanceTests.swift. The result is committed
// (fixtures/conformance/document-names.json); `apps/ios/scripts/conformance.sh` checks that it is what the desktop makes now.

@DisplayName("PDF file names against the desktop")
class DocumentNamesConformanceTests {
    private val corpus by lazy { corpusJson("document-names.json") }

    private fun report(what: String, total: Int, different: List<String>) {
        println("PDF file names, $what: ${total - different.size} of $total agree with the desktop")
        different.take(40).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "$what that differ: ${different.size}")
    }

    @Test
    @DisplayName("a PDF is stored under the name the desktop gives it")
    fun storedNames() {
        val prefix = corpus.objectValue!!["prefix"]!!.stringValue!!
        val all = corpus.entries("storedNames")
        assertTrue(all.size >= 40)
        val different = ArrayList<String>()
        for (entry in all) {
            val fileName = entry["fileName"]!!.stringValue!!
            val stored = entry["stored"]!!.stringValue!!
            val ours = DocumentNames.storedName(prefix, fileName)
            if (ours != stored) different.add("${shownText(fileName)}: ours ${shownText(ours)}, desktop ${shownText(stored)}")
        }
        report("stored names", all.size, different)
    }

    @Test
    @DisplayName("the name shown for a path, and the title of the note made for it, are the desktop's")
    fun shownNames() {
        val paths = corpus.entries("displayNames")
        val titles = corpus.entries("titles")
        assertTrue(paths.size >= 8 && titles.size >= 20)
        val different = ArrayList<String>()
        for (entry in paths) {
            val path = entry["path"]!!.stringValue!!
            val shown = entry["shown"]!!.stringValue!!
            val ours = DocumentNames.displayName(path)
            if (ours != shown) different.add("shown ${shownText(path)}: ours ${shownText(ours)}, desktop ${shownText(shown)}")
        }
        for (entry in titles) {
            val path = entry["path"]!!.stringValue!!
            val title = entry["title"]!!.stringValue!!
            val ours = DocumentNames.titleFromFileName(path)
            if (ours != title) different.add("title ${shownText(path)}: ours ${shownText(ours)}, desktop ${shownText(title)}")
        }
        report("shown names and titles", paths.size + titles.size, different)
    }

    @Test
    @DisplayName("a size in bytes is written in words as the desktop writes it")
    fun sizes() {
        val all = corpus.entries("sizes")
        assertTrue(all.size >= 25)
        val different = ArrayList<String>()
        for (entry in all) {
            val bytes = entry["bytes"]!!.doubleValue!!
            val shown = entry["shown"]!!.stringValue!!
            val ours = DocumentNames.formatBytes(bytes.toLong())
            if (ours != shown) different.add("$bytes: ours $ours, desktop $shown")
        }
        report("sizes", all.size, different)
    }

    @Test
    @DisplayName("bytes look like a PDF when the desktop says they do")
    fun headers() {
        val all = corpus.entries("heads")
        assertTrue(all.size >= 12)
        val different = ArrayList<String>()
        for (entry in all) {
            val name = entry["name"]!!.stringValue!!
            val hex = entry["hex"]!!.stringValue!!
            val expected = entry["looksLikePdf"]!!
            val bytes = ByteArray(hex.length / 2) { (hex.substring(it * 2, it * 2 + 2).toIntOrNull(16) ?: 0).toByte() }
            val ours = JsonValue.Bool(DocumentNames.looksLikePdf(bytes))
            if (ours != expected) different.add("$name: ours ${ours.serialized()}, desktop ${expected.serialized()}")
        }
        report("file heads", all.size, different)
    }
}
