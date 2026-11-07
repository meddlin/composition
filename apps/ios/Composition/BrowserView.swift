import CompositionCore
import SwiftUI

/// The list of notes with a search field, and the note beside it.
struct BrowserView: View {
    @Bindable var model: AppModel
    var chooseBackup: () -> Void
    @State private var showingTrash = false
    @State private var showingAbout = false
    @State private var showingAppearance = false
    @State private var showingLab = false
    @State private var confirmingReplace = false
    /// The note that was open when the app was last ended; the system brings it back (0 is none).
    @SceneStorage("selectedNote") private var storedSelection = 0
    @SceneStorage("sidebarItem") private var storedSidebar = "all"
    @SceneStorage("openGroups") private var storedExpanded = ""
    @State private var columns = NavigationSplitViewVisibility.automatic
    @State private var prompt: Prompt?
    @State private var promptText = ""
    @State private var moving: DraggedItem?
    @State private var restored = false
    @State private var width: CGFloat = 0

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            SidebarView(model: model, prompt: $prompt, moving: $moving)
                .navigationTitle("Notebooks")
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button { prompt = .newNotebook } label: { Label("New notebook", systemImage: "plus") }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button { showingTrash = true } label: {
                            Label("Trash Can", systemImage: model.trashedNotes.isEmpty && model.trashedGroups.isEmpty ? "trash" : "trash.fill")
                        }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button("Export a backup…", systemImage: "square.and.arrow.up") { Task { await model.exportBackup() } }
                            Button("Replace with a backup…", systemImage: "arrow.down.doc") { confirmingReplace = true }
                            Button("Appearance…", systemImage: "paintpalette") { showingAppearance = true }
                            Button("Editor lab (spike S3)", systemImage: "pencil.and.outline") { showingLab = true }
                            Button("About this build", systemImage: "info.circle") { showingAbout = true }
                        } label: {
                            Label("More", systemImage: "ellipsis.circle")
                        }
                    }
                }
        } content: {
            NotesColumnView(model: model, prompt: $prompt, moving: $moving, footer: AnyView(footer))
        } detail: {
            if let id = model.selection {
                NoteDetailView(model: model, noteID: id)
            } else {
                ContentUnavailableView("Select a note", systemImage: "doc.text")
            }
        }
        .navigationSplitViewStyle(.balanced)
        // Turning the iPad to landscape brings the sidebar back, which the system hid in portrait and does not bring back by itself; a column hidden by hand
        // in landscape stays hidden, because only crossing this width changes anything.
        .background(GeometryReader { proxy in Color.clear.onAppear { width = proxy.size.width }.onChange(of: proxy.size.width) { _, new in width = new } })
        .onChange(of: width) { old, new in
            // A moment later, because the system settles its own choice first and would undo this.
            if old < 900, new >= 900 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { columns = .all } } else if old >= 900, new < 900 { columns = .automatic }
        }
        .onAppear {
            // Developer shortcut: `-openLab 1` opens the editor lab at launch.
            if UserDefaults.standard.bool(forKey: "openLab") { showingLab = true }
        }
        // Once the notes are read, back to where the app was left (the screen can appear before they are).
        .onChange(of: model.loads, initial: true) { _, loads in
            guard loads > 0, !restored else { return }
            restored = true
            restoreScene()
        }
        .onChange(of: model.selection) { storedSelection = Int($1 ?? 0) }
        .onChange(of: model.sidebar) { storedSidebar = ($1 ?? .all).stored }
        .onChange(of: model.expanded) { storedExpanded = $1.map(\.stored).sorted().joined(separator: ",") }
        .onChange(of: prompt) { promptText = $1?.startingText(in: model) ?? "" }
        .sheet(isPresented: $showingTrash) { TrashView(model: model) }
        .sheet(isPresented: $showingAbout) { AboutView(model: model) }
        .sheet(isPresented: $showingAppearance) { AppearanceView(model: model) }
        .sheet(item: $moving) { MoveSheet(model: model, item: $0) }
        .fullScreenCover(isPresented: $showingLab) { EditorLabView(model: model) }
        .alert(prompt?.title ?? "", isPresented: Binding(get: { prompt != nil }, set: { if !$0 { prompt = nil } }), presenting: prompt) { current in
            TextField("Name", text: $promptText)
            Button("Cancel", role: .cancel) {}
            Button(current.confirm) { submit(current) }
        }
        .confirmationDialog("Replace everything on this iPad?", isPresented: $confirmingReplace, titleVisibility: .visible) {
            Button("Choose a backup…", role: .destructive, action: chooseBackup)
        } message: {
            Text("Notes, the Trash Can, images and files are replaced by the backup's. Nothing is merged, and the current ones are not kept.")
        }
    }

    /// What the system brings back after the app was ended: the note, the sidebar's choice and the groups that were open.
    private func restoreScene() {
        if model.sidebar == .all, let item = SidebarItem(stored: storedSidebar), model.isValid(.list(item)) { model.sidebar = item }
        if model.expanded.isEmpty { model.expanded = Set(storedExpanded.split(separator: ",").compactMap { SidebarItem(stored: String($0)) }) }
        if model.selection == nil, storedSelection != 0, model.orderedNotes.contains(where: { $0.id == Int64(storedSelection) }) {
            model.selection = Int64(storedSelection)
        }
        // The history starts from where the app opens.
        if let item = model.sidebar { model.history.record(.list(item)) }
        if let id = model.selection { model.history.record(.note(id)) }
    }

    private func submit(_ current: Prompt) {
        let name = promptText
        Task {
            switch current {
            case .newGroup(let parent): await model.createGroup(named: name, in: parent)
            case .newNotebook: await model.createNotebook(named: name)
            case .rename(let item): await model.rename(item, to: name)
            }
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
    var favorite = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(note.title.isEmpty ? "Untitled" : note.title).font(.headline).lineLimit(2)
                if favorite { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
            }
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
