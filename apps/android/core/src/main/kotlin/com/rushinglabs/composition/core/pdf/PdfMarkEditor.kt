package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.NoteStore
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

// The marks of one PDF as the reader changes them, with undo and redo (docs/pdf-markup-plan.md, "Notes and citations" and the desktop's
// `documentMarks.ts`), ported from PdfMarkEditor.swift: one change at a time (the iPad's is an actor; here a lock, and the caller runs it off
// the main thread, as it does every database call), and a history of create, delete and change steps, 200 deep. The history is in memory
// only: it lasts until the PDF is closed. Undoing a delete brings the mark back with its uuid, so a note's citation of it works again.

class PdfMarkEditor(private val store: NoteStore, val documentId: Long) {
    companion object {
        /** How many steps are kept. */
        const val DEPTH = 200
    }

    /** What the reader shows after a change: every mark of the PDF, and whether undo and redo have anything to do. */
    data class State(val marks: List<PdfMark>, val canUndo: Boolean, val canRedo: Boolean)

    private sealed class Step {
        class Created(val marks: List<PdfMark>) : Step()
        class Deleted(val marks: List<PdfMark>) : Step()
        class Changed(val before: PdfMark, val after: PdfMark) : Step()
    }

    private val lock = ReentrantLock()
    private val undoSteps = ArrayList<Step>()
    private val redoSteps = ArrayList<Step>()

    /** Every mark of the PDF except its pages' ink (`inkPages`, `inkBody`): the list the reader holds is of marks that are words and rectangles, not megabytes of strokes. */
    val state: State get() = lock.withLock { currentState() }

    private fun currentState() = State(store.database.annotations(documentId, withInk = false), undoSteps.isNotEmpty(), redoSteps.isNotEmpty())

    // Ink -------------------------------------------------------------------------------------------------------------------------

    /** The pages (0-based) that have ink. */
    fun inkPages(): Set<Int> = store.database.inkPages(documentId).keys

    /** A page's stroke JSON as stored; null when it has none. */
    fun inkBody(page: Int): String? = store.database.inkBody(documentId, page)

    /**
     * Keeps a page's ink (or, with null, takes it away) and answers the pages that have ink. **Not a step**: undo and redo of a stroke are
     * the drawing canvas's own, and the history here is of marks.
     */
    fun setInk(page: Int, body: String?): Set<Int> = lock.withLock {
        store.setInk(documentId, page, body)
        inkPages()
    }

    // Changes -----------------------------------------------------------------------------------------------------------------------

    /** Makes marks (one selection is one call: a selection over pages is one record each, tied together). Throws `InvalidMarkException` when one breaks the rules. */
    fun add(inputs: List<PdfMarkInput>): State = lock.withLock {
        val made = store.addAnnotations(documentId, inputs)
        if (made.isNotEmpty()) record(Step.Created(made))
        currentState()
    }

    /** Deletes a mark and the rest of its selection. */
    fun delete(id: Long): State = lock.withLock {
        val removed = store.deleteAnnotation(id)
        if (removed.isNotEmpty()) record(Step.Deleted(removed))
        currentState()
    }

    /** Changes a mark's colour, comment or words (see `PdfMarkChanges`). */
    fun update(id: Long, changes: PdfMarkChanges): State = lock.withLock {
        val before = store.database.annotation(id) ?: return@withLock currentState()
        val after = store.updateAnnotation(id, changes) ?: return@withLock currentState()
        // Saying the colour it already has changes only the time the mark was touched: that is not a step.
        if (!sameContent(before, after)) record(Step.Changed(before, after))
        currentState()
    }

    private fun record(step: Step) {
        undoSteps.add(step)
        while (undoSteps.size > DEPTH) undoSteps.removeAt(0)
        redoSteps.clear()
    }

    // Undo and redo -----------------------------------------------------------------------------------------------------------------

    /** Takes back the last change; does nothing when there is none. */
    fun undo(): State = lock.withLock {
        val step = undoSteps.lastOrNull() ?: return@withLock currentState()
        val opposite = applyInverse(step)
        undoSteps.removeAt(undoSteps.size - 1)
        redoSteps.add(opposite)
        currentState()
    }

    /** Puts back what undo took back. */
    fun redo(): State = lock.withLock {
        val step = redoSteps.lastOrNull() ?: return@withLock currentState()
        val opposite = applyInverse(step)
        redoSteps.removeAt(redoSteps.size - 1)
        undoSteps.add(opposite)
        currentState()
    }

    /** Does the opposite of a step, and returns the step that does it again (a restored mark may have a new id, so the step is made anew). */
    private fun applyInverse(step: Step): Step = when (step) {
        is Step.Created -> {
            val removed = store.deleteAnnotation(step.marks[0].id)
            Step.Deleted(removed.ifEmpty { step.marks })
        }
        is Step.Deleted -> Step.Created(store.restoreAnnotations(documentId, step.marks))
        is Step.Changed -> {
            val restored = store.updateAnnotation(step.after.id, changes(step.before)) ?: step.after
            Step.Changed(step.after, restored)
        }
    }

    /** What has to change to make a mark `wanted` again: colour, comment and a typed note's words (a text mark's rectangles and quote do not change). */
    private fun changes(wanted: PdfMark) =
        PdfMarkChanges(color = wanted.color, comment = wanted.comment, body = if (wanted.kind == PdfMarkKind.TEXT) wanted.body else null)

    /** The same colour, comment, words and place: what a person sees, whatever time the mark was touched. */
    private fun sameContent(a: PdfMark, b: PdfMark) =
        a.color == b.color && a.comment == b.comment && a.quote == b.quote && a.rects == b.rects && a.body == b.body
}
