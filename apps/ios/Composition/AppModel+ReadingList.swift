import CompositionCore
import Foundation

// The Reading List plugin (docs/reading-list-plan.md; on the iPad, docs/ipad-app-design.md, C6): a list of article links with the page of
// the one picked shown beside it. The links are the desktop's `reading_list` table and the switch is the desktop's `plugins` entry in
// `settings.json`, so both travel in a backup. Off until someone turns it on (More ▸ Plugins), because it lets the app load web pages.
//
// A change shows at once and is then written; if the write is refused, the list is read again so the screen shows what is stored
// (the desktop's `readingListStore.ts` works the same way).

extension AppModel {
    /// The links as the list shows them: unread first, then read, each oldest first.
    var sortedReadingItems: [ReadingItem] { ReadingLinks.sorted(readingItems) }

    var unreadReadingCount: Int { readingItems.count { !$0.read } }

    /// The link whose page is open, if it is still in the list.
    var openReadingItem: ReadingItem? { readingSelection.flatMap { id in readingItems.first { $0.id == id } } }

    /// Reads the switch and the links. Called when the data opens (and again after a restore), and when the switch changes.
    func loadReadingList() async {
        var enabled = settings?.readingListEnabled() ?? false
        #if DEBUG || EDITOR_TEST_HOOKS
        // Developer shortcut for the UI tests: `-readingList 1` turns the plugin on for that run without writing anything.
        if UserDefaults.standard.object(forKey: "readingList") != nil { enabled = UserDefaults.standard.bool(forKey: "readingList") }
        #endif
        readingListEnabled = enabled
        guard enabled, let database = store?.database else {
            readingItems = []
            readingSelection = nil
            if sidebar == .readingList { sidebar = .all }
            return
        }
        do {
            readingItems = try await Self.perform { try database.readingItems() }
        } catch {
            errorMessage = "Couldn't read the Reading List: \(error.localizedDescription)"
        }
        if let id = readingSelection, !readingItems.contains(where: { $0.id == id }) { readingSelection = nil }
    }

    /// Turns the plugin on or off and keeps the choice in `settings.json`. Turning it off hides it and keeps every link.
    func setReadingListEnabled(_ enabled: Bool) async {
        guard let settings else { return }
        do {
            try settings.setReadingListEnabled(enabled)
        } catch {
            errorMessage = "Couldn't save that choice: \(error.localizedDescription)"
            return
        }
        #if DEBUG || EDITOR_TEST_HOOKS
        // A launch argument would otherwise win over the choice just made.
        UserDefaults.standard.removeObject(forKey: "readingList")
        #endif
        await loadReadingList()
    }

    /// Adds a link at the end and opens it. Returns why it was not added (in the desktop's words), or nil. A link already in the list is
    /// opened instead, and the words say which it is.
    func addReadingLink(_ text: String) async -> String? {
        guard let database = store?.database else { return "Your notes are not open yet." }
        do {
            let item = try await Self.perform { try database.addReadingItem(text) }
            readingItems.append(item)
            readingSelection = item.id
            return nil
        } catch let error as ReadingListError {
            if case .alreadyListed(let item) = error { readingSelection = item.id }
            return error.errorDescription
        } catch {
            return error.localizedDescription
        }
    }

    func setReadingRead(_ id: Int64, _ read: Bool) async {
        guard let database = store?.database, let at = readingItems.firstIndex(where: { $0.id == id }) else { return }
        readingItems[at].read = read
        await write { try database.setReadingItemRead(id: id, read: read) }
    }

    /// The page named itself: the link takes that name if it has none yet. A link that has a name keeps it.
    func fillReadingTitle(_ id: Int64, _ title: String) async {
        guard let database = store?.database, let at = readingItems.firstIndex(where: { $0.id == id }), readingItems[at].title.isEmpty,
            let cleaned = ReadingLinks.cleanTitle(title)
        else { return }
        readingItems[at].title = cleaned
        await write { try database.setReadingItemTitle(id: id, title: cleaned) }
    }

    /// Deletes the link for good (links are not sent to the Trash Can; the screen asks first).
    func deleteReadingLink(_ id: Int64) async {
        guard let database = store?.database else { return }
        readingItems.removeAll { $0.id == id }
        if readingSelection == id { readingSelection = nil }
        await write { try database.deleteReadingItem(id: id) }
    }

    /// Writes one change already on screen. Where it fails, says why and puts back what is really stored.
    private func write(_ change: @escaping @Sendable () throws -> Void) async {
        do {
            try await Self.perform(change)
        } catch {
            errorMessage = (error as? ReadingListError)?.errorDescription ?? error.localizedDescription
            await loadReadingList()
        }
    }
}
