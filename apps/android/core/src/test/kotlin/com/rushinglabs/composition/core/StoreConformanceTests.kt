package com.rushinglabs.composition.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import java.io.File
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

// The Kotlin store against the desktop's real `service.ts` (and the repos under it), ported from StoreConformanceTests.swift.
// Both run the steps in fixtures/conformance/store-script.json against the same starting database (store-start.db). After every
// step the TypeScript recorded the result and every row of notes, groups, notebooks, trashed_notes, trashed_groups and
// sqlite_sequence (store-script.expected.json); the Kotlin core records the same and the two must be equal.

@DisplayName("Notes, groups and notebooks against the desktop")
class StoreConformanceTests {
    private fun date(iso: String?): Instant = Instant.ofEpochMilli(iso?.let(Timestamp::milliseconds) ?: fail("bad time in the script: $iso"))

    private fun dump(database: CompositionDatabase): JsonElement = database.file.read { db ->
        val tables = linkedMapOf<String, JsonElement>()
        for (table in listOf("notes", "groups", "notebooks", "trashed_notes", "trashed_groups")) {
            tables[table] = JsonArray(db.rows("SELECT * FROM $table ORDER BY id").map(::json))
        }
        tables["sqlite_sequence"] = JsonArray(db.rows("SELECT name, seq FROM sqlite_sequence ORDER BY name").map(::json))
        JsonObject(tables)
    }

    // The shapes the TypeScript records: the desktop's own field names.
    private fun json(note: NoteDetail) = JsonObject(mapOf(
        "id" to json(note.id), "uuid" to json(note.uuid), "title" to json(note.title), "content" to json(note.content),
        "tags" to json(note.tags), "description" to json(note.description), "createdAt" to json(note.createdAt),
        "updatedAt" to json(note.updatedAt), "groupId" to json(note.groupId), "notebookId" to json(note.notebookId),
    ))

    private fun json(group: NoteGroup) = JsonObject(mapOf(
        "id" to json(group.id), "uuid" to json(group.uuid), "name" to json(group.name), "parentId" to json(group.parentId),
        "notebookId" to json(group.notebookId), "createdAt" to json(group.createdAt), "updatedAt" to json(group.updatedAt),
    ))

    private fun json(notebook: Notebook) = JsonObject(mapOf(
        "id" to json(notebook.id), "uuid" to json(notebook.uuid), "name" to json(notebook.name),
        "createdAt" to json(notebook.createdAt), "updatedAt" to json(notebook.updatedAt),
    ))

    private fun json(restored: RestoreResult?): JsonElement =
        restored?.let { JsonObject(mapOf("restoredToTopLevel" to JsonPrimitive(it.restoredToTopLevel))) } ?: JsonNull

    private fun refused(kind: String) = JsonObject(mapOf("error" to JsonPrimitive(kind)))

    private fun run(step: JsonObject, store: NoteStore, now: Instant): JsonElement {
        val id = step.long("id") ?: 0
        fun need(key: String) = step.string(key) ?: fail("the step needs $key")
        return try {
            when (val op = step.string("op")) {
                "createNote" -> json(store.createNote(need("title"), step.long("groupId"), step.long("notebookId"), now))
                "saveNoteContent" -> json(store.saveNoteContent(id, need("content"), now))
                "deleteNote" -> { store.deleteNote(id, now); JsonNull }
                "restoreNote" -> json(store.restoreNote(id))
                "moveNoteToGroup" -> json(store.moveNote(id, step.long("groupId")))
                "placeNote" -> json(store.placeNote(id, step.long("groupId"), step.long("beforeId")))
                "createGroup" -> json(store.createGroup(need("name"), step.long("parentId"), step.long("notebookId"), now))
                "renameGroup" -> json(store.renameGroup(id, need("name"), now))
                "deleteGroup" -> { store.deleteGroup(id, now); JsonNull }
                "restoreGroup" -> json(store.restoreGroup(id))
                "moveGroup" -> json(store.moveGroup(id, step.long("parentId"), now))
                "moveGroupToNotebook" -> json(store.moveGroupToNotebook(id, step.long("notebookId") ?: fail("needs notebookId"), now))
                "placeGroup" -> json(store.placeGroup(id, step.long("parentId"), step.long("beforeId"), now))
                "groupIsEmpty" -> JsonPrimitive(store.database.groupIsEmpty(id))
                "createNotebook" -> json(store.createNotebook(need("name"), now))
                "renameNotebook" -> json(store.renameNotebook(id, need("name"), now))
                "placeNotebook" -> JsonArray(store.placeNotebook(id, step.long("beforeId")).map { json(it.id) })
                "deleteNotebook" -> { store.deleteNotebook(id); JsonNull }
                "listNotes" -> JsonArray(store.database.notesInDisplayOrder().map { json(it.id) })
                "listGroups" -> JsonArray(store.database.listGroups().map { json(it.id) })
                "listNotebooks" -> JsonArray(store.database.listNotebooks().map { json(it.id) })
                "sql" -> { store.database.file.write { it.execute(need("sql")) }; JsonNull }
                else -> fail("unknown step $op")
            }
        } catch (_: CoreException.NotFound) {
            refused("notFound")
        } catch (_: CoreException.InvalidGroupMove) {
            refused("invalidGroupMove")
        } catch (_: CoreException.InvalidNotebookMove) {
            refused("invalidGroupMove")
        } catch (_: CoreException.LastNotebook) {
            refused("lastNotebook")
        } catch (_: CoreException.NotebookNotEmpty) {
            refused("notebookNotEmpty")
        } catch (_: CoreException.NoNotebooks) {
            refused("noNotebooks")
        } catch (_: CoreException.GroupNotEmpty) {
            refused("groupNotEmpty")
        }
    }

    @Test
    @DisplayName("every step of the script leaves the same results and the same rows as the desktop's service")
    fun scriptMatchesDesktop() {
        val directory = requireConformance()
        val steps = steps(File(directory, "store-script.json"))
        val expected = steps(File(directory, "store-script.expected.json"))
        assertTrue(steps.size == expected.size && steps.size > 80, "the script and the desktop's record agree on the steps")

        withScratch { scratch ->
            val file = File(scratch, "composition.db")
            File(directory, "store-start.db").copyTo(file)
            CompositionDatabase.open(file).use { database ->
                val store = NoteStore(database)
                // The uuids the starting database had; anything else a step produces is a fresh one.
                val known = database.file.read { db ->
                    listOf("notes", "groups", "notebooks", "trashed_notes", "trashed_groups").flatMap { db.strings("SELECT uuid FROM $it") }.toSet()
                }
                assertTrue(known.size >= 20)

                var clock = Instant.now()
                val problems = mutableListOf<String>()
                for ((index, pair) in steps.zip(expected).withIndex()) {
                    val (step, desktop) = pair
                    assertEquals(desktop.string("op"), step.string("op"))
                    step.string("at")?.let { clock = date(it) }
                    val label = "step $index (${step.string("op")} ${step.long("id") ?: ""})"
                    val result = run(step, store, clock).normalizingUuids(known)
                    val rows = dump(database).normalizingUuids(known)
                    result.difference(desktop.getValue("result").normalizingUuids(known))?.let { problems.add("$label: the result differs $it") }
                    rows.difference(desktop.getValue("dump").normalizingUuids(known))?.let {
                        problems.add("$label: the rows differ $it")
                        fail(problems.joinToString("\n"))  // later steps would only repeat it
                    }
                }
                println("Store: ${steps.size - problems.size} of ${steps.size} steps gave the desktop's result and left the desktop's rows")
                if (problems.isNotEmpty()) fail(problems.joinToString("\n"))
            }
        }
    }
}
