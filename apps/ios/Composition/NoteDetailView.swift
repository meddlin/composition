import CompositionCore
import SwiftUI

/// One note, drawn as a preview (Markdown and the components) or shown as its source. There is no editing yet.
struct NoteDetailView: View {
    enum Mode: String, CaseIterable { case preview = "Preview", source = "Source" }

    let model: AppModel
    let noteID: Int64
    @State private var note: NoteDetail?
    @State private var preview: NotePreview?
    @State private var mode = Mode.preview
    @State private var confirmingTrash = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                content
            }
            .environment(\.scrollToHeading, { ordinal in withAnimation { proxy.scrollTo(PreviewScroll.headingID(ordinal), anchor: .top) } })
            .environment(\.imageFolder, model.location.imagesURL)
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: noteID) {
            preview = nil
            note = await model.detail(of: noteID)
            if let content = note?.content { preview = await Task.detached(priority: .userInitiated) { NotePreview.make(content: content) }.value }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) } }.pickerStyle(.segmented).frame(width: 220)
            }
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

    @ViewBuilder
    private var content: some View {
        Group {
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
                    switch mode {
                    case .preview:
                        if let preview { NotePreviewView(preview: preview) } else { ProgressView() }
                    case .source:
                        Text(note.content)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ProgressView().padding(40)
            }
        }
    }
}
