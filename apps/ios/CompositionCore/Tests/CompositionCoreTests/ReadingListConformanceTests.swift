import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The Reading List against the desktop's own code. fixtures/conformance/reading-list.json holds what `readingList.ts`, `webSettings.ts`
// and `readingListService.ts` make of a long list of inputs and of one session on a fresh database (apps/web/src/lib/composition/
// readingListConformance.test.ts writes it, and fails when the desktop no longer makes the same file). The file is committed, so a
// plain `swift test` replays it. See fixtures/conformance/README.md.

private let corpus: JSONValue? = corpusDirectory
    .flatMap { try? String(contentsOf: $0.appendingPathComponent("reading-list.json"), encoding: .utf8) }
    .flatMap { try? JSONValue(parsing: $0) }

private func section(_ name: String) throws -> [JSONObject] {
    let corpus = try #require(corpus, "fixtures/conformance/reading-list.json is missing or is not JSON")
    return try #require(corpus.objectValue?[name]?.arrayValue, "section \(name)").map { $0.objectValue ?? JSONObject() }
}

/// A JSON value as `JSONSerialization` hands it over, which is what the settings parsers are given.
private func foundation(_ value: JSONValue) -> Any {
    switch value {
    case .null: NSNull()
    case .bool(let flag): NSNumber(value: flag)
    case .number(let number): NSNumber(value: number)
    case .string(let text): text
    case .array(let items): items.map(foundation)
    case .object(let members): Dictionary(members.members.map { ($0.key, foundation($0.value)) }, uniquingKeysWith: { $1 })
    }
}

/// A short form of a long input, for a failure message.
private func shown(_ text: String) -> String {
    let escaped = text.unicodeScalars.map { $0.isASCII && $0.value >= 0x20 && $0.value < 0x7f ? String($0) : String(format: "\\u{%X}", $0.value) }.joined()
    return escaped.count > 90 ? String(escaped.prefix(60)) + "…(\(text.utf16.count) units)" : escaped
}

private func itemJSON(_ item: ReadingItem) -> JSONValue {
    .object(JSONObject([
        "id": .number(Double(item.id)), "url": .string(item.url), "title": .string(item.title), "read": .bool(item.read),
        "createdAt": .string(item.createdAt), "updatedAt": .string(item.updatedAt),
    ]))
}

private func rowJSON(_ row: Row) -> JSONValue {
    .object(JSONObject(row.map { column, value -> JSONObject.Member in
        switch value.storage {
        case .null: JSONObject.Member(column, .null)
        case .int64(let number): JSONObject.Member(column, .number(Double(number)))
        case .double(let number): JSONObject.Member(column, .number(number))
        case .string(let text): JSONObject.Member(column, .string(text))
        case .blob(let data): JSONObject.Member(column, .string(data.base64EncodedString()))
        }
    }))
}

@Suite("The Reading List against the desktop", .enabled(if: corpus != nil, "fixtures/conformance/reading-list.json is not there"))
struct ReadingListConformanceTests {
    @Test("the limits, and the plugin is off until someone turns it on")
    func constants() throws {
        let constants = try #require(corpus?.objectValue?["constants"]?.objectValue)
        #expect(ReadingLinks.maxURLLength == constants["maxUrlLength"]?.integerValue)
        #expect(ReadingLinks.maxTitleLength == constants["maxTitleLength"]?.integerValue)
        #expect(PluginSettings.readingListEnabled(settingsValue: nil) == (constants["enabledWithoutAChoice"] == .bool(true)))
    }

    @Test("every link is stored as the desktop stores it, or refused with the desktop's words")
    func urls() throws {
        let cases = try section("urls")
        #expect(cases.count > 150)
        for entry in cases {
            let input = try #require(entry["input"]?.stringValue)
            let got: String
            switch ReadingLinks.normalize(input) {
            case .success(let url): got = "url " + url
            case .failure(let problem): got = "error " + (problem.errorDescription ?? "")
            }
            let expected = entry["url"]?.stringValue.map { "url " + $0 } ?? "error " + (entry["error"]?.stringValue ?? "?")
            #expect(got == expected, "\(shown(input))")
        }
    }

    @Test("a link is called by its host until its page says otherwise")
    func hostLabels() throws {
        for entry in try section("hostLabels") {
            let url = try #require(entry["url"]?.stringValue)
            #expect(ReadingLinks.hostLabel(url) == entry["label"]?.stringValue, "\(shown(url))")
        }
        for entry in try section("labels") {
            let url = try #require(entry["url"]?.stringValue), title = try #require(entry["title"]?.stringValue)
            #expect(ReadingLinks.label(url: url, title: title) == entry["label"]?.stringValue, "\(shown(url)) \(shown(title))")
        }
    }

    @Test("a page title is stored on one line, trimmed and cut, as on the desktop")
    func titles() throws {
        for entry in try section("titles") {
            let title = try #require(entry["title"]?.stringValue)
            #expect(ReadingLinks.cleanTitle(title) == entry["cleaned"]?.stringValue, "\(shown(title))")
        }
    }

    @Test("unread links come first, then read ones, each oldest first")
    func sorting() throws {
        for entry in try section("sorting") {
            let items = (entry["items"]?.arrayValue ?? []).compactMap(\.objectValue).map {
                ReadingItem(id: Int64($0["id"]?.integerValue ?? 0), url: "", read: $0["read"] == .bool(true))
            }
            let expected = (entry["sorted"]?.arrayValue ?? []).compactMap { $0.integerValue.map(Int64.init) }
            #expect(ReadingLinks.sorted(items).map(\.id) == expected)
        }
    }

    @Test("a settings file has the Reading List on only when it says true")
    func plugins() throws {
        for entry in try section("plugins") {
            let value = entry["plugins"].map(foundation)
            #expect(PluginSettings.readingListEnabled(settingsValue: value) == (entry["enabled"] == .bool(true)), "\(String(describing: entry["plugins"]))")
        }
    }

    @Test("a session through the store returns and stores what the desktop's service did, step by step")
    func script() throws {
        let steps = try section("script")
        #expect(steps.count > 20)
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            for (index, step) in steps.enumerated() {
                let op = try #require(step["op"]?.stringValue)
                let at = try #require(step["at"]?.stringValue.flatMap(Timestamp.milliseconds(from:)).map(Timestamp.date(milliseconds:)))
                let id = Int64(step["id"]?.integerValue ?? 0)
                var result: JSONValue
                do {
                    switch op {
                    case "list": result = .object(JSONObject(["items": .array(try database.readingItems().map(itemJSON))]))
                    case "add": result = .object(JSONObject(["item": itemJSON(try database.addReadingItem(step["input"]?.stringValue ?? "", now: at))]))
                    case "setTitle":
                        result = .object(JSONObject(["item": itemJSON(try database.setReadingItemTitle(id: id, title: step["title"]?.stringValue ?? "", now: at))]))
                    case "setRead":
                        result = .object(JSONObject(["item": itemJSON(try database.setReadingItemRead(id: id, read: step["read"] == .bool(true), now: at))]))
                    case "delete":
                        try database.deleteReadingItem(id: id)
                        result = .object(JSONObject())
                    default:
                        Issue.record("unknown step \(op)")
                        continue
                    }
                } catch let error as ReadingListError {
                    result = .object(JSONObject(["error": .string(error.errorDescription ?? "")]))
                }
                #expect(result == step["result"], "step \(index) \(op): result")
                let rows = try database.pool.read { try Row.fetchAll($0, sql: "SELECT * FROM reading_list ORDER BY id") }.map(rowJSON)
                #expect(JSONValue.array(rows) == step["rows"], "step \(index) \(op): rows")
            }
        }
    }
}
