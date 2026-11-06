import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The Swift Trash Can against the desktop's real `trashRepo.ts`. Both run the steps in apps/ios/conformance/trash-script.json
// against the same starting database (trash-start.db, built by the TypeScript with the real repos). After every step the
// TypeScript recorded the result and every row of notes, groups, trashed_notes, trashed_groups and sqlite_sequence
// (trash-script.expected.json); Swift records the same and the two must be equal. See ConformanceTests.swift for how to run.

private struct Step: Decodable {
    let op: String
    let id: Int64?
    let at: String?
    let now: String?
    let sql: String?
}

private struct Recorded: Decodable {
    let op: String
    let result: JSON
    let dump: JSON
}

@Suite("Trash Can against the desktop", .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct TrashConformanceTests {
    private func date(_ iso: String?) throws -> Date {
        Timestamp.date(milliseconds: try #require(iso.flatMap(Timestamp.milliseconds(from:)), "bad time in the script: \(iso ?? "nil")"))
    }

    private func dump(_ db: CompositionDatabase) throws -> JSON {
        try db.pool.read { db in
            var tables: [String: JSON] = [:]
            for table in ["notes", "groups", "trashed_notes", "trashed_groups"] {
                tables[table] = .array(try Row.fetchAll(db, sql: "SELECT * FROM \(table) ORDER BY id").map(JSON.init))
            }
            tables["sqlite_sequence"] = .array(try Row.fetchAll(db, sql: "SELECT name, seq FROM sqlite_sequence ORDER BY name").map(JSON.init))
            return .object(tables)
        }
    }

    private func run(_ step: Step, on database: CompositionDatabase) throws -> JSON {
        func note(_ value: RestoreResult?) -> JSON {
            value.map { .object(["restoredToTopLevel": .bool($0.restoredToTopLevel)]) } ?? .null
        }
        let id = step.id ?? 0
        switch step.op {
        case "trashNote": try database.trashNote(id: id, now: try date(step.at)); return .null
        case "trashGroup":
            do { try database.trashGroup(id: id, now: try date(step.at)); return .null }
            catch TrashError.groupNotEmpty { return .object(["error": .string("groupNotEmpty")]) }
        case "restoreNote": return note(try database.restoreNote(id: id))
        case "restoreGroup": return note(try database.restoreGroup(id: id))
        case "purgeNote": try database.purgeNote(id: id); return .null
        case "purgeGroup": try database.purgeGroup(id: id); return .null
        case "purgeExpired": try database.purgeExpired(now: try date(step.now)); return .null
        case "sql":
            let sql = try #require(step.sql)
            try database.pool.write { try $0.execute(sql: sql) }
            return .null
        case "listTrash":
            let trash = try database.listTrash()
            func string(_ value: String?) -> JSON { value.map(JSON.string) ?? .null }
            return .object([
                "notes": .array(trash.notes.map {
                    .object(["id": .int($0.id), "title": .string($0.title), "deletedAt": .string($0.deletedAt), "expiresAt": string($0.expiresAt)])
                }),
                "groups": .array(trash.groups.map {
                    .object(["id": .int($0.id), "name": .string($0.name), "deletedAt": .string($0.deletedAt), "expiresAt": string($0.expiresAt)])
                }),
            ])
        default:
            Issue.record("unknown step \(step.op)")
            return .null
        }
    }

    @Test("every step of the script leaves the same results and the same rows as the desktop's trashRepo.ts")
    func scriptMatchesDesktop() throws {
        let directory = try #require(conformanceDirectory)
        let steps = try JSONDecoder().decode([String: [Step]].self, from: Data(contentsOf: directory.appendingPathComponent("trash-script.json")).strippingAbout())["steps"] ?? []
        let expected = try JSONDecoder().decode([String: [Recorded]].self, from: Data(contentsOf: directory.appendingPathComponent("trash-script.expected.json")))["steps"] ?? []
        #expect(steps.count == expected.count && steps.count > 30, "the script and the desktop's record agree on the steps")

        try withScratch { scratch in
            try FileManager.default.copyItem(at: directory.appendingPathComponent("trash-start.db"), to: scratch.databaseURL)
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }

            // The uuids the starting database had; anything else a step produces is a fresh one.
            let known = try database.pool.read { db in
                Set(try ["notes", "groups", "trashed_notes", "trashed_groups"].flatMap { try String.fetchAll(db, sql: "SELECT uuid FROM \($0)") })
            }
            #expect(known.count >= 15)

            for (index, (step, desktop)) in zip(steps, expected).enumerated() {
                #expect(step.op == desktop.op)
                let result = try run(step, on: database).normalizingUuids(known: known)
                let rows = try dump(database).normalizingUuids(known: known)

                if let found = result.difference(from: desktop.result.normalizingUuids(known: known)) {
                    Issue.record("step \(index) (\(step.op) \(step.id.map(String.init) ?? "")): the result differs\(found)")
                }
                if let found = rows.difference(from: desktop.dump.normalizingUuids(known: known)) {
                    Issue.record("step \(index) (\(step.op) \(step.id.map(String.init) ?? "")): the rows differ\(found)")
                    return  // later steps would only repeat it
                }
            }
        }
    }
}
