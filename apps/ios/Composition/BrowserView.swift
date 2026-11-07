import CompositionCore
import SwiftUI

/// The list of notes with a search field, and the note beside it.
struct BrowserView: View {
    @Bindable var model: AppModel
    var chooseBackup: () -> Void
    @State private var showingTrash = false
    @State private var showingAbout = false
    @State private var showingLab = false
    @State private var confirmingReplace = false
    /// The note that was open when the app was last ended; the system brings it back (0 is none).
    @SceneStorage("selectedNote") private var storedSelection = 0

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selection) {
                ForEach(model.notes, id: \.id) { note in
                    NoteRow(note: note)
                        .tag(note.id)
                        .swipeActions {
                            Button("Trash", systemImage: "trash", role: .destructive) { Task { await model.moveToTrash(note.id) } }
                        }
                }
            }
            .overlay {
                if model.notes.isEmpty {
                    if model.query.trimmingCharacters(in: .whitespaces).isEmpty {
                        ContentUnavailableView("No notes", systemImage: "doc.text", description: Text("Everything is in the Trash Can, or the backup had no notes."))
                    } else {
                        ContentUnavailableView.search(text: model.query)
                    }
                }
            }
            .navigationTitle("Notes")
            .searchable(text: $model.query, placement: .sidebar, prompt: "Search notes")
            .onChange(of: model.query) { model.queryChanged() }
            .safeAreaInset(edge: .bottom) { footer }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingTrash = true } label: {
                        Label("Trash Can", systemImage: model.trashedNotes.isEmpty && model.trashedGroups.isEmpty ? "trash" : "trash.fill")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Export a backup…", systemImage: "square.and.arrow.up") { Task { await model.exportBackup() } }
                        Button("Replace with a backup…", systemImage: "arrow.down.doc") { confirmingReplace = true }
                        Button("Editor lab (spike S3)", systemImage: "pencil.and.outline") { showingLab = true }
                        Button("About this build", systemImage: "info.circle") { showingAbout = true }
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
        } detail: {
            if let id = model.selection {
                NoteDetailView(model: model, noteID: id)
            } else {
                ContentUnavailableView("Select a note", systemImage: "doc.text")
            }
        }
        .onAppear {
            // Developer shortcut: `-openLab 1` opens the editor lab at launch.
            if UserDefaults.standard.bool(forKey: "openLab") { showingLab = true }
            if model.selection == nil, storedSelection != 0, model.notes.contains(where: { $0.id == Int64(storedSelection) }) {
                model.selection = Int64(storedSelection)
            }
        }
        .onChange(of: model.selection) { storedSelection = Int($1 ?? 0) }
        .sheet(isPresented: $showingTrash) { TrashView(model: model) }
        .sheet(isPresented: $showingAbout) { AboutView(model: model) }
        .fullScreenCover(isPresented: $showingLab) { EditorLabView(model: model) }
        .confirmationDialog("Replace everything on this iPad?", isPresented: $confirmingReplace, titleVisibility: .visible) {
            Button("Choose a backup…", role: .destructive, action: chooseBackup)
        } message: {
            Text("Notes, the Trash Can, images and files are replaced by the backup's. Nothing is merged, and the current ones are not kept.")
        }
    }

    private var footer: some View {
        VStack(spacing: 2) {
            Text(model.resultLine).font(.footnote.monospacedDigit())
            if model.query.isEmpty {
                Text("Try  tag: infra  ·  created: >2026-01-01  ·  title: routng").font(.caption2)
            }
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

struct NoteRow: View {
    let note: NoteSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(note.title.isEmpty ? "Untitled" : note.title).font(.headline).lineLimit(2)
            HStack(spacing: 8) {
                if let date = Stamp.date(note.updatedAt) { Text(date, format: .dateTime.year().month().day()) }
                if !note.tags.tagLine.isEmpty { Text(note.tags.tagLine).lineLimit(1) }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
