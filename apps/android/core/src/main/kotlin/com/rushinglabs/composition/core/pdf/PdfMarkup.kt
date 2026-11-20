package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.json.JsonMember
import com.rushinglabs.composition.core.json.JsonValue
import com.rushinglabs.composition.core.yaml.JavaScriptText
import kotlin.math.abs
import kotlin.math.floor

// What a mark on a PDF is, and what makes one valid, ported from PdfMarkup.swift: the twin of `pdfMarkup.ts` (docs/pdf-markup-plan.md).
// The rules are the desktop's, and the conformance corpus in `fixtures/conformance/pdf` pins them: the TypeScript writes what each input
// must become (or that it is refused) and PdfConformanceTests replays it.
//
// Every rectangle is in raw PDF user space: the numbers a PDF's own annotation `/Rect` and `/QuadPoints` use, in points, unrotated,
// whatever the page's crop box, media box or rotation. They are stored rounded to a thousandth of a point so that the implementations
// write the same digits.
//
// The desktop checks JSON from outside, so a page of 1.5, a quote that is a number or a rectangle of three numbers are refusals there.
// Here the types rule those out; what is left to check is what a type cannot say.

enum class PdfMarkKind(val rawValue: String) {
    HIGHLIGHT("highlight"), UNDERLINE("underline"), STRIKETHROUGH("strikethrough"), TEXT("text"), INK("ink");

    /** The kinds that mark lines of text: they carry rectangles, one per line, and a quote. */
    val marksText: Boolean get() = this == HIGHLIGHT || this == UNDERLINE || this == STRIKETHROUGH

    companion object {
        fun of(rawValue: String): PdfMarkKind? = entries.firstOrNull { it.rawValue == rawValue }
    }
}

/** A mark or bookmark that breaks the rules; the message is the desktop's and is safe to show. */
class InvalidMarkException(message: String) : Exception(message) {
    override fun equals(other: Any?): Boolean = other is InvalidMarkException && other.message == message
    override fun hashCode(): Int = message.hashCode()
}

/** x0, y0, x1, y1. A rectangle read from a caller may name any two opposite corners; `normalized` puts them in order. */
class PdfRect(val x0: Double, val y0: Double, val x1: Double, val y1: Double) {
    val json: JsonValue get() = JsonValue.Array(listOf(JsonValue.Number(x0), JsonValue.Number(y0), JsonValue.Number(x1), JsonValue.Number(y1)))

    /** The rectangle from its two corners, in order and rounded to a thousandth; throws when it is not a real, non-empty one. */
    fun normalized(what: String = "rectangle"): PdfRect {
        if (!listOf(x0, y0, x1, y1).all { it.isFinite() && abs(it) <= PdfMarkup.COORDINATE_LIMIT }) {
            throw InvalidMarkException("A $what is four finite numbers: x0, y0, x1, y1.")
        }
        val rect = PdfRect(
            PdfMarkup.round3(minOf(x0, x1)), PdfMarkup.round3(minOf(y0, y1)), PdfMarkup.round3(maxOf(x0, x1)), PdfMarkup.round3(maxOf(y0, y1)),
        )
        if (!(rect.x1 > rect.x0 && rect.y1 > rect.y0)) throw InvalidMarkException("A $what must have an area.")
        return rect
    }

    fun copy(x0: Double = this.x0, y0: Double = this.y0, x1: Double = this.x1, y1: Double = this.y1) = PdfRect(x0, y0, x1, y1)

    /** Equal as numbers are (`0` and `-0` are one), as Swift's `==` on doubles is. */
    override fun equals(other: Any?): Boolean = other is PdfRect && other.x0 == x0 && other.y0 == y0 && other.x1 == x1 && other.y1 == y1
    override fun hashCode(): Int = listOf(x0, y0, x1, y1).fold(0) { hash, value -> hash * 31 + (if (value == 0.0) 0 else value.hashCode()) }
    override fun toString(): String = "PdfRect(${json.serialized()})"

    companion object {
        /** `[x0, y0, x1, y1]`, or null for anything else. */
        fun of(json: JsonValue): PdfRect? {
            val items = json.arrayValue ?: return null
            if (items.size != 4) return null
            val numbers = items.mapNotNull { it.doubleValue }
            if (numbers.size != 4) return null
            return PdfRect(numbers[0], numbers[1], numbers[2], numbers[3])
        }
    }
}

/** A typed text note: its box and its text. */
data class PdfTextNoteBody(val rect: PdfRect, val text: String, val fontSize: Double? = null) {
    /** The members in the order the desktop writes them. */
    val json: JsonValue
        get() {
            val members = mutableListOf<JsonMember>(JsonMember("rect", rect.json), JsonMember("text", JsonValue.Text(text)))
            fontSize?.let { members.add(JsonMember("fontSize", JsonValue.Number(it))) }
            return JsonValue.Object(members)
        }

    companion object {
        /** A stored body: an object with its `rect` and `text`, and a `fontSize` when it has one. */
        fun of(json: JsonValue): PdfTextNoteBody? {
            val obj = json.objectValue ?: return null
            val text = obj["text"]?.stringValue ?: return null
            val rect = obj["rect"]?.let(PdfRect::of) ?: return null
            return PdfTextNoteBody(rect, text, obj["fontSize"]?.doubleValue)
        }
    }
}

/** What a caller says about a new mark. */
data class PdfMarkInput(
    /** 0-based page index. */
    val page: Int,
    val kind: PdfMarkKind,
    val color: String,
    /** Text marks: the marked lines. Not allowed on a text note or ink. */
    val rects: List<PdfRect>? = null,
    val quote: String = "",
    /** One line. */
    val comment: String = "",
    /** A text note: `PdfTextNoteBody.json`. Ink: the page's strokes. Not allowed on text marks. `JsonValue.Null` is no body. */
    val body: JsonValue? = null,
    /** Ties the per-page records of one selection that crossed pages together. */
    val groupUuid: String? = null,
)

/**
 * What a caller may change of a mark already made; its page, kind and group never change. Anything left null stays as it was.
 * `rects`: null keeps the rectangles; `NewRects(null)` takes them away (which only a text note or ink can do, as only they have none).
 * `body`: null keeps the body; `JsonValue.Null` takes it away (which only a text mark can do).
 */
data class PdfMarkChanges(
    val color: String? = null,
    val comment: String? = null,
    val quote: String? = null,
    val rects: NewRects? = null,
    val body: JsonValue? = null,
) {
    /** The rectangles a mark is to have from now on, none included (Swift's `.some(nil)`). */
    data class NewRects(val rects: List<PdfRect>?)
}

/** A mark as it is stored: every field present and normalised. */
data class ValidPdfMark(
    val page: Int,
    val kind: PdfMarkKind,
    val color: String,
    val rects: List<PdfRect>?,
    val quote: String,
    val comment: String,
    val body: JsonValue?,
    val groupUuid: String?,
) {
    /** What the `rects` column holds. */
    internal val rectsJson: String? get() = rects?.let { list -> JsonValue.Array(list.map { it.json }).serialized() }

    /** What the `body` column holds. */
    internal val bodyJson: String? get() = body?.serialized()
}

/** Where the reader was in a PDF, remembered per device (not a bookmark). */
data class PdfViewState(val page: Long? = null, val zoom: Double? = null, val darkPages: Boolean? = null) {
    /** The same state with what is not sane dropped, as it is stored. */
    fun normalized(): PdfViewState = normalizing(json)

    /** Only the keys it has, in the order the desktop writes them. */
    val json: JsonValue
        get() {
            val members = ArrayList<JsonMember>()
            page?.let { members.add(JsonMember("page", JsonValue.Number(it.toDouble()))) }
            zoom?.let { members.add(JsonMember("zoom", JsonValue.Number(it))) }
            darkPages?.let { members.add(JsonMember("darkPages", JsonValue.Bool(it))) }
            return JsonValue.Object(members)
        }

    companion object {
        /** Keeps the three known keys, when they are sane, and drops the rest. */
        fun normalizing(value: JsonValue): PdfViewState {
            val obj = value.objectValue ?: return PdfViewState()
            val page = obj["page"]?.integerValue?.takeIf { it >= 0 }
            val zoom = obj["zoom"]?.doubleValue?.takeIf { it.isFinite() && it >= 0.1 && it <= 10 }?.let(PdfMarkup::round3)
            val darkPages = (obj["darkPages"] as? JsonValue.Bool)?.value
            return PdfViewState(page, zoom, darkPages)
        }

        /** The stored `view_state` column; a missing or damaged one is an empty state. */
        fun stored(text: String?): PdfViewState {
            if (text.isNullOrEmpty()) return PdfViewState()
            val value = runCatching { JsonValue.parse(text) }.getOrNull() ?: return PdfViewState()
            return normalizing(value)
        }
    }
}

object PdfMarkup {
    /** The five `<Mark>` colors a text mark can have (docs/ui/text-highlighting.md): names, never hex values. */
    val MARK_COLORS = listOf("yellow", "green", "blue", "pink", "orange")

    const val MAX_COMMENT_LENGTH = 500
    const val MAX_BOOKMARK_LABEL_LENGTH = 200

    /** Far past any real page (a PDF's own limit is 14,400 units), near enough to catch garbage. */
    internal const val COORDINATE_LIMIT = 1e7

    /** `Math.round`: a half goes toward +infinity (-0.5 is -0), which `Math.rint` and `roundToLong` do not do. */
    internal fun javaScriptRound(value: Double): Double {
        val down = floor(value)
        return if (value - down >= 0.5) down + 1 else down
    }

    /** `Math.round(value * 1000) / 1000` */
    internal fun round3(value: Double): Double = javaScriptRound(value * 1000) / 1000

    /** Checks a mark and returns it as it is stored. Throws `InvalidMarkException`. */
    fun validate(input: PdfMarkInput): ValidPdfMark {
        if (input.page < 0) throw InvalidMarkException("A page is a whole number from 0.")
        val kind = input.kind

        if (if (kind.marksText) input.color !in MARK_COLORS else !isColorName(input.color)) {
            throw InvalidMarkException(if (kind.marksText) "A ${kind.rawValue} is ${MARK_COLORS.joinToString(", ")}." else "A color is a lowercase name.")
        }

        val comment = oneLine(input.comment)
        if (comment.length > MAX_COMMENT_LENGTH) throw InvalidMarkException("A comment can be at most $MAX_COMMENT_LENGTH characters.")

        input.groupUuid?.let { if (!isHexUuid(it)) throw InvalidMarkException("A group is a 32-character lowercase hex uuid.") }

        val body = if (input.body == JsonValue.Null) null else input.body

        if (kind.marksText) {
            if (body != null) throw InvalidMarkException("A ${kind.rawValue} has rectangles, not a body.")
            val rects = input.rects
            if (rects.isNullOrEmpty()) throw InvalidMarkException("A ${kind.rawValue} needs at least one rectangle.")
            return ValidPdfMark(input.page, kind, input.color, rects.map { it.normalized() }, input.quote, comment, null, input.groupUuid)
        }

        if (input.rects != null) throw InvalidMarkException("A ${kind.rawValue} has a body, not rectangles.")
        if (input.quote.isNotEmpty()) throw InvalidMarkException("A ${kind.rawValue} has no quote.")
        if (input.groupUuid != null) throw InvalidMarkException("A ${kind.rawValue} is not part of a selection that crossed pages.")

        if (kind == PdfMarkKind.TEXT) {
            val obj = body?.objectValue
            val text = obj?.get("text")?.stringValue
            if (obj == null || text == null) throw InvalidMarkException("A text note's body is its rect and its text.")
            var fontSize: Double? = null
            val given = obj["fontSize"]
            if (given != null) {
                val size = given.doubleValue
                if (size == null || !size.isFinite() || size < 1 || size > 200) throw InvalidMarkException("A text note's font size is from 1 to 200.")
                fontSize = round3(size)
            }
            val box = obj["rect"]?.let(PdfRect::of) ?: throw InvalidMarkException("A text note box is four finite numbers: x0, y0, x1, y1.")
            val note = PdfTextNoteBody(box.normalized("text note box"), text, fontSize)
            return ValidPdfMark(input.page, PdfMarkKind.TEXT, input.color, null, input.quote, comment, note.json, null)
        }

        // ink: the stroke format is another slice's (the iPad design's D9), so any JSON object or array will do
        if (body !is JsonValue.Object && body !is JsonValue.Array) throw InvalidMarkException("Ink needs its strokes as the body.")
        return ValidPdfMark(input.page, PdfMarkKind.INK, input.color, null, input.quote, comment, body, null)
    }

    /** A bookmark's label: one line, at most `MAX_BOOKMARK_LABEL_LENGTH` characters, possibly empty (the page number is shown then). */
    fun validateBookmarkLabel(label: String): String {
        val text = oneLine(label)
        if (text.length > MAX_BOOKMARK_LABEL_LENGTH) throw InvalidMarkException("A bookmark's label can be at most $MAX_BOOKMARK_LABEL_LENGTH characters.")
        return text
    }

    // The small rules -----------------------------------------------------------------------------------------------------------

    /** `^[a-z][a-z0-9-]{0,31}$` */
    internal fun isColorName(text: String): Boolean {
        if (text.length !in 1..32 || text[0] !in 'a'..'z') return false
        return text.drop(1).all { it in 'a'..'z' || it in '0'..'9' || it == '-' }
    }

    /** `^[0-9a-f]{32}$` */
    fun isHexUuid(text: String): Boolean = text.length == 32 && text.all { it in '0'..'9' || it in 'a'..'f' }

    // `text.replace(/\s*[\r\n]+\s*/g, " ").trim()`: a run of white space with a line break in it becomes one space, then both ends are
    // trimmed (`JavaScriptText`'s white space, which is not the platform's).
    internal fun oneLine(text: String): String {
        val joined = StringBuilder()
        val run = StringBuilder()
        var runHasBreak = false
        fun endRun() {
            if (runHasBreak) joined.append(' ') else joined.append(run)
            run.clear()
            runHasBreak = false
        }
        for (c in text) {
            if (JavaScriptText.isWhitespace(c.code)) {
                run.append(c)
                if (c == '\n' || c == '\r') runHasBreak = true
            } else {
                endRun()
                joined.append(c)
            }
        }
        endRun()
        return JavaScriptText.trim(joined.toString())
    }
}
