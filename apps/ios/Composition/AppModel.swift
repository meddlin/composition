import CompositionCore
import Foundation
import Observation

/// A backup just made, waiting to be shared or saved.
struct ExportedBackup: Identifiable {
    let id = UUID()
    let summary: BackupSummary
}

/// Everything the screens show, and the actions on it. The notes live in `CompositionCore`'s database and search index;
/// this only holds what is on screen and runs the slow work off the main thread.
@MainActor @Observable
final class AppModel {
    enum Phase: Equatable { case starting, empty, ready }

    private(set) var phase: Phase = .starting
    private(set) var busyMessage: String?
    var errorMessage: String?
    var notice: String?

    var query = ""
    var selection: Int64?
    private(set) var notes: [NoteSummary] = []
    private(set) var resultLine = ""
    private(set) var trashedNotes: [TrashedNote] = []
    private(set) var trashedGroups: [TrashedGroup] = []
    private(set) var noteCount = 0
    private(set) var sqliteVersion = ""
    private(set) var lastSearchMilliseconds: Double?
    private(set) var indexRebuiltAtOpen = false
    var exportedBackup: ExportedBackup?

    /// Where this app keeps its notes: the database, the images and attached files, and the search index beside them.
    let location = DataLocation(directory: URL.applicationSupportDirectory.appending(path: "Composition", directoryHint: .isDirectory))
    private var database: CompositionDatabase?
    private var searchIndex: SearchIndex?
    private var searchTask: Task<Void, Never>?

    private struct Stores: Sendable {
        let database: CompositionDatabase
        let index: SearchIndex
        let rebuilt: Bool
    }

    private struct Snapshot: Sendable {
        let all: [NoteSummary]
        let trashedNotes: [TrashedNote]
        let trashedGroups: [TrashedGroup]
        let sqliteVersion: String
    }

    /// Runs slow, blocking work off the main thread.
    nonisolated private static func perform<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await Task.detached(priority: .userInitiated, operation: work).value
    }

    // MARK: Opening

    func start() async {
        #if DEBUG
        // Developer shortcut: `-importBackup /path/to/backup.tar.gz` on the launch arguments restores that file at startup.
        if let path = UserDefaults.standard.string(forKey: "importBackup") {
            await importBackup(from: URL(fileURLWithPath: path), securityScoped: false)
            return
        }
        #endif
        guard FileManager.default.fileExists(atPath: location.databaseURL.path) else {
            phase = .empty
            return
        }
        await open()
    }

    private func open() async {
        busyMessage = "Opening your notes…"
        defer { busyMessage = nil }
        let location = location
        do {
            let stores = try await Self.perform {
                let database = try CompositionDatabase.open(in: location)
                // As the desktop does when it opens: items past their 60 days are gone.
                try database.purgeExpired()
                let index = try SearchIndex.open(at: location.directory.appendingPathComponent("search.db"))
                let rebuilt = try index.rebuildIfStale(from: database)
                return Stores(database: database, index: index, rebuilt: rebuilt)
            }
            database = stores.database
            searchIndex = stores.index
            indexRebuiltAtOpen = stores.rebuilt
            phase = .ready
            await reload()
        } catch {
            errorMessage = "Couldn't open your notes: \(error.localizedDescription)"
            phase = FileManager.default.fileExists(atPath: location.databaseURL.path) ? .ready : .empty
        }
    }

    /// Reads the list, the Trash Can and the counts again, and re-runs the search if one is typed.
    private func reload() async {
        guard let database else { return }
        do {
            let snapshot = try await Self.perform {
                let trash = try database.listTrash()
                return Snapshot(all: try database.listNotes(), trashedNotes: trash.notes, trashedGroups: trash.groups, sqliteVersion: try database.sqliteVersion())
            }
            trashedNotes = snapshot.trashedNotes
            trashedGroups = snapshot.trashedGroups
            noteCount = snapshot.all.count
            sqliteVersion = snapshot.sqliteVersion
            if trimmedQuery.isEmpty {
                notes = snapshot.all
                resultLine = "\(noteCount) notes"
                lastSearchMilliseconds = nil
            } else {
                await runSearch(query)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: Searching

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Called as the search text changes. A short pause first, so typing a word searches once, and a search superseded by a newer one is dropped.
    func queryChanged() {
        searchTask?.cancel()
        guard database != nil else { return }
        let text = query
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            await self?.runSearch(text)
        }
    }

    private func runSearch(_ text: String) async {
        guard let database, let index = searchIndex else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if trimmed.isEmpty {
                let all = try await Self.perform { try database.listNotes() }
                guard text == query else { return }
                notes = all
                resultLine = "\(all.count) notes"
                lastSearchMilliseconds = nil
                return
            }
            let started = ContinuousClock.now
            let found = try await Self.perform { try database.notes(ids: try index.search(trimmed)) }
            let elapsed = started.duration(to: .now)
            guard text == query else { return }  // typing moved on
            let milliseconds = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
            notes = found
            lastSearchMilliseconds = milliseconds
            resultLine = String(format: "%@ · %.1f ms", found.isEmpty ? "No results" : "\(found.count) result\(found.count == 1 ? "" : "s")", milliseconds)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func detail(of id: Int64) async -> NoteDetail? {
        guard let database else { return nil }
        return try? await Self.perform { try database.note(id: id) }
    }

    // MARK: Trash Can

    func moveToTrash(_ id: Int64) async {
        guard let database, let index = searchIndex else { return }
        do {
            try await Self.perform {
                try database.trashNote(id: id)
                try index.remove(ids: [id])
                try index.markCurrent(with: database)
            }
            if selection == id { selection = nil }
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restoreNote(_ id: Int64) async {
        await changeTrash { database, index in
            _ = try database.restoreNote(id: id)
            try index.rebuild(from: database)  // a restored note may come back under a new id, so start over
        }
    }

    func restoreGroup(_ id: Int64) async {
        await changeTrash { database, _ in _ = try database.restoreGroup(id: id) }
    }

    func purgeNote(_ id: Int64) async {
        await changeTrash { database, _ in try database.purgeNote(id: id) }
    }

    func purgeGroup(_ id: Int64) async {
        await changeTrash { database, _ in try database.purgeGroup(id: id) }
    }

    private func changeTrash(_ work: @escaping @Sendable (CompositionDatabase, SearchIndex) throws -> Void) async {
        guard let database, let index = searchIndex else { return }
        do {
            try await Self.perform { try work(database, index) }
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: Backups

    /// Replaces everything with the backup at `url`: stages it (refusing a bad file with nothing changed), swaps it in, and reopens.
    func importBackup(from url: URL, securityScoped: Bool = true) async {
        busyMessage = "Restoring the backup…"
        defer { busyMessage = nil }
        // Close what is open, so nothing holds the files while they are swapped.
        let closingDatabase = database, closingIndex = searchIndex
        database = nil
        searchIndex = nil
        searchTask?.cancel()
        let location = location
        do {
            let counts = try await Self.perform {
                try closingDatabase?.close()
                try closingIndex?.close()
                let scoped = securityScoped && url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                // Copied first: a file in iCloud Drive or another app's folder should not be read in place for long.
                let copy = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).tar.gz")
                try FileManager.default.copyItem(at: url, to: copy)
                defer { try? FileManager.default.removeItem(at: copy) }
                let staged = try Backup.stage(copy, in: location)
                try Backup.apply(staged, to: location)
                return staged.counts
            }
            query = ""
            selection = nil
            notice = "Restored \(counts.notes) notes (\(counts.trashedNotes) in the Trash Can), \(counts.images) images and \(counts.attachments) attached files."
            await open()
        } catch {
            errorMessage = error.localizedDescription
            // A refused file changes nothing, so whatever was there is still there.
            if FileManager.default.fileExists(atPath: location.databaseURL.path) { await open() } else { phase = .empty }
        }
    }

    /// Makes a backup the desktop can restore, and offers it to share or save.
    func exportBackup() async {
        guard let database else { return }
        busyMessage = "Making a backup…"
        defer { busyMessage = nil }
        let location = location
        do {
            let summary = try await Self.perform {
                let folder = FileManager.default.temporaryDirectory.appending(path: "Backups", directoryHint: .isDirectory)
                try? FileManager.default.removeItem(at: folder)  // only the latest is kept
                return try Backup.create(database: database, location: location, to: folder.appending(path: Self.backupFileName()))
            }
            exportedBackup = ExportedBackup(summary: summary)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// `composition-backup-2026-11-05-153045.tar.gz`, in local time, as the desktop names them.
    nonisolated private static func backupFileName() -> String {
        let format = DateFormatter()
        format.dateFormat = "yyyy-MM-dd-HHmmss"
        return "composition-backup-\(format.string(from: Date())).tar.gz"
    }
}
