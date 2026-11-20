package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.search.IndexedNote
import com.rushinglabs.composition.core.search.SearchIndex
import com.rushinglabs.composition.core.search.SearchTolerance
import com.rushinglabs.composition.core.search.Typo
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The index on small hand-made notes, ported from SearchIndexTests.swift.

@DisplayName("Search index and note lookup")
class SearchIndexTests {
    private fun insert(db: CompositionDatabase, title: String, content: String = "", tags: String = "", updated: String = "2026-01-01T00:00:00.000Z"): Long =
        db.file.write {
            it.execute("INSERT INTO notes (title, content, tags, description, created_at, updated_at, notebook_id) VALUES (?, ?, ?, '', ?, ?, 1)", title, content, tags, updated, updated)
            it.lastInsertedRowId
        }

    private fun world(body: (CompositionDatabase, SearchIndex) -> Unit) = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            SearchIndex.open(File(scratch, "search.db")).use { index -> body(database, index) }
        }
    }

    @Test
    @DisplayName("a note comes back whole, and a list of ids comes back in the order asked, skipping what is gone")
    fun lookup() = world { database, _ ->
        val a = insert(database, "Alpha", content = "# Alpha\n\nbody", tags = "x,y")
        val b = insert(database, "Beta")
        val detail = database.note(a)!!
        assertTrue(detail.title == "Alpha" && detail.content == "# Alpha\n\nbody" && detail.tags == "x,y" && isUuid(detail.uuid))
        assertNull(database.note(999))
        assertEquals(listOf("Beta", "Alpha"), database.notes(listOf(b, 999, a)).map { it.title })
        assertTrue(database.notes(emptyList()).isEmpty())
        assertEquals(2, database.notes((1L..1200L).toList()).size, "a long list is read in pieces")
        assertEquals("x,y", database.listNotes().first { it.id == a }.tags)
    }

    @Test
    @DisplayName("finds a note by a word, a prefix and a typo; not by what it does not say")
    fun finds() = world { database, index ->
        val docker = insert(database, "Docker deep dive", content = "containers and images")
        insert(database, "Redis cheat sheet", content = "keys and values")
        index.rebuild(database)
        assertEquals(listOf(docker), index.search("docker"))
        assertEquals(listOf(docker), index.search("dock"), "the word being typed is a prefix")
        assertEquals(listOf(docker), index.search("dokcer"), "a swapped pair is one edit")
        assertEquals(listOf(docker), index.search("images"), "the text, not only the title")
        assertTrue(index.search("kubernetes").isEmpty())
        assertTrue(index.search("").isEmpty())
    }

    @Test
    @DisplayName("a title hit comes before a text hit, and ties go to the most recently updated")
    fun order() = world { database, index ->
        val textOnly = insert(database, "Notes", content = "all about redis", updated = "2026-03-01T00:00:00.000Z")
        val oldTitle = insert(database, "Redis one", updated = "2026-01-01T00:00:00.000Z")
        val newTitle = insert(database, "Redis two", updated = "2026-02-01T00:00:00.000Z")
        index.rebuild(database)
        assertEquals(listOf(newTitle, oldTitle, textOnly), index.search("redis"))
    }

    @Test
    @DisplayName("tag and date filters run in the index")
    fun filters() = world { database, index ->
        val old = insert(database, "Old", tags = "Infra", updated = "2025-06-01T00:00:00.000Z")
        val recent = insert(database, "Recent", tags = "infra, web", updated = "2026-06-01T00:00:00.000Z")
        index.rebuild(database)
        assertEquals(setOf(old, recent), index.search("tag: infra").toSet(), "tags ignore case")
        assertEquals(listOf(recent), index.search("tag: web"))
        assertEquals(listOf(recent), index.search("updated: >2026-01-01"))
        assertEquals(listOf(old), index.search("created: <2026-01-01"))
        assertTrue(index.search("tag: nothing").isEmpty())
    }

    @Test
    @DisplayName("upsert and remove change what is found")
    fun incremental() = world { database, index ->
        val id = insert(database, "Kubernetes")
        index.rebuild(database)
        assertEquals(listOf(id), index.search("kubernetes"))
        index.remove(listOf(id))
        assertTrue(index.search("kubernetes").isEmpty())
        val note = database.note(id)!!
        index.upsert(listOf(IndexedNote(id, "Terraform", "", note.content, "", note.createdAt, note.updatedAt)))
        assertTrue(index.search("terraform") == listOf(id) && index.search("kubernetes").isEmpty())
    }

    @Test
    @DisplayName("it rebuilds when the notes changed behind its back, and not otherwise")
    fun staleness() = world { database, index ->
        insert(database, "One")
        assertTrue(index.rebuildIfStale(database), "a new index is stale")
        assertFalse(index.rebuildIfStale(database), "and then it is not")

        val two = insert(database, "Two")
        assertTrue(index.search("two").isEmpty(), "the index has not seen it")
        assertTrue(index.rebuildIfStale(database))
        assertEquals(listOf(two), index.search("two"))

        // A trash that the app mirrors with `remove` and `markCurrent` leaves it current.
        database.trashNote(two)
        index.remove(listOf(two))
        index.markCurrent(database)
        assertFalse(index.rebuildIfStale(database))
        assertTrue(index.search("two").isEmpty())

        // The same trash without telling the index is noticed.
        val three = insert(database, "Three")
        index.rebuild(database)
        database.trashNote(three)
        assertTrue(index.rebuildIfStale(database))
        assertTrue(index.search("three").isEmpty())
    }

    @Test
    @DisplayName("the store keeps the index in step as notes are made, saved, trashed and restored")
    fun storeKeepsItInStep() = world { database, index ->
        index.rebuild(database)
        val store = NoteStore(database, index)
        val note = store.createNote("Kubernetes runbook")
        assertEquals(listOf(note.id), index.search("kubernetes"))
        store.saveNoteContent(note.id, "---\ntitle: Terraform plan\n---\nBody\n")
        assertTrue(index.search("terraform") == listOf(note.id) && index.search("kubernetes").isEmpty())
        store.deleteNote(note.id)
        assertTrue(index.search("terraform").isEmpty())
        store.restoreNote(note.id)
        assertEquals(listOf(note.id), index.search("terraform"))
        assertTrue(index.isCurrent(database), "every change went through the store, so the index is still current")
    }

    private fun codes(text: String) = text.codePoints().toArray()

    @Test
    @DisplayName("the rules differ only in what a first-letter mistake costs and whether a short word gets a mistake")
    fun rules() {
        // Meilisearch: a first-letter edit is 2, a swap of the first pair is 2, any other edit is 1.
        assertEquals(2, Typo.distance(codes("dedis"), codes("redis"), 2))
        assertEquals(0, Typo.distance(codes("redis"), codes("redis"), 2))
        assertEquals(2, Typo.distance(codes("erdis"), codes("redis"), 2))
        assertEquals(1, Typo.distance(codes("rdis"), codes("redis"), 2))
        // Forgiving: the same mistakes cost 1 each.
        val first = Typo.Rules.FORGIVING.firstLetterCost
        assertEquals(1, Typo.distance(codes("dedis"), codes("redis"), 1, first))
        assertEquals(1, Typo.distance(codes("erdis"), codes("redis"), 1, first))
        assertEquals(1, Typo.distance(codes("edis"), codes("redis"), 1, first), "a missing first letter")
        assertEquals(1, Typo.distance(codes("rredis"), codes("redis"), 1, first), "an extra first letter")
        assertNull(Typo.distance(codes("dedis"), codes("redis"), 1), "still two in Meilisearch's rules")
        assertEquals(1, Typo.prefixDistance(codes("dedi"), codes("redis"), 1, first)?.first)

        assertTrue(Typo.Rules.MEILISEARCH.budget(4) == 0 && Typo.Rules.FORGIVING.budget(4) == 0)
        assertTrue(Typo.Rules.FORGIVING_FALLBACK.budget(3) == 1 && Typo.Rules.FORGIVING_FALLBACK.budget(4) == 1)
        assertEquals(0, Typo.Rules.FORGIVING_FALLBACK.budget(2), "two letters are too few to guess at")
        assertTrue(Typo.Rules.FORGIVING_FALLBACK.budget(5) == 1 && Typo.Rules.FORGIVING_FALLBACK.budget(9) == 2)
    }

    @Test
    @DisplayName("a forgiving search catches a mistake in the first letter and, when nothing else is found, in a short word")
    fun forgiving() = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            SearchIndex.open(File(scratch, "strict.db")).use { strict ->
                SearchIndex.open(File(scratch, "forgiving.db"), SearchTolerance.FORGIVING).use { forgiving ->
                    val redis = insert(database, "Redis cheat sheet", content = "keys and values")
                    val the = insert(database, "Pending", content = "the cat sat")
                    val cut = insert(database, "Carpentry", content = "a clean cut")
                    strict.rebuild(database)
                    forgiving.rebuild(database)

                    assertTrue(strict.search("dedis").isEmpty())
                    assertEquals(listOf(redis), forgiving.search("dedis"))
                    assertEquals(listOf(redis), forgiving.search("edis"), "a missing first letter")
                    assertEquals(listOf(redis), forgiving.search("redis"), "and what is spelt right is unchanged")

                    assertTrue(strict.search("teh").isEmpty())
                    assertEquals(listOf(the), forgiving.search("teh"))
                    assertEquals(listOf(the), forgiving.search("cat"), "the word is in the notes, so it is not read as a mistake for `cut`")
                    assertEquals(listOf(cut), forgiving.search("cut"))
                    assertTrue(forgiving.search("zzq").isEmpty(), "and a word that is near nothing finds nothing")
                    assertEquals(listOf(the), forgiving.search("teh cat"))
                }
            }
        }
    }
}
