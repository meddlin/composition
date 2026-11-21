package com.rushinglabs.composition.core.autosave

import com.rushinglabs.composition.core.CoreLog
import com.rushinglabs.composition.core.DataLocation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

// The safety net under autosave (ported from NoteDrafts.swift): the text of a note that has been typed and is not yet in the
// database, kept in a small file of its own. Saving to the database waits for a pause in typing (a note's frontmatter is reconciled
// and the search index re-written, which is more than a keystroke should cost), so for that pause the typed text would be in memory
// only. If Android ends the app in that moment, or it crashes, the file is what is left, and the next launch puts it into the database
// (`NoteSessions.recoverDrafts`).
//
// Writing is coalescing and off the caller's thread: an edit says "this is the latest text" and a background queue writes whatever is
// newest until it is caught up, so typing never waits for the disk and a slow write never queues a backlog. The queue is a
// one-at-a-time view of the IO dispatcher, which runs what it is given in order, as the iPad's serial DispatchQueue does.

/** A note's unsaved text, as found on disk. Written as the iPad writes it: `{"noteId":…,"uuid":…,"text":…}`. */
data class NoteDraft(
    val noteId: Long,
    /** Which note this was for, so that a draft is never applied to a different note that now has the same id. */
    val uuid: String,
    val text: String,
) {
    internal fun json(): String = JsonObject(
        mapOf("noteId" to JsonPrimitive(noteId), "uuid" to JsonPrimitive(uuid), "text" to JsonPrimitive(text)),
    ).toString()

    internal companion object {
        /** A draft from a file's text, or null for anything that is not a whole one. */
        fun parse(text: String): NoteDraft? {
            val obj = runCatching { Json.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return null
            val noteId = (obj["noteId"] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toLongOrNull() ?: return null
            val uuid = (obj["uuid"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            val body = (obj["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            return NoteDraft(noteId, uuid, body)
        }
    }
}

class NoteDrafts(location: DataLocation) {
    private sealed interface Intent {
        data class Write(val draft: NoteDraft) : Intent
        data object Remove : Intent
    }

    private val directory: File = location.draftsDirectory
    private val queue = Dispatchers.IO.limitedParallelism(1)
    private val scope = CoroutineScope(SupervisorJob() + queue)
    private val lock = ReentrantLock()
    /** A newer intent for the same note replaces one not yet carried out, and keeps its place in line. */
    private val intents = LinkedHashMap<Long, Intent>()
    private var draining = false

    // Writing, in the background -------------------------------------------------------------------------------------------

    /** Records the latest unsaved text of a note. */
    fun write(draft: NoteDraft) = submit(draft.noteId, Intent.Write(draft))

    /** Forgets a note's draft, in order with the writes before it. */
    fun remove(noteId: Long) = submit(noteId, Intent.Remove)

    /** Returns when everything submitted so far is on disk. */
    suspend fun waitUntilIdle() = withContext(queue) {}

    private fun submit(noteId: Long, intent: Intent) {
        val start = lock.withLock {
            intents[noteId] = intent
            if (draining) return@withLock false
            draining = true
            true
        }
        if (start) scope.launch { drain() }
    }

    private fun drain() {
        while (true) {
            val (noteId, intent) = lock.withLock {
                val first = intents.entries.firstOrNull()
                if (first == null) {
                    draining = false
                    return
                }
                intents.remove(first.key)
                first.key to first.value
            }
            perform(noteId, intent)
        }
    }

    private fun perform(noteId: Long, intent: Intent) {
        val file = file(noteId)
        try {
            when (intent) {
                is Intent.Write -> {
                    directory.mkdirs()
                    // Written whole under another name and renamed over the old one, so a kill mid-write leaves the old draft or the new.
                    val partial = File(directory, ".$noteId.json.partial")
                    partial.writeText(intent.draft.json())
                    Files.move(partial.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
                }
                Intent.Remove -> file.delete()
            }
        } catch (error: Exception) {
            // Best effort: the database save is the real one. A draft that cannot be written costs only the net.
            CoreLog.sink("[autosave] could not write the draft of note $noteId: $error")
        }
    }

    // Reading --------------------------------------------------------------------------------------------------------------

    /** Every draft on disk. One that cannot be read (cut off by the kill it was meant to survive) is skipped. */
    suspend fun all(): List<NoteDraft> {
        waitUntilIdle()
        return withContext(Dispatchers.IO) {
            val names = directory.list()?.sorted() ?: emptyList()
            names.filter { it.endsWith(".json") }.mapNotNull { name -> runCatching { NoteDraft.parse(File(directory, name).readText()) }.getOrNull() }
        }
    }

    private fun file(noteId: Long) = File(directory, "$noteId.json")
}
