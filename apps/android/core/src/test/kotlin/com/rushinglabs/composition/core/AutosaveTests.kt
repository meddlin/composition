package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.autosave.AutosaveScheduler
import com.rushinglabs.composition.core.autosave.AutosaveTimer
import com.rushinglabs.composition.core.autosave.NoteAutosaver
import com.rushinglabs.composition.core.autosave.NoteDraft
import com.rushinglabs.composition.core.autosave.NoteDrafts
import com.rushinglabs.composition.core.autosave.NoteSessions
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

// What is typed reaches the database, and survives the app being ended: ported from AutosaveTests.swift. The timing is moved by hand
// (`ManualScheduler`), so none of this waits on a clock, except the last test, which runs on the real one.

/** Time that moves only when told to. */
class ManualScheduler : AutosaveScheduler {
    private class Timer(val due: Duration, val work: () -> Unit) : AutosaveTimer {
        @Volatile var cancelled = false
        override fun cancel() {
            cancelled = true
        }
    }

    private val lock = ReentrantLock()
    private var clock = Duration.ZERO
    private val timers = ArrayList<Timer>()

    override val now: Duration get() = lock.withLock { clock }

    /** Timers that have not fired and not been cancelled. */
    val pending: Int get() = lock.withLock { timers.count { !it.cancelled } }

    override fun schedule(after: Duration, work: () -> Unit): AutosaveTimer = lock.withLock {
        Timer(clock + after, work).also { timers.add(it) }
    }

    /** Moves time forward, firing what falls due along the way, in order. */
    fun advance(by: Duration) {
        val target = now + by
        while (true) {
            val next = lock.withLock {
                val due = timers.filter { !it.cancelled && it.due <= target }.minByOrNull { it.due }
                if (due != null) {
                    clock = maxOf(clock, due.due)
                    timers.remove(due)
                }
                due
            } ?: break
            next.work()
        }
        lock.withLock { clock = target }
    }
}

@DisplayName("Autosave: typed text reaches the database and survives the app being ended")
class AutosaveTests {
    private class Setup(
        val store: NoteStore,
        val database: CompositionDatabase,
        val drafts: NoteDrafts,
        val location: DataLocation,
        val scheduler: ManualScheduler,
        val note: NoteDetail,
    ) {
        fun autosaver(timing: NoteAutosaver.Timing = NoteAutosaver.Timing()) = NoteAutosaver(store, note, drafts, timing, scheduler)

        fun content(): String = database.note(note.id)!!.content
    }

    /** A fresh database with one note in it, the drafts beside it and a clock moved by hand; closed afterwards. */
    private fun withSetup(body: suspend (Setup) -> Unit): Unit = withScratch { scratch ->
        val location = DataLocation(scratch)
        val database = CompositionDatabase.open(location)
        try {
            val store = NoteStore(database)
            runBlocking { body(Setup(store, database, NoteDrafts(location), location, ManualScheduler(), store.createNote("Typed"))) }
        } finally {
            runCatching { database.close() }
        }
    }

    // The autosaver ----------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("typing is saved after a pause, not before")
    fun savesAfterAPause() = withSetup { s ->
        val autosaver = s.autosaver()
        autosaver.edit("---\ntitle: Typed\n---\nfirst")
        s.scheduler.advance(500.milliseconds)
        autosaver.waitUntilIdle()
        assertEquals(s.note.content, s.content(), "not yet")
        assertTrue(autosaver.hasUnsavedChanges)
        s.scheduler.advance(400.milliseconds)
        autosaver.waitUntilIdle()
        assertTrue(s.content().endsWith("---\nfirst"))
        assertFalse(autosaver.hasUnsavedChanges)
    }

    @Test
    @DisplayName("a pause that never comes still saves, after the longest wait")
    fun savesAtTheLongestWait() = withSetup { s ->
        val autosaver = s.autosaver()
        val saves = AtomicInteger()
        autosaver.onSaved { saves.incrementAndGet() }
        for (step in 0 until 20) { // one change every half second: the pause is never long enough
            autosaver.edit("---\ntitle: Typed\n---\nword $step")
            s.scheduler.advance(500.milliseconds)
            autosaver.waitUntilIdle()
        }
        assertTrue(saves.get() in 1..3, "saved on the way, not on every change: ${saves.get()}")
        assertTrue(s.content().contains("word "))
    }

    @Test
    @DisplayName("flush writes at once and waits")
    fun flushes() = withSetup { s ->
        val autosaver = s.autosaver()
        autosaver.edit("---\ntitle: Typed\n---\nabout to be backgrounded")
        assertTrue(autosaver.flush())
        assertTrue(s.content().endsWith("about to be backgrounded"))
        assertEquals(0, s.scheduler.pending, "the pause is over")
    }

    @Test
    @DisplayName("typing the stored text back is not a change")
    fun typingBack() = withSetup { s ->
        val autosaver = s.autosaver()
        val saves = AtomicInteger()
        autosaver.onSaved { saves.incrementAndGet() }
        autosaver.edit(s.note.content + "x")
        autosaver.edit(s.note.content)
        s.scheduler.advance(10.seconds)
        autosaver.waitUntilIdle()
        assertTrue(saves.get() == 0 && !autosaver.hasUnsavedChanges)
        assertTrue(s.drafts.all().isEmpty(), "and no draft is kept for it")
    }

    @Test
    @DisplayName("the typed text is on disk at once, and the draft goes when the save has it")
    fun draftLifecycle() = withSetup { s ->
        val autosaver = s.autosaver()
        autosaver.edit("---\ntitle: Typed\n---\nin flight")
        assertEquals(listOf(NoteDraft(s.note.id, s.note.uuid, "---\ntitle: Typed\n---\nin flight")), s.drafts.all())
        assertTrue(autosaver.flush())
        assertTrue(s.drafts.all().isEmpty())
    }

    @Test
    @DisplayName("more typing during a save is not lost, and its draft is kept")
    fun typingDuringASave() = withSetup { s ->
        val autosaver = s.autosaver()
        // The edit arrives as the save finishes: the handler runs on the saving queue, after the database write.
        autosaver.onSaved { autosaver.edit("---\ntitle: Typed\n---\nsecond") }
        autosaver.edit("---\ntitle: Typed\n---\nfirst")
        s.scheduler.advance(1.seconds)
        autosaver.waitUntilIdle()
        assertTrue(autosaver.hasUnsavedChanges)
        assertEquals(listOf("---\ntitle: Typed\n---\nsecond"), s.drafts.all().map { it.text })
        autosaver.onSaved(null)
        assertTrue(autosaver.flush())
        assertTrue(s.content().endsWith("second"))
    }

    @Test
    @DisplayName("a save that fails keeps the text in the draft and tries again")
    fun failing() = withSetup { s ->
        val autosaver = s.autosaver()
        val failures = AtomicInteger()
        autosaver.onFailure { failures.incrementAndGet() }
        s.database.close() // every save fails from here on
        autosaver.edit("---\ntitle: Typed\n---\nnot saved")
        assertFalse(autosaver.flush(), "it says so")
        assertTrue(failures.get() == 1 && autosaver.hasUnsavedChanges)
        assertEquals(1, s.scheduler.pending, "a retry is waiting")
        assertEquals(listOf("---\ntitle: Typed\n---\nnot saved"), s.drafts.all().map { it.text })
    }

    @Test
    @DisplayName("a note that is gone is not retried, and its draft stays")
    fun goneNote() = withSetup { s ->
        val autosaver = s.autosaver()
        s.database.trashNote(s.note.id)
        autosaver.edit("---\ntitle: Typed\n---\ntoo late")
        assertFalse(autosaver.flush())
        assertEquals(0, s.scheduler.pending)
        assertEquals(1, s.drafts.all().size)
    }

    // Being ended --------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("text typed just before the app was ended is put into the database on the next launch")
    fun recoveredAfterKill() = withSetup { s ->
        run {
            val autosaver = s.autosaver()
            autosaver.edit("---\ntitle: Typed\n---\nlast words before the kill")
            s.drafts.waitUntilIdle() // the draft write is what the kill must not beat
            // The autosaver, the timer and everything in memory are gone; only the files are left.
        }
        assertEquals(s.note.content, s.content(), "the database never got it")

        val relaunched = NoteSessions(s.store, NoteDrafts(s.location), scheduler = ManualScheduler())
        assertEquals(listOf(s.note.id), relaunched.recoverDrafts())
        assertTrue(s.content().endsWith("last words before the kill"))
        assertTrue(NoteDrafts(s.location).all().isEmpty())
        assertTrue(relaunched.recoverDrafts().isEmpty(), "once only")
    }

    @Test
    @DisplayName("a draft that does not belong to a note any more is discarded, never applied")
    fun staleDrafts() = withSetup { s ->
        s.drafts.write(NoteDraft(s.note.id, "not-this-note", "wrong note"))
        s.drafts.write(NoteDraft(9999, "nobody", "no such note"))
        val sessions = NoteSessions(s.store, s.drafts, scheduler = s.scheduler)
        assertTrue(sessions.recoverDrafts().isEmpty())
        assertEquals(s.note.content, s.content())
        assertTrue(s.drafts.all().isEmpty())
    }

    @Test
    @DisplayName("a draft that cuts off mid-write is ignored")
    fun damagedDraft() = withSetup { s ->
        check(s.location.draftsDirectory.mkdirs())
        File(s.location.draftsDirectory, "1.json").writeText("{\"noteId\": 1, \"uu")
        assertTrue(s.drafts.all().isEmpty())
        assertTrue(NoteSessions(s.store, s.drafts, scheduler = s.scheduler).recoverDrafts().isEmpty())
    }

    @Test
    @DisplayName("opening a note finishes saving what an earlier run left in its draft")
    fun openingRecovers() = withSetup { s ->
        s.drafts.write(NoteDraft(s.note.id, s.note.uuid, "---\ntitle: Typed\n---\nleft behind"))
        val sessions = NoteSessions(s.store, s.drafts, scheduler = s.scheduler)
        val session = sessions.open(s.note.id)
        assertTrue(session.text.endsWith("left behind"))
        sessions.close(session)
    }

    @Test
    @DisplayName("a restore removes the drafts, which belonged to the database it replaced")
    fun restoreClearsDrafts(): Unit = withScratch { scratch ->
        val source = DataLocation(File(scratch, "source"))
        val file = File(scratch, "backup.tar.gz")
        populate(source).use { database -> Backup.create(database, source, file) }

        val target = DataLocation(File(scratch, "target"))
        populate(target).close()
        val drafts = NoteDrafts(target)
        drafts.write(NoteDraft(1, "x", "stale"))
        runBlocking { drafts.waitUntilIdle() }
        assertTrue(target.draftsDirectory.exists())
        Backup.apply(Backup.stage(file, target), target)
        assertFalse(target.draftsDirectory.exists())
    }

    private fun populate(location: DataLocation): CompositionDatabase {
        val database = CompositionDatabase.open(location)
        val store = NoteStore(database)
        for (title in listOf("Alpha", "Beta")) store.createNote(title)
        return database
    }

    // Sessions -------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("two windows on one note share its text, and only the last to close saves it")
    fun sharedSession() = withSetup { s ->
        val sessions = NoteSessions(s.store, s.drafts, scheduler = s.scheduler)
        val first = sessions.open(s.note.id)
        val second = sessions.open(s.note.id)
        assertSame(first, second)

        val heard = AtomicReference<String?>()
        val observation = second.observe { heard.set(it) }
        first.edit("---\ntitle: Typed\n---\ntyped in the first window")
        assertEquals("---\ntitle: Typed\n---\ntyped in the first window", heard.get())
        assertEquals(first.text, second.text)

        sessions.close(first)
        assertEquals(s.note.content, s.content(), "the other window still has it open")
        sessions.close(second)
        assertTrue(s.content().endsWith("typed in the first window"))
        observation.close()
    }

    @Test
    @DisplayName("an editor is not handed back what it just typed, and the other windows still hear it")
    fun noEcho() = withSetup { s ->
        val sessions = NoteSessions(s.store, s.drafts, scheduler = s.scheduler)
        val session = sessions.open(s.note.id)
        val mine = AtomicReference<String?>()
        val theirs = AtomicReference<String?>()
        val myObservation = session.observe { mine.set(it) }
        val theirObservation = session.observe { theirs.set(it) }
        session.edit("---\ntitle: Typed\n---\nfrom my window", origin = myObservation)
        assertNull(mine.get(), "the window that typed it is not told")
        assertEquals("---\ntitle: Typed\n---\nfrom my window", theirs.get())
        session.edit("---\ntitle: Typed\n---\nfrom elsewhere")
        assertEquals("---\ntitle: Typed\n---\nfrom elsewhere", mine.get(), "and it hears everyone else")
        theirObservation.close()
        session.edit("---\ntitle: Typed\n---\nafter they stopped listening")
        assertEquals("---\ntitle: Typed\n---\nfrom elsewhere", theirs.get(), "a closed observation hears nothing more")
        myObservation.close()
        sessions.close(session)
    }

    @Test
    @DisplayName("flushAll saves every open note")
    fun flushAll() = withSetup { s ->
        val other = s.store.createNote("Other")
        val sessions = NoteSessions(s.store, s.drafts, scheduler = s.scheduler)
        val one = sessions.open(s.note.id)
        val two = sessions.open(other.id)
        one.edit("---\ntitle: Typed\n---\none")
        two.edit("---\ntitle: Other\n---\ntwo")
        assertTrue(sessions.hasUnsavedChanges)
        assertTrue(sessions.flushAll())
        assertFalse(sessions.hasUnsavedChanges)
        assertTrue(s.content().endsWith("one") && s.database.note(other.id)!!.content.endsWith("two"))
    }

    @Test
    @DisplayName("opening a note that is not there says so")
    fun openMissing() = withSetup { s ->
        val sessions = NoteSessions(s.store, s.drafts, scheduler = s.scheduler)
        val error = assertFailsWith<CoreException.NotFound> { sessions.open(404) }
        assertEquals("Note 404 not found.", error.message)
    }

    // Real time ------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a thousand edits in a burst, on the real clock, end up in the database whole")
    fun burstOnTheRealClock(): Unit = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val store = NoteStore(database)
            val note = store.createNote("Burst")
            val drafts = NoteDrafts(DataLocation(scratch))
            val autosaver = NoteAutosaver(store, note, drafts, NoteAutosaver.Timing(quiet = 20.milliseconds, longest = 100.milliseconds, retry = 100.milliseconds))
            val text = StringBuilder("---\ntitle: Burst\n---\n")
            for (index in 0 until 1000) {
                text.append("line $index of a long paragraph typed quickly\n")
                autosaver.edit(text.toString())
                if (index % 100 == 0) Thread.sleep(30)
            }
            runBlocking {
                assertTrue(autosaver.flush())
                assertTrue(database.note(note.id)!!.content.endsWith("line 999 of a long paragraph typed quickly\n"))
                assertTrue(drafts.all().isEmpty(), "the same instance, which waits for its own pending removals")
            }
        }
    }
}
