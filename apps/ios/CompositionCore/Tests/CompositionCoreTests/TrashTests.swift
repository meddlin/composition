import Foundation
import GRDB
import Testing

@testable import CompositionCore

/// A database with raw-SQL helpers, since the Swift core has no notes repository yet.
private struct World {
    let database: CompositionDatabase

    @discardableResult
    func group(_ name: String, parent: Int64? = nil, notebook: Int64 = 1) throws -> Int64 {
        try database.pool.write { db in
            try db.execute(
                sql: "INSERT INTO groups (name, parent_id, notebook_id, created_at, updated_at) VALUES (?, ?, ?, 'c', 'u')",
                arguments: [name, parent, notebook])
            return db.lastInsertedRowID
        }
    }

    @discardableResult
    func note(_ title: String, group: Int64? = nil, notebook: Int64 = 1) throws -> Int64 {
        try database.pool.write { db in
            try db.execute(
                sql: """
                    INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id, notebook_id)
                    VALUES (?, ?, 'a,b', 'about \(title)', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', ?, ?)
                    """,
                arguments: [title, "# \(title)\n\nbody\n", group, notebook])
            return db.lastInsertedRowID
        }
    }

    func notebook(_ name: String) throws -> Int64 {
        try database.pool.write { db in
            try db.execute(sql: "INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, 'c', 'u')", arguments: [name])
            return db.lastInsertedRowID
        }
    }

    func uuid(_ table: String, _ id: Int64) throws -> String? {
        try database.pool.read { try String.fetchOne($0, sql: "SELECT uuid FROM \(table) WHERE id = ?", arguments: [id]) }
    }

    func value<T: DatabaseValueConvertible & StatementColumnConvertible>(_ sql: String, _ arguments: StatementArguments = []) throws -> T? {
        try database.pool.read { try T.fetchOne($0, sql: sql, arguments: arguments) }
    }

    func count(_ table: String) throws -> Int {
        try value("SELECT COUNT(*) FROM \(table)") ?? -1
    }

    /// Every row of the four tables the Trash Can moves between, for "nothing changed" checks.
    func state() throws -> [String] {
        try database.pool.read { db in
            try ["notes", "groups", "trashed_notes", "trashed_groups"].flatMap { table in
                try Row.fetchAll(db, sql: "SELECT * FROM \(table) ORDER BY id").map { "\(table): \($0)" }
            }
        }
    }
}

private func at(_ iso: String) -> Date {
    Timestamp.date(milliseconds: Timestamp.milliseconds(from: iso)!)
}

private func withWorld(_ body: (World) throws -> Void) throws {
    try withScratch { scratch in
        let database = try CompositionDatabase.open(at: scratch.databaseURL)
        defer { try? database.close() }
        try body(World(database: database))
    }
}

@Suite("Trash Can")
struct TrashTests {
    // MARK: Notes

    @Test("a deleted note leaves the notes, keeps everything, and comes back whole")
    func noteRoundTrip() throws {
        try withWorld { world in
            let group = try world.group("Projects")
            let id = try world.note("Plan", group: group)
            let uuid = try #require(try world.uuid("notes", id))

            try world.database.trashNote(id: id, now: at("2026-02-01T10:00:00.000Z"))

            #expect(try world.count("notes") == 0 && world.count("trashed_notes") == 1)
            #expect(try world.uuid("trashed_notes", id) == uuid, "the uuid goes into the trash with the note")
            #expect(try world.value("SELECT deleted_at FROM trashed_notes WHERE id = ?", [id]) == "2026-02-01T10:00:00.000Z")

            #expect(try world.database.restoreNote(id: id) == RestoreResult(restoredToTopLevel: false))
            #expect(try world.count("trashed_notes") == 0)
            let back = try #require(try world.database.pool.read { try Row.fetchOne($0, sql: "SELECT * FROM notes WHERE id = ?", arguments: [id]) })
            #expect(back["title"] as String == "Plan" && back["content"] as String == "# Plan\n\nbody\n")
            #expect(back["tags"] as String == "a,b" && back["description"] as String == "about Plan")
            #expect(back["created_at"] as String == "2026-01-01T00:00:00.000Z" && back["updated_at"] as String == "2026-01-02T00:00:00.000Z")
            #expect(back["group_id"] as Int64? == group && back["uuid"] as String? == uuid)
        }
    }

    @Test("trashing a note that is already gone is ignored")
    func trashMissingNote() throws {
        try withWorld { world in
            try world.note("Stays")
            let before = try world.state()
            try world.database.trashNote(id: 999)
            #expect(try world.state() == before)
        }
    }

    @Test("a note comes back ungrouped when its group has been deleted since, and once the group is back it goes in it")
    func noteAndItsGroup() throws {
        try withWorld { world in
            let group = try world.group("Soon gone")
            let note = try world.note("Orphaned", group: group)
            let other = try world.note("Other", group: group)
            try world.database.trashNote(id: note)
            try world.database.trashNote(id: other)
            try world.database.trashGroup(id: group)

            #expect(try world.database.restoreNote(id: note) == RestoreResult(restoredToTopLevel: true))
            #expect(try world.value("SELECT group_id FROM notes WHERE id = ?", [note]) as Int64? == nil)

            #expect(try world.database.restoreGroup(id: group) == RestoreResult(restoredToTopLevel: false))
            #expect(try world.database.restoreNote(id: other) == RestoreResult(restoredToTopLevel: false))
            #expect(try world.value("SELECT group_id FROM notes WHERE id = ?", [other]) == group)
        }
    }

    @Test("restoring something not in the Trash Can is nil, and purging it does nothing")
    func notInTrash() throws {
        try withWorld { world in
            let id = try world.note("Live")
            let before = try world.state()
            #expect(try world.database.restoreNote(id: 999) == nil && world.database.restoreGroup(id: 999) == nil)
            #expect(try world.database.restoreNote(id: id) == nil, "a live note is not in the trash")
            try world.database.purgeNote(id: id)
            try world.database.purgeGroup(id: 999)
            #expect(try world.state() == before)
        }
    }

    // MARK: Groups

    @Test("a group comes back under its parent, or at the top level once the parent is gone")
    func groupParents() throws {
        try withWorld { world in
            let parent = try world.group("Parent")
            let child = try world.group("Child", parent: parent)
            try world.database.trashGroup(id: child)
            #expect(try world.database.restoreGroup(id: child) == RestoreResult(restoredToTopLevel: false))
            #expect(try world.value("SELECT parent_id FROM groups WHERE id = ?", [child]) == parent)

            try world.database.trashGroup(id: child)
            try world.database.trashGroup(id: parent)
            #expect(try world.database.restoreGroup(id: child) == RestoreResult(restoredToTopLevel: true))
            #expect(try world.value("SELECT parent_id FROM groups WHERE id = ?", [child]) as Int64? == nil)
        }
    }

    @Test("a group with a note or a sub-group is not trashed, and nothing changes")
    func nonEmptyGroup() throws {
        try withWorld { world in
            let withNote = try world.group("Has a note")
            try world.note("Inside", group: withNote)
            let withChild = try world.group("Has a child")
            try world.group("Child", parent: withChild)
            let before = try world.state()

            #expect(throws: TrashError.groupNotEmpty(withNote)) { try world.database.trashGroup(id: withNote) }
            #expect(throws: TrashError.groupNotEmpty(withChild)) { try world.database.trashGroup(id: withChild) }
            #expect(try world.state() == before)
            #expect(TrashError.groupNotEmpty(7).errorDescription == "Group 7 still has sub-groups or notes; empty it before deleting.")
        }
    }

    // MARK: The list, and leaving it

    @Test("the list is most recently deleted first, ties by the higher id, and says when each expires")
    func listing() throws {
        try withWorld { world in
            let first = try world.note("First"), second = try world.note("Second"), third = try world.note("Third")
            let group = try world.group("G")
            try world.database.trashNote(id: first, now: at("2026-01-01T00:00:00.000Z"))
            try world.database.trashNote(id: second, now: at("2026-01-03T00:00:00.000Z"))
            try world.database.trashNote(id: third, now: at("2026-01-03T00:00:00.000Z"))
            try world.database.trashGroup(id: group, now: at("2026-01-02T00:00:00.000Z"))

            let trash = try world.database.listTrash()
            #expect(trash.notes.map(\.title) == ["Third", "Second", "First"])
            #expect(trash.notes.map(\.expiresAt) == ["2026-03-04T00:00:00.000Z", "2026-03-04T00:00:00.000Z", "2026-03-02T00:00:00.000Z"])
            #expect(trash.groups == [TrashedGroup(id: group, name: "G", deletedAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-03-03T00:00:00.000Z")])
        }
    }

    @Test("an item is deleted for good on request")
    func purge() throws {
        try withWorld { world in
            let note = try world.note("Gone"), group = try world.group("Gone too")
            try world.database.trashNote(id: note)
            try world.database.trashGroup(id: group)
            try world.database.purgeNote(id: note)
            try world.database.purgeGroup(id: group)
            #expect(try world.count("trashed_notes") == 0 && world.count("trashed_groups") == 0)
            #expect(try world.database.restoreNote(id: note) == nil)
        }
    }

    @Test("items older than 60 days are deleted for good; one exactly 60 days old, and newer ones, are kept")
    func purgeExpired() throws {
        try withWorld { world in
            let now = "2026-03-02T12:00:00.000Z"  // 60 days back is 2026-01-01T12:00:00.000Z
            let old = try world.note("Old"), edge = try world.note("Edge"), recent = try world.note("Recent")
            let oldGroup = try world.group("Old group"), edgeGroup = try world.group("Edge group")
            try world.database.trashNote(id: old, now: at("2026-01-01T11:59:59.999Z"))
            try world.database.trashNote(id: edge, now: at("2026-01-01T12:00:00.000Z"))
            try world.database.trashNote(id: recent, now: at("2026-03-01T00:00:00.000Z"))
            try world.database.trashGroup(id: oldGroup, now: at("2026-01-01T11:59:59.999Z"))
            try world.database.trashGroup(id: edgeGroup, now: at("2026-01-01T12:00:00.000Z"))

            try world.database.purgeExpired(now: at(now))

            let trash = try world.database.listTrash()
            #expect(trash.notes.map(\.title).sorted() == ["Edge", "Recent"])
            #expect(trash.groups.map(\.name) == ["Edge group"])
        }
    }

    @Test("the retention window is 60 days, counted in whole days left, rounding up and never negative")
    func retention() {
        #expect(TrashRetention.days == 60)
        #expect(TrashRetention.expiry(of: "2026-01-01T00:00:00.000Z") == "2026-03-02T00:00:00.000Z")
        #expect(TrashRetention.expiry(of: "2024-01-01T00:00:00.000Z") == "2024-03-01T00:00:00.000Z", "2024 has a 29th of February")
        #expect(TrashRetention.expiry(of: "not a date") == nil)
        #expect(TrashRetention.cutoff(now: at("2026-03-02T12:00:00.000Z")) == "2026-01-01T12:00:00.000Z")
        let now = at("2026-01-10T00:00:00.000Z")
        #expect(TrashRetention.daysLeft(expiresAt: "2026-01-10T00:00:00.000Z", now: now) == 0)
        #expect(TrashRetention.daysLeft(expiresAt: "2026-01-10T00:00:00.001Z", now: now) == 1, "a partly used day still counts")
        #expect(TrashRetention.daysLeft(expiresAt: "2026-01-13T00:00:00.000Z", now: now) == 3)
        #expect(TrashRetention.daysLeft(expiresAt: "2026-01-01T00:00:00.000Z", now: now) == 0, "never negative")
    }

    // MARK: Notebooks

    @Test("an item comes back in its group's notebook; failing that its own; failing that the first notebook")
    func notebooks() throws {
        try withWorld { world in
            let work = try world.notebook("Work")
            let group = try world.group("In work", notebook: work)
            let inGroup = try world.note("Grouped", group: group, notebook: work)
            let loose = try world.note("Loose", notebook: work)
            try world.database.trashNote(id: inGroup)
            try world.database.trashNote(id: loose)

            #expect(try world.database.restoreNote(id: inGroup) != nil)
            #expect(try world.value("SELECT notebook_id FROM notes WHERE id = ?", [inGroup]) == work, "the group's notebook")
            #expect(try world.database.restoreNote(id: loose) != nil)
            #expect(try world.value("SELECT notebook_id FROM notes WHERE id = ?", [loose]) == work, "its own notebook, still there")

            try world.database.trashNote(id: loose)
            try world.database.pool.write { try $0.execute(sql: "DELETE FROM notebooks WHERE id = ?", arguments: [work]) }
            #expect(try world.database.restoreNote(id: loose) != nil)
            #expect(try world.value("SELECT notebook_id FROM notes WHERE id = ?", [loose]) == 1, "the first notebook")
        }
    }

    @Test("with no notebook left there is nowhere to restore to, and the item stays in the Trash Can")
    func noNotebooks() throws {
        try withWorld { world in
            let id = try world.note("Stranded")
            try world.database.trashNote(id: id)
            try world.database.pool.write { try $0.execute(sql: "DELETE FROM notebooks") }
            #expect(throws: TrashError.noNotebooks) { try world.database.restoreNote(id: id) }
            #expect(try world.count("trashed_notes") == 1 && world.count("notes") == 0)
        }
    }

    // MARK: Ids and uuids

    @Test("a restored group keeps its uuid through the trash and back")
    func groupUuid() throws {
        try withWorld { world in
            let id = try world.group("Round trip")
            let uuid = try #require(try world.uuid("groups", id))
            try world.database.trashGroup(id: id)
            #expect(try world.uuid("trashed_groups", id) == uuid)
            #expect(try world.database.restoreGroup(id: id) == RestoreResult(restoredToTopLevel: false))
            #expect(try world.uuid("groups", id) == uuid)
        }
    }

    @Test("a note keeps its uuid when its group is gone and it comes back at the top level")
    func uuidWithoutGroup() throws {
        try withWorld { world in
            let group = try world.group("Soon gone")
            let id = try world.note("Orphaned", group: group)
            let uuid = try #require(try world.uuid("notes", id))
            try world.database.trashNote(id: id)
            try world.database.trashGroup(id: group)
            #expect(try world.database.restoreNote(id: id) == RestoreResult(restoredToTopLevel: true))
            #expect(try world.uuid("notes", id) == uuid)
        }
    }

    @Test("a note keeps its uuid when its id has been taken, and comes back under a new id")
    func idTaken() throws {
        try withWorld { world in
            let id = try world.note("Clash")
            let uuid = try #require(try world.uuid("notes", id))
            try world.database.trashNote(id: id)
            try world.database.pool.write {
                try $0.execute(sql: "INSERT INTO notes (id, title, created_at, updated_at, notebook_id) VALUES (?, 'Squatter', 'x', 'x', 1)", arguments: [id])
            }

            #expect(try world.database.restoreNote(id: id) != nil)

            let newId: Int64 = try #require(try world.value("SELECT id FROM notes WHERE title = 'Clash'"))
            #expect(newId != id)
            #expect(try world.uuid("notes", newId) == uuid)
            #expect(try world.count("trashed_notes") == 0)
        }
    }

    @Test("a note gets a new uuid if another live note already holds its own")
    func uuidHeld() throws {
        try withWorld { world in
            let id = try world.note("Duplicate")
            let uuid = try #require(try world.uuid("notes", id))
            try world.database.trashNote(id: id)
            try world.database.pool.write {
                try $0.execute(sql: "INSERT INTO notes (title, uuid, created_at, updated_at, notebook_id) VALUES ('Holder', ?, 'x', 'x', 1)", arguments: [uuid])
            }

            #expect(try world.database.restoreNote(id: id) != nil)

            let restored = try #require(try world.uuid("notes", id))
            #expect(isUuid(restored) && restored != uuid)
            #expect(try world.count("trashed_notes") == 0)
        }
    }

    @Test("a trashed row from an older desktop build, with no uuid, comes back with a fresh one")
    func trashedRowWithoutUuid() throws {
        try withWorld { world in
            try world.database.pool.write {
                try $0.execute(sql: """
                    INSERT INTO trashed_notes (id, uuid, title, created_at, updated_at, deleted_at, notebook_id)
                    VALUES (77, NULL, 'Old build', 'x', 'x', '2026-01-01T00:00:00.000Z', 1)
                    """)
            }
            #expect(try world.database.restoreNote(id: 77) != nil)
            #expect(isUuid(try world.uuid("notes", 77)))
        }
    }

    @Test("ids are never reused after a purge")
    func idsAreNeverReused() throws {
        try withWorld { world in
            let first = try world.note("First")
            try world.database.trashNote(id: first)
            try world.database.purgeNote(id: first)
            let second = try world.note("Second")
            #expect(second > first, "AUTOINCREMENT keeps counting past a purged id")
        }
    }
}

@Suite("Timestamp")
struct TimestampTests {
    @Test("writes the toISOString form, and reads it back to the same millisecond")
    func roundTrip() {
        #expect(Timestamp.string(milliseconds: 0) == "1970-01-01T00:00:00.000Z")
        #expect(Timestamp.string(milliseconds: 951_782_400_000 + 86_399_999) == "2000-02-29T23:59:59.999Z")
        #expect(Timestamp.string(milliseconds: -1) == "1969-12-31T23:59:59.999Z")
        #expect(Timestamp.milliseconds(from: "2024-02-29T12:30:45.678Z") == 1_709_209_845_678)
        for _ in 0..<20_000 {
            let ms = Int64.random(in: -11_000_000_000_000...253_402_300_799_999)  // 1621 to 9999
            let text = Timestamp.string(milliseconds: ms)
            #expect(text.utf8.count == 24)
            #expect(Timestamp.milliseconds(from: text) == ms, "\(text)")
        }
    }

    @Test("agrees with Foundation's calendar on the date and time of day")
    func againstFoundation() {
        let oracle = ISO8601DateFormatter()  // whole seconds, UTC
        for _ in 0..<5000 {
            let seconds = Int64.random(in: -11_000_000_000...253_402_300_799)
            let ms = Int64.random(in: 0..<1000)
            let ours = Timestamp.string(milliseconds: seconds * 1000 + ms)
            #expect(String(ours.prefix(19)) + "Z" == oracle.string(from: Date(timeIntervalSince1970: Double(seconds))), "\(ours)")
            #expect(String(ours.suffix(5)) == String(format: ".%03dZ", Int(ms)))
        }
    }

    @Test("refuses anything that is not exactly that form, and dates that do not exist")
    func refuses() {
        for text in [
            "2026-01-01T00:00:00Z", "2026-01-01 00:00:00.000Z", "2026-01-01t00:00:00.000Z", "2026-01-01T00:00:00.000", "",
            "2026-13-01T00:00:00.000Z", "2026-00-10T00:00:00.000Z", "2026-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z",
            "2026-01-01T24:00:00.000Z", "2026-01-01T00:60:00.000Z", "2026-01-01T00:00:60.000Z", "2026-01-01T00:00:00.00aZ",
            "2026-01-01T00:00:00.000+0100",
        ] {
            #expect(Timestamp.milliseconds(from: text) == nil, "\(text)")
        }
        #expect(Timestamp.milliseconds(from: "2024-02-29T00:00:00.000Z") != nil, "a real leap day")
    }

    @Test("a date made from whole milliseconds writes the same milliseconds back")
    func throughDate() {
        for _ in 0..<5000 {
            let ms = Int64.random(in: 0...4_000_000_000_000)
            #expect(Timestamp.milliseconds(of: Timestamp.date(milliseconds: ms)) == ms)
        }
    }
}
