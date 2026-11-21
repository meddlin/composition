package com.rushinglabs.composition.core.sun

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * The light and dark colours the "Follow the sun" scheme moves between (the desktop's `sunPairs.ts`, through SunPairs.swift): each is
 * a day palette and a night palette from `globals.css`. The page fades from one to the other around the hours a person set, and its
 * text switches between the two palettes' own ink at `inkFlipLevel`, the point along the blend where the two inks are equally readable
 * against it. The palettes themselves are in the appearance package (`Theme.sunPalette`, `SunPairName.day` and `.night`).
 */
enum class SunPairName(
    val rawValue: String,
    /** What Settings calls it on the desktop. */
    val label: String,
    /** The names of the day and the night palette (see `Theme.sunPalette`). */
    val dayName: String,
    val nightName: String,
    /** Where, along the blend, the text switches from its night ink to its day ink. `themes.test.ts` recomputes it from the palettes on the desktop. */
    val inkFlipLevel: Double,
) {
    CLASSIC("classic", "Light and dark", "light", "dark", Sun.INK_FLIP_LEVEL),
    CREAM_AMBER("cream-amber", "Cream to dark amber", "cream", "amber", 0.5),
    MINT_FOREST("mint-forest", "Light green to dark forest", "mint", "forest", 0.46),
    BLUSH_WINE("blush-wine", "Blush to wine", "blush", "wine", 0.47),
    SKY_MIDNIGHT("sky-midnight", "Sky to midnight", "sky", "midnight", 0.47);

    companion object {
        val DEFAULT = CLASSIC

        fun of(rawValue: String): SunPairName? = entries.firstOrNull { it.rawValue == rawValue }

        /** `isSunPairName`: whether a value that came off disk names one of the five. */
        fun isName(value: JsonElement?): Boolean = name(value) != null

        /** `isSunPairName` and `inkFlipLevelOf` for a value that came off disk: anything that is not one of the five names is the default's. */
        fun fromSettings(value: JsonElement?): SunPairName = name(value) ?: DEFAULT

        private fun name(value: JsonElement?): SunPairName? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.let(::of)
    }
}
