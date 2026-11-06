import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The Swift core against databases the desktop's own TypeScript made (docs/ipad-app-design.md, "Keeping two
// implementations honest"). The fixtures are generated, not committed (`*.db` is gitignored, and a binary in the repo
// would go stale silently):
//
//   cd apps/web && IOS_FIXTURE_DIR=/some/dir node node_modules/vitest/vitest.mjs run scripts/ios-conformance-fixtures.test.ts
//   cd apps/ios/CompositionCore && COMPOSITION_CONFORMANCE_DIR=/some/dir swift test
//
// Without the variable these tests are reported as skipped, never as passed.

private let conformanceDirectory: URL? = ProcessInfo.processInfo.environment["COMPOSITION_CONFORMANCE_DIR"]
    .map { URL(fileURLWithPath: $0, isDirectory: true) }

@Suite("Conformance with the desktop", .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct ConformanceTests {
    /// Every schema object the file declares, in a stable order: the text of each `CREATE`, which carries column order,
    /// defaults and trigger bodies. SQLite's own bookkeeping (`sqlite_sequence`) is left out.
    private func schemaObjects(_ url: URL) throws -> [String] {
        try rawConnection(url).read { db in
            try Row.fetchAll(
                db,
                sql: """
                    SELECT type, name, tbl_name, sql FROM sqlite_master
                    WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
                    """
            ).map { "\($0["type"] as String) \($0["name"] as String) on \($0["tbl_name"] as String): \($0["sql"] as String? ?? "nil")" }
        }
    }

    /// The schema and every row of every table, as text: equal dumps mean nothing was added, changed or removed.
    private func dump(_ url: URL) throws -> [String] {
        try rawConnection(url).read { db in
            var lines = try schemaObjects(url)
            let tables = try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            for table in tables {
                for row in try Row.fetchAll(db, sql: "SELECT * FROM \"\(table)\" ORDER BY rowid") {
                    lines.append("\(table): \(row)")
                }
            }
            return lines
        }
    }

    private func fixture(_ name: String) throws -> URL {
        let url = try #require(conformanceDirectory).appendingPathComponent(name)
        try #require(FileManager.default.fileExists(atPath: url.path), "missing fixture \(name)")
        return url
    }

    /// A working copy, so the fixture itself is never opened for writing.
    private func copy(_ fixture: URL, into scratch: Scratch) throws -> URL {
        try FileManager.default.copyItem(at: fixture, to: scratch.databaseURL)
        return scratch.databaseURL
    }

    @Test("a database the Swift core creates has exactly the schema the desktop creates")
    func freshSchemaMatchesDesktop() throws {
        let desktop = try schemaObjects(try fixture("desktop-empty.db"))
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            try database.close()
            let swift = try schemaObjects(scratch.databaseURL)

            #expect(!desktop.isEmpty)
            #expect(swift.count == desktop.count, "object counts differ: swift \(swift.count), desktop \(desktop.count)")
            // Object by object, so a failure names the one that differs instead of printing both schemas.
            for pair in zip(swift, desktop) where pair.0 != pair.1 {
                Issue.record("schema differs:\n  swift:   \(pair.0)\n  desktop: \(pair.1)")
                break
            }
        }
    }

    @Test("opening a populated desktop database changes nothing in it")
    func populatedDatabaseIsUntouched() throws {
        let source = try fixture("desktop-populated.db")
        try withScratch { scratch in
            let url = try copy(source, into: scratch)
            let before = try dump(url)
            #expect(before.contains { $0.hasPrefix("notes: ") }, "the fixture has notes")
            #expect(before.contains { $0.hasPrefix("trashed_notes: ") }, "the fixture has a trashed note")

            let database = try CompositionDatabase.open(at: url)
            #expect(try database.listNotes().count == 2, "Alpha and Beta are live; Gamma is in the Trash Can")
            try database.close()

            #expect(try dump(url) == before)
        }
    }

    @Test("every desktop uuid is a uuid, and none repeats across the six tables")
    func desktopUuidsAreWellFormed() throws {
        let url = try fixture("desktop-populated.db")
        let uuids: [String] = try rawConnection(url).read { db in
            try Schema.uuidTables.flatMap { try String.fetchAll(db, sql: "SELECT uuid FROM \($0)") }
        }
        #expect(uuids.count >= 6)
        #expect(uuids.allSatisfy { isUuid($0) })
        #expect(Set(uuids).count == uuids.count)
    }
}
