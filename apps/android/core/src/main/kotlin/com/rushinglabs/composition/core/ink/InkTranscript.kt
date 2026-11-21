package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.json.JsonMember
import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.swiftMax
import com.rushinglabs.composition.core.swiftMin
import java.text.Normalizer
import kotlin.coroutines.cancellation.CancellationException

// The words in a drawing, for search (docs/architecture/ink.md, "Search"; compromise C11), ported from InkTranscript.swift without
// Vision. Handwriting is opaque to search, so when a drawing is saved the text that can be read from it is written into the tag's `alt`,
// which is note text like any other. The reading itself is behind a seam: on the iPad it is Vision; on Android it is the app's (a text
// recognizer of its choosing), and the tests give their own.

/** A line of text a reader found in a picture, and how sure it was of it (0 to 1). */
data class InkRecognizedLine(val text: String, val confidence: Float)

/**
 * The picture a recognizer is given, before it is pixels: the writing in black on white, at a size handwriting reads at. The Swift hands
 * Vision a CGImage it drew; here the recognizer draws `plan` (as the app draws any drawing) and reads the bitmap.
 */
class InkRecognitionPage(val drawing: InkDocument, val palette: InkPalette, val scale: Double, val background: ThemeColor) {
    val plan: InkRenderer.Plan get() = InkRenderer.plan(drawing, palette, scale, background)
    val size: InkImageSize get() = InkRenderer.imageSize(drawing, scale)
}

/** Something that reads the lines of text in a picture. */
fun interface InkTextRecognizing {
    /** The lines of text on `page` in reading order, each with the reader's confidence; empty when there is none. */
    suspend fun lines(page: InkRecognitionPage): List<InkRecognizedLine>
}

object InkTranscript {
    /** The most characters of a transcript (counted in code points: see `normalized`). It goes into a tag in the note, and into what a screen reader says for the drawing. */
    const val MAX_LENGTH = 300

    /**
     * The least confidence (0 to 1) a line needs to be written down. Vision gives 0.3 to a reading it is guessing at ("Sugarfrom", from
     * some scribbles) and 1.0 to one it trusts; this is anywhere between, and a reading under it is left out.
     */
    const val MINIMUM_CONFIDENCE = 0.5f

    /**
     * The words in `drawing`, on one line (no quotes or angle brackets, which a tag's attribute cannot hold), or an empty text when there
     * are none or the reading failed: a drawing is saved either way, and its `alt` then stays "Drawing".
     */
    suspend fun text(drawing: InkDocument, recognizer: InkTextRecognizing): String {
        val page = recognitionPage(drawing) ?: return ""
        val lines = try {
            recognizer.lines(page)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return ""
        }
        return normalized(trusted(lines))
    }

    /**
     * The lines worth writing into a note. **Confidence is not enough:** with language correction on, Vision read a cursive signature as
     * "Drien fucking" and was *sure* of it (1.0), because it had snapped the marks to a common word (Gate C item 263). So a line is also
     * left out whole when a word in it is one a program should never put into a person's note on a guess. A person who really wrote one
     * can type it into `alt` themselves, and what they type stays.
     */
    internal fun trusted(lines: List<InkRecognizedLine>): List<String> =
        lines.filter { it.confidence >= MINIMUM_CONFIDENCE && !neverGuessed(it.text) }.map { it.text }

    /**
     * Whether `line` holds a word from the short list that is never written from a guess. The words are compared whole, with case,
     * accents and punctuation ignored; only the roots below also match as part of a longer word. Swift folds with Foundation
     * (`.caseInsensitive, .diacriticInsensitive`); this decomposes, drops the combining marks and folds case by upper then lower case
     * (so `ß` is `ss` and `ſ` is `s`, as case folding has them).
     */
    internal fun neverGuessed(line: String): Boolean {
        val decomposed = Normalizer.normalize(line, Normalizer.Form.NFD)
        val bare = StringBuilder(decomposed.length)
        var index = 0
        while (index < decomposed.length) {
            val point = decomposed.codePointAt(index)
            if (Character.getType(point) != Character.NON_SPACING_MARK.toInt()) bare.appendCodePoint(point)
            index += Character.charCount(point)
        }
        val folded = bare.toString().uppercase().lowercase()
        return words(folded).any { word ->
            word in NEVER_GUESSED_WORDS || NEVER_GUESSED_ANYWHERE.any { word.contains(it) } ||
                NEVER_GUESSED_AT_EITHER_END.any { word.startsWith(it) || word.endsWith(it) }
        }
    }

    /** The runs of letters (Swift's `Character.isLetter`, Unicode's Alphabetic) in `text`. */
    private fun words(text: String): List<String> {
        val out = ArrayList<String>()
        val word = StringBuilder()
        var index = 0
        while (index < text.length) {
            val point = text.codePointAt(index)
            if (Character.isAlphabetic(point)) {
                word.appendCodePoint(point)
            } else if (word.isNotEmpty()) {
                out.add(word.toString())
                word.setLength(0)
            }
            index += Character.charCount(point)
        }
        if (word.isNotEmpty()) out.add(word.toString())
        return out
    }

    /** Roots that are blocked anywhere in a word ("motherfucker"): no word or name holds them innocently. */
    private val NEVER_GUESSED_ANYWHERE = listOf("fuck")
    /** Roots that are blocked at the start or the end of a word ("shitty", "bullshit") but not in the middle, where names hold them ("Matsushita", "Yoshitaka"). */
    private val NEVER_GUESSED_AT_EITHER_END = listOf("shit")
    /** Words that are blocked only as a whole word ("Scunthorpe" holds the first, and is fine). Short on purpose, and meant to be added to. */
    private val NEVER_GUESSED_WORDS = setOf(
        "cunt", "cunts", "bitch", "bitches", "asshole", "assholes", "nigger", "niggers", "nigga", "niggas", "faggot", "faggots",
    )

    /**
     * The page a recognizer is given: the writing in black on white, at a size handwriting reads at. Every colour is drawn black (a
     * yellow pen would vanish), and the marker and the watercolour are left out, as a highlighter over writing only makes it harder to
     * read. Null when nothing would be drawn.
     */
    internal fun recognitionPage(drawing: InkDocument): InkRecognitionPage? {
        val writing = drawing.copy(
            strokes = drawing.strokes
                .filter { it.ink != InkType.MARKER && it.ink != InkType.WATERCOLOR && it.points.isNotEmpty() }
                .map { it.copy(color = InkColor.INK) },
        )
        if (writing.isEmpty) return null
        val black = ThemeColor(0, 0, 0)
        // 2 pixels to a point reads well; a long page is brought down to 4,096 pixels, where Vision still finds a pen's writing.
        val scale = swiftMin(2.0, 4096 / swiftMax(writing.width, writing.height))
        return InkRecognitionPage(writing, InkPalette(black, black, emptyMap()), scale, ThemeColor(255, 255, 255))
    }

    /**
     * Lines of recognised text as a single line for `alt`: trimmed, runs of white space as one space, quotes and angle brackets dropped,
     * at most `MAX_LENGTH` characters (cut at a word). Swift counts `Character`s (grapheme clusters), which a JVM and Android split by
     * their own rules; this counts code points, so a word is never cut inside one, and text with combining accents or emoji sequences
     * is cut a little sooner than on the iPad.
     */
    internal fun normalized(lines: List<String>): String {
        val joined = lines.joinToString(" ").filter { it != '"' && it != '<' && it != '>' }
        val words = joined.split(*WHITE_SPACE).filter { it.isNotEmpty() }
        var out = ""
        var outLength = 0
        for (word in words) {
            val wordLength = word.codePointCount(0, word.length)
            val nextLength = if (out.isEmpty()) wordLength else outLength + 1 + wordLength
            if (nextLength > MAX_LENGTH) {
                // One word longer than the limit is cut; otherwise the words so far stand.
                if (out.isEmpty()) out = word.substring(0, word.offsetByCodePoints(0, MAX_LENGTH))
                break
            }
            out = if (out.isEmpty()) word else "$out $word"
            outLength = nextLength
        }
        return out
    }

    /** Unicode's White_Space, which Swift's `Character.isWhitespace` is, written out (a JVM's and Android's own rules differ). */
    private val WHITE_SPACE: Array<String> = (
        (0x09..0x0D) + listOf(0x20, 0x85, 0xA0, 0x1680) + (0x2000..0x200A) + listOf(0x2028, 0x2029, 0x202F, 0x205F, 0x3000)
        ).map { String(Character.toChars(it)) }.toTypedArray()
}

/** The text read from this drawing when it was saved (a member of the drawing that every reader keeps: `"transcript"`), null when none was. */
val InkDocument.transcript: String?
    get() = extra.firstOrNull { it.key == "transcript" }?.value?.stringValue

/** This drawing with `transcript` as its transcript, or with none (Swift's `transcript` setter). */
fun InkDocument.withTranscript(transcript: String?): InkDocument =
    copy(extra = extra.filter { it.key != "transcript" } + listOfNotNull(transcript?.let { JsonMember("transcript", JsonValue.Text(it)) }))
