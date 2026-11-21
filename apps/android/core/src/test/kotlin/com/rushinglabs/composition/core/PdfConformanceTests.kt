package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.json.JsonMember
import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.pdf.DocumentException
import com.rushinglabs.composition.core.pdf.InvalidMarkException
import com.rushinglabs.composition.core.pdf.PdfBookmark
import com.rushinglabs.composition.core.pdf.PdfMark
import com.rushinglabs.composition.core.pdf.PdfMarkChanges
import com.rushinglabs.composition.core.pdf.PdfMarkInput
import com.rushinglabs.composition.core.pdf.PdfMarkKind
import com.rushinglabs.composition.core.pdf.PdfMarkup
import com.rushinglabs.composition.core.pdf.PdfRect
import com.rushinglabs.composition.core.pdf.PdfViewState
import com.rushinglabs.composition.core.pdf.StoredDocument
import com.rushinglabs.composition.core.pdf.ValidPdfMark
import com.rushinglabs.composition.core.pdf.addAnnotation
import com.rushinglabs.composition.core.pdf.addAnnotationGroup
import com.rushinglabs.composition.core.pdf.addBookmark
import com.rushinglabs.composition.core.pdf.addDocument
import com.rushinglabs.composition.core.pdf.deleteAnnotation
import com.rushinglabs.composition.core.pdf.deleteBookmark
import com.rushinglabs.composition.core.pdf.deleteDocument
import com.rushinglabs.composition.core.pdf.deleteOrphanedDocuments
import com.rushinglabs.composition.core.pdf.renameBookmark
import com.rushinglabs.composition.core.pdf.setPageCount
import com.rushinglabs.composition.core.pdf.setViewState
import com.rushinglabs.composition.core.pdf.updateAnnotation
import com.rushinglabs.composition.core.yaml.JavaScriptText
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The PDF tables against the shared corpus in fixtures/conformance/pdf (fixtures/conformance/README.md), ported from
// PdfConformanceTests.swift. The TypeScript wrote these files from its own code (`pdfConformance.test.ts` regenerates schema.json and
// scripts.json, `pdfMarkup.test.ts` reads validation.json) and the Kotlin core replays them:
//
//   schema.json      the columns, indexes and uuid triggers of the three tables, compared with a database made here
//   validation.json  what makes a mark, a bookmark label and a reading position valid, and what each is stored as
//   scripts.json     operation scripts replayed step by step against a fresh database, each step's result and the final rows compared
//
// Unlike most conformance files these are committed, so they need no COMPOSITION_CONFORMANCE_DIR.

/**
 * Where Kotlin's types turn the corpus's JSON away before it reaches the API: a page of 1.5, a kind that is not one of five, a quote that
 * is a number or a rectangle of three numbers cannot be written down in `PdfMarkInput`, which is the refusal the desktop makes at run
 * time. The test counts these, so what the types carry is in plain sight.
 */
private class RefusedByType(val what: String) : Exception(what)

private operator fun JsonValue.get(key: String): JsonValue? = objectValue?.get(key)

private fun JsonValue?.present(what: String): JsonValue = this ?: throw RefusedByType("$what is missing")

private fun <T> JsonValue.required(what: String, read: (JsonValue) -> T?): T = read(this) ?: throw RefusedByType(what)

/** A whole number that also fits Kotlin's `Int` (a page, a page count): Swift's `Int` is 64 bits, so this is a refusal only here. */
private fun JsonValue.int(what: String): Int {
    val value = required(what) { it.integerValue }
    if (value !in Int.MIN_VALUE..Int.MAX_VALUE) throw RefusedByType("$what that fits a 32-bit Int")
    return value.toInt()
}

/** A string the key does not have (null), has as text, or has as something else (refused). */
private fun optionalText(value: JsonValue?, what: String): String? = value?.required(what) { it.stringValue }

/** The desktop's `changes.color ?? current.color`: a null is as good as nothing. */
private fun optionalNonNull(value: JsonValue?, what: String): String? = if (value == JsonValue.Null) null else optionalText(value, what)

private fun rectsOf(items: List<JsonValue>): List<PdfRect> = items.map { item -> item.required("a rectangle of four numbers") { PdfRect.of(it) } }

private fun markInput(json: JsonValue): PdfMarkInput {
    val page = json["page"].present("page").int("a page that is a whole number")
    val kindName = json["kind"].present("kind").required("a kind that is text") { it.stringValue }
    val kind = PdfMarkKind.of(kindName) ?: throw RefusedByType("a kind that is one of five")
    val color = json["color"].present("color").required("a color that is text") { it.stringValue }

    val rects = when (val given = json["rects"]) {
        null, JsonValue.Null -> null
        is JsonValue.Array -> rectsOf(given.items)
        else -> throw RefusedByType("rectangles that are a list")
    }

    val groupUuid = when (val given = json["groupUuid"]) {
        null, JsonValue.Null -> null
        is JsonValue.Text -> given.value
        else -> throw RefusedByType("a group that is text")
    }

    return PdfMarkInput(
        page, kind, color, rects, optionalText(json["quote"], "a quote that is text") ?: "",
        optionalText(json["comment"], "a comment that is text") ?: "", json["body"], groupUuid,
    )
}

private fun markChanges(json: JsonValue): PdfMarkChanges {
    val rects = when (val given = json["rects"]) {
        null -> null
        JsonValue.Null -> PdfMarkChanges.NewRects(null)
        is JsonValue.Array -> PdfMarkChanges.NewRects(rectsOf(given.items))
        else -> throw RefusedByType("rectangles that are a list")
    }
    return PdfMarkChanges(
        optionalNonNull(json["color"], "a color that is text"), optionalNonNull(json["comment"], "a comment that is text"),
        optionalNonNull(json["quote"], "a quote that is text"), rects, json["body"],
    )
}

/** Where two values first differ, as a path and both sides, or null if they are equal as JSON. */
private fun difference(kotlin: JsonValue, corpus: JsonValue, path: String = ""): String? {
    if (kotlin is JsonValue.Object && corpus is JsonValue.Object) {
        for (key in (kotlin.members.map { it.key } + corpus.members.map { it.key }).toSortedSet()) {
            val x = kotlin[key]
            val y = corpus[key]
            if (x == null || y == null) return "$path.$key is on one side only"
            difference(x, y, "$path.$key")?.let { return it }
        }
        return null
    }
    if (kotlin is JsonValue.Array && corpus is JsonValue.Array) {
        if (kotlin.items.size != corpus.items.size) return "$path has ${kotlin.items.size} entries in Kotlin, ${corpus.items.size} in the corpus"
        for (index in kotlin.items.indices) difference(kotlin.items[index], corpus.items[index], "$path[$index]")?.let { return it }
        return null
    }
    return if (kotlin == corpus) null else "$path is ${kotlin.serialized()} in Kotlin, ${corpus.serialized()} in the corpus"
}

/** `{"$repeat": ["a", 501]}` stands for 501 letters `a`: JSON has no way to write a long string. */
private fun expandingRepeats(value: JsonValue): JsonValue = when (value) {
    is JsonValue.Array -> JsonValue.Array(value.items.map(::expandingRepeats))
    is JsonValue.Object -> {
        val parts = value.members.singleOrNull()?.takeIf { it.key == "\$repeat" }?.value?.arrayValue
        val unit = parts?.getOrNull(0)?.stringValue
        val times = parts?.getOrNull(1)?.integerValue
        if (parts != null && parts.size == 2 && unit != null && times != null) {
            JsonValue.Text(unit.repeat(times.toInt()))
        } else {
            JsonValue.Object(value.members.map { JsonMember(it.key, expandingRepeats(it.value)) })
        }
    }
    else -> value
}

private fun loadPdfCorpus(name: String): JsonValue = expandingRepeats(corpusJson("pdf/$name"))

/** The columns of the three tables that hold JSON, which the corpus compares as values, not as text. */
private val jsonColumns = setOf("rects", "body", "view_state")

private fun number(value: Long) = JsonValue.Number(value.toDouble())

private fun text(value: String?) = value?.let { JsonValue.Text(it) } ?: JsonValue.Null

@DisplayName("PDF tables against the shared corpus")
class PdfConformanceTests {
    private val tables = listOf("documents", "pdf_annotations", "pdf_bookmarks")

    // schema.json -------------------------------------------------------------------------------------------------------------------

    private fun collapsed(sql: String): String {
        val words = ArrayList<String>()
        val current = StringBuilder()
        for (c in sql) {
            if (JavaScriptText.isWhitespace(c.code)) {
                if (current.isNotEmpty()) words.add(current.toString())
                current.clear()
            } else current.append(c)
        }
        if (current.isNotEmpty()) words.add(current.toString())
        return words.joinToString(" ")
    }

    @Test
    @DisplayName("the three tables, their indexes and their uuid triggers are the desktop's")
    fun schema() {
        val expected = loadPdfCorpus("schema.json")
        withScratch { scratch ->
            openDatabase(scratch).use { database ->
                val actual = database.file.read { db ->
                    val columns = tables.map { table ->
                        JsonMember(table, JsonValue.Array(db.rows("PRAGMA table_info($table)").map { row ->
                            JsonValue.Object(
                                "name" to text(row.string("name")), "type" to text(row.string("type")), "notnull" to JsonValue.Bool(row.long("notnull") == 1L),
                                "default" to text(row.stringOrNull("dflt_value")), "primaryKey" to JsonValue.Bool(row.long("pk") == 1L),
                            )
                        }))
                    }
                    val objects = db.rows(
                        """
                        SELECT type, name, tbl_name, sql FROM sqlite_master
                        WHERE tbl_name IN (${tables.joinToString(", ") { "'$it'" }}) AND sql IS NOT NULL
                        ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name
                        """.trimIndent(),
                    ).map { row ->
                        JsonValue.Object(
                            "type" to text(row.string("type")), "name" to text(row.string("name")), "table" to text(row.string("tbl_name")),
                            "sql" to text(collapsed(row.string("sql"))),
                        )
                    }
                    JsonValue.Object("columns" to JsonValue.Object(columns), "objects" to JsonValue.Array(objects))
                }
                val objects = expected["objects"]?.arrayValue?.size
                assertEquals(13, objects, "the corpus has the three tables, seven indexes and three triggers")
                val columns = expected["columns"]?.objectValue?.members?.sumOf { it.value.arrayValue?.size ?: 0 } ?: 0
                val found = difference(actual, expected)
                if (found == null) println("PDF schema: $objects objects and $columns columns agree with the desktop") else println("PDF schema differs: $found")
                assertEquals(null, found, "the schema differs")
            }
        }
    }

    // validation.json ---------------------------------------------------------------------------------------------------------------

    private fun json(mark: ValidPdfMark) = JsonValue.Object(
        "page" to number(mark.page.toLong()), "kind" to text(mark.kind.rawValue), "color" to text(mark.color),
        "rects" to (mark.rects?.let { rects -> JsonValue.Array(rects.map { it.json }) } ?: JsonValue.Null), "quote" to text(mark.quote),
        "comment" to text(mark.comment), "body" to (mark.body ?: JsonValue.Null), "groupUuid" to text(mark.groupUuid),
    )

    @Test
    @DisplayName("every mark, bookmark label and reading position is kept as the desktop keeps it, or refused as it refuses it")
    fun validation() {
        val corpus = loadPdfCorpus("validation.json")
        var checked = 0
        val byType = ArrayList<String>()
        var byRule = 0
        val different = ArrayList<String>()

        for (entry in corpus["annotations"]!!.arrayValue!!) {
            val name = entry["name"]?.stringValue ?: "?"
            val invalid = entry["invalid"] == JsonValue.Bool(true)
            checked += 1
            try {
                val stored = json(PdfMarkup.validate(markInput(entry["input"].present("input"))))
                if (invalid) {
                    different.add("$name: kept, and the desktop refuses it")
                } else {
                    difference(stored, entry["stored"].present("stored"))?.let { different.add("$name: stored differently: $it") }
                }
            } catch (refusal: RefusedByType) {
                byType.add("$name (${refusal.what})")
                if (!invalid) different.add("$name: refused by Kotlin's types, and the desktop keeps it: ${refusal.what}")
            } catch (_: InvalidMarkException) {
                byRule += 1
                if (!invalid) different.add("$name: refused, and the desktop keeps it")
            }
        }

        for (entry in corpus["bookmarkLabels"]!!.arrayValue!!) {
            val invalid = entry["invalid"] == JsonValue.Bool(true)
            checked += 1
            try {
                val label = entry["input"].present("input").required("a label that is text") { it.stringValue }
                val stored = PdfMarkup.validateBookmarkLabel(label)
                if (invalid) {
                    different.add("a label of ${label.length} characters was kept, and the desktop refuses it")
                } else if (JsonValue.Text(stored) != entry["stored"]) {
                    different.add("a label of ${label.length} characters is stored as ${shownText(stored)}")
                }
            } catch (refusal: RefusedByType) {
                byType.add("a bookmark label (${refusal.what})")
                if (!invalid) different.add("a label was refused by Kotlin's types, and the desktop keeps it")
            } catch (_: InvalidMarkException) {
                byRule += 1
                if (!invalid) different.add("a label was refused, and the desktop keeps it")
            }
        }

        for (entry in corpus["viewStates"]!!.arrayValue!!) {
            checked += 1
            val stored = PdfViewState.normalizing(entry["input"].present("input")).json
            difference(stored, entry["stored"].present("stored"))?.let { different.add("a reading position ${entry["input"]?.serialized()}: $it") }
        }

        // a floor under what the corpus holds today, so that a file read as empty cannot pass for a replay
        assertTrue(checked >= 40 && byRule >= 20, "the corpus was read: $checked inputs, $byRule refused by the rules")
        println("PDF validation: $byRule refused by the rules, ${byType.size} by Kotlin's types: ${byType.joinToString("; ")}")
        println("PDF validation: ${checked - different.size} of $checked marks, bookmark labels and reading positions agree with the desktop")
        different.forEach { println("  $it") }
        assertTrue(different.isEmpty(), "inputs that differ: ${different.size}")
    }

    // scripts.json ------------------------------------------------------------------------------------------------------------------

    /** What the corpus's scripts leave out because no two runs share it: uuids, times, and group uuids (numbered by first use). */
    private class Normalizer {
        private val groups = HashMap<String, String>()

        operator fun invoke(value: JsonValue, key: String = ""): JsonValue = when (value) {
            is JsonValue.Array -> JsonValue.Array(value.items.map { invoke(it) })
            is JsonValue.Object -> JsonValue.Object(value.members.map { JsonMember(it.key, invoke(it.value, it.key)) })
            is JsonValue.Text -> {
                val text = value.value
                when (key) {
                    "uuid" -> JsonValue.Text(if (PdfMarkup.isHexUuid(text)) "<uuid>" else "NOT A UUID: $text")
                    "group_uuid", "groupUuid" ->
                        if (!PdfMarkup.isHexUuid(text)) JsonValue.Text("NOT A UUID: $text")
                        else JsonValue.Text(groups.getOrPut(text) { "<group-${groups.size + 1}>" })
                    "created_at", "createdAt", "updated_at", "updatedAt" ->
                        JsonValue.Text(if (Timestamp.milliseconds(text) != null) "<time>" else "NOT A TIME: $text")
                    else -> value
                }
            }
            else -> value
        }
    }

    private fun json(document: StoredDocument) = JsonValue.Object(
        "id" to number(document.id), "uuid" to text(document.uuid), "noteId" to number(document.noteId), "fileName" to text(document.fileName),
        "storedName" to text(document.storedName), "sha256" to text(document.sha256), "size" to number(document.size),
        "pageCount" to number(document.pageCount.toLong()), "viewState" to document.viewState.json, "createdAt" to text(document.createdAt),
    )

    private fun json(mark: PdfMark) = JsonValue.Object(
        "id" to number(mark.id), "uuid" to text(mark.uuid), "documentId" to number(mark.documentId), "page" to number(mark.page.toLong()),
        "kind" to text(mark.kind.rawValue), "color" to text(mark.color), "rects" to (mark.rects?.let { rects -> JsonValue.Array(rects.map { it.json }) } ?: JsonValue.Null),
        "quote" to text(mark.quote), "comment" to text(mark.comment), "body" to (mark.body ?: JsonValue.Null), "groupUuid" to text(mark.groupUuid),
        "createdAt" to text(mark.createdAt), "updatedAt" to text(mark.updatedAt),
    )

    private fun json(bookmark: PdfBookmark) = JsonValue.Object(
        "id" to number(bookmark.id), "uuid" to text(bookmark.uuid), "documentId" to number(bookmark.documentId), "page" to number(bookmark.page.toLong()),
        "label" to text(bookmark.label), "createdAt" to text(bookmark.createdAt),
    )

    private fun id(step: JsonValue, key: String): Long = step[key].present(key).required("$key that is a whole number") { it.integerValue }

    private fun stepText(step: JsonValue, key: String): String = step[key].present(key).required("$key that is text") { it.stringValue }

    /** Makes exactly these notes live and these in the Trash Can: the scripts need the notes' ids, not the notes. */
    private fun setNotes(step: JsonValue, database: CompositionDatabase) {
        val live = step["live"].present("live").required("a list") { it.arrayValue }.mapNotNull { it.integerValue }
        val trashed = step["trashed"].present("trashed").required("a list") { it.arrayValue }.mapNotNull { it.integerValue }
        database.file.write { db ->
            db.execute("DELETE FROM notes")
            db.execute("DELETE FROM trashed_notes")
            for (id in live) db.execute("INSERT INTO notes (id, title, created_at, updated_at) VALUES (?, ?, 'x', 'x')", id, "note $id")
            for (id in trashed) db.execute("INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at) VALUES (?, ?, 'x', 'x', 'x')", id, "note $id")
        }
    }

    /** One step against the database: what it returned, as the corpus writes it (`ok` and the value, or `error`). */
    private fun run(step: JsonValue, database: CompositionDatabase, unknown: MutableList<String>): JsonValue {
        fun ok(value: JsonValue) = JsonValue.Object("ok" to value)
        val op = stepText(step, "op")
        return try {
            when (op) {
                "setNotes" -> { setNotes(step, database); ok(JsonValue.Null) }
                "addDocument" -> {
                    val size = step["size"].present("size").required("a size") { it.integerValue }
                    val pages = step["pageCount"].present("pageCount").int("a page count")
                    ok(json(database.addDocument(id(step, "noteId"), stepText(step, "fileName"), stepText(step, "storedName"), stepText(step, "sha256"), size, pages)))
                }
                "setPageCount" -> {
                    database.setPageCount(id(step, "id"), step["pageCount"].present("pageCount").int("a page count"))
                    ok(JsonValue.Null)
                }
                "setViewState" -> {
                    database.setViewState(id(step, "id"), PdfViewState.normalizing(step["state"].present("state")))
                    ok(JsonValue.Null)
                }
                "deleteDocument" -> ok(database.deleteDocument(id(step, "id"))?.let(::json) ?: JsonValue.Null)
                "deleteOrphanedDocuments" -> ok(JsonValue.Array(database.deleteOrphanedDocuments().map(::json)))
                "addAnnotation" -> ok(json(database.addAnnotation(id(step, "documentId"), markInput(step["input"].present("input")))))
                "addAnnotationGroup" -> {
                    val inputs = step["inputs"].present("inputs").required("a list") { it.arrayValue }.map(::markInput)
                    ok(JsonValue.Array(database.addAnnotationGroup(id(step, "documentId"), inputs).map(::json)))
                }
                "updateAnnotation" -> {
                    val changes = markChanges(step["changes"].present("changes"))
                    ok(database.updateAnnotation(id(step, "id"), changes)?.let(::json) ?: JsonValue.Null)
                }
                "deleteAnnotation" -> ok(JsonValue.Array(database.deleteAnnotation(id(step, "id")).map(::json)))
                "addBookmark" -> {
                    val page = step["page"].present("page").int("a page that is a whole number")
                    val label = optionalText(step["label"], "a label that is text") ?: ""
                    ok(json(database.addBookmark(id(step, "documentId"), page, label)))
                }
                "renameBookmark" -> ok(database.renameBookmark(id(step, "id"), stepText(step, "label"))?.let(::json) ?: JsonValue.Null)
                "deleteBookmark" -> { database.deleteBookmark(id(step, "id")); ok(JsonValue.Null) }
                else -> {
                    unknown.add(op)
                    ok(JsonValue.Null)
                }
            }
        } catch (_: InvalidMarkException) {
            JsonValue.Object("error" to JsonValue.Bool(true))
        } catch (_: DocumentException) {
            JsonValue.Object("error" to JsonValue.Bool(true))
        } catch (_: RefusedByType) {
            JsonValue.Object("error" to JsonValue.Bool(true))
        }
    }

    private fun rowMembers(row: Row): List<JsonMember> = row.columns.map { (column, value) ->
        JsonMember(
            column,
            when (value) {
                null -> JsonValue.Null
                is Long -> number(value)
                is Double -> JsonValue.Number(value)
                is String -> if (column in jsonColumns) runCatching { JsonValue.parse(value) }.getOrElse { JsonValue.Text(value) } else JsonValue.Text(value)
                else -> JsonValue.Text("BLOB")
            },
        )
    }

    /** The rows of one table, as the corpus writes them: every column, with the three that hold JSON read as JSON, not as text. */
    private fun rows(table: String, database: CompositionDatabase): JsonValue =
        database.file.read { db -> JsonValue.Array(db.rows("SELECT * FROM $table ORDER BY id").map { JsonValue.Object(rowMembers(it)) }) }

    /** The three tables and the next id of each: a refused step must leave all of it as it was. */
    private fun state(database: CompositionDatabase): JsonValue {
        val sequence = database.file.read { db ->
            db.rows("SELECT name, seq FROM sqlite_sequence WHERE name IN ('documents', 'pdf_annotations', 'pdf_bookmarks') ORDER BY name").map { JsonValue.Object(rowMembers(it)) }
        }
        return JsonValue.Object(
            "documents" to rows("documents", database), "annotations" to rows("pdf_annotations", database),
            "bookmarks" to rows("pdf_bookmarks", database), "sqlite_sequence" to JsonValue.Array(sequence),
        )
    }

    @Test
    @DisplayName("every script leaves the same results and the same rows as the desktop's repositories, and a refused step changes nothing")
    fun scriptsMatchDesktop() {
        val scripts = loadPdfCorpus("scripts.json")["scripts"]!!.arrayValue!!
        var steps = 0
        var refusals = 0
        val different = ArrayList<String>()
        val unknown = ArrayList<String>()

        for (script in scripts) {
            val name = script["name"]?.stringValue ?: "?"
            val expected = script["expect"] ?: error("$name: the corpus has no expected result, regenerate it (UPDATE_FIXTURES=1)")
            val scriptSteps = script["steps"]!!.arrayValue!!
            val expectedSteps = expected["steps"]!!.arrayValue!!
            assertEquals(scriptSteps.size, expectedSteps.size, "$name: a result for every step")

            withScratch { scratch ->
                openDatabase(scratch).use { database ->
                    val normalize = Normalizer()
                    for ((index, step) in scriptSteps.withIndex()) {
                        val wanted = expectedSteps[index]
                        val label = "$name, step $index (${step["op"]?.stringValue ?: "?"})"
                        val before = state(database)
                        val result = normalize(run(step, database, unknown))
                        steps += 1
                        val found = difference(result, wanted)
                        if (found != null) {
                            different.add("$label: the result differs: $found")
                            return@use  // later steps would only repeat it
                        }
                        if (wanted["error"] != null) {
                            refusals += 1
                            difference(state(database), before)?.let { different.add("$label: was refused and still changed something: $it") }
                        }
                    }

                    for ((key, table) in listOf("documents" to "documents", "annotations" to "pdf_annotations", "bookmarks" to "pdf_bookmarks")) {
                        val wantedRows = JsonValue.Array(expected[key]!!.arrayValue!!.map { row ->
                            JsonValue.Object((row.objectValue?.members ?: emptyList()).map { member ->
                                val text = member.value.stringValue
                                JsonMember(member.key, if (member.key in jsonColumns && text != null) runCatching { JsonValue.parse(text) }.getOrElse { member.value } else member.value)
                            })
                        })
                        difference(normalize(rows(table, database)), wantedRows)?.let { different.add("$name: $table end differently: $it") }
                    }
                }
            }
        }

        assertTrue(unknown.isEmpty(), "unknown ops: $unknown")
        assertTrue(scripts.size >= 5 && steps >= 40 && refusals >= 5, "the corpus was read: ${scripts.size} scripts, $steps steps, $refusals refusals")
        println("PDF scripts: ${scripts.size} scripts, $refusals steps refused")
        println("PDF scripts: ${steps - different.size} of $steps steps, and the rows they left, agree with the desktop")
        different.forEach { println("  $it") }
        assertTrue(different.isEmpty(), "differences: ${different.size}")
    }
}
