import CompositionCore
import SwiftUI

struct TrashView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look

    var body: some View {
        NavigationStack {
            Group {
                if model.trashedNotes.isEmpty && model.trashedGroups.isEmpty {
                    ContentUnavailableView("The Trash Can is empty", systemImage: "trash", description: Text("Swipe a note to move it here. Things stay for 60 days."))
                } else {
                    List {
                        if !model.trashedNotes.isEmpty {
                            Section("Notes") {
                                ForEach(model.trashedNotes, id: \.id) { note in
                                    row(title: note.title, deletedAt: note.deletedAt, expiresAt: note.expiresAt)
                                        .swipeActions(edge: .leading) { Button("Restore", systemImage: "arrow.uturn.backward") { Task { await model.restoreNote(note.id) } }.tint(.green) }
                                        .swipeActions(edge: .trailing) { Button("Delete forever", systemImage: "trash", role: .destructive) { Task { await model.purgeNote(note.id) } } }
                                }
                            }
                        }
                        if !model.trashedGroups.isEmpty {
                            Section("Groups") {
                                ForEach(model.trashedGroups, id: \.id) { group in
                                    row(title: group.name, deletedAt: group.deletedAt, expiresAt: group.expiresAt)
                                        .swipeActions(edge: .leading) { Button("Restore", systemImage: "arrow.uturn.backward") { Task { await model.restoreGroup(group.id) } }.tint(.green) }
                                        .swipeActions(edge: .trailing) { Button("Delete forever", systemImage: "trash", role: .destructive) { Task { await model.purgeGroup(group.id) } } }
                                }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(look.background)
            .navigationTitle("Trash Can")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func row(title: String, deletedAt: String, expiresAt: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.isEmpty ? "Untitled" : title).font(.headline)
            HStack(spacing: 8) {
                if let date = Stamp.date(deletedAt) { Text("Deleted \(date.formatted(date: .abbreviated, time: .omitted))") }
                if let expiresAt { Text("\(TrashRetention.daysLeft(expiresAt: expiresAt)) days left") }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}
