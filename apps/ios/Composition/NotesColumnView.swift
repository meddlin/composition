import CompositionCore
import SwiftUI

/// The second column: what the sidebar points at. Search, when something is typed, is over every note; otherwise a notebook or group lists
/// its groups and then its notes, All Notes lists everything by the latest edit, and Favorites lists what is pinned (build plan Step 7).
struct NotesColumnView: View {
    @Bindable var model: AppModel
    @Environment(\.look) private var look
    @Binding var prompt: Prompt?
    @Binding var moving: DraggedItem?
    var footer: AnyView

    private var item: SidebarItem { model.sidebar ?? .all }
    private var searching: Bool { !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        List(selection: Binding(get: { model.selection }, set: { model.open($0) })) {
            if searching {
                ForEach(model.notes, id: \.id) { noteRow($0, in: nil) }
            } else if item == .favorites {
                favorites
            } else {
                let groups = model.subgroups(of: item)
                let notes = model.notes(in: item)
                if !groups.isEmpty {
                    Section("Groups") {
                        ForEach(groups, id: \.id) { groupRow($0) }
                            .onMove { from, to in moveGroups(groups, from: from, to: to) }
                    }
                }
                if groups.isEmpty {
                    ForEach(notes, id: \.id) { noteRow($0, in: item) }
                        .onMove { from, to in moveNotes(notes, in: item, from: from, to: to) }
                } else {
                    Section("Notes") {
                        ForEach(notes, id: \.id) { noteRow($0, in: item) }
                            .onMove { from, to in moveNotes(notes, in: item, from: from, to: to) }
                    }
                }
            }
        }
        .overlay { empty }
        .scrollContentBackground(.hidden)
        .background(look.surface)
        .tint(look.selectionFill)
        .dropList()
        .textDrop(into: item, model: model)
        .navigationTitle(searching ? "Search" : model.title(of: item))
        .searchable(text: $model.query, prompt: "Search notes")
        .onChange(of: model.query) { model.queryChanged() }
        .safeAreaInset(edge: .bottom) { footer }
        .toolbar {
            ToolbarItemGroup(placement: .topBarLeading) {
                Button("Back", systemImage: "chevron.backward") { model.goBack() }
                    .keyboardShortcut("[", modifiers: .command)
                    .disabled(!model.canGoBack)
                Button("Forward", systemImage: "chevron.forward") { model.goForward() }
                    .keyboardShortcut("]", modifiers: .command)
                    .disabled(!model.canGoForward)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if item != .favorites {
                    Button("New Group", systemImage: "folder.badge.plus") { prompt = .newGroup(in: item == .all ? nil : item) }
                }
                Button("New Note", systemImage: "square.and.pencil") { Task { await model.createNote() } }
            }
        }
    }

    // MARK: Putting things in order

    /// A drag within the list: the notes in a group (or a notebook's own) keep the order the person puts them in. All Notes is by date, so it has none.
    private func moveNotes(_ notes: [NoteSummary], in list: SidebarItem, from source: IndexSet, to destination: Int) {
        guard model.isOrdered(list), let from = source.first, notes.indices.contains(from) else { return }
        let before = destination < notes.count ? notes[destination].id : nil
        let inGroup: Int64? = if case .group(let id) = list { id } else { nil }
        Task { await model.place(note: notes[from].id, in: inGroup, before: before) }
    }

    private func moveGroups(_ groups: [NoteGroup], from source: IndexSet, to destination: Int) {
        guard let from = source.first, groups.indices.contains(from) else { return }
        let moved = groups[from]
        let before = destination < groups.count ? groups[destination].id : nil
        Task { await model.place(group: moved.id, parent: moved.parentId, before: before) }
    }

    // MARK: Rows

    @ViewBuilder private var favorites: some View {
        let groups = model.favoriteGroups
        let notes = model.favoriteNotes
        if !groups.isEmpty {
            Section("Groups") { ForEach(groups, id: \.id) { groupRow($0) } }
        }
        if !notes.isEmpty {
            Section("Notes") { ForEach(notes, id: \.id) { noteRow($0, in: .favorites) } }
        }
    }

    private func groupRow(_ group: NoteGroup) -> some View {
        Button {
            model.visit(.group(group.id))
        } label: {
            HStack {
                Label(group.name, systemImage: "folder")
                Spacer()
                if model.isFavorite(.group, group.id) { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
                Text("\(model.totals.groups[group.id] ?? 0)").font(.callout.monospacedDigit()).foregroundStyle(look.mutedText)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(look.mutedText).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("group-row-\(group.id)")
        .dragSource(DraggedItem(kind: .group, id: group.id), in: model)
        .dropTarget(.group(group.id), in: model)
        .contextMenu {
            let favorite = model.isFavorite(.group, group.id)
            Button("Rename…", systemImage: "pencil") { prompt = .rename(.group(group.id)) }
            Button(favorite ? "Remove from Favorites" : "Add to Favorites", systemImage: favorite ? "star.slash" : "star") { Task { await model.toggleFavorite(.group, group.id) } }
            Button("Move to…", systemImage: "arrow.right.square") { moving = DraggedItem(kind: .group, id: group.id) }
            Divider()
            Button("Delete Group", systemImage: "trash", role: .destructive) { Task { await model.deleteGroup(group.id) } }
        }
    }

    /// `list` is the list the row is in, whose order a drop beside it sets (nil in search results, which have none).
    private func noteRow(_ note: NoteSummary, in list: SidebarItem?) -> some View {
        let favorite = model.isFavorite(.note, note.id)
        return NoteRow(note: note, favorite: favorite)
            .tag(note.id)
            .accessibilityIdentifier("note-row-\(note.id)")
            .swipeActions(edge: .leading) {
                Button(favorite ? "Unfavorite" : "Favorite", systemImage: "star") { Task { await model.toggleFavorite(.note, note.id) } }.tint(.yellow)
            }
            .swipeActions(edge: .trailing) {
                Button("Trash", systemImage: "trash", role: .destructive) { Task { await model.moveToTrash(note.id) } }
            }
            .contextMenu {
                Button(favorite ? "Remove from Favorites" : "Add to Favorites", systemImage: favorite ? "star.slash" : "star") { Task { await model.toggleFavorite(.note, note.id) } }
                Button("Move to…", systemImage: "arrow.right.square") { moving = DraggedItem(kind: .note, id: note.id) }
                Divider()
                Button("Move to Trash Can", systemImage: "trash", role: .destructive) { Task { await model.moveToTrash(note.id) } }
            }
            .dragSource(DraggedItem(kind: .note, id: note.id), in: model)
            .dropTarget(.note(note.id, list: list), in: model)
    }

    @ViewBuilder private var empty: some View {
        if searching {
            if model.notes.isEmpty { ContentUnavailableView.search(text: model.query) }
        } else if item == .favorites {
            if model.favoriteGroups.isEmpty && model.favoriteNotes.isEmpty {
                ContentUnavailableView("No favorites", systemImage: "star", description: Text("Swipe a note or group right, or use its menu, to pin it here."))
            }
        } else if model.subgroups(of: item).isEmpty && model.notes(in: item).isEmpty {
            switch item {
            case .all: ContentUnavailableView("No notes", systemImage: "doc.text", description: Text("Everything is in the Trash Can, or the backup had no notes."))
            default: ContentUnavailableView("Nothing here yet", systemImage: "folder", description: Text("Make a note or a group with the buttons above, or drag some in."))
            }
        }
    }
}
