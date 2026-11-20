package com.rushinglabs.composition.core.appearance

import com.rushinglabs.composition.core.SettingsException
import com.rushinglabs.composition.core.SettingsStore
import com.rushinglabs.composition.core.sun.SunPairName
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

// How the app looks, as `settings.json` holds it (ported from Appearance.swift).

/**
 * Which scheme the app wears: one of the desktop's five (`Named`), **System**, which follows the device's light and dark, or **Follow
 * the sun**, the desktop's `auto`, which fades between a light and a dark palette over the four hours a person set (`Appearance.sunPair`
 * says which pair).
 */
sealed interface SchemeChoice {
    data object System : SchemeChoice
    data class Named(val name: String) : SchemeChoice
    data object Sun : SchemeChoice
}

/**
 * The type families the app offers for the editor and the preview. They are the system's own (sans serif, serif and monospaced), so
 * nothing is bundled; the desktop's open-source families (Geist, Lora …) are not here.
 */
enum class FontFamily(val rawValue: String, val label: String) {
    SANS("sans", "Sans serif"),
    SERIF("serif", "Serif"),
    MONO("mono", "Monospaced");

    companion object {
        /** The editor opens in a monospaced face (as the desktop's does), the preview in a sans serif one. */
        val EDITOR_DEFAULT = MONO
        val PREVIEW_DEFAULT = SANS

        fun of(rawValue: String): FontFamily? = entries.firstOrNull { it.rawValue == rawValue }
    }
}

/** How the app looks, as `settings.json` holds it. */
data class Appearance(
    val scheme: SchemeChoice = SchemeChoice.System,
    val editorFont: FontFamily = FontFamily.EDITOR_DEFAULT,
    val previewFont: FontFamily = FontFamily.PREVIEW_DEFAULT,
    /** The light and dark colours Follow the sun moves between. It is kept whichever scheme is in force, as the desktop keeps it. */
    val sunPair: SunPairName = SunPairName.DEFAULT,
) {
    companion object {
        /** The five schemes the app can wear by name (the desktop's, without "Follow the sun", which is `SchemeChoice.Sun`). */
        val THEME_NAMES = listOf("dark", "light", "forest", "wine", "cream")

        // The desktop's `theme` is the scheme it knows. These three are the iPad's own, which the desktop keeps and ignores; Android
        // keeps the same keys, so a backup moved between the two keeps the choice.
        internal const val FOLLOW_SYSTEM_KEY = "followSystem"
        internal const val EDITOR_FONT_KEY = "iosEditorFont"
        internal const val PREVIEW_FONT_KEY = "iosPreviewFont"

        // The desktop's own key for the pair of colours Follow the sun moves between.
        internal const val SUN_PAIR_KEY = "sunPair"

        private fun string(value: JsonElement?): String? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content

        /**
         * The scheme is the desktop's `theme` (so a backup restored there looks the same) unless the app was told to follow the
         * system, which the desktop has no name for: `followSystem` says so and leaves `theme` alone. With neither in the file (a fresh
         * install) it is System; a desktop `auto` is Follow the sun, with the pair it chose (`sunPair`).
         */
        internal fun parse(obj: Map<String, JsonElement>): Appearance {
            var scheme: SchemeChoice = SchemeChoice.System
            val follow = obj[FOLLOW_SYSTEM_KEY] as? JsonPrimitive
            // Only a JSON `true` counts; kotlinx would also read the text "true" as one.
            val follows = follow != null && !follow.isString && follow.content == "true"
            val name = string(obj["theme"])
            if (!follows && name != null) {
                if (name == "auto") scheme = SchemeChoice.Sun else if (name in THEME_NAMES) scheme = SchemeChoice.Named(name)
            }
            val editor = string(obj[EDITOR_FONT_KEY])?.let(FontFamily::of) ?: FontFamily.EDITOR_DEFAULT
            val preview = string(obj[PREVIEW_FONT_KEY])?.let(FontFamily::of) ?: FontFamily.PREVIEW_DEFAULT
            return Appearance(scheme, editor, preview, SunPairName.fromSettings(obj[SUN_PAIR_KEY]))
        }
    }
}

fun SettingsStore.appearance(): Appearance = locked { Appearance.parse(it) }

/** A named scheme sets the desktop's `theme`; System sets only `followSystem`, so a desktop that reads the file keeps the scheme it had. */
fun SettingsStore.setScheme(choice: SchemeChoice) {
    when (choice) {
        SchemeChoice.System -> edit { it[Appearance.FOLLOW_SYSTEM_KEY] = JsonPrimitive(true) }
        SchemeChoice.Sun -> edit {
            it["theme"] = JsonPrimitive("auto")
            it[Appearance.FOLLOW_SYSTEM_KEY] = JsonPrimitive(false)
        }
        is SchemeChoice.Named -> {
            if (choice.name !in Appearance.THEME_NAMES) throw SettingsException.UnknownTheme(choice.name)
            edit {
                it["theme"] = JsonPrimitive(choice.name)
                it[Appearance.FOLLOW_SYSTEM_KEY] = JsonPrimitive(false)
            }
        }
    }
}

/** The pair of colours Follow the sun moves between; kept for when it is chosen. */
fun SettingsStore.setSunPair(pair: SunPairName) = edit { it[Appearance.SUN_PAIR_KEY] = JsonPrimitive(pair.rawValue) }

fun SettingsStore.setEditorFont(family: FontFamily) = edit { it[Appearance.EDITOR_FONT_KEY] = JsonPrimitive(family.rawValue) }

fun SettingsStore.setPreviewFont(family: FontFamily) = edit { it[Appearance.PREVIEW_FONT_KEY] = JsonPrimitive(family.rawValue) }
