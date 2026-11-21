package com.rushinglabs.composition.core

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Spike A1's timings (docs/android-app-design.md): listing 1,000 notes, and a save reaching a Flow a screen would collect. Printed,
// so a run on the Mac's JVM and one on the emulator can be compared; the bounds are only there to catch something badly wrong.

@DisplayName("Timings")
class TimingTests {
    private fun milliseconds(start: Long) = (System.nanoTime() - start) / 1_000_000.0

    @Test
    @DisplayName("lists 1,000 notes, and a save reaches a Flow")
    fun timings() = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val store = NoteStore(database)
            var clock = Instant.ofEpochSecond(1_800_000_000)
            val created = System.nanoTime()
            for (index in 0 until 1_000) {
                clock = clock.plusSeconds(1)
                store.createNote("Note $index", now = clock)
            }
            val createMs = milliseconds(created)

            database.notesInDisplayOrder()  // warm
            val listing = System.nanoTime()
            val listed = database.notesInDisplayOrder()
            val listMs = milliseconds(listing)
            assertEquals(1_000, listed.size)

            val target = listed.last()
            val (flowMs, saveMs) = runBlocking {
                withTimeout(10_000) {
                    val flow = database.observe { it.note(target.id)?.title }
                    assertEquals("Note 0", flow.first())
                    // Collect in the background, then save, and time the save and the moment the new title arrives.
                    val arrived = kotlinx.coroutines.CompletableDeferred<Long>()
                    val watcher = launch(kotlinx.coroutines.Dispatchers.IO) {
                        flow.collect { if (it == "Renamed") arrived.complete(System.nanoTime()) }
                    }
                    kotlinx.coroutines.delay(100)
                    val saving = System.nanoTime()
                    store.saveNoteContent(target.id, "---\ntitle: Renamed\n---\nBody\n", clock.plusSeconds(1))
                    val saved = milliseconds(saving)
                    val reached = (arrived.await() - saving) / 1_000_000.0
                    watcher.cancel()
                    reached to saved
                }
            }
            println("Timings: create 1,000 notes ${"%.0f".format(createMs)} ms; list 1,000 ${"%.2f".format(listMs)} ms; save ${"%.2f".format(saveMs)} ms; save to Flow ${"%.2f".format(flowMs)} ms")
            assertTrue(listMs < 1_000 && flowMs < 1_000)
        }
    }
}
