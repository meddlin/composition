package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.search.IndexedNote
import com.rushinglabs.composition.core.search.SearchIndex
import java.time.Instant

// Notes, groups and notebooks: ports of `notesRepo.ts`, `groupsRepo.ts`, `notebooksRepo.ts`, `ordering.ts` and `groupMove.ts`
// (by way of NotesStore.swift, GroupsStore.swift, NotebooksStore.swift and StoreModels.swift), plus the reconciling
// `saveNoteContent` of `service.ts`. Same SQL text as the desktop; fixtures/conformance/store-script.json runs both against one
// database. Each operation is one write transaction, and `now` is a parameter so a test can say when something happened.

data class Notebook(val id: Long, val uuid: String, val name: String, val createdAt: String, val updatedAt: String) {
    internal constructor(row: Row) : this(row.long("id"), row.string("uuid"), row.string("name"), row.string("created_at"), row.string("updated_at"))
}

/** A group of notes, which may hold other groups. */
data class NoteGroup(
    val id: Long, val uuid: String, val name: String, val parentId: Long?, val notebookId: Long?, val createdAt: String, val updatedAt: String,
) {
    internal constructor(row: Row) : this(
        row.long("id"), row.string("uuid"), row.string("name"), row.longOrNull("parent_id"), row.longOrNull("notebook_id"),
        row.string("created_at"), row.string("updated_at"),
    )
}

/** Manual ordering of siblings, `ordering.ts`. */
object Ordering {
    /**
     * `ids` (a sibling list in display order) with `id` placed immediately before `beforeId`, or last when `beforeId` is null or no
     * longer among the siblings. `id` may or may not already be in the list. Dropping `id` before itself leaves it where it is.
     */
    fun placeBefore(ids: List<Long>, id: Long, beforeId: Long?): List<Long> {
        val rest = ids.filter { it != id }
        if (beforeId == id) return if (id in ids) ids else rest + id
        val at = if (beforeId == null) -1 else rest.indexOf(beforeId)
        if (at < 0) return rest + id
        return rest.subList(0, at) + id + rest.subList(at, rest.size)
    }
}

/** `groupMove.ts`. */
object GroupMove {
    /** Whether making `newParentId` the parent of group `id` would create a loop. */
    fun wouldCreateCycle(parents: Map<Long, Long?>, id: Long, newParentId: Long?): Boolean {
        val seen = HashSet<Long>()
        var cursor = newParentId
        while (cursor != null && cursor !in seen) {
            if (cursor == id) return true
            seen.add(cursor)
            cursor = parents[cursor]
        }
        return false
    }
}

// Notes ---------------------------------------------------------------------------------------------------------------------

/** Notes nobody has dragged into place come first, most recently edited first; hand-placed ones follow in their set order. */
internal const val NOTE_DISPLAY_ORDER = "position IS NOT NULL, position, updated_at DESC, id DESC"

/** Every note without its text, in the order the sidebar shows them (`listNotes` of `notesRepo.ts`). */
fun CompositionDatabase.notesInDisplayOrder(): List<NoteSummary> = file.read { db ->
    db.rows("SELECT id, uuid, title, tags, notebook_id, group_id, created_at, updated_at FROM notes ORDER BY $NOTE_DISPLAY_ORDER").map(::NoteSummary)
}

/** A new note with frontmatter made from the title and tags. A note in a group is in the group's notebook, whatever the caller thought. */
fun CompositionDatabase.createNote(title: String, tags: String = "", groupId: Long? = null, notebookId: Long? = null, now: Instant = Instant.now()): NoteDetail =
    file.write { db ->
        val stamp = Timestamp.now(now)
        val content = NoteFrontmatter.generate(title, stamp, stamp, tags = NoteFrontmatter.tagsFromString(tags))
        val group = groupId?.let { fetchGroup(db, it) }
        val inNotebook = group?.notebookId ?: notebookId ?: defaultNotebookId(db)
        db.execute(
            """
            INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id, notebook_id)
            VALUES (?, ?, ?, '', ?, ?, ?, ?)
            """.trimIndent(),
            title, content, tags, stamp, stamp, groupId, inNotebook,
        )
        fetchNote(db, db.lastInsertedRowId) ?: throw CoreException.NotFound("The note that was just created")
    }

/**
 * Saves what the editor holds: parses whatever frontmatter is being typed and reconciles it back into the note's columns, without
 * ever failing on a mid-edit YAML block. A block that does not parse leaves the title, tags and description as they were. An empty
 * title keeps the old one, and the frontmatter is rewritten the way the desktop writes it.
 */
fun CompositionDatabase.saveNoteContent(id: Long, content: String, now: Instant = Instant.now()): NoteDetail = file.write { db ->
    val stamp = Timestamp.now(now)
    val (parsed, body) = NoteFrontmatter.parse(content)
    if (parsed != null) {
        val previous = fetchNote(db, id) ?: throw CoreException.NotFound("Note $id")
        val reconciled = Frontmatter(
            title = parsed.title.ifEmpty { previous.title },
            description = parsed.description,
            tags = parsed.tags,
            createdAt = parsed.createdAt.ifEmpty { previous.createdAt },
            updatedAt = stamp,
            headerImage = parsed.headerImage,
        )
        db.execute(
            "UPDATE notes SET content = ?, title = ?, tags = ?, description = ?, updated_at = ? WHERE id = ?",
            NoteFrontmatter.render(reconciled, body), reconciled.title, NoteFrontmatter.tagsToString(reconciled.tags), reconciled.description, stamp, id,
        )
    } else {
        db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", content, stamp, id)
    }
    fetchNote(db, id) ?: throw CoreException.NotFound("Note $id")
}

/**
 * Doesn't bump `updated_at`: a move isn't a content edit. Clears the note's hand-set position, which no longer means anything among
 * new siblings. Into a group means into its notebook; ungrouped, the note stays in the one it is in.
 */
fun CompositionDatabase.setNoteGroup(id: Long, groupId: Long?): NoteDetail = file.write { db ->
    db.execute(
        """
        UPDATE notes SET group_id = ?, position = NULL,
          notebook_id = COALESCE((SELECT notebook_id FROM groups WHERE id = ?), notebook_id)
        WHERE id = ?
        """.trimIndent(),
        groupId, groupId, id,
    )
    fetchNote(db, id) ?: throw CoreException.NotFound("Note $id")
}

/** Puts a note in `groupId` immediately before the sibling `beforeId` (last when null) and fixes the whole sibling list's order. */
fun CompositionDatabase.placeNote(id: Long, groupId: Long?, beforeId: Long?): NoteDetail = file.write { db ->
    fetchNote(db, id) ?: throw CoreException.NotFound("Note $id")
    val group = groupId?.let { fetchGroup(db, it) }
    val notebookId = group?.notebookId ?: db.long("SELECT notebook_id FROM notes WHERE id = ?", id)
    val siblings = db.longs("SELECT id FROM notes WHERE group_id IS ? AND notebook_id IS ? ORDER BY $NOTE_DISPLAY_ORDER", groupId, notebookId)
    val ordered = Ordering.placeBefore(siblings, id, beforeId)
    db.execute("UPDATE notes SET group_id = ?, notebook_id = ? WHERE id = ?", groupId, notebookId, id)
    for ((index, noteId) in ordered.withIndex()) db.execute("UPDATE notes SET position = ? WHERE id = ?", index, noteId)
    fetchNote(db, id) ?: throw CoreException.NotFound("Note $id")
}

// Groups --------------------------------------------------------------------------------------------------------------------

/** Hand-placed groups first, in their set order; the rest (new ones too) by name. */
internal const val GROUP_DISPLAY_ORDER = "position IS NULL, position, name, id"
internal const val GROUP_COLUMNS = "id, uuid, name, parent_id, notebook_id, created_at, updated_at"

fun CompositionDatabase.listGroups(): List<NoteGroup> = file.read { db ->
    db.rows("SELECT $GROUP_COLUMNS FROM groups ORDER BY $GROUP_DISPLAY_ORDER").map(::NoteGroup)
}

fun CompositionDatabase.group(id: Long): NoteGroup? = file.read { fetchGroup(it, id) }

/** A sub-group is always in its parent's notebook; a top-level group goes in `notebookId` (the default notebook when none is given). */
fun CompositionDatabase.createGroup(name: String, parentId: Long? = null, notebookId: Long? = null, now: Instant = Instant.now()): NoteGroup =
    file.write { db ->
        val stamp = Timestamp.now(now)
        val parent = parentId?.let { fetchGroup(db, it) }
        val inNotebook = parent?.notebookId ?: notebookId ?: defaultNotebookId(db)
        db.execute("INSERT INTO groups (name, parent_id, notebook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", name, parentId, inNotebook, stamp, stamp)
        fetchGroup(db, db.lastInsertedRowId) ?: throw CoreException.NotFound("The group that was just created")
    }

fun CompositionDatabase.renameGroup(id: Long, name: String, now: Instant = Instant.now()) =
    file.write { it.execute("UPDATE groups SET name = ?, updated_at = ? WHERE id = ?", name, Timestamp.now(now), id) }

/** Reparents a group (null = top level); refuses to create a loop. It lands after any hand-placed siblings. */
fun CompositionDatabase.moveGroup(id: Long, parentId: Long?, now: Instant = Instant.now()) = file.write { db ->
    assertCanMove(db, id, parentId)
    db.execute("UPDATE groups SET parent_id = ?, position = NULL, updated_at = ? WHERE id = ?", parentId, Timestamp.now(now), id)
    adoptParentNotebook(db, id, parentId)
}

/** Moves a group, with its sub-groups and notes, into another notebook, where it becomes a top-level group (last among them). */
fun CompositionDatabase.moveGroupToNotebook(id: Long, notebookId: Long, now: Instant = Instant.now()) = file.write { db ->
    if (fetchGroup(db, id) == null) throw CoreException.InvalidNotebookMove("Group $id not found.")
    if (fetchNotebook(db, notebookId) == null) throw CoreException.InvalidNotebookMove("Notebook $notebookId not found.")
    db.execute("UPDATE groups SET parent_id = NULL, position = NULL, updated_at = ? WHERE id = ?", Timestamp.now(now), id)
    setSubtreeNotebook(db, id, notebookId)
}

/** Puts a group under `parentId` immediately before its sibling `beforeId` (last when null) and fixes the whole sibling list's order. */
fun CompositionDatabase.placeGroup(id: Long, parentId: Long?, beforeId: Long?, now: Instant = Instant.now()) = file.write { db ->
    assertCanMove(db, id, parentId)
    // The notebook it ends up in: its new parent's, or the one it is already top-level in.
    val notebookId = fetchGroup(db, parentId ?: id)?.notebookId
    val siblings = db.longs("SELECT id FROM groups WHERE parent_id IS ? AND notebook_id = ? ORDER BY $GROUP_DISPLAY_ORDER", parentId, notebookId)
    val ordered = Ordering.placeBefore(siblings, id, beforeId)
    db.execute("UPDATE groups SET parent_id = ?, updated_at = ? WHERE id = ?", parentId, Timestamp.now(now), id)
    adoptParentNotebook(db, id, parentId)
    for ((index, groupId) in ordered.withIndex()) db.execute("UPDATE groups SET position = ? WHERE id = ?", index, groupId)
}

/** Whether a group has no sub-groups and no notes directly in it. */
fun CompositionDatabase.groupIsEmpty(id: Long): Boolean = file.read { db ->
    (db.long("SELECT COUNT(*) FROM groups WHERE parent_id = ?", id) ?: 0L) == 0L &&
        (db.long("SELECT COUNT(*) FROM notes WHERE group_id = ?", id) ?: 0L) == 0L
}

internal fun fetchGroup(db: Db, id: Long): NoteGroup? = db.row("SELECT $GROUP_COLUMNS FROM groups WHERE id = ?", id)?.let(::NoteGroup)

/** Throws unless `parentId` (null = top level) is a legal new parent for group `id`. */
private fun assertCanMove(db: Db, id: Long, parentId: Long?) {
    if (fetchGroup(db, id) == null) throw CoreException.InvalidGroupMove("Group $id not found.")
    if (parentId != null && fetchGroup(db, parentId) == null) throw CoreException.InvalidGroupMove("Group $parentId not found.")
    val parents = db.rows("SELECT id, parent_id FROM groups").associate { it.long("id") to it.longOrNull("parent_id") }
    if (GroupMove.wouldCreateCycle(parents, id, parentId)) throw CoreException.InvalidGroupMove("Group $id cannot be moved into itself or one of its sub-groups.")
}

/** A group moved under another one joins that group's notebook, taking everything in it along. */
private fun adoptParentNotebook(db: Db, id: Long, parentId: Long?) {
    val notebookId = parentId?.let { fetchGroup(db, it) }?.notebookId ?: return
    setSubtreeNotebook(db, id, notebookId)
}

/** Puts group `id`, all its sub-groups and every note in any of them into `notebookId`. */
private fun setSubtreeNotebook(db: Db, id: Long, notebookId: Long) {
    val ids = mutableListOf(id)
    var index = 0
    while (index < ids.size) {
        for (child in db.longs("SELECT id FROM groups WHERE parent_id = ?", ids[index])) if (child !in ids) ids.add(child)
        index += 1
    }
    val marks = ids.joinToString(", ") { "?" }
    db.execute("UPDATE groups SET notebook_id = ? WHERE id IN ($marks)", notebookId, *ids.toTypedArray())
    db.execute("UPDATE notes SET notebook_id = ? WHERE group_id IN ($marks)", notebookId, *ids.toTypedArray())
}

// Notebooks -----------------------------------------------------------------------------------------------------------------

/** In the order they were dragged into (NULL until then: the order they were made). */
internal const val NOTEBOOK_DISPLAY_ORDER = "position IS NULL, position, id"
internal const val NOTEBOOK_COLUMNS = "id, uuid, name, created_at, updated_at"

fun CompositionDatabase.listNotebooks(): List<Notebook> = file.read { db ->
    db.rows("SELECT $NOTEBOOK_COLUMNS FROM notebooks ORDER BY $NOTEBOOK_DISPLAY_ORDER").map(::Notebook)
}

fun CompositionDatabase.notebook(id: Long): Notebook? = file.read { fetchNotebook(it, id) }

fun CompositionDatabase.createNotebook(name: String, now: Instant = Instant.now()): Notebook = file.write { db ->
    val stamp = Timestamp.now(now)
    db.execute("INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, ?, ?)", name, stamp, stamp)
    fetchNotebook(db, db.lastInsertedRowId) ?: throw CoreException.NotFound("The notebook that was just created")
}

/** Puts a notebook immediately before another (last when `beforeId` is null) and fixes the whole list's order. */
fun CompositionDatabase.placeNotebook(id: Long, beforeId: Long?) = file.write { db ->
    val ids = db.longs("SELECT id FROM notebooks ORDER BY $NOTEBOOK_DISPLAY_ORDER")
    if (id !in ids) throw CoreException.NotFound("Notebook $id")
    for ((index, notebookId) in Ordering.placeBefore(ids, id, beforeId).withIndex()) db.execute("UPDATE notebooks SET position = ? WHERE id = ?", index, notebookId)
}

fun CompositionDatabase.renameNotebook(id: Long, name: String, now: Instant = Instant.now()) =
    file.write { it.execute("UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?", name, Timestamp.now(now), id) }

/** Deletes an empty notebook for good. One with anything in it is refused, and the last notebook stays. */
fun CompositionDatabase.deleteNotebook(id: Long) = file.write { db ->
    if ((db.long("SELECT COUNT(*) FROM notebooks") ?: 0L) <= 1L) throw CoreException.LastNotebook()
    val groups = db.long("SELECT COUNT(*) FROM groups WHERE notebook_id = ?", id) ?: 0L
    val notes = db.long("SELECT COUNT(*) FROM notes WHERE notebook_id = ?", id) ?: 0L
    if (groups + notes > 0) throw CoreException.NotebookNotEmpty(id)
    // Trashed items that were in it come back to the default notebook if restored.
    db.execute("DELETE FROM notebooks WHERE id = ?", id)
}

internal fun fetchNotebook(db: Db, id: Long): Notebook? = db.row("SELECT $NOTEBOOK_COLUMNS FROM notebooks WHERE id = ?", id)?.let(::Notebook)

internal fun defaultNotebookId(db: Db): Long = db.long("SELECT MIN(id) FROM notebooks") ?: throw CoreException.NoNotebooks()

/** Where the core reports what it carries on past (an index that failed to update). The app points it at Android's log. */
object CoreLog {
    @Volatile var sink: (String) -> Unit = { System.err.println(it) }
}

/**
 * What the app calls to change notes, groups and notebooks: the data operations of the desktop's `service.ts`, one for one, on
 * top of the repository functions above (NoteStore.swift). Writing a note also keeps the search index in step.
 *
 * Indexing is derived state, as on the desktop: a failure to index never fails or rolls back a write, so it is logged and
 * swallowed, and a stale index is repaired by `rebuildIfStale` on the next launch. The index is only marked as matching the notes
 * when it matched them before the write; one that was already stale stays marked stale.
 */
class NoteStore(val database: CompositionDatabase, private val search: SearchIndex? = null) {
    fun createNote(title: String, groupId: Long? = null, notebookId: Long? = null, now: Instant = Instant.now()): NoteDetail =
        write({ database.createNote(title, groupId = groupId, notebookId = notebookId, now = now) }) { index, note -> index.upsert(listOf(indexed(note))) }

    /** Saves what the editor holds (see `saveNoteContent`) and re-indexes the note. */
    fun saveNoteContent(id: Long, content: String, now: Instant = Instant.now()): NoteDetail =
        write({ database.saveNoteContent(id, content, now) }) { index, note -> index.upsert(listOf(indexed(note))) }

    /** Moves the note to the Trash Can rather than erasing it. It leaves the search index straight away, and comes back if restored. */
    fun deleteNote(id: Long, now: Instant = Instant.now()) =
        write({ database.trashNote(id, now) }) { index, _ -> index.remove(listOf(id)) }

    fun restoreNote(id: Long): RestoreResult? = write({ database.restoreNote(id) }) { index, restored ->
        if (restored == null) return@write
        val note = database.note(id)
        // A note that came back under a new id (its own was taken) has nothing to add by the old one: start the index over.
        if (note != null) index.upsert(listOf(indexed(note))) else index.rebuild(database)
    }

    private fun indexed(note: NoteDetail) =
        IndexedNote(note.id, note.title, note.description, note.content, note.tags, note.createdAt, note.updatedAt)

    /** Runs `change`, then `reindex`, and marks the index current if it was before. The write's errors are thrown; the index's are logged. */
    private fun <T> write(change: () -> T, reindex: (SearchIndex, T) -> Unit): T {
        val index = search
        val wasCurrent = index != null && runCatching { index.isCurrent(database) }.getOrDefault(false)
        val result = change()
        if (index != null) {
            try {
                reindex(index, result)
                if (wasCurrent) index.markCurrent(database)
            } catch (error: Exception) {
                CoreLog.sink("[search] indexing failed: $error")
            }
        }
        return result
    }

    fun moveNote(id: Long, groupId: Long?) = database.setNoteGroup(id, groupId)

    fun placeNote(id: Long, groupId: Long?, beforeId: Long?) = database.placeNote(id, groupId, beforeId)

    fun createGroup(name: String, parentId: Long? = null, notebookId: Long? = null, now: Instant = Instant.now()) =
        database.createGroup(name, parentId, notebookId, now)

    fun renameGroup(id: Long, name: String, now: Instant = Instant.now()): NoteGroup {
        database.renameGroup(id, name, now)
        return database.group(id) ?: throw CoreException.NotFound("Group $id")
    }

    /** Moves the group to the Trash Can. Refuses (`GroupNotEmpty`) while it has sub-groups or notes. */
    fun deleteGroup(id: Long, now: Instant = Instant.now()) = database.trashGroup(id, now)

    fun restoreGroup(id: Long): RestoreResult? = database.restoreGroup(id)

    fun moveGroup(id: Long, parentId: Long?, now: Instant = Instant.now()): NoteGroup {
        database.moveGroup(id, parentId, now)
        return database.group(id) ?: throw CoreException.NotFound("Group $id")
    }

    fun moveGroupToNotebook(id: Long, notebookId: Long, now: Instant = Instant.now()): NoteGroup {
        database.moveGroupToNotebook(id, notebookId, now)
        return database.group(id) ?: throw CoreException.NotFound("Group $id")
    }

    fun placeGroup(id: Long, parentId: Long?, beforeId: Long?, now: Instant = Instant.now()): NoteGroup {
        database.placeGroup(id, parentId, beforeId, now)
        return database.group(id) ?: throw CoreException.NotFound("Group $id")
    }

    fun createNotebook(name: String, now: Instant = Instant.now()) = database.createNotebook(name, now)

    fun renameNotebook(id: Long, name: String, now: Instant = Instant.now()): Notebook {
        database.renameNotebook(id, name, now)
        return database.notebook(id) ?: throw CoreException.NotFound("Notebook $id")
    }

    /** Puts a notebook before another (last when `beforeId` is null) and returns the notebooks in their new order. */
    fun placeNotebook(id: Long, beforeId: Long?): List<Notebook> {
        database.placeNotebook(id, beforeId)
        return database.listNotebooks()
    }

    fun deleteNotebook(id: Long) = database.deleteNotebook(id)
}
