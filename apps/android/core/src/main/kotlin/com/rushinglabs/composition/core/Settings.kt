package com.rushinglabs.composition.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.math.BigDecimal
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

// The settings that travel with a backup: favorites, the colour scheme and the Follow the sun hours, read from and written to
// `settings.json` in the data folder, which is the desktop's file of the same name. Ported from Settings.swift and SunHours.swift.
//
// The desktop keeps far more in that file, and a restore replaces the desktop's settings with the backup's. So this never writes
// a file of its own making when it has one from the desktop: it reads the file as JSON, changes the keys it uses, and writes every
// other key back as it came.

enum class FavoriteKind(val rawValue: String) {
    GROUP("group"), NOTE("note");

    companion object {
        fun of(rawValue: String) = entries.firstOrNull { it.rawValue == rawValue }
    }
}

/** A pinned group or note, as the desktop's `favorites.ts` has it: in pin order, no duplicates. */
data class Favorite(val kind: FavoriteKind, val id: Long)

/**
 * The four hours a person sets by hand for Follow the sun, in minutes after midnight (`sunHours.ts`). They go once round the clock
 * in order, from any starting point, with at least a minute between neighbours.
 */
data class SunHours(val lightenFrom: Int, val lightFrom: Int, val darkenFrom: Int, val darkFrom: Int) {
    val minutes get() = listOf(lightenFrom, lightFrom, darkenFrom, darkFrom)

    /** The object a settings file keeps: the four hours as `HH:MM` text. */
    val settingsObject: JsonObject get() = JsonObject(KEYS.zip(minutes).associate { (key, value) -> key to JsonPrimitive(formatClock(value)) })

    companion object {
        const val MINUTES_PER_DAY = 24 * 60
        /** 06:30 and 18:30 with a 90-minute fade centred on each. */
        val DEFAULT = SunHours(5 * 60 + 45, 7 * 60 + 15, 17 * 60 + 45, 19 * 60 + 15)
        private val KEYS = listOf("lightenFrom", "lightFrom", "darkenFrom", "darkFrom")

        /** `parseClock`: `"07:15"` as minutes after midnight, or null for anything that is not `HH:MM` on a 24-hour clock. */
        fun parseClock(value: JsonElement?): Int? {
            val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            if (text.length != 5 || text[2] != ':' || text.toByteArray().size != 5) return null
            val digits = listOf(0, 1, 3, 4).map { text[it].takeIf { c -> c in '0'..'9' }?.minus('0') ?: return null }
            val hour = digits[0] * 10 + digits[1]
            val minute = digits[2] * 10 + digits[3]
            return if (hour <= 23 && minute <= 59) hour * 60 + minute else null
        }

        fun formatClock(minutes: Int): String {
            val whole = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
            return String.format(java.util.Locale.ROOT, "%02d:%02d", whole / 60, whole % 60)
        }

        /** `goRoundTheClock`: each of the four forward gaps is at least a minute, and together they make exactly one day. */
        fun goRoundTheClock(minutes: List<Int>): Boolean {
            var total = 0
            for (index in minutes.indices) {
                val gap = ((minutes[(index + 1) % minutes.size] - minutes[index]) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY
                if (gap < 1) return false
                total += gap
            }
            return total == MINUTES_PER_DAY
        }

        /** `parseSunHours`: a good set, or the defaults for anything else (all or nothing). */
        fun fromSettings(value: JsonElement?): SunHours {
            val parsed = KEYS.map { parseClock((value as? JsonObject)?.get(it)) ?: return DEFAULT }
            val found = SunHours(parsed[0], parsed[1], parsed[2], parsed[3])
            return if (goRoundTheClock(found.minutes)) found else DEFAULT
        }
    }
}

class SettingsStore(location: DataLocation) {
    companion object {
        /** The desktop's schemes, the only names its settings file may hold (it falls back to `dark` for anything else). */
        val THEME_NAMES = listOf("dark", "light", "forest", "wine", "cream", "auto")
        const val DEFAULT_THEME = "dark"
        private val writer = Json { prettyPrint = true }

        /** `Number.isSafeInteger`: a JSON number that is a whole number within ±(2^53 − 1), and not a boolean. */
        internal fun safeInteger(value: JsonElement?): Long? {
            val primitive = value as? JsonPrimitive ?: return null
            if (primitive.isString || primitive.content == "true" || primitive.content == "false" || primitive.content == "null") return null
            val number = runCatching { BigDecimal(primitive.content) }.getOrNull() ?: return null
            if (number.stripTrailingZeros().scale() > 0 || number.abs() > BigDecimal(9_007_199_254_740_991L)) return null
            return number.toLong()
        }

        /** `parseFavorites`: whatever came off disk, reduced to well-formed entries with duplicates dropped. */
        internal fun parseFavorites(value: JsonElement?): List<Favorite> {
            val entries = value as? JsonArray ?: return emptyList()
            val result = ArrayList<Favorite>()
            for (entry in entries) {
                val obj = entry as? JsonObject ?: continue
                val type = (obj["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
                val kind = FavoriteKind.of(type) ?: continue
                val id = safeInteger(obj["id"]) ?: continue
                val item = Favorite(kind, id)
                if (item !in result) result.add(item)
            }
            return result
        }

        internal fun parseTheme(value: JsonElement?): String =
            (value as? JsonPrimitive)?.takeIf { it.isString && it.content in THEME_NAMES }?.content ?: DEFAULT_THEME
    }

    private val file: File = location.settingsFile
    private val lock = ReentrantLock()

    fun favorites(): List<Favorite> = locked { parseFavorites(it["favorites"]) }

    fun isFavorite(kind: FavoriteKind, id: Long) = Favorite(kind, id) in favorites()

    fun theme(): String = locked { parseTheme(it["theme"]) }

    fun sunHours(): SunHours = locked { SunHours.fromSettings(it["sunHours"]) }

    fun setFavorites(favorites: List<Favorite>) = edit { it["favorites"] = favoritesJson(favorites) }

    /** Pins the item at the end of the list, or unpins it if it was already pinned; returns the new list. */
    fun toggleFavorite(kind: FavoriteKind, id: Long): List<Favorite> {
        var result = emptyList<Favorite>()
        edit { obj ->
            val current = parseFavorites(obj["favorites"]).toMutableList()
            val item = Favorite(kind, id)
            if (!current.remove(item)) current.add(item)
            obj["favorites"] = favoritesJson(current)
            result = current
        }
        return result
    }

    /** Sets the colour scheme to one of the desktop's six names; any other name is refused. */
    fun setTheme(name: String) {
        require(name in THEME_NAMES) { "“$name” is not one of the colour schemes." }
        edit { it["theme"] = JsonPrimitive(name) }
    }

    private fun favoritesJson(favorites: List<Favorite>) =
        JsonArray(favorites.map { JsonObject(mapOf("type" to JsonPrimitive(it.kind.rawValue), "id" to JsonPrimitive(it.id))) })

    /** The settings object as it is on disk, or an empty one when there is no file or it is not a JSON object. */
    private fun readObject(): Map<String, JsonElement> {
        if (!file.isFile || file.length() > BackupNames.MAX_JSON_BYTES) return emptyMap()
        return (runCatching { Json.parseToJsonElement(file.readText()) }.getOrNull() as? JsonObject) ?: emptyMap()
    }

    internal fun <T> locked(body: (Map<String, JsonElement>) -> T): T = lock.withLock { body(readObject()) }

    /** Changes the keys `body` touches and writes the object back, every other key as it was. Written to a temporary name and renamed. */
    internal fun edit(body: (MutableMap<String, JsonElement>) -> Unit) = lock.withLock {
        val obj = LinkedHashMap(readObject())
        body(obj)
        // The city an older version kept for Follow the sun is not read any more, and goes with the next write.
        obj.remove("location")
        file.parentFile.mkdirs()
        val temporary = File(file.parentFile, ".${file.name}.partial")
        temporary.writeText(writer.encodeToString(JsonElement.serializer(), JsonObject(obj.toSortedMap())))
        if (!temporary.renameTo(file)) {
            file.delete()
            check(temporary.renameTo(file)) { "could not write ${file.path}" }
        }
    }
}
