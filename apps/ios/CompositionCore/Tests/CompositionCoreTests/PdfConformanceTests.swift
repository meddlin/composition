import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The PDF tables against the shared corpus in fixtures/conformance/pdf (fixtures/conformance/README.md). The TypeScript wrote these
// files from its own code (`pdfConformance.test.ts` regenerates schema.json and scripts.json, `pdfMarkup.test.ts` reads
// validation.json) and the Swift core replays them:
//
//   schema.json      the columns, indexes and uuid triggers of the three tables, compared with a database made here
//   validation.json  what makes a mark, a bookmark label and a reading position valid, and what each is stored as
//   scripts.json     operation scripts replayed step by step against a fresh database, each step's result and the final rows compared
//
// Unlike the other conformance tests these files are committed, so they need no COMPOSITION_CONFORMANCE_DIR: they are found from
// this file's place in the checkout, and the tests are skipped (reported as skipped, never as passed) where that folder is not there.

private enum PdfCorpus {
    /// `fixtures/conformance/pdf` of this checkout, or nil when the tests run somewhere the source tree is not.
    static let directory: URL? = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        url.appendPathComponent("fixtures/conformance/pdf", isDirectory: true)
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("scripts.json").path) ? url : nil
    }()

    static func load(_ name: String) throws -> JSONValue {
        let url = try #require(directory).appendingPathComponent(name)
        return expandingRepeats(try JSONValue(parsing: String(contentsOf: url, encoding: .utf8)))
    }

    /// `{"$repeat": ["a", 501]}` stands for 501 letters `a`: JSON has no way to write a long string.
    static func expandingRepeats(_ value: JSONValue) -> JSONValue {
        switch value {
        case .array(let items):
            return .array(items.map(expandingRepeats))
        case .object(let object):
            if object.members.count == 1, object.members[0].key == "$repeat", case .array(let parts) = object.members[0].value,
                parts.count == 2, let unit = parts[0].stringValue, let times = parts[1].integerValue
            {
                return .string(String(repeating: unit, count: times))
            }
            return .object(JSONObject(object.members.map { JSONObject.Member($0.key, expandingRepeats($0.value)) }))
        default:
            return value
        }
    }
}

/// What the corpus's JSON becomes before it reaches the Swift API, and where Swift's types turn it away first: a page of 1.5, a kind
/// that is not one of five, a quote that is a number or a rectangle of three numbers cannot be written down in `PdfMarkInput`, which
/// is the refusal the desktop makes at run time. The test counts these, so what the types carry is in plain sight.
private struct RefusedByType: Error {
    let what: String
}

private extension JSONValue {
    subscript(key: String) -> JSONValue? { objectValue?[key] }

    func required<T>(_ what: String, _ read: (JSONValue) -> T?) throws -> T {
        guard let value = read(self) else { throw RefusedByType(what: what) }
        return value
    }
}

private func present(_ value: JSONValue?, _ what: String) throws -> JSONValue {
    guard let value else { throw RefusedByType(what: "\(what) is missing") }
    return value
}

/// A string the key does not have (nil), has as text, or has as something else (refused).
private func optionalText(_ value: JSONValue?, _ what: String) throws -> String? {
    guard let value else { return nil }
    return try value.required(what) { $0.stringValue }
}

private func markInput(_ json: JSONValue) throws -> PdfMarkInput {
    let page: Int = try present(json["page"], "page").required("a page that is a whole number") { $0.integerValue }
    let kindName: String = try present(json["kind"], "kind").required("a kind that is text") { $0.stringValue }
    guard let kind = PdfMarkKind(rawValue: kindName) else { throw RefusedByType(what: "a kind that is one of five") }
    let color: String = try present(json["color"], "color").required("a color that is text") { $0.stringValue }

    var rects: [PdfRect]?
    switch json["rects"] {
    case nil, .null?: break
    case .array(let items)?:
        rects = try items.map { try $0.required("a rectangle of four numbers") { PdfRect($0) } }
    default: throw RefusedByType(what: "rectangles that are a list")
    }

    var groupUuid: String?
    switch json["groupUuid"] {
    case nil, .null?: break
    case .string(let uuid)?: groupUuid = uuid
    default: throw RefusedByType(what: "a group that is text")
    }

    return PdfMarkInput(
        page: page, kind: kind, color: color, rects: rects, quote: try optionalText(json["quote"], "a quote that is text") ?? "",
        comment: try optionalText(json["comment"], "a comment that is text") ?? "", body: json["body"], groupUuid: groupUuid)
}

private func markChanges(_ json: JSONValue) throws -> PdfMarkChanges {
    var changes = PdfMarkChanges(
        color: try optionalNonNull(json["color"], "a color that is text"), comment: try optionalNonNull(json["comment"], "a comment that is text"),
        quote: try optionalNonNull(json["quote"], "a quote that is text"), body: json["body"])
    switch json["rects"] {
    case nil: break
    case .null?: changes.rects = .some(nil)
    case .array(let items)?: changes.rects = .some(try items.map { try $0.required("a rectangle of four numbers") { PdfRect($0) } })
    default: throw RefusedByType(what: "rectangles that are a list")
    }
    return changes
}

/// The desktop's `changes.color ?? current.color`: a null is as good as nothing.
private func optionalNonNull(_ value: JSONValue?, _ what: String) throws -> String? {
    if case .null? = value { return nil }
    return try optionalText(value, what)
}

private func difference(_ swift: JSONValue, _ corpus: JSONValue, _ path: String = "") -> String? {
    switch (swift, corpus) {
    case (.object(let a), .object(let b)):
        for key in Set(a.members.map(\.key)).union(b.members.map(\.key)).sorted() {
            guard let x = a[key], let y = b[key] else { return "\(path).\(key) is on one side only" }
            if let found = difference(x, y, "\(path).\(key)") { return found }
        }
        return nil
    case (.array(let a), .array(let b)):
        if a.count != b.count { return "\(path) has \(a.count) entries in Swift, \(b.count) in the corpus" }
        for (index, pair) in zip(a, b).enumerated() {
            if let found = difference(pair.0, pair.1, "\(path)[\(index)]") { return found }
        }
        return nil
    default:
        return swift == corpus ? nil : "\(path) is \(swift.serialized()) in Swift, \(corpus.serialized()) in the corpus"
    }
}

@Suite("PDF tables against the shared corpus", .enabled(if: PdfCorpus.directory != nil, "fixtures/conformance/pdf is not beside this test file"))
struct PdfConformanceTests {
    private static let tables = ["documents", "pdf_annotations", "pdf_bookmarks"]

    // MARK: schema.json

    private func collapsed(_ sql: String) -> String {
        sql.unicodeScalars.split(whereSeparator: JavaScriptText.isWhitespace).map { String(String.UnicodeScalarView($0)) }.joined(separator: " ")
    }

    @Test("the three tables, their indexes and their uuid triggers are the desktop's")
    func schema() throws {
        let expected = try PdfCorpus.load("schema.json")
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let actual: JSONValue = try database.pool.read { db in
                var columns: [JSONObject.Member] = []
                for table in Self.tables {
                    let rows = try Row.fetchAll(db, sql: "PRAGMA table_info(\(table))").map { row -> JSONValue in
                        let defaultValue: String? = row["dflt_value"]
                        return .object(JSONObject([
                            "name": .string(row["name"]), "type": .string(row["type"]), "notnull": .bool((row["notnull"] as Int) == 1),
                            "default": defaultValue.map(JSONValue.string) ?? .null, "primaryKey": .bool((row["pk"] as Int) == 1),
                        ]))
                    }
                    columns.append(JSONObject.Member(table, .array(rows)))
                }
                let objects = try Row.fetchAll(
                    db,
                    sql: """
                        SELECT type, name, tbl_name, sql FROM sqlite_master
                        WHERE tbl_name IN (\(Self.tables.map { "'\($0)'" }.joined(separator: ", "))) AND sql IS NOT NULL
                        ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name
                        """
                ).map { row -> JSONValue in
                    .object(JSONObject(["type": .string(row["type"]), "name": .string(row["name"]), "table": .string(row["tbl_name"]), "sql": .string(collapsed(row["sql"]))]))
                }
                return .object(JSONObject(["columns": .object(JSONObject(columns)), "objects": .array(objects)]))
            }
            #expect(expected["objects"]?.arrayValue?.count == 13, "the corpus has the three tables, seven indexes and three triggers")
            if let found = difference(actual, expected) { Issue.record("the schema differs: \(found)") }
        }
    }

    // MARK: validation.json

    private func json(_ mark: ValidPdfMark) -> JSONValue {
        .object(JSONObject([
            "page": .number(Double(mark.page)), "kind": .string(mark.kind.rawValue), "color": .string(mark.color),
            "rects": mark.rects.map { JSONValue.array($0.map(\.json)) } ?? .null, "quote": .string(mark.quote), "comment": .string(mark.comment),
            "body": mark.body ?? .null, "groupUuid": mark.groupUuid.map(JSONValue.string) ?? .null,
        ]))
    }

    @Test("every mark, bookmark label and reading position is kept as the desktop keeps it, or refused as it refuses it")
    func validation() throws {
        let corpus = try PdfCorpus.load("validation.json")
        var checked = 0
        var byType: [String] = []
        var byRule = 0

        for entry in try #require(corpus["annotations"]?.arrayValue) {
            let name = entry["name"]?.stringValue ?? "?"
            let invalid = entry["invalid"] == .bool(true)
            checked += 1
            do {
                let stored = json(try PdfMarkup.validate(try markInput(try present(entry["input"], "input"))))
                if invalid {
                    Issue.record("\(name): kept, and the desktop refuses it")
                } else if let found = difference(stored, try present(entry["stored"], "stored")) {
                    Issue.record("\(name): stored differently: \(found)")
                }
            } catch let refusal as RefusedByType {
                byType.append("\(name) (\(refusal.what))")
                if !invalid { Issue.record("\(name): refused by Swift's types, and the desktop keeps it: \(refusal.what)") }
            } catch is InvalidMarkError {
                byRule += 1
                if !invalid { Issue.record("\(name): refused, and the desktop keeps it") }
            }
        }

        for entry in try #require(corpus["bookmarkLabels"]?.arrayValue) {
            let invalid = entry["invalid"] == .bool(true)
            checked += 1
            do {
                let label: String = try present(entry["input"], "input").required("a label that is text") { $0.stringValue }
                let stored = try PdfMarkup.validateBookmarkLabel(label)
                if invalid {
                    Issue.record("a label of \(label.utf16.count) characters was kept, and the desktop refuses it")
                } else if JSONValue.string(stored) != entry["stored"] {
                    Issue.record("a label of \(label.utf16.count) characters is stored as \(stored.debugDescription)")
                }
            } catch let refusal as RefusedByType {
                byType.append("a bookmark label (\(refusal.what))")
                if !invalid { Issue.record("a label was refused by Swift's types, and the desktop keeps it") }
            } catch is InvalidMarkError {
                byRule += 1
                if !invalid { Issue.record("a label was refused, and the desktop keeps it") }
            }
        }

        for entry in try #require(corpus["viewStates"]?.arrayValue) {
            checked += 1
            let stored = PdfViewState(normalizing: try present(entry["input"], "input")).json
            if let found = difference(stored, try present(entry["stored"], "stored")) {
                Issue.record("a reading position \(entry["input"]?.serialized() ?? "?"): \(found)")
            }
        }

        // a floor under what the corpus holds today, so that a file read as empty cannot pass for a replay
        #expect(checked >= 40 && byRule >= 20, "the corpus was read: \(checked) inputs, \(byRule) refused by the rules")
        print("\nPDF validation: \(checked) inputs; \(byRule) refused by the rules, \(byType.count) by Swift's types: \(byType.joined(separator: "; "))")
    }

    // MARK: scripts.json

    /// What the corpus's scripts leave out because no two runs share it: uuids, times, and group uuids (numbered by first use).
    private struct Normalizer {
        var groups: [String: String] = [:]

        mutating func callAsFunction(_ value: JSONValue, key: String = "") -> JSONValue {
            switch value {
            case .array(let items):
                return .array(items.map { self($0) })
            case .object(let object):
                return .object(JSONObject(object.members.map { JSONObject.Member($0.key, self($0.value, key: $0.key)) }))
            case .string(let text):
                switch key {
                case "uuid":
                    return .string(PdfMarkup.isHexUuid(text) ? "<uuid>" : "NOT A UUID: \(text)")
                case "group_uuid", "groupUuid":
                    guard PdfMarkup.isHexUuid(text) else { return .string("NOT A UUID: \(text)") }
                    if groups[text] == nil { groups[text] = "<group-\(groups.count + 1)>" }
                    return .string(groups[text]!)
                case "created_at", "createdAt", "updated_at", "updatedAt":
                    return .string(Timestamp.milliseconds(from: text) != nil ? "<time>" : "NOT A TIME: \(text)")
                default:
                    return value
                }
            default:
                return value
            }
        }
    }

    private func json(_ document: StoredDocument) -> JSONValue {
        .object(JSONObject([
            "id": .number(Double(document.id)), "uuid": .string(document.uuid), "noteId": .number(Double(document.noteId)),
            "fileName": .string(document.fileName), "storedName": .string(document.storedName), "sha256": .string(document.sha256),
            "size": .number(Double(document.size)), "pageCount": .number(Double(document.pageCount)), "viewState": document.viewState.json,
            "createdAt": .string(document.createdAt),
        ]))
    }

    private func json(_ mark: PdfMark) -> JSONValue {
        .object(JSONObject([
            "id": .number(Double(mark.id)), "uuid": .string(mark.uuid), "documentId": .number(Double(mark.documentId)),
            "page": .number(Double(mark.page)), "kind": .string(mark.kind.rawValue), "color": .string(mark.color),
            "rects": mark.rects.map { JSONValue.array($0.map(\.json)) } ?? .null, "quote": .string(mark.quote), "comment": .string(mark.comment),
            "body": mark.body ?? .null, "groupUuid": mark.groupUuid.map(JSONValue.string) ?? .null, "createdAt": .string(mark.createdAt),
            "updatedAt": .string(mark.updatedAt),
        ]))
    }

    private func json(_ bookmark: PdfBookmark) -> JSONValue {
        .object(JSONObject([
            "id": .number(Double(bookmark.id)), "uuid": .string(bookmark.uuid), "documentId": .number(Double(bookmark.documentId)),
            "page": .number(Double(bookmark.page)), "label": .string(bookmark.label), "createdAt": .string(bookmark.createdAt),
        ]))
    }

    private func id(_ step: JSONValue, _ key: String) throws -> Int64 {
        Int64(try present(step[key], key).required("\(key) that is a whole number") { $0.integerValue })
    }

    private func text(_ step: JSONValue, _ key: String) throws -> String {
        try present(step[key], key).required("\(key) that is text") { $0.stringValue }
    }

    /// Makes exactly these notes live and these in the Trash Can: the scripts need the notes' ids, not the notes.
    private func setNotes(_ step: JSONValue, in database: CompositionDatabase) throws {
        let live = try present(step["live"], "live").required("a list") { $0.arrayValue }.compactMap(\.integerValue)
        let trashed = try present(step["trashed"], "trashed").required("a list") { $0.arrayValue }.compactMap(\.integerValue)
        try database.pool.write { db in
            try db.execute(sql: "DELETE FROM notes")
            try db.execute(sql: "DELETE FROM trashed_notes")
            for id in live {
                try db.execute(sql: "INSERT INTO notes (id, title, created_at, updated_at) VALUES (?, ?, 'x', 'x')", arguments: [id, "note \(id)"])
            }
            for id in trashed {
                try db.execute(sql: "INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at) VALUES (?, ?, 'x', 'x', 'x')", arguments: [id, "note \(id)"])
            }
        }
    }

    /// One step against the database: what it returned, as the corpus writes it (`ok` and the value, or `error`).
    private func run(_ step: JSONValue, on database: CompositionDatabase) throws -> JSONValue {
        let ok = { (value: JSONValue) in JSONValue.object(JSONObject(["ok": value])) }
        let op = try text(step, "op")
        do {
            switch op {
            case "setNotes": try setNotes(step, in: database); return ok(.null)
            case "addDocument":
                let size = try present(step["size"], "size").required("a size") { $0.integerValue }
                let pages = try present(step["pageCount"], "pageCount").required("a page count") { $0.integerValue }
                return ok(json(try database.addDocument(
                    noteId: try id(step, "noteId"), fileName: try text(step, "fileName"), storedName: try text(step, "storedName"), sha256: try text(step, "sha256"),
                    size: Int64(size), pageCount: pages)))
            case "setPageCount":
                let pages = try present(step["pageCount"], "pageCount").required("a page count") { $0.integerValue }
                try database.setPageCount(id: try id(step, "id"), pageCount: pages)
                return ok(.null)
            case "setViewState":
                try database.setViewState(id: try id(step, "id"), state: PdfViewState(normalizing: try present(step["state"], "state")))
                return ok(.null)
            case "deleteDocument": return ok(try database.deleteDocument(id: try id(step, "id")).map(json) ?? .null)
            case "deleteOrphanedDocuments": return ok(.array(try database.deleteOrphanedDocuments().map(json)))
            case "addAnnotation":
                return ok(json(try database.addAnnotation(documentId: try id(step, "documentId"), try markInput(try present(step["input"], "input")))))
            case "addAnnotationGroup":
                let inputs = try present(step["inputs"], "inputs").required("a list") { $0.arrayValue }.map(markInput)
                return ok(.array(try database.addAnnotationGroup(documentId: try id(step, "documentId"), inputs).map(json)))
            case "updateAnnotation":
                let changes = try markChanges(try present(step["changes"], "changes"))
                return ok(try database.updateAnnotation(id: try id(step, "id"), changes: changes).map(json) ?? .null)
            case "deleteAnnotation": return ok(.array(try database.deleteAnnotation(id: try id(step, "id")).map(json)))
            case "addBookmark":
                let page = try present(step["page"], "page").required("a page that is a whole number") { $0.integerValue }
                let label = try optionalText(step["label"], "a label that is text") ?? ""
                return ok(json(try database.addBookmark(documentId: try id(step, "documentId"), page: page, label: label)))
            case "renameBookmark":
                return ok(try database.renameBookmark(id: try id(step, "id"), label: try text(step, "label")).map(json) ?? .null)
            case "deleteBookmark": try database.deleteBookmark(id: try id(step, "id")); return ok(.null)
            default:
                Issue.record("unknown op \(op)")
                return ok(.null)
            }
        } catch is InvalidMarkError {
            return .object(JSONObject(["error": .bool(true)]))
        } catch is DocumentError {
            return .object(JSONObject(["error": .bool(true)]))
        } catch is RefusedByType {
            return .object(JSONObject(["error": .bool(true)]))
        }
    }

    /// The rows of one table, as the corpus writes them: every column, with the three that hold JSON read as JSON, not as text.
    private func rows(_ table: String, in database: CompositionDatabase) throws -> JSONValue {
        try database.pool.read { db in
            .array(try Row.fetchAll(db, sql: "SELECT * FROM \(table) ORDER BY id").map { row in .object(JSONObject(rowMembers(row))) })
        }
    }

    private func rowMembers(_ row: Row) -> [JSONObject.Member] {
        row.map { column, value in
            switch value.storage {
            case .null: JSONObject.Member(column, .null)
            case .int64(let number): JSONObject.Member(column, .number(Double(number)))
            case .double(let number): JSONObject.Member(column, .number(number))
            case .string(let text): JSONObject.Member(column, JSONValue.jsonColumns.contains(column) ? ((try? JSONValue(parsing: text)) ?? .string(text)) : .string(text))
            case .blob: JSONObject.Member(column, .string("BLOB"))
            }
        }
    }

    /// The three tables and the next id of each: a refused step must leave all of it as it was.
    private func state(of database: CompositionDatabase) throws -> JSONValue {
        let sequence = try database.pool.read { db in
            try Row.fetchAll(db, sql: "SELECT name, seq FROM sqlite_sequence WHERE name IN ('documents', 'pdf_annotations', 'pdf_bookmarks') ORDER BY name").map { JSONValue.object(JSONObject(rowMembers($0))) }
        }
        return .object(JSONObject([
            "documents": try rows("documents", in: database), "annotations": try rows("pdf_annotations", in: database),
            "bookmarks": try rows("pdf_bookmarks", in: database), "sqlite_sequence": .array(sequence),
        ]))
    }

    @Test("every script leaves the same results and the same rows as the desktop's repositories, and a refused step changes nothing")
    func scriptsMatchDesktop() throws {
        let scripts = try #require(try PdfCorpus.load("scripts.json")["scripts"]?.arrayValue)
        var steps = 0
        var refusals = 0

        for script in scripts {
            let name = script["name"]?.stringValue ?? "?"
            let expected = try #require(script["expect"], "\(name): the corpus has no expected result, regenerate it (UPDATE_FIXTURES=1)")
            let scriptSteps = try #require(script["steps"]?.arrayValue)
            let expectedSteps = try #require(expected["steps"]?.arrayValue)
            #expect(scriptSteps.count == expectedSteps.count, "\(name): a result for every step")

            try withScratch { scratch in
                let database = try CompositionDatabase.open(at: scratch.databaseURL)
                defer { try? database.close() }
                var normalize = Normalizer()

                for (index, (step, wanted)) in zip(scriptSteps, expectedSteps).enumerated() {
                    let label = "\(name), step \(index) (\(step["op"]?.stringValue ?? "?"))"
                    let before = try state(of: database)
                    let result = normalize(try run(step, on: database))
                    steps += 1
                    if let found = difference(result, wanted) {
                        Issue.record("\(label): the result differs: \(found)")
                        return  // later steps would only repeat it
                    }
                    if wanted["error"] != nil {
                        refusals += 1
                        if let found = difference(try state(of: database), before) { Issue.record("\(label): was refused and still changed something: \(found)") }
                    }
                }

                for (key, table) in [("documents", "documents"), ("annotations", "pdf_annotations"), ("bookmarks", "pdf_bookmarks")] {
                    let wantedRows = JSONValue.array(try #require(expected[key]?.arrayValue).map { row in
                        .object(JSONObject((row.objectValue?.members ?? []).map { JSONObject.Member($0.key, JSONValue.jsonColumns.contains($0.key) ? ($0.value.stringValue.flatMap { try? JSONValue(parsing: $0) } ?? $0.value) : $0.value) }))
                    })
                    if let found = difference(normalize(try rows(table, in: database)), wantedRows) { Issue.record("\(name): \(table) end differently: \(found)") }
                }
            }
        }

        #expect(scripts.count >= 5 && steps >= 40 && refusals >= 5, "the corpus was read: \(scripts.count) scripts, \(steps) steps, \(refusals) refusals")
        print("\nPDF scripts: \(scripts.count) scripts, \(steps) steps (\(refusals) refused) gave the desktop's results and left its rows")
    }
}

private extension JSONValue {
    /// The columns of the three tables that hold JSON, which the corpus compares as values, not as text.
    static let jsonColumns: Set<String> = ["rects", "body", "view_state"]
}
