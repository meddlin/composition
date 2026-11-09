import CompositionCore
import CompositionInk
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// One note, with the four tabs of the design: **Markdown** (the editor), **Live** (the editor with the syntax hidden away from the caret: the note drawn
/// as it will read), **Preview** (Markdown and the components, drawn from what is typed, not only from what is saved) and **Split** (Markdown and Preview, side
/// by side, or one above the other in a narrow window, with a divider that can be dragged).
/// The note's `NoteSession` is open for as long as the note is on screen, so that every tab shows the same text and saving is one thing.
struct NoteDetailView: View {
    enum Mode: String, CaseIterable { case markdown = "Markdown", live = "Live", preview = "Preview", split = "Split" }

    let model: AppModel
    let noteID: Int64
    @Environment(\.look) private var look
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.listsControl) private var lists
    // What the system brings back after the app was ended: the tab, and where the caret was.
    @SceneStorage("noteMode") private var mode = Mode.preview
    @SceneStorage("caretOffset") private var caret = 0
    @SceneStorage("caretNote") private var caretNote = 0
    @State private var session: NoteSession?
    /// The PDF this note owns, if it owns one (M2).
    @State private var pdf: PdfSource?
    @State private var handle = EditorHandle()
    @State private var focusOnOpen = false
    @State private var confirmingTrash = false
    // Pictures for the note: from the Photos picker, a file, or the camera.
    @State private var showingPhotos = false
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var showingFiles = false
    @State private var showingCamera = false
    /// The picker of images already stored: the words that were selected when it opened, and the image chosen (put in once the sheet has gone).
    @State private var showingStored = false
    @State private var storedWords = ""
    @State private var pickedStored: StoredImageInfo?
    /// The drawing canvas, open on a blank page (Image menu, *Drawing…*).
    @State private var drawing: InkEditing?

    var body: some View {
        Group {
            if let session {
                if let pdf {
                    // A note that owns a PDF: the PDF beside it where there is room, and a switch between them where there is not.
                    PdfWithNote(model: model, source: pdf) { noteContent(session) }
                        .id(pdf.document.id)
                } else {
                    noteContent(session)
                }
            } else {
                ProgressView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .background(look.background)
        // The note's own text colour; the lists beside it keep the system's, so that a selected row still turns its text to white.
        .foregroundStyle(look.foreground)
        .task(id: noteID) { await open() }
        .onDisappear { close() }
        .toolbar {
            // Three words side by side where there is room. In a narrow window (a third of the screen, Slide Over) there is no room for them, and a
            // toolbar drops what does not fit: the three become one menu, and Find, Link and Image another, so that every one stays reachable.
            // Hide both lists, the notebooks and the notes, to give the writing all the room, and bring them back (where there are columns to hide).
            if sizeClass != .compact, let lists {
                ToolbarItem(placement: .topBarLeading) {
                    Button { lists.toggle() } label: {
                        Label(lists.hidden ? "Show the lists" : "Hide the lists", systemImage: lists.hidden ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                    }
                    .accessibilityIdentifier("focus-toggle")
                }
            }
            if sizeClass != .compact {
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) } }.pickerStyle(.segmented).frame(minWidth: 270, maxWidth: 380)
                }
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if sizeClass == .compact {
                    Menu {
                        Picker("View", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) } }
                    } label: {
                        Label("View: \(mode.rawValue)", systemImage: "rectangle.split.2x1")
                    }
                    if mode != .preview {
                        Menu {
                            Button("Find", systemImage: "magnifyingglass") { handle.presentFind() }
                            Button("Link to Note", systemImage: "link") { handle.linkToNote() }
                            Menu("Image", systemImage: "photo.badge.plus") { imageItems }
                        } label: {
                            Label("Edit", systemImage: "ellipsis.circle")
                        }
                    }
                } else if mode != .preview {
                    Button("Find", systemImage: "magnifyingglass") { handle.presentFind() }
                    Button("Link to Note", systemImage: "link") { handle.linkToNote() }
                    Menu { imageItems } label: { Label("Image", systemImage: "photo.badge.plus") }
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
        .sheet(isPresented: $showingStored, onDismiss: insertPickedStored) {
            StoredImagePicker(model: model, label: storedWords) { image in
                pickedStored = image
                showingStored = false
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraView { image in
                showingCamera = false
                if let data = image?.jpegData(compressionQuality: 0.9) { handle.insertImages([ImageInput(data: data, fileName: "photo.jpg")]) }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(item: $drawing) { editing in
            InkCanvasScreen(editing: editing, look: look) { png in
                drawing = nil
                handle.insertInk(png: png)
            } cancelled: {
                drawing = nil
            }
        }
        .confirmationDialog("Move this note to the Trash Can?", isPresented: $confirmingTrash, titleVisibility: .visible) {
            Button("Move to Trash Can", role: .destructive) { Task { await model.moveToTrash(noteID) } }
        } message: {
            Text("It stays there for 60 days and can be restored." + (pdf.map { " Its PDF (\(DocumentNames.formatBytes($0.document.size))) stays with it, and goes when the note is deleted for good." } ?? ""))
        }
    }

    /// What the Image menu holds (the same in the wide toolbar and in the narrow one).
    @ViewBuilder private var imageItems: some View {
        Button("Photo Library…", systemImage: "photo.on.rectangle") { showingPhotos = true }
        if CameraView.isAvailable { Button("Take Photo…", systemImage: "camera") { showingCamera = true } }
        Button("Choose File…", systemImage: "folder") { showingFiles = true }
        Button("Stored Image…", systemImage: "photo.stack") { handle.openStoredImages() }
        Button("Drawing…", systemImage: "pencil.tip.crop.circle") { drawing = .blank }
            .accessibilityIdentifier("new-drawing")
        Divider()
        Button("Turn Images into Image Tags", systemImage: "arrow.left.arrow.right") { handle.convertImagesToTags() }
            .keyboardShortcut("x", modifiers: [.command, .shift])
    }

    /// The note itself, in the tab chosen.
    @ViewBuilder private func noteContent(_ session: NoteSession) -> some View {
        switch mode {
        // One branch for both writing tabs, so that going from one to the other does not rebuild the text view: the caret, the keyboard and the
        // scroll stay where they are.
        case .markdown, .live: editor(session, live: mode == .live)
        case .preview: NoteReader(model: model, session: session)
        case .split:
            SplitLayout {
                editor(session)
            } trailing: {
                NoteReader(model: model, session: session)
            }
        }
    }

    private func editor(_ session: NoteSession, live: Bool = false) -> some View {
        // A note that was just made opens with the caret at the end, after its frontmatter; one that was open before the app was ended, where it was.
        NoteEditorView(session: session, handle: handle, initialCaret: focusOnOpen ? .max : (caretNote == Int(noteID) ? caret : 0), focusOnOpen: focusOnOpen, live: live) { offset in
            caret = offset
            caretNote = Int(noteID)
        }
        .id(session.noteId)
    }

    /// Opens the note's session (and closes the previous note's, saving what is unsaved).
    private func open() async {
        close()
        #if DEBUG || EDITOR_TEST_HOOKS
        // Developer shortcut: `-openMode Markdown` (or Live, Preview, Split) at launch.
        if let name = UserDefaults.standard.string(forKey: "openMode"), let forced = Mode(rawValue: name) { mode = forced }
        #endif
        // A note that was just made opens in the editor, with the keyboard up.
        focusOnOpen = model.takeFreshNote(noteID)
        if focusOnOpen { mode = .markdown }
        pdf = nil
        let owned = await model.pdfSource(forNote: noteID)
        // Another note was chosen while this one was being read: that one opens, not this.
        guard !Task.isCancelled else { return }
        pdf = owned
        session = await model.openSession(noteID)
        // What the editor needs to store a picture for this note.
        handle.location = model.location
        handle.noteTitle = { [session] in session.map { NoteFrontmatter.parse($0.text).frontmatter?.title ?? "" } ?? "" }
        handle.problem = { [weak model] message in model?.errorMessage = message }
        handle.noteCandidates = { [weak model] in model?.linkCandidates ?? [] }
        handle.noteID = noteID
        let words = $storedWords, showing = $showingStored
        handle.openStoredImages = { [weak handle] in
            words.wrappedValue = handle?.selectedWords ?? ""
            showing.wrappedValue = true
        }
    }

    /// The image chosen in the picker of stored ones goes in when its sheet is gone, so that the text takes the keyboard back first.
    private func insertPickedStored() {
        guard let image = pickedStored else { return }
        pickedStored = nil
        handle.insertStoredImage(named: image.name, description: storedWords)
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

/// What a split's divider is called (for VoiceOver), and which place it keeps: the editor and the preview have one, a PDF and its note another.
struct SplitLabels {
    let between: String
    let first: String
    let key: String
    static let editorPreview = SplitLabels(between: "the editor and the preview", first: "editor", key: "")
    static let pdfAndNote = SplitLabels(between: "the PDF and the note", first: "PDF", key: "Pdf")
}

/// The editor and the preview together: side by side when there is room, one above the other when there is not. The same views either way,
/// so turning the iPad does not rebuild the text view. The divider between them can be dragged (or moved with VoiceOver's adjust gesture) to give
/// either one more room, and a double tap puts it back in the middle; where it was left is kept, one place for side by side and one for stacked.
struct SplitLayout<Leading: View, Trailing: View>: View {
    let leading: Leading
    let trailing: Trailing
    private let labels: SplitLabels
    @AppStorage private var sideBySide: Double
    @AppStorage private var stacked: Double
    @Environment(\.look) private var look

    init(labels: SplitLabels = .editorPreview, @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.labels = labels
        self.leading = leading()
        self.trailing = trailing()
        _sideBySide = AppStorage(wrappedValue: 0.5, "splitFractionSideBySide\(labels.key)")
        _stacked = AppStorage(wrappedValue: 0.5, "splitFractionStacked\(labels.key)")
    }

    /// How thick the strip with the divider is: wide enough to take hold of with a finger.
    private static var grip: CGFloat { 20 }

    var body: some View {
        GeometryReader { geometry in
            // 800 points puts every iPad but the mini in portrait side by side (two halves of at least 400, about 45 characters each), and the mini, and any
            // narrow window (Slide Over, a third of Split View), one above the other, where a half would be under 380 points.
            let wide = geometry.size.width >= 800
            let total = max(wide ? geometry.size.width : geometry.size.height, 1)
            // Neither half is ever made smaller than this: a text view narrower than about 300 points, or a preview shorter than about 160, is of no use.
            let smallest = min(wide ? 300 : 160, total / 3)
            let layout = wide ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            let fraction = clamp(wide ? sideBySide : stacked, smallest / total, 1 - smallest / total)
            layout {
                leading.frame(width: wide ? total * fraction : nil, height: wide ? nil : total * fraction)
                handle(wide: wide, fraction: fraction, total: total, smallest: smallest)
                trailing
            }
            .coordinateSpace(name: "split")
        }
    }

    private func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double { min(max(value, low), max(low, high)) }

    private func set(_ fraction: Double, wide: Bool) {
        if wide { sideBySide = fraction } else { stacked = fraction }
    }

    private func handle(wide: Bool, fraction: Double, total: Double, smallest: Double) -> some View {
        let low = smallest / total
        return ZStack {
            look.background
            Rectangle().fill(look.border).frame(width: wide ? 1 : nil, height: wide ? nil : 1)
            // A grip to take hold of: a short bar across the line.
            Capsule().fill(look.mutedText.opacity(0.7)).frame(width: wide ? 4 : 36, height: wide ? 36 : 4)
        }
        .frame(width: wide ? Self.grip : nil, height: wide ? nil : Self.grip)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .named("split")).onChanged { drag in
                // The strip follows the finger: its middle is where the finger is.
                set(clamp((wide ? drag.location.x : drag.location.y) / total, low, 1 - low), wide: wide)
            }
        )
        .onTapGesture(count: 2) { set(0.5, wide: wide) }
        .accessibilityElement()
        .accessibilityLabel("Divider between \(labels.between)")
        .accessibilityValue("\(Int((fraction * 100).rounded())) percent \(labels.first)")
        .accessibilityHint("Swipe up or down to move it. Double tap to put it in the middle.")
        .accessibilityAdjustableAction { direction in
            let step = 0.1
            set(clamp(fraction + (direction == .increment ? step : -step), low, 1 - low), wide: wide)
        }
        .accessibilityIdentifier("split-divider")
    }
}

/// The preview of a note: its header (title, date, tags) and the Markdown drawn. It follows the text as it is typed, a quarter of a second
/// after the last change.
struct NoteReader: View {
    let model: AppModel
    let session: NoteSession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.look) private var look
    @State private var live: LivePreview
    /// A stored drawing opened on the canvas by a tap in the preview.
    @State private var editingInk: InkEditing?

    init(model: AppModel, session: NoteSession) {
        self.model = model
        self.session = session
        _live = State(initialValue: LivePreview(session: session))
    }

    /// The edited drawing is stored under its own new name (the name carries a hash of the bytes), and the note's text names that one in place of the old.
    private func saveEdited(_ editing: InkEditing, png: Data) {
        editingInk = nil
        guard let old = editing.stored else { return }
        let location = model.location
        let title = NoteFrontmatter.parse(session.text).frontmatter?.title ?? ""
        Task {
            let outcome = await Task.detached(priority: .userInitiated) { StoredImages.store(noteTitle: title, fileName: "drawing.png", data: png, in: location) }.value
            switch outcome {
            case .stored(let name): session.edit(InkTag.replacing(old, with: name, in: session.text))
            case .failed(let message): model.errorMessage = message
            }
        }
    }

    @ViewBuilder private var header: some View {
        if !live.updated.isEmpty { Label(live.updated, systemImage: "clock").fixedSize(horizontal: false, vertical: true) }
        if !live.tags.isEmpty { Text(live.tags) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(live.title.isEmpty ? "Untitled" : live.title).font(.largeTitle.bold())
                    // The date and the tags on one line when they fit, one under the other when they do not (and never a date cut in two).
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) { header }
                        VStack(alignment: .leading, spacing: 4) { header }
                    }
                    .font(.subheadline)
                    .foregroundStyle(look.mutedText)
                    Divider()
                    if let preview = live.preview { NotePreviewView(preview: preview) } else { ProgressView() }
                }
                .padding()
                // In a wide window (landscape, with the list hidden) the text keeps to a readable width and sits in the middle.
                .frame(maxWidth: NoteTextView.readableWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            // The preview's type family, and its links in the scheme's link colour.
            .fontDesign(look.previewFont.design)
            .tint(look.link)
            // A link to another note (`[title](note:12)`) opens that note.
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "note", let id = NoteLinks.id(fromRef: url.absoluteString) else { return .systemAction }
                model.followNoteLink(id)
                return .handled
            })
            .environment(\.scrollToHeading, { ordinal in withAnimation(reduceMotion ? nil : .default) { proxy.scrollTo(PreviewScroll.headingID(ordinal), anchor: .top) } })
            .environment(\.imageFolder, model.location.imagesURL)
            .environment(\.editInk, { name in editingInk = InkEditing.load(named: name, from: model.location.imagesURL) })
            .fullScreenCover(item: $editingInk) { editing in
                InkCanvasScreen(editing: editing, look: look) { png in saveEdited(editing, png: png) } cancelled: { editingInk = nil }
            }
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
