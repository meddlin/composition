package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.json.JsonMember
import com.rushinglabs.composition.core.json.JsonValue
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.withSign

// What a drawing is: the ink stroke format (docs/architecture/ink.md, design decision D9), ported from InkModel.swift. A drawing is a
// canvas size and a list of strokes; a stroke is an ink (its type and colour) and the points the pen sampled. The model keeps what it
// does not understand (members of the drawing or a stroke, columns of the points) so that a newer or other-platform writer's additions
// survive an edit here.
//
// Nothing in this package touches Android: the format has to be readable by the CLI's and the desktop's renderers too, and the JVM on
// a Mac must be able to check it. Drawing on screen (Jetpack Ink) and painting pixels (Canvas) are the app's.

/** A kind of ink. PencilKit's own names, as text; a name this code does not know is kept and drawn like a pen. */
data class InkType(val rawValue: String) {
    val isKnown: Boolean get() = this in KNOWN

    companion object {
        val PEN = InkType("pen")
        val PENCIL = InkType("pencil")
        val MARKER = InkType("marker")
        val MONOLINE = InkType("monoline")
        val FOUNTAIN_PEN = InkType("fountainPen")
        val WATERCOLOR = InkType("watercolor")
        val CRAYON = InkType("crayon")

        val KNOWN: List<InkType> = listOf(PEN, PENCIL, MARKER, MONOLINE, FOUNTAIN_PEN, WATERCOLOR, CRAYON)
    }
}

/**
 * A stroke's colour: a name the theme resolves (`ink`, `accent`, or a `<Mark>` colour such as `yellow`) or a fixed `#rrggbb`. Black ink
 * is `ink` because it has to turn white on a dark scheme; a colour somebody chose stays as chosen.
 */
sealed class InkColor {
    data class Semantic(val name: String) : InkColor()
    data class Fixed(val color: ThemeColor) : InkColor()

    val text: String
        get() = when (this) {
            is Semantic -> name
            is Fixed -> color.hex
        }

    companion object {
        val INK: InkColor = Semantic("ink")
        val ACCENT: InkColor = Semantic("accent")

        /** `ink`, `accent`, `yellow`… (lower case letters, digits and dashes, up to 32) or `#rrggbb`; null for anything else. */
        fun parse(text: String): InkColor? {
            ThemeColor.fromHex(text)?.let { return Fixed(it) }
            val utf8 = text.encodeToByteArray()
            if (text.isNotEmpty() && utf8.size <= 32 && utf8.all { it in 0x61..0x7A || it in 0x30..0x39 || it == 0x2D.toByte() }) {
                return Semantic(text)
            }
            return null
        }
    }
}

/**
 * One sampled point of a stroke, in the units PencilKit uses: points of the canvas, seconds turned to milliseconds, radians. Equal as
 * Swift's synthesized `==` compares doubles (`0` equals `-0`), not as a Kotlin data class would.
 */
data class InkPoint(
    val x: Double,
    val y: Double,
    /** Milliseconds since the stroke began. */
    val t: Double = 0.0,
    /** 0 to 1 and more (PencilKit's `force`, 1 being an average touch); a finger or a mouse reports 1. */
    val force: Double = 1.0,
    /** Radians: π/2 is the Pencil upright, 0 flat on the glass. A point with no tilt is upright, as π/2 comes at the format's step. */
    val altitude: Double = 1.571,
    /** Radians around the screen's vertical. */
    val azimuth: Double = 0.0,
    /** The nib's size at this point, in canvas points (PencilKit's `size`). */
    val width: Double = 3.0,
    val height: Double = 3.0,
    val opacity: Double = 1.0,
) {
    internal val values: DoubleArray get() = doubleArrayOf(x, y, t, force, altitude, azimuth, width, height, opacity)

    override fun equals(other: Any?): Boolean =
        other is InkPoint && x == other.x && y == other.y && t == other.t && force == other.force && altitude == other.altitude &&
            azimuth == other.azimuth && width == other.width && height == other.height && opacity == other.opacity

    override fun hashCode(): Int = values.fold(17) { hash, value -> 31 * hash + (if (value == 0.0) 0.0 else value).hashCode() }

    companion object {
        /** The columns of a point as the format names them, in the order this code writes them. */
        val FIELD_NAMES: List<String> = listOf("x", "y", "t", "force", "altitude", "azimuth", "width", "height", "opacity")

        /** How finely each column is stored: a hundredth of a point, a millisecond, a thousandth of a radian or of a share. */
        internal val STEPS: DoubleArray = doubleArrayOf(0.01, 0.01, 1.0, 0.001, 0.001, 0.001, 0.01, 0.01, 0.001)

        /** What a missing column means. */
        internal val DEFAULTS: DoubleArray get() = InkPoint(0.0, 0.0).values

        internal fun of(values: DoubleArray) =
            InkPoint(values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8])
    }
}

/** A column of points the format has and this code does not: its name, and one value per point. */
data class InkExtraColumn(val name: String, val values: List<JsonValue>)

data class InkStroke(
    val ink: InkType = InkType.PEN,
    val color: InkColor = InkColor.INK,
    val points: List<InkPoint>,
    /** Point columns written by someone else's newer version, kept so an edit here does not lose them. */
    val extraColumns: List<InkExtraColumn> = emptyList(),
    /** Members of the stroke this code does not know, in their order. */
    val extra: List<JsonMember> = emptyList(),
)

data class InkDocument(
    /** The drawing's own coordinate space, in points: a stroke's x and y lie in `0..width` and `0..height` unless the page was drawn past its edge. */
    val width: Double,
    val height: Double,
    val strokes: List<InkStroke> = emptyList(),
    /** Members of the drawing this code does not know, in their order. */
    val extra: List<JsonMember> = emptyList(),
) {
    val pointCount: Int get() = strokes.sumOf { it.points.size }

    val isEmpty: Boolean get() = strokes.isEmpty()

    companion object {
        /**
         * The format's name and the version this code writes and reads. A change that older readers would misdraw bumps the version; an
         * addition they can skip does not, and is kept by `extra`.
         */
        const val FORMAT_NAME = "composition-ink"
        const val CURRENT_VERSION = 1
    }
}

/** A drawing that cannot be read, or one that is too big to be a real page; the message is safe to show. */
class InkError(override val message: String) : Exception(message) {
    override fun equals(other: Any?): Boolean = other is InkError && other.message == message
    override fun hashCode(): Int = message.hashCode()
}

/** What a drawing may hold. A real page has some thousands of strokes; these stop a damaged or hostile file from using all the memory. */
object InkLimits {
    const val MAX_STROKES = 100_000
    const val MAX_POINTS = 5_000_000
    /** A drawing's canvas, and how far a point may lie from the origin. */
    const val MAX_CANVAS = 100_000.0
    const val MAX_COORDINATE = 1_000_000.0
    /** The JSON text, before it is parsed. */
    const val MAX_JSON_BYTES = 256 * 1024 * 1024
}

/** Swift's `rounded()`: to the nearest whole number, a half away from zero. Kotlin's `round` takes a half to the even one. */
internal fun roundHalfAway(value: Double): Double {
    val magnitude = abs(value)
    val whole = floor(magnitude)
    return (if (magnitude - whole >= 0.5) whole + 1 else whole).withSign(value)
}

/** Swift's `min`: `y < x ? y : x`, so a NaN second argument is passed over (Kotlin's `min` returns NaN). */
internal fun swiftMin(x: Double, y: Double): Double = if (y < x) y else x

/** Swift's `max`: `y >= x ? y : x`. */
internal fun swiftMax(x: Double, y: Double): Double = if (y >= x) y else x
