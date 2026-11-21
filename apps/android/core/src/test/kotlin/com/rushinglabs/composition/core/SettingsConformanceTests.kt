package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.sun.SunHours
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The parts of the desktop's `parseWebSettings` the core uses, against the real function; ported from SettingsConformanceTests.swift. The
// inputs are fixtures/conformance/settings-cases.json and what the desktop made of each is settings-expected.json. The backup round trip
// with settings is in BackupConformanceTests.

@DisplayName("Settings against the desktop")
class SettingsConformanceTests {
    @Test
    @DisplayName("favorites, themes and the Follow the sun hours are read as the desktop reads them")
    fun parsers() {
        val cases = readJson(fixture("settings-cases.json")).jsonObject
        val expected = readJson(fixture("settings-expected.json")).jsonObject
        val favorites = cases.getValue("favorites").jsonArray
        val themes = cases.getValue("theme").jsonArray
        val sunHours = cases.getValue("sunHours").jsonArray
        val expectedFavorites = expected.getValue("favorites").jsonArray
        val expectedThemes = expected.getValue("theme").jsonArray
        val expectedHours = expected.getValue("sunHours").jsonArray
        assertEquals(favorites.size, expectedFavorites.size)
        assertEquals(themes.size, expectedThemes.size)
        assertEquals(sunHours.size, expectedHours.size)

        val different = ArrayList<String>()
        for ((index, value) in favorites.withIndex()) {
            val ours = JsonArray(SettingsStore.parseFavorites(value).map {
                JsonObject(mapOf("type" to JsonPrimitive(it.kind.rawValue), "id" to JsonPrimitive(it.id)))
            })
            // Numbers compare by value: the desktop writes an id of 1000.0 back as 1000.
            ours.difference(expectedFavorites[index])?.let { different.add("  favorites $value: ours $ours, desktop ${expectedFavorites[index]} ($it)") }
        }
        for ((index, value) in themes.withIndex()) {
            val ours = SettingsStore.parseTheme(value)
            if (JsonPrimitive(ours) != expectedThemes[index]) different.add("  theme $value: ours $ours, desktop ${expectedThemes[index]}")
        }
        for ((index, value) in sunHours.withIndex()) {
            val ours = SunHours.fromSettings(value).settingsObject
            if (ours != expectedHours[index]) different.add("  sunHours $value: ours $ours, desktop ${expectedHours[index]}")
        }
        val total = favorites.size + themes.size + sunHours.size
        println("Settings: ${total - different.size} of $total inputs agree with the desktop")
        different.forEach(::println)
        assertTrue(different.isEmpty(), "inputs that differ: ${different.size}")
    }
}
