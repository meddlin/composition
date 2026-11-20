package com.rushinglabs.composition.core.appearance

import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * An opaque sRGB colour, as the desktop's palettes write it (`#rrggbb`), with the arithmetic its `<Mark>` tints and chart colours need
 * (ported from ThemeColor.swift). A plain value: the app turns it into a Compose colour (`argb`), the core never does.
 */
data class ThemeColor(val red: Int, val green: Int, val blue: Int) {
    /** Lower case, as the desktop's stylesheet has them. */
    val hex: String get() = String.format(Locale.ROOT, "#%02x%02x%02x", red, green, blue)

    /** The colour as one opaque ARGB integer, the form Android's colour types take. */
    val argb: Int get() = (0xFF shl 24) or (red shl 16) or (green shl 8) or blue

    /** WCAG relative luminance (the formula `markContrast.test.ts` uses). */
    val luminance: Double get() {
        fun channel(value: Int): Double {
            val c = value.toDouble() / 255
            return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    /** This colour at `alpha` (0 to 1) over `bottom`, each channel rounded half up, as the desktop's `blend` does it for a `<Mark>` tint. */
    fun over(bottom: ThemeColor, alpha: Double): ThemeColor {
        fun channel(top: Int, under: Int): Int = roundHalfAwayFromZero(top.toDouble() * alpha + under.toDouble() * (1 - alpha))
        return ThemeColor(channel(red, bottom.red), channel(green, bottom.green), channel(blue, bottom.blue))
    }

    /** CSS `color-mix(in srgb, self share, other)`: this colour for `share` (0 to 1) and `other` for the rest. */
    fun mixed(with: ThemeColor, share: Double): ThemeColor = over(with, share)

    companion object {
        /** `#rrggbb` (any case); null for anything else. */
        fun fromHex(hex: String): ThemeColor? {
            if (hex.length != 7 || hex[0] != '#') return null
            if (!hex.substring(1).all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
            val value = hex.substring(1).toInt(16)
            return ThemeColor((value shr 16) and 0xFF, (value shr 8) and 0xFF, value and 0xFF)
        }

        /** A colour the tables write as `#rrggbb`. */
        internal fun of(hex: String): ThemeColor = requireNotNull(fromHex(hex)) { "not a colour: $hex" }

        /** The contrast ratio of two colours, 1 to 21 (`(lighter + 0.05) / (darker + 0.05)`). */
        fun contrast(a: ThemeColor, b: ThemeColor): Double {
            val high = max(a.luminance, b.luminance)
            val low = min(a.luminance, b.luminance)
            return (high + 0.05) / (low + 0.05)
        }

        /**
         * Swift's `rounded(.toNearestOrAwayFromZero)` (and JavaScript's `Math.round` for what is never negative). `x - floor(x)` is
         * exact, unlike `floor(x + 0.5)`, which rounds 0.49999999999999994 up.
         */
        internal fun roundHalfAwayFromZero(value: Double): Int {
            if (value < 0) return -roundHalfAwayFromZero(-value)
            val whole = floor(value)
            return (if (value - whole >= 0.5) whole + 1 else whole).toInt()
        }
    }
}
