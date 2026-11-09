import CompositionCore
import SwiftUI

/// A question that needs a name: shown as an alert with a text field.
enum Prompt: Identifiable, Equatable {
    case newGroup(in: SidebarItem?)
    case newNotebook
    case rename(SidebarItem)

    var id: String {
        switch self {
        case .newGroup(let parent): "newGroup:\(parent?.stored ?? "-")"
        case .newNotebook: "newNotebook"
        case .rename(let item): "rename:\(item.stored)"
        }
    }

    var title: String {
        switch self {
        case .newGroup(.group?): "New Sub-group"
        case .newGroup: "New Group"
        case .newNotebook: "New Notebook"
        case .rename: "Rename"
        }
    }

    /// What the field holds when the alert opens: the current name for a rename, nothing otherwise.
    @MainActor func startingText(in model: AppModel) -> String {
        if case .rename(let item) = self { return model.title(of: item) }
        return ""
    }

    var confirm: String {
        switch self {
        case .rename: "Rename"
        default: "Create"
        }
    }
}

/// The first column: All Notes, Favorites, and the notebooks with their groups (build plan Step 7). The tree is drawn flat, with a disclosure
/// button on each row that has groups beneath it, so that the rows can be opened from code (a group picked in the list opens the ones above it).
struct SidebarView: View {
    @Bindable var model: AppModel
    @Environment(\.look) private var look
    @Binding var prompt: Prompt?
    @Binding var moving: DraggedItem?

    var body: some View {
        List(selection: Binding(get: { model.sidebar }, set: { model.visit($0) })) {
            ForEach(model.sidebarRows) { row in
                SidebarRowView(model: model, row: row)
                    .tag(row.item)
                    .modifier(RowAffordances(model: model, row: row, prompt: $prompt, moving: $moving))
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(look.panel)
        .dropList()
    }
}

private struct SidebarRowView: View {
    let model: AppModel
    let row: SidebarRow
    @Environment(\.look) private var look
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: textSize.isAccessibilitySize ? .top : .center, spacing: 0) {
            Color.clear.frame(width: CGFloat(row.depth) * 16, height: 1)
            if row.expandable {
                Button {
                    withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) { model.toggleExpanded(row.item) }
                } label: {
                    Image(systemName: row.isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.semibold))
                        // A finger needs 44 points each way.
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(row.isExpanded ? "Close \(row.title)" : "Open \(row.title)")
            } else if !textSize.isAccessibilitySize {
                Color.clear.frame(width: 44, height: 1)
            }
            // The name and its count read as one thing; the disclosure button beside them stays a button of its own.
            Group {
                if textSize.isAccessibilitySize {
                    // At the accessibility sizes the name has the whole width and the count goes under it, so that no word is broken to fit.
                    VStack(alignment: .leading, spacing: 4) {
                        Label(row.title, systemImage: row.systemImage).fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 6) {
                            if case .group(let id) = row.item, model.isFavorite(.group, id) { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
                            Text("\(row.count)").font(.callout.monospacedDigit()).foregroundStyle(look.mutedText)
                        }
                    }
                    .padding(.vertical, 6)
                } else {
                    HStack(spacing: 6) {
                        Label(row.title, systemImage: row.systemImage).lineLimit(2)
                        Spacer(minLength: 4)
                        if case .group(let id) = row.item, model.isFavorite(.group, id) {
                            Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
                        }
                        Text("\(row.count)").font(.callout.monospacedDigit()).foregroundStyle(look.mutedText)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("sidebar-\(row.item.stored)")
        }
    }
}

/// What a row of the sidebar can do besides being selected: its menu, its swipes, being picked up and being dropped on.
private struct RowAffordances: ViewModifier {
    let model: AppModel
    let row: SidebarRow
    @Binding var prompt: Prompt?
    @Binding var moving: DraggedItem?

    func body(content: Content) -> some View {
        switch row.item {
        case .all, .favorites:
            content
        case .notebook(let id):
            content
                .contextMenu { notebookMenu(id) }
                .dragSource(DraggedItem(kind: .notebook, id: id), in: model)
                .dropTarget(.notebook(id), in: model)
        case .group(let id):
            content
                .contextMenu { groupMenu(id) }
                .swipeActions(edge: .leading) {
                    Button(model.isFavorite(.group, id) ? "Unfavorite" : "Favorite", systemImage: "star") { Task { await model.toggleFavorite(.group, id) } }.tint(.yellow)
                }
                .swipeActions(edge: .trailing) {
                    Button("Delete", systemImage: "trash", role: .destructive) { Task { await model.deleteGroup(id) } }
                }
                .dragSource(DraggedItem(kind: .group, id: id), in: model)
                .dropTarget(.group(id), in: model)
        }
    }

    @ViewBuilder private func groupMenu(_ id: Int64) -> some View {
        let favorite = model.isFavorite(.group, id)
        Button("New Note Here", systemImage: "square.and.pencil") {
            model.visit(.group(id))
            Task { await model.createNote() }
        }
        Button("New Sub-group", systemImage: "folder.badge.plus") { prompt = .newGroup(in: .group(id)) }
        Button("Rename…", systemImage: "pencil") { prompt = .rename(.group(id)) }
        Button(favorite ? "Remove from Favorites" : "Add to Favorites", systemImage: favorite ? "star.slash" : "star") { Task { await model.toggleFavorite(.group, id) } }
        Button("Move to…", systemImage: "arrow.right.square") { moving = DraggedItem(kind: .group, id: id) }
        if let siblings = siblings(of: id), let at = siblings.firstIndex(where: { $0.id == id }), let group = model.group(id) {
            if at > 0 { Button("Move Up", systemImage: "arrow.up") { Task { await model.place(group: id, parent: group.parentId, before: siblings[at - 1].id) } } }
            if at < siblings.count - 1 {
                Button("Move Down", systemImage: "arrow.down") {
                    Task { await model.place(group: id, parent: group.parentId, before: siblings.dropFirst(at + 2).first?.id) }
                }
            }
        }
        Divider()
        Button("Delete Group", systemImage: "trash", role: .destructive) { Task { await model.deleteGroup(id) } }
    }

    @ViewBuilder private func notebookMenu(_ id: Int64) -> some View {
        Button("New Group", systemImage: "folder.badge.plus") { prompt = .newGroup(in: .notebook(id)) }
        Button("New Note Here", systemImage: "square.and.pencil") {
            model.visit(.notebook(id))
            Task { await model.createNote() }
        }
        Button("Rename…", systemImage: "pencil") { prompt = .rename(.notebook(id)) }
        if let at = model.notebooks.firstIndex(where: { $0.id == id }) {
            if at > 0 { Button("Move Up", systemImage: "arrow.up") { Task { await model.place(notebook: id, before: model.notebooks[at - 1].id) } } }
            if at < model.notebooks.count - 1 {
                Button("Move Down", systemImage: "arrow.down") { Task { await model.place(notebook: id, before: model.notebooks.dropFirst(at + 2).first?.id) } }
            }
        }
        Divider()
        Button("Delete Notebook", systemImage: "trash", role: .destructive) { Task { await model.deleteNotebook(id) } }
    }

    private func siblings(of id: Int64) -> [NoteGroup]? {
        guard let group = model.group(id) else { return nil }
        return model.groups.filter { $0.parentId == group.parentId && $0.notebookId == group.notebookId }
    }
}
