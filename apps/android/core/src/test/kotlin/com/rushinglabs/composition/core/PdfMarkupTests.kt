package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.json.JsonParseError
import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.pdf.DocumentException
import com.rushinglabs.composition.core.pdf.InvalidMarkException
import com.rushinglabs.composition.core.pdf.PdfMarkChanges
import com.rushinglabs.composition.core.pdf.PdfMarkInput
import com.rushinglabs.composition.core.pdf.PdfMarkKind
import com.rushinglabs.composition.core.pdf.PdfMarkup
import com.rushinglabs.composition.core.pdf.PdfRect
import com.rushinglabs.composition.core.pdf.PdfTextNoteBody
import com.rushinglabs.composition.core.pdf.PdfViewState
import com.rushinglabs.composition.core.pdf.addAnnotation
import com.rushinglabs.composition.core.pdf.addAnnotationGroup
import com.rushinglabs.composition.core.pdf.addBookmark
import com.rushinglabs.composition.core.pdf.addDocument
import com.rushinglabs.composition.core.pdf.annotation
import com.rushinglabs.composition.core.pdf.annotations
import com.rushinglabs.composition.core.pdf.bookmark
import com.rushinglabs.composition.core.pdf.bookmarks
import com.rushinglabs.composition.core.pdf.deleteOrphanedDocuments
import com.rushinglabs.composition.core.pdf.document
import com.rushinglabs.composition.core.pdf.documentForNote
import com.rushinglabs.composition.core.pdf.documents
import com.rushinglabs.composition.core.pdf.listDocuments
import com.rushinglabs.composition.core.pdf.renameBookmark
import com.rushinglabs.composition.core.pdf.setPageCount
import com.rushinglabs.composition.core.pdf.setViewState
import com.rushinglabs.composition.core.pdf.updateAnnotation
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The PDF rules the shared corpus (PdfConformanceTests) does not pin, and the parts of the repositories it does not reach, ported from
// PdfMarkupTests.swift. Where a rule is JavaScript's (how a number is written, how a half rounds, what counts as white space, what
// `length` counts), the expected values were made by running the desktop's own `pdfMarkup.ts` and a JavaScript engine over the inputs.

@DisplayName("PDF marks and their JSON")
class PdfMarkupTests {
    private val unit = listOf(PdfRect(0.0, 0.0, 1.0, 1.0))

    private fun highlight(change: (PdfMarkInput) -> PdfMarkInput = { it }) = change(PdfMarkInput(0, PdfMarkKind.HIGHLIGHT, "yellow", unit))

    private fun ink(change: (PdfMarkInput) -> PdfMarkInput = { it }) = change(PdfMarkInput(0, PdfMarkKind.INK, "black", body = JsonValue.Object()))

    private fun note(change: (PdfMarkInput) -> PdfMarkInput = { it }) =
        change(PdfMarkInput(0, PdfMarkKind.TEXT, "yellow", body = PdfTextNoteBody(PdfRect(0.0, 0.0, 1.0, 1.0), "x").json))

    private fun refused(input: PdfMarkInput): String? = try {
        PdfMarkup.validate(input)
        null
    } catch (error: InvalidMarkException) {
        error.message
    }

    // JSON ----------------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a number is written the way JSON.stringify writes it")
    fun numbersAreWrittenLikeJavaScript() {
        // [text, JSON.stringify(JSON.parse(text))], from node
        val cases = listOf(
            "0" to "0", "-0" to "0", "1" to "1", "12" to "12", "12.5" to "12.5", "0.1" to "0.1", "0.30000000000000004" to "0.30000000000000004",
            "100.123" to "100.123", "1e21" to "1e+21", "1e-7" to "1e-7", "0.000001" to "0.000001", "0.0000001" to "1e-7",
            "123456789012345680000" to "123456789012345680000", "1.5e300" to "1.5e+300", "5e-324" to "5e-324", "1e16" to "10000000000000000",
            "123456789.123456789" to "123456789.12345679", "-2.5e-7" to "-2.5e-7", "1.7976931348623157e308" to "1.7976931348623157e+308",
            "4.35" to "4.35", "-1.5" to "-1.5", "12345678901234567890" to "12345678901234567000", "0.00001234" to "0.00001234",
            "9007199254740993" to "9007199254740992",
        )
        for ((text, expected) in cases) assertEquals(expected, JsonValue.parse(text).serialized(), text)
        assertTrue(JsonValue.Number(Double.NaN).serialized() == "null" && JsonValue.Number(Double.POSITIVE_INFINITY).serialized() == "null")
    }

    @Test
    @DisplayName("an object keeps the order of its members, and a value comes back as it went in")
    fun jsonRoundTrips() {
        val text = """{"z":1,"a":[true,false,null,"x\ny\"\\\u0001é😀"],"m":{"b":2.5,"a":{}},"e":[]}"""
        val value = JsonValue.parse(text)
        assertEquals(text, value.serialized())
        assertEquals(listOf("z", "a", "m", "e"), value.objectValue?.members?.map { it.key })
        assertEquals(value, JsonValue.parse(value.serialized()))
        // Equal as JSON means equal whatever the order
        assertEquals(JsonValue.parse("""{"a":1,"b":2}"""), JsonValue.parse("""{"b":2,"a":1}"""))
        assertTrue(JsonValue.parse("""{"a":1,"b":2}""") != JsonValue.parse("""{"a":1,"b":3}"""))
        // A key given twice keeps its first place and its last value
        assertEquals("""{"a":3,"b":2}""", JsonValue.parse("""{"a":1,"b":2,"a":3}""").serialized())
        // Escapes: a surrogate pair is one character, a lone surrogate becomes the replacement character
        assertEquals(JsonValue.Text("\uD83D\uDE00 /"), JsonValue.parse(""""\ud83d\ude00 \/""""))
        assertEquals(JsonValue.Text("\uFFFD"), JsonValue.parse(""""\ud83d""""))
        assertEquals("[1,2]", JsonValue.parse(" \n[1 , 2]\t").serialized())
    }

    @Test
    @DisplayName("JSON that is not strict JSON is refused")
    fun jsonIsStrict() {
        val bad = listOf(
            "", "[1,]", "{\"a\":1,}", "{a:1}", "01", "1.", ".5", "+1", "1e", "[1] 2", "nul", "'a'", "\"a", "\"\u0001\"", "\"\\x\"", "{\"a\" 1}",
            "[1 2]", "1e999", "-", "[", "\"\\u12\"",
        )
        for (text in bad) assertFailsWith<JsonParseError>(shownText(text)) { JsonValue.parse(text) }
        assertFailsWith<JsonParseError> { JsonValue.parse("[".repeat(300) + "]".repeat(300)) }
        JsonValue.parse("[".repeat(200) + "]".repeat(200))
    }

    // Rounding, one line, length --------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a coordinate rounds to a thousandth, a half toward +infinity as JavaScript's Math.round does")
    fun roundingIsJavaScripts() {
        // [x, x0 of the rectangle [x, 0, x + 100, 1] after the desktop validated it], from pdfMarkup.ts
        val cases = listOf(
            0.0005 to 0.001, -0.0005 to 0.0, -0.0015 to -0.001, 1.0005 to 1.001, 0.00025 to 0.0, -0.00025 to 0.0, 1.2345 to 1.235, -1.2345 to -1.234,
            8.0005 to 8.001, -8.0005 to -8.001, 0.0015 to 0.002, -0.0025 to -0.002,
        )
        for ((x, expected) in cases) assertTrue(PdfRect(x, 0.0, x + 100, 1.0).normalized().x0 == expected, "$x")
    }

    @Test
    @DisplayName("a label or comment becomes one line the way the desktop's regular expression makes it")
    fun oneLineIsJavaScripts() {
        // [text, validateBookmarkLabel(text)], from pdfMarkup.ts
        val cases = listOf(
            "a\nb" to "a b", " a \r\n b " to "a b", "a\u00A0\nb" to "a b", "a\u2028b" to "a\u2028b", "\uFEFFa\uFEFF" to "a",
            "\u0085a\u0085" to "\u0085a\u0085", "a \t b" to "a \t b", "a\n\n\nb" to "a b", "\n\n" to "", "a\u2028\nb" to "a b",
            "x\u000B\u000C\n y" to "x y", "\u3000a\u3000" to "a", "a\u180Eb" to "a\u180Eb", "\u2029a\u2029" to "a",
        )
        for ((text, expected) in cases) {
            assertEquals(expected, PdfMarkup.validateBookmarkLabel(text), text.map { it.code.toString(16) }.toString())
        }
        assertEquals("a b", PdfMarkup.validateBookmarkLabel("a\r\nb\r\n"))
    }

    @Test
    @DisplayName("a limit counts UTF-16 units, as the desktop's `length` does: an emoji is two")
    fun limitsCountUtf16() {
        val emoji = "\uD83D\uDE00"
        assertEquals(200, PdfMarkup.validateBookmarkLabel(emoji.repeat(100)).length)
        assertFailsWith<InvalidMarkException> { PdfMarkup.validateBookmarkLabel(emoji.repeat(101)) }
        // "é" as e + a combining accent is two units
        assertEquals(200, PdfMarkup.validateBookmarkLabel("e\u0301".repeat(100)).length)
        assertFailsWith<InvalidMarkException> { PdfMarkup.validateBookmarkLabel("e\u0301".repeat(101)) }
        assertNull(refused(highlight { it.copy(comment = emoji.repeat(250)) }))
        assertEquals("A comment can be at most 500 characters.", refused(highlight { it.copy(comment = emoji.repeat(251)) }))
        // the limit is on the line the comment becomes, not on what was typed around it
        assertNull(refused(highlight { it.copy(comment = "\n" + "a".repeat(500) + "\n") }))
    }

    // Marks the corpus does not try -----------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a mark is refused or kept as the desktop's validateAnnotation does, with its words")
    fun moreMarks() {
        val colorMessage = "A color is a lowercase name."
        assertNull(refused(ink { it.copy(color = "a".repeat(32)) }))
        assertEquals(colorMessage, refused(ink { it.copy(color = "a".repeat(33)) }))
        assertEquals(colorMessage, refused(ink { it.copy(color = "1a") }))
        assertEquals(colorMessage, refused(ink { it.copy(color = "a_b") }))
        assertEquals(colorMessage, refused(ink { it.copy(color = "") }))
        assertNull(refused(ink { it.copy(color = "a-b-1") }))
        assertEquals("A highlight is yellow, green, blue, pink, orange.", refused(highlight { it.copy(color = "ink-blue") }))
        assertNull(refused(highlight { it.copy(color = "orange") }))

        assertEquals("A text note's body is its rect and its text.", refused(note { it.copy(body = JsonValue.Array(emptyList())) }))
        assertEquals("A text note's body is its rect and its text.", refused(note { it.copy(body = JsonValue.Null) }))
        assertEquals("Ink needs its strokes as the body.", refused(ink { it.copy(body = JsonValue.Null) }))
        assertEquals("A ink has a body, not rectangles.", refused(ink { it.copy(rects = emptyList()) }))
        assertNull(refused(highlight { it.copy(body = JsonValue.Null) }))

        fun sized(size: JsonValue) = note { it.copy(body = JsonValue.Object("rect" to PdfRect(0.0, 0.0, 1.0, 1.0).json, "text" to JsonValue.Text("x"), "fontSize" to size)) }
        val sizeMessage = "A text note's font size is from 1 to 200."
        assertEquals(sizeMessage, refused(sized(JsonValue.Null)))
        assertEquals(sizeMessage, refused(sized(JsonValue.Number(200.0004))))
        assertEquals(sizeMessage, refused(sized(JsonValue.Number(0.9996))))
        assertEquals(sizeMessage, refused(sized(JsonValue.Text("12"))))
        assertTrue(refused(sized(JsonValue.Number(1.0))) == null && refused(sized(JsonValue.Number(200.0))) == null)

        // the box is put in order, the keys the desktop does not know are dropped
        val extra = JsonValue.Object("rect" to PdfRect(3.0, 3.0, 1.0, 1.0).json, "text" to JsonValue.Text("x"), "extra" to JsonValue.Number(1.0))
        assertEquals("""{"rect":[1,1,3,3],"text":"x"}""", PdfMarkup.validate(note { it.copy(body = extra) }).body?.serialized())

        val wide = PdfRect(-1e7, -1e7, 1e7, 1e7)
        assertNull(refused(highlight { it.copy(rects = listOf(wide)) }))
        for (bad in listOf(PdfRect(0.0, 0.0, 10_000_001.0, 1.0), PdfRect(0.0, 0.0, Double.NaN, 1.0), PdfRect(0.0, 0.0, Double.POSITIVE_INFINITY, 1.0))) {
            assertEquals("A rectangle is four finite numbers: x0, y0, x1, y1.", refused(highlight { it.copy(rects = listOf(bad)) }))
        }

        assertEquals("A group is a 32-character lowercase hex uuid.", refused(highlight { it.copy(groupUuid = "0123456789ABCDEF0123456789abcdef") }))
        assertEquals("A group is a 32-character lowercase hex uuid.", refused(highlight { it.copy(groupUuid = "0123456789abcdef0123456789abcdef0") }))
        assertEquals("A page is a whole number from 0.", refused(highlight { it.copy(page = -1) }))
        // a quote is kept as it is, line breaks and all
        assertEquals("  a\nb  ", PdfMarkup.validate(highlight { it.copy(quote = "  a\nb  ") }).quote)
    }

    @Test
    @DisplayName("a reading position keeps what is sane and drops the rest")
    fun viewStates() {
        fun normalized(text: String) = PdfViewState.normalizing(JsonValue.parse(text)).json.serialized()
        // from normalizeViewState in pdfMarkup.ts
        assertEquals("""{"zoom":0.1}""", normalized("""{"zoom":0.1}"""))
        assertEquals("""{"zoom":10}""", normalized("""{"zoom":10}"""))
        assertEquals("{}", normalized("""{"zoom":0.0999}"""))
        assertEquals("""{"zoom":1.001}""", normalized("""{"zoom":1.0005}"""))
        assertEquals("{}", normalized("""{"zoom":-1}"""))
        assertEquals("""{"page":0}""", normalized("""{"page":0}"""))
        assertEquals("""{"page":1}""", normalized("""{"page":1.0}"""))
        assertEquals("""{"darkPages":false}""", normalized("""{"darkPages":false}"""))
        assertEquals("{}", normalized("[]"))
        assertEquals("{}", normalized("""{"page":"3","zoom":"2"}"""))
        assertEquals("{}", normalized("""{"zoom":null}"""))
        assertEquals("""{"page":9007199254740991}""", normalized("""{"page":9007199254740991}"""))
        // The one place this differs from the desktop, which keeps any whole number: no PDF has more than 2^53 - 1 pages.
        assertEquals("{}", normalized("""{"page":1e300}"""))

        assertTrue(PdfViewState.stored(null) == PdfViewState() && PdfViewState.stored("") == PdfViewState() && PdfViewState.stored("{damaged") == PdfViewState())
        assertEquals(PdfViewState(darkPages = true), PdfViewState(-3, Double.NaN, true).normalized())
    }

    // The repositories, past the corpus -------------------------------------------------------------------------------------------

    private fun withDatabase(body: (CompositionDatabase) -> Unit) = withScratch { scratch -> openDatabase(scratch).use(body) }

    private fun count(database: CompositionDatabase, table: String): Long = database.file.read { it.long("SELECT COUNT(*) FROM $table") ?: 0 }

    private fun nextIds(database: CompositionDatabase): Map<String, Long> = database.file.read { db ->
        db.rows("SELECT name, seq FROM sqlite_sequence WHERE name IN ('documents', 'pdf_annotations', 'pdf_bookmarks')").associate { it.string("name") to it.long("seq") }
    }

    @Test
    @DisplayName("a PDF is found by its note, its uuid and its bytes, and a reading position is stored whole")
    fun documentLookups() = withDatabase { database ->
        val first = database.createNote("A")
        val second = database.createNote("B")
        val a = database.addDocument(first.id, "a.pdf", "000000000001-a.pdf", "11", 5_000_000_000, 0)
        val b = database.addDocument(second.id, "b.pdf", "000000000002-b.pdf", "11", 2, 3)
        assertTrue(a.size == 5_000_000_000 && a.pageCount == 0 && a.viewState == PdfViewState() && isUuid(a.uuid) && Timestamp.milliseconds(a.createdAt) != null)
        assertTrue(database.document(b.id) == b && database.document(a.uuid) == a && database.documentForNote(first.id) == a)
        assertTrue(database.document(99) == null && database.document("nope") == null && database.documentForNote(99) == null)
        assertTrue(database.documents("11") == listOf(a, b) && database.documents("22").isEmpty() && database.listDocuments() == listOf(a, b))

        database.setViewState(a.id, PdfViewState())
        assertEquals("{}", database.file.read { it.string("SELECT view_state FROM documents WHERE id = ?", a.id) })
        database.setViewState(b.id, PdfViewState(7, 2.0004, false))
        assertEquals(PdfViewState(7, 2.0, false), database.document(b.id)?.viewState)
        database.setViewState(99, PdfViewState(1)) // a PDF that is gone: nothing happens

        assertFailsWith<DocumentException.InvalidPageCount> { database.setPageCount(a.id, 0) }
        database.setPageCount(a.id, 12)
        assertEquals(12, database.document(a.id)?.pageCount)
        assertTrue(DocumentException.NoNote().message == "That note no longer exists." && DocumentException.HasDocument().message == "That note already has a PDF.")
    }

    @Test
    @DisplayName("marks and bookmarks come back in order, by page, by uuid, and only on the pages that were asked for")
    fun listings() = withDatabase { database ->
        val owner = database.createNote("A")
        val document = database.addDocument(owner.id, "a.pdf", "000000000001-a.pdf", "11", 1, 20)
        val late = database.addAnnotation(document.id, PdfMarkInput(9, PdfMarkKind.HIGHLIGHT, "yellow", unit))
        val early = database.addAnnotation(document.id, PdfMarkInput(2, PdfMarkKind.UNDERLINE, "green", unit))
        val again = database.addAnnotation(document.id, PdfMarkInput(9, PdfMarkKind.STRIKETHROUGH, "pink", unit))
        assertEquals(listOf(early, late, again), database.annotations(document.id), "by page, then by when")
        assertEquals(listOf(late, again), database.annotations(document.id, page = 9))
        assertTrue(database.annotations(document.id, page = 3).isEmpty() && database.annotations(99).isEmpty())
        assertTrue(database.annotation(early.id) == early && database.annotation(again.uuid) == again && database.annotation(99) == null)

        val far = database.addBookmark(document.id, 15, "far")
        val near = database.addBookmark(document.id, 1)
        assertTrue(database.bookmarks(document.id) == listOf(near, far) && database.bookmark(far.id) == far && database.bookmark(99) == null)
        assertNull(database.renameBookmark(99, "x"))
        assertFailsWith<InvalidMarkException> { database.renameBookmark(99, "x".repeat(201)) }
        assertFailsWith<InvalidMarkException> { database.addBookmark(document.id, -1) }
        Unit
    }

    @Test
    @DisplayName("a mark changed to something invalid, or a group with one bad page, leaves everything as it was, the next id too")
    fun refusalsChangeNothing() = withDatabase { database ->
        val owner = database.createNote("A")
        val document = database.addDocument(owner.id, "a.pdf", "000000000001-a.pdf", "11", 1, 5)
        val mark = database.addAnnotation(document.id, PdfMarkInput(1, PdfMarkKind.HIGHLIGHT, "yellow", unit, comment = "kept"))
        val ids = nextIds(database)

        assertFailsWith<InvalidMarkException> { database.updateAnnotation(mark.id, PdfMarkChanges(color = "red")) }
        assertFailsWith<InvalidMarkException> { database.updateAnnotation(mark.id, PdfMarkChanges(comment = "changed", rects = PdfMarkChanges.NewRects(null))) }
        assertFailsWith<InvalidMarkException> { database.updateAnnotation(mark.id, PdfMarkChanges(body = JsonValue.Object())) }
        assertEquals(mark, database.annotation(mark.id))

        assertFailsWith<InvalidMarkException> {
            database.addAnnotationGroup(document.id, listOf(PdfMarkInput(1, PdfMarkKind.HIGHLIGHT, "pink", unit), PdfMarkInput(5, PdfMarkKind.HIGHLIGHT, "pink", unit)))
        }
        assertFailsWith<InvalidMarkException> {
            database.addAnnotationGroup(document.id, listOf(PdfMarkInput(1, PdfMarkKind.HIGHLIGHT, "pink", unit), PdfMarkInput(2, PdfMarkKind.INK, "black", body = JsonValue.Array(emptyList()))))
        }
        assertTrue(count(database, "pdf_annotations") == 1L && nextIds(database) == ids)
        assertNull(database.updateAnnotation(99, PdfMarkChanges(comment = "x")))
        assertTrue(database.addAnnotationGroup(document.id, emptyList()).isEmpty())
    }

    @Test
    @DisplayName("an update changes what it names, can move a text note, and keeps the page, the kind and the group")
    fun updates() = withDatabase { database ->
        val owner = database.createNote("A")
        val document = database.addDocument(owner.id, "a.pdf", "000000000001-a.pdf", "11", 1, 5)
        val pair = database.addAnnotationGroup(
            document.id, listOf(PdfMarkInput(1, PdfMarkKind.HIGHLIGHT, "pink", unit, quote = "q"), PdfMarkInput(2, PdfMarkKind.HIGHLIGHT, "pink", unit)),
        )
        // a group the caller names is replaced by the one made here
        val named = database.addAnnotationGroup(document.id, listOf(PdfMarkInput(0, PdfMarkKind.UNDERLINE, "blue", unit, groupUuid = "0123456789abcdef0123456789abcdef")))
        assertTrue(named[0].groupUuid == null && pair[0].groupUuid != null && pair[0].groupUuid == pair[1].groupUuid)

        val moved = assertNotNull(
            database.updateAnnotation(pair[0].id, PdfMarkChanges(color = "green", comment = " two\nlines ", rects = PdfMarkChanges.NewRects(listOf(PdfRect(9.0, 8.0, 1.00049, 2.0))))),
        )
        assertTrue(moved.rects == listOf(PdfRect(1.0, 2.0, 9.0, 8.0)) && moved.comment == "two lines" && moved.color == "green" && moved.quote == "q")
        assertEquals(listOf(pair[0].page, pair[0].kind, pair[0].groupUuid, pair[0].createdAt), listOf(moved.page, moved.kind, moved.groupUuid, moved.createdAt))

        val box = PdfTextNoteBody(PdfRect(0.0, 0.0, 10.0, 10.0), "hello", 14.0)
        val text = database.addAnnotation(document.id, PdfMarkInput(3, PdfMarkKind.TEXT, "yellow", body = box.json))
        assertEquals(box, text.body?.let(PdfTextNoteBody::of))
        val edited = PdfTextNoteBody(PdfRect(5.0, 5.0, 20.0, 20.0), "moved")
        val changed = assertNotNull(database.updateAnnotation(text.id, PdfMarkChanges(body = edited.json)))
        assertTrue(changed.body?.let(PdfTextNoteBody::of) == edited && changed.rects == null)
        assertEquals(changed.body, database.updateAnnotation(text.id, PdfMarkChanges())?.body, "nothing named, nothing changed")
    }

    @Test
    @DisplayName("a row the desktop wrote reads, and a row this build cannot read is an error rather than a wrong mark")
    fun readingRows() = withDatabase { database ->
        val owner = database.createNote("A")
        val document = database.addDocument(owner.id, "a.pdf", "000000000001-a.pdf", "11", 1, 0)
        database.file.write { db ->
            db.execute(
                """
                INSERT INTO pdf_annotations (document_id, page, kind, color, rects, body, created_at, updated_at)
                VALUES (?, 4, 'highlight', 'yellow', '[[72.5,600,300.25,620],[72.5,580,210,600]]', NULL, 'x', 'x'),
                       (?, 5, 'text', 'orange', NULL, '{"rect":[400,100,560,160],"text":"Margin note","fontSize":12}', 'x', 'x')
                """.trimIndent(),
                document.id, document.id,
            )
        }
        val marks = database.annotations(document.id)
        assertTrue(marks.map { it.page } == listOf(4, 5) && marks.all { isUuid(it.uuid) })
        assertEquals(listOf(PdfRect(72.5, 600.0, 300.25, 620.0), PdfRect(72.5, 580.0, 210.0, 600.0)), marks[0].rects)
        assertEquals(PdfTextNoteBody(PdfRect(400.0, 100.0, 560.0, 160.0), "Margin note", 12.0), marks[1].body?.let(PdfTextNoteBody::of))

        for ((column, value, message) in listOf(
            Triple("kind", "'squiggle'", "Unknown kind of mark: squiggle."), Triple("rects", "'[[1,2,3]]'", "A mark's rectangles are damaged."),
            Triple("rects", "'{'", "A mark's rectangles are damaged."), Triple("body", "'{'", "A mark's body is damaged."),
        )) {
            database.file.write { it.execute("UPDATE pdf_annotations SET $column = $value WHERE page = 4") }
            assertEquals(InvalidMarkException(message), assertFailsWith<InvalidMarkException> { database.annotations(document.id) })
            database.file.write { it.execute("UPDATE pdf_annotations SET kind = 'highlight', rects = '[[0,0,1,1]]', body = NULL WHERE page = 4") }
        }
    }

    @Test
    @DisplayName("dropping orphans also drops the marks and bookmarks of a PDF that is already gone")
    fun strayRows() = withDatabase { database ->
        database.file.write { db ->
            db.execute("INSERT INTO pdf_annotations (document_id, page, kind, color, created_at, updated_at) VALUES (999, 0, 'highlight', 'yellow', 'x', 'x')")
            db.execute("INSERT INTO pdf_bookmarks (document_id, page, created_at) VALUES (999, 0, 'x')")
        }
        assertTrue(database.deleteOrphanedDocuments().isEmpty())
        assertTrue(count(database, "pdf_annotations") == 0L && count(database, "pdf_bookmarks") == 0L)
    }
}
