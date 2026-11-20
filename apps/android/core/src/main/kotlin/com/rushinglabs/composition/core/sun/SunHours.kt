package com.rushinglabs.composition.core.sun

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/**
 * The four hours a person sets by hand for "Follow the sun" (Appearance ▸ Follow the sun): when the scheme starts getting lighter,
 * when it is fully light, when it starts getting darker and when it is fully dark. A port of the desktop's `sunHours.ts` (through
 * SunHours.swift), checked against it by `SunConformanceTests` over `fixtures/conformance/sun.json`.
 *
 * They are times on the device's own wall clock (no time zone, no city), kept in `settings.json` as `HH:MM` text on a 24-hour clock
 * under `sunHours`. The four go once round the clock in order, from any starting point, with at least a minute between neighbours.
 * Each is in minutes after midnight (0 to 1439).
 */
data class SunHours(val lightenFrom: Int, val lightFrom: Int, val darkenFrom: Int, val darkFrom: Int) {
    val minutes: List<Int> get() = listOf(lightenFrom, lightFrom, darkenFrom, darkFrom)

    /** Whether these four go round the clock in order (and so describe a day). */
    val goesRoundTheClock: Boolean get() = goRoundTheClock(minutes)

    /** The reason these four are refused, or null when they are fine. */
    val problem: String? get() = if (goesRoundTheClock) null else ORDER_ERROR

    /** The object a settings file keeps: the four hours as `HH:MM` text. */
    val settingsObject: JsonObject get() = JsonObject(KEYS.zip(minutes).associate { (key, value) -> key to JsonPrimitive(formatClock(value)) })

    /** What `validate` made of a settings value: the hours, or the reason they are refused. */
    sealed interface Validation {
        data class Valid(val hours: SunHours) : Validation
        data class Refused(val message: String) : Validation
    }

    companion object {
        const val MINUTES_PER_DAY = 24 * 60

        /** What the scheme did before the hours were the person's, with no city saved: 06:30 and 18:30 with a 90-minute fade centred on each. */
        val DEFAULT = SunHours(5 * 60 + 45, 7 * 60 + 15, 17 * 60 + 45, 19 * 60 + 15)

        /** The keys of the settings object, in the order the hours come. */
        internal val KEYS = listOf("lightenFrom", "lightFrom", "darkenFrom", "darkFrom")

        /** What Settings calls each hour, in the order they come. */
        val LABELS = listOf("Starts getting lighter", "Fully light from", "Starts getting darker", "Fully dark from")

        const val FORMAT_ERROR = "Each time must be hours and minutes on a 24-hour clock, like 07:15."
        const val ORDER_ERROR =
            "The four times must follow each other once round the clock (starts getting lighter, fully light, starts getting darker, fully dark), each at least a minute after the one before."

        /**
         * `parseClock`: `"07:15"` as minutes after midnight (435), or null for anything that is not `HH:MM` on a 24-hour clock (no spaces,
         * no seconds, no other digits).
         */
        fun parseClock(value: JsonElement?): Int? {
            val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            return parseClock(text)
        }

        fun parseClock(text: String): Int? {
            if (text.length != 5 || text[2] != ':') return null
            val digits = listOf(0, 1, 3, 4).map { index -> text[index].takeIf { it in '0'..'9' }?.minus('0') ?: return null }
            val hour = digits[0] * 10 + digits[1]
            val minute = digits[2] * 10 + digits[3]
            return if (hour <= 23 && minute <= 59) hour * 60 + minute else null
        }

        /** `formatClock`: minutes after midnight as zero-padded `HH:MM`. */
        fun formatClock(minutes: Int): String {
            val whole = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
            return String.format(Locale.ROOT, "%02d:%02d", whole / 60, whole % 60)
        }

        /**
         * `goRoundTheClock`: each of the four gaps, measured forward from one hour to the next (the last back to the first), is at least a
         * minute, and together they make exactly one day, never two.
         */
        fun goRoundTheClock(minutes: List<Int>): Boolean {
            var total = 0
            for (index in minutes.indices) {
                val gap = ((minutes[(index + 1) % minutes.size] - minutes[index]) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY
                if (gap < 1) return false
                total += gap
            }
            return total == MINUTES_PER_DAY
        }

        /** `validateSunHours`: the hours in `value` (a settings file's `sunHours`), or the reason it is refused. */
        fun validate(value: JsonElement?): Validation {
            val obj = value as? JsonObject ?: return Validation.Refused(FORMAT_ERROR)
            val parsed = KEYS.map { parseClock(obj[it]) ?: return Validation.Refused(FORMAT_ERROR) }
            val found = SunHours(parsed[0], parsed[1], parsed[2], parsed[3])
            return if (found.goesRoundTheClock) Validation.Valid(found) else Validation.Refused(ORDER_ERROR)
        }

        /** `parseSunHours`: a good set, or the defaults for anything else (all or nothing: a half-valid set does not describe a day). */
        fun fromSettings(value: JsonElement?): SunHours = (validate(value) as? Validation.Valid)?.hours ?: DEFAULT
    }
}
