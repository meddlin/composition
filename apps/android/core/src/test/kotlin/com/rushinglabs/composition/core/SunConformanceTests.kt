package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.appearance.Theme
import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.appearance.day
import com.rushinglabs.composition.core.appearance.night
import com.rushinglabs.composition.core.sun.Sun
import com.rushinglabs.composition.core.sun.SunHours
import com.rushinglabs.composition.core.sun.SunPairName
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// "Follow the sun" against the desktop's own code; ported from SunConformanceTests.swift. fixtures/conformance/sun.json holds what
// `sunHours.ts`, `sunSchedule.ts`, `sunPairs.ts` and `globals.css` make of a long list of inputs (apps/web/src/lib/composition/
// sunConformance.test.ts writes it). The file is committed, so a plain `./gradlew :core:test` replays it. See fixtures/conformance/README.md.

private val sunCorpus: JsonObject? = corpusDirectory?.let { File(it, "sun.json") }?.takeIf { it.isFile }?.let { readJson(it) as? JsonObject }

private fun sunCorpus(): JsonObject {
    skipUnless(sunCorpus != null, "fixtures/conformance/sun.json is not there")
    return sunCorpus!!
}

private fun section(name: String): List<JsonObject> = sunCorpus().getValue(name).jsonArray.map { it.jsonObject }

/** A JSON number, as a double. */
private fun JsonElement?.doubleValue(): Double? =
    (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.content?.toDoubleOrNull()

/** A JSON number that is a whole number. */
private fun JsonElement?.longValue(): Long? = doubleValue()?.takeIf { it == kotlin.math.truncate(it) }?.toLong()

private fun JsonElement?.stringValue(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())

private fun tokens(theme: Theme): List<Pair<String, ThemeColor>> = listOf(
    "background" to theme.background, "foreground" to theme.foreground, "surface" to theme.surface, "panel" to theme.panel,
    "brand" to theme.brand, "brand-dim" to theme.brandDim, "highlight" to theme.highlight, "warning" to theme.warning,
    "error" to theme.error, "success" to theme.success, "link" to theme.link,
)

private fun syntax(theme: Theme): List<Pair<String, ThemeColor>> = listOf(
    "comment" to theme.syntax.comment, "keyword" to theme.syntax.keyword, "string" to theme.syntax.string, "number" to theme.syntax.number,
    "function" to theme.syntax.function, "type" to theme.syntax.type, "attr" to theme.syntax.attr,
)

/**
 * Every token and syntax colour of a palette against the stylesheet's (`expected` in the shape `sun.json` and `appearance-expected.json`
 * both write): each that differs goes into `different`, and the count compared is returned. AppearanceConformanceTests uses it too.
 */
internal fun comparePaletteWithStylesheet(label: String, theme: Theme, expected: JsonObject, different: MutableList<String>): Int {
    var compared = 0
    fun check(what: String, ours: Any?, theirs: Any?) {
        compared++
        if (ours != theirs) different.add("$label $what: ours $ours, desktop $theirs")
    }
    check("color-scheme", theme.isDark, expected["colorScheme"].stringValue() == "dark")
    for ((name, color) in tokens(theme)) check("--$name", color.hex, expected[name].stringValue())
    check("--mark-alpha", theme.markAlpha, expected["markAlpha"].doubleValue())
    val syntax = expected["syntax"].obj()
    check("--syntax-* names", syntax.keys, syntax(theme).map { it.first }.toSet())
    for ((name, color) in syntax(theme)) check("--syntax-$name", color.hex, syntax[name].stringValue())
    return compared
}

@DisplayName("Follow the sun against the desktop")
class SunConformanceTests {
    @Test
    @DisplayName("the flip point, the defaults and the five pairs are the desktop's")
    fun constantsAndPairs() {
        val constants = sunCorpus().getValue("constants").jsonObject
        assertEquals(constants["inkFlipLevel"].doubleValue(), Sun.INK_FLIP_LEVEL)
        assertEquals(constants["msPerDay"].longValue(), Sun.MILLISECONDS_PER_DAY)
        assertEquals(constants["defaultSunPair"].stringValue(), SunPairName.DEFAULT.rawValue)
        assertEquals(SunHours.fromSettings(constants["defaultHours"]), SunHours.DEFAULT, "the default hours")
        assertEquals(constants["defaultHours"], SunHours.DEFAULT.settingsObject)

        val pairs = section("pairs")
        assertEquals(5, pairs.size)
        assertEquals(5, SunPairName.entries.size)
        for ((pair, expected) in SunPairName.entries.zip(pairs)) {
            assertEquals(expected["name"].stringValue(), pair.rawValue)
            assertEquals(expected["label"].stringValue(), pair.label, "$pair label")
            assertEquals(expected["day"].stringValue(), pair.dayName, "$pair day")
            assertEquals(expected["night"].stringValue(), pair.nightName, "$pair night")
            assertEquals(expected["inkFlipLevel"].doubleValue(), pair.inkFlipLevel, "$pair flip point")
        }
        println("Follow the sun, constants: the flip point, the day's length, the default pair and hours and ${pairs.size} of ${pairs.size} pairs agree with the desktop")
    }

    @Test
    @DisplayName("what names a pair, and the flip point of anything else, are the desktop's")
    fun pairProbes() {
        val probes = section("pairProbes")
        assertTrue(probes.size >= 15)
        val different = ArrayList<String>()
        for (probe in probes) {
            val value = probe["value"] ?: JsonNull
            if (SunPairName.isName(value) != (probe["isName"] == JsonPrimitive(true))) different.add("isSunPairName($value)")
            if (SunPairName.fromSettings(value).inkFlipLevel != probe["inkFlipLevel"].doubleValue()) different.add("inkFlipLevelOf($value)")
        }
        println("Follow the sun, pair names: ${probes.size - different.size} of ${probes.size} values agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
    }

    @Test
    @DisplayName("HH:MM is read, and written, as the desktop reads and writes it")
    fun clocks() {
        val rows = section("clocks")
        assertTrue(rows.size >= 25)
        val different = ArrayList<String>()
        for (row in rows) {
            val value = row["value"] ?: JsonNull
            val minutes = SunHours.parseClock(value)
            if (minutes?.toLong() != row["minutes"].longValue()) different.add("parseClock($value): ours $minutes, desktop ${row["minutes"]}")
            if (minutes?.let(SunHours::formatClock) != row["written"].stringValue()) different.add("formatClock(parseClock($value))")
        }
        println("Follow the sun, clocks: ${rows.size - different.size} of ${rows.size} times agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
    }

    @Test
    @DisplayName("a set of hours is accepted, refused with the desktop's words, or read as the defaults, as the desktop does")
    fun hourSets() {
        val rows = section("hourSets")
        assertTrue(rows.size >= 25)
        val different = ArrayList<String>()
        for (row in rows) {
            val value = row["value"] ?: JsonNull
            when (val validation = SunHours.validate(value)) {
                is SunHours.Validation.Valid -> {
                    if (row["valid"] != JsonPrimitive(true)) different.add("$value is valid here, not on the desktop")
                    if (validation.hours.settingsObject != row["hours"]) different.add("$value hours: ours ${validation.hours.settingsObject}, desktop ${row["hours"]}")
                    if (row["error"] != JsonNull) different.add("$value: the desktop has an error")
                }
                is SunHours.Validation.Refused -> {
                    if (row["valid"] != JsonPrimitive(false)) different.add("$value is refused here, not on the desktop")
                    if (validation.message != row["error"].stringValue()) different.add("$value words: ours ${validation.message}, desktop ${row["error"]}")
                }
            }
            if (SunHours.fromSettings(value).settingsObject != row["parsed"]) different.add("$value as read from a settings file")
        }
        println("Follow the sun, sets of hours: ${rows.size - different.size} of ${rows.size} sets agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
    }

    @Test
    @DisplayName("how light it should be, over many sets of hours, at every edge of a fade and between")
    fun levels() {
        val different = ArrayList<String>()
        var checked = 0
        for ((index, set) in section("levels").withIndex()) {
            val hours = SunHours.fromSettings(set["hours"])
            for (entry in set["nows"]?.jsonArray ?: JsonArray(emptyList())) {
                val pair = entry.jsonArray
                val ms = pair[0].longValue() ?: continue
                val level = pair[1].doubleValue() ?: continue
                checked++
                val ours = Sun.level(hours, ms)
                if (ours != level) different.add("set $index at $ms ms: ours $ours, desktop $level")
            }
        }
        assertTrue(checked > 2000)
        println("Follow the sun, levels: ${checked - different.size} of $checked levels agree with the desktop")
        different.take(8).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "${different.size} differ")
    }

    @Test
    @DisplayName("the tone each level takes, for the classic flip point and the others")
    fun tones() {
        val rows = section("tones")
        assertTrue(rows.size > 300)
        val different = ArrayList<String>()
        for (row in rows) {
            val level = row["level"].doubleValue()!!
            val flip = row["flip"].doubleValue()
            val tone = Sun.tone(level, flip ?: Sun.INK_FLIP_LEVEL)
            if (tone.rawValue != row["tone"].stringValue()) different.add("level $level flip $flip: ours ${tone.rawValue}")
        }
        println("Follow the sun, tones: ${rows.size - different.size} of ${rows.size} levels agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
    }

    @Test
    @DisplayName("the percentage the page writes is toFixed(1) of the level, ties going up")
    fun autoLight() {
        val rows = section("autoLight")
        assertTrue(rows.size > 800)
        val different = ArrayList<String>()
        for (row in rows) {
            val level = row["level"].doubleValue()!!
            val expected = row["autoLight"].stringValue()!!
            if (Sun.autoLight(level) != expected) different.add("$level: ours ${Sun.autoLight(level)}, desktop $expected")
        }
        println("Follow the sun, --auto-light: ${rows.size - different.size} of ${rows.size} percentages agree with the desktop")
        different.take(8).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "${different.size} differ")
        // The ties `printf` rounds the other way.
        assertEquals("12.3%", Sun.autoLight(0.1225))
        assertEquals("50.0%", Sun.autoLight(0.5))
        assertEquals("100.0%", Sun.autoLight(1.0))
        assertEquals("0.0%", Sun.autoLight(0.0))
    }

    @Test
    @DisplayName("the time of day on the wall clock is the desktop's in fourteen zones, across the days and the instants their clocks change")
    fun wallClock() {
        val rows = section("wallClock")
        assertTrue(rows.size >= 200)
        val different = ArrayList<String>()
        for (row in rows) {
            val name = row["timeZone"].stringValue()!!
            val now = row["now"].doubleValue()!!
            val ours = Sun.msOfLocalDay(now, ZoneId.of(name))
            val theirs = row["ms"].longValue()
            if (ours != theirs) different.add("$name at $now: ours $ours, desktop $theirs")
        }
        val zones = rows.map { it["timeZone"].stringValue() }.toSet().size
        println("Follow the sun, wall clock: ${rows.size - different.size} of ${rows.size} instants in $zones zones agree with the desktop")
        different.take(4).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "${different.size} differ")
    }

    @Test
    @DisplayName("the five pairs' palettes are globals.css's, token for token, and their surfaces blend between the day's and the night's")
    fun palettes() {
        val palettes = sunCorpus().getValue("palettes").jsonObject
        val blends = sunCorpus().getValue("blends").jsonObject
        val different = ArrayList<String>()
        var compared = 0
        for (pair in SunPairName.entries) {
            for ((tone, theme) in listOf("light" to pair.day, "dark" to pair.night)) {
                compared += comparePaletteWithStylesheet("${pair.rawValue} $tone", theme, palettes[pair.rawValue].obj()[tone].obj(), different)
            }
            val blend = blends[pair.rawValue].obj()
            for ((name, day, night) in listOf(
                Triple("background", pair.day.background, pair.night.background),
                Triple("surface", pair.day.surface, pair.night.surface),
                Triple("panel", pair.day.panel, pair.night.panel),
            )) {
                compared++
                val ends = blend[name].obj()
                if (day.hex != ends["day"].stringValue() || night.hex != ends["night"].stringValue()) different.add("${pair.rawValue} $name blend")
            }
        }
        println("Follow the sun, palettes: ${compared - different.size} of $compared tokens and blends agree with the desktop")
        assertTrue(different.isEmpty(), "differ: $different")
        // The five palettes the stylesheet declares for the sun alone, and only those, are the ones a scheme cannot be chosen by name.
        assertEquals(listOf("amber", "mint", "blush", "sky", "midnight"), Theme.SUN_ONLY.map { it.name })
        assertTrue(Theme.SUN_ONLY.map { it.name }.none { name -> Theme.ALL.any { it.name == name } })
    }
}
