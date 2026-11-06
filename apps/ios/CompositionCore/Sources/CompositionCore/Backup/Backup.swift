import Foundation
import GRDB

// Backing up and restoring everything Composition keeps, in the format the desktop writes and reads
// (docs/architecture/backup-restore.md, `backup.ts`): one `.tar.gz` that plain `tar` can open.
//
//   composition-backup.json   what this is, the format version, when, counts
//   settings.json             optional: favorites, colour scheme and saved city, and every other key the desktop keeps (see `SettingsStore`)
//   composition.db            a consistent snapshot of the database (VACUUM INTO)
//   app_data/<image>          every pasted image
//   attachments/<file>        every attached file
//
// Restoring is two steps so nothing is touched until the file is known to be good: `stage` unpacks and checks it in a
// scratch folder, and `apply` swaps it in, with a rollback if anything fails halfway.

/// Where the iPad keeps its data: the same layout as the desktop's data directory.
public struct DataLocation: Sendable, Equatable {
    public let directory: URL

    public init(directory: URL) { self.directory = directory }

    public var databaseURL: URL { directory.appendingPathComponent("composition.db") }
    /// Pasted images.
    public var imagesURL: URL { directory.appendingPathComponent(BackupNames.imageDirectory, isDirectory: true) }
    /// Attached files.
    public var attachmentsURL: URL { directory.appendingPathComponent(BackupNames.attachmentDirectory, isDirectory: true) }
}

/// How many of each thing a backup holds, under the names the desktop's manifest uses.
public struct BackupCounts: Codable, Equatable, Sendable {
    public var notes = 0
    public var groups = 0
    public var trashedNotes = 0
    public var trashedGroups = 0
    public var images = 0
    public var attachments = 0
    public var todos = 0
    public var archivedTodos = 0
}

public struct BackupSummary: Equatable, Sendable {
    public let file: URL
    public let bytes: Int64
    public let createdAt: String
    public let counts: BackupCounts
}

/// A backup unpacked and checked, waiting to be applied or discarded.
public struct StagedBackup: Sendable {
    /// The scratch folder holding the unpacked backup; remove it with `Backup.discard`.
    public let directory: URL
    public let createdAt: String
    public let counts: BackupCounts
    /// The backup's `settings.json` as it was, or nil when it had none. `apply` writes it to the data folder as it is.
    public let settings: Data?
    public let hasImages: Bool
    public let hasAttachments: Bool
}

enum BackupNames {
    static let format = "composition-backup"
    static let formatVersion = 1
    static let manifest = "composition-backup.json"
    static let settings = "settings.json"
    static let database = "composition.db"
    static let imageDirectory = "app_data"
    static let attachmentDirectory = "attachments"
    /// SQLite's side files; present only while a connection is open, or after a crash.
    static let databaseSuffixes = ["-wal", "-shm", "-journal"]
    /// Manifest and settings are small; anything bigger is not one.
    static let maxJSONBytes = 1024 * 1024

    private static func isAlphanumeric(_ byte: UInt8) -> Bool {
        (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) || (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte)
            || (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(byte)
    }

    /// `^[A-Za-z0-9][A-Za-z0-9._-]*$`: one path segment, no leading dot.
    static func isStoredName(_ name: String) -> Bool {
        let bytes = Array(name.utf8)
        guard let first = bytes.first, isAlphanumeric(first) else { return false }
        return bytes.allSatisfy { isAlphanumeric($0) || $0 == UInt8(ascii: ".") || $0 == UInt8(ascii: "_") || $0 == UInt8(ascii: "-") }
    }

    /// `imageRefs.ts`: `^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$`, case-insensitive on the extension.
    static func isImageName(_ name: String) -> Bool {
        guard isStoredName(name), let dot = name.lastIndex(of: ".") else { return false }
        let stem = name[name.startIndex..<dot]
        guard !stem.isEmpty else { return false }
        return ["png", "jpg", "jpeg", "gif", "webp"].contains(name[name.index(after: dot)...].lowercased())
    }
}

public enum Backup {
    // MARK: Creating

    /// Writes a backup of `database` and the files in `location` to exactly `file`. The snapshot is taken with
    /// `VACUUM INTO`, which is consistent while the app is writing (copying a WAL-mode database by hand is not). Written
    /// to a temporary name and renamed, so `file` is never a half-written archive.
    ///
    /// The data folder's `settings.json` goes in when there is a usable one (a JSON object, not over 1 MB), exactly as it is,
    /// which `SettingsStore` keeps as the desktop wrote it. A backup of an iPad with none has none, and the desktop then keeps
    /// its own settings; with one, a restore *replaces* the desktop's settings with it (`service.ts`), so the file must never be partial.
    public static func create(
        database: CompositionDatabase, location: DataLocation, to file: URL, now: Date = Date()
    ) throws -> BackupSummary {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let scratch = file.deletingLastPathComponent()
            .appendingPathComponent(".composition-backup-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: scratch, withIntermediateDirectories: false)
        defer { try? fileManager.removeItem(at: scratch) }

        let snapshot = scratch.appendingPathComponent(BackupNames.database)
        try database.pool.writeWithoutTransaction { db in
            try db.execute(sql: "VACUUM INTO ?", arguments: [snapshot.path])
        }
        var counts = try countRows(in: snapshot)

        let images = try storedFiles(in: location.imagesURL).filter(BackupNames.isImageName)
        let attachments = try storedFiles(in: location.attachmentsURL).filter(BackupNames.isStoredName)
        counts.images = images.count
        let createdAt = Timestamp.now(now)

        let settings = usableSettings(at: location.settingsURL)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let manifest = try encoder.encode(Manifest(format: BackupNames.format, version: BackupNames.formatVersion, createdAt: createdAt, counts: counts))

        let partial = URL(fileURLWithPath: file.path + ".partial")
        fileManager.createFile(atPath: partial.path, contents: nil, attributes: [.posixPermissions: 0o600])
        do {
            let output = try FileHandle(forWritingTo: partial)
            defer { try? output.close() }
            let tar = TarWriter(gzip: try GzipWriter(file: output), now: now)
            try tar.addFile(named: BackupNames.manifest, contents: manifest + Data("\n".utf8))
            if let settings { try tar.addFile(named: BackupNames.settings, contents: settings) }
            try tar.addFile(named: BackupNames.database, from: snapshot)
            for name in images {
                try tar.addFile(named: "\(BackupNames.imageDirectory)/\(name)", from: location.imagesURL.appendingPathComponent(name))
            }
            for name in attachments {
                try tar.addFile(named: "\(BackupNames.attachmentDirectory)/\(name)", from: location.attachmentsURL.appendingPathComponent(name))
            }
            try tar.finish()
            try output.close()
            if fileManager.fileExists(atPath: file.path) { try fileManager.removeItem(at: file) }
            try fileManager.moveItem(at: partial, to: file)
        } catch {
            try? fileManager.removeItem(at: partial)
            throw error
        }
        let bytes = (try fileManager.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
        return BackupSummary(file: file, bytes: bytes, createdAt: createdAt, counts: counts)
    }

    /// The bytes of `settings.json` when it is a JSON object small enough to be one.
    private static func usableSettings(at url: URL) -> Data? {
        guard let data = try? Data(contentsOf: url), data.count <= BackupNames.maxJSONBytes,
            (try? JSONSerialization.jsonObject(with: data)) is [String: Any]
        else { return nil }
        return data
    }

    private struct Manifest: Codable {
        let format: String
        let version: Int
        let createdAt: String
        let counts: BackupCounts
    }

    /// The regular, non-hidden files of a folder, by name; a missing folder has none.
    private static func storedFiles(in directory: URL) throws -> [String] {
        let entries: [URL]
        do {
            entries = try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.isRegularFileKey], options: [])
        } catch CocoaError.fileReadNoSuchFile {
            return []
        } catch CocoaError.fileNoSuchFile {
            return []
        }
        return entries
            .filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
            .map(\.lastPathComponent)
            .filter { !$0.hasPrefix(".") }
            .sorted()
    }

    // MARK: Reading what is in a database

    /// Opens a database file that nothing else is using, for reading. `immutable=1` matters: a file whose header says WAL
    /// mode (a database copied after a clean close, rather than written by `VACUUM INTO`) cannot be opened by a plain
    /// read-only connection, which would need to create its `-wal` and `-shm` files. The desktop opens such a file, so
    /// an archive it restores must not be refused here. Immutable also means no side files are ever created.
    private static func readOnly(_ url: URL) throws -> DatabaseQueue {
        var configuration = Configuration()
        configuration.readonly = true
        let path = url.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? url.path
        return try DatabaseQueue(path: "file:\(path)?immutable=1", configuration: configuration)
    }

    /// Row counts of a database file, opened read-only. A table or column an older version never created counts as 0, so
    /// a backup from before the weekly cycle (no `archived_at`) reads as all live to-dos.
    private static func countRows(in url: URL) throws -> BackupCounts {
        try readOnly(url).read { db in
            func count(_ table: String, where condition: String = "1") -> Int {
                (try? Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table) WHERE \(condition)")) ?? 0
            }
            var counts = BackupCounts()
            counts.notes = count("notes")
            counts.groups = count("groups")
            counts.trashedNotes = count("trashed_notes")
            counts.trashedGroups = count("trashed_groups")
            counts.attachments = count("attachments")
            counts.archivedTodos = count("todos", where: "archived_at IS NOT NULL")
            counts.todos = count("todos") - counts.archivedTodos
            return counts
        }
    }

    /// Throws unless `url` is an intact SQLite database with a notes table.
    private static func assertUsableDatabase(_ url: URL) throws {
        let queue: DatabaseQueue
        do { queue = try readOnly(url) } catch { throw BackupError.databaseUnopenable }
        do {
            let ok = try queue.read { db -> Bool in
                let check = try String.fetchOne(db, sql: "PRAGMA quick_check")
                let hasNotes = try Int.fetchOne(db, sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'")
                return check == "ok" && hasNotes != nil
            }
            if !ok { throw BackupError.databaseDamaged }
        } catch let error as BackupError {
            throw error
        } catch {
            throw BackupError.databaseDamaged
        }
    }

    // MARK: Restoring

    /// Unpacks and validates the backup at `file` into a scratch folder inside `location`, the same disk the files will
    /// end up on, so the swap is a rename. Nothing outside the scratch folder is touched. Every entry name is checked
    /// against the shapes the app itself generates, so a hostile archive cannot write outside the folder or smuggle in a
    /// file the app would later serve or open.
    public static func stage(_ file: URL, in location: DataLocation) throws -> StagedBackup {
        let fileManager = FileManager.default
        guard fileManager.isReadableFile(atPath: file.path) else { throw BackupError.cannotRead(file.path) }
        try fileManager.createDirectory(at: location.directory, withIntermediateDirectories: true)
        let directory = location.directory.appendingPathComponent(".restore-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(
            at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])

        do {
            var manifest: Manifest?
            var settings: Data?
            var hasDatabase = false
            var seen = Set<String>()
            var images = 0
            var attachments = 0

            try TarReader.forEachFile(in: file) { entry in
                guard seen.insert(entry.name).inserted else { throw BackupError.duplicateEntry(entry.name) }

                if entry.name == BackupNames.manifest {
                    manifest = try parseManifest(try readJSON(entry, what: "description"))
                    return
                }
                if entry.name == BackupNames.settings {
                    let data = try readAll(entry, what: "settings")
                    guard (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil else {
                        throw BackupError.jsonDamaged("settings")
                    }
                    settings = data
                    return
                }

                let target: URL
                if entry.name == BackupNames.database {
                    hasDatabase = true
                    target = directory.appendingPathComponent(BackupNames.database)
                } else {
                    let parts = entry.name.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
                    guard parts.count == 2,
                        (parts[0] == BackupNames.imageDirectory && BackupNames.isImageName(parts[1]))
                            || (parts[0] == BackupNames.attachmentDirectory && BackupNames.isStoredName(parts[1]))
                    else { throw BackupError.unknownFile(entry.name) }
                    if parts[0] == BackupNames.imageDirectory { images += 1 } else { attachments += 1 }
                    let folder = directory.appendingPathComponent(parts[0], isDirectory: true)
                    try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
                    target = folder.appendingPathComponent(parts[1])
                }
                try write(entry.data, to: target)
            }

            guard let manifest else { throw BackupError.notABackup }
            guard hasDatabase else { throw BackupError.noDatabase }
            let stagedDatabase = directory.appendingPathComponent(BackupNames.database)
            try assertUsableDatabase(stagedDatabase)

            var counts = try countRows(in: stagedDatabase)
            counts.images = images
            return StagedBackup(
                directory: directory, createdAt: manifest.createdAt, counts: counts, settings: settings,
                hasImages: images > 0, hasAttachments: attachments > 0)
        } catch {
            try? fileManager.removeItem(at: directory)
            throw error
        }
    }

    public static func discard(_ staged: StagedBackup) {
        try? FileManager.default.removeItem(at: staged.directory)
    }

    private static func readAll(_ entry: TarEntry, what: String) throws -> Data {
        guard entry.size <= BackupNames.maxJSONBytes else { throw BackupError.jsonTooLarge(what) }
        var data = Data()
        while case let chunk = try entry.data.read(), !chunk.isEmpty { data.append(chunk) }
        return data
    }

    private static func readJSON(_ entry: TarEntry, what: String) throws -> Any {
        let data = try readAll(entry, what: what)
        do { return try JSONSerialization.jsonObject(with: data) } catch { throw BackupError.jsonDamaged(what) }
    }

    private static func parseManifest(_ value: Any) throws -> Manifest {
        guard let object = value as? [String: Any], object["format"] as? String == BackupNames.format,
            let version = object["version"] as? Int
        else { throw BackupError.notABackup }
        if version > BackupNames.formatVersion { throw BackupError.newerFormat(version) }
        return Manifest(
            format: BackupNames.format, version: version, createdAt: object["createdAt"] as? String ?? "",
            counts: BackupCounts())
    }

    /// Writes an entry's bytes to a new file; an existing file there is an error (`O_EXCL`), never overwritten.
    private static func write(_ data: TarEntryData, to url: URL) throws {
        let descriptor = open(url.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        guard descriptor >= 0 else { throw BackupError.duplicateEntry(url.lastPathComponent) }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        // A pool per chunk, as in `TarWriter.addFile(named:from:)`: reading the gzip file and writing this one both
        // produce autoreleased data.
        var finished = false
        while !finished {
            try autoreleasepool {
                let chunk = try data.read()
                if chunk.isEmpty { finished = true } else { try handle.write(contentsOf: chunk) }
            }
        }
    }

    /// Replaces the current database, images and attachments with the staged ones, then removes the scratch folder. What
    /// was there is set aside first and put back if anything fails, so the app is never left half restored.
    ///
    /// The caller must have closed the database (`CompositionDatabase.close()`), and should have taken a backup of the
    /// current data first: a restore replaces, it never merges.
    public static func apply(_ staged: StagedBackup, to location: DataLocation) throws {
        let fileManager = FileManager.default
        let aside = staged.directory.appendingPathComponent("previous", isDirectory: true)
        try fileManager.createDirectory(at: aside, withIntermediateDirectories: false)

        // The backup's settings go in as they are; a backup without any leaves the current ones alone, as the desktop does.
        var settingsSwap: [(current: URL, replacement: URL?)] = []
        if let settings = staged.settings {
            let file = staged.directory.appendingPathComponent(BackupNames.settings)
            try settings.write(to: file)
            settingsSwap = [(location.settingsURL, file)]
        }

        // (where it lives now, what the staged copy replaces it with; nil means nothing, the backup had none)
        let db = location.databaseURL
        let swaps: [(current: URL, replacement: URL?)] = settingsSwap +
            [(db, staged.directory.appendingPathComponent(BackupNames.database))]
            + BackupNames.databaseSuffixes.map { (URL(fileURLWithPath: db.path + $0), nil) }
            + [
                (location.imagesURL, staged.hasImages ? staged.directory.appendingPathComponent(BackupNames.imageDirectory) : nil),
                (location.attachmentsURL, staged.hasAttachments ? staged.directory.appendingPathComponent(BackupNames.attachmentDirectory) : nil),
            ]

        var setAside: [(current: URL, parked: URL)] = []
        var placed: [URL] = []
        do {
            for (index, swap) in swaps.enumerated() where exists(swap.current) {
                let parked = aside.appendingPathComponent(String(index))
                try fileManager.moveItem(at: swap.current, to: parked)
                setAside.append((swap.current, parked))
            }
            for swap in swaps {
                guard let replacement = swap.replacement else { continue }
                try fileManager.moveItem(at: replacement, to: swap.current)
                placed.append(swap.current)
            }
        } catch {
            for url in placed.reversed() { try? fileManager.removeItem(at: url) }
            for (current, parked) in setAside.reversed() {
                // Nothing more can be done if this fails; the previous data stays in the scratch folder, which is kept for that reason.
                try? fileManager.moveItem(at: parked, to: current)
            }
            throw BackupError.restoreFailed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
        try? fileManager.removeItem(at: staged.directory)
    }

    /// Whether anything is at `url`, a broken link included (`lstat`, not `stat`).
    private static func exists(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0
    }
}
