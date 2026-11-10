import CompositionCore
import SwiftUI

// The home page (the tracker's M3† row; the desktop's `HomePage.tsx`): what the detail column shows while no note is open. The pinned notes and groups, every notebook, and
// the notes edited most recently. The cards flow to the width they are given, so a wide window shows several to a row and a narrow one a single column. The desktop lets
// the person choose which sections show and in what order, how dense the cards are, and which notebook the recent notes come from; none of that is kept by the iPad (its
// settings file holds only the favorites of the home page), so this is the desktop's default page. Recent notes are by last edit: the iPad does not record when a note
// was last opened.

struct HomePageView: View {
    let model: AppModel
    /// Shows the list of a notebook or a group (the screen brings the notes list into view where it is hidden, as in portrait).
    var showList: (SidebarItem) -> Void = { _ in }
    @Environment(\.look) private var look
    @State private var excerpts: [Int64: String] = [:]

    private var recent: [NoteSummary] { HomeListing.recent(model.orderedNotes) }
    private var pinned: [HomeListing.Pinned] { HomeListing.pinned(favorites: model.favorites, groups: model.groups, notes: model.orderedNotes) }

    /// The notes whose cards say a line of their text.
    private var excerptKey: String {
        let ids = recent.map(\.id) + pinned.compactMap { if case .note(let note) = $0 { note.id } else { nil } }
        return "\(model.loads):\(ids)"
    }

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Home").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                if !pinned.isEmpty {
                    section("Pinned", systemImage: "pin") { ForEach(pinned.indices, id: \.self) { pinnedCard(pinned[$0]) } }
                }
                if !model.notebooks.isEmpty {
                    section("Notebooks", systemImage: "books.vertical") { ForEach(Array(model.notebooks.enumerated()), id: \.element.id) { notebookCard($0.element, index: $0.offset) } }
                }
                if recent.isEmpty {
                    ContentUnavailableView("No notes yet", systemImage: "square.and.pencil", description: Text("Make a note with the + button in the list, and it will show up here."))
                } else {
                    section("Recent", systemImage: "clock") { ForEach(recent, id: \.id) { noteCard($0, pinned: false, identifier: "home-recent-\($0.id)") } }
                }
            }
            .padding(20)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(look.background)
        .foregroundStyle(look.foreground)
        .task(id: excerptKey) {
            let ids = recent.map(\.id) + pinned.compactMap { if case .note(let note) = $0 { note.id } else { nil } }
            excerpts = await model.excerpts(of: ids)
        }
        .accessibilityIdentifier("home-page")
    }

    private func section<Content: View>(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage).font(.headline).foregroundStyle(look.mutedText).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: columns, spacing: 12, content: content)
        }
    }

    // MARK: Cards

    @ViewBuilder private func pinnedCard(_ item: HomeListing.Pinned) -> some View {
        switch item {
        case .note(let note): noteCard(note, pinned: true, identifier: "home-pinned-note-\(note.id)")
        case .group(let group): groupCard(group)
        }
    }

    private func noteCard(_ note: NoteSummary, pinned: Bool, identifier: String) -> some View {
        let notebook = note.notebookId.flatMap { id in model.notebooks.first { $0.id == id }?.name }
        let excerpt = excerpts[note.id] ?? ""
        return card(identifier: identifier, accent: note.notebookId.map(accent(forNotebook:)), action: { model.followNoteLink(note.id) }) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "doc.text").font(.subheadline).foregroundStyle(look.mutedText).accessibilityHidden(true)
                Text(note.title.isEmpty ? "Untitled" : note.title).font(.headline).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if pinned { Image(systemName: "pin.fill").font(.caption).foregroundStyle(look.mutedText).accessibilityLabel("Pinned") }
            }
            if !excerpt.isEmpty { Text(excerpt).font(.subheadline).foregroundStyle(look.mutedText).lineLimit(2).multilineTextAlignment(.leading) }
            detail([notebook, when(note.updatedAt)])
        }
    }

    private func groupCard(_ group: NoteGroup) -> some View {
        let total = model.totals.groups[group.id] ?? 0
        let notebook = group.notebookId.flatMap { id in model.notebooks.first { $0.id == id }?.name }
        return card(identifier: "home-pinned-group-\(group.id)", accent: group.notebookId.map(accent(forNotebook:)), action: { showList(.group(group.id)) }) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "folder").font(.subheadline).foregroundStyle(look.mutedText).accessibilityHidden(true)
                Text(group.name).font(.headline).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "pin.fill").font(.caption).foregroundStyle(look.mutedText).accessibilityLabel("Pinned")
            }
            detail([notebook, "\(total) \(total == 1 ? "note" : "notes")"])
        }
    }

    private func notebookCard(_ notebook: Notebook, index: Int) -> some View {
        let total = model.totals.notebooks[notebook.id] ?? 0
        return card(identifier: "home-notebook-\(notebook.id)", accent: accent(forIndex: index), action: { showList(.notebook(notebook.id)) }) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "book.closed").font(.subheadline).foregroundStyle(look.mutedText).accessibilityHidden(true)
                Text(notebook.name).font(.headline).lineLimit(2).multilineTextAlignment(.leading)
            }
            detail(["\(total) \(total == 1 ? "note" : "notes")"])
        }
    }

    private func card<Content: View>(identifier: String, accent: Color?, action: @escaping () -> Void, @ViewBuilder content: () -> Content) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6, content: content)
                .padding(12)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .background(look.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(alignment: .leading) { if let accent { Rectangle().fill(accent).frame(width: 4).clipShape(RoundedRectangle(cornerRadius: 2)).padding(.vertical, 8) } }
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(look.border) }
                .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder private func detail(_ parts: [String?]) -> some View {
        let text = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        if !text.isEmpty { Text(text).font(.caption).foregroundStyle(look.mutedText).lineLimit(1) }
    }

    // MARK: What a card says

    /// "5 min ago", or the date once it is a month or more ago.
    private func when(_ iso: String) -> String {
        HomeListing.relativeTime(iso) ?? Stamp.date(iso).map { $0.formatted(.dateTime.year().month(.abbreviated).day()) } ?? ""
    }

    /// A notebook's colour is one of the scheme's, by its place in the list, so that notebooks are told apart at a glance (the desktop's default; it lets the person choose).
    private func accent(forIndex index: Int) -> Color {
        [look.brand, look.link, look.success, look.warning, look.error][index % 5]
    }

    private func accent(forNotebook id: Int64) -> Color {
        accent(forIndex: model.notebooks.firstIndex { $0.id == id } ?? 0)
    }
}
