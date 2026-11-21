import CompositionCore
import CompositionPDF
import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

// Import Scans (docs/architecture/scans.md, "Getting the scans in"): pictures of pages from Files (several at once, in the order a scanner named
// them), Photos, or the document camera, shown as a list to put in order, turn and remove, with a title; Import makes the scan. The sheet keeps its
// own copies of the pictures in a folder of its own, removed when the scan is made or the sheet is cancelled.

/// A page waiting to be made part of a scan.
struct DraftScanPage: Identifiable, Equatable {
    let id = UUID()
    /// The sheet's copy of the picture.
    let url: URL
    /// What the person knows it as: its file name, or where it came from.
    let name: String
    var quarterTurns = 0
}

@MainActor @Observable
final class ScanDraft {
    private(set) var pages: [DraftScanPage] = []
    var title = ScanImport.fallbackTitle
    /// The person typed a title: pictures added later do not change it.
    var titleEdited = false
    private(set) var thumbnails: [UUID: CGImage] = [:]
    private(set) var adding = false
    var problem: String?
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("scan-import-\(UUID().uuidString)", isDirectory: true)
    private var photoCount = 0

    init() { try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }

    var isFull: Bool { pages.count >= ScanImport.maxPages }

    /// Pictures chosen in Files: copied in (inside the access the picker gives), in the order their names give, after the pages already here.
    func addFiles(_ urls: [URL]) async {
        adding = true
        defer { adding = false }
        let folder = folder
        let pictures = ScanImport.ordered(urls.filter(ScanImport.isPicture))
        let skipped = urls.count - pictures.count
        let copied: [(URL, String)] = await Task.detached(priority: .userInitiated) {
            pictures.compactMap { source in
                let scoped = source.startAccessingSecurityScopedResource()
                defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                let target = folder.appendingPathComponent("\(UUID().uuidString).\(source.pathExtension.lowercased())")
                return (try? FileManager.default.copyItem(at: source, to: target)) == nil ? nil : (target, source.lastPathComponent)
            }
        }.value
        append(copied)
        if !titleEdited, !pictures.isEmpty { title = ScanImport.title(forFiles: pictures) }
        if skipped > 0 || copied.count < pictures.count {
            problem = "\(skipped + pictures.count - copied.count) of the files could not be added: only pictures (JPEG, PNG, HEIC, TIFF) can be pages."
        }
    }

    /// Pictures chosen in Photos, in the order they were chosen.
    func addPhotos(_ items: [PhotosPickerItem]) async {
        adding = true
        defer { adding = false }
        var added: [(URL, String)] = []
        var failed = 0
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self), let type = Self.pictureType(of: data) else {
                failed += 1
                continue
            }
            photoCount += 1
            let target = folder.appendingPathComponent("\(UUID().uuidString).\(type.preferredFilenameExtension ?? "jpg")")
            guard (try? data.write(to: target)) != nil else {
                failed += 1
                continue
            }
            added.append((target, "Photo \(photoCount)"))
        }
        append(added)
        if failed > 0 { problem = "\(failed) of the photos could not be added." }
    }

    /// Pages from the document camera, as JPEGs.
    func addCameraPages(_ images: [UIImage]) {
        var added: [(URL, String)] = []
        for (index, image) in images.enumerated() {
            let target = folder.appendingPathComponent("\(UUID().uuidString).jpg")
            guard let data = image.jpegData(compressionQuality: 0.85), (try? data.write(to: target)) != nil else { continue }
            added.append((target, "Camera page \(pages.count + index + 1)"))
        }
        append(added)
    }

    private func append(_ files: [(URL, String)]) {
        let room = max(0, ScanImport.maxPages - pages.count)
        if files.count > room { problem = "A scan has at most \(ScanImport.maxPages) pages; make one per course or term." }
        let new = files.prefix(room).map { DraftScanPage(url: $0.0, name: $0.1) }
        pages.append(contentsOf: new)
        for page in new { Task { await loadThumbnail(page) } }
    }

    private func loadThumbnail(_ page: DraftScanPage) async {
        let url = page.url
        let image = await Task.detached(priority: .utility) { () -> CGImage? in
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
            return CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 240,
            ] as CFDictionary)
        }.value
        if let image { thumbnails[page.id] = image }
    }

    nonisolated static func pictureType(of data: Data) -> UTType? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), let identifier = CGImageSourceGetType(source) as String? else { return nil }
        return UTType(identifier)
    }

    func turn(_ page: DraftScanPage) {
        guard let index = pages.firstIndex(of: page) else { return }
        pages[index].quarterTurns = (pages[index].quarterTurns + 1) % 4
    }

    func remove(at offsets: IndexSet) {
        for index in offsets { try? FileManager.default.removeItem(at: pages[index].url) }
        pages.remove(atOffsets: offsets)
    }

    func move(from source: IndexSet, to destination: Int) { pages.move(fromOffsets: source, toOffset: destination) }

    var sources: [ScanPageSource] { pages.map { ScanPageSource(url: $0.url, quarterTurns: $0.quarterTurns) } }

    func discard() { try? FileManager.default.removeItem(at: folder) }
}

struct ScanImportSheet: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look
    @State private var draft = ScanDraft()
    @State private var choosingFiles = false
    @State private var choosingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var usingCamera = false
    /// Set when Import was tapped, so that closing the sheet does not delete the pictures the scan is being made from.
    @State private var importing = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Title", text: Binding(get: { draft.title }, set: { draft.title = $0; draft.titleEdited = true }))
                        .accessibilityIdentifier("scan-title")
                } header: {
                    Text("Title")
                }
                Section {
                    addButtons
                } footer: {
                    Text("Pages are read on this iPad, in the background, after the scan is made; nothing is sent anywhere. Words read from handwriting can be wrong: a line the reader is unsure of is kept out of Search.")
                }
                if !draft.pages.isEmpty {
                    Section {
                        ForEach(Array(draft.pages.enumerated()), id: \.element.id) { index, page in
                            row(page, number: index + 1)
                        }
                        .onMove { draft.move(from: $0, to: $1) }
                        .onDelete { draft.remove(at: $0) }
                    } header: {
                        Text(draft.pages.count == 1 ? "1 page" : "\(draft.pages.count) pages")
                    }
                }
            }
            .environment(\.editMode, .constant(.active))
            .overlay {
                if draft.pages.isEmpty, !draft.adding {
                    ContentUnavailableView(
                        "No pages yet", systemImage: "doc.viewfinder",
                        description: Text("Add pictures of your pages from Files or Photos, or scan them with the camera. Files are put in the order their names give."))
                        .allowsHitTesting(false)
                        .padding(.top, 260)
                }
            }
            .navigationTitle("Import Scans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Import") {
                        importing = true
                        let pages = draft.sources, title = draft.title, folder = draft.folder, target = model.sidebar
                        dismiss()
                        Task { await model.importScan(pages, title: title, into: target, folder: folder) }
                    }
                    .disabled(draft.pages.isEmpty || draft.adding)
                    .accessibilityIdentifier("scan-import")
                }
            }
            .fileImporter(isPresented: $choosingFiles, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls): Task { await draft.addFiles(urls) }
                case .failure(let error): draft.problem = error.localizedDescription
                }
            }
            .photosPicker(isPresented: $choosingPhotos, selection: $photos, maxSelectionCount: ScanImport.maxPages, selectionBehavior: .ordered, matching: .images)
            .onChange(of: photos) {
                guard !photos.isEmpty else { return }
                let chosen = photos
                photos = []
                Task { await draft.addPhotos(chosen) }
            }
            .fullScreenCover(isPresented: $usingCamera) {
                DocumentCamera { images in
                    usingCamera = false
                    draft.addCameraPages(images)
                }
                .ignoresSafeArea()
            }
            .alert("Some pages were not added", isPresented: Binding(get: { draft.problem != nil }, set: { if !$0 { draft.problem = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(draft.problem ?? "")
            }
        }
        .onDisappear { if !importing { draft.discard() } }
        .modifier(PageSizedSheet())
    }

    @ViewBuilder private var addButtons: some View {
        Button { choosingFiles = true } label: { Label("Add from Files", systemImage: "folder") }
            .disabled(draft.isFull)
            .accessibilityIdentifier("scan-add-files")
        Button { choosingPhotos = true } label: { Label("Add from Photos", systemImage: "photo.on.rectangle") }
            .disabled(draft.isFull)
        if VNDocumentCameraViewController.isSupported {
            Button { usingCamera = true } label: { Label("Scan with the Camera", systemImage: "doc.viewfinder") }
                .disabled(draft.isFull)
        }
        if draft.adding {
            HStack {
                ProgressView()
                Text("Adding pages…").foregroundStyle(look.mutedText)
            }
        }
    }

    private func row(_ page: DraftScanPage, number: Int) -> some View {
        HStack(spacing: 12) {
            Group {
                if let image = draft.thumbnails[page.id] {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .scaledToFit()
                        .rotationEffect(.degrees(Double(page.quarterTurns) * 90))
                } else {
                    ProgressView()
                }
            }
            .frame(width: 64, height: 64)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Page \(number)").font(.headline)
                Text(page.name).font(.footnote).foregroundStyle(look.mutedText).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 8)
            Button {
                draft.turn(page)
            } label: {
                Label("Turn page \(number) clockwise", systemImage: "rotate.right")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.borderless)
            .accessibilityIdentifier("scan-turn-\(number)")
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(page.quarterTurns == 0 ? "" : "turned \(page.quarterTurns * 90) degrees")
    }
}

/// A sheet the size of a page on an iPad (iOS 18 and later), so a list of pages has room; the system's form sheet before that, the whole height on a phone.
private struct PageSizedSheet: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.presentationSizing(.page).presentationDetents([.large])
        } else {
            content.presentationDetents([.large])
        }
    }
}

/// The system's document camera: the pages it scanned, in order (none when the person cancels or it fails).
struct DocumentCamera: UIViewControllerRepresentable {
    let finish: ([UIImage]) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let camera = VNDocumentCameraViewController()
        camera.delegate = context.coordinator
        return camera
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(finish: finish) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let finish: ([UIImage]) -> Void
        init(finish: @escaping ([UIImage]) -> Void) { self.finish = finish }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            finish((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { finish([]) }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { finish([]) }
    }
}
