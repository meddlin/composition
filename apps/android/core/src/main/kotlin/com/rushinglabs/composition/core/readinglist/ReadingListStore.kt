package com.rushinglabs.composition.core.readinglist

import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.Db
import com.rushinglabs.composition.core.Row
import com.rushinglabs.composition.core.Timestamp
import java.time.Instant

// The Reading List's links in the notes database: a port of the desktop's `readingListRepo.ts` and `readingListService.ts`, by way of
// ReadingListStore.swift, with the same SQL, the same refusals and the same words. The `reading_list` table is the desktop's
// (`Schema.readingList`), so links travel in a backup both ways. Each operation is one write transaction, and `now` is a parameter so a
// test can say when something happened. `fixtures/conformance/reading-list.json` records a session through the desktop's real service;
// `ReadingListConformanceTests` replays it here and compares every row.

/** Why a change to the Reading List was refused, in the desktop's words. */
sealed class ReadingListException(message: String) : Exception(message) {
    /** The link is not one the list takes. */
    class BadLink(val problem: ReadingLinks.Problem) : ReadingListException(problem.message)

    /** The link is in the list already: this one. */
    class AlreadyListed(val item: ReadingItem) : ReadingListException("That link is already in your list: ${item.label}.")

    /** The link was deleted (by another window, or a restore) before the change reached it. */
    class Gone : ReadingListException("That link is no longer in your list.")
}

private fun readingItem(row: Row) = ReadingItem(
    row.long("id"), row.string("url"), row.string("title"), row.long("read") == 1L, row.string("created_at"), row.string("updated_at"),
)

private fun fetchReadingItem(db: Db, id: Long): ReadingItem? = db.row("SELECT * FROM reading_list WHERE id = ?", id)?.let(::readingItem)

/** Every link, oldest first. */
fun CompositionDatabase.readingItems(): List<ReadingItem> = file.read { db ->
    db.rows("SELECT * FROM reading_list ORDER BY id").map(::readingItem)
}

fun CompositionDatabase.readingItem(id: Long): ReadingItem? = file.read { fetchReadingItem(it, id) }

/**
 * Adds a link at the end, unread and untitled. Throws `BadLink` for an address that is not a web page and `AlreadyListed` for one
 * already in the list, however it was typed.
 */
fun CompositionDatabase.addReadingItem(input: String, now: Instant = Instant.now()): ReadingItem {
    val url = when (val normalized = ReadingLinks.normalize(input)) {
        is ReadingLinks.Normalized.Link -> normalized.url
        is ReadingLinks.Normalized.Refused -> throw ReadingListException.BadLink(normalized.problem)
    }
    return file.write { db ->
        db.row("SELECT * FROM reading_list WHERE url = ?", url)?.let { throw ReadingListException.AlreadyListed(readingItem(it)) }
        val stamp = Timestamp.now(now)
        db.execute("INSERT INTO reading_list (url, title, read, created_at, updated_at) VALUES (?, '', 0, ?, ?)", url, stamp, stamp)
        fetchReadingItem(db, db.lastInsertedRowId) ?: throw ReadingListException.Gone()
    }
}

/**
 * Fills in the title of a link that has none, from its page. A link that has a title keeps it, and a title with nothing in it changes
 * nothing. Throws `Gone` for a link that is not there.
 */
fun CompositionDatabase.setReadingItemTitle(id: Long, title: String, now: Instant = Instant.now()): ReadingItem = file.write { db ->
    val current = fetchReadingItem(db, id) ?: throw ReadingListException.Gone()
    val cleaned = if (current.title.isEmpty()) ReadingLinks.cleanTitle(title) else null
    if (cleaned == null) return@write current
    db.execute(
        "UPDATE reading_list SET title = ?, read = ?, updated_at = ? WHERE id = ?",
        cleaned, if (current.read) 1L else 0L, Timestamp.now(now), id,
    )
    fetchReadingItem(db, id) ?: current
}

/** Marks the link read or unread. Throws `Gone` for a link that is not there. */
fun CompositionDatabase.setReadingItemRead(id: Long, read: Boolean, now: Instant = Instant.now()): ReadingItem = file.write { db ->
    val current = fetchReadingItem(db, id) ?: throw ReadingListException.Gone()
    db.execute(
        "UPDATE reading_list SET title = ?, read = ?, updated_at = ? WHERE id = ?",
        current.title, if (read) 1L else 0L, Timestamp.now(now), id,
    )
    fetchReadingItem(db, id) ?: throw ReadingListException.Gone()
}

/** Deletes the link, for good: links do not go to the Trash Can. Deleting one that is already gone is not an error. */
fun CompositionDatabase.deleteReadingItem(id: Long) {
    file.write { it.execute("DELETE FROM reading_list WHERE id = ?", id) }
}
