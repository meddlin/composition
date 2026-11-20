package com.rushinglabs.composition.core.organization

import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.Favorite
import com.rushinglabs.composition.core.FavoriteKind
import com.rushinglabs.composition.core.NoteFrontmatter
import com.rushinglabs.composition.core.NoteGroup
import com.rushinglabs.composition.core.NoteSummary
import com.rushinglabs.composition.core.markdown.JS_SPACE
import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.floor

// What the home page lists: the twin of the desktop's `homeListing.ts` (`recentNotes`, `pinnedItems`, `noteExcerpt`, `relativeTime`), by
// way of HomeListing.swift, cut down to what the iPad has. The desktop also lets the person pick a notebook to draw recent notes from,
// order them by when they were opened, pin whole notebooks and choose which sections show; none of that is kept in `settings.json` by
// the iPad (it keeps the favorites and nothing else of the home page), so these are the defaults.

object HomeListing {
    /** How many recent notes the home page shows (`RECENT_NOTE_LIMIT`). */
    const val RECENT_LIMIT = 12

    /** The most recently edited notes, newest first, the later id first when two were edited at the same moment. */
    fun recent(notes: List<NoteSummary>, limit: Int = RECENT_LIMIT): List<NoteSummary> =
        notes.sortedWith(compareByDescending<NoteSummary> { it.updatedAt }.thenByDescending { it.id }).take(maxOf(limit, 0))

    /** One thing pinned to the top of the home page. */
    sealed interface Pinned {
        data class Group(val group: NoteGroup) : Pinned
        data class Note(val note: NoteSummary) : Pinned
    }

    /** What is pinned, in the order it was pinned. A pin whose group or note is gone is skipped. */
    fun pinned(favorites: List<Favorite>, groups: List<NoteGroup>, notes: List<NoteSummary>): List<Pinned> {
        // The first listed with an id wins.
        val groupById = HashMap<Long, NoteGroup>().apply { for (group in groups) if (group.id !in this) put(group.id, group) }
        val noteById = HashMap<Long, NoteSummary>().apply { for (note in notes) if (note.id !in this) put(note.id, note) }
        return favorites.mapNotNull { favorite ->
            when (favorite.kind) {
                FavoriteKind.GROUP -> groupById[favorite.id]?.let(Pinned::Group)
                FavoriteKind.NOTE -> noteById[favorite.id]?.let(Pinned::Note)
            }
        }
    }

    // Excerpt ------------------------------------------------------------------------------------------------------------------
    //
    // The desktop's patterns with JavaScript's meanings spelled out: `\s` is JavaScript's, `\d` is 0 to 9, and `^` with the `m` flag
    // starts a line only after JavaScript's line terminators. (The iPad runs them through NSRegularExpression, which reads `\s` and
    // `\d` as Unicode's; the desktop is the one followed here.)

    private val fence = Regex("```[\\s\\S]*?```")
    private val image = Regex("!\\[[^\\]]*\\]\\([^)]*\\)")
    private val link = Regex("\\[([^\\]]*)\\]\\([^)]*\\)")
    private val blockMark = Regex("(?<![^\\n\\r\\u2028\\u2029])$JS_SPACE{0,3}(#{1,6}|[-*+>]|[0-9]+\\.)$JS_SPACE+")
    private val emphasis = Regex("[*_`~|]")
    private val spaces = Regex("$JS_SPACE+")

    /** A one-line plain-text preview of a note's body: no frontmatter, headings or markup. `max` counts UTF-16 units, as JavaScript does. */
    fun excerpt(content: String, max: Int = 110): String {
        var text = NoteFrontmatter.strip(content)
        text = fence.replace(text, " ")
        text = image.replace(text, " ")
        text = link.replace(text, "$1")
        text = blockMark.replace(text, "")
        text = emphasis.replace(text, "")
        text = spaces.replace(text, " ")
        text = JavaScriptText.trim(text)
        if (text.length <= max) return text
        return JavaScriptText.trim(text.substring(0, max)) + "…"
    }

    // Relative time ------------------------------------------------------------------------------------------------------------

    /**
     * "just now", "5 min ago", "3 days ago". Null when `iso` is not a timestamp or the time is a month or more ago, which the screen
     * writes as a date.
     */
    fun relativeTime(iso: String, now: Instant = Instant.now()): String? {
        val then = parse(iso) ?: return null
        val minutes = floor((now.toEpochMilli() - then.toEpochMilli()) / 60_000.0).toLong()
        if (minutes < 1) return "just now"
        if (minutes < 60) return "$minutes min ago"
        val hours = minutes / 60
        if (hours < 24) return "$hours hr ago"
        val days = hours / 24
        if (days < 31) return "$days ${if (days == 1L) "day" else "days"} ago"
        return null
    }

    /** An ISO 8601 time with or without fractional seconds, at `Z` or at an offset. */
    private fun parse(iso: String): Instant? =
        runCatching { Instant.parse(iso) }.getOrNull() ?: runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
}

/** A line of each note's text, by the note's id, for the cards of the home page: the first 4,000 characters are read, which is far more than a card shows. */
fun CompositionDatabase.excerpts(ids: List<Long>): Map<Long, String> {
    if (ids.isEmpty()) return emptyMap()
    val heads = file.read { db ->
        val found = HashMap<Long, String>()
        // SQLite's limit on variables is far above any home page, but a long list is read in pieces anyway, as `notes(ids)` does.
        for (chunk in ids.chunked(500)) {
            val marks = chunk.joinToString(",") { "?" }
            for (row in db.rows("SELECT id, substr(content, 1, 4000) AS head FROM notes WHERE id IN ($marks)", *chunk.toTypedArray())) {
                found[row.long("id")] = row.string("head")
            }
        }
        found
    }
    return heads.mapValues { HomeListing.excerpt(it.value) }
}
