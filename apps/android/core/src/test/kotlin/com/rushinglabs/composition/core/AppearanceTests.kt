package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.appearance.Appearance
import com.rushinglabs.composition.core.appearance.FontFamily
import com.rushinglabs.composition.core.appearance.SchemeChoice
import com.rushinglabs.composition.core.appearance.Theme
import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.appearance.appearance
import com.rushinglabs.composition.core.appearance.setEditorFont
import com.rushinglabs.composition.core.appearance.setPreviewFont
import com.rushinglabs.composition.core.appearance.setScheme
import com.rushinglabs.composition.core.appearance.setSunPair
import com.rushinglabs.composition.core.sun.SunPairName
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Appearance: schemes, tints and the settings that choose them; ported from AppearanceTests.swift.

@DisplayName("Appearance: schemes, tints and the settings that choose them")
class AppearanceTests {
    private fun store(scratch: File, file: String? = null): Pair<SettingsStore, DataLocation> {
        val location = DataLocation(File(scratch, "data"))
        if (file != null) {
            location.directory.mkdirs()
            location.settingsFile.writeText(file)
        }
        return SettingsStore(location) to location
    }

    private fun written(location: DataLocation): JsonObject = readJson(location.settingsFile).jsonObject

    private val white = ThemeColor(255, 255, 255)
    private val black = ThemeColor(0, 0, 0)

    // Colours

    @Test
    @DisplayName("a hex colour reads and writes back, and anything else is refused")
    fun hex() {
        assertEquals("#f5c518", ThemeColor.fromHex("#F5C518")?.hex)
        assertEquals(ThemeColor(0, 0, 0), ThemeColor.fromHex("#000000"))
        for (bad in listOf("", "f5c518", "#f5c51", "#f5c5188", "#gggggg", "#+12345", "#-12345", "#１２３４５６")) {
            assertNull(ThemeColor.fromHex(bad), bad)
        }
        assertEquals(0xFFF5C518.toInt(), ThemeColor.fromHex("#f5c518")!!.argb, "the colour Android draws with")
    }

    @Test
    @DisplayName("contrast is 21 between black and white, 1 for a colour with itself, and the same either way round")
    fun contrast() {
        assertTrue(abs(ThemeColor.contrast(black, white) - 21) < 1e-9)
        assertEquals(1.0, ThemeColor.contrast(black, black))
        val grey = ThemeColor(119, 119, 119)
        assertEquals(ThemeColor.contrast(white, grey), ThemeColor.contrast(grey, white))
    }

    @Test
    @DisplayName("a tint rounds each channel half up, as the desktop's blend does")
    fun blending() {
        // 255 * 0.5 + 0 * 0.5 = 127.5, which rounds up; 1 * 0.5 + 0 = 0.5, which rounds up too.
        assertEquals(ThemeColor(128, 1, 0), ThemeColor(255, 1, 0).over(ThemeColor(0, 0, 0), 0.5))
        assertEquals(ThemeColor(10, 20, 30), ThemeColor(10, 20, 30).over(ThemeColor(200, 100, 0), 1.0))
        assertEquals(ThemeColor(200, 100, 0), ThemeColor(10, 20, 30).over(ThemeColor(200, 100, 0), 0.0))
        // The rounding is Swift's `rounded()` (`swiftRounded`); SharedRulesTests holds its edges, such as just under a half.
    }

    // Schemes

    @Test
    @DisplayName("the text and the links can be read on every surface of every scheme, and the code colours on the surface, as the stylesheet promises")
    fun legibility() {
        for (theme in Theme.ALL) {
            for ((name, page) in listOf("background" to theme.background, "surface" to theme.surface, "panel" to theme.panel)) {
                assertTrue(ThemeColor.contrast(theme.foreground, page) >= 4.5, "${theme.name}: text on $name")
            }
            assertTrue(ThemeColor.contrast(theme.link, theme.background) >= 4.5, "${theme.name}: a link on the background")
            val syntax = with(theme.syntax) {
                listOf("comment" to comment, "keyword" to keyword, "string" to string, "number" to number, "function" to function, "type" to type, "attr" to attr)
            }
            for ((name, colour) in syntax) {
                assertTrue(ThemeColor.contrast(colour, theme.surface) >= 4.5, "${theme.name}: $name on the surface")
                assertTrue(ThemeColor.contrast(colour, theme.background) >= 4.5, "${theme.name}: $name on the page, where the editor draws it")
            }
        }
    }

    @Test
    @DisplayName("a selected row's text reads at 4.5 on its fill in every scheme, and Forest, whose accent is too pale for white, takes its dimmer one")
    fun selection() {
        for (theme in Theme.ALL) {
            val selection = theme.selection
            assertTrue(ThemeColor.contrast(selection.fill, selection.text) >= Theme.READABLE, theme.name)
        }
        val forest = Theme.named("forest")!!
        assertTrue(ThemeColor.contrast(forest.brand, white) < Theme.READABLE, "the accent alone would not do")
        assertEquals(forest.brandDim, forest.selection.fill)
        val dark = Theme.named("dark")!!
        assertEquals(Theme.Selection(dark.brand, white), dark.selection)
    }

    @Test
    @DisplayName("grey text reads at the target (5.5, a margin over 4.5) on the page, a card and the panel in every scheme, and is never lighter than the desktop's 60%")
    fun mutedText() {
        for (theme in Theme.ALL) {
            for ((name, page) in listOf("background" to theme.background, "surface" to theme.surface, "panel" to theme.panel)) {
                val grey = theme.foreground.over(page, theme.mutedShare)
                assertTrue(ThemeColor.contrast(grey, page) >= Theme.MUTED_TARGET, "${theme.name}: grey on $name")
                assertTrue(ThemeColor.contrast(grey, page) >= Theme.READABLE)
            }
            assertTrue(theme.mutedShare >= Theme.Share.MUTED_FOREGROUND && theme.mutedShare <= 1, theme.name)
        }
        assertTrue(Theme.named("cream")!!.mutedShare > Theme.named("dark")!!.mutedShare, "the light schemes need more raising than the dark ones")
        assertTrue(Theme.named("cream")!!.mutedShare > Theme.Share.MUTED_FOREGROUND, "Cream's grey had to be raised")
    }

    @Test
    @DisplayName("the Live tab's dimmed syntax reads at 4.5 or better in every scheme, on the page, on the fill of code and on every highlight tint, with and without high-contrast text")
    fun dimmedSyntax() {
        for (theme in Theme.ALL) {
            val codeFill = theme.foreground.over(theme.background, Theme.Share.MUTED)
            for (increased in listOf(false, true)) {
                val share = theme.mutedShare(increased)
                val context = "${theme.name}, high-contrast text ${if (increased) "on" else "off"}"
                assertTrue(ThemeColor.contrast(theme.foreground.over(theme.background, share), theme.background) >= Theme.MUTED_TARGET, "$context: on the page")
                assertTrue(ThemeColor.contrast(theme.foreground.over(codeFill, share), codeFill) >= Theme.READABLE, "$context: on the faint fill of code")
                for (name in Theme.MARK_HUES.keys.sorted()) {
                    val tint = theme.markTint(name)
                    val dimmed = theme.dimmedShare(tint, increased)
                    assertTrue(dimmed >= share && dimmed <= 1, "$context: $name is never dimmer than the grey text")
                    assertTrue(ThemeColor.contrast(theme.foreground.over(tint, dimmed), tint) >= Theme.READABLE, "$context: on $name")
                }
            }
            assertTrue(theme.mutedShare(true) >= max(theme.mutedShare, Theme.INCREASED_MUTED_SHARE), "${theme.name}: high-contrast text darkens the grey")
        }
        // Where the grey already reads on a tint it is left as it is, and where it does not (the dark schemes' tints) it is raised: so the rule is not idle.
        val dark = Theme.named("dark")!!
        assertTrue(dark.dimmedShare(dark.markTint("yellow"), false) > dark.mutedShare)
        val light = Theme.named("light")!!
        assertEquals(light.mutedShare, light.dimmedShare(light.markTint("yellow"), false))
    }

    @Test
    @DisplayName("a rule (the Live tab's line) is firmer with high-contrast text and can be told from the page in every scheme")
    fun rule() {
        for (theme in Theme.ALL) {
            fun contrast(increased: Boolean) =
                ThemeColor.contrast(theme.foreground.over(theme.background, Theme.ruleShare(increased)), theme.background)
            assertTrue(contrast(false) >= 1.5, "${theme.name}: the desktop's 35% is a line you can see")
            assertTrue(contrast(true) >= 3, "${theme.name}: and with high-contrast text it passes the 3 that WCAG asks of a line that carries meaning")
            assertTrue(contrast(true) > contrast(false))
        }
    }

    @Test
    @DisplayName("an unknown or missing highlight colour is yellow, and a colour name may be in any case")
    fun unknownMarks() {
        val theme = Theme.DEFAULT
        assertEquals(theme.markTint("yellow"), theme.markTint(null))
        assertEquals(theme.markTint("yellow"), theme.markTint("purple"))
        assertEquals(theme.markTint("pink"), theme.markTint("PINK"))
        assertNotEquals(theme.markTint("blue"), theme.markTint("pink"))
    }

    @Test
    @DisplayName("the series colours are the foreground, success, warning and error, and the two mixes between them")
    fun series() {
        val theme = Theme.named("dark")!!
        val colors = theme.seriesColors
        assertEquals(6, colors.size)
        assertEquals(listOf(theme.foreground, theme.success, theme.warning, theme.error), colors.take(4))
        assertEquals(theme.foreground.mixed(theme.success, 0.55), colors[4])
        assertEquals(theme.warning.mixed(theme.error, 0.60), colors[5])
        assertEquals(6, colors.toSet().size, "six different colours")
        for (other in Theme.ALL) assertEquals(6, other.seriesColors.size)
    }

    // Settings

    @Test
    @DisplayName("a new install follows the system, with a monospaced editor and a sans serif preview")
    fun freshInstall() = withScratch { scratch ->
        val (store, _) = store(scratch)
        assertEquals(Appearance(SchemeChoice.System, FontFamily.MONO, FontFamily.SANS), store.appearance())
    }

    @Test
    @DisplayName("a desktop's scheme is the app's, a desktop's Follow the sun is Follow the sun, and nothing else the file holds matters")
    fun fromTheDesktop() {
        withScratch { scratch ->
            val (store, _) = store(scratch, """{"theme":"forest","sidebarWidth":300}""")
            assertEquals(SchemeChoice.Named("forest"), store.appearance().scheme)
        }
        withScratch { scratch ->
            val (store, _) = store(scratch, """{"theme":"auto"}""")
            assertEquals(SchemeChoice.Sun, store.appearance().scheme)
            assertEquals(SunPairName.CLASSIC, store.appearance().sunPair, "with no pair saved it is the classic one")
        }
        withScratch { scratch ->
            val (store, _) = store(scratch, """{"theme":"auto","sunPair":"blush-wine"}""")
            assertEquals(Appearance(scheme = SchemeChoice.Sun, sunPair = SunPairName.BLUSH_WINE), store.appearance())
            assertEquals(SunPairName.BLUSH_WINE, store.sunPair())
        }
        withScratch { scratch ->
            val (store, _) = store(scratch, """{"theme":"forest","sunPair":"neon"}""")
            assertEquals(Appearance(scheme = SchemeChoice.Named("forest"), sunPair = SunPairName.CLASSIC), store.appearance(), "a pair the desktop does not have is the classic one")
        }
        withScratch { scratch ->
            val (store, _) = store(scratch, """{"theme":"neon","iosEditorFont":"comic","iosPreviewFont":7,"followSystem":"yes"}""")
            assertEquals(Appearance(SchemeChoice.System, FontFamily.MONO, FontFamily.SANS), store.appearance(), "unknown values are ignored")
        }
        withScratch { scratch ->
            // kotlinx reads the text "true" as a boolean when asked; the desktop and the iPad do not.
            val (store, _) = store(scratch, """{"theme":"wine","followSystem":"true","sunPair":true}""")
            assertEquals(Appearance(scheme = SchemeChoice.Named("wine")), store.appearance(), "only a JSON true follows the system")
        }
    }

    @Test
    @DisplayName("choosing a scheme writes the desktop's theme and keeps every other key; System leaves the theme as it was")
    fun choosing() = withScratch { scratch ->
        val (store, location) = store(scratch, """{"theme":"wine","favorites":[{"type":"note","id":4}],"panels":{"version":2}}""")
        assertEquals(SchemeChoice.Named("wine"), store.appearance().scheme)
        store.setScheme(SchemeChoice.System)
        assertEquals(SchemeChoice.System, store.appearance().scheme)
        var written = written(location)
        assertEquals(JsonPrimitive("wine"), written["theme"], "a desktop that reads the file still has its scheme")
        assertEquals(JsonPrimitive(true), written["followSystem"])
        store.setScheme(SchemeChoice.Named("cream"))
        assertEquals(SchemeChoice.Named("cream"), store.appearance().scheme)
        written = written(location)
        assertEquals(JsonPrimitive("cream"), written["theme"])
        assertEquals(JsonPrimitive(false), written["followSystem"])
        assertNotNull(written["panels"])
        assertEquals(listOf(Favorite(FavoriteKind.NOTE, 4)), store.favorites(), "the rest of the file is as it was")
    }

    @Test
    @DisplayName("choosing Follow the sun writes the desktop's auto and its pair, and keeps every other key")
    fun followingTheSun() = withScratch { scratch ->
        val (store, location) = store(
            scratch,
            """{"theme":"cream","followSystem":true,"location":{"name":"Austin","latitude":30.27,"longitude":-97.74,"timezone":"America/Chicago"},"panels":{"version":2}}""",
        )
        store.setScheme(SchemeChoice.Sun)
        store.setSunPair(SunPairName.SKY_MIDNIGHT)
        assertEquals(Appearance(scheme = SchemeChoice.Sun, sunPair = SunPairName.SKY_MIDNIGHT), store.appearance())
        val written = written(location)
        assertEquals(JsonPrimitive("auto"), written["theme"])
        assertEquals(JsonPrimitive("sky-midnight"), written["sunPair"])
        assertEquals(JsonPrimitive(false), written["followSystem"])
        assertTrue(written["panels"] != null && written["location"] == null, "the old city goes with this write, and the rest of the file is as it was")
        store.setScheme(SchemeChoice.Named("dark"))
        assertEquals(Appearance(scheme = SchemeChoice.Named("dark"), sunPair = SunPairName.SKY_MIDNIGHT), store.appearance(), "the pair is kept for when it is chosen again")
    }

    @Test
    @DisplayName("a scheme the desktop would not know is refused, and nothing is written")
    fun refusing() = withScratch { scratch ->
        val (store, location) = store(scratch)
        for (name in listOf("auto", "neon", "")) {
            val refusal = assertFailsWith<SettingsException.UnknownTheme> { store.setScheme(SchemeChoice.Named(name)) }
            assertEquals(name, refusal.name)
        }
        assertFalse(location.settingsFile.exists())
    }

    @Test
    @DisplayName("the two fonts are kept separately and read back")
    fun fonts() = withScratch { scratch ->
        val (store, location) = store(scratch)
        store.setEditorFont(FontFamily.SERIF)
        store.setPreviewFont(FontFamily.MONO)
        assertEquals(Appearance(SchemeChoice.System, FontFamily.SERIF, FontFamily.MONO), store.appearance())
        val written = written(location)
        assertEquals(JsonPrimitive("serif"), written["iosEditorFont"])
        assertEquals(JsonPrimitive("mono"), written["iosPreviewFont"])
        assertNull(written["theme"], "no desktop key was made up")
    }
}
