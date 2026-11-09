import Foundation
import Testing

@testable import CompositionCore

// The names and checks around a PDF's file against the desktop's own `attachmentNames.ts` and `documentNames.ts`, run over the inputs in
// apps/ios/scripts/document-names-oracle.mjs. The result is committed (apps/ios/conformance/document-names.json), so a plain `swift test`
// replays it; `apps/ios/scripts/conformance.sh` first checks that it is what the desktop makes now.

@Suite("PDF file names against the desktop")
struct DocumentNamesConformanceTests {
    private static let corpus: JSONValue? = {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("conformance/document-names.json")
        return (try? String(contentsOf: file, encoding: .utf8)).flatMap { try? JSONValue(parsing: $0) }
    }()

    private func cases(_ name: String) throws -> [JSONObject] {
        let corpus = try #require(Self.corpus, "apps/ios/conformance/document-names.json is missing or is not JSON")
        return try #require(corpus.objectValue?[name]?.arrayValue).compactMap(\.objectValue)
    }

    @Test("a PDF is stored under the name the desktop gives it")
    func storedNames() throws {
        let prefix = try #require(Self.corpus?.objectValue?["prefix"]?.stringValue)
        let all = try cases("storedNames")
        #expect(all.count >= 40)
        for entry in all {
            let fileName = try #require(entry["fileName"]?.stringValue), stored = try #require(entry["stored"]?.stringValue)
            #expect(DocumentNames.storedName(prefix: prefix, fileName: fileName) == stored, "\(fileName.debugDescription)")
        }
    }

    @Test("the name shown for a path, and the title of the note made for it, are the desktop's")
    func shownNames() throws {
        let paths = try cases("displayNames"), titles = try cases("titles")
        #expect(paths.count >= 8 && titles.count >= 20)
        for entry in paths {
            let path = try #require(entry["path"]?.stringValue), shown = try #require(entry["shown"]?.stringValue)
            #expect(DocumentNames.displayName(path) == shown, "\(path.debugDescription)")
        }
        for entry in titles {
            let path = try #require(entry["path"]?.stringValue), title = try #require(entry["title"]?.stringValue)
            #expect(DocumentNames.titleFromFileName(path) == title, "\(path.debugDescription)")
        }
    }

    @Test("a size in bytes is written in words as the desktop writes it")
    func sizes() throws {
        let all = try cases("sizes")
        #expect(all.count >= 25)
        for entry in all {
            let bytes = try #require(entry["bytes"]?.doubleValue), shown = try #require(entry["shown"]?.stringValue)
            #expect(DocumentNames.formatBytes(Int64(bytes)) == shown, "\(bytes)")
        }
    }

    @Test("bytes look like a PDF when the desktop says they do")
    func headers() throws {
        let all = try cases("heads")
        #expect(all.count >= 12)
        for entry in all {
            let name = try #require(entry["name"]?.stringValue), hex = try #require(entry["hex"]?.stringValue)
            let expected = try #require(entry["looksLikePdf"])
            let bytes = stride(from: 0, to: hex.count, by: 2).map { offset -> UInt8 in
                let start = hex.index(hex.startIndex, offsetBy: offset)
                return UInt8(hex[start..<hex.index(start, offsetBy: 2)], radix: 16) ?? 0
            }
            #expect(.bool(DocumentNames.looksLikePdf(bytes)) == expected, "\(name)")
        }
    }
}
