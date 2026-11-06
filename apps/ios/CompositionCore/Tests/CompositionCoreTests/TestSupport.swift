import CryptoKit
import Foundation
import GRDB

@testable import CompositionCore

/// A scratch directory removed when the test is done.
struct Scratch {
    let directory: URL

    init() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("composition-core-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    var databaseURL: URL { directory.appendingPathComponent("composition.db") }

    func remove() {
        try? FileManager.default.removeItem(at: directory)
    }
}

func withScratch<T>(_ body: (Scratch) throws -> T) throws -> T {
    let scratch = try Scratch()
    defer { scratch.remove() }
    return try body(scratch)
}

/// SHA-256 of the main database file. Taken after a clean close, when the write-ahead log has been folded in.
func fingerprint(_ url: URL) throws -> String {
    SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
}

/// A raw connection for seeding or inspecting a database without going through `CompositionDatabase`.
func rawConnection(_ url: URL) throws -> DatabaseQueue {
    try DatabaseQueue(path: url.path)
}

func isUuid(_ value: String?) -> Bool {
    guard let value, value.count == 32 else { return false }
    return value.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
}
