package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.appearance.Appearance
import com.rushinglabs.composition.core.appearance.SchemeChoice
import com.rushinglabs.composition.core.appearance.Theme
import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.appearance.appearance
import com.rushinglabs.composition.core.appearance.day
import com.rushinglabs.composition.core.appearance.night
import com.rushinglabs.composition.core.appearance.setSunPair
import com.rushinglabs.composition.core.sun.Sun
import com.rushinglabs.composition.core.sun.SunHours
import com.rushinglabs.composition.core.sun.SunPairName
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Follow the sun, beyond what the desktop's fixture pins (SunConformanceTests): the scheme the app wears at a level, and what keeping the
// four hours does to the settings file. Ported from SunTests.swift.

/** Epoch milliseconds of a UTC moment, as JavaScript's `Date.UTC` gives it (the month counts from 0). */
private fun utcMilliseconds(year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0): Double =
    ZonedDateTime.of(year, month + 1, day, hour, minute, 0, 0, ZoneOffset.UTC).toInstant().toEpochMilli().toDouble()

@DisplayName("Follow the sun")
class SunTests {
    private fun settings(scratch: File, file: String? = null): Pair<SettingsStore, DataLocation> {
        val location = DataLocation(File(scratch, "data"))
        if (file != null) {
            location.directory.mkdirs()
            location.settingsFile.writeText(file)
        }
        return SettingsStore(location) to location
    }

    private fun written(location: DataLocation): JsonObject = readJson(location.settingsFile).jsonObject

    // The scheme at a level

    @Test
    @DisplayName("at the ends it is the pair's own palettes, and only the three surfaces blend between them")
    fun ends() {
        for (pair in SunPairName.entries) {
            val night = Theme.sun(pair, 0.0)
            val day = Theme.sun(pair, 1.0)
            assertTrue(night.name == "auto" && day.name == "auto" && night.label == "Follow the sun")
            assertEquals(pair.night.copy(name = "auto", label = "Follow the sun"), night, "$pair at night")
            assertEquals(pair.day.copy(name = "auto", label = "Follow the sun"), day, "$pair by day")
            assertTrue(night.isDark && !day.isDark)
        }
    }

    @Test
    @DisplayName("half way, the surfaces are the average of the two (a half rounds up), and the ink is one palette's outright")
    fun middle() {
        val half = Theme.sun(SunPairName.CLASSIC, 0.5)
        // (0xf7 + 0x12) / 2 = 132.5 -> 133 for red and green, and (0xf4 + 0x12) / 2 = 131 for blue.
        assertEquals(ThemeColor(133, 133, 131), half.background)
        assertEquals(Theme.named("light")!!.foreground, half.foreground, "past the flip point at 0.45 the ink is the day's")
        val before = Theme.sun(SunPairName.CLASSIC, 0.44)
        assertEquals(Theme.named("dark")!!.foreground, before.foreground)
        assertEquals(Theme.named("dark")!!.brand, before.brand)
        // The page blends by the percentage the desktop writes, one decimal.
        assertTrue(abs(Sun.autoLightShare(0.12345) - 0.123) < 1e-12)
        assertEquals(1.0, Sun.autoLightShare(1.0))
        assertEquals(0.0, Sun.autoLightShare(0.0))
        // It blends by that percentage, not by the level: 0.233% is 0.2% on the page, which is a step darker on every channel than the level itself would give.
        assertEquals(ThemeColor(18, 18, 18), Theme.sun(SunPairName.CLASSIC, 0.00233).background)
        // The cream-amber pair flips later than the classic one.
        assertEquals(SunPairName.CREAM_AMBER.night.foreground, Theme.sun(SunPairName.CREAM_AMBER, 0.47).foreground)
        assertEquals(SunPairName.CREAM_AMBER.day.foreground, Theme.sun(SunPairName.CREAM_AMBER, 0.5).foreground)
    }

    @Test
    @DisplayName("the text reads at 4.5 or better except around the middle of the fade, where the desktop's own palettes cannot give it (never under 3)")
    fun legibleAlongTheFade() {
        // Half way along the fade the page is a mid grey, which neither the day's dark ink nor the night's light ink reads on at 4.5: the
        // desktop flips the ink where the two read equally, about 3.2. That is the desktop's design, carried over as it is; this pins how
        // bad it gets and for how long (about 14 minutes in each 90-minute fade: levels 0.33 to 0.66), so that a recoloured pair that makes
        // it worse fails here.
        val failures = ArrayList<String>()
        for (pair in SunPairName.entries) {
            for (step in 0..1000) {
                val level = step.toDouble() / 1000
                val theme = Theme.sun(pair, level)
                for ((name, page) in listOf("background" to theme.background, "surface" to theme.surface, "panel" to theme.panel)) {
                    val ratio = ThemeColor.contrast(theme.foreground, page)
                    if (ratio < 3.0) failures.add("$pair at $level: text on $name reads at $ratio")
                    if ((level <= 0.32 || level >= 0.67) && ratio < 4.5) failures.add("$pair at $level: text on $name reads at $ratio")
                }
            }
        }
        assertTrue(failures.isEmpty(), "$failures")
    }

    // The hours

    private fun at(clock: String): Long = SunHours.parseClock(clock)!!.toLong() * Sun.MILLISECONDS_PER_MINUTE

    @Test
    @DisplayName("with the default hours it is what the scheme did before they were set by hand: 06:30 and 18:30, a 90-minute fade centred on each")
    fun defaultHoursAreTheOldStandIns() {
        fun old(clock: String, event: String, rising: Boolean): Double? {
            val progress = (at(clock) - at(event) + 45 * 60_000).toDouble() / (90 * 60_000).toDouble()
            if (progress < 0 || progress > 1) return null
            val eased = progress * progress * (3 - 2 * progress)
            return if (rising) eased else 1 - eased
        }
        for (clock in listOf("05:45", "06:00", "06:20", "06:30", "06:55", "07:15")) {
            assertEquals(old(clock, "06:30", true), Sun.level(SunHours.DEFAULT, at(clock)), clock)
        }
        for (clock in listOf("17:45", "18:10", "18:30", "18:50", "19:15")) {
            assertEquals(old(clock, "18:30", false), Sun.level(SunHours.DEFAULT, at(clock)), clock)
        }
        assertEquals(1.0, Sun.level(SunHours.DEFAULT, at("12:00")))
        assertEquals(0.0, Sun.level(SunHours.DEFAULT, at("03:00")))
        assertEquals(0.0, Sun.level(SunHours.DEFAULT, at("23:00")))
    }

    @Test
    @DisplayName("a day that begins in the evening, and a fade that crosses midnight, are fine")
    fun aDayFromAnyStart() {
        val night = SunHours(19 * 60, 20 * 60, 5 * 60, 6 * 60)
        assertTrue(night.goesRoundTheClock)
        assertEquals(0.0, Sun.level(night, at("12:00")))
        assertEquals(1.0, Sun.level(night, at("23:00")))
        assertEquals(1.0, Sun.level(night, at("00:00")))
        assertTrue(abs(Sun.level(night, at("19:30")) - 0.5) < 1e-12 && abs(Sun.level(night, at("05:30")) - 0.5) < 1e-12)
        val across = SunHours(9 * 60, 10 * 60, 23 * 60 + 30, 30)
        assertEquals(1.0, Sun.level(across, at("23:00")))
        assertTrue(abs(Sun.level(across, at("00:00")) - 0.5) < 1e-12)
        assertEquals(0.0, Sun.level(across, at("00:45")))
    }

    @Test
    @DisplayName("hours that do not go once round the clock in order are refused, and read as the defaults when they come off disk")
    fun refusedHours() {
        val backwards = SunHours(8 * 60, 7 * 60, 18 * 60, 19 * 60)
        assertFalse(backwards.goesRoundTheClock)
        assertEquals(SunHours.ORDER_ERROR, backwards.problem)
        assertEquals(Sun.level(SunHours.DEFAULT, at("06:30")), Sun.level(backwards, at("06:30")))
        assertFalse(SunHours(6 * 60, 18 * 60, 7 * 60, 19 * 60).goesRoundTheClock, "two times round the clock")
        assertFalse(SunHours(6 * 60, 6 * 60, 18 * 60, 20 * 60).goesRoundTheClock, "two hours the same")
        assertTrue(SunHours(0, 1, 2, 3).goesRoundTheClock)
        assertTrue(SunHours(1437, 1438, 1439, 0).goesRoundTheClock)
        assertNull(SunHours.DEFAULT.problem)
    }

    @Test
    @DisplayName("the milliseconds since midnight follow the wall clock across a clock change")
    fun wallClockAcrossAClockChange() {
        val chicago = ZoneId.of("America/Chicago")
        // 2026-03-08, 08:00 UTC: 02:00 CST becomes 03:00 CDT.
        val springForward = utcMilliseconds(2026, 2, 8, 8, 0)
        assertEquals(2 * 3_600_000L - 1, Sun.msOfLocalDay(springForward - 1, chicago))
        assertEquals(3 * 3_600_000L, Sun.msOfLocalDay(springForward, chicago))
        assertEquals(0L, Sun.msOfLocalDay(utcMilliseconds(2026, 10, 9, 0, 0), ZoneId.of("UTC")))
    }

    // Keeping them

    @Test
    @DisplayName("saving hours keeps them, and every other key in the file")
    fun savingHours() = withScratch { scratch ->
        val (store, location) = settings(scratch, """{"theme":"auto","sunPair":"mint-forest","panels":{"version":2}}""")
        assertEquals(SunHours.DEFAULT, store.sunHours(), "nothing saved yet reads as the defaults")
        val evening = SunHours(19 * 60, 20 * 60, 5 * 60, 6 * 60)

        store.setSunHours(evening)

        assertEquals(evening, store.sunHours())
        assertEquals(Appearance(scheme = SchemeChoice.Sun, sunPair = SunPairName.MINT_FOREST), store.appearance(), "the scheme and the pair are as they were")
        val written = written(location)
        assertNotNull(written["panels"])
        assertEquals(
            JsonObject(mapOf("lightenFrom" to "19:00", "lightFrom" to "20:00", "darkenFrom" to "05:00", "darkFrom" to "06:00").mapValues { JsonPrimitive(it.value) }),
            written["sunHours"],
        )
    }

    @Test
    @DisplayName("hours that are not in order are refused with the reason, and the saved ones stay")
    fun refusingHours() = withScratch { scratch ->
        val (store, location) = settings(scratch, """{"sunHours":{"lightenFrom":"06:00","lightFrom":"07:00","darkenFrom":"18:30","darkFrom":"20:00"}}""")
        val before = location.settingsFile.readBytes()

        val refusal = assertFailsWith<SettingsException.UnusableSunHours> { store.setSunHours(SunHours(8 * 60, 7 * 60, 18 * 60, 19 * 60)) }
        assertEquals(SunHours.ORDER_ERROR, refusal.message)

        assertEquals(SunHours(6 * 60, 7 * 60, 18 * 60 + 30, 20 * 60), store.sunHours())
        assertTrue(before.contentEquals(location.settingsFile.readBytes()), "nothing was written")
    }

    @Test
    @DisplayName("a city an older version saved is not read, and is gone the next time settings are written")
    fun theOldCityGoes() = withScratch { scratch ->
        val (store, location) = settings(
            scratch,
            """{"theme":"auto","sunPair":"cream-amber","location":{"name":"Austin","latitude":30.27,"longitude":-97.74,"timezone":"America/Chicago"},"panels":{"version":2}}""",
        )
        assertEquals(SunHours.DEFAULT, store.sunHours(), "the city changes nothing")
        assertEquals(Appearance(scheme = SchemeChoice.Sun, sunPair = SunPairName.CREAM_AMBER), store.appearance())
        assertNotNull(written(location)["location"], "reading leaves the file alone")

        store.setSunPair(SunPairName.MINT_FOREST)  // any write

        val written = written(location)
        assertNull(written["location"], "the city is gone")
        assertNotNull(written["panels"])
        assertEquals(JsonPrimitive("auto"), written["theme"])
        assertEquals(JsonPrimitive("mint-forest"), written["sunPair"], "everything else is as it was")
    }
}
