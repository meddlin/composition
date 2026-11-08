import Foundation
import GRDB
import Testing

@testable import CompositionCore

@Suite("Backup and restore")
struct BackupTests {
    private func location(_ scratch: Scratch, _ name: String) -> DataLocation {
        DataLocation(directory: scratch.directory.appendingPathComponent(name, isDirectory: true))
    }

    private func titles(_ database: CompositionDatabase) throws -> [String] {
        try database.listNotes().map(\.title).sorted()
    }

    // MARK: Round trip

    @Test("a backup restores into an empty data directory with every note, uuid, image and attached file")
    func roundTrip() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try populate(source)
            let notes = try database.listNotes()
            let file = scratch.directory.appendingPathComponent("backups/backup.tar.gz")

            let summary = try Backup.create(database: database, location: source, to: file)

            #expect(summary.counts == BackupCounts(notes: 2, groups: 0, trashedNotes: 1, trashedGroups: 0, images: 2, attachments: 1, todos: 0, archivedTodos: 0))
            #expect(summary.bytes > 0 && FileManager.default.fileExists(atPath: file.path))
            #expect(try FileManager.default.contentsOfDirectory(atPath: file.deletingLastPathComponent().path) == ["backup.tar.gz"],
                    "no scratch folder or .partial file is left beside the backup")

            let target = location(scratch, "target")
            let staged = try Backup.stage(file, in: target)
            #expect(staged.counts == summary.counts && staged.createdAt == summary.createdAt)
            #expect(staged.hasImages && staged.hasAttachments && staged.settings == nil)
            try Backup.apply(staged, to: target)

            let restored = try CompositionDatabase.open(in: target)
            #expect(try restored.listNotes() == notes, "same ids, titles, dates and uuids")
            #expect(try snapshotFiles(source.imagesURL) == snapshotFiles(target.imagesURL))
            #expect(try snapshotFiles(source.attachmentsURL) == snapshotFiles(target.attachmentsURL))
            #expect(try snapshotFiles(target.directory).keys.filter { $0.hasPrefix(".restore-") }.isEmpty)
            try restored.close()
        }
    }

    @Test("a backup of a brand-new database has no images or attachments, and restores")
    func empty() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try CompositionDatabase.open(in: source)
            let file = scratch.directory.appendingPathComponent("empty.tar.gz")
            let summary = try Backup.create(database: database, location: source, to: file)
            #expect(summary.counts == BackupCounts())

            let target = location(scratch, "target")
            let staged = try Backup.stage(file, in: target)
            #expect(!staged.hasImages && !staged.hasAttachments)
            try Backup.apply(staged, to: target)
            #expect(!FileManager.default.fileExists(atPath: target.imagesURL.path))
            try CompositionDatabase.open(in: target).close()
        }
    }

    @Test("a restore replaces what is there rather than merging")
    func replaces() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try populate(source, titles: ["From the backup"])
            let file = scratch.directory.appendingPathComponent("b.tar.gz")
            _ = try Backup.create(database: database, location: source, to: file)

            let target = location(scratch, "target")
            let existing = try populate(target, titles: ["Written later", "Also later"])
            try Data("extra".utf8).write(to: target.imagesURL.appendingPathComponent("later-bbbbbbbbbbbb.png"))
            try Data("extra".utf8).write(to: target.attachmentsURL.appendingPathComponent("later.txt"))
            try existing.close()

            try Backup.apply(try Backup.stage(file, in: target), to: target)

            let restored = try CompositionDatabase.open(in: target)
            #expect(try titles(restored) == ["From the backup"])
            #expect(try snapshotFiles(target.imagesURL).keys.sorted() == ["photo-aaaaaaaaaaaa.JPG", "route-map-3f9c2a71b0de.png"])
            #expect(try snapshotFiles(target.attachmentsURL).keys.sorted() == ["3f9c2a71b0de-report.pdf", "b.txt"])
            try restored.close()
        }
    }

    @Test("a backup with no attachments clears the attachments the iPad had")
    func clearsFolderTheBackupLacks() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try CompositionDatabase.open(in: source)
            let file = scratch.directory.appendingPathComponent("b.tar.gz")
            _ = try Backup.create(database: database, location: source, to: file)

            let target = location(scratch, "target")
            try populate(target).close()
            try Backup.apply(try Backup.stage(file, in: target), to: target)
            #expect(!FileManager.default.fileExists(atPath: target.attachmentsURL.path))
            #expect(!FileManager.default.fileExists(atPath: target.imagesURL.path))
        }
    }

    @Test("a hidden file or an odd name in the data folders is not put in the backup")
    func skipsWhatTheAppNeverMade() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try populate(source)
            try Data("x".utf8).write(to: source.imagesURL.appendingPathComponent(".DS_Store"))
            try Data("x".utf8).write(to: source.imagesURL.appendingPathComponent("notes.html"))
            try Data("x".utf8).write(to: source.attachmentsURL.appendingPathComponent(".hidden"))
            try FileManager.default.createDirectory(at: source.attachmentsURL.appendingPathComponent("subfolder"), withIntermediateDirectories: true)
            let file = scratch.directory.appendingPathComponent("b.tar.gz")

            let summary = try Backup.create(database: database, location: source, to: file)
            #expect(summary.counts.images == 2 && summary.counts.attachments == 1)  // the table row; files are checked next

            let staged = try Backup.stage(file, in: location(scratch, "target"))
            #expect(try snapshotFiles(staged.directory).keys.filter { $0.hasPrefix("app_data/") || $0.hasPrefix("attachments/") }.sorted()
                    == ["app_data/photo-aaaaaaaaaaaa.JPG", "app_data/route-map-3f9c2a71b0de.png", "attachments/3f9c2a71b0de-report.pdf", "attachments/b.txt"])
            Backup.discard(staged)
        }
    }

    // MARK: Refusals

    /// Builds an archive from (name, bytes) pairs, with a valid manifest and database unless told otherwise.
    private func craft(
        _ scratch: Scratch, extra: [(String, Data)] = [], manifest: Any? = nil, omitManifest: Bool = false,
        omitDatabase: Bool = false, database: Data? = nil
    ) throws -> URL {
        let seed = location(scratch, "seed-\(UUID().uuidString)")
        let seedDatabase = try CompositionDatabase.open(in: seed)
        try seedDatabase.close()
        let databaseBytes = try database ?? Data(contentsOf: seed.databaseURL)

        let file = scratch.directory.appendingPathComponent("crafted-\(UUID().uuidString).tar.gz")
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        let tar = TarWriter(gzip: try GzipWriter(file: handle))
        let manifestValue = manifest ?? ["format": "composition-backup", "version": 1, "createdAt": "2026-01-01T00:00:00.000Z", "counts": [String: Int]()] as [String: Any]
        if !omitManifest {
            try tar.addFile(named: "composition-backup.json", contents: try JSONSerialization.data(withJSONObject: manifestValue))
        }
        if !omitDatabase { try tar.addFile(named: "composition.db", contents: databaseBytes) }
        for (name, bytes) in extra { try tar.addFile(named: name, contents: bytes) }
        try tar.finish()
        return file
    }

    /// Restores `file` into a populated data directory, expects `error`, and checks nothing there changed.
    private func expectRefused(_ file: URL, _ error: BackupError, _ scratch: Scratch, sourceLocation: String = "live", comment: Comment? = nil) throws {
        let live = location(scratch, sourceLocation)
        if !FileManager.default.fileExists(atPath: live.databaseURL.path) { try populate(live).close() }
        let before = try snapshotFiles(live.directory)

        #expect(throws: error, comment) { try Backup.stage(file, in: live) }

        #expect(try snapshotFiles(live.directory) == before, "the data directory is untouched, with no .restore- leftovers")
        #expect(try FileManager.default.contentsOfDirectory(atPath: live.directory.path).filter { $0.hasPrefix(".restore-") }.isEmpty)
    }

    @Test("refuses a file that is not a backup, and one that does not exist")
    func notABackup() throws {
        try withScratch { scratch in
            let junk = scratch.directory.appendingPathComponent("junk.tar.gz")
            try Data((0..<5000).map { _ in UInt8.random(in: 0...255) }).write(to: junk)
            try expectRefused(junk, .damaged, scratch)
            try expectRefused(scratch.directory.appendingPathComponent("nope.tar.gz"), .cannotRead(scratch.directory.appendingPathComponent("nope.tar.gz").path), scratch)
        }
    }

    @Test("refuses names that climb out of the folder, are absolute, or are not a stored image or file")
    func unknownNames() throws {
        try withScratch { scratch in
            for name in [
                "app_data/../../escaped.png", "/tmp/escaped.png", "meili.log", "app_data/script.html", "app_data/sub/pic.png",
                "attachments/.hidden", "attachments/", "app_data/.png", "app_data/pic.png/", "../x", "composition.db/extra",
                "settings.json.bak", "app_data/a b.png", "app_data/pic.png\n",
            ] {
                try expectRefused(try craft(scratch, extra: [(name, Data("x".utf8))]), .unknownFile(name), scratch, comment: "\(name)")
            }
            #expect(!FileManager.default.fileExists(atPath: "/tmp/escaped.png"))
            #expect(!FileManager.default.fileExists(atPath: scratch.directory.deletingLastPathComponent().appendingPathComponent("escaped.png").path))
        }
    }

    @Test("refuses a backup from a newer version, and one with no manifest or a wrong one")
    func manifest() throws {
        try withScratch { scratch in
            try expectRefused(try craft(scratch, manifest: ["format": "composition-backup", "version": 99, "createdAt": "x", "counts": [String: Int]()] as [String: Any]), .newerFormat(99), scratch)
            try expectRefused(try craft(scratch, manifest: ["hello": 1]), .notABackup, scratch)
            try expectRefused(try craft(scratch, manifest: ["format": "something-else", "version": 1]), .notABackup, scratch)
            try expectRefused(try craft(scratch, manifest: ["format": "composition-backup", "version": "1"]), .notABackup, scratch)
            try expectRefused(try craft(scratch, omitManifest: true), .notABackup, scratch)
        }
    }

    @Test("refuses an archive with no database")
    func noDatabase() throws {
        try withScratch { scratch in
            try expectRefused(try craft(scratch, omitDatabase: true), .noDatabase, scratch)
        }
    }

    @Test("refuses a database that is damaged, or is not ours")
    func damagedDatabase() throws {
        try withScratch { scratch in
            let garbage = Data((0..<8192).map { _ in UInt8.random(in: 0...255) })
            try expectRefused(try craft(scratch, database: garbage), .databaseUnopenable, scratch)

            // A valid SQLite database with no notes table.
            let other = scratch.directory.appendingPathComponent("other.db")
            let queue = try DatabaseQueue(path: other.path)
            try queue.write { try $0.execute(sql: "CREATE TABLE unrelated (x)") }
            try queue.close()
            try expectRefused(try craft(scratch, database: Data(contentsOf: other)), .databaseDamaged, scratch)

            // A real database with a page overwritten.
            let seed = location(scratch, "seed-damaged")
            try populate(seed, titles: (0..<200).map { "Note \($0)" }).close()
            var bytes = try Data(contentsOf: seed.databaseURL)
            bytes.replaceSubrange(8192..<12288, with: Data((0..<4096).map { _ in UInt8.random(in: 0...255) }))
            let result = Result { try Backup.stage(try craft(scratch, database: bytes), in: location(scratch, "live-damaged")) }
            #expect(throws: BackupError.self) { try result.get() }
        }
    }

    @Test("refuses an entry listed twice, and a settings file that is not JSON or is too large")
    func duplicatesAndSettings() throws {
        try withScratch { scratch in
            try expectRefused(try craft(scratch, extra: [("app_data/a-aaaaaaaaaaaa.png", Data("1".utf8)), ("app_data/a-aaaaaaaaaaaa.png", Data("2".utf8))]),
                              .duplicateEntry("app_data/a-aaaaaaaaaaaa.png"), scratch)
            try expectRefused(try craft(scratch, extra: [("composition.db", Data())]), .duplicateEntry("composition.db"), scratch)
            try expectRefused(try craft(scratch, extra: [("settings.json", Data("{not json".utf8))]), .jsonDamaged("settings"), scratch)
            try expectRefused(try craft(scratch, extra: [("settings.json", Data(count: 2 * 1024 * 1024))]), .jsonTooLarge("settings"), scratch)
        }
    }

    @Test("a settings file in the backup is handed back as it was, and not applied")
    func settingsAreKept() throws {
        try withScratch { scratch in
            let settings = Data(#"{"theme":"dracula","favorites":[1,2]}"#.utf8)
            let file = try craft(scratch, extra: [("settings.json", settings)])
            let staged = try Backup.stage(file, in: location(scratch, "target"))
            #expect(staged.settings == settings)
            Backup.discard(staged)
        }
    }

    // MARK: Rollback

    @Test("a restore that fails halfway puts the previous data back")
    func rollsBack() throws {
        try withScratch { scratch in
            let live = location(scratch, "live")
            let database = try populate(live)
            try database.close()
            let before = try snapshotFiles(live.directory)

            // A staged backup whose database file is missing: the swap fails after the old data was moved aside.
            let directory = live.directory.appendingPathComponent(".restore-failing", isDirectory: true)
            try FileManager.default.createDirectory(at: directory.appendingPathComponent("app_data"), withIntermediateDirectories: true)
            try Data("theirs".utf8).write(to: directory.appendingPathComponent("app_data/theirs-bbbbbbbbbbbb.png"))
            let staged = StagedBackup(directory: directory, createdAt: "x", counts: BackupCounts(), settings: nil, hasImages: true, hasAttachments: false, hasDocuments: false)

            #expect {
                try Backup.apply(staged, to: live)
            } throws: { error in
                (error as? BackupError).map { if case .restoreFailed = $0 { true } else { false } } ?? false
            }

            // Everything is back; the only difference is the scratch folder, kept so nothing is lost.
            var after = try snapshotFiles(live.directory)
            after = after.filter { !$0.key.hasPrefix(".restore-failing/") }
            #expect(after == before)
            let restored = try CompositionDatabase.open(in: live)
            #expect(try titles(restored) == ["Alpha", "Beta"])
            try restored.close()
        }
    }

    // MARK: Large

    @Test("a large attachment is backed up and restored byte for byte")
    func largeAttachment() throws {
        let megabytes = Int(ProcessInfo.processInfo.environment["COMPOSITION_LARGE_MB"] ?? "") ?? 64
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try populate(source)
            let big = source.attachmentsURL.appendingPathComponent("big-aaaaaaaaaaaa.bin")
            try writeRandomFile(at: big, megabytes: megabytes)
            let hash = try sha256(of: big)

            let file = scratch.directory.appendingPathComponent("large.tar.gz")
            let summary = try Backup.create(database: database, location: source, to: file)
            #expect(summary.bytes > Int64(megabytes) * 1024 * 1024 / 2)

            let target = location(scratch, "target")
            try Backup.apply(try Backup.stage(file, in: target), to: target)
            #expect(try sha256(of: target.attachmentsURL.appendingPathComponent("big-aaaaaaaaaaaa.bin")) == hash)
            #expect(try FileManager.default.attributesOfItem(atPath: target.attachmentsURL.appendingPathComponent("big-aaaaaaaaaaaa.bin").path)[.size] as? Int == megabytes * 1024 * 1024)
        }
    }

    @Test("the PDFs a note owns, with their marks and uuids, ride through a backup and a restore")
    func pdfsInABackup() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            try FileManager.default.createDirectory(at: source.directory, withIntermediateDirectories: true)
            let database = try CompositionDatabase.open(at: source.databaseURL)
            defer { try? database.close() }
            let note = try database.createNote(title: "Paper")
            try database.pool.write { db in
                try db.execute(
                    sql: "INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, created_at) VALUES (?, 'Paper.pdf', 'p1-Paper.pdf', 'abc', 9, 3, '2026-11-08T00:00:00.000Z')",
                    arguments: [note.id])
                try db.execute(sql: "INSERT INTO pdf_annotations (document_id, page, kind, color, created_at, updated_at) VALUES (1, 0, 'highlight', 'yellow', 'x', 'x')")
                try db.execute(sql: "INSERT INTO pdf_bookmarks (document_id, page, created_at) VALUES (1, 2, 'x')")
            }
            let pdf = Data("%PDF-1.7\n".utf8)
            try FileManager.default.createDirectory(at: source.documentsURL, withIntermediateDirectories: true)
            try pdf.write(to: source.documentsURL.appendingPathComponent("p1-Paper.pdf"))
            let file = scratch.directory.appendingPathComponent("backups/backup.tar.gz")

            let summary = try Backup.create(database: database, location: source, to: file)
            #expect(summary.counts.documents == 1)

            let target = location(scratch, "target")
            let staged = try Backup.stage(file, in: target)
            #expect(staged.hasDocuments && staged.counts.documents == 1)
            try Backup.apply(staged, to: target)
            #expect(try Data(contentsOf: target.documentsURL.appendingPathComponent("p1-Paper.pdf")) == pdf)
            let restored = try CompositionDatabase.open(at: target.databaseURL)
            defer { try? restored.close() }
            let uuids = try restored.pool.read { db in
                try (String.fetchAll(db, sql: "SELECT uuid FROM documents") + String.fetchAll(db, sql: "SELECT uuid FROM pdf_annotations") + String.fetchAll(db, sql: "SELECT uuid FROM pdf_bookmarks"))
            }
            #expect(uuids.count == 3 && uuids.allSatisfy { $0.count == 32 }, "every row has a uuid, filled by the trigger")
        }
    }
}
