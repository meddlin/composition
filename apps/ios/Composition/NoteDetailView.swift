import CompositionCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// One note, with the three tabs of the design: **Markdown** (the editor), **Preview** (Markdown and the components, drawn from what is typed, not
/// only from what is saved) and **Split** (both, side by side, or one above the other in a narrow window). The Live tab stays after v1 (C12).
/// The note's `NoteSession` is open for as long as the note is on screen, so that every tab shows the same text and saving is one thing.
struct NoteDetailView: View {
    enum Mode: String, CaseIterable { case markdown = "Markdown", preview = "Preview", split = "Split" }

    let model: AppModel
    let noteID: Int64
    // What the system brings back after the app was ended: the tab, and where the caret was.
    @SceneStorage("noteMode") private var mode = Mode.preview
    @SceneStorage("caretOffset") private var caret = 0
    @SceneStorage("caretNote") private var caretNote = 0
    @State private var session: NoteSession?
    @State private var handle = EditorHandle()
    @State private var focusOnOpen = false
    @State private var confirmingTrash = false
    // Pictures for the note: from the Photos picker, a file, or the camera.
    @State private var showingPhotos = false
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var showingFiles = false
    @State private var showingCamera = false

    var body: some View {
        Group {
            if let session {
                switch mode {
                case .markdown: editor(session)
                case .preview: NoteReader(model: model, session: session)
                case .split:
                    SplitLayout {
                        editor(session)
                    } trailing: {
                        NoteReader(model: model, session: session)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: noteID) { await open() }
        .onDisappear { close() }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) } }.pickerStyle(.segmented).frame(minWidth: 210, maxWidth: 300)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if mode != .preview {
                    Button("Find", systemImage: "magnifyingglass") { handle.presentFind() }
                    Button("Link to Note", systemImage: "link") { handle.linkToNote() }
                    Menu {
                        Button("Photo Library…", systemImage: "photo.on.rectangle") { showingPhotos = true }
                        if CameraView.isAvailable { Button("Take Photo…", systemImage: "camera") { showingCamera = true } }
                        Button("Choose File…", systemImage: "folder") { showingFiles = true }
                        Divider()
                        Button("Turn Images into Image Tags", systemImage: "arrow.left.arrow.right") { handle.convertImagesToTags() }
                            .keyboardShortcut("x", modifiers: [.command, .shift])
                    } label: {
                        Label("Image", systemImage: "photo.badge.plus")
                    }
                }
                Button("Move to Trash Can", systemImage: "trash") { confirmingTrash = true }
            }
        }
        .photosPicker(isPresented: $showingPhotos, selection: $pickedPhotos, maxSelectionCount: 10, matching: .images)
        .onChange(of: pickedPhotos) { _, items in insertPhotos(items) }
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): insertFiles(urls)
            case .failure(let error): model.errorMessage = error.localizedDescription
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraView { image in
                showingCamera = false
                if let data = image?.jpegData(compressionQuality: 0.9) { handle.insertImages([ImageInput(data: data, fileName: "photo.jpg")]) }
            }
            .ignoresSafeArea()
        }
        .confirmationDialog("Move this note to the Trash Can?", isPresented: $confirmingTrash, titleVisibility: .visible) {
            Button("Move to Trash Can", role: .destructive) { Task { await model.moveToTrash(noteID) } }
        } message: {
            Text("It stays there for 60 days and can be restored.")
        }
    }

    private func editor(_ session: NoteSession) -> some View {
        // A note that was just made opens with the caret at the end, after its frontmatter; one that was open before the app was ended, where it was.
        NoteEditorView(session: session, handle: handle, initialCaret: focusOnOpen ? .max : (caretNote == Int(noteID) ? caret : 0), focusOnOpen: focusOnOpen) { offset in
            caret = offset
            caretNote = Int(noteID)
        }
        .id(session.noteId)
    }

    /// Opens the note's session (and closes the previous note's, saving what is unsaved).
    private func open() async {
        close()
        #if DEBUG || EDITOR_TEST_HOOKS
        // Developer shortcut: `-openMode Markdown` (or Preview, Split) at launch.
        if let name = UserDefaults.standard.string(forKey: "openMode"), let forced = Mode(rawValue: name) { mode = forced }
        #endif
        // A note that was just made opens in the editor, with the keyboard up.
        focusOnOpen = model.takeFreshNote(noteID)
        if focusOnOpen { mode = .markdown }
        session = await model.openSession(noteID)
        // What the editor needs to store a picture for this note.
        handle.location = model.location
        handle.noteTitle = { [session] in session.map { NoteFrontmatter.parse($0.text).frontmatter?.title ?? "" } ?? "" }
        handle.problem = { [weak model] message in model?.errorMessage = message }
        handle.noteCandidates = { [weak model] in model?.linkCandidates ?? [] }
        handle.noteID = noteID
    }

    /// The pictures chosen in the Photos picker, as the bytes the library has (often HEIC, which becomes JPEG on the way in).
    private func insertPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        pickedPhotos = []
        Task {
            var pictures: [ImageInput] = []
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self) { pictures.append(ImageInput(data: data, fileName: "photo")) }
            }
            handle.insertImages(pictures)
        }
    }

    /// Picture files chosen in the Files browser.
    private func insertFiles(_ urls: [URL]) {
        Task {
            let pictures: [ImageInput] = await Task.detached {
                urls.compactMap { url in
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    return (try? Data(contentsOf: url)).map { ImageInput(data: $0, fileName: url.lastPathComponent) }
                }
            }.value
            handle.insertImages(pictures)
        }
    }

    private func close() {
        if let open = session {
            model.closeSession(open)
            session = nil
        }
    }
}

/// The editor and the preview together: side by side when there is room, one above the other when there is not. The same views either way,
/// so turning the iPad does not rebuild the text view.
struct SplitLayout<Leading: View, Trailing: View>: View {
    @ViewBuilder let leading: Leading
    @ViewBuilder let trailing: Trailing

    var body: some View {
        GeometryReader { geometry in
            // 800 points puts every iPad but the mini in portrait side by side (two halves of at least 400, about 45 characters each), and the mini, and any
            // narrow window (Slide Over, a third of Split View), one above the other, where a half would be under 380 points.
            let wide = geometry.size.width >= 800
            let layout = wide ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            layout {
                leading.frame(width: wide ? geometry.size.width / 2 : nil, height: wide ? nil : geometry.size.height / 2)
                Divider()
                trailing
            }
        }
    }
}

/// The preview of a note: its header (title, date, tags) and the Markdown drawn. It follows the text as it is typed, a quarter of a second
/// after the last change.
struct NoteReader: View {
    let model: AppModel
    @State private var live: LivePreview

    init(model: AppModel, session: NoteSession) {
        self.model = model
        _live = State(initialValue: LivePreview(session: session))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(live.title.isEmpty ? "Untitled" : live.title).font(.largeTitle.bold())
                    HStack(spacing: 12) {
                        if !live.updated.isEmpty { Label(live.updated, systemImage: "clock") }
                        if !live.tags.isEmpty { Text(live.tags) }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    Divider()
                    if let preview = live.preview { NotePreviewView(preview: preview) } else { ProgressView() }
                }
                .padding()
                // In a wide window (landscape, with the list hidden) the text keeps to a readable width and sits in the middle.
                .frame(maxWidth: NoteTextView.readableWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            // A link to another note (`[title](note:12)`) opens that note.
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "note", let id = NoteLinks.id(fromRef: url.absoluteString) else { return .systemAction }
                model.followNoteLink(id)
                return .handled
            })
            .environment(\.scrollToHeading, { ordinal in withAnimation { proxy.scrollTo(PreviewScroll.headingID(ordinal), anchor: .top) } })
            .environment(\.imageFolder, model.location.imagesURL)
        }
    }
}

/// What the preview shows, made from a session's text: off the main thread, and once for a burst of typing.
@MainActor
@Observable
final class LivePreview {
    private(set) var preview: NotePreview?
    private(set) var title = ""
    private(set) var updated = ""
    private(set) var tags = ""
    private var observation: NoteSession.Observation?
    private var task: Task<Void, Never>?

    init(session: NoteSession) {
        render(session.text, after: .zero)
        observation = session.observe { [weak self] text in
            Task { @MainActor in self?.render(text, after: .milliseconds(250)) }
        }
    }

    private func render(_ text: String, after delay: Duration) {
        task?.cancel()
        task = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            let made = await Task.detached(priority: .userInitiated) { (NotePreview.make(content: text), NoteFrontmatter.parse(text).frontmatter) }.value
            guard !Task.isCancelled, let self else { return }
            preview = made.0
            title = made.1?.title ?? ""
            updated = made.1?.updatedAt ?? ""
            tags = made.1.map { NoteFrontmatter.tagsToString($0.tags).tagLine } ?? ""
        }
    }
}
