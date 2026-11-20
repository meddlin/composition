package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.json.JsonMember
import com.rushinglabs.composition.core.json.JsonParseError
import com.rushinglabs.composition.core.json.JsonValue
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import kotlin.math.abs

// The stroke JSON (docs/architecture/ink.md), ported from InkJSON.swift. The shape, with a point's columns named once for the whole
// drawing instead of once per point (a dense page has hundreds of thousands of points, so the names would be most of the text):
//
//     { "format": "composition-ink", "version": 1,
//       "canvas": { "width": 834, "height": 1194 },
//       "fields": ["x", "y", "t", "force", "altitude", "azimuth", "width", "height", "opacity"],
//       "strokes": [ { "ink": "pen", "color": "ink", "points": [[10.5, 20, 0, 1, 1.571, 0, 3, 3, 1], …] }, … ] }
//
// Reading is strict about what it needs (a canvas, strokes with finite points, a colour it can read) and keeps the rest: a member or a
// column it does not know is carried to the next write. Numbers are written the way JavaScript writes them, rounded to the steps in
// `InkPoint.STEPS`, so the same drawing is the same text wherever it is written.

// Reading

/** UTF-8 JSON, as stored in a drawing's PNG or in a PDF mark's body. */
fun InkDocument.Companion.fromData(data: ByteArray): InkDocument {
    if (data.size > InkLimits.MAX_JSON_BYTES) throw InkError("This drawing is too large to open.")
    val text = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(data))
            .toString()
    } catch (_: CharacterCodingException) {
        throw InkError("This drawing's text is not UTF-8.")
    }
    val json = try {
        JsonValue.parse(text)
    } catch (_: JsonParseError) {
        throw InkError("This drawing's JSON is damaged.")
    }
    return fromJson(json)
}

fun InkDocument.Companion.fromJson(json: JsonValue): InkDocument {
    val obj = json.objectValue ?: throw InkError("A drawing is a JSON object.")
    if (obj["format"]?.stringValue != FORMAT_NAME) throw InkError("This is not a Composition drawing.")
    val version = obj["version"]?.integerValue
    if (version == null || version < 1) throw InkError("This drawing has no version.")
    if (version > CURRENT_VERSION) throw InkError("This drawing was made by a newer version of Composition.")
    val canvas = obj["canvas"]?.objectValue
    val width = canvas?.get("width")?.doubleValue
    val height = canvas?.get("height")?.doubleValue
    if (width == null || height == null || !(width > 0) || !(height > 0) || width > InkLimits.MAX_CANVAS || height > InkLimits.MAX_CANVAS) {
        throw InkError("This drawing's canvas has no usable size.")
    }

    val fields = readFields(obj["fields"])
    val strokeValues = obj["strokes"]?.arrayValue ?: throw InkError("This drawing has no list of strokes.")
    if (strokeValues.size > InkLimits.MAX_STROKES) throw InkError("This drawing has too many strokes.")

    var total = 0
    val strokes = ArrayList<InkStroke>(strokeValues.size)
    strokeValues.forEachIndexed { index, value ->
        val stroke = readStroke(value, index + 1, fields)
        total += stroke.points.size
        if (total > InkLimits.MAX_POINTS) throw InkError("This drawing has too many points.")
        strokes.add(stroke)
    }

    return InkDocument(width, height, strokes, obj.members.filter { it.key !in DOCUMENT_KEYS })
}

private val DOCUMENT_KEYS = setOf("format", "version", "canvas", "fields", "strokes")
private val STROKE_KEYS = setOf("ink", "color", "points")

/** Which column of a point is which: a position in `InkPoint.FIELD_NAMES`, or the name of a column this code keeps without knowing. */
private sealed class Column {
    class Known(val slot: Int) : Column()
    class Extra(val name: String) : Column()
}

private fun readFields(value: JsonValue?): List<Column> {
    if (value == null) return InkPoint.FIELD_NAMES.indices.map { Column.Known(it) }
    val names = value.arrayValue?.map { it.stringValue }
    if (names == null || names.contains(null)) throw InkError("This drawing's point fields are not a list of names.")
    val list = names.filterNotNull()
    if (list.toSet().size != list.size || "x" !in list || "y" !in list) {
        throw InkError("This drawing's point fields must be distinct and include x and y.")
    }
    return list.map { name -> InkPoint.FIELD_NAMES.indexOf(name).let { if (it >= 0) Column.Known(it) else Column.Extra(name) } }
}

private fun readStroke(value: JsonValue, number: Int, fields: List<Column>): InkStroke {
    val obj = value.objectValue ?: throw InkError("Stroke $number is not an object.")
    val ink = InkType(optionalString(obj["ink"], "pen", "ink", number))
    val colorText = optionalString(obj["color"], "ink", "colour", number)
    val color = InkColor.parse(colorText) ?: throw InkError("Stroke $number has a colour that cannot be read.")
    val rows = obj["points"]?.arrayValue ?: throw InkError("Stroke $number has no points.")

    val extraNames = fields.mapNotNull { (it as? Column.Extra)?.name }
    val extraValues = List(extraNames.size) { ArrayList<JsonValue>(rows.size) }
    val points = ArrayList<InkPoint>(rows.size)
    for (row in rows) {
        val cells = row.arrayValue
        if (cells == null || cells.size > fields.size) throw InkError("Stroke $number has a point that does not fit the fields.")
        val values = InkPoint.DEFAULTS
        var extraIndex = 0
        fields.forEachIndexed { position, column ->
            val cell = if (position < cells.size) cells[position] else JsonValue.Null
            when (column) {
                is Column.Known -> when {
                    cell == JsonValue.Null -> {}
                    cell is JsonValue.Number && cell.value.isFinite() -> values[column.slot] = cell.value
                    else -> throw InkError("Stroke $number has a point with a value that is not a number.")
                }
                is Column.Extra -> {
                    extraValues[extraIndex].add(cell)
                    extraIndex += 1
                }
            }
        }
        if (abs(values[0]) > InkLimits.MAX_COORDINATE || abs(values[1]) > InkLimits.MAX_COORDINATE) {
            throw InkError("Stroke $number has a point far outside the page.")
        }
        points.add(InkPoint.of(values))
    }

    return InkStroke(
        ink = ink,
        color = color,
        points = points,
        extraColumns = extraNames.zip(extraValues).map { (name, values) -> InkExtraColumn(name, values) },
        extra = obj.members.filter { it.key !in STROKE_KEYS },
    )
}

private fun optionalString(value: JsonValue?, fallback: String, what: String, number: Int): String {
    if (value == null) return fallback
    return value.stringValue ?: throw InkError("Stroke $number's $what is not text.")
}

// Writing

/** Compact JSON text; members and strokes in order, then whatever was kept from a reader's input. */
fun InkDocument.jsonData(): ByteArray = json.serialized().encodeToByteArray()

val InkDocument.json: JsonValue
    get() {
        val extraNames = ArrayList<String>()
        for (stroke in strokes) {
            for (column in stroke.extraColumns) {
                if (column.name !in InkPoint.FIELD_NAMES && column.name !in extraNames) extraNames.add(column.name)
            }
        }
        val fieldNames = InkPoint.FIELD_NAMES + extraNames

        val members = mutableListOf(
            JsonMember("format", JsonValue.Text(InkDocument.FORMAT_NAME)),
            JsonMember("version", JsonValue.Number(InkDocument.CURRENT_VERSION.toDouble())),
            JsonMember(
                "canvas",
                JsonValue.Object(
                    "width" to JsonValue.Number(InkDocument.stored(width, 0.01)),
                    "height" to JsonValue.Number(InkDocument.stored(height, 0.01)),
                ),
            ),
            JsonMember("fields", JsonValue.Array(fieldNames.map { JsonValue.Text(it) })),
            JsonMember("strokes", JsonValue.Array(strokes.map { it.json(extraNames) })),
        )
        members.addAll(extra.filter { it.key !in DOCUMENT_KEYS })
        return JsonValue.Object(members)
    }

/** `value` as a number with the decimals of `step`: the whole number divided by 10, 100 or 1000 is the number the text names, so it prints short. */
fun InkDocument.Companion.stored(value: Double, step: Double): Double {
    val scale = roundHalfAway(1 / step)
    return roundHalfAway(value * scale) / scale
}

private fun InkStroke.json(extraNames: List<String>): JsonValue {
    val extraColumnValues = extraNames.map { name -> extraColumns.firstOrNull { it.name == name }?.values }
    val defaults = InkPoint.DEFAULTS
    val rows = ArrayList<JsonValue>(points.size)
    points.forEachIndexed { index, point ->
        val cells = ArrayList<JsonValue>(InkPoint.FIELD_NAMES.size + extraNames.size)
        point.values.forEachIndexed { slot, value ->
            cells.add(JsonValue.Number(InkDocument.stored(if (value.isFinite()) value else defaults[slot], InkPoint.STEPS[slot])))
        }
        for (column in extraColumnValues) cells.add(column?.getOrNull(index) ?: JsonValue.Null)
        rows.add(JsonValue.Array(cells))
    }
    val members = mutableListOf(
        JsonMember("ink", JsonValue.Text(ink.rawValue)),
        JsonMember("color", JsonValue.Text(color.text)),
        JsonMember("points", JsonValue.Array(rows)),
    )
    members.addAll(extra.filter { it.key !in STROKE_KEYS })
    return JsonValue.Object(members)
}

// Telling a PencilKit blob from stale

/** SHA-256, in hex, of the strokes as they are written (the `strokes` member, not the rest): two drawings with the same strokes have the same digest. */
val InkDocument.strokesDigest: String
    get() {
        val strokes = json.objectValue?.get("strokes")?.serialized() ?: "[]"
        return MessageDigest.getInstance("SHA-256").digest(strokes.encodeToByteArray())
            .joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }
    }

/**
 * This drawing noting that the PencilKit blob saved beside these strokes was made from exactly these strokes, in a member of the drawing
 * that every reader keeps. Another program that changes the strokes does not know to change this, so the digest no longer matches, and
 * the iPad prefers the strokes. (Swift's `markPencilKitCurrent()`, which changes the drawing in place.)
 */
fun InkDocument.markingPencilKitCurrent(): InkDocument =
    copy(extra = extra.filter { it.key != "pencilKit" } + JsonMember("pencilKit", JsonValue.Object("strokes" to JsonValue.Text(strokesDigest))))

/** Whether the strokes are still the ones the PencilKit blob was made from (false when it was never marked). */
val InkDocument.pencilKitBlobIsCurrent: Boolean
    get() = extra.firstOrNull { it.key == "pencilKit" }?.value?.objectValue?.get("strokes")?.stringValue == strokesDigest
