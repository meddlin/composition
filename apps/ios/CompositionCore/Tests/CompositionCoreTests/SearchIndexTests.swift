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
}
