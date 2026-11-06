import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The Swift store against the desktop's real `service.ts` (and the repos under it). Both run the steps in
// apps/ios/conformance/store-script.json against the same starting database (store-start.db, built by the TypeScript with the real
// repos). After every step the TypeScript recorded the result and every row of notes, groups, notebooks, trashed_notes,
// trashed_groups and sqlite_sequence (store-script.expected.json); Swift records the same and the two must be equal. See
// ConformanceTests.swift for how to run.

private struct Step: Decodable {
    let op: String
    let at: String?
    let id: Int64?
    let title: String?
    let name: String?
    let content: String?
    let groupId: Int64?
    let notebookId: Int64?
    let parentId: Int64?
    let beforeId: Int64?
    let sql: String?
}

private struct Recorded: Decodable {
    let op: String
    let result: JSON
    let dump: JSON
}

@Suite("Notes, groups and notebooks against the desktop", .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct StoreConformanceTests {
    private func date(_ iso: String?) throws -> Date {
        Timestamp.date(milliseconds: try #require(iso.flatMap(Timestamp.milliseconds(from:)), "bad time in the script: \(iso ?? "nil")"))
    }

    private func dump(_ database: CompositionDatabase) throws -> JSON {
        try database.pool.read { db in
            var tables: [String: JSON] = [:]
            for table in ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups"] {
                tables[table] = .array(try Row.fetchAll(db, sql: "SELECT * FROM \(table) ORDER BY id").map(JSON.init))
            }
            tables["sqlite_sequence"] = .array(try Row.fetchAll(db, sql: "SELECT name, seq FROM sqlite_sequence ORDER BY name").map(JSON.init))
            return .object(tables)
        }
    }

    // The shapes the TypeScript records: the desktop's own field names.
    private func json(_ id: Int64?) -> JSON { id.map(JSON.int) ?? .null }

    private func json(_ note: NoteDetail) -> JSON {
        .object([
            "id": .int(note.id), "uuid": .string(note.uuid), "title": .string(note.title), "content": .string(note.content),
            "tags": .string(note.tags), "description": .string(note.description), "createdAt": .string(note.createdAt),
            "updatedAt": .string(note.updatedAt), "groupId": json(note.groupId), "notebookId": json(note.notebookId),
        ])
    }

    private func json(_ group: NoteGroup) -> JSON {
        .object([
            "id": .int(group.id), "uuid": .string(group.uuid), "name": .string(group.name), "parentId": json(group.parentId),
            "notebookId": json(group.notebookId), "createdAt": .string(group.createdAt), "updatedAt": .string(group.updatedAt),
        ])
    }

    private func json(_ notebook: Notebook) -> JSON {
        .object(["id": .int(notebook.id), "uuid": .string(notebook.uuid), "name": .string(notebook.name), "createdAt": .string(notebook.createdAt), "updatedAt": .string(notebook.updatedAt)])
    }

    private func json(_ restored: RestoreResult?) -> JSON {
        restored.map { .object(["restoredToTopLevel": .bool($0.restoredToTopLevel)]) } ?? .null
    }

    private func refused(_ kind: String) -> JSON { .object(["error": .string(kind)]) }

    private func run(_ step: Step, on store: NoteStore, at now: Date) throws -> JSON {
        let id = step.id ?? 0
        do {
            switch step.op {
            case "createNote": return json(try store.createNote(title: try #require(step.title), groupId: step.groupId, notebookId: step.notebookId, now: now))
            case "saveNoteContent": return json(try store.saveNoteContent(id: id, content: try #require(step.content), now: now))
            case "deleteNote": try store.deleteNote(id: id, now: now); return .null
            case "restoreNote": return json(try store.restoreNote(id: id))
            case "moveNoteToGroup": return json(try store.moveNote(id: id, toGroup: step.groupId))
            case "placeNote": return json(try store.placeNote(id: id, groupId: step.groupId, before: step.beforeId))
            case "createGroup": return json(try store.createGroup(name: try #require(step.name), parentId: step.parentId, notebookId: step.notebookId, now: now))
            case "renameGroup": return json(try store.renameGroup(id: id, name: try #require(step.name), now: now))
            case "deleteGroup": try store.deleteGroup(id: id, now: now); return .null
            case "restoreGroup": return json(try store.restoreGroup(id: id))
            case "moveGroup": return json(try store.moveGroup(id: id, parentId: step.parentId, now: now))
            case "moveGroupToNotebook": return json(try store.moveGroupToNotebook(id: id, notebookId: try #require(step.notebookId), now: now))
            case "placeGroup": return json(try store.placeGroup(id: id, parentId: step.parentId, before: step.beforeId, now: now))
            case "groupIsEmpty": return .bool(try store.database.groupIsEmpty(id: id))
            case "createNotebook": return json(try store.createNotebook(name: try #require(step.name), now: now))
            case "renameNotebook": return json(try store.renameNotebook(id: id, name: try #require(step.name), now: now))
            case "placeNotebook": return .array(try store.placeNotebook(id: id, before: step.beforeId).map { .int($0.id) })
            case "deleteNotebook": try store.deleteNotebook(id: id); return .null
            case "listNotes": return .array(try store.database.notesInDisplayOrder().map { .int($0.id) })
            case "listGroups": return .array(try store.database.listGroups().map { .int($0.id) })
            case "listNotebooks": return .array(try store.database.listNotebooks().map { .int($0.id) })
            case "sql":
                let sql = try #require(step.sql)
                try store.database.pool.write { try $0.execute(sql: sql) }
                return .null
            default:
                Issue.record("unknown step \(step.op)")
                return .null
            }
        } catch StoreError.notFound {
            return refused("notFound")
        } catch StoreError.invalidGroupMove, StoreError.invalidNotebookMove {
            return refused("invalidGroupMove")
        } catch StoreError.lastNotebook {
            return refused("lastNotebook")
        } catch StoreError.notebookNotEmpty {
            return refused("notebookNotEmpty")
        } catch StoreError.noNotebooks {
            return refused("noNotebooks")
        } catch TrashError.groupNotEmpty {
            return refused("groupNotEmpty")
        }
    }

    @Test("every step of the script leaves the same results and the same rows as the desktop's service")
    func scriptMatchesDesktop() throws {
        let directory = try #require(conformanceDirectory)
        let steps = try JSONDecoder().decode([String: [Step]].self, from: Data(contentsOf: directory.appendingPathComponent("store-script.json")).strippingAbout())["steps"] ?? []
        let expected = try JSONDecoder().decode([String: [Recorded]].self, from: Data(contentsOf: directory.appendingPathComponent("store-script.expected.json")))["steps"] ?? []
        #expect(steps.count == expected.count && steps.count > 80, "the script and the desktop's record agree on the steps")

        try withScratch { scratch in
            try FileManager.default.copyItem(at: directory.appendingPathComponent("store-start.db"), to: scratch.databaseURL)
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let store = NoteStore(database: database)

            // The uuids the starting database had; anything else a step produces is a fresh one.
            let known = try database.pool.read { db in
                Set(try ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups"].flatMap { try String.fetchAll(db, sql: "SELECT uuid FROM \($0)") })
            }
            #expect(known.count >= 20)

            var clock = Date()
            var different = 0
            for (index, (step, desktop)) in zip(steps, expected).enumerated() {
                #expect(step.op == desktop.op)
                if let at = step.at { clock = try date(at) }
                let label = "step \(index) (\(step.op) \(step.id.map(String.init) ?? ""))"
                let result = try run(step, on: store, at: clock).normalizingUuids(known: known)
                let rows = try dump(database).normalizingUuids(known: known)

                if let found = result.difference(from: desktop.result.normalizingUuids(known: known)) {
                    Issue.record("\(label): the result differs\(found)")
                    different += 1
                }
                if let found = rows.difference(from: desktop.dump.normalizingUuids(known: known)) {
                    Issue.record("\(label): the rows differ\(found)")
                    return  // later steps would only repeat it
                }
            }
            print("\nStore: \(steps.count - different) of \(steps.count) steps gave the desktop's result and left the desktop's rows")
        }
    }
}
