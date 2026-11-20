package com.rushinglabs.composition.core.appearance

import com.rushinglabs.composition.core.sun.Sun
import com.rushinglabs.composition.core.sun.SunPairName
import kotlin.math.max

/**
 * A colour scheme: the semantic tokens of the desktop's `app/globals.css`, one set per scheme (ported from Theme.swift). The screens
 * ask for a token (`background`, `surface`, `brand` …), never for a colour, so a scheme restyles every one of them. The tables are in
 * `ThemePalettes.kt` and `ThemeSunPalettes.kt`.
 */
data class Theme(
    val name: String,
    val label: String,
    /** `color-scheme: dark`: whether the system's own controls (the keyboard, the bars, a sheet's background) should be drawn dark. */
    val isDark: Boolean,
    val background: ThemeColor,
    val foreground: ThemeColor,
    val surface: ThemeColor,
    val panel: ThemeColor,
    val brand: ThemeColor,
    val brandDim: ThemeColor,
    val highlight: ThemeColor,
    val warning: ThemeColor,
    val error: ThemeColor,
    val success: ThemeColor,
    val link: ThemeColor,
    /** How strongly `<Mark>` tints its hue over the page, in percent (stronger on a light scheme, where a tint is paler). */
    val markAlpha: Double,
    val syntax: Syntax,
) {
    /** The colours of the editor's Markdown and the preview's code (`--syntax-*`). */
    data class Syntax(
        val comment: ThemeColor,
        val keyword: ThemeColor,
        val string: ThemeColor,
        val number: ThemeColor,
        val function: ThemeColor,
        val type: ThemeColor,
        val attr: ThemeColor,
    )

    /**
     * The shares of the foreground (the rest transparent) that the desktop's translucent tokens are: `--muted` is the foreground at 8%,
     * `--muted-foreground` at 60% (the grey text), `--accent` at 10%, `--border` at 10% and `--input` at 15%.
     */
    object Share {
        const val MUTED = 0.08
        const val MUTED_FOREGROUND = 0.60
        const val ACCENT = 0.10
        const val BORDER = 0.10
        const val INPUT = 0.15
    }

    // Legibility

    /**
     * The fill of a selected row and the text on it. The accent with white text when that reads at 4.5 or better (WCAG AA for text);
     * else the dimmer accent with white; else the accent with black. Forest's pale green accent is the scheme that needs the second.
     */
    data class Selection(val fill: ThemeColor, val text: ThemeColor)

    val selection: Selection get() {
        val white = ThemeColor(255, 255, 255)
        val black = ThemeColor(0, 0, 0)
        for ((fill, text) in listOf(brand to white, brandDim to white, brand to black)) {
            if (ThemeColor.contrast(fill, text) >= READABLE) return Selection(fill, text)
        }
        return Selection(brandDim, white)
    }

    /**
     * How much of the foreground the grey text is made of (the rest transparent). The desktop's `--muted-foreground` is 60%, which on
     * Light and Cream reads at 3.4 to 4.0 against the page and on the dark schemes at about 5.4; here it is raised in whole per cents
     * until it reads at `MUTED_TARGET` on the page, a card and the sidebar's panel. It is never lowered below the desktop's 60%.
     */
    val mutedShare: Double get() {
        val pages = listOf(background, surface, panel)
        for (percent in (Share.MUTED_FOREGROUND * 100).toInt()..100) {
            val share = percent.toDouble() / 100
            if (pages.all { ThemeColor.contrast(foreground.over(it, share), it) >= MUTED_TARGET }) return share
        }
        return 1.0
    }

    /**
     * `mutedShare`, or darker where the system's high-contrast text is on. This is the colour of the grey text and of the Live tab's
     * dimmed syntax (the marks that show while the caret touches their construct).
     */
    fun mutedShare(increasedContrast: Boolean): Double = if (increasedContrast) max(mutedShare, INCREASED_MUTED_SHARE) else mutedShare

    /**
     * The dimmed syntax where it sits on something other than the page, a `<Mark>`'s tint (a mark inside highlighted words): the grey
     * text's share, raised in whole per cents until the marks read at `READABLE` on that surface. (On the page and on the faint fill of
     * code the grey text reads at `MUTED_TARGET` or better as it is.)
     */
    fun dimmedShare(over: ThemeColor, increasedContrast: Boolean): Double {
        val least = mutedShare(increasedContrast)
        for (percent in ThemeColor.roundHalfAwayFromZero(least * 100)..100) {
            val share = percent.toDouble() / 100
            if (ThemeColor.contrast(foreground.over(over, share), over) >= READABLE) return share
        }
        return 1.0
    }

    // <Mark>

    /** What a `<Mark color="…">` looks like over this scheme's page: its hue at `markAlpha` over the background. An unknown or missing name is yellow, as on the desktop. */
    fun markTint(name: String?): ThemeColor {
        val hue = MARK_HUES[name?.lowercase() ?: ""] ?: MARK_HUES.getValue("yellow")
        return hue.over(background, markAlpha / 100)
    }

    // Charts

    /** `SERIES_RECIPES` worked out in this scheme. A chart with more series than colours starts over, as on the desktop. */
    val seriesColors: List<ThemeColor> get() = SERIES_RECIPES.map(::resolve)

    private fun token(name: String): ThemeColor = when (name) {
        "background" -> background
        "surface", "card" -> surface
        "panel" -> panel
        "brand" -> brand
        "highlight" -> highlight
        "warning" -> warning
        "error", "destructive" -> error
        "success" -> success
        "link" -> link
        else -> foreground  // `--primary` is the foreground, inverted against the background
    }

    /** A CSS colour of the two shapes the chart uses: `var(--name)` and `color-mix(in srgb, var(--a) N%, var(--b))`. */
    private fun resolve(recipe: String): ThemeColor {
        VARIABLE.matchEntire(recipe)?.let { return token(it.groupValues[1]) }
        MIX.matchEntire(recipe)?.let { match ->
            val percent = match.groupValues[2].toDouble()
            return token(match.groupValues[1]).mixed(token(match.groupValues[3]), percent / 100)
        }
        return foreground
    }

    companion object {
        /** The five schemes of the desktop, in its order (`ThemePalettes.kt`). */
        val ALL: List<Theme> get() = SCHEMES

        /**
         * The five palettes that exist only as halves of a Follow the sun pair (`ThemeSunPalettes.kt`). They are not schemes of their
         * own, so they are not in `ALL` and cannot be chosen by name.
         */
        val SUN_ONLY: List<Theme> get() = SUN_PALETTES

        /** The desktop's default scheme. */
        val DEFAULT: Theme get() = SCHEMES[0]

        fun named(name: String): Theme? = SCHEMES.firstOrNull { it.name == name }

        /** A palette a sun pair can use: one of the five schemes, or one of the five that exist only for the sun. */
        fun sunPalette(name: String): Theme? = (SCHEMES + SUN_PALETTES).firstOrNull { it.name == name }

        const val READABLE = 4.5

        /**
         * The contrast the grey text is made to reach on the pages: 5.5, a margin above the 4.5 that is the least for text this small,
         * because small strokes drawn on a screen measure a little below what the colours alone come to (the iPad's accessibility
         * audit failed a row at exactly 4.5).
         */
        const val MUTED_TARGET = 5.5

        /** With high-contrast text on, the grey text is made of at least this much of the foreground, and a rule (a hairline the Live tab draws) is firmer. */
        const val INCREASED_MUTED_SHARE = 0.85
        const val RULE_SHARE = 0.35
        const val INCREASED_RULE_SHARE = 0.7

        /** The share of the foreground a rule is drawn at. */
        fun ruleShare(increasedContrast: Boolean): Double = if (increasedContrast) INCREASED_RULE_SHARE else RULE_SHARE

        /** The hue of each of the five highlight colours (`--mark-hue`), the same in every scheme; the scheme tints it to its own background. */
        val MARK_HUES: Map<String, ThemeColor> = mapOf(
            "yellow" to ThemeColor.of("#f5c518"),
            "green" to ThemeColor.of("#3fb876"),
            "blue" to ThemeColor.of("#3b9eff"),
            "pink" to ThemeColor.of("#ff6fae"),
            "orange" to ThemeColor.of("#ff8a2b"),
        )

        /** The desktop's series colours, as `Chart.tsx` writes them: tokens, not hex values, so a chart reads in every scheme. */
        val SERIES_RECIPES = listOf(
            "var(--primary)",
            "var(--success)",
            "var(--warning)",
            "var(--destructive)",
            "color-mix(in srgb, var(--primary) 55%, var(--success))",
            "color-mix(in srgb, var(--warning) 60%, var(--destructive))",
        )

        private val VARIABLE = Regex("""var\(--([a-z-]+)\)""")
        private val MIX = Regex("""color-mix\(in srgb, var\(--([a-z-]+)\) ([0-9]+)%, var\(--([a-z-]+)\)\)""")

        /**
         * What Follow the sun looks like at a level (0 dark to 1 light) for a pair of colours, as the desktop's stylesheet makes it
         * (Theme+Sun.swift): the text, accents and code colours are one palette outright, the day's or the night's, switching at the
         * pair's `inkFlipLevel`; only the three surfaces (the page, the cards and the sidebar's panel) blend,
         * `color-mix(in srgb, day <auto-light>, night)`, by the percentage the page writes (one decimal).
         */
        fun sun(pair: SunPairName, level: Double): Theme {
            val day = pair.day
            val night = pair.night
            val theme = if (Sun.tone(level, pair.inkFlipLevel) == Sun.Tone.LIGHT) day else night
            val share = Sun.autoLightShare(level)
            return theme.copy(
                name = "auto",
                label = "Follow the sun",
                background = day.background.mixed(night.background, share),
                surface = day.surface.mixed(night.surface, share),
                panel = day.panel.mixed(night.panel, share),
            )
        }
    }
}

/** The palette a sun pair uses by day. */
val SunPairName.day: Theme get() = requireNotNull(Theme.sunPalette(dayName)) { "no palette $dayName" }

/** The palette a sun pair uses by night. */
val SunPairName.night: Theme get() = requireNotNull(Theme.sunPalette(nightName)) { "no palette $nightName" }
