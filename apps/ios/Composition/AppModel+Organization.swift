import CompositionCore
import Foundation

// Build plan Step 7: notebooks, groups and favorites. What the sidebar and the note list show, where the user has been, and the
// operations that change it, which all go through `NoteStore` (so the rows written are the ones the desktop writes).

extension AppModel {
    // MARK: What is shown

    /// Where a new note goes: into the group the sidebar is on, or at the top of its notebook; anywhere else, the default notebook.
    var newNoteTarget: (group: Int64?, notebook: Int64?) {
        switch sidebar {
        case .group(let id): (id, nil)
        case .notebook(let id): (nil, id)
        default: (nil, nil)
        }
    }

    func title(of item: SidebarItem) -> String {
        switch item {
        case .all: "All Notes"
        case .favorites: "Favorites"
        case .notebook(let id): notebooks.first { $0.id == id }?.name ?? "Notebook"
        case .group(let id): groups.first { $0.id == id }?.name ?? "Group"
        case .readingList: "Reading List"
        }
    }

    func group(_ id: Int64) -> NoteGroup? { groups.first { $0.id == id } }

    func notebook(_ id: Int64) -> Notebook? { notebooks.first { $0.id == id } }

    /// The sidebar, flattened: All Notes and Favorites, then each notebook, and under an open one its groups, down through the open ones.
    var sidebarRows: [SidebarRow] {
        var rows = [
            SidebarRow(item: .all, title: "All Notes", systemImage: "tray.full", depth: 0, count: noteCount, expandable: false, isExpanded: false),
            SidebarRow(item: .favorites, title: "Favorites", systemImage: "star", depth: 0, count: favoriteGroups.count + favoriteNotes.count, expandable: false, isExpanded: false),
        ]
        // The Reading List, while its plugin is on, with how many links are unread.
        if readingListEnabled {
            rows.append(SidebarRow(item: .readingList, title: "Reading List", systemImage: "eyeglasses", depth: 0, count: unreadReadingCount, expandable: false, isExpanded: false))
        }
        var children: [Int64?: [NoteGroup]] = [:]
        for group in groups { children[group.parentId, default: []].append(group) }
        func append(_ group: NoteGroup, depth: Int) {
            let item = SidebarItem.group(group.id)
            let kids = children[group.id] ?? []
            let open = expanded.contains(item) && !kids.isEmpty
            rows.append(SidebarRow(item: item, title: group.name, systemImage: "folder", depth: depth, count: totals.groups[group.id] ?? 0, expandable: !kids.isEmpty, isExpanded: open))
            if open { for kid in kids { append(kid, depth: depth + 1) } }
        }
        for notebook in notebooks {
            let item = SidebarItem.notebook(notebook.id)
            let tops = (children[nil] ?? []).filter { $0.notebookId == notebook.id }
            let open = expanded.contains(item) && !tops.isEmpty
            rows.append(SidebarRow(item: item, title: notebook.name, systemImage: "books.vertical", depth: 0, count: totals.notebooks[notebook.id] ?? 0, expandable: !tops.isEmpty, isExpanded: open))
            if open { for top in tops { append(top, depth: 1) } }
        }
        return rows
    }

    /// The groups the second column lists for an item: a notebook's top-level groups, or a group's sub-groups.
    func subgroups(of item: SidebarItem) -> [NoteGroup] {
        switch item {
        case .notebook(let id): groups.filter { $0.parentId == nil && $0.notebookId == id }
        case .group(let id): groups.filter { $0.parentId == id }
        case .all, .favorites, .readingList: []
        }
    }

    /// The notes the second column lists for an item, in the order the person placed them (the latest first, for All Notes).
    func notes(in item: SidebarItem) -> [NoteSummary] {
        switch item {
        case .all: recentNotes
        case .favorites: favoriteNotes
        case .notebook(let id): orderedNotes.filter { $0.groupId == nil && $0.notebookId == id }
        case .group(let id): orderedNotes.filter { $0.groupId == id }
        case .readingList: []
        }
    }

    /// Pinned groups and notes that still exist, in the order they were pinned.
    var favoriteGroups: [NoteGroup] {
        favorites.compactMap { $0.kind == .group ? group($0.id) : nil }
    }

    var favoriteNotes: [NoteSummary] {
        let byId = Dictionary(orderedNotes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return favorites.compactMap { $0.kind == .note ? byId[$0.id] : nil }
    }

    func isFavorite(_ kind: FavoriteKind, _ id: Int64) -> Bool { favorites.contains(Favorite(kind, id)) }

    /// The notes in the order of last edit, which is what the list shows while nothing is typed.
    private var recentNotes: [NoteSummary] { query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? notes : orderedNotes.sorted { ($0.updatedAt, $0.id) > ($1.updatedAt, $1.id) } }

    // MARK: Moving around

    /// The user picked something in the sidebar (or a group in the list): show it, with the groups above it open, and remember it.
    func visit(_ item: SidebarItem?) {
        guard let item else { return }
        sidebar = item
        reveal(item)
        history.record(.list(item))
    }

    /// The user opened a note, or closed the open one (nil).
    func open(_ id: Int64?) {
        selection = id
        if let id { history.record(.note(id)) }
    }

    /// A `note:` link was opened in a preview: show that note, in the list that holds it.
    func followNoteLink(_ id: Int64) {
        guard let note = orderedNotes.first(where: { $0.id == id }) else {
            errorMessage = "That note is not here any more. It may be in the Trash Can."
            return
        }
        if !notes(in: sidebar ?? .all).contains(where: { $0.id == id }) {
            visit(note.groupId.map(SidebarItem.group) ?? note.notebookId.map(SidebarItem.notebook) ?? .all)
        }
        open(id)
    }

    /// Opens the groups above an item, so that it is in view.
    func reveal(_ item: SidebarItem) {
        switch item {
        case .group(let id):
            for ancestor in GroupListing.path(to: id, in: groups) {
                if ancestor.id != id { expanded.insert(.group(ancestor.id)) }
                if ancestor.parentId == nil, let notebook = ancestor.notebookId { expanded.insert(.notebook(notebook)) }
            }
        default: break
        }
    }

    func toggleExpanded(_ item: SidebarItem) {
        if expanded.contains(item) { expanded.remove(item) } else { expanded.insert(item) }
    }

    func isValid(_ place: Place) -> Bool {
        switch place {
        case .list(.all), .list(.favorites): true
        case .list(.readingList): readingListEnabled
        case .list(.notebook(let id)): notebook(id) != nil
        case .list(.group(let id)): group(id) != nil
        case .note(let id): orderedNotes.contains { $0.id == id }
        }
    }

    var canGoBack: Bool { history.canGoBack(isValid: isValid) }
    var canGoForward: Bool { history.canGoForward(isValid: isValid) }

    func goBack() { if let place = history.back(isValid: isValid) { apply(place) } }
    func goForward() { if let place = history.forward(isValid: isValid) { apply(place) } }

    /// Shows a place the history stepped to, without recording it again. A note that is not in the list on screen brings its group with it.
    private func apply(_ place: Place) {
        switch place {
        case .list(let item):
            sidebar = item
            reveal(item)
        case .note(let id):
            selection = id
            guard let note = orderedNotes.first(where: { $0.id == id }) else { return }
            let here = sidebar.map { notes(in: $0).contains { $0.id == id } || $0 == .all } ?? false
            if !here {
                let home: SidebarItem = note.groupId.map { .group($0) } ?? note.notebookId.map { .notebook($0) } ?? .all
                sidebar = home
                reveal(home)
            }
        }
    }

    /// After the notebooks and groups were read again: what the sidebar points at may be gone.
    func pruneNavigation() {
        if let item = sidebar, !isValid(.list(item)) { sidebar = .all }
        expanded = expanded.filter { isValid(.list($0)) }
        if let id = selection, !orderedNotes.isEmpty, !orderedNotes.contains(where: { $0.id == id }) { selection = nil }
    }

    // MARK: Dropping

    /// Which edges of `target` the dragged item may land on: onto it (into a group, or out of every group onto its notebook), or beside it
    /// (to put it in order). Empty where it may not land at all: a group into itself or beneath itself, a note beside a note in a list that has
    /// no order of its own (All Notes, Favorites), a group beside a top-level group of another notebook (the store keeps it where it is).
    func allowedEdges(of item: DraggedItem, on target: DropTarget) -> [DropEdge] {
        switch (item.kind, target) {
        case (.note, .group): return [.into]
        case (.note, .notebook(let id)): return orderedNotes.first { $0.id == item.id }?.notebookId == id ? [.into] : []
        case (.note, .note(let id, let list)):
            guard orderedNotes.contains(where: { $0.id == id }), isOrdered(list) else { return [] }
            return [.before, .after]
        case (.group, .group(let id)):
            guard let moved = group(item.id), let over = group(id), moved.id != over.id else { return [] }
            if GroupListing.path(to: over.id, in: groups).contains(where: { $0.id == moved.id }) { return [] }  // into itself or beneath itself
            // Beside a top-level group of another notebook would leave it where it is; only into works there.
            let beside = over.parentId != nil || over.notebookId == moved.notebookId
            return beside ? [.before, .into, .after] : [.into]
        case (.group, .notebook): return [.into]
        case (.notebook, .notebook(let id)): return id == item.id ? [] : [.before, .after]
        default: return []
        }
    }

    /// Whether a list is in the order the person placed things in (a group, a notebook's own notes), rather than by date or by pinning.
    func isOrdered(_ list: SidebarItem?) -> Bool {
        switch list {
        case .group?, .notebook?: true
        default: false
        }
    }

    /// Carries out a drop that `allowedEdges` said may land.
    func drop(_ item: DraggedItem, on target: DropTarget, edge: DropEdge) async {
        guard allowedEdges(of: item, on: target).contains(edge) else { return }
        switch (item.kind, target, edge) {
        case (.note, .group(let id), _):
            await move(note: item.id, toGroup: id)
        case (.note, .notebook, _):
            await move(note: item.id, toGroup: nil)
        case (.note, .note(let id, let list), _):
            let siblings = notes(in: list ?? .all)
            guard let at = siblings.firstIndex(where: { $0.id == id }) else { return }
            let before = edge == .before ? id : siblings.dropFirst(at + 1).first { $0.id != item.id }?.id
            let inGroup: Int64? = if case .group(let group)? = list { group } else { nil }
            await place(note: item.id, in: inGroup, before: before)
        case (.group, .group(let id), .into):
            await move(group: item.id, toParent: id)
            expanded.insert(.group(id))
        case (.group, .group(let id), _):
            guard let over = group(id) else { return }
            let siblings = groups.filter { $0.parentId == over.parentId && $0.notebookId == over.notebookId }
            let before = edge == .before ? id : siblings.drop { $0.id != id }.dropFirst().first { $0.id != item.id }?.id
            await place(group: item.id, parent: over.parentId, before: before)
        case (.group, .notebook(let id), _):
            if group(item.id)?.notebookId == id { await move(group: item.id, toParent: nil) } else { await move(group: item.id, toNotebook: id) }
            expanded.insert(.notebook(id))
        case (.notebook, .notebook(let id), _):
            let before = edge == .before ? id : notebooks.drop { $0.id != id }.dropFirst().first { $0.id != item.id }?.id
            await place(notebook: item.id, before: before)
        default: break
        }
    }

    // MARK: Text dropped from Files and other apps

    /// A piece of text that was dropped: its file's name (nil for a selection of text) and what it holds.
    struct DroppedText: Sendable {
        let name: String?
        let text: String
    }

    /// Whether a drop of text may land on `target`: into a group or notebook (a note row means the list it is in).
    func acceptsText(on target: DropTarget) -> Bool {
        switch target {
        case .group, .notebook: true
        case .note: false
        }
    }

    /// Makes a note of each piece of text dropped on the sidebar's group or notebook (or on the list the sidebar points at), in that group or
    /// notebook; the last one opens. A file's note is named after the file; a selection of text, after its first line.
    func importTexts(_ texts: [DroppedText], into target: SidebarItem?) async {
        guard let store, !texts.isEmpty else { return }
        var group: Int64?
        var notebook: Int64?
        switch target {
        case .group(let id)?: group = id
        case .notebook(let id)?: notebook = id
        default: break
        }
        let (groupId, notebookId) = (group, notebook)
        var made: [Int64] = []
        for dropped in texts where !dropped.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let name = Self.noteName(for: dropped)
            do {
                made.append(try await Self.perform { try store.importNote(named: name, text: dropped.text, groupId: groupId, notebookId: notebookId).id })
            } catch {
                errorMessage = error.localizedDescription
            }
        }
        await reload()
        if let last = made.last { open(last) }
        if let group { expanded.insert(.group(group)) }
        if let notebook { expanded.insert(.notebook(notebook)) }
    }

    /// The file's name without its extension, or the text's first line without Markdown marks, kept short.
    nonisolated static func noteName(for dropped: DroppedText) -> String {
        if let name = dropped.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            let base = (name as NSString).deletingPathExtension
            return base.isEmpty ? name : base
        }
        let firstLine = dropped.text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let cleaned = firstLine.trimmingCharacters(in: CharacterSet(charactersIn: "# \t-*>"))
        return cleaned.isEmpty ? "Untitled" : String(cleaned.prefix(80))
    }

    // MARK: Changing things

    /// Runs a change to the notes, groups or notebooks off the main thread, then reads everything again. A refusal is shown to the person.
    private func change(_ work: @escaping @Sendable (NoteStore, SettingsStore?) throws -> Void) async {
        guard let store else { return }
        let settings = settings
        do {
            try await Self.perform { try work(store, settings) }
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createGroup(named name: String, in parent: SidebarItem?) async {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        var parentGroup: Int64?
        var notebook: Int64?
        switch parent {
        case .group(let id)?: parentGroup = id
        case .notebook(let id)?: notebook = id
        default: break
        }
        let (parentId, notebookId) = (parentGroup, notebook)
        await change { store, _ in _ = try store.createGroup(name: name, parentId: parentId, notebookId: notebookId) }
        if let parentGroup { expanded.insert(.group(parentGroup)) }
        if let notebook { expanded.insert(.notebook(notebook)) }
    }

    func createNotebook(named name: String) async {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        await change { store, _ in _ = try store.createNotebook(name: name) }
    }

    func rename(_ item: SidebarItem, to name: String) async {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        switch item {
        case .group(let id): await change { store, _ in _ = try store.renameGroup(id: id, name: name) }
        case .notebook(let id): await change { store, _ in _ = try store.renameNotebook(id: id, name: name) }
        case .all, .favorites, .readingList: break
        }
    }

    /// Moves a group to the Trash Can; the store refuses while it holds notes or other groups.
    func deleteGroup(_ id: Int64) async {
        if let group = group(id), (totals.groups[id] ?? 0) > 0 || groups.contains(where: { $0.parentId == id }) {
            errorMessage = "“\(group.name)” still has notes or groups in it. Move or delete them first."
            return
        }
        await change { store, _ in try store.deleteGroup(id: id) }
    }

    func deleteNotebook(_ id: Int64) async {
        if notebooks.count <= 1 {
            errorMessage = "The last notebook can't be deleted."
        } else if (totals.notebooks[id] ?? 0) > 0 || groups.contains(where: { $0.notebookId == id }) {
            errorMessage = "“\(notebook(id)?.name ?? "This notebook")” still has groups or notes in it. Empty it first."
        } else {
            await change { store, _ in try store.deleteNotebook(id: id) }
        }
    }

    /// Into a group, or (nil) out of every group, staying in its notebook.
    func move(note id: Int64, toGroup group: Int64?) async {
        await change { store, _ in _ = try store.moveNote(id: id, toGroup: group) }
    }

    /// Into `group`, immediately before the note `before` (last when nil).
    func place(note id: Int64, in group: Int64?, before: Int64?) async {
        await change { store, _ in _ = try store.placeNote(id: id, groupId: group, before: before) }
    }

    func move(group id: Int64, toParent parent: Int64?) async {
        await change { store, _ in _ = try store.moveGroup(id: id, parentId: parent) }
    }

    func place(group id: Int64, parent: Int64?, before: Int64?) async {
        await change { store, _ in _ = try store.placeGroup(id: id, parentId: parent, before: before) }
    }

    func move(group id: Int64, toNotebook notebook: Int64) async {
        await change { store, _ in _ = try store.moveGroupToNotebook(id: id, notebookId: notebook) }
    }

    func place(notebook id: Int64, before: Int64?) async {
        await change { store, _ in _ = try store.placeNotebook(id: id, before: before) }
    }

    func toggleFavorite(_ kind: FavoriteKind, _ id: Int64) async {
        await change { _, settings in _ = try settings?.toggleFavorite(kind, id) }
    }
}
