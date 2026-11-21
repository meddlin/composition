package com.rushinglabs.composition.core.autosave

import com.rushinglabs.composition.core.CoreException
import com.rushinglabs.composition.core.NoteStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

// The notes that are open for editing, shared by everything that has one open (ported from NoteSessions.swift).
//
// Two windows showing the same note must not each keep a copy of its text and save over the other: they share one `NoteSession`, so
// the text, the unsaved changes and the saving are one thing, and an edit in one window reaches the other. All sessions share one
// database, so the sessions are the only place that decides what is written. `flushAll` is what the app calls when it may be about to
// stop.

/** One note open for editing: the text, and the autosaver that keeps it in the database. */
class NoteSession internal constructor(val noteId: Long, val autosaver: NoteAutosaver) {
    private val lock = ReentrantLock()
    private val observers = LinkedHashMap<Observation, (String) -> Unit>()

    /** The newest text. */
    val text: String get() = autosaver.text

    /**
     * An editor changed the text. Every observer hears it except the one named as `origin`, so that an editor is not handed back what
     * it just typed (which, for a long note, costs a comparison of all of it on every keystroke).
     */
    fun edit(text: String, origin: Observation? = null) {
        autosaver.edit(text)
        val handlers = lock.withLock { observers.filterKeys { it !== origin }.values.toList() }
        for (handler in handlers) handler(text)
    }

    /**
     * Calls `handler`, on the thread that edited, with the new text after each edit, until the returned observation is closed. (The
     * iPad's stops when its token is released; Kotlin has no such moment, so it is closed by hand.)
     */
    fun observe(handler: (String) -> Unit): Observation {
        val observation = Observation(this)
        lock.withLock { observers[observation] = handler }
        return observation
    }

    class Observation internal constructor(private val session: NoteSession) : AutoCloseable {
        override fun close() {
            session.lock.withLock { session.observers.remove(this) }
        }
    }
}

class NoteSessions(
    /**
     * The store every session saves through; what the rest of the app should use for creating, trashing and restoring, so that the
     * search index is kept in step in one place.
     */
    val store: NoteStore,
    private val drafts: NoteDrafts,
    private val timing: NoteAutosaver.Timing = NoteAutosaver.Timing(),
    private val scheduler: AutosaveScheduler = CoroutineAutosaveScheduler(),
) {
    private class Entry(val session: NoteSession, var holders: Int)

    private val lock = ReentrantLock()
    private val open = HashMap<Long, Entry>()

    /**
     * Opens the note for editing, or joins the session another window already has. Every `open` is paired with a `close`. Throws
     * `CoreException.NotFound` for a note that is not there.
     */
    suspend fun open(noteId: Long): NoteSession {
        lock.withLock {
            open[noteId]?.let { entry ->
                entry.holders += 1
                return entry.session
            }
        }
        // Not open yet: a draft left by an earlier run goes into the database first, so what is shown includes it.
        drafts.all().firstOrNull { it.noteId == noteId }?.let { draft -> orNull { recover(draft) } }
        val note = withContext(Dispatchers.IO) { store.database.note(noteId) } ?: throw CoreException.NotFound("Note $noteId")
        val session = NoteSession(noteId, NoteAutosaver(store, note, drafts, timing, scheduler))
        // Two windows may have raced to open the same note; whoever got in first owns the session.
        return lock.withLock {
            val existing = open[noteId]
            if (existing != null) {
                existing.holders += 1
                existing.session
            } else {
                open[noteId] = Entry(session, 1)
                session
            }
        }
    }

    /** Lets go of a session. The last holder's close writes whatever is unsaved. */
    suspend fun close(session: NoteSession) {
        val last = lock.withLock {
            val entry = open[session.noteId]
            if (entry == null || entry.session !== session) return@withLock false
            entry.holders -= 1
            if (entry.holders > 0) return@withLock false
            open.remove(session.noteId)
            true
        }
        if (last) session.autosaver.flush()
    }

    /** Writes everything unsaved, in every open note, and waits. Returns whether nothing is left unsaved (the drafts have it if so). */
    suspend fun flushAll(): Boolean {
        val sessions = lock.withLock { open.values.map { it.session } }
        var allSaved = true
        for (session in sessions) if (!session.autosaver.flush()) allSaved = false
        return allSaved
    }

    /** Whether any open note has text that is not in the database yet. */
    val hasUnsavedChanges: Boolean get() = lock.withLock { open.values.any { it.session.autosaver.hasUnsavedChanges } }

    // After the app was ended ----------------------------------------------------------------------------------------------

    /**
     * Puts into the database the text that was typed and never saved because the app ended first. Run it when the app starts, before
     * the notes are listed. Returns the notes it changed.
     */
    suspend fun recoverDrafts(): List<Long> {
        val recovered = ArrayList<Long>()
        for (draft in drafts.all()) {
            val isOpen = lock.withLock { draft.noteId in open }
            if (isOpen) continue
            if (orNull { recover(draft) } == true) recovered.add(draft.noteId)
        }
        return recovered
    }

    /**
     * Applies one draft. Returns true when it changed the note. A draft for a note that is gone, or that is a different note now, is
     * discarded; one that fails to save stays for the next run.
     */
    private suspend fun recover(draft: NoteDraft): Boolean {
        val note = withContext(Dispatchers.IO) { store.database.note(draft.noteId) }
        if (note == null || note.uuid != draft.uuid) {
            drafts.remove(draft.noteId)
            return false
        }
        try {
            if (note.content == draft.text) {
                drafts.remove(draft.noteId)
                return false
            }
            withContext(Dispatchers.IO) { store.saveNoteContent(draft.noteId, draft.text) }
            drafts.remove(draft.noteId)
            return true
        } finally {
            drafts.waitUntilIdle()
        }
    }
}

/** Swift's `try?`: the value, or null when `body` throws. A cancellation still cancels. */
private suspend fun <T> orNull(body: suspend () -> T): T? = try {
    body()
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (_: Exception) {
    null
}
