package com.rushinglabs.composition.core.search

import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.Db
import com.rushinglabs.composition.core.SqliteFile
import com.rushinglabs.composition.core.Timestamp
import java.io.File
import java.util.concurrent.atomic.AtomicReference

// Full-text search with typo tolerance, over SQLite FTS5: the replacement for the Meilisearch the desktop runs, ported from the
// iPad's SearchIndex.swift. The behaviour to match is `searchIndex.ts` with a real Meilisearch behind it.
//
// The index is a file of its own (`search.db`), never part of `composition.db`: it is derived data that can be thrown away and
// rebuilt, it must not change the schema the desktop shares, and a backup should not carry it.
//
// How a query is answered:
//   1. The text becomes words. Each is expanded to the words in the notes within its typo budget; the last one, being typed, also
//      matches as the start of a longer word.
//   2. Notes matching all the words come first, then notes matching all but the last word, and so on (Meilisearch's "last"
//      matching strategy). Within those, notes matched with no typos before one typo before two.
//   3. Within each group, notes matching in the title come before notes matching in the text, and the rest are most recently
//      updated first.
//
// Not yet here (the PDF slice): the words of a PDF's own pages and of its marks.

/** A note as the index needs it: the columns of `notes`. */
data class IndexedNote(
    val id: Long, val title: String, val description: String, val content: String,
    /** Comma-joined, the way the database stores them. */
    val tags: String,
    val createdAt: String, val updatedAt: String,
)

/** How forgiving a search is of mistakes in what was typed. */
enum class SearchTolerance {
    /** Exactly Meilisearch's rules, as the desktop searches. This is what the conformance tests check. */
    MATCHES_MEILISEARCH,
    /**
     * More forgiving, for a keyboard that is easy to mistype on: a first-letter mistake counts as one, like any other, and when a
     * search finds nothing it is repeated allowing one mistake in words of 3 and 4 letters (`teh` for `the`).
     */
    FORGIVING;

    internal val rules get() = if (this == FORGIVING) Typo.Rules.FORGIVING else Typo.Rules.MEILISEARCH
    internal val fallback get() = if (this == FORGIVING) Typo.Rules.FORGIVING_FALLBACK else null
}

class SearchIndex private constructor(private val file: SqliteFile, private val tolerance: SearchTolerance) : AutoCloseable {
    companion object {
        /** The most results a search returns, as on the desktop. */
        const val RESULT_LIMIT = 50

        /** The columns, most important first: the order Meilisearch's searchableAttributes put them in. */
        internal val COLUMNS = listOf("title", "content", "description")

        /** Opens (creating if needed) the index file at `path`. */
        fun open(path: File, tolerance: SearchTolerance = SearchTolerance.MATCHES_MEILISEARCH): SearchIndex {
            path.absoluteFile.parentFile.mkdirs()
            val file = SqliteFile.open(path.path)
            file.writeWithoutTransaction { db ->
                db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, created_ts INTEGER NOT NULL, updated_ts INTEGER NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS doc_tags (id INTEGER NOT NULL, tag TEXT NOT NULL);
                    CREATE INDEX IF NOT EXISTS idx_doc_tags ON doc_tags (tag, id);
                    CREATE INDEX IF NOT EXISTS idx_doc_tags_id ON doc_tags (id);
                    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                        title, content, description, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4');
                    CREATE VIRTUAL TABLE IF NOT EXISTS notes_vocab USING fts5vocab(notes_fts, 'row');
                    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    """.trimIndent(),
                )
            }
            return SearchIndex(file, tolerance)
        }

        private fun delete(ids: List<Long>, db: Db) {
            for (id in ids) {
                db.execute("DELETE FROM notes_fts WHERE rowid = ?", id)
                db.execute("DELETE FROM docs WHERE id = ?", id)
                db.execute("DELETE FROM doc_tags WHERE id = ?", id)
            }
        }

        private fun insert(notes: List<IndexedNote>, db: Db) {
            for (note in notes) {
                db.execute("INSERT INTO notes_fts (rowid, title, content, description) VALUES (?, ?, ?, ?)", note.id, note.title, note.content, note.description)
                db.execute("INSERT INTO docs (id, created_ts, updated_ts, updated_at) VALUES (?, ?, ?, ?)", note.id, seconds(note.createdAt), seconds(note.updatedAt), note.updatedAt)
                // The desktop's `tagsFromString`: split on commas, trim, drop empties. Matched without regard to case or accents.
                for (name in note.tags.split(",").map { it.trim() }.filter { it.isNotEmpty() }) {
                    db.execute("INSERT INTO doc_tags (id, tag) VALUES (?, ?)", note.id, Typo.fold(name))
                }
            }
        }

        /** `Math.floor(new Date(iso).getTime() / 1000)` */
        private fun seconds(iso: String): Long = Timestamp.milliseconds(iso)?.let { Math.floorDiv(it, 1000L) } ?: 0
    }

    /** The words in the notes, read from the index once and kept until it changes. */
    private val vocabulary = AtomicReference<Vocabulary?>(null)

    override fun close() = file.close()

    // Keeping it in step ----------------------------------------------------------------------------------------------------

    /**
     * Rebuilds the index if it was not built from the notes as they are now (it is new, or the notes changed some way other than
     * through `upsert` and `remove`, such as a restore). Returns whether it rebuilt.
     */
    fun rebuildIfStale(database: CompositionDatabase): Boolean {
        if (isCurrent(database)) return false
        rebuild(database)
        return true
    }

    /** Whether the index was built from the notes as they are now. */
    fun isCurrent(database: CompositionDatabase): Boolean =
        file.read { it.string("SELECT value FROM meta WHERE key = 'notes'") } == database.notesFingerprint()

    /** Records that the index now matches `database`: call it after `upsert` or `remove` has made it so. */
    fun markCurrent(database: CompositionDatabase) {
        val current = database.notesFingerprint()
        file.write { it.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('notes', ?)", current) }
    }

    /** Empties the index and fills it from every note in `database`. */
    fun rebuild(database: CompositionDatabase) {
        val fingerprint = database.notesFingerprint()
        val notes = database.indexedNotes()
        file.write { db ->
            db.execute("DELETE FROM notes_fts; DELETE FROM docs; DELETE FROM doc_tags;")
            insert(notes, db)
            db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('notes', ?)", fingerprint)
        }
        vocabulary.set(null)
    }

    /** Adds or replaces these notes. */
    fun upsert(notes: List<IndexedNote>) {
        file.write { db ->
            delete(notes.map { it.id }, db)
            insert(notes, db)
        }
        vocabulary.set(null)
    }

    /** Removes these notes (trashed or deleted). */
    fun remove(ids: List<Long>) {
        file.write { delete(ids, it) }
        vocabulary.set(null)
    }

    // Searching -------------------------------------------------------------------------------------------------------------

    /**
     * The ids of the notes matching `query`, best first, at most `RESULT_LIMIT`. The query may mix free text with `field: value`
     * filters (`SearchQueryParser`). A query with neither matches nothing.
     */
    fun search(query: String): List<Long> {
        val parsed = SearchQueryParser.parse(query)
        if (parsed.text.isEmpty() && parsed.filters.isEmpty()) return emptyList()
        return file.read { search(parsed, it) }
    }

    private fun search(parsed: ParsedSearchQuery, db: Db): List<Long> {
        val conditions = ArrayList<String>()
        val arguments = ArrayList<Any?>()
        for (filter in parsed.filters) {
            when (filter) {
                is SearchFilter.Tag -> {
                    conditions.add("EXISTS (SELECT 1 FROM doc_tags WHERE doc_tags.id = docs.id AND doc_tags.tag = ?)")
                    arguments.add(Typo.fold(filter.value))
                }
                is SearchFilter.AtLeast -> {
                    conditions.add("docs.${if (filter.field == SearchFilter.DateField.CREATED) "created_ts" else "updated_ts"} >= ?")
                    arguments.add(filter.seconds)
                }
                is SearchFilter.Before -> {
                    conditions.add("docs.${if (filter.field == SearchFilter.DateField.CREATED) "created_ts" else "updated_ts"} < ?")
                    arguments.add(filter.seconds)
                }
            }
        }
        val filterSql = conditions.joinToString("") { " AND $it" }

        val query = SearchTerms(parsed.text)
        // Nothing to look for in the text (it was only punctuation, say): list what the filters allow, newest first.
        if (query.isEmpty) {
            return db.longs("SELECT id FROM docs WHERE 1 = 1$filterSql ORDER BY updated_ts DESC, updated_at DESC, id DESC LIMIT $RESULT_LIMIT", *arguments.toTypedArray())
        }

        val vocabulary = currentVocabulary(db)

        // Matches in the most important column first, then the next, then in any of them together (words spread over columns).
        val allowed = parsed.attributes ?: COLUMNS
        val passes = (allowed.dropLast(1).map { listOf(it) } + listOf(allowed)).map { "{" + it.joinToString(" ") + "} : " }
        val sql = """
            SELECT notes_fts.rowid FROM notes_fts JOIN docs ON docs.id = notes_fts.rowid
            WHERE notes_fts MATCH ?$filterSql
            ORDER BY docs.updated_at DESC, docs.id DESC
            LIMIT $RESULT_LIMIT
            """.trimIndent()

        val lastIsPrefix = query.endsWithWord
        // The words as typed first, then any other way of reading them (run together, or cut in two).
        val readings = listOf(query.words) + (if (query.words.isEmpty()) emptyList() else vocabulary.rewordings(query.words, lastIsPrefix))

        fun answer(rules: Typo.Rules): List<Long> {
            val found = ArrayList<Long>()
            val seen = HashSet<Long>()
            for (words in readings) {
                val expansions = words.mapIndexed { index, word -> vocabulary.expand(word, asPrefix = index == words.size - 1 && lastIsPrefix, rules = rules) }
                // All the words, then all but the last, and so on; at each, no typos first. Phrases are never dropped.
                val wordCounts = if (words.isEmpty()) listOf(0) else (words.size downTo 1).toList()
                for (count in wordCounts) {
                    val used = expansions.take(count)
                    val tiers = maxOf(used.maxOfOrNull { it.budget } ?: 0, 0)
                    var previous: List<String>? = null
                    for (tier in 0..tiers) {
                        val units = used.map { it.expression(tier) } + query.phrases.map(SearchTerms::phraseExpression)
                        if (previous == units) continue  // this tier added no new spelling to any word
                        previous = units
                        for (columns in passes) {
                            val match = columns + "(" + units.joinToString(" AND ") + ")"
                            for (id in db.longs(sql, match, *arguments.toTypedArray())) {
                                if (seen.add(id)) {
                                    found.add(id)
                                    if (found.size == RESULT_LIMIT) return found
                                }
                            }
                        }
                    }
                }
            }
            return found
        }

        val found = answer(tolerance.rules)
        // Nothing at all: read the short words as if one letter of each might be wrong, which is too noisy to do when there is
        // something to show.
        val fallback = tolerance.fallback
        if (found.isEmpty() && fallback != null) return answer(fallback)
        return found
    }

    private fun currentVocabulary(db: Db): Vocabulary =
        vocabulary.get() ?: Vocabulary(db.strings("SELECT term FROM notes_vocab")).also { vocabulary.set(it) }
}

/** What the free text of a query asks for: words, and phrases that were in double quotes. */
internal class SearchTerms(text: String) {
    val words = ArrayList<IntArray>()
    val phrases = ArrayList<List<String>>()
    /** Whether the last thing typed is a word and not a closed phrase (only then is it also matched as a prefix). */
    var endsWithWord = true
        private set

    val isEmpty get() = words.isEmpty() && phrases.isEmpty()

    init {
        var rest = text
        while (rest.isNotEmpty()) {
            val open = rest.indexOf('"')
            if (open >= 0) {
                words += Typo.words(rest.substring(0, open)).map { it.codePoints().toArray() }
                val close = rest.indexOf('"', open + 1)
                val inside = Typo.words(rest.substring(open + 1, if (close < 0) rest.length else close))
                if (inside.isNotEmpty()) {
                    phrases.add(inside)
                    endsWithWord = false
                }
                rest = if (close < 0) "" else rest.substring(close + 1)
            } else {
                val more = Typo.words(rest).map { it.codePoints().toArray() }
                words += more
                if (more.isNotEmpty()) endsWithWord = true
                rest = ""
            }
        }
    }

    companion object {
        fun phraseExpression(words: List<String>) = "\"" + words.joinToString(" ") + "\""
    }
}

/** The words in the notes, with the spellings a typed word may stand for. */
internal class Vocabulary(terms: List<String>) {
    private class Entry(val text: String, val codePoints: IntArray)

    /** A typed word's possible spellings: the words (or word starts) it may mean, each with its edit distance. */
    class Expansion(val word: String, val isPrefix: Boolean, val budget: Int, val spellings: List<Pair<String, Int>>) {
        /** The FTS5 expression for this word at up to `limit` edits: the word as typed, plus the near spellings. */
        fun expression(limit: Int): String {
            val exact = if (isPrefix) "\"$word\"*" else "\"$word\""
            if (limit <= 0) return exact
            val near = spellings.filter { it.second in 1..limit && it.first != word }.map { if (isPrefix) "\"${it.first}\"*" else "\"${it.first}\"" }
            return if (near.isEmpty()) exact else "(" + (listOf(exact) + near).joinToString(" OR ") + ")"
        }
    }

    private val entries = terms.map { Entry(it, it.codePoints().toArray()) }
    private val byLength: Map<Int, List<Int>> = entries.indices.groupBy { entries[it].codePoints.size }
    private val termSet = terms.toHashSet()
    private val sortedTerms = terms.sorted()

    private fun text(word: IntArray) = String(word, 0, word.size)

    /** Whether some note has exactly this word. */
    fun contains(word: IntArray) = text(word) in termSet

    /** Whether some note has a word beginning with this. */
    fun hasWordStartingWith(start: IntArray): Boolean {
        val prefix = text(start)
        var low = 0
        var high = sortedTerms.size
        while (low < high) {
            val middle = (low + high) / 2
            if (sortedTerms[middle] < prefix) low = middle + 1 else high = middle
        }
        return low < sortedTerms.size && sortedTerms[low].startsWith(prefix)
    }

    /**
     * Other ways to read a list of words that Meilisearch also tries: two neighbouring words run together (`postgre sql` as
     * `postgresql`), and a word cut in two (`nextjs` as `next js`). Only readings made of words the notes really have.
     */
    fun rewordings(words: List<IntArray>, lastIsPrefix: Boolean): List<List<IntArray>> {
        val variants = ArrayList<List<IntArray>>()
        val lastIndex = words.size - 1
        for (i in 0 until maxOf(words.size - 1, 0)) {
            val joined = words[i] + words[i + 1]
            if (contains(joined) || (lastIsPrefix && i + 1 == lastIndex && hasWordStartingWith(joined))) {
                variants.add(words.subList(0, i) + listOf(joined) + words.subList(i + 2, words.size))
            }
        }
        for ((i, word) in words.withIndex()) {
            if (word.size < 4) continue
            val isLast = lastIsPrefix && i == lastIndex
            if (contains(word) || (isLast && hasWordStartingWith(word))) continue  // it is a word already
            for (cut in 2..(word.size - 2)) {
                val left = word.copyOfRange(0, cut)
                val right = word.copyOfRange(cut, word.size)
                if (contains(left) && (contains(right) || (isLast && hasWordStartingWith(right)))) {
                    variants.add(words.subList(0, i) + listOf(left, right) + words.subList(i + 1, words.size))
                }
            }
        }
        return variants.take(4)
    }

    fun expand(word: IntArray, asPrefix: Boolean, rules: Typo.Rules = Typo.Rules.MEILISEARCH): Expansion {
        val budget = rules.budget(word.size)
        val first = rules.firstLetterCost
        val spellings = ArrayList<Pair<String, Int>>()
        if (budget > 0) {
            if (asPrefix) {
                // Any word at least `word.size - budget` long may begin with something near enough.
                val seenPrefixes = HashSet<String>()
                for ((length, indexes) in byLength) {
                    if (length + budget < word.size) continue
                    for (index in indexes) {
                        val entry = entries[index]
                        val near = Typo.prefixDistance(word, entry.codePoints, budget, first) ?: continue
                        val start = String(entry.codePoints, 0, near.second)
                        if (seenPrefixes.add(start)) spellings.add(start to near.first)
                    }
                }
            } else {
                for (length in maxOf(1, word.size - budget)..(word.size + budget)) {
                    for (index in byLength[length] ?: emptyList()) {
                        val entry = entries[index]
                        Typo.distance(word, entry.codePoints, budget, first)?.let { spellings.add(entry.text to it) }
                    }
                }
            }
        }
        spellings.sortWith(compareBy({ it.second }, { it.first }))
        return Expansion(text(word), asPrefix, budget, spellings)
    }
}
