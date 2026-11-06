import CompositionCore
import SwiftUI

/// One note, as its Markdown source. There is no editing or rendering yet.
struct NoteDetailView: View {
    let model: AppModel
    let noteID: Int64
    @State private var note: NoteDetail?
    @State private var confirmingTrash = false

    var body: some View {
        ScrollView {
            if let note {
                VStack(alignment: .leading, spacing: 12) {
                    Text(note.title.isEmpty ? "Untitled" : note.title).font(.largeTitle.bold())
                    HStack(spacing: 12) {
                        if let date = Stamp.date(note.updatedAt) { Label(date.formatted(date: .abbreviated, time: .shortened), systemImage: "clock") }
                        if !note.tags.tagLine.isEmpty { Text(note.tags.tagLine) }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    Divider()
                    Text(note.content)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ProgressView().padding(40)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: noteID) { note = await model.detail(of: noteID) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Move to Trash Can", systemImage: "trash") { confirmingTrash = true }
            }
        }
        .confirmationDialog("Move this note to the Trash Can?", isPresented: $confirmingTrash, titleVisibility: .visible) {
            Button("Move to Trash Can", role: .destructive) { Task { await model.moveToTrash(noteID) } }
        } message: {
            Text("It stays there for 60 days and can be restored.")
        }
    }
}
