package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.search.PdfTextPage
import com.rushinglabs.composition.core.search.SearchHit
import com.rushinglabs.composition.core.search.SearchIndex
import com.rushinglabs.composition.core.search.pdfTextState
import com.rushinglabs.composition.core.search.storePdfText
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

// How search finds words in a PDF's own text, against the desktop, ported from PdfTextSearchConformanceTests.swift:
// fixtures/conformance/pdf-text-search.json holds notes, the PDFs they own (their pages as the desktop indexes them) and what a real
// Meilisearch answered through the desktop's searchIndex.ts for each query (apps/web/src/lib/composition/pdfTextSearch.test.ts writes it).
// The FTS5 search must find the same notes, in the same order, at the same pages, so that a library searches the same everywhere.

@DisplayName("Searching a PDF's text against the desktop")
class PdfTextSearchConformanceTests {
    @Test
    @DisplayName("every query finds the notes the desktop found, in its order, at its pages")
    fun sameAnswers() {
        val corpus = corpusJson("pdf-text-search.json")
        withScratch { scratch ->
            openDatabase(scratch).use { database ->
                SearchIndex.open(File(scratch, "search.db")).use { index ->
                    val trashed = ArrayList<Long>()
                    for (note in corpus.entries("notes")) {
                        val id = note["id"]!!.integerValue!!
                        val updated = note["updatedAt"]!!.stringValue!!
                        database.file.write { db ->
                            db.execute(
                                "INSERT INTO notes (id, title, content, tags, description, created_at, updated_at, notebook_id) VALUES (?, ?, ?, ?, '', ?, ?, 1)",
                                id, note["title"]?.stringValue, note["content"]?.stringValue, note["tags"]?.stringValue, updated, updated,
                            )
                        }
                        if (note["trashed"] == JsonValue.Bool(true)) trashed.add(id)
                    }
                    index.rebuild(database)
                    index.remove(trashed)

                    for (pdf in corpus.entries("pdfs")) {
                        val pages = pdf["pages"]!!.arrayValue!!.mapNotNull { it.objectValue }.map { page ->
                            PdfTextPage(page["page"]!!.integerValue!!.toInt(), page["label"]?.stringValue, page["text"]!!.stringValue!!)
                        }
                        index.storePdfText(pdf["documentId"]!!.integerValue!!, pdf["noteId"]!!.integerValue!!, "x", pages)
                    }

                    val different = ArrayList<String>()
                    val states = corpus.entries("states")
                    for (state in states) {
                        val documentId = state["documentId"]!!.integerValue!!
                        val ours = index.pdfTextState(documentId)?.rawValue
                        val desktop = state["state"]?.stringValue
                        if (ours != desktop) different.add("document $documentId: ours $ours, desktop $desktop")
                    }

                    val results = corpus.entries("results")
                    assertTrue(results.size >= 40)
                    for (result in results) {
                        val query = result["query"]!!.stringValue!!
                        val expected = result["hits"]!!.arrayValue!!.mapNotNull { it.objectValue }.map {
                            SearchHit(it["id"]!!.integerValue!!, it["page"]?.integerValue?.toInt(), it["label"]?.stringValue)
                        }
                        val ours = index.searchHits(query)
                        if (ours != expected) different.add("${shownText(query)}: ours $ours, desktop $expected")
                    }

                    println("Searching a PDF's text: ${states.size + results.size - different.size} of ${states.size + results.size} states and queries agree with the desktop")
                    different.forEach { println("  $it") }
                    assertTrue(different.isEmpty(), "states and queries that differ: ${different.size}")
                }
            }
        }
    }
}
