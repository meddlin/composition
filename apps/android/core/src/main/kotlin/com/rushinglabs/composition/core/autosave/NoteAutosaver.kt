package com.rushinglabs.composition.core.autosave

import com.rushinglabs.composition.core.CoreException
import com.rushinglabs.composition.core.NoteDetail
import com.rushinglabs.composition.core.NoteStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.nanoseconds
import kotlin.time.Duration.Companion.seconds

// Saving what is typed, for one note (ported from NoteAutosaver.swift): the one write path from an editor to the database.
//
//   * Every edit is noted at once, in memory and in the note's draft file (`NoteDrafts`), which is what survives if Android ends the
//     app in the middle of a sentence.
//   * The database is written after a pause in typing (`quiet`), and at the latest `longest` after the first unsaved change, so a long
//     burst of typing is still saved on the way. Writing is `NoteStore.saveNoteContent`: the frontmatter is reconciled into the
//     columns and the search index follows.
//   * `flush()` writes now and waits, for the moments the app may be about to stop: leaving the foreground, the note being closed, a
//     backup being made.
//   * A save that fails is tried again, and what was typed is kept in the draft meanwhile.
//
// Saves run one at a time on a queue of their own (a one-at-a-time view of the IO dispatcher), so typing never waits for the database.

/** Something that can be cancelled before it fires. */
fun interface AutosaveTimer {
    fun cancel()
}

/** What the autosaver uses to wait, so that a test can move time by hand. */
interface AutosaveScheduler {
    /** A clock that only moves forward. */
    val now: Duration

    /** Runs `work` once, `after` from now, unless the timer is cancelled first. */
    fun schedule(after: Duration, work: () -> Unit): AutosaveTimer
}

/** The real clock: a coroutine that waits with `delay`, on a scope of its own unless one is given. */
class CoroutineAutosaveScheduler(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) : AutosaveScheduler {
    override val now: Duration get() = System.nanoTime().nanoseconds

    override fun schedule(after: Duration, work: () -> Unit): AutosaveTimer {
        val job: Job = scope.launch {
            delay(after)
            work()
        }
        return AutosaveTimer { job.cancel() }
    }
}

/**
 * `note` is the note as it was loaded: its text is what the database holds, so typing it back is not a change.
 */
class NoteAutosaver(
    private val store: NoteStore,
    note: NoteDetail,
    private val drafts: NoteDrafts? = null,
    private val timing: Timing = Timing(),
    private val scheduler: AutosaveScheduler = CoroutineAutosaveScheduler(),
) {
    data class Timing(
        /** How long typing must pause before the note is saved. */
        val quiet: Duration = 800.milliseconds,
        /** The most a stretch of unsaved typing may wait. */
        val longest: Duration = 5.seconds,
        /** How long to wait before trying again after a save fails. */
        val retry: Duration = 3.seconds,
    )

    val noteId: Long = note.id
    private val uuid: String = note.uuid
    private val queue = Dispatchers.IO.limitedParallelism(1)
    private val scope = CoroutineScope(SupervisorJob() + queue)

    // The state, guarded by `lock`.
    private val lock = ReentrantLock()
    /** What the last successful save was given. */
    private var saved: String = note.content
    /** The newest text the editor has handed over. */
    private var latest: String = note.content
    /** Counts the edits, so that a save can tell whether more typing arrived while it ran. */
    private var revision = 0L
    private var firstUnsavedAt: Duration? = null
    private var timer: AutosaveTimer? = null

    @Volatile private var savedHandler: ((NoteDetail) -> Unit)? = null
    @Volatile private var failedHandler: ((Exception) -> Unit)? = null

    /** Called (on the saving queue) after each successful save, with the note as stored: its frontmatter may have been rewritten. */
    fun onSaved(handler: ((NoteDetail) -> Unit)?) {
        savedHandler = handler
    }

    /** Called (on the saving queue) when a save fails. It is tried again, unless the note is gone. */
    fun onFailure(handler: ((Exception) -> Unit)?) {
        failedHandler = handler
    }

    /** The newest text handed over. */
    val text: String get() = lock.withLock { latest }

    /** Whether what was typed is not yet in the database. */
    val hasUnsavedChanges: Boolean get() = lock.withLock { latest != saved }

    // Editing --------------------------------------------------------------------------------------------------------------

    /** The editor's text is now `text`. Cheap; call it on every change, from any thread. */
    fun edit(text: String) = lock.withLock {
        if (text == latest) return@withLock
        latest = text
        revision += 1
        timer?.cancel()
        timer = null
        if (text == saved) {
            // Typed back to what is stored: nothing to save, and nothing to keep.
            firstUnsavedAt = null
            drafts?.remove(noteId)
            return@withLock
        }
        drafts?.write(NoteDraft(noteId, uuid, text))
        val now = scheduler.now
        val first = firstUnsavedAt ?: now
        firstUnsavedAt = first
        timer = schedule(minOf(timing.quiet, maxOf(Duration.ZERO, timing.longest - (now - first))))
    }

    /** Saves what is unsaved now and waits for it. Returns whether nothing unsaved is left; if not, the draft file has it. */
    suspend fun flush(): Boolean {
        lock.withLock {
            timer?.cancel()
            timer = null
        }
        withContext(queue) { save() }
        if (hasUnsavedChanges) drafts?.waitUntilIdle()
        return !hasUnsavedChanges
    }

    /** Waits for a save already under way, without starting one. For tests. */
    internal suspend fun waitUntilIdle() = withContext(queue) {}

    // Saving ---------------------------------------------------------------------------------------------------------------

    /** Must be called with the lock held. */
    private fun schedule(after: Duration): AutosaveTimer = scheduler.schedule(after) { scope.launch { save() } }

    /** Runs on `queue`, and never suspends there, so the saves and the waits for them keep their order. */
    private fun save() {
        val job = lock.withLock {
            timer?.cancel()
            timer = null
            firstUnsavedAt = null
            if (latest == saved) null else latest to revision
        } ?: return
        val (text, savedRevision) = job
        try {
            val note = store.saveNoteContent(noteId, text)
            lock.withLock {
                saved = text
                // Only when nothing was typed meanwhile: otherwise the draft already holds something newer.
                if (savedRevision == revision) drafts?.remove(noteId)
            }
            savedHandler?.invoke(note)
        } catch (error: Exception) {
            // A note that is gone (trashed or deleted elsewhere) is not tried again, since that cannot help. The draft stays.
            if (error !is CoreException.NotFound) {
                lock.withLock {
                    if (timer == null) {
                        firstUnsavedAt = scheduler.now
                        timer = schedule(timing.retry)
                    }
                }
            }
            failedHandler?.invoke(error)
        }
    }
}
