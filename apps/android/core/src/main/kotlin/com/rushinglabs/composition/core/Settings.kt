package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.sun.SunHours
import com.rushinglabs.composition.core.sun.SunPairName
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

// The settings that travel with a backup: favorites, the colour scheme and the Follow the sun hours, read from and written to
// `settings.json` in the data folder, which is the desktop's file of the same name. Ported from Settings.swift; the hours themselves are
// `sun/SunHours.kt`, and the scheme, the fonts and the writing aids are kept by `appearance/Appearance.kt` and `editing/Writing.kt`.
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

/** Why the settings refused a change; nothing was written. */
sealed class SettingsException(message: String) : Exception(message) {
    class UnknownTheme(val name: String) : SettingsException("“$name” is not one of the colour schemes.")
    class UnusableSunHours(val reason: String) : SettingsException(reason)
}

class SettingsStore(location: DataLocation) {
    companion object {
        /** The desktop's schemes, the only names its settings file may hold (it falls back to `dark` for anything else). */
        val THEME_NAMES = listOf("dark", "light", "forest", "wine", "cream", "auto")
        const val DEFAULT_THEME = "dark"
        private val writer = Json { prettyPrint = true }

        private val JSON_NUMBER = Regex("""-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?""")

        /**
         * A JSON number as JavaScript's `JSON.parse` reads it: the nearest double, so `1.0000000000000001` is 1. Null for anything
         * else, a boolean included.
         */
        internal fun jsonNumber(value: JsonElement?): Double? {
            val primitive = value as? JsonPrimitive ?: return null
            if (primitive is JsonNull || primitive.isString || !JSON_NUMBER.matches(primitive.content)) return null
            return primitive.content.toDouble()
        }

        /** `Number.isSafeInteger` of a JSON number: a whole number within ±(2^53 − 1), and not a boolean. */
        internal fun safeInteger(value: JsonElement?): Long? {
            val number = jsonNumber(value) ?: return null
            if (!number.isFinite() || number != kotlin.math.truncate(number) || kotlin.math.abs(number) > 9_007_199_254_740_991.0) return null
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

    /** The four hours Follow the sun moves at (`parseSunHours`): all four valid and in order round the clock, or the defaults. */
    fun sunHours(): SunHours = locked { SunHours.fromSettings(it["sunHours"]) }

    /** The light and dark colours Follow the sun moves between; the classic pair for anything the file does not name. */
    fun sunPair(): SunPairName = locked { SunPairName.fromSettings(it["sunPair"]) }

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

    /** Sets the colour scheme to one of the desktop's six names; any other name is refused (the desktop would read it as `dark`). */
    fun setTheme(name: String) {
        if (name !in THEME_NAMES) throw SettingsException.UnknownTheme(name)
        edit { it["theme"] = JsonPrimitive(name) }
    }

    /** Keeps the hours Follow the sun moves at. Hours that do not go round the clock in order are refused (`SunHours.problem`) and nothing is written. */
    fun setSunHours(hours: SunHours) {
        hours.problem?.let { throw SettingsException.UnusableSunHours(it) }
        edit { it["sunHours"] = hours.settingsObject }
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
