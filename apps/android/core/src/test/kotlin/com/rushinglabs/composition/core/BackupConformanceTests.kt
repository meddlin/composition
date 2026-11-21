package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.sun.SunHours
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Backups against the desktop's own code, in both directions; ported from BackupConformanceTests.swift.
//
//   desktop -> Kotlin   desktop-backup*.tar.gz are made by the real `createBackup`. The Kotlin core restores each and must find
//                       exactly what the desktop says it put in: the notes and their uuids, the Trash Can, every file by hash.
//   Kotlin -> desktop   It then backs up what it restored, after about a hundred edits, to swift-backup*.tar.gz plus a
//                       description (the names the desktop's test reads, which was written for the iPad core). The TypeScript side
//                       restores those with the real `stageBackup` and `applyStagedBackup` and compares
//                       (apps/web/scripts/conformance-fixtures.test.ts, "reads what the Swift core wrote").

@DisplayName("Backups against the desktop")
class BackupConformanceTests {
    private val pretty = Json { prettyPrint = true }

    private fun sha256(file: File): String = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }

    /** What a data directory holds, in the shape the desktop writes as `*.expected.json`. */
    private fun describe(location: DataLocation, counts: BackupCounts): JsonObject {
        fun rows(table: String) = raw(location.databaseFile) { db ->
            JsonArray(db.rows("SELECT id, uuid, title FROM $table ORDER BY id").map {
                JsonObject(mapOf("id" to JsonPrimitive(it.long("id")), "uuid" to JsonPrimitive(it.string("uuid")), "title" to JsonPrimitive(it.string("title"))))
            })
        }
        val files = sortedMapOf<String, JsonElement>()
        for (folder in listOf(BackupNames.IMAGE_DIRECTORY, BackupNames.ATTACHMENT_DIRECTORY)) {
            for (file in File(location.directory, folder).listFiles() ?: emptyArray()) files["$folder/${file.name}"] = JsonPrimitive(sha256(file))
        }
        return JsonObject(mapOf("counts" to counts.json, "notes" to rows("notes"), "trashedNotes" to rows("trashed_notes"), "files" to JsonObject(files)))
    }

    private fun counts(json: JsonElement) = json.jsonObject.let {
        fun n(key: String) = it.getValue(key).jsonPrimitive.int
        BackupCounts(n("notes"), n("groups"), n("trashedNotes"), n("trashedGroups"), n("images"), n("attachments"), n("documents"), n("todos"), n("archivedTodos"), n("contacts"))
    }

    /** About a hundred operations of every kind, as the iPad's test makes. Returns how many more notes, groups and trashed notes there are. */
    private fun editALot(store: NoteStore): Triple<Int, Int, Int> {
        var clock = Instant.ofEpochSecond(1_800_000_000)
        fun tick(): Instant { clock = clock.plusSeconds(1); return clock }
        val notebook = store.createNotebook("Ops", tick())
        val groups = ArrayList<NoteGroup>()
        for (index in 0 until 8) {
            val parent = if (index % 3 == 2) groups[index - 1].id else null
            groups.add(store.createGroup("Group $index", parent, notebook.id, tick()))
        }
        val notes = ArrayList<NoteDetail>()
        for (index in 0 until 40) notes.add(store.createNote("Op note $index: colon", groups[index % groups.size].id, now = tick()))
        for (note in notes.take(20)) store.saveNoteContent(note.id, "---\ntitle: Edited ${note.id}\ntags: a, b\n---\n# Heading\n\nBody ${note.id}\n", tick())
        for ((index, note) in notes.withIndex()) if (index % 4 == 0) store.placeNote(note.id, groups[(index + 1) % groups.size].id, null)
        for (note in notes.take(5)) store.moveNote(note.id, null)
        for (group in groups.takeLast(3)) runCatching { store.moveGroup(group.id, groups[0].id, tick()) }
        store.placeGroup(groups[1].id, null, groups[0].id, tick())
        store.renameGroup(groups[0].id, "Renamed", tick())
        for (note in notes.subList(30, 40)) store.deleteNote(note.id, tick())
        for (note in notes.subList(30, 33)) store.restoreNote(note.id)
        return Triple(40 - 10 + 3, 8, 10 - 3)
    }

    @Test
    @DisplayName("restores the desktop's small backup, and backs up the result for the desktop to restore")
    fun smallBackup() = desktopToKotlinAndBack("desktop-backup")

    @Test
    @DisplayName("restores the desktop's large backup (a 100 MB attachment), and backs up the result for the desktop to restore")
    fun largeBackup() = desktopToKotlinAndBack("desktop-backup-large")

    private fun desktopToKotlinAndBack(name: String) {
        val directory = requireConformance()
        val archive = fixture("$name.tar.gz")
        val expected = readJson(File(directory, "$name.expected.json")).jsonObject

        withScratch { scratch ->
            // Desktop -> Kotlin
            val target = DataLocation(File(scratch, "android"))
            val staged = Backup.stage(archive, target)
            assertEquals(counts(expected.getValue("counts")), staged.counts, "the counts read from the database match the desktop's own")
            Backup.apply(staged, target)

            val database = CompositionDatabase.open(target)  // the Kotlin schema pass runs on the desktop's database
            val restored = describe(target, staged.counts)
            assertEquals(null, restored.getValue("notes").difference(expected.getValue("notes")), "same notes, ids and uuids")
            assertEquals(null, restored.getValue("trashedNotes").difference(expected.getValue("trashedNotes")))
            assertEquals(null, restored.getValue("files").difference(expected.getValue("files")), "every image and attachment, byte for byte")
            assertTrue(restored.getValue("files").jsonObject.isNotEmpty())

            // Settings: the desktop's file arrives whole, the core reads it, and changes only the favorites.
            val original = readJson(File(directory, "$name.settings.json"))
            assertEquals(null, readJson(target.settingsFile).difference(original), "settings.json arrives as the desktop wrote it")
            val settings = SettingsStore(target)
            assertEquals(listOf(Favorite(FavoriteKind.NOTE, 1), Favorite(FavoriteKind.GROUP, 1)), settings.favorites())
            assertEquals("forest", settings.theme())
            assertEquals(SunHours(19 * 60, 20 * 60, 5 * 60, 6 * 60), settings.sunHours(), "the hours the desktop saved are these")
            settings.toggleFavorite(FavoriteKind.NOTE, 1)  // unpin
            settings.toggleFavorite(FavoriteKind.NOTE, 2)  // pin
            assertEquals(listOf(Favorite(FavoriteKind.GROUP, 1), Favorite(FavoriteKind.NOTE, 2)), settings.favorites())

            // A hundred edits through the store, on the desktop's own database, before it is backed up again.
            val (notes, groups, trashedNotes) = editALot(NoteStore(database))

            // Kotlin -> desktop
            val output = File(directory, name.replace("desktop", "swift") + ".tar.gz")
            output.delete()
            val summary = Backup.create(database, target, output)
            val before = counts(expected.getValue("counts"))
            assertEquals(before.copy(notes = before.notes + notes, groups = before.groups + groups, trashedNotes = before.trashedNotes + trashedNotes), summary.counts, "the counts follow the edits")
            database.close()

            val description = describe(target, summary.counts)
            File(directory, name.replace("desktop", "swift") + ".expected.json").writeText(pretty.encodeToString(JsonElement.serializer(), description))
            println("$name: restored ${restored.getValue("notes").let { (it as JsonArray).size }} notes and ${restored.getValue("files").jsonObject.size} files; wrote ${output.name} (${output.length()} bytes)")
        }
    }
}
