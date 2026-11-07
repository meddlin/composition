import CompositionCore
import SwiftUI

/// "Move to…": the same moves as dragging, from a list, for a note or a group (and for anyone who cannot drag).
struct MoveSheet: View {
    let model: AppModel
    let item: DraggedItem
    @Environment(\.dismiss) private var dismiss

    private struct Entry: Identifiable {
        let group: NoteGroup
        let depth: Int
        var id: Int64 { group.id }
    }

    private func entries(in notebook: Notebook) -> [Entry] {
        var children: [Int64?: [NoteGroup]] = [:]
        for group in model.groups { children[group.parentId, default: []].append(group) }
        var result: [Entry] = []
        func add(_ group: NoteGroup, _ depth: Int) {
            result.append(Entry(group: group, depth: depth))
            for kid in children[group.id] ?? [] { add(kid, depth + 1) }
        }
        for top in (children[nil] ?? []).filter({ $0.notebookId == notebook.id }) { add(top, 0) }
        return result
    }

    private var title: String {
        switch item.kind {
        case .note: model.orderedNotes.first { $0.id == item.id }?.title ?? "Note"
        case .group: model.group(item.id)?.name ?? "Group"
        case .notebook: "Notebook"
        }
    }

    private var currentGroup: Int64? {
        switch item.kind {
        case .note: model.orderedNotes.first { $0.id == item.id }?.groupId
        case .group: model.group(item.id)?.parentId
        case .notebook: nil
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if item.kind == .note {
                    Section {
                        button("No group", systemImage: "tray", selected: currentGroup == nil) { await model.move(note: item.id, toGroup: nil) }
                    } footer: {
                        Text("The note stays in the notebook it is in.")
                    }
                }
                ForEach(model.notebooks, id: \.id) { notebook in
                    Section(notebook.name) {
                        if item.kind == .group {
                            let here = model.group(item.id)?.notebookId == notebook.id
                            button("Top level", systemImage: "books.vertical", selected: here && currentGroup == nil) {
                                if here { await model.move(group: item.id, toParent: nil) } else { await model.move(group: item.id, toNotebook: notebook.id) }
                            }
                        }
                        ForEach(entries(in: notebook)) { entry in
                            let allowed = model.allowedEdges(of: item, on: .group(entry.group.id)).contains(.into)
                            Button {
                                Task {
                                    await model.drop(item, on: .group(entry.group.id), edge: .into)
                                    dismiss()
                                }
                            } label: {
                                HStack {
                                    Label(entry.group.name, systemImage: "folder").padding(.leading, CGFloat(entry.depth) * 18)
                                    Spacer()
                                    if currentGroup == entry.group.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                            .disabled(!allowed)
                        }
                    }
                }
            }
            .navigationTitle("Move “\(title)”")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func button(_ title: String, systemImage: String, selected: Bool, _ action: @escaping () async -> Void) -> some View {
        Button {
            Task {
                await action()
                dismiss()
            }
        } label: {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
    }
}
