package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.appearance.Appearance
import com.rushinglabs.composition.core.appearance.FontFamily
import com.rushinglabs.composition.core.appearance.Theme
import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.editing.MarkHighlight
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The colour schemes against the desktop's own files; ported from AppearanceConformanceTests.swift. appearance-expected.json is what
// `globals.css` (read the way `markContrast.test.ts` reads it), `themes.ts`, `highlightColors.ts`, `Chart.tsx`, `editorFonts.ts` and
// `previewFonts.ts` hold: the five palettes' tokens, the `<Mark>` hues and tint strengths, the contrast of the text on each tint (worked
// out by the desktop's own formula), the derived shares, the chart's series recipes and the font choices.

private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonElement?.double(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.content?.toDoubleOrNull()

private fun JsonElement?.strings(): List<String> = this?.jsonArray?.map { it.string()!! } ?: emptyList()

@DisplayName("The colour schemes against the desktop")
class AppearanceConformanceTests {
    private fun load(): JsonObject = readJson(fixture("appearance-expected.json")).jsonObject

    /** `[{name, label}]` as pairs. */
    private fun choices(value: JsonElement?): List<Pair<String, String>> =
        value!!.jsonArray.map { it.jsonObject["name"].string()!! to it.jsonObject["label"].string().orEmpty() }

    @Test
    @DisplayName("the schemes and their names are the desktop's, and Follow the sun is the one it has by name that the app wears another way")
    fun names() {
        val expected = load()
        val themes = choices(expected["themes"])
        assertEquals(themes.map { it.first }, SettingsStore.THEME_NAMES, "the settings file may hold these names")
        assertEquals(themes.map { it.first }.filter { it != "auto" }, Appearance.THEME_NAMES)
        assertEquals(Appearance.THEME_NAMES, Theme.ALL.map { it.name })
        for ((name, label) in themes) if (name != "auto") assertEquals(label, Theme.named(name)?.label, "the label of $name")
        assertEquals(expected["defaultTheme"].string(), Theme.DEFAULT.name)
        assertEquals(expected["defaultTheme"].string(), SettingsStore.DEFAULT_THEME)
        println("Appearance, names: ${themes.size} of ${themes.size} scheme names agree with the desktop")
    }

    @Test
    @DisplayName("every token of every scheme is the stylesheet's, to the digit")
    fun palettes() {
        val palettes = load().getValue("palettes").jsonObject
        val different = ArrayList<String>()
        var compared = 0
        for (theme in Theme.ALL) {
            val palette = palettes[theme.name] as? JsonObject
            if (palette == null) {
                different.add("${theme.name}: not in the stylesheet")
                continue
            }
            compared += comparePaletteWithStylesheet(theme.name, theme, palette, different)
        }
        println("Appearance, palettes: ${compared - different.size} of $compared tokens agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
    }

    @Test
    @DisplayName("the translucent tokens are the foreground at the desktop's shares, and the aliases are the ones assumed")
    fun derived() {
        val expected = load()
        val derived = expected.getValue("derived").jsonObject
        assertEquals(derived["muted"].double(), Theme.Share.MUTED * 100)
        assertEquals(derived["mutedForeground"].double(), Theme.Share.MUTED_FOREGROUND * 100)
        assertEquals(derived["accent"].double(), Theme.Share.ACCENT * 100)
        assertEquals(derived["border"].double(), Theme.Share.BORDER * 100)
        assertEquals(derived["input"].double(), Theme.Share.INPUT * 100)
        // `Theme.token` reads these as the foreground, the error colour and the surface.
        val aliases = expected.getValue("aliases").jsonObject
        assertEquals("foreground", aliases["primary"].string())
        assertEquals("error", aliases["destructive"].string())
        assertEquals("surface", aliases["card"].string())
        println("Appearance, derived tokens: 5 of 5 shares and 3 of 3 aliases agree with the desktop")
    }

    @Test
    @DisplayName("the five highlight colours, their hues and what text on each tint comes to in every scheme")
    fun marks() {
        val expected = load()
        val colors = expected["highlightColors"].strings()
        assertEquals(colors, MarkHighlight.colors)
        assertEquals(expected["defaultHighlightColor"].string(), MarkHighlight.DEFAULT_COLOR)
        assertEquals(colors.toSet(), Theme.MARK_HUES.keys)
        for ((name, hex) in expected.getValue("markHues").jsonObject) assertEquals(hex.string(), Theme.MARK_HUES[name]?.hex, "hue $name")
        val contrast = expected.getValue("markContrast").jsonObject
        val different = ArrayList<String>()
        var compared = 0
        for (theme in Theme.ALL) {
            val ratios = contrast.getValue(theme.name).jsonObject
            for (color in colors) {
                compared++
                val ours = ThemeColor.contrast(theme.foreground, theme.markTint(color))
                val theirs = ratios[color].double() ?: -1.0
                if (abs(ours - theirs) >= 1e-9) different.add("${theme.name} $color: $ours against the desktop's $theirs")
                if (ours < 4.5) different.add("${theme.name} $color is not legible: $ours")
            }
        }
        println("Appearance, <Mark> tints: ${compared - different.size} of $compared contrasts agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
    }

    @Test
    @DisplayName("the chart's series colours are the recipes Chart.tsx writes")
    fun series() {
        assertEquals(load()["series"].strings(), Theme.SERIES_RECIPES)
        println("Appearance, chart series: ${Theme.SERIES_RECIPES.size} of ${Theme.SERIES_RECIPES.size} recipes agree with the desktop")
    }

    @Test
    @DisplayName("the font defaults are the kinds the desktop's are")
    fun fonts() {
        val expected = load()
        val editorFonts = expected.getValue("editorFonts").jsonArray.map { it.jsonObject }
        val defaultEditor = expected["defaultEditorFont"].string()
        assertEquals("monospace", editorFonts.first { it["name"].string() == defaultEditor }["kind"].string())
        assertEquals(FontFamily.MONO, FontFamily.EDITOR_DEFAULT)
        val previewFonts = choices(expected["previewFonts"])
        val defaultPreview = expected["defaultPreviewFont"].string()
        assertTrue(previewFonts.first { it.first == defaultPreview }.second.startsWith("Geist ("), "the desktop's preview default is a sans serif, not Geist Mono")
        assertEquals(FontFamily.SANS, FontFamily.PREVIEW_DEFAULT)
        assertTrue(previewFonts.any { it.first == "mono" } && previewFonts.any { it.first == "source-serif" }, "it also offers a monospaced and a serif preview")
        println("Appearance, fonts: 2 of 2 defaults agree with the desktop")
    }
}
