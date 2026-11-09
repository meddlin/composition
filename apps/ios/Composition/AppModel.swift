import CompositionCore
import Foundation
import Observation
import UIKit

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
    /// What the busy overlay says while slow work runs (set by the work itself, here and in the PDF import).
    var busyMessage: String?
    var errorMessage: String?
    var notice: String?

    var query = ""
    var selection: Int64?
    /// The notes the search found, or every note (the latest first) while nothing is typed.
    private(set) var notes: [NoteSummary] = []
    private(set) var resultLine = ""
    /// Notebooks, groups and every note in the order the sidebar shows them (hand-placed first), and the pinned items (build plan Step 7).
    private(set) var notebooks: [Notebook] = []
    private(set) var groups: [NoteGroup] = []
    private(set) var orderedNotes: [NoteSummary] = []
    /// Every note, the latest first, as the picker after `[[` offers them.
    private(set) var linkCandidates: [NoteLinks.Candidate] = []
    private(set) var favorites: [Favorite] = []
    /// How many times the notes, groups and notebooks have been read: the screen restores where it was after the first.
    private(set) var loads = 0
    /// How many notes each group (with everything beneath it) and each notebook holds, for the sidebar's counts.
    private(set) var totals = SidebarCounts()
    /// Where the sidebar is, which groups are open in it, and where the user has been.
    var sidebar: SidebarItem? = .all
    var expanded: Set<SidebarItem> = []
    var history = NavigationHistory<Place>()
    /// What the person is dragging right now (set when the drag lifts, so that rows can say what they would accept while it hovers over them).
    var dragging: DraggedItem?
    private(set) var trashedNotes: [TrashedNote] = []
    private(set) var trashedGroups: [TrashedGroup] = []
    /// The size of the PDF each note owns (live or in the Trash Can), by the note's id: what marks a row as a PDF's and what the Trash Can says it takes.
    private(set) var pdfSizes: [Int64: Int64] = [:]
    /// A PDF just picked or dropped that the library already holds, waiting for the answer (open it, import it again, or neither).
    var duplicatePdf: DuplicatePdf?
    private(set) var noteCount = 0
    private(set) var sqliteVersion = ""
    private(set) var lastSearchMilliseconds: Double?
    private(set) var indexRebuiltAtOpen = false
    var exportedBackup: ExportedBackup?

    /// Where this app keeps its notes: the database, the images and attached files, and the search index beside them.
    let location = DataLocation(directory: URL.applicationSupportDirectory.appending(path: "Composition", directoryHint: .isDirectory))
    private var database: CompositionDatabase?
    private var searchIndex: SearchIndex?
    private(set) var settings: SettingsStore?
    /// How the app looks (the colour scheme and the two type families), read from `settings.json` when the data opens (build plan Step 10).
    private(set) var appearance = Appearance()
    private var searchTask: Task<Void, Never>?

    /// The notes open for editing, shared by every window; the one place text typed in the app is saved from (Step 4, spike S6).
    private var sessions: NoteSessions?
    private var reloadTask: Task<Void, Never>?
    /// Set while a save has failed (the text is kept and saving is retried); nil otherwise.
    private(set) var saveProblem: String?

    private struct Stores: Sendable {
        let database: CompositionDatabase
        let index: SearchIndex
        let rebuilt: Bool
        let sessions: NoteSessions
        let recovered: Int
    }

    private struct Snapshot: Sendable {
        let all: [NoteSummary]
        let ordered: [NoteSummary]
        let notebooks: [Notebook]
        let groups: [NoteGroup]
        let favorites: [Favorite]
        let trashedNotes: [TrashedNote]
        let trashedGroups: [TrashedGroup]
        let pdfSizes: [Int64: Int64]
        let sqliteVersion: String
    }

    /// Runs slow, blocking work off the main thread.
    nonisolated static func perform<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await Task.detached(priority: .userInitiated, operation: work).value
    }

    init() {
        // Every way the app can stop being the one in front, or stop: what was typed is written first (the design's
        // `scenePhase` and `willResignActive`, with the background-task assertion in `flushEditing`).
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification, UIApplication.willTerminateNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.flushEditing() }
            }
        }
    }

    /// What the organization operations (AppModel+Organization.swift) change notes, groups and notebooks through.
    var store: NoteStore? { sessions?.store }

    // MARK: Opening

    func start() async {
        #if DEBUG || EDITOR_TEST_HOOKS
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
        var timing = NoteAutosaver.Timing()
        #if DEBUG || EDITOR_TEST_HOOKS
        // Developer shortcut for scripts: `-autosaveQuiet 30` makes the pause before a save 30 seconds, so that only leaving the
        // foreground (or the draft file) can save what was typed within a test.
        let quiet = UserDefaults.standard.double(forKey: "autosaveQuiet")
        if quiet > 0 { timing = NoteAutosaver.Timing(quiet: quiet, longest: max(quiet, 2 * quiet)) }
        #endif
        let sessionTiming = timing
        do {
            let stores = try await Self.perform {
                let database = try CompositionDatabase.open(in: location)
                let index = try SearchIndex.open(at: location.directory.appendingPathComponent("search.db"), tolerance: .forgiving)
                let store = NoteStore(database: database, search: index)
                // As the desktop does when it opens: items past their 60 days are gone, with the PDFs of any notes among them, and the PDFs of notes
                // that are gone some other way (a group deleted for good) are swept.
                let library = DocumentLibrary(store: store, location: location)
                try library.purgeExpiredTrash()
                let rebuilt = try index.rebuildIfStale(from: database)
                let sessions = NoteSessions(store: store, drafts: NoteDrafts(location: location), timing: sessionTiming)
                // Text typed just before the app was last ended, and not yet in the database, goes in now.
                let recovered = sessions.recoverDrafts().count
                return Stores(database: database, index: index, rebuilt: rebuilt, sessions: sessions, recovered: recovered)
            }
            database = stores.database
            searchIndex = stores.index
            sessions = stores.sessions
            settings = SettingsStore(location: location)
            loadAppearance()
            indexRebuiltAtOpen = stores.rebuilt
            if stores.recovered > 0 {
                notice = "The app was closed while you were typing. What you had typed in \(stores.recovered == 1 ? "1 note" : "\(stores.recovered) notes") is back."
            }
            phase = .ready
            #if DEBUG || EDITOR_TEST_HOOKS
            // Developer shortcut: `-openNote 12` selects that note at launch.
            let forced = UserDefaults.standard.integer(forKey: "openNote")  // launch arguments arrive as text; 0 when absent
            if forced != 0 { selection = Int64(forced) }
            // `-trashNote 3` and `-restoreNote 3` do what the buttons do, for the script that checks the rows (apps/ios/scripts/editor-flow-test.sh);
            // `-newNote 1` makes a note as the + button does.
            if UserDefaults.standard.bool(forKey: "newNote") { await createNote() }
            let trash = UserDefaults.standard.integer(forKey: "trashNote")
            if trash != 0 { await moveToTrash(Int64(trash)) }
            let restore = UserDefaults.standard.integer(forKey: "restoreNote")
            if restore != 0 { await restoreNote(Int64(restore)) }
            // `-purgeNote 3` deletes a note in the Trash Can for good, as the swipe in the Trash Can screen does (and takes its PDF's file with it).
            let purge = UserDefaults.standard.integer(forKey: "purgeNote")
            if purge != 0 { await purgeNote(Int64(purge)) }
            // `-importText /path/file.md` does what dropping that file on the list does.
            if let path = UserDefaults.standard.string(forKey: "importText"), let data = FileManager.default.contents(atPath: path), let text = String(data: data, encoding: .utf8) {
                await importTexts([DroppedText(name: URL(fileURLWithPath: path).lastPathComponent, text: text)], into: sidebar)
            }
            // `-importPdf /path/book.pdf` does what choosing that file in the Import PDF picker does (the picker is the system's, and is tried by hand).
            if let path = UserDefaults.standard.string(forKey: "importPdf") {
                await importPdfs([.local(URL(fileURLWithPath: path))], into: sidebar)
            }
            #endif
            await reload()
        } catch {
            errorMessage = "Couldn't open your notes: \(error.localizedDescription)"
            phase = FileManager.default.fileExists(atPath: location.databaseURL.path) ? .ready : .empty
        }
    }

    // MARK: Appearance

    /// Reads the appearance from `settings.json`. In a Debug build `-theme forest` (or `system`, `dark` …), `-editorFont serif` and `-previewFont mono`
    /// set it for that run without writing anything, for screenshots and the UI tests.
    func loadAppearance() {
        var current = settings?.appearance() ?? Appearance()
        #if DEBUG || EDITOR_TEST_HOOKS
        let defaults = UserDefaults.standard
        if let name = defaults.string(forKey: "theme") { current.scheme = name == "system" ? .system : .theme(name) }
        if let name = defaults.string(forKey: "editorFont"), let family = FontFamily(rawValue: name) { current.editorFont = family }
        if let name = defaults.string(forKey: "previewFont"), let family = FontFamily(rawValue: name) { current.previewFont = family }
        #endif
        appearance = current
    }

    func chooseScheme(_ choice: SchemeChoice) { change { try $0.setScheme(choice) } }
    func chooseEditorFont(_ family: FontFamily) { change { try $0.setEditorFont(family) } }
    func choosePreviewFont(_ family: FontFamily) { change { try $0.setPreviewFont(family) } }

    /// Writes one change to `settings.json` and shows it. The file keeps every key the desktop wrote; if it cannot be written, the problem is said
    /// and nothing changes.
    private func change(_ edit: (SettingsStore) throws -> Void) {
        guard let settings else { return }
        do { try edit(settings) } catch { errorMessage = "Couldn't save that choice: \(error.localizedDescription)" }
        loadAppearance()
    }

    /// Reads the list, the Trash Can and the counts again, and re-runs the search if one is typed.
    func reload() async {
        guard let database else { return }
        let settings = settings
        do {
            let snapshot = try await Self.perform {
                let trash = try database.listTrash()
                return Snapshot(
                    all: try database.listNotes(), ordered: try database.notesInDisplayOrder(), notebooks: try database.listNotebooks(), groups: try database.listGroups(),
                    favorites: settings?.favorites() ?? [], trashedNotes: trash.notes, trashedGroups: trash.groups,
                    pdfSizes: Dictionary(try database.listDocuments().map { ($0.noteId, $0.size) }, uniquingKeysWith: { first, _ in first }), sqliteVersion: try database.sqliteVersion())
            }
            orderedNotes = snapshot.ordered
            linkCandidates = snapshot.all.map { NoteLinks.Candidate(id: $0.id, title: $0.title) }
            notebooks = snapshot.notebooks
            groups = snapshot.groups
            favorites = snapshot.favorites
            totals = SidebarCounts.make(groups: snapshot.groups, notes: snapshot.ordered)
            pruneNavigation()
            loads += 1
            trashedNotes = snapshot.trashedNotes
            trashedGroups = snapshot.trashedGroups
            pdfSizes = snapshot.pdfSizes
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

    // MARK: Editing

    /// The id of a note that was just made, so that the screen opens it in the editor with the keyboard up (once).
    private var freshNote: Int64?

    /// Makes an empty note ("Untitled", as the desktop does) where the sidebar is (in its group, or at the top of its notebook), selects it, and
    /// opens it for typing.
    func createNote() async {
        guard let store = sessions?.store else { return }
        flushEditing()
        let target = newNoteTarget
        do {
            let note = try await Self.perform { try store.createNote(title: "Untitled", groupId: target.group, notebookId: target.notebook) }
            freshNote = note.id
            query = ""
            selection = note.id
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Whether `id` is the note that was just made; asking once uses it up.
    func takeFreshNote(_ id: Int64) -> Bool {
        guard freshNote == id else { return false }
        freshNote = nil
        return true
    }

    /// Every stored image, newest first, with the notes that point at each, for the picker of images already stored; nil when they cannot be listed.
    func storedImages() async -> [StoredImageInfo]? {
        guard let database else { return nil }
        let location = location
        return try? await Self.perform { try StoredImages.library(in: location) { try database.noteTexts() } }
    }

    /// A stored image the Images page wants put in the open note (its *Insert in Open Note*): the note's screen puts it in and clears this.
    var imageToInsert: String?

    /// Deletes a stored image if nothing refers to it now (the Images page's *Delete*). What was typed is written first, and the notes (and the Trash Can's) are
    /// read again here, so a picture put into a note a moment ago is never deleted from under it.
    func deleteStoredImage(_ name: String) async -> StoredImages.RemoveOutcome {
        guard let database else { return .failed("The notes are not open.") }
        flushEditing()
        let location = location
        do {
            return try await Self.perform {
                StoredImages.remove(named: name, in: location, liveNotes: try database.noteTexts(), trashedTexts: try database.trashedNoteTexts())
            }
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    /// A line of each of these notes' text, for the home page's cards.
    func excerpts(of ids: [Int64]) async -> [Int64: String] {
        guard let database else { return [:] }
        return (try? await Self.perform { try database.excerpts(of: ids) }) ?? [:]
    }

    /// Opens a note for editing, or joins the session another window already has for it.
    func openSession(_ id: Int64) async -> NoteSession? {
        guard let sessions else { return nil }
        do {
            let session = try await Self.perform { try sessions.open(noteId: id) }
            session.autosaver.onSaved { [weak self] _ in
                Task { @MainActor in
                    self?.saveProblem = nil
                    self?.scheduleReload()
                }
            }
            session.autosaver.onFailure { [weak self] error in
                let message = error.localizedDescription
                Task { @MainActor in self?.saveProblem = message }
            }
            return session
        } catch {
            errorMessage = "Couldn't open the note for editing: \(error.localizedDescription)"
            return nil
        }
    }

    /// Lets go of a session; the last window to do so writes whatever is unsaved.
    func closeSession(_ session: NoteSession) {
        sessions?.close(session)
        saveProblem = nil
        scheduleReload()
    }

    /// Writes everything typed and unsaved, now, and waits. The app calls this whenever it may be about to stop. The work is held
    /// inside a background-task assertion, which is what lets iOS finish it after the app has left the foreground.
    func flushEditing() {
        guard let sessions, sessions.hasUnsavedChanges else { return }
        let assertion = SaveAssertion()
        sessions.flushAll()
        assertion.end()
    }

    /// The list is read again shortly after a save (and not on every one in a burst).
    private func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await self?.reload()
        }
    }

    // MARK: Trash Can

    func moveToTrash(_ id: Int64) async {
        guard let store = sessions?.store else { return }
        flushEditing()  // what was typed goes into the note before the note goes to the Trash Can
        do {
            try await Self.perform { try store.deleteNote(id: id) }
            if selection == id { selection = nil }
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restoreNote(_ id: Int64) async {
        guard let store = sessions?.store else { return }
        do {
            _ = try await Self.perform { try store.restoreNote(id: id) }
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restoreGroup(_ id: Int64) async {
        await changeTrash { database, _ in _ = try database.restoreGroup(id: id) }
    }

    /// Deleting a note for good takes its PDF's file and marks with it (a PDF stays while its note is in the Trash Can, so that a restore finds it again).
    func purgeNote(_ id: Int64) async {
        await changeTrash { database, library in try library.permanentlyDeleteNote(id: id) }
    }

    func purgeGroup(_ id: Int64) async {
        await changeTrash { database, library in
            try database.purgeGroup(id: id)
            try library.removeOrphans()
        }
    }

    private func changeTrash(_ work: @escaping @Sendable (CompositionDatabase, DocumentLibrary) throws -> Void) async {
        guard let database, let library else { return }
        do {
            try await Self.perform { try work(database, library) }
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
        flushEditing()
        let closingDatabase = database, closingIndex = searchIndex
        database = nil
        searchIndex = nil
        sessions = nil
        searchTask?.cancel()
        reloadTask?.cancel()
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
        flushEditing()  // the backup holds what was just typed
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

/// Asks iOS for time to finish writing while the app leaves the foreground, and gives it back when done.
@MainActor
private final class SaveAssertion {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    init() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "Save notes") { [weak self] in
            MainActor.assumeIsolated { self?.end() }
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}
