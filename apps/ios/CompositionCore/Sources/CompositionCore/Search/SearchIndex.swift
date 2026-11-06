import Foundation
import GRDB
import os

// Full-text search with typo tolerance, over SQLite FTS5: the iPad's replacement for the Meilisearch the desktop runs
// (spike S2, docs/ipad-app-design.md). The behaviour to match is `searchIndex.ts` with a real Meilisearch behind it.
//
// The index is a file of its own, never part of `composition.db`: it is derived data that can be thrown away and rebuilt,
// it must not change the schema the desktop shares, and a backup should not carry it. (An FTS5 table that reads its text
// from `notes` cannot live in another file, so this one keeps its own copy of the text.)
//
// How a query is answered, which is what Meilisearch's ranking comes to for this kind of data:
//   1. The text becomes words. Each is expanded to the words in the notes within its typo budget; the last one, being typed,
//      also matches as the start of a longer word.
//   2. Notes matching all the words come first, then notes matching all but the last word, and so on (Meilisearch's
//      "last" matching strategy). Within those, notes matched with no typos before one typo before two.
//   3. Within each of those groups, notes matching in the title come before notes matching in the text, and the rest are
//      in the order the desktop indexes them: most recently updated first. That is what Meilisearch comes to (its ranking
//      rules ignore how often a word occurs, which is why bm25 is not used); where it also orders by how early in the text
//      a word appears, in coarse steps that could not be derived from its documentation, this does not.
//
// How forgiving step 1 is can be chosen (`SearchTolerance`). The default reproduces Meilisearch, which is what the
// conformance tests hold it to; the iPad app asks for the forgiving one, which Meilisearch cannot be compared against.

/// A note as the index needs it: the columns of `notes`.
public struct IndexedNote: Equatable, Sendable {
    public var id: Int64
    public var title: String
    public var description: String
    public var content: String
    /// Comma-joined, the way the database stores them.
    public var tags: String
    public var createdAt: String
    public var updatedAt: String

    public init(id: Int64, title: String, description: String, content: String, tags: String, createdAt: String, updatedAt: String) {
        (self.id, self.title, self.description, self.content, self.tags, self.createdAt, self.updatedAt) =
            (id, title, description, content, tags, createdAt, updatedAt)
    }
}

/// How forgiving a search is of mistakes in what was typed.
public enum SearchTolerance: Sendable {
    /// Exactly Meilisearch's rules, as the desktop searches: no mistakes up to 4 letters, one up to 8, two beyond; a wrong,
    /// missing or extra first letter counts as two. This is what the conformance tests check.
    case matchesMeilisearch
    /// More forgiving, for a keyboard that is easy to mistype on: a first-letter mistake counts as one, like any other, and
    /// when a search finds nothing it is repeated allowing one mistake in words of 3 and 4 letters (`teh` for `the`).
    case forgiving

    var rules: Typo.Rules { self == .forgiving ? .forgiving : .meilisearch }
    /// What to try when `rules` found nothing, if anything.
    var fallback: Typo.Rules? { self == .forgiving ? .forgivingFallback : nil }
}

public final class SearchIndex: Sendable {
    /// The most results a search returns, as on the desktop.
    public static let resultLimit = 50

    /// The columns, most important first: the order Meilisearch's searchableAttributes put them in.
    static let columns = ["title", "content", "description"]

    private let pool: DatabasePool
    private let tolerance: SearchTolerance
    private let vocabulary = OSAllocatedUnfairLock<Vocabulary?>(initialState: nil)

    /// Opens (creating if needed) the index file at `url`.
    public static func open(at url: URL, tolerance: SearchTolerance = .matchesMeilisearch) throws -> SearchIndex {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let pool = try DatabasePool(path: url.path)
        try pool.writeWithoutTransaction { db in
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, created_ts INTEGER NOT NULL, updated_ts INTEGER NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS doc_tags (id INTEGER NOT NULL, tag TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS idx_doc_tags ON doc_tags (tag, id);
                CREATE INDEX IF NOT EXISTS idx_doc_tags_id ON doc_tags (id);
                CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                    title, content, description, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4');
                CREATE VIRTUAL TABLE IF NOT EXISTS notes_vocab USING fts5vocab(notes_fts, 'row');
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                """)
        }
        return SearchIndex(pool: pool, tolerance: tolerance)
    }

    private init(pool: DatabasePool, tolerance: SearchTolerance) {
        (self.pool, self.tolerance) = (pool, tolerance)
    }

    public func close() throws { try pool.close() }

    // MARK: Keeping it in step

    /// Rebuilds the index if it was not built from the notes as they are now (it is new, or the notes changed some way other
    /// than through `upsert` and `remove`, such as a restore). Returns whether it rebuilt.
    @discardableResult
    public func rebuildIfStale(from database: CompositionDatabase) throws -> Bool {
        let current = try database.notesFingerprint()
        let stored = try pool.read { try String.fetchOne($0, sql: "SELECT value FROM meta WHERE key = 'notes'") }
        guard stored != current else { return false }
        try rebuild(from: database)
        return true
    }

    /// Whether the index was built from the notes as they are now: nothing has changed them behind its back since the last
    /// `rebuild` or `markCurrent`.
    public func isCurrent(with database: CompositionDatabase) throws -> Bool {
        let current = try database.notesFingerprint()
        let stored = try pool.read { try String.fetchOne($0, sql: "SELECT value FROM meta WHERE key = 'notes'") }
        return stored == current
    }

    /// Records that the index now matches `database`: call it after `upsert` or `remove` has made it so, or the next
    /// `rebuildIfStale` will think the notes changed behind its back.
    public func markCurrent(with database: CompositionDatabase) throws {
        let current = try database.notesFingerprint()
        try pool.write { try $0.execute(sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('notes', ?)", arguments: [current]) }
    }

    /// Empties the index and fills it from every note in `database`.
    public func rebuild(from database: CompositionDatabase) throws {
        let fingerprint = try database.notesFingerprint()
        let notes = try database.pool.read { db in
            try Row.fetchAll(db, sql: "SELECT id, title, description, content, tags, created_at, updated_at FROM notes ORDER BY id").map {
                IndexedNote(id: $0["id"], title: $0["title"], description: $0["description"], content: $0["content"], tags: $0["tags"], createdAt: $0["created_at"], updatedAt: $0["updated_at"])
            }
        }
        try pool.write { db in
            try db.execute(sql: "DELETE FROM notes_fts; DELETE FROM docs; DELETE FROM doc_tags;")
            try Self.insert(notes, db)
            try db.execute(sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('notes', ?)", arguments: [fingerprint])
        }
        vocabulary.withLock { $0 = nil }
    }

    /// Adds or replaces these notes.
    public func upsert(_ notes: [IndexedNote]) throws {
        try pool.write { db in
            try Self.delete(notes.map(\.id), db)
            try Self.insert(notes, db)
        }
        vocabulary.withLock { $0 = nil }
    }

    /// Removes these notes (trashed or deleted).
    public func remove(ids: [Int64]) throws {
        try pool.write { try Self.delete(ids, $0) }
        vocabulary.withLock { $0 = nil }
    }

    private static func delete(_ ids: [Int64], _ db: Database) throws {
        for id in ids {
            try db.execute(sql: "DELETE FROM notes_fts WHERE rowid = ?", arguments: [id])
            try db.execute(sql: "DELETE FROM docs WHERE id = ?", arguments: [id])
            try db.execute(sql: "DELETE FROM doc_tags WHERE id = ?", arguments: [id])
        }
    }

    private static func insert(_ notes: [IndexedNote], _ db: Database) throws {
        let fts = try db.makeStatement(sql: "INSERT INTO notes_fts (rowid, title, content, description) VALUES (?, ?, ?, ?)")
        let doc = try db.makeStatement(sql: "INSERT INTO docs (id, created_ts, updated_ts, updated_at) VALUES (?, ?, ?, ?)")
        let tag = try db.makeStatement(sql: "INSERT INTO doc_tags (id, tag) VALUES (?, ?)")
        for note in notes {
            try fts.execute(arguments: [note.id, note.title, note.content, note.description])
            try doc.execute(arguments: [note.id, seconds(note.createdAt), seconds(note.updatedAt), note.updatedAt])
            // The desktop's `tagsFromString`: split on commas, trim, drop empties. Matched without regard to case or accents.
            for name in note.tags.split(separator: ",", omittingEmptySubsequences: false)
            .map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }) where !name.isEmpty {
                try tag.execute(arguments: [note.id, Typo.fold(name)])
            }
        }
    }

    /// `Math.floor(new Date(iso).getTime() / 1000)`
    private static func seconds(_ iso: String) -> Int64 {
        Timestamp.milliseconds(from: iso).map { Int64((Double($0) / 1000).rounded(.down)) } ?? 0
    }

    // MARK: Searching

    /// The ids of the notes matching `query`, best first, at most `resultLimit`. The query may mix free text with
    /// `field: value` filters (`SearchQueryParser`). A query with neither matches nothing.
    public func search(_ query: String) throws -> [Int64] {
        let parsed = SearchQueryParser.parse(query)
        if parsed.text.isEmpty && parsed.filters.isEmpty { return [] }
        return try pool.read { db in try self.search(parsed, db) }
    }

    private func search(_ parsed: ParsedSearchQuery, _ db: Database) throws -> [Int64] {
        var conditions: [String] = []
        var arguments: [any DatabaseValueConvertible] = []
        for filter in parsed.filters {
            switch filter {
            case .tag(let value):
                conditions.append("EXISTS (SELECT 1 FROM doc_tags WHERE doc_tags.id = docs.id AND doc_tags.tag = ?)")
                arguments.append(Typo.fold(value))
            case .atLeast(let field, let seconds):
                conditions.append("docs.\(field == .created ? "created_ts" : "updated_ts") >= ?")
                arguments.append(seconds)
            case .before(let field, let seconds):
                conditions.append("docs.\(field == .created ? "created_ts" : "updated_ts") < ?")
                arguments.append(seconds)
            }
        }
        let filterSQL = conditions.map { " AND \($0)" }.joined()

        let query = SearchTerms(parsed.text)
        // Nothing to look for in the text (it was only punctuation, say): list what the filters allow, newest first.
        guard !query.isEmpty else {
            return try Int64.fetchAll(
                db, sql: "SELECT id FROM docs WHERE 1 = 1\(filterSQL) ORDER BY updated_ts DESC, updated_at DESC, id DESC LIMIT \(Self.resultLimit)",
                arguments: StatementArguments(arguments))
        }

        let vocabulary = try currentVocabulary(db)

        // Matches in the most important column first, then the next, then in any of them together (words spread over columns).
        let allowed = parsed.attributes ?? Self.columns
        let passes = (allowed.dropLast().map { [$0] } + [allowed]).map { "{" + $0.joined(separator: " ") + "} : " }
        let sql = """
            SELECT notes_fts.rowid FROM notes_fts JOIN docs ON docs.id = notes_fts.rowid
            WHERE notes_fts MATCH ?\(filterSQL)
            ORDER BY docs.updated_at DESC, docs.id DESC
            LIMIT \(Self.resultLimit)
            """

        let lastIsPrefix = query.endsWithWord
        // The words as typed first, then any other way of reading them (run together, or cut in two).
        let readings = [query.words] + (query.words.isEmpty ? [] : vocabulary.rewordings(of: query.words, lastIsPrefix: lastIsPrefix))

        func answer(_ rules: Typo.Rules) throws -> [Int64] {
            var found: [Int64] = []
            var seen = Set<Int64>()
            for words in readings {
                let expansions = words.enumerated().map { index, word in
                    vocabulary.expand(word, asPrefix: index == words.count - 1 && lastIsPrefix, rules: rules)
                }
                // All the words, then all but the last, and so on; at each, no typos first. Phrases are never dropped.
                let wordCounts = words.isEmpty ? [0] : Array((1...words.count).reversed())
                for count in wordCounts {
                    let used = Array(expansions.prefix(count))
                    let tiers = max(used.map(\.budget).max() ?? 0, 0)
                    var previous: [String]?
                    for tier in 0...tiers {
                        let units = used.map { $0.expression(upToDistance: tier) } + query.phrases.map { SearchTerms.phraseExpression($0) }
                        guard previous != units else { continue }  // this tier added no new spelling to any word
                        previous = units
                        for columns in passes {
                            let match = columns + "(" + units.joined(separator: " AND ") + ")"
                            let ids = try Int64.fetchAll(db, sql: sql, arguments: StatementArguments([match] + arguments))
                            for id in ids where seen.insert(id).inserted {
                                found.append(id)
                                if found.count == Self.resultLimit { return found }
                            }
                        }
                    }
                }
            }
            return found
        }

        let found = try answer(tolerance.rules)
        // Nothing at all: read the short words as if one letter of each might be wrong, which is too noisy to do when
        // there is something to show.
        if found.isEmpty, let fallback = tolerance.fallback { return try answer(fallback) }
        return found
    }

    /// The words in the notes, read from the index once and kept until it changes.
    private func currentVocabulary(_ db: Database) throws -> Vocabulary {
        if let cached = vocabulary.withLock({ $0 }) { return cached }
        let built = Vocabulary(terms: try String.fetchAll(db, sql: "SELECT term FROM notes_vocab"))
        vocabulary.withLock { $0 = built }
        return built
    }
}

/// What the free text of a query asks for: words, and phrases that were in double quotes.
struct SearchTerms {
    var words: [[UInt32]] = []
    var phrases: [[String]] = []
    /// Whether the last thing typed is a word and not a closed phrase (only then is it also matched as a prefix).
    var endsWithWord = true

    var isEmpty: Bool { words.isEmpty && phrases.isEmpty }

    init(_ text: String) {
        var rest = Substring(text)
        while !rest.isEmpty {
            if let open = rest.firstIndex(of: "\"") {
                words += Typo.words(in: String(rest[..<open])).map { Array($0.unicodeScalars.map(\.value)) }
                let afterOpen = rest.index(after: open)
                let close = rest[afterOpen...].firstIndex(of: "\"")
                let inside = Typo.words(in: String(rest[afterOpen..<(close ?? rest.endIndex)]))
                if !inside.isEmpty {
                    phrases.append(inside)
                    endsWithWord = false
                }
                rest = close.map { rest[rest.index(after: $0)...] } ?? ""
            } else {
                let more = Typo.words(in: String(rest)).map { Array($0.unicodeScalars.map(\.value)) }
                words += more
                if !more.isEmpty { endsWithWord = true }
                rest = ""
            }
        }
    }

    static func phraseExpression(_ words: [String]) -> String { "\"" + words.joined(separator: " ") + "\"" }
}

/// The words in the notes, with the spellings a typed word may stand for.
final class Vocabulary: Sendable {
    private struct Entry: Sendable {
        let text: String
        let scalars: [UInt32]
    }

    /// A typed word's possible spellings: the words (or word starts) it may mean, each with its edit distance.
    struct Expansion {
        let word: String
        let isPrefix: Bool
        let budget: Int
        /// Spellings with their distance, nearest first. For a prefix, each is the start of a word.
        let spellings: [(text: String, distance: Int)]

        /// The FTS5 expression for this word at up to `distance` edits: the word as typed, plus the near spellings.
        func expression(upToDistance limit: Int) -> String {
            let exact = isPrefix ? "\"\(word)\"*" : "\"\(word)\""
            guard limit > 0 else { return exact }
            let near = spellings.filter { $0.distance > 0 && $0.distance <= limit && $0.text != word }
                .map { isPrefix ? "\"\($0.text)\"*" : "\"\($0.text)\"" }
            return near.isEmpty ? exact : "(" + ([exact] + near).joined(separator: " OR ") + ")"
        }
    }

    private let entries: [Entry]
    private let byLength: [Int: [Int]]
    private let terms: Set<String>
    private let sortedTerms: [String]

    init(terms: [String]) {
        self.terms = Set(terms)
        sortedTerms = terms.sorted()
        entries = terms.map { Entry(text: $0, scalars: $0.unicodeScalars.map(\.value)) }
        var lengths: [Int: [Int]] = [:]
        for (index, entry) in entries.enumerated() { lengths[entry.scalars.count, default: []].append(index) }
        byLength = lengths
    }

    private func text(_ word: [UInt32]) -> String { String(String.UnicodeScalarView(word.compactMap(Unicode.Scalar.init))) }

    /// Whether some note has exactly this word.
    func contains(_ word: [UInt32]) -> Bool { terms.contains(text(word)) }

    /// Whether some note has a word beginning with this.
    func hasWord(startingWith start: [UInt32]) -> Bool {
        let prefix = text(start)
        var low = 0, high = sortedTerms.count
        while low < high {
            let middle = (low + high) / 2
            if sortedTerms[middle] < prefix { low = middle + 1 } else { high = middle }
        }
        return low < sortedTerms.count && sortedTerms[low].hasPrefix(prefix)
    }

    /// Other ways to read a list of words that Meilisearch also tries: two neighbouring words run together (`postgre sql`
    /// as `postgresql`), and a word cut in two (`nextjs` as `next js`). Only readings made of words the notes really have.
    func rewordings(of words: [[UInt32]], lastIsPrefix: Bool) -> [[[UInt32]]] {
        var variants: [[[UInt32]]] = []
        let lastIndex = words.count - 1
        for i in 0..<max(words.count - 1, 0) {
            let joined = words[i] + words[i + 1]
            if contains(joined) || (lastIsPrefix && i + 1 == lastIndex && hasWord(startingWith: joined)) {
                variants.append(Array(words[..<i]) + [joined] + Array(words[(i + 2)...]))
            }
        }
        for (i, word) in words.enumerated() where word.count >= 4 {
            let isLast = lastIsPrefix && i == lastIndex
            if contains(word) || (isLast && hasWord(startingWith: word)) { continue }  // it is a word already
            for cut in 2...(word.count - 2) {
                let left = Array(word[..<cut]), right = Array(word[cut...])
                if contains(left), contains(right) || (isLast && hasWord(startingWith: right)) {
                    variants.append(Array(words[..<i]) + [left, right] + Array(words[(i + 1)...]))
                }
            }
        }
        return Array(variants.prefix(4))
    }

    func expand(_ word: [UInt32], asPrefix: Bool, rules: Typo.Rules = .meilisearch) -> Expansion {
        let text = String(String.UnicodeScalarView(word.compactMap(Unicode.Scalar.init)))
        let budget = rules.budget(forLength: word.count)
        let first = rules.firstLetterCost
        var spellings: [(text: String, distance: Int)] = []
        if budget > 0 {
            if asPrefix {
                // Any word at least `word.count - budget` long may begin with something near enough.
                var seenPrefixes = Set<String>()
                for (length, indexes) in byLength where length + budget >= word.count {
                    for index in indexes {
                        let entry = entries[index]
                        guard let near = Typo.prefixDistance(word, to: entry.scalars, limit: budget, firstLetterCost: first) else { continue }
                        let start = String(String.UnicodeScalarView(entry.scalars.prefix(near.prefixLength).compactMap(Unicode.Scalar.init)))
                        if seenPrefixes.insert(start).inserted { spellings.append((start, near.distance)) }
                    }
                }
            } else {
                for length in max(1, word.count - budget)...(word.count + budget) {
                    for index in byLength[length] ?? [] {
                        let entry = entries[index]
                        if let distance = Typo.distance(word, to: entry.scalars, limit: budget, firstLetterCost: first) { spellings.append((entry.text, distance)) }
                    }
                }
            }
        }
        spellings.sort { ($0.distance, $0.text) < ($1.distance, $1.text) }
        return Expansion(word: text, isPrefix: asPrefix, budget: budget, spellings: spellings)
    }
}
