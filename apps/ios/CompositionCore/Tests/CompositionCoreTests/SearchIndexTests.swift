import Foundation
import GRDB
import Testing

@testable import CompositionCore

@Suite("Search index and note lookup")
struct SearchIndexTests {
    private func insert(_ db: CompositionDatabase, _ title: String, content: String = "", tags: String = "", updated: String = "2026-01-01T00:00:00.000Z") throws -> Int64 {
        try db.pool.write { conn in
            try conn.execute(
                sql: "INSERT INTO notes (title, content, tags, description, created_at, updated_at, notebook_id) VALUES (?, ?, ?, '', ?, ?, 1)",
                arguments: [title, content, tags, updated, updated])
            return conn.lastInsertedRowID
        }
    }

    private func world(_ body: (CompositionDatabase, SearchIndex) throws -> Void) throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let index = try SearchIndex.open(at: scratch.directory.appendingPathComponent("search.db"))
            defer { try? database.close(); try? index.close() }
            try body(database, index)
        }
    }

    @Test("a note comes back whole, and a list of ids comes back in the order asked, skipping what is gone")
    func lookup() throws {
        try world { database, _ in
            let a = try insert(database, "Alpha", content: "# Alpha\n\nbody", tags: "x,y")
            let b = try insert(database, "Beta")
            let detail = try #require(try database.note(id: a))
            #expect(detail.title == "Alpha" && detail.content == "# Alpha\n\nbody" && detail.tags == "x,y" && isUuid(detail.uuid))
            #expect(try database.note(id: 999) == nil)
            #expect(try database.notes(ids: [b, 999, a]).map(\.title) == ["Beta", "Alpha"])
            #expect(try database.notes(ids: []).isEmpty)
            #expect(try database.notes(ids: Array(1...1200).map(Int64.init)).count == 2, "a long list is read in pieces")
            #expect(try database.listNotes().first { $0.id == a }?.tags == "x,y")
        }
    }

    @Test("finds a note by a word, a prefix and a typo; not by what it does not say")
    func finds() throws {
        try world { database, index in
            let docker = try insert(database, "Docker deep dive", content: "containers and images")
            _ = try insert(database, "Redis cheat sheet", content: "keys and values")
            try index.rebuild(from: database)

            #expect(try index.search("docker") == [docker])
            #expect(try index.search("dock") == [docker], "the word being typed is a prefix")
            #expect(try index.search("dokcer") == [docker], "a swapped pair is one edit")
            #expect(try index.search("images") == [docker], "the text, not only the title")
            #expect(try index.search("kubernetes").isEmpty)
            #expect(try index.search("").isEmpty)
        }
    }

    @Test("a title hit comes before a text hit, and ties go to the most recently updated")
    func order() throws {
        try world { database, index in
            let textOnly = try insert(database, "Notes", content: "all about redis", updated: "2026-03-01T00:00:00.000Z")
            let oldTitle = try insert(database, "Redis one", updated: "2026-01-01T00:00:00.000Z")
            let newTitle = try insert(database, "Redis two", updated: "2026-02-01T00:00:00.000Z")
            try index.rebuild(from: database)
            #expect(try index.search("redis") == [newTitle, oldTitle, textOnly])
        }
    }

    @Test("tag and date filters run in the index")
    func filters() throws {
        try world { database, index in
            let old = try insert(database, "Old", tags: "Infra", updated: "2025-06-01T00:00:00.000Z")
            let recent = try insert(database, "Recent", tags: "infra, web", updated: "2026-06-01T00:00:00.000Z")
            try index.rebuild(from: database)
            #expect(Set(try index.search("tag: infra")) == [old, recent], "tags ignore case")
            #expect(try index.search("tag: web") == [recent])
            #expect(try index.search("updated: >2026-01-01") == [recent])
            #expect(try index.search("created: <2026-01-01") == [old])
            #expect(try index.search("tag: nothing").isEmpty)
        }
    }

    @Test("upsert and remove change what is found")
    func incremental() throws {
        try world { database, index in
            let id = try insert(database, "Kubernetes")
            try index.rebuild(from: database)
            #expect(try index.search("kubernetes") == [id])

            try index.remove(ids: [id])
            #expect(try index.search("kubernetes").isEmpty)

            let note = try #require(try database.note(id: id))
            try index.upsert([IndexedNote(id: id, title: "Terraform", description: "", content: note.content, tags: "", createdAt: note.createdAt, updatedAt: note.updatedAt)])
            #expect(try index.search("terraform") == [id] && (try index.search("kubernetes")).isEmpty)
        }
    }

    @Test("it rebuilds when the notes changed behind its back, and not otherwise")
    func staleness() throws {
        try world { database, index in
            _ = try insert(database, "One")
            #expect(try index.rebuildIfStale(from: database), "a new index is stale")
            #expect(try !index.rebuildIfStale(from: database), "and then it is not")

            let two = try insert(database, "Two")
            #expect(try index.search("two").isEmpty, "the index has not seen it")
            #expect(try index.rebuildIfStale(from: database))
            #expect(try index.search("two") == [two])

            // A trash that the app mirrors with `remove` and `markCurrent` leaves it current.
            try database.trashNote(id: two)
            try index.remove(ids: [two])
            try index.markCurrent(with: database)
            #expect(try !index.rebuildIfStale(from: database))
            #expect(try index.search("two").isEmpty)

            // The same trash without telling the index is noticed.
            let three = try insert(database, "Three")
            try index.rebuild(from: database)
            try database.trashNote(id: three)
            #expect(try index.rebuildIfStale(from: database))
            #expect(try index.search("three").isEmpty)
        }
    }

    // MARK: Forgiving search

    private func scalars(_ text: String) -> [UInt32] { text.unicodeScalars.map(\.value) }

    @Test("the rules differ only in what a first-letter mistake costs and whether a short word gets a mistake")
    func rules() {
        // Meilisearch: a first-letter edit is 2, a swap of the first pair is 2, any other edit is 1.
        #expect(Typo.distance(scalars("dedis"), to: scalars("redis"), limit: 2) == 2)
        #expect(Typo.distance(scalars("redis"), to: scalars("redis"), limit: 2) == 0)
        #expect(Typo.distance(scalars("erdis"), to: scalars("redis"), limit: 2) == 2)
        #expect(Typo.distance(scalars("rdis"), to: scalars("redis"), limit: 2) == 1)
        // Forgiving: the same mistakes cost 1 each.
        let first = Typo.Rules.forgiving.firstLetterCost
        #expect(Typo.distance(scalars("dedis"), to: scalars("redis"), limit: 1, firstLetterCost: first) == 1)
        #expect(Typo.distance(scalars("erdis"), to: scalars("redis"), limit: 1, firstLetterCost: first) == 1)
        #expect(Typo.distance(scalars("edis"), to: scalars("redis"), limit: 1, firstLetterCost: first) == 1, "a missing first letter")
        #expect(Typo.distance(scalars("rredis"), to: scalars("redis"), limit: 1, firstLetterCost: first) == 1, "an extra first letter")
        #expect(Typo.distance(scalars("dedis"), to: scalars("redis"), limit: 1) == nil, "still two in Meilisearch's rules")
        #expect(Typo.prefixDistance(scalars("dedi"), to: scalars("redis"), limit: 1, firstLetterCost: first)?.distance == 1)

        #expect(Typo.Rules.meilisearch.budget(forLength: 4) == 0 && Typo.Rules.forgiving.budget(forLength: 4) == 0)
        #expect(Typo.Rules.forgivingFallback.budget(forLength: 3) == 1 && Typo.Rules.forgivingFallback.budget(forLength: 4) == 1)
        #expect(Typo.Rules.forgivingFallback.budget(forLength: 2) == 0, "two letters are too few to guess at")
        #expect(Typo.Rules.forgivingFallback.budget(forLength: 5) == 1 && Typo.Rules.forgivingFallback.budget(forLength: 9) == 2)
    }

    @Test("a forgiving search catches a mistake in the first letter and, when nothing else is found, in a short word")
    func forgiving() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let strict = try SearchIndex.open(at: scratch.directory.appendingPathComponent("strict.db"))
            let forgiving = try SearchIndex.open(at: scratch.directory.appendingPathComponent("forgiving.db"), tolerance: .forgiving)
            defer { try? database.close(); try? strict.close(); try? forgiving.close() }

            let redis = try insert(database, "Redis cheat sheet", content: "keys and values")
            let the = try insert(database, "Pending", content: "the cat sat")
            let cut = try insert(database, "Carpentry", content: "a clean cut")
            try strict.rebuild(from: database)
            try forgiving.rebuild(from: database)

            // The first letter: two edits in Meilisearch's rules, so beyond a five-letter word; one edit here.
            #expect(try strict.search("dedis").isEmpty)
            #expect(try forgiving.search("dedis") == [redis])
            #expect(try forgiving.search("edis") == [redis], "a missing first letter")
            #expect(try forgiving.search("redis") == [redis], "and what is spelt right is unchanged")

            // A short word: nothing at all in Meilisearch's rules, one mistake here, but only when nothing is found without.
            #expect(try strict.search("teh").isEmpty)
            #expect(try forgiving.search("teh") == [the])
            #expect(try forgiving.search("cat") == [the], "the word is in the notes, so it is not read as a mistake for `cut`")
            #expect(try forgiving.search("cut") == [cut])
            #expect(try forgiving.search("zzq").isEmpty, "and a word that is near nothing finds nothing")

            // More than one word: the fallback applies to all of them.
            #expect(try forgiving.search("teh cat") == [the])
        }
    }
}
