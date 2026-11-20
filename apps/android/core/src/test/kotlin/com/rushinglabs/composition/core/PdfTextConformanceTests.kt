package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.search.PdfSearchText
import com.rushinglabs.composition.core.search.PdfTextPage
import com.rushinglabs.composition.core.search.SearchIndex
import com.rushinglabs.composition.core.search.Typo
import com.rushinglabs.composition.core.search.storePdfText
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

// A PDF's own text in search, against the desktop, ported from PdfTextConformanceTests.swift: fixtures/conformance/pdf-text.json is what
// the desktop's `pdfText.ts` and pdf.js make of a list of page texts and of fixtures/conformance/pdf-text.pdf
// (apps/ios/scripts/pdf-text-oracle.mjs). It is committed; `apps/ios/scripts/conformance.sh` checks that it is what the desktop makes now.
// Neither test reads the PDF itself: the page texts are pdf.js's, so this needs no text reader on Android. (Whether an Android text
// reader finds the same words in pdf-text.pdf is the app's test, as PdfTextExtractionTests is the iPad's.)

@DisplayName("A PDF's text against the desktop")
class PdfTextConformanceTests {
    private val corpus by lazy { corpusJson("pdf-text.json") }

    @Test
    @DisplayName("a page's text is made what the desktop makes it, exactly")
    fun cases() {
        val all = corpus.entries("cases")
        assertTrue(all.size >= 50)
        val different = ArrayList<String>()
        for (entry in all) {
            val input = entry["input"]!!.stringValue!!
            val output = entry["output"]!!.stringValue!!
            val ours = PdfSearchText.pageSearchText(input)
            if (ours != output) different.add("${shownText(input)}: ours ${shownText(ours)}, desktop ${shownText(output)}")
        }
        println("A PDF's text, pages made searchable: ${all.size - different.size} of ${all.size} agree with the desktop")
        different.forEach { println("  $it") }
        assertTrue(different.isEmpty(), "page texts that differ: ${different.size}")
    }

    @Test
    @DisplayName("every word the desktop reads on a page of the fixture finds the PDF's note, at the first page that has it")
    fun everyWordFinds() {
        val pages = corpus.entries("pages")
        assertTrue(pages.size == 8)
        withScratch { scratch ->
            openDatabase(scratch).use { database ->
                SearchIndex.open(File(scratch, "search.db")).use { index ->
                    val note = NoteStore(database).createNote("Fixture")
                    index.rebuild(database)
                    val texts = pages.map { PdfTextPage(it["page"]!!.integerValue!!.toInt(), text = it["text"]!!.stringValue!!) }
                    index.storePdfText(1, note.id, "f", texts)

                    val firstPage = LinkedHashMap<String, Int>()
                    for (entry in pages) {
                        val page = entry["page"]!!.integerValue!!.toInt()
                        for (word in entry["words"]!!.arrayValue!!.mapNotNull { it.stringValue }) firstPage.putIfAbsent(word, page)
                    }
                    assertTrue(firstPage.size > 60)
                    // Words the note's own title or text has are found there first, without a page.
                    val own = Typo.words(note.title + "\n" + note.content).toSet()
                    val different = ArrayList<String>()
                    var checked = 0
                    for ((word, page) in firstPage) {
                        if (word in own) continue
                        checked += 1
                        val hits = index.searchHits("\"$word\"")
                        if (hits.map { it.noteId } != listOf(note.id)) different.add("$word: found ${hits.map { it.noteId }}")
                        else if (hits.first().pdfPage != page) different.add("$word: first on page ${hits.first().pdfPage} here, $page on the desktop")
                    }
                    println("A PDF's text, words of the fixture found at their first page: ${checked - different.size} of $checked agree with the desktop")
                    different.forEach { println("  $it") }
                    assertTrue(different.isEmpty(), "words that differ: ${different.size}")
                }
            }
        }
    }
}
