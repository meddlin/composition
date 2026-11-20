package com.rushinglabs.composition.core

import java.time.Instant
import kotlin.math.ceil
import kotlin.math.max

// The Trash Can: what it holds and for how long (`trash.ts`), and the only way a note or group leaves `notes` and `groups`
// (`trashRepo.ts`). Ported from Trash.swift and TrashCan.swift; the SQL is the same text, and the conformance script
// (fixtures/conformance/trash-script.json) runs the desktop's and this against one database.

object TrashRetention {
    /** Items older than this are permanently deleted. */
    const val DAYS = 60
    private const val MILLISECONDS = DAYS * Timestamp.MILLISECONDS_PER_DAY

    /** When the Trash Can will delete an item deleted at `deletedAt` for good; null only if `deletedAt` is not a `toISOString` time. */
    fun expiry(deletedAt: String): String? = Timestamp.milliseconds(deletedAt)?.let { Timestamp.string(it + MILLISECONDS) }

    /** The `deleted_at` before which an item has outlived the retention window. */
    fun cutoff(now: Instant = Instant.now()): String = Timestamp.string(now.toEpochMilli() - MILLISECONDS)

    /** Whole days until `expiresAt`, rounded up so "0" never shows while it still exists, and never negative. */
    fun daysLeft(expiresAt: String, now: Instant = Instant.now()): Int {
        val expires = Timestamp.milliseconds(expiresAt) ?: return 0
        return max(0, ceil((expires - now.toEpochMilli()).toDouble() / Timestamp.MILLISECONDS_PER_DAY).toInt())
    }
}

data class TrashedNote(val id: Long, val title: String, val deletedAt: String, val expiresAt: String?)
data class TrashedGroup(val id: Long, val name: String, val deletedAt: String, val expiresAt: String?)

/** Everything in the Trash Can, most recently deleted first. */
data class Trash(val notes: List<TrashedNote>, val groups: List<TrashedGroup>)

/** `restoredToTopLevel`: the item's original group or parent is gone, so it came back at the top. */
data class RestoreResult(val restoredToTopLevel: Boolean)

/** Why a write was refused. The wording is the desktop's, which shows the same text. */
sealed class CoreException(message: String) : Exception(message) {
    class NotFound(what: String) : CoreException("$what not found.")
    /** A group with sub-groups or notes cannot be trashed, so no trashed item ever hangs off another one. */
    class GroupNotEmpty(val id: Long) : CoreException("Group $id still has sub-groups or notes; empty it before deleting.")
    /** `moveGroup` and `placeGroup`: the group or its new parent is gone, or the move would put it inside itself. */
    class InvalidGroupMove(detail: String) : CoreException("That group can't be moved there.") { val detail = detail }
    /** `moveGroupToNotebook`: the group or the notebook is gone. */
    class InvalidNotebookMove(detail: String) : CoreException("That group can't be moved there.") { val detail = detail }
    class LastNotebook : CoreException("The last notebook can't be deleted.")
    class NotebookNotEmpty(val id: Long) : CoreException("This notebook still has groups or notes — empty it first.")
    class NoNotebooks : CoreException("There are no notebooks.")
}

/** Moves a note to the trash, keeping its id and uuid. A note that is already gone is ignored. */
fun CompositionDatabase.trashNote(id: Long, now: Instant = Instant.now()) = file.write { db ->
    db.execute(
        """
        INSERT OR REPLACE INTO trashed_notes
          (id, uuid, title, content, tags, description, created_at, updated_at, group_id, notebook_id, deleted_at)
        SELECT id, uuid, title, content, tags, description, created_at, updated_at, group_id, notebook_id, ?
        FROM notes WHERE id = ?
        """.trimIndent(),
        Timestamp.now(now), id,
    )
    db.execute("DELETE FROM notes WHERE id = ?", id)
}

/** Moves a group to the trash. Refuses a group that still has sub-groups or notes, and changes nothing then. */
fun CompositionDatabase.trashGroup(id: Long, now: Instant = Instant.now()) = file.write { db ->
    val children = db.long("SELECT COUNT(*) FROM groups WHERE parent_id = ?", id) ?: 0L
    val notes = db.long("SELECT COUNT(*) FROM notes WHERE group_id = ?", id) ?: 0L
    if (children != 0L || notes != 0L) throw CoreException.GroupNotEmpty(id)
    db.execute(
        """
        INSERT OR REPLACE INTO trashed_groups
          (id, uuid, name, parent_id, notebook_id, created_at, updated_at, deleted_at)
        SELECT id, uuid, name, parent_id, notebook_id, created_at, updated_at, ?
        FROM groups WHERE id = ?
        """.trimIndent(),
        Timestamp.now(now), id,
    )
    db.execute("DELETE FROM groups WHERE id = ?", id)
}

fun CompositionDatabase.listTrash(): Trash = file.read { db ->
    val notes = db.rows("SELECT id, title, deleted_at FROM trashed_notes ORDER BY deleted_at DESC, id DESC").map {
        TrashedNote(it.long("id"), it.string("title"), it.string("deleted_at"), TrashRetention.expiry(it.string("deleted_at")))
    }
    val groups = db.rows("SELECT id, name, deleted_at FROM trashed_groups ORDER BY deleted_at DESC, id DESC").map {
        TrashedGroup(it.long("id"), it.string("name"), it.string("deleted_at"), TrashRetention.expiry(it.string("deleted_at")))
    }
    Trash(notes, groups)
}

/**
 * Puts a trashed note back, in its original group if that group still exists, otherwise ungrouped. Null when the note isn't
 * in the trash (already restored or purged).
 */
fun CompositionDatabase.restoreNote(id: Long): RestoreResult? = file.write { db ->
    val row = db.row("SELECT * FROM trashed_notes WHERE id = ?", id) ?: return@write null
    val originalGroup = row.longOrNull("group_id")
    val originalNotebook = row.longOrNull("notebook_id")
    val group = originalGroup?.let { db.row("SELECT notebook_id FROM groups WHERE id = ?", it) }
    val groupId = if (group == null) null else originalGroup
    // In its group's notebook if the group is still there, else the one it was in (if that survives).
    val notebookId = group?.longOrNull("notebook_id") ?: survivingNotebookId(db, originalNotebook)
    // Ids are never reused (AUTOINCREMENT), so keeping it is safe; a clash would mean the database was swapped underneath us.
    val idTaken = db.row("SELECT 1 FROM notes WHERE id = ?", id) != null
    db.execute(
        """
        INSERT INTO notes (id, uuid, title, content, tags, description, created_at, updated_at, group_id, notebook_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """.trimIndent(),
        if (idTaken) null else id, restoredUuid(db, "notes", row.stringOrNull("uuid")), row.string("title"),
        row.string("content"), row.string("tags"), row.string("description"), row.string("created_at"),
        row.string("updated_at"), groupId, notebookId,
    )
    db.execute("DELETE FROM trashed_notes WHERE id = ?", id)
    RestoreResult(restoredToTopLevel = originalGroup != null && groupId == null)
}

/** Puts a trashed group back under its original parent if that still exists, otherwise at the top level. */
fun CompositionDatabase.restoreGroup(id: Long): RestoreResult? = file.write { db ->
    val row = db.row("SELECT * FROM trashed_groups WHERE id = ?", id) ?: return@write null
    val originalParent = row.longOrNull("parent_id")
    val originalNotebook = row.longOrNull("notebook_id")
    val parent = originalParent?.let { db.row("SELECT notebook_id FROM groups WHERE id = ?", it) }
    val parentId = if (parent == null) null else originalParent
    val notebookId = parent?.longOrNull("notebook_id") ?: survivingNotebookId(db, originalNotebook)
    val idTaken = db.row("SELECT 1 FROM groups WHERE id = ?", id) != null
    db.execute(
        """
        INSERT INTO groups (id, uuid, name, parent_id, notebook_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """.trimIndent(),
        if (idTaken) null else id, restoredUuid(db, "groups", row.stringOrNull("uuid")), row.string("name"),
        parentId, notebookId, row.string("created_at"), row.string("updated_at"),
    )
    db.execute("DELETE FROM trashed_groups WHERE id = ?", id)
    RestoreResult(restoredToTopLevel = originalParent != null && parentId == null)
}

/** Permanently deletes a trashed note. */
fun CompositionDatabase.purgeNote(id: Long) = file.write { it.execute("DELETE FROM trashed_notes WHERE id = ?", id) }

/** Permanently deletes a trashed group. */
fun CompositionDatabase.purgeGroup(id: Long) = file.write { it.execute("DELETE FROM trashed_groups WHERE id = ?", id) }

/** Permanently deletes everything that has been in the trash longer than the retention window. */
fun CompositionDatabase.purgeExpired(now: Instant = Instant.now()) {
    val cutoff = TrashRetention.cutoff(now)
    file.write { db ->
        db.execute("DELETE FROM trashed_notes WHERE deleted_at < ?", cutoff)
        db.execute("DELETE FROM trashed_groups WHERE deleted_at < ?", cutoff)
    }
}

/**
 * The uuid a restored row goes back with: the one it was trashed with, unless something else already holds it (the database was
 * swapped underneath us); null makes the table's trigger issue a fresh one.
 */
private fun restoredUuid(db: Db, table: String, uuid: String?): String? {
    if (uuid == null) return null
    return if (db.row("SELECT 1 FROM $table WHERE uuid = ?", uuid) != null) null else uuid
}

/** The notebook an item was trashed from if it still exists, else the default one (the lowest id). */
private fun survivingNotebookId(db: Db, notebookId: Long?): Long {
    if (notebookId != null && db.row("SELECT 1 FROM notebooks WHERE id = ?", notebookId) != null) return notebookId
    return db.long("SELECT MIN(id) FROM notebooks") ?: throw CoreException.NoNotebooks()
}
