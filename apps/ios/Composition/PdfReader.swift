import CompositionCore
import CompositionPDF
import PDFKit
import SwiftUI

// M2, the PDF reader (pdf-markup-plan.md, "The iPad"): a PDFKit `PDFView` that scrolls the pages continuously, fits them to the width until
// the person zooms, finds in the PDF with the system's own find bar, lists the PDF's own outline and the person's bookmarks, and comes back to
// the page and zoom it was left at. The row and the file are `CompositionCore`'s (`DocumentsStore`); marks are the next step.

/// pdf.js's zoom of 1 is a PDF unit to a CSS pixel (96 to the inch); PDFKit's scale of 1 is a PDF unit to a point (72 to the inch). The zoom in the
/// row is the desktop's (a backup carries it both ways), so the two are converted.
private let storedZoomPerScale = 72.0 / 96.0

@MainActor @Observable
final class PdfReader {
    /// One line of the PDF's own table of contents, in reading order.
    struct Entry: Identifiable {
        let id: Int
        let level: Int
        let title: String
        let page: Int?
        let destination: PDFDestination
    }

    let source: PdfSource
    let app: AppModel
    private(set) var pdf: PDFDocument?
    private(set) var failedToOpen = false
    /// The PDF asks for a password before it can be read; `wrongPassword` says the last try did not open it.
    private(set) var locked = false
    private(set) var wrongPassword = false
    /// The page at the top of the view. Known from the view itself, once it has gone back to where it was left (so that what is shown is what is there).
    private(set) var pageIndex = 0
    private(set) var pageCount = 0
    /// The view has been laid out and has gone back to the saved page and zoom.
    private(set) var restored = false
    private(set) var outline: [Entry] = []
    private(set) var bookmarks: [PdfBookmark] = []
    /// The view that shows the document, set by the view; the reader asks it to move and to find.
    weak var view: PDFView?

    // MARK: State of the marks (PdfReader+Marks.swift)

    /// Every mark of the PDF, by page, as they are stored.
    var marks: [PdfMark] = []
    var marksLoaded = false
    var canUndo = false
    var canRedo = false
    /// The words selected in the PDF, if any are: what the bar of colours and tools is for.
    var selection: PDFSelection?
    var selectionWords = ""
    /// The mark whose card is open, and where it is in the view.
    var card: MarkCard?
    /// A typed note being written (new, or a mark being retyped).
    var draft: NoteDraft?
    /// The next tap on a page puts a typed note there.
    var placingNote = false
    /// The colour the next mark gets (the last one chosen).
    var color: String = UserDefaults.standard.string(forKey: "pdfMarkColor").flatMap { PdfMarkup.markColors.contains($0) ? $0 : nil } ?? "yellow" {
        didSet { UserDefaults.standard.set(color, forKey: "pdfMarkColor") }
    }
    /// The pages that have ink (PdfInkLayer.swift), for the banner while drawing, the Highlights tab and the export.
    var inkPages: Set<Int> = []
    /// The Pencil draws on the pages (otherwise ink only shows).
    var inking = false
    /// A finger draws too, for an iPad with no Pencil (and the Simulator); the PDF then scrolls with two fingers.
    var fingerDraws = UserDefaults.standard.bool(forKey: "pdfInkFinger")
    /// A line of confirmation (a quote put in the note) that goes by itself.
    var notice: String?
    /// The notes that belong with this PDF, for the Notes tab and the Highlights tab's "quoted" marks.
    var citations: [PdfCitation] = []
    /// What puts Markdown into the note shown beside the PDF; set by the screen that has the note.
    @ObservationIgnored var insertion = PdfInsertion()
    @ObservationIgnored var editor: PdfMarkEditor?
    @ObservationIgnored var layer: MarkLayer?
    @ObservationIgnored let inkLayer = PdfInkLayer()
    @ObservationIgnored var flashing: [PDFAnnotation] = []
    @ObservationIgnored var flashPage: PDFPage?
    @ObservationIgnored var flashTask: Task<Void, Never>?
    @ObservationIgnored var noticeTask: Task<Void, Never>?
    @ObservationIgnored var pageLabels: [String]?
    /// The password the PDF was opened with, if it needed one. In memory only, for an export's sake.
    private(set) var password: String?

    /// Where the reader was left: what the first layout goes back to. Only once it has gone back are the page and zoom saved, so that the first
    /// frame (page 0, fit to the width) never overwrites them.
    private var start: PdfViewState
    private var saved: (page: Int, zoom: Double?)?
    private var saveTask: Task<Void, Never>?

    init(source: PdfSource, app: AppModel) {
        self.source = source
        self.app = app
        start = source.document.viewState
        pageCount = source.document.pageCount
        saved = (start.page ?? 0, start.zoom)
    }

    var documentId: Int64 { source.document.id }

    // MARK: Opening

    /// The document is made off the main thread: opening a large file reads its index first. (`PDFDocument` is made and used on one thread at a time.)
    private struct Opened: @unchecked Sendable { let pdf: PDFDocument? }

    private var opening = false

    /// Opens the file, once however often the pane appears (a view's state may be made again before it is kept, so nothing is read when the reader is made).
    func open() async {
        guard !opening else { return }
        opening = true
        await load()
    }

    private func load() async {
        guard let url = source.url else { return }
        let opened = await Task.detached(priority: .userInitiated) { Opened(pdf: PDFDocument(url: url)) }.value
        guard let pdf = opened.pdf else {
            failedToOpen = true
            return
        }
        self.pdf = pdf
        if pdf.isLocked {
            locked = true
        } else {
            prepare()
        }
        await refreshBookmarks()
    }

    func unlock(with password: String) {
        guard let pdf, pdf.unlock(withPassword: password) else {
            wrongPassword = true
            return
        }
        // Kept in memory only, for an export of this PDF (the copy is protected with it); never stored or logged.
        self.password = password
        wrongPassword = false
        locked = false
        prepare()
        // Search reads its text now, if it was waiting for the password (which is used for that reading and not kept).
        app.indexPdfTextAfterUnlock(documentId: documentId, password: password)
    }

    /// Once the pages can be read: their count (kept if it was not known), and the contents.
    private func prepare() {
        guard let pdf else { return }
        pageCount = pdf.pageCount
        outline = Self.entries(of: pdf)
        let (id, count) = (documentId, pdf.pageCount)
        Task {
            await app.setPageCountIfUnknown(documentId: id, pageCount: count)
            await loadMarks()
        }
    }

    private static func entries(of pdf: PDFDocument) -> [Entry] {
        var entries: [Entry] = []
        func visit(_ node: PDFOutline, level: Int) {
            for index in 0..<node.numberOfChildren {
                // A table of contents of a few thousand lines is enough for any book; more is a damaged or hostile file.
                guard entries.count < 5_000, let child = node.child(at: index) else { continue }
                let destination = child.destination ?? (child.action as? PDFActionGoTo)?.destination
                if let destination {
                    let title = (child.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    entries.append(Entry(id: entries.count, level: level, title: title.isEmpty ? "Untitled" : title, page: destination.page.map { pdf.index(for: $0) }, destination: destination))
                }
                visit(child, level: level + 1)
            }
        }
        if let root = pdf.outlineRoot { visit(root, level: 0) }
        return entries
    }

    // MARK: Where the reader is

    /// Called by the view when its first layout is done: back to the page and zoom the PDF was left at.
    func restore(in view: PDFView) {
        guard !restored else { return }
        if let zoom = start.zoom, zoom > 0 {
            view.autoScales = false
            view.scaleFactor = min(max(zoom / storedZoomPerScale, view.minScaleFactor), view.maxScaleFactor)
        }
        if let page = start.page, let target = pdf?.page(at: page), page > 0 { view.go(to: target) }
        if let pdf, let current = view.currentPage { pageIndex = pdf.index(for: current) }
        restored = true
    }

    /// The page or zoom changed (a scroll, a pinch, a jump): note the page, and save the place a moment after it settles.
    func viewChanged() {
        guard restored, let view, let pdf, let current = view.currentPage else { return }
        pageIndex = pdf.index(for: current)
        if let marked = markedPage, marked != pageIndex {
            view.highlightedSelections = nil
            markedPage = nil
        }
        // A zoom is kept only if the person made one; until then the pages fit the width, whatever the width is.
        let zoom: Double? = view.autoScales ? nil : view.scaleFactor * storedZoomPerScale
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await self?.save(zoom: zoom)
        }
    }

    /// Writes the place now (the app is leaving the foreground, or the PDF is closing).
    func flush() {
        inkLayer.flushAll()
        guard restored, let view else { return }
        saveTask?.cancel()
        let zoom: Double? = view.autoScales ? nil : view.scaleFactor * storedZoomPerScale
        Task { await save(zoom: zoom) }
    }

    private func save(zoom: Double?) async {
        guard saved?.page != pageIndex || saved?.zoom != zoom else { return }
        saved = (pageIndex, zoom)
        await app.saveViewState(documentId: documentId, page: pageIndex, zoom: zoom)
    }

    func go(toPage index: Int) {
        guard let page = pdf?.page(at: min(max(index, 0), max(pageCount - 1, 0))) else { return }
        view?.go(to: page)
    }

    func go(to entry: Entry) { view?.go(to: entry.destination) }

    func find() { view?.findInteraction.presentFindNavigator(showingReplace: false) }

    /// A search result found in the PDF's text was opened at `page`: the places `text` is on that page are marked, the view goes to the first,
    /// and the find bar is shown with `text` in it, for going on to the next ones (the text is set before the bar is shown, which is what makes the
    /// bar search for it; set afterwards, it only sits in the field). Only that page's text is looked through here, so a big book does not hold
    /// the main thread.
    func find(_ text: String, onPage index: Int?) {
        guard let view, let pdf, !text.isEmpty else { return }
        if let index, let page = pdf.page(at: index), let string = page.string {
            var found: [PDFSelection] = []
            var range = NSRange(location: 0, length: (string as NSString).length)
            while found.count < 200 {
                let match = (string as NSString).range(of: text, options: [.caseInsensitive, .diacriticInsensitive], range: range)
                guard match.location != NSNotFound, let selection = page.selection(for: match) else { break }
                selection.color = UIColor.systemYellow.withAlphaComponent(0.6)
                found.append(selection)
                range = NSRange(location: match.location + match.length, length: range.length - (match.location + match.length - range.location))
            }
            view.highlightedSelections = found.isEmpty ? nil : found
            markedPage = found.isEmpty ? nil : index
            if let first = found.first { view.go(to: first) }
        }
        view.findInteraction.searchText = text
        view.findInteraction.presentFindNavigator(showingReplace: false)
    }

    /// The page whose matches `find(_:onPage:)` marked; the marks go when the reader leaves it.
    @ObservationIgnored private var markedPage: Int?

    /// Where the PDF's text is in Search: `noText` makes the Contents say that Search cannot find words in it.
    private(set) var textState: PdfTextState?

    func loadTextState() async { textState = await app.pdfTextState(documentId: documentId) }

    // MARK: Bookmarks

    func refreshBookmarks() async {
        bookmarks = await app.bookmarks(documentId: documentId).sorted { ($0.page, $0.id) < ($1.page, $1.id) }
    }

    /// The bookmark on the page being read, if there is one.
    var bookmarkHere: PdfBookmark? { bookmarks.first { $0.page == pageIndex } }

    /// A key or a tap: bookmark this page, or take the bookmark off it.
    func toggleBookmark() async {
        if let here = bookmarkHere {
            await app.deleteBookmark(id: here.id)
        } else {
            await app.addBookmark(documentId: documentId, page: pageIndex)
        }
        await refreshBookmarks()
    }

    func rename(_ bookmark: PdfBookmark, to label: String) async {
        await app.renameBookmark(id: bookmark.id, label: label)
        await refreshBookmarks()
    }

    func delete(_ bookmark: PdfBookmark) async {
        await app.deleteBookmark(id: bookmark.id)
        await refreshBookmarks()
    }
}

/// A `PDFView` that says when it has first been laid out, because going to a page before that lands on the wrong place.
final class ReaderPDFView: PDFView {
    var onFirstLayout: (() -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0, let run = onFirstLayout else { return }
        onFirstLayout = nil
        run()
    }
}

struct PdfKitView: UIViewRepresentable {
    let reader: PdfReader
    @Environment(\.look) private var look

    func makeCoordinator() -> Coordinator { Coordinator(reader: reader) }

    func makeUIView(context: Context) -> ReaderPDFView {
        let view = ReaderPDFView()
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.displaysPageBreaks = true
        view.pageBreakMargins = UIEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)
        // Fit to the width until the person zooms, as the desktop's reader does; then the zoom is theirs, and is kept.
        view.autoScales = true
        view.minScaleFactor = 0.25
        view.maxScaleFactor = 8
        // The system's find bar (⌘F with a keyboard, or the Find button).
        view.isFindInteractionEnabled = true
        // Ink: PDFKit lays a canvas over each page near the screen, which the Pencil draws on. The provider is set **before** the document: PDFKit asks for a
        // page's overlay when it makes the page, so a provider given afterwards is never asked (spike B's lab does it in this order).
        if let pdf = reader.pdf { reader.inkLayer.use(document: pdf) }
        reader.inkLayer.pdfView = view
        view.pageOverlayViewProvider = reader.inkLayer
        view.document = reader.pdf
        view.accessibilityIdentifier = "pdf-view"
        view.backgroundColor = UIColor(look.surface)
        view.onFirstLayout = { [weak reader, weak view] in
            guard let reader, let view else { return }
            MainActor.assumeIsolated { reader.restore(in: view) }
        }
        // A tap opens the card of the mark under it (or places a typed note); it does not take the touch from PDFKit's own gestures (selection, links).
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        reader.view = view
        return view
    }

    func updateUIView(_ view: ReaderPDFView, context: Context) {
        view.backgroundColor = UIColor(look.surface)
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let reader: PdfReader

        init(reader: PdfReader) { self.reader = reader }

        @objc func tapped(_ recogniser: UITapGestureRecognizer) {
            guard recogniser.state == .ended else { return }
            reader.tapped(at: recogniser.location(in: recogniser.view))
        }

        nonisolated func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

/// The reader: a strip of controls above the pages. (The note's own toolbar is above it all and stays the note's.)
struct PdfReaderPane: View {
    let reader: PdfReader
    @Environment(\.look) private var look
    @State private var showingContents = false
    @State private var jumping = false
    @State private var jumpText = ""
    @State private var exporting = false

    var body: some View {
        VStack(spacing: 0) {
            ViewThatFits(in: .horizontal) {
                strip(compact: false)
                strip(compact: true)
            }
            Rectangle().fill(look.border).frame(height: 1)
            pages
        }
        .background(look.surface)
        .task { await reader.open() }
        // The place is kept as the person reads, and written when the app is about to leave.
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewPageChanged)) { if ($0.object as? PDFView) === reader.view { reader.viewChanged() } }
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewScaleChanged)) { if ($0.object as? PDFView) === reader.view { reader.viewChanged() } }
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewSelectionChanged)) { if ($0.object as? PDFView) === reader.view { reader.selectionChanged() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in reader.flush() }
        .onDisappear { reader.flush() }
        // A link asked for a page or a mark: shown once the PDF is open and its marks are read.
        .onChange(of: reader.restored) { reader.takeGoTo() }
        .onChange(of: reader.marksLoaded) { reader.takeGoTo() }
        .onChange(of: reader.app.pdfGoTo) { reader.takeGoTo() }
        .alert("Go to page", isPresented: $jumping) {
            TextField("Page", text: $jumpText).keyboardType(.numberPad)
            Button("Cancel", role: .cancel) {}
            Button("Go") { if let page = Int(jumpText.trimmingCharacters(in: .whitespaces)) { reader.go(toPage: page - 1) } }
        } message: {
            Text("1 to \(reader.pageCount)")
        }
        .sheet(isPresented: $exporting) { PdfExportSheet(reader: reader) }
    }

    private func strip(compact: Bool) -> some View {
        HStack(spacing: 4) {
            Button("Contents, bookmarks, highlights and notes", systemImage: "list.bullet.indent") { showingContents = true }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("pdf-contents")
                .popover(isPresented: $showingContents) { PdfSidebar(reader: reader) { showingContents = false }.frame(minWidth: 360, minHeight: 440) }
            Button("Find in the PDF", systemImage: "magnifyingglass") { reader.find() }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("pdf-find")
            Button(reader.bookmarkHere == nil ? "Bookmark this page" : "Remove this page's bookmark", systemImage: reader.bookmarkHere == nil ? "bookmark" : "bookmark.fill") {
                Task { await reader.toggleBookmark() }
            }
            .labelStyle(.iconOnly)
            .accessibilityIdentifier("pdf-bookmark")
            Button("Add a typed note", systemImage: reader.placingNote ? "text.bubble.fill" : "text.bubble") { reader.beginPlacingNote() }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("pdf-add-note")
            Button(reader.inking ? "Stop drawing" : "Draw on the pages", systemImage: reader.inking ? "pencil.tip.crop.circle.fill" : "pencil.tip.crop.circle") { reader.toggleInking() }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("pdf-ink")
            if compact {
                Menu {
                    Button("Undo", systemImage: "arrow.uturn.backward") { Task { await reader.undo() } }.disabled(!reader.canUndo)
                    Button("Redo", systemImage: "arrow.uturn.forward") { Task { await reader.redo() } }.disabled(!reader.canRedo)
                    Button("Cite this page", systemImage: "link") { reader.citeThisPage() }
                    Button("Export annotated PDF…", systemImage: "square.and.arrow.up") { exporting = true }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                        .labelStyle(.iconOnly)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityIdentifier("pdf-more")
            } else {
                Button("Undo", systemImage: "arrow.uturn.backward") { Task { await reader.undo() } }
                    .labelStyle(.iconOnly)
                    .disabled(!reader.canUndo)
                    .keyboardShortcut("z", modifiers: .command)
                    .accessibilityIdentifier("pdf-undo")
                Button("Redo", systemImage: "arrow.uturn.forward") { Task { await reader.redo() } }
                    .labelStyle(.iconOnly)
                    .disabled(!reader.canRedo)
                    .keyboardShortcut("z", modifiers: [.command, .shift])
                    .accessibilityIdentifier("pdf-redo")
                Button("Cite this page", systemImage: "link") { reader.citeThisPage() }
                    .labelStyle(.iconOnly)
                    .accessibilityIdentifier("pdf-cite")
                Button("Export annotated PDF", systemImage: "square.and.arrow.up") { exporting = true }
                    .labelStyle(.iconOnly)
                    .accessibilityIdentifier("pdf-export")
            }
            Spacer(minLength: 8)
            Button {
                jumpText = ""
                jumping = true
            } label: {
                Text(reader.pageCount > 0 && reader.restored ? "Page \(reader.pageIndex + 1) of \(reader.pageCount)" : "")
                    .monospacedDigit()
                    .foregroundStyle(look.mutedText)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(minHeight: 44)
            }
            .disabled(reader.pageCount == 0 || !reader.restored || reader.locked)
            .accessibilityLabel(reader.restored ? "Page \(reader.pageIndex + 1) of \(reader.pageCount)" : "Page")
            .accessibilityHint("Double tap to go to a page")
            .accessibilityIdentifier("pdf-page")
        }
        .buttonStyle(.borderless)
        .tint(look.brand)
        .padding(.horizontal, 8)
        .frame(minHeight: 48)
        .background(look.panel)
        .disabled(reader.pdf == nil || reader.locked)
    }

    @ViewBuilder private var pages: some View {
        if reader.source.url == nil {
            ContentUnavailableView("This PDF's file is missing", systemImage: "doc.questionmark", description: Text("The note is here, but its file is not. Restore a backup that has it, or move the note to the Trash Can."))
        } else if reader.failedToOpen {
            ContentUnavailableView("This PDF can't be opened", systemImage: "exclamationmark.triangle", description: Text("The file is damaged, or is not a PDF this iPad can read."))
        } else if reader.locked {
            PdfPasswordPrompt(reader: reader)
        } else if reader.pdf == nil {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            PdfKitView(reader: reader)
                .overlay(alignment: .topLeading) { anchors }
                .overlay(alignment: .bottom) {
                    if reader.selection != nil {
                        PdfSelectionBar(reader: reader).padding(.bottom, 14).transition(.opacity)
                    }
                }
                // A mark's card is a panel over the pages, on the side away from the mark, and not a popover: a popover's arrow covers the page, and one anchored high on the
                // screen sits under the navigation bar.
                .overlay(alignment: reader.card.map { $0.rect.midY > (reader.view?.bounds.height ?? 0) * 0.5 } == true ? .top : .bottom) {
                    if reader.card != nil, let mark = reader.cardMark {
                        MarkCardView(reader: reader, mark: mark)
                            .id(mark.id)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(look.border, lineWidth: 1))
                            .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
                            .padding(12)
                            .transition(.opacity)
                    }
                }
                .overlay(alignment: .top) { banner }
                .animation(.default, value: reader.selection != nil)
        }
    }

    /// What says that a note is being placed, or that something was put in the note.
    @ViewBuilder private var banner: some View {
        if reader.inking {
            PdfInkBanner(reader: reader)
        } else if reader.placingNote {
            Label("Tap where the note goes", systemImage: "hand.tap")
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
                .padding(.top, 10)
                .accessibilityIdentifier("pdf-placing-note")
        } else if let notice = reader.notice {
            Label(notice, systemImage: "checkmark.circle")
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
                .padding(.top, 10)
                .accessibilityIdentifier("pdf-notice")
        }
    }

    /// An invisible view at the typed note being written, which the note's box is attached to.
    private var anchors: some View {
        ZStack(alignment: .topLeading) {
            anchor(reader.draft?.anchor)
                .popover(item: Binding(get: { reader.draft }, set: { if $0 == nil { reader.draft = nil } }), arrowEdge: .bottom) { draft in
                    NoteDraftView(reader: reader, draft: draft).presentationCompactAdaptation(.popover)
                }
        }
    }

    /// An invisible view where a mark or a typed note is, which the card or the note's box is attached to. It is a clear colour, which takes no touch (the PDF under it does). It must not
    /// be given `allowsHitTesting(false)`: that reaches into the popover too, and the buttons in the card did nothing.
    private func anchor(_ rect: CGRect?) -> some View {
        let box = rect ?? .zero
        return Color.clear.frame(width: max(box.width, 2), height: max(box.height, 2)).offset(x: box.minX, y: box.minY)
    }
}

/// A PDF that asks for a password: it is not kept, and not tried more than once for each press.
private struct PdfPasswordPrompt: View {
    let reader: PdfReader
    @State private var password = ""
    @FocusState private var focused: Bool
    @Environment(\.look) private var look

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "lock.doc").font(.system(size: 44)).foregroundStyle(look.mutedText).accessibilityHidden(true)
            Text("This PDF needs a password").font(.headline)
            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .submitLabel(.go)
                .onSubmit(unlock)
                .frame(maxWidth: 280)
                .accessibilityIdentifier("pdf-password")
            if reader.wrongPassword { Text("That password did not open it.").font(.callout).foregroundStyle(look.error) }
            Button("Open", action: unlock).buttonStyle(.borderedProminent).disabled(password.isEmpty)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { focused = true }
    }

    private func unlock() {
        guard !password.isEmpty else { return }
        reader.unlock(with: password)
        password = ""
    }
}

/// The PDF's own contents, the bookmarks the person made, the marks (Highlights) and the notes that cite the PDF (Notes).
struct PdfSidebar: View {
    let reader: PdfReader
    var close: () -> Void
    private enum Tab: String, CaseIterable { case contents = "Contents", bookmarks = "Bookmarks", highlights = "Highlights", notes = "Notes" }
    @State private var tab = Tab.contents
    @State private var renaming: PdfBookmark?
    @State private var label = ""
    @Environment(\.look) private var look

    var body: some View {
        VStack(spacing: 0) {
            Picker("Show", selection: $tab) { ForEach(Tab.allCases, id: \.self) { Text($0.rawValue) } }
                .pickerStyle(.segmented)
                .padding(10)
            switch tab {
            case .contents: contents
            case .bookmarks: bookmarks
            case .highlights: PdfHighlightsList(reader: reader, close: close)
            case .notes: PdfNotesList(reader: reader, close: close)
            }
        }
        .background(look.background)
        .foregroundStyle(look.foreground)
        .task { await reader.loadTextState() }
        .alert("Name the bookmark", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Page \((renaming?.page ?? 0) + 1)", text: $label)
            Button("Cancel", role: .cancel) {}
            Button("Save") { if let bookmark = renaming { Task { await reader.rename(bookmark, to: label) } } }
        }
    }

    @ViewBuilder private var contents: some View {
        if reader.textState == .noText {
            // OCR is not built (docs/pdf-markup-plan.md, P7 and P8): a scan's words are not in Search, its marks and bookmarks are.
            Label("No searchable text (scanned). Search finds this PDF's highlights, comments, typed notes and bookmarks, not its words.", systemImage: "exclamationmark.magnifyingglass")
                .font(.footnote)
                .foregroundStyle(look.mutedText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.bottom, 6)
                .accessibilityIdentifier("pdf-no-text")
        }
        if reader.outline.isEmpty {
            ContentUnavailableView("No contents", systemImage: "list.bullet", description: Text("This PDF has no table of contents. Use the page number to go to a page, or bookmark the pages you come back to."))
        } else {
            List(reader.outline) { entry in
                Button {
                    reader.go(to: entry)
                    close()
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Text(entry.title).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        if let page = entry.page { Text("\(page + 1)").monospacedDigit().foregroundStyle(look.mutedText) }
                    }
                    .padding(.leading, CGFloat(min(entry.level, 6)) * 16)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pdf-outline-\(entry.id)")
            }
            .listStyle(.plain)
            .accessibilityIdentifier("pdf-outline")
        }
    }

    @ViewBuilder private var bookmarks: some View {
        if reader.bookmarks.isEmpty {
            ContentUnavailableView("No bookmarks", systemImage: "bookmark", description: Text("Tap the bookmark button to mark the page you are on."))
        } else {
            List(reader.bookmarks, id: \.id) { bookmark in
                Button {
                    reader.go(toPage: bookmark.page)
                    close()
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Text(bookmark.label.isEmpty ? "Page \(bookmark.page + 1)" : bookmark.label).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        if !bookmark.label.isEmpty { Text("\(bookmark.page + 1)").monospacedDigit().foregroundStyle(look.mutedText) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) { Button("Delete", systemImage: "trash", role: .destructive) { Task { await reader.delete(bookmark) } } }
                .swipeActions(edge: .leading) {
                    Button("Rename", systemImage: "pencil") {
                        label = bookmark.label
                        renaming = bookmark
                    }
                    .tint(look.brand)
                }
                .contextMenu {
                    Button("Rename…", systemImage: "pencil") {
                        label = bookmark.label
                        renaming = bookmark
                    }
                    Button("Delete", systemImage: "trash", role: .destructive) { Task { await reader.delete(bookmark) } }
                }
                .accessibilityIdentifier("pdf-bookmark-\(bookmark.id)")
            }
            .listStyle(.plain)
            .accessibilityIdentifier("pdf-bookmarks")
        }
    }
}
