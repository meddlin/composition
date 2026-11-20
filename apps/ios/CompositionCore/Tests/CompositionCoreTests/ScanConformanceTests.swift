import Foundation
import GRDB
import Testing

@testable import CompositionCore

// Scanned pages and the text read from them, against the shared corpus in fixtures/conformance/scan (fixtures/conformance/README.md). The
// TypeScript wrote these files from its own code (`scanConformance.test.ts`; text.json by hand) and the Swift core replays them:
//
//   text.json     the guard, how a recognised line is stored, a page's search text, and when reading a page again leaves a new line out
//   schema.json   the columns, indexes and uuid triggers of the two tables, compared with a database made here
//   scripts.json  operation scripts replayed step by step against a fresh database, each step's result and the final rows compared
//
// Committed, so found from this file's place in the checkout, and skipped (reported as skipped) where that folder is not there.

private enum ScanCorpus {
    static let directory: URL? = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        url.appendPathComponent("fixtures/conformance/scan", isDirectory: true)
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("scripts.json").path) ? url : nil
    }()

    static func load(_ name: String) throws -> JSONValue {
        let url = try #require(directory).appendingPathComponent(name)
        return expandingRepeats(try JSONValue(parsing: String(contentsOf: url, encoding: .utf8)))
    }

    /// `{"$repeat": ["a", 501]}` stands for 501 letters `a`.
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

/// Where Swift's types turn the corpus's JSON away before it reaches the API (a text that is a number, a page of 1.5): the refusal the desktop
/// makes at run time.
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

private func lineInput(_ json: JSONValue) throws -> RecognizedLineInput {
    let rect = try present(json["rect"], "rect").required("a box that is a list of numbers") { value in
        value.arrayValue.flatMap { items in
            let numbers = items.compactMap(\.doubleValue)
            return numbers.count == items.count ? numbers : nil
        }
    }
    let text: String = try present(json["text"], "text").required("a text that is text") { $0.stringValue }
    let confidence: Double = try present(json["confidence"], "confidence").required("a confidence that is a number") { $0.doubleValue }
    return RecognizedLineInput(rect: rect, text: text, confidence: confidence)
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

@Suite("Scans against the shared corpus", .enabled(if: ScanCorpus.directory != nil, "fixtures/conformance/scan is not beside this test file"))
struct ScanConformanceTests {
    private static let tables = ["scan_pages", "scan_lines"]

    // MARK: text.json

    @Test("the guard, a stored line, a page's text and the covered rule are the desktop's")
    func rules() throws {
        let corpus = try ScanCorpus.load("text.json")
        #expect(corpus["floor"] == .number(ScanText.floor))
        var checked = 0

        for entry in try #require(corpus["guard"]?.arrayValue) {
            let text = try #require(entry["text"]?.stringValue), confidence = try #require(entry["confidence"]?.doubleValue)
            let status = ScanText.recognizedStatus(text: text, confidence: confidence)
            #expect(status.rawValue == entry["status"]?.stringValue, "\(entry["name"]?.stringValue ?? "?")")
            checked += 1
        }

        var byType: [String] = []
        for entry in try #require(corpus["lines"]?.arrayValue) {
            let name = entry["name"]?.stringValue ?? "?"
            let invalid = entry["invalid"] == .bool(true)
            checked += 1
            do {
                let stored = try ScanText.validate(try lineInput(try present(entry["input"], "input")))
                let json: JSONValue = stored.map {
                    .object(JSONObject(["rect": $0.rect.json, "text": .string($0.text), "confidence": .number($0.confidence), "status": .string($0.status.rawValue)]))
                } ?? .null
                if invalid {
                    Issue.record("\(name): kept, and the desktop refuses it")
                } else if let found = difference(json, try present(entry["stored"], "stored")) {
                    Issue.record("\(name): stored differently: \(found)")
                }
            } catch let refusal as RefusedByType {
                byType.append("\(name) (\(refusal.what))")
                if !invalid { Issue.record("\(name): refused by Swift's types, and the desktop keeps it") }
            } catch is InvalidScanError {
                if !invalid { Issue.record("\(name): refused, and the desktop keeps it") }
            }
        }

        for entry in try #require(corpus["pages"]?.arrayValue) {
            let lines = try #require(entry["lines"]?.arrayValue).map { line in
                ScanLineText(
                    line: line["line"]?.integerValue ?? -1, text: line["text"]?.stringValue ?? "", status: ScanLineStatus(rawValue: line["status"]?.stringValue ?? "") ?? .held,
                    corrected: line["corrected"]?.stringValue)
            }
            #expect(ScanText.pageText(lines) == entry["text"]?.stringValue, "\(entry["name"]?.stringValue ?? "?")")
            checked += 1
        }

        for entry in try #require(corpus["covered"]?.arrayValue) {
            let rect = try #require(entry["rect"].flatMap(PdfRect.init))
            let kept = try #require(entry["kept"]?.arrayValue).compactMap(PdfRect.init)
            #expect(ScanText.coveredByKept(rect, kept) == (entry["covered"] == .bool(true)), "\(entry["name"]?.stringValue ?? "?")")
            checked += 1
        }

        #expect(checked >= 50, "the corpus was read: \(checked) cases")
        print("\nScan rules: \(checked) cases; \(byType.count) refused by Swift's types: \(byType.joined(separator: "; "))")
    }

    // MARK: schema.json

    private func collapsed(_ sql: String) -> String {
        sql.unicodeScalars.split(whereSeparator: JavaScriptText.isWhitespace).map { String(String.UnicodeScalarView($0)) }.joined(separator: " ")
    }

    @Test("the two tables, their indexes and their uuid triggers are the desktop's")
    func schema() throws {
        let expected = try ScanCorpus.load("schema.json")
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
            #expect(expected["objects"]?.arrayValue?.count == 8, "the corpus has the two tables, four indexes and two triggers")
            if let found = difference(actual, expected) { Issue.record("the schema differs: \(found)") }
        }
    }

    // MARK: scripts.json

    /// What no two runs share: uuids and times.
    private func normalize(_ value: JSONValue, key: String = "") -> JSONValue {
        switch value {
        case .array(let items):
            return .array(items.map { normalize($0) })
        case .object(let object):
            return .object(JSONObject(object.members.map { JSONObject.Member($0.key, normalize($0.value, key: $0.key)) }))
        case .string(let text):
            switch key {
            case "uuid":
                return .string(PdfMarkup.isHexUuid(text) ? "<uuid>" : "NOT A UUID: \(text)")
            case "created_at", "createdAt", "updated_at", "updatedAt", "recognized_at", "recognizedAt":
                return .string(Timestamp.milliseconds(from: text) != nil ? "<time>" : "NOT A TIME: \(text)")
            default:
                return value
            }
        default:
            return value
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

    private func json(_ page: ScanPage) -> JSONValue {
        .object(JSONObject([
            "id": .number(Double(page.id)), "uuid": .string(page.uuid), "documentId": .number(Double(page.documentId)), "page": .number(Double(page.page)),
            "engine": page.engine.map(JSONValue.string) ?? .null, "recognizedAt": page.recognizedAt.map(JSONValue.string) ?? .null,
            "createdAt": .string(page.createdAt),
        ]))
    }

    private func json(_ line: ScanLine) -> JSONValue {
        .object(JSONObject([
            "id": .number(Double(line.id)), "uuid": .string(line.uuid), "documentId": .number(Double(line.documentId)), "page": .number(Double(line.page)),
            "line": .number(Double(line.line)), "rect": line.rect.json, "text": .string(line.text), "confidence": .number(line.confidence),
            "engine": .string(line.engine), "status": .string(line.status.rawValue), "corrected": line.corrected.map(JSONValue.string) ?? .null,
            "createdAt": .string(line.createdAt), "updatedAt": .string(line.updatedAt),
        ]))
    }

    private func json(_ summary: ScanSummary?) -> JSONValue {
        guard let summary else { return .null }
        return .object(JSONObject([
            "pages": .number(Double(summary.pages)), "recognized": .number(Double(summary.recognized)), "lines": .number(Double(summary.lines)),
            "unchecked": .number(Double(summary.unchecked)), "held": .number(Double(summary.held)), "checked": .number(Double(summary.checked)),
            "corrected": .number(Double(summary.corrected)),
        ]))
    }

    private func id(_ step: JSONValue, _ key: String) throws -> Int64 {
        Int64(try present(step[key], key).required("\(key) that is a whole number") { $0.integerValue })
    }

    private func whole(_ step: JSONValue, _ key: String) throws -> Int {
        try present(step[key], key).required("\(key) that is a whole number") { $0.integerValue }
    }

    private func text(_ step: JSONValue, _ key: String) throws -> String {
        try present(step[key], key).required("\(key) that is text") { $0.stringValue }
    }

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

    private func run(_ step: JSONValue, on database: CompositionDatabase) throws -> JSONValue {
        let ok = { (value: JSONValue) in JSONValue.object(JSONObject(["ok": value])) }
        let op = try text(step, "op")
        do {
            switch op {
            case "setNotes": try setNotes(step, in: database); return ok(.null)
            case "addDocument":
                return ok(json(try database.addDocument(
                    noteId: try id(step, "noteId"), fileName: try text(step, "fileName"), storedName: try text(step, "storedName"), sha256: try text(step, "sha256"),
                    size: Int64(try whole(step, "size")), pageCount: try whole(step, "pageCount"))))
            case "deleteDocument": return ok(try database.deleteDocument(id: try id(step, "id")).map(json) ?? .null)
            case "deleteOrphanedDocuments": return ok(.array(try database.deleteOrphanedDocuments().map(json)))
            case "addScanPages": return ok(.number(Double(try database.addScanPages(documentId: try id(step, "documentId"), pageCount: try whole(step, "pageCount")))))
            case "isScan": return ok(.bool(try database.isScan(documentId: try id(step, "documentId"))))
            case "listScanPages": return ok(.array(try database.scanPages(documentId: try id(step, "documentId")).map(json)))
            case "pendingScanPages":
                let document = step["documentId"] == nil ? nil : try id(step, "documentId")
                return ok(.array(try database.pendingScanPages(documentId: document).map {
                    .object(JSONObject(["documentId": .number(Double($0.documentId)), "page": .number(Double($0.page))]))
                }))
            case "storeRecognition":
                let lines = try present(step["lines"], "lines").required("a list") { $0.arrayValue }.map(lineInput)
                return ok(.array(try database.storeRecognition(
                    documentId: try id(step, "documentId"), page: try whole(step, "page"), engine: try text(step, "engine"), lines: lines
                ).map(json)))
            case "listScanLines":
                let page = step["page"] == nil ? nil : try whole(step, "page")
                return ok(.array(try database.scanLines(documentId: try id(step, "documentId"), page: page).map(json)))
            case "checkScanLine": return ok(try database.checkScanLine(id: try id(step, "id")).map(json) ?? .null)
            case "correctScanLine": return ok(try database.correctScanLine(id: try id(step, "id"), text: try text(step, "text")).map(json) ?? .null)
            case "scanSummary": return ok(json(try database.scanSummary(documentId: try id(step, "documentId"))))
            case "scanPageTexts":
                return ok(.array(try database.scanPageTexts(documentId: try id(step, "documentId")).map {
                    .object(JSONObject(["page": .number(Double($0.page)), "text": .string($0.text)]))
                }))
            default:
                Issue.record("unknown op \(op)")
                return ok(.null)
            }
        } catch is InvalidScanError {
            return .object(JSONObject(["error": .bool(true)]))
        } catch is DocumentError {
            return .object(JSONObject(["error": .bool(true)]))
        } catch is RefusedByType {
            return .object(JSONObject(["error": .bool(true)]))
        }
    }

    /// The rows of one table, every column as the database holds it (a box is compared as the text it is stored as, so the two sides must write
    /// the same JSON).
    private func rows(_ table: String, in database: CompositionDatabase) throws -> JSONValue {
        try database.pool.read { db in
            .array(try Row.fetchAll(db, sql: "SELECT * FROM \(table) ORDER BY id").map { row in
                .object(JSONObject(row.map { column, value in
                    switch value.storage {
                    case .null: JSONObject.Member(column, .null)
                    case .int64(let number): JSONObject.Member(column, .number(Double(number)))
                    case .double(let number): JSONObject.Member(column, .number(number))
                    case .string(let text): JSONObject.Member(column, .string(text))
                    case .blob: JSONObject.Member(column, .string("BLOB"))
                    }
                }))
            })
        }
    }

    private func state(of database: CompositionDatabase) throws -> JSONValue {
        .object(JSONObject(["pages": try rows("scan_pages", in: database), "lines": try rows("scan_lines", in: database)]))
    }

    @Test("every script leaves the same results and the same rows as the desktop's repositories, and a refused step changes nothing")
    func scriptsMatchDesktop() throws {
        let scripts = try #require(try ScanCorpus.load("scripts.json")["scripts"]?.arrayValue)
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

                for (index, (step, wanted)) in zip(scriptSteps, expectedSteps).enumerated() {
                    let label = "\(name), step \(index) (\(step["op"]?.stringValue ?? "?"))"
                    let before = try state(of: database)
                    let result = normalize(try run(step, on: database))
                    steps += 1
                    if let found = difference(result, wanted) {
                        Issue.record("\(label): the result differs: \(found)")
                        return
                    }
                    if wanted["error"] != nil {
                        refusals += 1
                        if let found = difference(try state(of: database), before) { Issue.record("\(label): was refused and still changed something: \(found)") }
                    }
                }

                for (key, table) in [("documents", "documents"), ("pages", "scan_pages"), ("lines", "scan_lines")] {
                    let wanted = try #require(expected[key])
                    if key == "documents" {
                        // view_state is JSON text on both sides, but is not what this corpus is about
                        let count = try database.pool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM documents") ?? 0 }
                        #expect(count == wanted.arrayValue?.count, "\(name): documents end differently")
                        continue
                    }
                    if let found = difference(normalize(try rows(table, in: database)), wanted) { Issue.record("\(name): \(table) end differently: \(found)") }
                }
            }
        }

        #expect(scripts.count >= 5 && steps >= 60 && refusals >= 10, "the corpus was read: \(scripts.count) scripts, \(steps) steps, \(refusals) refusals")
        print("\nScan scripts: \(scripts.count) scripts, \(steps) steps (\(refusals) refused) gave the desktop's results and left its rows")
    }
}
