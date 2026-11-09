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

// MARK: - Files and processes

/// `byteCount` random bytes written to `url` a megabyte at a time, so making a large file does not itself hold it in memory.
func writeRandomFile(at url: URL, megabytes: Int) throws {
    FileManager.default.createFile(atPath: url.path, contents: nil)
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    var block = Data(count: 1024 * 1024)
    for _ in 0..<megabytes {
        try autoreleasepool {
            block.withUnsafeMutableBytes { _ = SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) }
            try handle.write(contentsOf: block)
        }
    }
}

/// SHA-256 of a file, read in pieces.
func sha256(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    var finished = false
    while !finished {
        try autoreleasepool {
            if let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty { hasher.update(data: chunk) } else { finished = true }
        }
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

/// A data directory with a few notes, a trashed note, an attachment record, two images and two attached files.
@discardableResult
func populate(_ location: DataLocation, titles: [String] = ["Alpha", "Beta"]) throws -> CompositionDatabase {
    let database = try CompositionDatabase.open(in: location)
    try database.pool.write { db in
        for title in titles {
            try db.execute(
                sql: """
                    INSERT INTO notes (title, content, created_at, updated_at, notebook_id)
                    VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 1)
                    """,
                arguments: [title, "# \(title)\n\nbody of \(title)\n"])
        }
        try db.execute(
            sql: """
                INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at, notebook_id)
                VALUES (900, 'Deleted', 'x', 'x', '2026-01-03T00:00:00.000Z', 1)
                """)
        try db.execute(
            sql: """
                INSERT INTO attachments (note_id, file_name, stored_name, size, created_at)
                VALUES (1, 'report.pdf', '3f9c2a71b0de-report.pdf', 5, 'x')
                """)
    }
    try FileManager.default.createDirectory(at: location.imagesURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: location.attachmentsURL, withIntermediateDirectories: true)
    try Data("png-bytes-1".utf8).write(to: location.imagesURL.appendingPathComponent("route-map-3f9c2a71b0de.png"))
    try Data("jpg-bytes-2".utf8).write(to: location.imagesURL.appendingPathComponent("photo-aaaaaaaaaaaa.JPG"))
    try Data("hello".utf8).write(to: location.attachmentsURL.appendingPathComponent("3f9c2a71b0de-report.pdf"))
    try Data("notes".utf8).write(to: location.attachmentsURL.appendingPathComponent("b.txt"))
    return database
}

/// Every regular file under a directory, as relative path to bytes. Hidden scratch folders count, so a leftover shows.
func snapshotFiles(_ directory: URL) throws -> [String: Data] {
    var result: [String: Data] = [:]
    let base = directory.standardizedFileURL.path
    guard let walker = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey]) else { return [:] }
    for case let url as URL in walker where (try url.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true {
        let path = url.standardizedFileURL.path
        result[String(path.dropFirst(base.count + 1))] = try Data(contentsOf: url)
    }
    return result
}

#if os(macOS)
/// Runs a system tool and returns its standard output. macOS only: iOS has no `Process`.
@discardableResult
func run(_ tool: String, _ arguments: [String], input: Data? = nil, environment: [String: String] = [:]) throws -> Data {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tool)
    process.arguments = arguments
    process.environment = ProcessInfo.processInfo.environment.merging(environment) { $1 }
    let output = Pipe()
    process.standardOutput = output
    process.standardError = Pipe()
    if let input {
        let pipe = Pipe()
        process.standardInput = pipe
        try process.run()
        pipe.fileHandleForWriting.write(input)
        try pipe.fileHandleForWriting.close()
    } else {
        try process.run()
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw CocoaError(.executableNotLoadable) }
    return data
}
#endif

/// Where the desktop-made fixtures are (see ConformanceTests.swift), or nil when the conformance tests should skip.
let conformanceDirectory: URL? = ProcessInfo.processInfo.environment["COMPOSITION_CONFORMANCE_DIR"]
    .map { URL(fileURLWithPath: $0, isDirectory: true) }

/// `fixtures/conformance` of this checkout: the shared corpus the TypeScript and Swift cores both read. Unlike the files in
/// `conformanceDirectory` it is committed, so a test that reads only from it needs no variable. Nil when the tests run somewhere
/// the source tree is not.
let corpusDirectory: URL? = {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<6 { url.deleteLastPathComponent() }
    url.appendPathComponent("fixtures/conformance", isDirectory: true)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
}()
