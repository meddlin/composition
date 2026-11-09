import CompositionCore
import ImageIO
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// The header image (the tracker's M3† row; the desktop's `HeaderImage.tsx` and `HeaderImageDialog.tsx`): a picture above the note's title in the preview, from the
// stored images or a file added on the spot, full width as a banner or centered at its own size. It is written into the note's frontmatter (`headerImage` and
// `headerImageLayout`), where it can also be typed by hand. The sheet applies every choice straight away, so the preview behind it shows it.

/// A stored picture made small enough to draw: the system reads only what it needs, so a phone's full-size photo is not decoded to show a banner.
enum DownsampledPicture {
    /// The picture, and the size it has in pixels (the original's, not the small copy's).
    nonisolated static func load(_ url: URL, maxPixel: Int) -> (image: UIImage, pixels: CGSize)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let width = (properties?[kCGImagePropertyPixelWidth] as? Int) ?? 0, height = (properties?[kCGImagePropertyPixelHeight] as? Int) ?? 0
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let small = max(cg.width, cg.height)
        // The thumbnail has the picture's turn applied, so the original's size is the thumbnail's, scaled back up by how much it was shrunk.
        let factor = small > 0 && max(width, height) > small ? Double(max(width, height)) / Double(small) : 1
        return (UIImage(cgImage: cg), CGSize(width: Double(cg.width) * factor, height: Double(cg.height) * factor))
    }
}

/// The picture above a note's title in the preview. `full` crops it to a banner as wide as the note; `centered` shows the whole picture at its own size (shrunk to
/// fit the note), in the middle. Either way its lower edge fades out into the page, by masking the picture rather than painting a colour over it, so it suits every
/// scheme. A picture that cannot be loaded, and a web address (nothing is fetched from the network), leave no gap.
struct HeaderImageBanner: View {
    let header: HeaderImage
    @Environment(\.imageFolder) private var folder
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var loaded: (image: UIImage, pixels: CGSize)?
    /// The file was tried and could not be read.
    @State private var gaveUp = false

    private static var exposedToTests: Bool {
        #if DEBUG || EDITOR_TEST_HOOKS
        UserDefaults.standard.bool(forKey: "exposeDecorative")
        #else
        false
        #endif
    }

    private var url: URL? {
        guard let folder, case .stored(let name)? = HeaderImageSource.resolve(header.image) else { return nil }
        return folder.appendingPathComponent(name)
    }

    var body: some View {
        // Nothing at all for a picture that cannot be shown (a web address, or a file that cannot be read), so a title is never pushed down by an empty frame. While
        // it is being read there is an empty box of about the banner's height: a view that draws nothing never starts its task, so it cannot be nothing at that point.
        Group {
            if let loaded {
                picture(loaded)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10))
                    // Opaque for the top 45%, then eased out to nothing at the bottom edge.
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0.45), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
                    // Decoration, as on the desktop (`alt=""`): VoiceOver passes over it. A Debug build started with `-exposeDecorative 1` shows it to the UI tests.
                    .accessibilityHidden(!Self.exposedToTests)
                    .accessibilityLabel("Header image")
                    .accessibilityIdentifier("header-image")
            } else if url != nil, !gaveUp {
                Color.clear.frame(height: sizeClass == .compact ? 160 : 224).accessibilityHidden(true)
            }
        }
        .task(id: url) {
            gaveUp = false
            guard let url else { return loaded = nil }
            let result = await Task.detached(priority: .userInitiated) { DownsampledPicture.load(url, maxPixel: 2048) }.value
            loaded = result
            gaveUp = result == nil
        }
    }

    @ViewBuilder private func picture(_ loaded: (image: UIImage, pixels: CGSize)) -> some View {
        switch header.layout {
        case .full:
            // A box of the banner's height with the picture filling it: the picture is cropped by the box, never stretched, and never widens the column.
            Color.clear
                .frame(height: sizeClass == .compact ? 160 : 224)
                .overlay { Image(uiImage: loaded.image).resizable().scaledToFill() }
                .clipped()
        case .centered:
            // At its own size: one point to a pixel as on the desktop, shrunk to the column and to 288 points tall.
            Image(uiImage: loaded.image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: loaded.pixels.width, maxHeight: min(288, loaded.pixels.height))
                .frame(maxWidth: .infinity)
        }
    }
}

/// Picks the picture above a note's title from the stored images, or from a photo or file added on the spot, and whether it spans the note or sits centered.
struct HeaderImageSheet: View {
    let model: AppModel
    let session: NoteSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look
    @State private var header: HeaderImage?
    @State private var layout: HeaderImageLayout
    @State private var images: [StoredImageInfo]?
    @State private var failed = false
    @State private var problem: String?
    @State private var adding = false
    @State private var showingPhotos = false
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var showingFiles = false

    init(model: AppModel, session: NoteSession) {
        self.model = model
        self.session = session
        let current = NoteFrontmatter.parse(session.text).frontmatter?.headerImage
        _header = State(initialValue: current)
        // Remembered while no picture is chosen yet, and used for the first one.
        _layout = State(initialValue: current?.layout ?? .full)
    }

    private var chosen: String? { HeaderImageSource.storedName(of: header?.image) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Shown above the note’s title in the preview.").font(.subheadline).foregroundStyle(look.mutedText)
                    layoutPicker
                    imageSection
                    if header != nil {
                        Button("Remove Header Image", role: .destructive) { apply(nil) }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("header-image-remove")
                    }
                }
                .padding()
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(look.background)
            .navigationTitle("Header Image")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("header-image-done") } }
        }
        .accessibilityIdentifier("header-image-sheet")
        .task { if let listed = await model.storedImages() { images = listed } else { failed = true } }
        .photosPicker(isPresented: $showingPhotos, selection: $pickedPhotos, maxSelectionCount: 1, matching: .images)
        .onChange(of: pickedPhotos) { _, items in
            guard let item = items.first else { return }
            pickedPhotos = []
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { await add(ImageInput(data: data, fileName: "photo")) } else { problem = "That photo could not be read." }
            }
        }
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.image]) { result in
            switch result {
            case .success(let url):
                Task {
                    let input: ImageInput? = await Task.detached {
                        let scoped = url.startAccessingSecurityScopedResource()
                        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                        return (try? Data(contentsOf: url)).map { ImageInput(data: $0, fileName: url.lastPathComponent) }
                    }.value
                    if let input { await add(input) } else { problem = "That file could not be read." }
                }
            case .failure(let error): problem = error.localizedDescription
            }
        }
    }

    private var layoutPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Layout").font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(look.mutedText)
            Picker("Layout", selection: Binding(get: { layout }, set: { chooseLayout($0) })) {
                Text("Full width").tag(HeaderImageLayout.full)
                Text("Centered").tag(HeaderImageLayout.centered)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("header-image-layout")
            Text(layout == .full ? "A banner across the whole note, cropped to fit." : "The whole picture at its own size, in the middle.")
                .font(.footnote).foregroundStyle(look.mutedText)
        }
    }

    private var imageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Image").font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(look.mutedText)
                Spacer()
                Menu {
                    Button("Photo Library…", systemImage: "photo.on.rectangle") { showingPhotos = true }
                    Button("Choose File…", systemImage: "folder") { showingFiles = true }
                } label: {
                    Label(adding ? "Adding…" : "Add Image", systemImage: "plus")
                }
                .disabled(adding)
                .accessibilityIdentifier("header-image-add")
            }
            if let problem { Text(problem).font(.footnote).foregroundStyle(look.error).accessibilityIdentifier("header-image-problem") }
            if let header, HeaderImageSource.storedName(of: header.image) == nil {
                // A web address typed into the frontmatter: kept as it is, and not drawn, because the iPad fetches nothing from the network.
                Text("Currently \(header.image). It is a web address, which this iPad does not load, so it is not shown.").font(.footnote).foregroundStyle(look.mutedText)
            }
            if failed {
                Text("Could not load the images.").foregroundStyle(look.error)
            } else if images == nil {
                ProgressView("Loading images…")
            } else if images?.isEmpty == true {
                Text("No images yet. Add one above.").foregroundStyle(look.mutedText)
            } else if let images {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
                    ForEach(images) { image in
                        HeaderImageChoice(url: model.location.imagesURL.appendingPathComponent(image.name), name: image.name, isChosen: image.name == chosen) {
                            apply(HeaderImage(image: StoredImages.ref(image.name), layout: layout))
                        }
                    }
                }
                .accessibilityIdentifier("header-image-grid")
            }
        }
    }

    private func chooseLayout(_ next: HeaderImageLayout) {
        layout = next
        if let header { apply(HeaderImage(image: header.image, layout: next)) }
    }

    /// Writes the choice into the note's frontmatter, which every tab showing the note hears.
    private func apply(_ new: HeaderImage?) {
        let now = Date().formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
        let title = model.orderedNotes.first { $0.id == session.noteId }?.title ?? "Untitled"
        session.edit(NoteFrontmatter.withHeaderImage(session.text, new, fallback: (title: title, createdAt: now, updatedAt: now)))
        header = new
        problem = nil
    }

    /// Stores a photo or file as a pasted one is (named for the note, never stored twice), and makes it the header.
    private func add(_ input: ImageInput) async {
        adding = true
        defer { adding = false }
        let location = model.location
        let title = NoteFrontmatter.parse(session.text).frontmatter?.title ?? ""
        let outcome: StoredImages.StoreResult? = await Task.detached(priority: .userInitiated) {
            guard let prepared = ImageImport.prepare(input) else { return nil }
            return StoredImages.store(noteTitle: title, fileName: prepared.fileName, data: prepared.data, in: location)
        }.value
        switch outcome {
        case .stored(let name)?:
            apply(HeaderImage(image: StoredImages.ref(name), layout: layout))
            // Newest first, like the listing; a picture added again is already there.
            if images?.contains(where: { $0.name == name }) == false {
                let attributes = try? FileManager.default.attributesOfItem(atPath: location.imagesURL.appendingPathComponent(name).path)
                images?.insert(StoredImageInfo(name: name, size: (attributes?[.size] as? Int) ?? 0, modifiedAt: Date().formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)), usedIn: []), at: 0)
            }
        case .failed(let message)?: problem = message
        case nil: problem = "That is not a picture Composition can store."
        }
    }

}

/// One stored picture in the sheet's grid: a thumbnail that chooses it, and says that it is the one chosen.
private struct HeaderImageChoice: View {
    let url: URL
    let name: String
    let isChosen: Bool
    let choose: () -> Void
    @Environment(\.look) private var look
    @State private var picture: UIImage?

    var body: some View {
        Button(action: choose) {
            Group {
                if let picture { Image(uiImage: picture).resizable().scaledToFill() } else { look.mutedFill }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(isChosen ? look.brand : look.border, lineWidth: isChosen ? 3 : 1) }
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(StoredImages.alt(forName: name))
        .accessibilityAddTraits(isChosen ? [.isSelected] : [])
        .accessibilityIdentifier("header-image-\(name)")
        .task(id: url) {
            let url = url
            picture = await Task.detached(priority: .utility) { DownsampledPicture.load(url, maxPixel: 360)?.image }.value
        }
    }
}
