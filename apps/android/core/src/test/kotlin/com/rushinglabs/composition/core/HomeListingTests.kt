package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.organization.HomeListing
import com.rushinglabs.composition.core.organization.excerpts
import org.junit.jupiter.api.DisplayName
import java.io.File
import java.time.Instant
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The home page's lists, ported from the HomeListingTests suite of PolishScreensTests.swift. The desktop's `homeListing.ts` has no
// fixture in the corpus; these are the iPad's plain cases, plus the places where JavaScript's patterns read text differently from the
// platform's.

@DisplayName("Home page")
class HomeListingTests {
    private fun note(id: Long, updatedAt: String) = NoteSummary(id, "", "n$id", "", 1, null, "", updatedAt)

    @Test
    @DisplayName("recent notes are the newest edits first, the later id first on a tie, and capped")
    fun recent() {
        val notes = listOf(note(1, "2026-01-01T00:00:00Z"), note(2, "2026-03-01T00:00:00Z"), note(3, "2026-02-01T00:00:00Z"), note(4, "2026-03-01T00:00:00Z"))
        assertEquals(listOf(4L, 2L, 3L, 1L), HomeListing.recent(notes).map { it.id })
        assertEquals(listOf(4L, 2L), HomeListing.recent(notes, limit = 2).map { it.id })
        assertTrue(HomeListing.recent(notes, limit = 0).isEmpty() && HomeListing.recent(emptyList()).isEmpty())
        val many = (1..30).map { note(it.toLong(), "2026-01-${String.format(Locale.ROOT, "%02d", it)}T00:00:00Z") }
        assertEquals(HomeListing.RECENT_LIMIT, HomeListing.recent(many).size)
    }

    @Test
    @DisplayName("pinned groups and notes come in the order they were pinned, and a pin whose target is gone is skipped")
    fun pinned() {
        val groups = listOf(NoteGroup(5, "", "G5", null, 1, "", ""))
        val notes = listOf(note(1, "a"), note(2, "b"))
        val favorites = listOf(
            Favorite(FavoriteKind.NOTE, 2), Favorite(FavoriteKind.GROUP, 5), Favorite(FavoriteKind.NOTE, 99),
            Favorite(FavoriteKind.GROUP, 98), Favorite(FavoriteKind.NOTE, 1),
        )
        val items = HomeListing.pinned(favorites, groups, notes)
        assertEquals(listOf(HomeListing.Pinned.Note(notes[1]), HomeListing.Pinned.Group(groups[0]), HomeListing.Pinned.Note(notes[0])), items)
    }

    @Test
    @DisplayName("the excerpt drops frontmatter and markup, and truncates")
    fun excerpt() {
        assertEquals("Heading Some bold and a link.", HomeListing.excerpt("---\ntitle: T\n---\n# Heading\n\nSome **bold** and a [link](http://x.y)."))
        assertEquals("aaaaaaaaaa…", HomeListing.excerpt("a".repeat(200), max = 10))
        assertEquals("item one quoted text code", HomeListing.excerpt("```swift\nlet x = 1\n```\n\n![pic](app_data/a.png)\n- item one\n> quoted _text_ `code`"))
        assertEquals("", HomeListing.excerpt(""))
    }

    @Test
    @DisplayName("the excerpt reads white space, digits and line starts as the desktop's JavaScript does")
    fun excerptAsJavaScriptReadsIt() {
        assertEquals("a b", HomeListing.excerpt("a\u2028\u00A0\uFEFFb"), "JavaScript's white space, which a JVM's \\s leaves out")
        assertEquals("a\u0085b", HomeListing.excerpt("a\u0085b"), "U+0085 is not white space to JavaScript")
        assertEquals("one two", HomeListing.excerpt("# one\u2028- two"), "a line starts after U+2028")
        assertEquals("١. not a list", HomeListing.excerpt("١. not a list"), "only 0 to 9 number a list item")
    }

    @Test
    @DisplayName("a card's line comes from the note's text in the database, for just the notes asked for")
    fun excerptsFromTheDatabase() = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val ids = database.file.write { db ->
                listOf("---\ntitle: A\n---\n# Heading\n\nSome **bold** words", "plain note", "third").map { content ->
                    db.execute("INSERT INTO notes (title, content, tags, description, created_at, updated_at) VALUES ('T', ?, '', '', 'c', 'u')", content)
                    db.lastInsertedRowId
                }
            }
            val found = database.excerpts(listOf(ids[0], ids[1], 9_999))
            assertEquals(mapOf(ids[0] to "Heading Some bold words", ids[1] to "plain note"), found)
            assertTrue(database.excerpts(emptyList()).isEmpty())
        }
    }

    @Test
    @DisplayName("relative time reads as the desktop's does, and a month or more is left for a date")
    fun relativeTime() {
        val now = Instant.parse("2026-10-23T12:00:00Z")
        assertEquals("just now", HomeListing.relativeTime("2026-10-23T11:59:30Z", now))
        assertEquals("30 min ago", HomeListing.relativeTime("2026-10-23T11:30:00Z", now))
        assertEquals("5 hr ago", HomeListing.relativeTime("2026-10-23T07:00:00Z", now))
        assertEquals("1 day ago", HomeListing.relativeTime("2026-10-22T11:00:00Z", now))
        assertEquals("3 days ago", HomeListing.relativeTime("2026-10-20T11:00:00.123Z", now), "the fractional seconds the desktop writes")
        assertNull(HomeListing.relativeTime("2026-09-01T00:00:00.000Z", now))
        assertNull(HomeListing.relativeTime("not a time", now))
        assertEquals("just now", HomeListing.relativeTime("2026-10-23T13:00:00Z", now), "a clock a little ahead")
        assertEquals("1 hr ago", HomeListing.relativeTime("2026-10-23T12:00:00+01:00", now), "an offset other than Z")
    }
}
