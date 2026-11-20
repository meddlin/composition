package com.rushinglabs.composition.core.sun

import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.time.Instant
import java.time.ZoneId

/**
 * "Follow the sun": how light the app should be at a moment, from the four hours a person set by hand (`SunHours`). A port of the
 * desktop's `sunSchedule.ts` (through SunSchedule.swift), checked against it by `SunConformanceTests` over
 * `fixtures/conformance/sun.json`. The level is 0 (fully dark) to 1 (fully light) and is a function of the time of day on the wall clock
 * alone, with no events and no calendar. Measured forward from "starts getting lighter", it eases from 0 to 1 over the span to "fully
 * light from", holds 1 until "starts getting darker", eases back to 0 over the span to "fully dark from", and holds 0 round to the
 * start. A fade may cross midnight.
 *
 * Everything is whole milliseconds (the time of day, the spans), so this divides the same two integers the TypeScript does and gets
 * the same level.
 */
object Sun {
    const val MILLISECONDS_PER_MINUTE: Long = 60 * 1000
    const val MILLISECONDS_PER_DAY: Long = 24 * 60 * MILLISECONDS_PER_MINUTE

    /**
     * Text flips between its dark-scheme and light-scheme colour at this level rather than cross-fading: a blend of the two inks is
     * unreadable against the half-way background. The classic pair's point; the other pairs have their own (`SunPairName.inkFlipLevel`).
     */
    const val INK_FLIP_LEVEL = 0.45

    enum class Tone(val rawValue: String) { LIGHT("light"), DARK("dark") }

    /**
     * `msOfLocalDay`: the milliseconds since midnight on the wall clock of `zone` (the device's own by default) at `now` (epoch
     * milliseconds). A day with a clock change is as long as the clock says: the time of day just follows the wall.
     */
    fun msOfLocalDay(now: Double, zone: ZoneId = ZoneId.systemDefault()): Long {
        // A JavaScript `Date` holds whole milliseconds.
        val whole = now.toLong()
        val offset = zone.rules.getOffset(Instant.ofEpochMilli(whole)).totalSeconds.toLong()
        val local = whole + offset * 1000
        return ((local % MILLISECONDS_PER_DAY) + MILLISECONDS_PER_DAY) % MILLISECONDS_PER_DAY
    }

    /**
     * `levelAtTimeOfDay`: the level at a time of day, in milliseconds since midnight (0 up to a day). Hours that do not go round the
     * clock in order describe no day: they read as the defaults, as a settings file's do.
     */
    fun level(hours: SunHours, msOfDay: Long): Double {
        if (!hours.goesRoundTheClock) return level(SunHours.DEFAULT, msOfDay)
        val minutesPerDay = SunHours.MINUTES_PER_DAY.toLong()
        // Measure everything forward from "starts getting lighter", which is 0.
        fun since(minute: Int): Long = (((minute - hours.lightenFrom).toLong() % minutesPerDay + minutesPerDay) % minutesPerDay) * MILLISECONDS_PER_MINUTE
        val rise = since(hours.lightFrom)
        val fall = since(hours.darkenFrom)
        val dark = since(hours.darkFrom)
        val at = ((msOfDay - hours.lightenFrom.toLong() * MILLISECONDS_PER_MINUTE) % MILLISECONDS_PER_DAY + MILLISECONDS_PER_DAY) % MILLISECONDS_PER_DAY

        fun smoothstep(progress: Double): Double = progress * progress * (3 - 2 * progress)
        if (at < rise) return smoothstep(at.toDouble() / rise.toDouble())
        if (at < fall) return 1.0
        if (at < dark) return 1 - smoothstep((at - fall).toDouble() / (dark - fall).toDouble())
        return 0.0
    }

    /** `sunLevel`: how light the app should be at `now` (epoch milliseconds), 0 (dark) to 1 (light), on the device's clock. */
    fun level(hours: SunHours, now: Double, zone: ZoneId = ZoneId.systemDefault()): Double = level(hours, msOfLocalDay(now, zone))

    /** `toneForLevel`: which of the pair's two palettes the text takes. */
    fun tone(level: Double, flipLevel: Double = INK_FLIP_LEVEL): Tone = if (level >= flipLevel) Tone.LIGHT else Tone.DARK

    /** The `--auto-light` the desktop writes on its page: the level as a percentage with one decimal, `(level * 100).toFixed(1)`. */
    fun autoLight(level: Double): String = "${percent(level)}%"

    /** `autoLight` as the share (0 to 1) the surfaces blend by: the page blends by the rounded percentage it writes, not by the level. */
    fun autoLightShare(level: Double): Double = percent(level).toDouble() / 100

    /** `(level * 100).toFixed(1)` for a level from 0 to 1, a level below 0 taken as 0. */
    private fun percent(level: Double): String = JavaScriptText.toFixed(maxOf(0.0, level * 100), 1)
}
