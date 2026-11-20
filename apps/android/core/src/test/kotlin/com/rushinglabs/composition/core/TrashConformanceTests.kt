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

// The Kotlin Trash Can against the desktop's real `trashRepo.ts`, ported from TrashConformanceTests.swift. Both run the steps in
// fixtures/conformance/trash-script.json against the same starting database (trash-start.db). After every step the TypeScript
// recorded the result and every row of notes, groups, trashed_notes, trashed_groups and sqlite_sequence; the two must be equal.

@DisplayName("Trash Can against the desktop")
class TrashConformanceTests {
    private fun date(iso: String?): Instant =
        Instant.ofEpochMilli(iso?.let(Timestamp::milliseconds) ?: fail("bad time in the script: $iso"))

    private fun dump(database: CompositionDatabase): JsonElement = database.file.read { db ->
        val tables = linkedMapOf<String, JsonElement>()
        for (table in listOf("notes", "groups", "trashed_notes", "trashed_groups")) {
            tables[table] = JsonArray(db.rows("SELECT * FROM $table ORDER BY id").map(::json))
        }
        tables["sqlite_sequence"] = JsonArray(db.rows("SELECT name, seq FROM sqlite_sequence ORDER BY name").map(::json))
        JsonObject(tables)
    }

    private fun restored(result: RestoreResult?): JsonElement =
        result?.let { JsonObject(mapOf("restoredToTopLevel" to JsonPrimitive(it.restoredToTopLevel))) } ?: JsonNull

    private fun run(step: JsonObject, database: CompositionDatabase): JsonElement {
        val id = step.long("id") ?: 0
        return when (val op = step.string("op")) {
            "trashNote" -> { database.trashNote(id, date(step.string("at"))); JsonNull }
            "trashGroup" -> try {
                database.trashGroup(id, date(step.string("at"))); JsonNull
            } catch (_: CoreException.GroupNotEmpty) {
                JsonObject(mapOf("error" to JsonPrimitive("groupNotEmpty")))
            }
            "restoreNote" -> restored(database.restoreNote(id))
            "restoreGroup" -> restored(database.restoreGroup(id))
            "purgeNote" -> { database.purgeNote(id); JsonNull }
            "purgeGroup" -> { database.purgeGroup(id); JsonNull }
            "purgeExpired" -> { database.purgeExpired(date(step.string("now"))); JsonNull }
            "sql" -> { database.file.write { it.execute(step.string("sql")!!) }; JsonNull }
            "listTrash" -> {
                val trash = database.listTrash()
                JsonObject(mapOf(
                    "notes" to JsonArray(trash.notes.map {
                        JsonObject(mapOf("id" to json(it.id), "title" to json(it.title), "deletedAt" to json(it.deletedAt), "expiresAt" to json(it.expiresAt)))
                    }),
                    "groups" to JsonArray(trash.groups.map {
                        JsonObject(mapOf("id" to json(it.id), "name" to json(it.name), "deletedAt" to json(it.deletedAt), "expiresAt" to json(it.expiresAt)))
                    }),
                ))
            }
            else -> fail("unknown step $op")
        }
    }

    @Test
    @DisplayName("every step of the script leaves the same results and the same rows as the desktop's trashRepo.ts")
    fun scriptMatchesDesktop() {
        val directory = requireConformance()
        val steps = steps(File(directory, "trash-script.json"))
        val expected = steps(File(directory, "trash-script.expected.json"))
        assertTrue(steps.size == expected.size && steps.size > 30, "the script and the desktop's record agree on the steps")

        withScratch { scratch ->
            val file = File(scratch, "composition.db")
            File(directory, "trash-start.db").copyTo(file)
            CompositionDatabase.open(file).use { database ->
                // The uuids the starting database had; anything else a step produces is a fresh one.
                val known = database.file.read { db ->
                    listOf("notes", "groups", "trashed_notes", "trashed_groups").flatMap { db.strings("SELECT uuid FROM $it") }.toSet()
                }
                assertTrue(known.size >= 15)

                val problems = mutableListOf<String>()
                for ((index, pair) in steps.zip(expected).withIndex()) {
                    val (step, desktop) = pair
                    assertEquals(desktop.string("op"), step.string("op"))
                    val label = "step $index (${step.string("op")} ${step.long("id") ?: ""})"
                    val result = run(step, database).normalizingUuids(known)
                    val rows = dump(database).normalizingUuids(known)
                    result.difference(desktop.getValue("result").normalizingUuids(known))?.let { problems.add("$label: the result differs $it") }
                    rows.difference(desktop.getValue("dump").normalizingUuids(known))?.let {
                        problems.add("$label: the rows differ $it")
                        fail(problems.joinToString("\n"))  // later steps would only repeat it
                    }
                }
                if (problems.isNotEmpty()) fail(problems.joinToString("\n"))
                println("Trash Can: ${steps.size} of ${steps.size} steps gave the desktop's result and left the desktop's rows")
            }
        }
    }
}
