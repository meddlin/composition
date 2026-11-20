package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.DisplayName
import java.util.Collections
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Ported from InkTranscriptTests.swift, without the two tests of Vision itself. The Swift fake is handed a CGImage; this one is handed the
// page it would draw, and `InkRaster` draws it to look at the pixels the Swift tests look at.

/** Hands back what it is told, and keeps the pages it was asked about. */
class FakeRecognizer(private val reply: List<InkRecognizedLine> = emptyList(), private val fails: Boolean = false) : InkTextRecognizing {
    val pages: MutableList<InkRecognitionPage> = Collections.synchronizedList(ArrayList())

    override suspend fun lines(page: InkRecognitionPage): List<InkRecognizedLine> {
        pages.add(page)
        if (fails) throw InkError("no")
        return reply
    }

    companion object {
        /** Lines the reader was sure of. */
        fun sure(vararg lines: String) = FakeRecognizer(lines.map { InkRecognizedLine(it, 1f) })
    }
}

@DisplayName("Ink: the words in a drawing")
class InkTranscriptTests {
    private fun stroke(ink: InkType = InkType.PEN, color: InkColor = InkColor.INK, from: Double = 20.0, to: Double = 120.0) =
        InkStroke(ink, color, listOf(InkPoint(from, 50.0, width = 6.0, height = 6.0), InkPoint(to, 60.0, t = 100.0, width = 6.0, height = 6.0)))

    private fun text(drawing: InkDocument, recognizer: InkTextRecognizing) = runBlocking { InkTranscript.text(drawing, recognizer) }

    @Test
    @DisplayName("the recognizer is given the writing in black on white")
    fun theRecognizerIsGivenTheWritingInBlackOnWhite() {
        // A yellow pen is drawn black, a marker over it is left out.
        val drawing = InkDocument(200.0, 100.0, listOf(stroke(InkType.PEN, InkColor.Semantic("yellow")), stroke(InkType.MARKER, InkColor.Semantic("pink"), 20.0, 180.0)))
        val fake = FakeRecognizer.sure("hello")
        assertEquals("hello", text(drawing, fake))
        val page = assertNotNull(fake.pages.firstOrNull())
        assertEquals(InkImageSize(400, 200), page.size, "2 pixels to a point")
        assertEquals(1, page.drawing.strokes.size)
        val image = InkRaster.render(page.plan, page.drawing)
        assertEquals(RgbaImage.Pixel(255, 255, 255, 255), image.pixel(2, 2), "the page is white")
        assertEquals(RgbaImage.Pixel(0, 0, 0, 255), image.pixel(140, 110), "the pen is black, though it was yellow")
        assertEquals(RgbaImage.Pixel(255, 255, 255, 255), image.pixel(320, 114), "the marker's stretch beyond the pen is not drawn")
    }

    @Test
    @DisplayName("a long page is brought down to what Vision reads at")
    fun aLongPageIsBroughtDownToWhatVisionReadsAt() {
        val page = assertNotNull(InkTranscript.recognitionPage(InkDocument(834.0, 8000.0, listOf(stroke()))))
        assertEquals(4096, maxOf(page.size.width, page.size.height))
    }

    @Test
    @DisplayName("nothing to read is never asked")
    fun nothingToReadIsNeverAsked() {
        val fake = FakeRecognizer.sure("x")
        assertEquals("", text(InkDocument(100.0, 100.0), fake))
        assertEquals("", text(InkDocument(100.0, 100.0, listOf(stroke(InkType.MARKER))), fake))
        assertTrue(fake.pages.isEmpty())
    }

    @Test
    @DisplayName("a recognizer that fails leaves no words")
    fun aRecognizerThatFailsLeavesNoWords() {
        assertEquals("", text(InkDocument(200.0, 100.0, listOf(stroke())), FakeRecognizer(fails = true)))
    }

    // Gate C item 263, 2026-11-12: Vision read a cursive signature as "Drien fucking" (sure of it, at 1.00, because language correction
    // had snapped the marks to a common word), and the words went into `alt`, the search index and what VoiceOver says. The reader's
    // doubt is respected and a few words are never written on a guess.

    /** A drawing with something on it, for the tests below; what the reader "finds" in it comes from the fake. */
    private fun drawing() = InkDocument(200.0, 100.0, listOf(stroke()))

    @Test
    @DisplayName("a line the reader was unsure of is not written")
    fun aLineTheReaderWasUnsureOfIsNotWritten() {
        val sure = InkRecognizedLine("Shopping list", 1f)
        val guess = InkRecognizedLine("Sugarfrom", 0.3f)
        assertEquals("Shopping list", text(drawing(), FakeRecognizer(listOf(sure, guess))))
        assertEquals("", text(drawing(), FakeRecognizer(listOf(guess))), "nothing left: the alt stays Drawing")
        // Exactly at the floor is kept; just under it is not.
        val atFloor = InkRecognizedLine("kept", InkTranscript.MINIMUM_CONFIDENCE)
        val under = InkRecognizedLine("dropped", InkTranscript.MINIMUM_CONFIDENCE - 0.01f)
        assertEquals("kept", text(drawing(), FakeRecognizer(listOf(atFloor, under))))
    }

    @Test
    @DisplayName("a line with a word that is never guessed is not written")
    fun aLineWithAWordThatIsNeverGuessedIsNotWritten() {
        // The whole line goes, since a line with one such word in it is more likely a misread than a sentence; the person can type it into `alt` themselves.
        val lines = listOf("Meeting notes", "Drien fucking", "call Sam", "BULLSHIT!", "what the shit?", "   FuCkEr  ")
        assertEquals("Meeting notes call Sam", text(drawing(), FakeRecognizer.sure(*lines.toTypedArray())))
        assertTrue(InkTranscript.neverGuessed("a Cunt"))
        assertTrue(InkTranscript.neverGuessed("two bitches"))
        assertTrue(InkTranscript.neverGuessed("a shitty day") && InkTranscript.neverGuessed("horseshit") && InkTranscript.neverGuessed("motherfuckers"))
        // Accents and case are folded away as Foundation folds them.
        assertTrue(InkTranscript.neverGuessed("F\u00DCCK it") && InkTranscript.neverGuessed("b\u00EFtch"))
    }

    @Test
    @DisplayName("ordinary words that contain a listed one are kept")
    fun ordinaryWordsThatContainAListedOneAreKept() {
        val lines = listOf("Scunthorpe", "shiitake mushrooms", "Rushing", "pushing the class", "assistant", "Dickens", "Matsushita", "Yoshitaka Nishitani")
        assertEquals(
            "Scunthorpe shiitake mushrooms Rushing pushing the class assistant Dickens Matsushita Yoshitaka Nishitani",
            text(drawing(), FakeRecognizer.sure(*lines.toTypedArray())),
        )
        assertFalse(InkTranscript.neverGuessed("") || InkTranscript.neverGuessed("Hello, world"))
    }

    @Test
    @DisplayName("lines become one line that a tag can hold")
    fun linesBecomeOneLineThatATagCanHold() {
        assertEquals("Meeting notes call Sam today buy milk", InkTranscript.normalized(listOf("  Meeting  notes ", "", "call \"Sam\" <today>", "\tbuy\nmilk")))
        assertEquals("", InkTranscript.normalized(emptyList()))
        assertEquals("", InkTranscript.normalized(listOf("\"<>\"")))
        val cut = InkTranscript.normalized(List(200) { "word" })
        assertTrue(cut.length <= InkTranscript.MAX_LENGTH && cut.endsWith("word") && cut.split(" ").all { it == "word" })
        assertEquals(InkTranscript.MAX_LENGTH, InkTranscript.normalized(listOf("x".repeat(500))).length)
        // Unicode's white space, not only ASCII's, separates words (a no-break space and an ideographic space).
        assertEquals("a b c", InkTranscript.normalized(listOf("a\u00A0b\u3000c")))
        // A word of emoji is cut between characters, never inside one.
        val emoji = InkTranscript.normalized(listOf("\uD83D\uDE00".repeat(400)))
        assertEquals(InkTranscript.MAX_LENGTH, emoji.codePointCount(0, emoji.length))
    }

    @Test
    @DisplayName("the transcript is a member of the drawing every reader keeps")
    fun theTranscriptIsAMemberOfTheDrawingEveryReaderKeeps() {
        var drawing = InkDocument(200.0, 100.0, listOf(stroke()))
        assertNull(drawing.transcript)
        drawing = drawing.withTranscript("hello world")
        val json = drawing.json
        assertEquals("hello world", json.objectValue?.get("transcript")?.stringValue)
        val again = InkDocument.fromJson(json)
        assertTrue(again.transcript == "hello world" && again.json == json)
        // Replacing and removing leave one member or none.
        drawing = drawing.withTranscript("other")
        assertTrue(drawing.extra.count { it.key == "transcript" } == 1 && drawing.transcript == "other")
        drawing = drawing.withTranscript(null)
        assertTrue(drawing.transcript == null && drawing.extra.isEmpty())
    }

    @Test
    @DisplayName("the page a recognizer reads is black on white whatever the scheme")
    fun theRecognitionPageIsBlackOnWhite() {
        val page = assertNotNull(InkTranscript.recognitionPage(drawing()))
        assertEquals(ThemeColor(255, 255, 255), page.background)
        assertEquals(ThemeColor(0, 0, 0), page.palette.color(InkColor.Semantic("yellow")))
        assertEquals(ThemeColor(0, 0, 0), page.palette.color(InkColor.ACCENT))
        assertTrue(page.plan.shapes.all { it.color == ThemeColor(0, 0, 0) })
    }
}
