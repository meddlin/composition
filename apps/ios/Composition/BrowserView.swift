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
    @State private var showingPdfInkLab = false
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
    @Environment(\.look) private var look
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            SidebarView(model: model, prompt: $prompt, moving: $moving)
                // Wider where the text is large, so that the names of notebooks are not broken to fit.
                .navigationSplitViewColumnWidth(min: 250, ideal: textSize.isAccessibilitySize ? 420 : 320, max: 520)
                .safeAreaInset(edge: .bottom) { appearanceButton }
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
                            Button("PDF ink lab (spike B)", systemImage: "pencil.and.scribble") { showingPdfInkLab = true }
                            Button("About this build", systemImage: "info.circle") { showingAbout = true }
                        } label: {
                            Label("More", systemImage: "ellipsis.circle")
                        }
                    }
                }
        } content: {
            NotesColumnView(model: model, prompt: $prompt, moving: $moving, footer: AnyView(footer))
                .navigationSplitViewColumnWidth(min: 300, ideal: textSize.isAccessibilitySize ? 440 : 360, max: 560)
        } detail: {
            if let id = model.selection {
                NoteDetailView(model: model, noteID: id)
            } else {
                ContentUnavailableView("Select a note", systemImage: "doc.text")
            }
        }
        .navigationSplitViewStyle(.balanced)
        // The note's toolbar can hide both lists, to give the writing all the room (see `NoteDetailView`).
        .environment(\.listsControl, ListsControl(hidden: columns == .detailOnly) { toggleLists() })
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
            // Developer shortcut: `-openPdfInkLab 1` opens spike B's lab at launch (see `PdfInkLab` for the arguments that run it).
            if UserDefaults.standard.bool(forKey: "openPdfInkLab") { showingPdfInkLab = true }
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
        .fullScreenCover(isPresented: $showingPdfInkLab) { PdfInkLabView() }
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

    /// Hides the notebooks and the notes list together, or brings them back. Showing them again asks twice, a moment apart: the system settles on its own
    /// choice first (two columns, with the notebooks left out) and would otherwise keep it, as with the sidebar coming back when the iPad is turned.
    private func toggleLists() {
        if columns == .detailOnly {
            columns = .all
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { if columns != .detailOnly { columns = .all } }
        } else {
            columns = .detailOnly
        }
    }

    /// The way into the colour schemes and fonts, in plain sight at the foot of the first column (it is in the More menu too): it says what it is and which scheme is in force.
    private var appearanceButton: some View {
        Button { showingAppearance = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "paintpalette").foregroundStyle(look.brand).frame(width: 26).accessibilityHidden(true)
                Text("Appearance")
                Spacer(minLength: 8)
                // At the accessibility sizes the name alone would fill the column; the sheet itself says which scheme is chosen.
                if !textSize.isAccessibilitySize {
                    Text(schemeName).font(.callout).foregroundStyle(look.mutedText).lineLimit(1)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(look.foreground)
        // Solid, like the list's footer beside it, so that what is written on it has a known colour behind it.
        .background(look.panel)
        .overlay(alignment: .top) { Rectangle().fill(look.border).frame(height: 1) }
        .accessibilityHint("Colour scheme and fonts")
        .accessibilityIdentifier("sidebar-appearance")
    }

    /// "Cream" for the scheme named "Cream (warm light)", or "System".
    private var schemeName: String {
        switch model.appearance.scheme {
        case .system: "System"
        case .sun: "Follow the sun"
        case .theme(let name): Theme.named(name).map { $0.label.components(separatedBy: " (").first ?? $0.label } ?? name
        }
    }

    private var footer: some View {
        VStack(spacing: 2) {
            Text(model.resultLine).font(.footnote.monospacedDigit())
            // The hint goes at the accessibility sizes, where it would fill the column.
            if model.query.isEmpty, !textSize.isAccessibilitySize {
                Text("Try  tag: infra  ·  created: >2026-01-01  ·  title: routng").font(.caption2)
            }
        }
        .foregroundStyle(look.mutedText)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        // Solid, so that the words on it have a known colour behind them (a material changes with what scrolls under it).
        .background(look.surface)
        .overlay(alignment: .top) { Rectangle().fill(look.border).frame(height: 1) }
    }
}

struct NoteRow: View {
    let note: NoteSummary
    var favorite = false
    /// The note owns a PDF.
    var isPdf = false
    @Environment(\.look) private var look
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                if isPdf { Image(systemName: "doc.richtext").font(.caption).foregroundStyle(look.mutedText).accessibilityLabel("PDF") }
                // At the accessibility sizes a title is given as many lines as it needs, not cut at two.
                Text(note.title.isEmpty ? "Untitled" : note.title).font(.headline).lineLimit(textSize.isAccessibilitySize ? nil : 2)
                if favorite { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
            }
            // The date and the tags side by side when they fit, one under the other when they do not.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { detail(tagLines: 1) }
                VStack(alignment: .leading, spacing: 2) { detail(tagLines: nil) }
            }
            .font(.caption)
            .foregroundStyle(look.mutedText)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private func detail(tagLines: Int?) -> some View {
        if let date = Stamp.date(note.updatedAt) { Text(date, format: .dateTime.year().month().day()) }
        if !note.tags.tagLine.isEmpty { Text(note.tags.tagLine).lineLimit(tagLines) }
    }
}

/// What the note's toolbar needs to hide the notebooks and the notes list together, to give the writing all the room, and to bring them back.
struct ListsControl {
    /// Both lists are hidden now.
    let hidden: Bool
    let toggle: () -> Void
}

extension EnvironmentValues {
    @Entry var listsControl: ListsControl?
}
