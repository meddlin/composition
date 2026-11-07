import CompositionCore
import SwiftUI

/// One note, drawn as a preview (Markdown and the components), shown as its source, or edited as plain text. Editing is the write
/// path of build plan Step 4 (see `NoteEditorView`); the real editor replaces it in Step 6.
struct NoteDetailView: View {
    enum Mode: String, CaseIterable { case preview = "Preview", source = "Source", edit = "Edit" }

    let model: AppModel
    let noteID: Int64
    @State private var note: NoteDetail?
    @State private var preview: NotePreview?
    // What the system brings back after the app was ended: the tab, and where the caret was.
    @SceneStorage("noteMode") private var mode = Mode.preview
    @SceneStorage("caretOffset") private var caret = 0
    @SceneStorage("caretNote") private var caretNote = 0
    @State private var session: NoteSession?
    @State private var confirmingTrash = false

    var body: some View {
        Group {
            if mode == .edit, let session {
                NoteEditorView(session: session, initialCaret: caretNote == Int(noteID) ? caret : 0) { offset in
                    caret = offset
                    caretNote = Int(noteID)
                }
                .id(session.noteId)
                .overlay(alignment: .top) { saveProblem }
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        content
                    }
                    .environment(\.scrollToHeading, { ordinal in withAnimation { proxy.scrollTo(PreviewScroll.headingID(ordinal), anchor: .top) } })
                    .environment(\.imageFolder, model.location.imagesURL)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: noteID) {
            endEditing()
            preview = nil
            #if DEBUG
            // Developer shortcut: `-openMode Edit` (or Source) at launch.
            if let name = UserDefaults.standard.string(forKey: "openMode"), let forced = Mode(rawValue: name) { mode = forced }
            #endif
            note = await model.detail(of: noteID)
            if let content = note?.content { preview = await Task.detached(priority: .userInitiated) { NotePreview.make(content: content) }.value }
            if mode == .edit { await beginEditing() }
        }
        .onChange(of: mode) { old, new in
            Task {
                if old == .edit { await endEditing(reload: true)?.value }
                if new == .edit { await beginEditing() }
            }
        }
        .onDisappear { endEditing() }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) } }.pickerStyle(.segmented).frame(width: 300)
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
    private var saveProblem: some View {
        if let problem = model.saveProblem {
            Label("Couldn't save: \(problem) What you typed is kept, and saving will be tried again.", systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.yellow.opacity(0.9))
                .foregroundStyle(.black)
        }
    }

    /// Opens the note's session, so that what is typed is saved. The last window to close it writes what is unsaved.
    private func beginEditing() async {
        guard session == nil else { return }
        session = await model.openSession(noteID)
    }

    /// Closes the session (saving what is unsaved) and, when `reload` is set, shows the note as it is stored now.
    @discardableResult
    private func endEditing(reload: Bool = false) -> Task<Void, Never>? {
        if let open = session {
            model.closeSession(open)
            session = nil
        }
        guard reload else { return nil }
        return Task {
            note = await model.detail(of: noteID)
            preview = nil
            if let content = note?.content { preview = await Task.detached(priority: .userInitiated) { NotePreview.make(content: content) }.value }
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
                    case .edit:
                        ProgressView()  // the editor takes the place of all of this once the note's session is open
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
