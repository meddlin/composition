import CryptoKit
import Foundation
import GRDB
import Testing

@testable import CompositionCore

// Backups against the desktop's own code, in both directions (see ConformanceTests.swift for how to run them):
//
//   desktop -> Swift   desktop-backup*.tar.gz are made by the real `createBackup`. Swift restores each and must find
//                      exactly what the desktop says it put in: the notes and their uuids, the Trash Can, every file by hash.
//   Swift -> desktop   Swift then backs up what it restored, to swift-backup*.tar.gz plus a description of it. The
//                      TypeScript side restores those with the real `stageBackup` and `applyStagedBackup`, opens the
//                      result with the real `db.ts`, and compares (apps/web/scripts/ios-conformance-fixtures.test.ts).

/// What a data directory holds. The desktop writes this as `*.expected.json`; Swift writes the same shape for its own backups.
private struct Expected: Codable, Equatable {
    struct Note: Codable, Equatable {
        var id: Int64
        var uuid: String
        var title: String
    }
    var counts: BackupCounts
    var notes: [Note]
    var trashedNotes: [Note]
    var files: [String: String]
}

@Suite("Backups against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct BackupConformanceTests {
    private func describe(_ location: DataLocation, counts: BackupCounts) throws -> Expected {
        let notes = try rawConnection(location.databaseURL).read { db -> ([Expected.Note], [Expected.Note]) in
            func rows(_ table: String) throws -> [Expected.Note] {
                try Row.fetchAll(db, sql: "SELECT id, uuid, title FROM \(table) ORDER BY id")
                    .map { Expected.Note(id: $0["id"], uuid: $0["uuid"], title: $0["title"]) }
            }
            return (try rows("notes"), try rows("trashed_notes"))
        }
        var files: [String: String] = [:]
        for folder in [BackupNames.imageDirectory, BackupNames.attachmentDirectory] {
            let directory = location.directory.appendingPathComponent(folder)
            for name in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] {
                files["\(folder)/\(name)"] = try sha256(of: directory.appendingPathComponent(name))
            }
        }
        return Expected(counts: counts, notes: notes.0, trashedNotes: notes.1, files: files)
    }

    @Test("restores a backup the desktop made, and backs up the result for the desktop to restore", arguments: ["desktop-backup", "desktop-backup-large"])
    func desktopToSwiftAndBack(name: String) throws {
        let directory = try #require(conformanceDirectory)
        let archive = directory.appendingPathComponent("\(name).tar.gz")
        try #require(FileManager.default.fileExists(atPath: archive.path), "missing \(name).tar.gz: run the desktop step first")
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("\(name).expected.json")))

        try withScratch { scratch in
            // Desktop -> Swift
            let target = DataLocation(directory: scratch.directory.appendingPathComponent("ipad", isDirectory: true))
            let staged = try Backup.stage(archive, in: target)
            #expect(staged.counts == expected.counts, "the counts Swift reads from the database match the desktop's own")
            try Backup.apply(staged, to: target)

            let database = try CompositionDatabase.open(in: target)  // the Swift schema pass runs on the desktop's database
            let restored = try describe(target, counts: staged.counts)
            #expect(restored.notes == expected.notes, "same notes, ids and uuids")
            #expect(restored.trashedNotes == expected.trashedNotes)
            #expect(restored.files == expected.files, "every image and attachment, byte for byte")
            #expect(!restored.files.isEmpty && !expected.notes.isEmpty)

            // Swift -> desktop
            let output = directory.appendingPathComponent(name.replacingOccurrences(of: "desktop", with: "swift") + ".tar.gz")
            try? FileManager.default.removeItem(at: output)
            let summary = try Backup.create(database: database, location: target, to: output)
            #expect(summary.counts == expected.counts)
            try database.close()

            let description = try describe(target, counts: summary.counts)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(description).write(to: output.deletingPathExtension().deletingPathExtension().appendingPathExtension("expected.json"))
        }
    }
}
