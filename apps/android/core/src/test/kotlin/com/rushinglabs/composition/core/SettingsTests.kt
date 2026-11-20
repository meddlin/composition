package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.sun.SunHours
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Settings: favorites, the scheme and the Follow the sun hours, and the settings file in a backup; ported from SettingsTests.swift.

@DisplayName("Settings: favorites, scheme and Follow the sun hours")
class SettingsTests {
    private fun location(scratch: File, name: String = "data") = DataLocation(File(scratch, name))

    /** A settings file like the desktop's, with keys the core does not use. */
    private val desktopSettings = """
        {"theme":"forest","sidebarWidth":321,"editorRatio":0.4,"favorites":[{"type":"note","id":1}],
         "sunHours":{"lightenFrom":"19:00","lightFrom":"20:00","darkenFrom":"05:00","darkFrom":"06:00"},
         "todos":{"weekStart":1},"plugins":{"todo":true,"reader":false},"panels":{"version":2,"cells":[1,2,3]},
         "assistant":{"host":"http://localhost:11434"}}
    """.trimIndent()

    private fun obj(file: File): JsonObject = readJson(file).jsonObject

    /** A database with two notes, a trashed one and an attachment, and the files a backup carries (TestSupport.swift's `populate`). */
    private fun populate(location: DataLocation, titles: List<String> = listOf("Alpha", "Beta")): CompositionDatabase {
        val database = CompositionDatabase.open(location)
        database.file.write { db ->
            for (title in titles) {
                db.execute(
                    "INSERT INTO notes (title, content, created_at, updated_at, notebook_id) VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 1)",
                    title, "# $title\n\nbody of $title\n",
                )
            }
            db.execute("INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at, notebook_id) VALUES (900, 'Deleted', 'x', 'x', '2026-01-03T00:00:00.000Z', 1)")
            db.execute("INSERT INTO attachments (note_id, file_name, stored_name, size, created_at) VALUES (1, 'report.pdf', '3f9c2a71b0de-report.pdf', 5, 'x')")
        }
        location.imagesDirectory.mkdirs()
        location.attachmentsDirectory.mkdirs()
        File(location.imagesDirectory, "route-map-3f9c2a71b0de.png").writeText("png-bytes-1")
        File(location.imagesDirectory, "photo-aaaaaaaaaaaa.JPG").writeText("jpg-bytes-2")
        File(location.attachmentsDirectory, "3f9c2a71b0de-report.pdf").writeText("hello")
        File(location.attachmentsDirectory, "b.txt").writeText("notes")
        return database
    }

    @Test
    @DisplayName("favorites are pinned at the end, unpinned by pinning again, and kept in order")
    fun favorites() = withScratch { scratch ->
        val store = SettingsStore(location(scratch))
        assertTrue(store.favorites().isEmpty() && !store.isFavorite(FavoriteKind.NOTE, 1))
        assertEquals(listOf(Favorite(FavoriteKind.NOTE, 1)), store.toggleFavorite(FavoriteKind.NOTE, 1))
        assertEquals(listOf(Favorite(FavoriteKind.NOTE, 1), Favorite(FavoriteKind.GROUP, 1)), store.toggleFavorite(FavoriteKind.GROUP, 1))
        assertEquals(listOf(Favorite(FavoriteKind.GROUP, 1)), store.toggleFavorite(FavoriteKind.NOTE, 1), "unpinned")
        assertEquals(listOf(Favorite(FavoriteKind.GROUP, 1), Favorite(FavoriteKind.NOTE, 2)), store.toggleFavorite(FavoriteKind.NOTE, 2))
        assertEquals(listOf(Favorite(FavoriteKind.GROUP, 1), Favorite(FavoriteKind.NOTE, 2)), store.favorites(), "read back from the file")
        assertTrue(store.isFavorite(FavoriteKind.NOTE, 2) && !store.isFavorite(FavoriteKind.NOTE, 1))
    }

    @Test
    @DisplayName("an id is a JSON number as JavaScript reads it, the nearest double, as the desktop's favorites.ts and the iPad take it")
    fun idsAsJavaScriptReadsThem() {
        // What `Number.isSafeInteger(JSON.parse(…))` says of each (node, 2026-11-20); exact decimals would drop the first two.
        val ids = """[1.0000000000000001, 9007199254740991.4, 1e2, -0, 9007199254740993, 1.5, "1", true, null]"""
        val entries = Json.parseToJsonElement(ids).jsonArray.joinToString(",", "[", "]") { """{"type":"note","id":$it}""" }
        assertEquals(
            listOf(1L, 9_007_199_254_740_991L, 100L, 0L).map { Favorite(FavoriteKind.NOTE, it) },
            SettingsStore.parseFavorites(Json.parseToJsonElement(entries)),
        )
    }

    @Test
    @DisplayName("a change leaves every key the core does not use as the desktop wrote it")
    fun keepsTheDesktopsKeys() = withScratch { scratch ->
        val place = location(scratch)
        place.directory.mkdirs()
        place.settingsFile.writeText(desktopSettings)
        val before = obj(place.settingsFile)

        val store = SettingsStore(place)
        assertEquals(listOf(Favorite(FavoriteKind.NOTE, 1)), store.favorites())
        assertEquals("forest", store.theme())
        assertEquals(SunHours(19 * 60, 20 * 60, 5 * 60, 6 * 60), store.sunHours())
        store.toggleFavorite(FavoriteKind.GROUP, 7)
        store.setTheme("cream")

        val after = obj(place.settingsFile)
        assertEquals(2, after.getValue("favorites").jsonArray.size)
        assertEquals(JsonPrimitive("cream"), after["theme"])
        val changed = setOf("favorites", "theme")
        assertEquals(
            JsonObject(before.filterKeys { it !in changed }),
            JsonObject(after.filterKeys { it !in changed }),
            "sidebarWidth, sunHours, todos, plugins, panels and the assistant are untouched",
        )
    }

    @Test
    @DisplayName("the colour scheme is one of the desktop's six, and the Follow the sun hours can be set")
    fun themeAndHours() = withScratch { scratch ->
        val store = SettingsStore(location(scratch))
        assertEquals("dark", store.theme(), "the desktop's default when nothing is set")
        for (name in SettingsStore.THEME_NAMES) {
            store.setTheme(name)
            assertEquals(name, store.theme())
        }
        val refusal = assertFailsWith<SettingsException.UnknownTheme> { store.setTheme("system") }
        assertEquals("“system” is not one of the colour schemes.", refusal.message)
        assertEquals("auto", store.theme(), "a refused name changes nothing")

        assertEquals(SunHours.DEFAULT, store.sunHours(), "nothing saved reads as the defaults")
        val hours = SunHours(6 * 60, 7 * 60, 18 * 60 + 30, 20 * 60)
        store.setSunHours(hours)
        assertEquals(hours, store.sunHours())
    }

    @Test
    @DisplayName("a file that is not a JSON object is read as empty and replaced on the first change")
    fun damagedFile() = withScratch { scratch ->
        val place = location(scratch)
        place.directory.mkdirs()
        for (junk in listOf("not json", "[1,2,3]", "null", "")) {
            place.settingsFile.writeText(junk)
            val store = SettingsStore(place)
            assertTrue(store.favorites().isEmpty() && store.theme() == "dark" && store.sunHours() == SunHours.DEFAULT, junk)
        }
        SettingsStore(place).toggleFavorite(FavoriteKind.NOTE, 3)
        assertNotNull(obj(place.settingsFile)["favorites"])
        Unit
    }

    // In a backup

    @Test
    @DisplayName("a backup carries the settings file as it is, and a restore writes it back as it is")
    fun backupRoundTrip() = withScratch { scratch ->
        val source = location(scratch, "source")
        val file = File(scratch, "backup.tar.gz")
        populate(source).use { database ->
            source.settingsFile.writeText(desktopSettings)
            Backup.create(database, source, file)
        }

        val target = location(scratch, "target")
        val staged = Backup.stage(file, target)
        assertContentEquals(desktopSettings.toByteArray(), staged.settings, "the file as it was")
        Backup.apply(staged, target)
        assertContentEquals(desktopSettings.toByteArray(), target.settingsFile.readBytes())
        CompositionDatabase.open(target).close()
    }

    @Test
    @DisplayName("a backup without settings leaves the current ones alone, and one with them replaces them")
    fun restoreAndSettings() = withScratch { scratch ->
        // A backup with no settings file (a device that never had one).
        val bare = location(scratch, "bare")
        val bareFile = File(scratch, "bare.tar.gz")
        populate(bare).use { Backup.create(it, bare, bareFile) }

        val target = location(scratch, "target")
        populate(target).close()
        target.settingsFile.writeText("""{"theme":"wine","favorites":[{"type":"note","id":9}]}""")

        val staged = Backup.stage(bareFile, target)
        assertNull(staged.settings)
        Backup.apply(staged, target)
        assertEquals("wine", SettingsStore(target).theme(), "kept: the desktop does the same for a backup without settings")

        // One with settings replaces them whole.
        val withSettings = location(scratch, "with")
        val file = File(scratch, "with.tar.gz")
        populate(withSettings).use { database ->
            withSettings.settingsFile.writeText("""{"theme":"light"}""")
            Backup.create(database, withSettings, file)
        }
        Backup.apply(Backup.stage(file, target), target)
        assertEquals("light", SettingsStore(target).theme())
        assertTrue(SettingsStore(target).favorites().isEmpty())
    }

    @Test
    @DisplayName("an oversized or non-object settings file is left out of a backup")
    fun unusableSettings() = withScratch { scratch ->
        val source = location(scratch, "source")
        val file = File(scratch, "backup.tar.gz")
        populate(source).use { database ->
            for (junk in listOf("[1]".toByteArray(), "nope".toByteArray(), ByteArray(1024 * 1024 + 10) { 0x20 })) {
                source.settingsFile.writeBytes(junk)
                Backup.create(database, source, file)
                val staged = Backup.stage(file, location(scratch, "t${junk.size}"))
                assertNull(staged.settings, "${junk.size} bytes")
                Backup.discard(staged)
            }
        }
        assertFalse(File(scratch, "t3").resolve("settings.json").exists())
    }
}
