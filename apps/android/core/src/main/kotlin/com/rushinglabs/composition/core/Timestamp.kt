package com.rushinglabs.composition.core

import java.time.Instant

/**
 * The timestamps the desktop writes: `new Date().toISOString()`, e.g. `2026-11-05T20:53:20.123Z` (UTC, always milliseconds,
 * always 24 characters). Compared as strings in SQL, so the format must match exactly; the arithmetic is on whole
 * milliseconds. Ported from Timestamp.swift (Howard Hinnant's days-from-civil algorithms, proleptic Gregorian).
 */
object Timestamp {
    const val MILLISECONDS_PER_DAY = 86_400_000L

    /** Now, or `instant`, as the desktop would write it. */
    fun now(instant: Instant = Instant.now()): String = string(instant.toEpochMilli())

    /** Milliseconds since 1970 for a string in exactly the `toISOString` form, or null for anything else. */
    fun milliseconds(string: String): Long? {
        val b = string.toByteArray(Charsets.UTF_8)
        if (b.size != 24 || b[4] != '-'.code.toByte() || b[7] != '-'.code.toByte() || b[10] != 'T'.code.toByte() ||
            b[13] != ':'.code.toByte() || b[16] != ':'.code.toByte() || b[19] != '.'.code.toByte() || b[23] != 'Z'.code.toByte()
        ) return null
        fun number(from: Int, until: Int): Long? {
            var value = 0L
            for (index in from until until) {
                val byte = b[index]
                if (byte < '0'.code.toByte() || byte > '9'.code.toByte()) return null
                value = value * 10 + (byte - '0'.code.toByte())
            }
            return value
        }
        val year = number(0, 4) ?: return null
        val month = number(5, 7) ?: return null
        val day = number(8, 10) ?: return null
        val hour = number(11, 13) ?: return null
        val minute = number(14, 16) ?: return null
        val second = number(17, 19) ?: return null
        val millisecond = number(20, 23) ?: return null
        if (month !in 1..12 || hour >= 24 || minute >= 60 || second >= 60) return null
        if (day < 1 || day > daysInMonth(year, month)) return null
        val days = daysFromCivil(year, month, day)
        return (days * 86_400 + hour * 3600 + minute * 60 + second) * 1000 + millisecond
    }

    /** The `toISOString` text for a moment. */
    fun string(milliseconds: Long): String {
        val days = Math.floorDiv(milliseconds, MILLISECONDS_PER_DAY)
        val inDay = milliseconds - days * MILLISECONDS_PER_DAY
        val (year, month, day) = civilFromDays(days)
        val hour = inDay / 3_600_000
        val minute = inDay / 60_000 % 60
        val second = inDay / 1000 % 60
        val millisecond = inDay % 1000
        fun pad(value: Long, width: Int) = value.toString().padStart(width, '0')
        return "${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(millisecond, 3)}Z"
    }

    private fun isLeap(year: Long) = year % 4 == 0L && (year % 100 != 0L || year % 400 == 0L)

    fun daysInMonth(year: Long, month: Long): Long =
        if (month == 2L) (if (isLeap(year)) 29 else 28) else if (month in listOf(4L, 6L, 9L, 11L)) 30 else 31

    fun daysFromCivil(year: Long, month: Long, day: Long): Long {
        val y = if (month <= 2) year - 1 else year
        val era = Math.floorDiv(y, 400L)
        val yearOfEra = y - era * 400
        val dayOfYear = (153 * (month + (if (month > 2) -3 else 9)) + 2) / 5 + day - 1
        val dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    private fun civilFromDays(days: Long): Triple<Long, Long, Long> {
        val z = days + 719_468
        val era = Math.floorDiv(z, 146_097L)
        val dayOfEra = z - era * 146_097
        val yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        val dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        val monthIndex = (5 * dayOfYear + 2) / 153
        val day = dayOfYear - (153 * monthIndex + 2) / 5 + 1
        val month = if (monthIndex < 10) monthIndex + 3 else monthIndex - 9
        return Triple(yearOfEra + era * 400 + (if (month <= 2) 1 else 0), month, day)
    }
}
