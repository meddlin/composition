import CompositionCore
import ImageIO
import SwiftUI
import UIKit

/// The images already stored, to put one in the note again (the Image menu's *Stored Image…* and ⌘⇧M; the desktop's Shift+M list). Images are never deleted
/// along with the text that mentions them, so this is also how one is found again. The list is newest first and typing narrows it by words of the file name,
/// which starts with the title of the note the picture was first put into (`StoredImages.match`, checked against the desktop's `matchImages`).
struct StoredImagePicker: View {
    let model: AppModel
    /// The words that were selected in the note: they describe the picture put in their place, as on the desktop.
    let label: String
    let pick: (StoredImageInfo) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look
    @State private var images: [StoredImageInfo]?
    @State private var failed = false
    @State private var query = ""

    private var shown: [StoredImageInfo] { images.map { StoredImages.match($0, query: query) } ?? [] }

    var body: some View {
        NavigationStack {
            content
                .background(look.background)
                .navigationTitle(label.isEmpty ? "Insert an Image" : "Insert “\(label.count > 30 ? String(label.prefix(30)) + "…" : label)”")
                .navigationBarTitleDisplayMode(.inline)
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Filter by name")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .accessibilityIdentifier("stored-images-sheet")
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if failed {
            ContentUnavailableView("Could not load the images", systemImage: "exclamationmark.triangle")
        } else if images == nil {
            ProgressView("Loading images…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if shown.isEmpty {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView("No images yet", systemImage: "photo.on.rectangle", description: Text("Add a photo, a file or a pasted picture to a note first."))
            } else {
                ContentUnavailableView.search(text: query)
            }
        } else {
            List(shown) { image in
                Button { pick(image) } label: { row(image) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(StoredImages.alt(forName: image.name)), \(StoredImages.usageLabel(count: image.usedIn.count)), \(StoredImages.sizeLabel(bytes: image.size))")
                    .accessibilityHint("Puts the picture in the note")
                    .accessibilityIdentifier("stored-image-\(image.name)")
                    .listRowBackground(look.surface)
            }
            .scrollContentBackground(.hidden)
        }
    }

    private func row(_ image: StoredImageInfo) -> some View {
        HStack(spacing: 12) {
            Thumbnail(url: model.location.imagesURL.appendingPathComponent(image.name))
            VStack(alignment: .leading, spacing: 2) {
                Text(image.name).font(.caption.monospaced()).foregroundStyle(look.foreground).lineLimit(2).truncationMode(.middle)
                Text("\(StoredImages.usageLabel(count: image.usedIn.count)) · \(StoredImages.sizeLabel(bytes: image.size))").font(.caption).foregroundStyle(look.mutedText)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private func load() async {
        if let listed = await model.storedImages() { images = listed } else { failed = true }
    }
}

/// A small picture of a stored image, made without reading the whole image into memory (they can be a phone's full photos).
private struct Thumbnail: View {
    let url: URL
    @Environment(\.look) private var look
    @State private var picture: UIImage?

    var body: some View {
        Group {
            if let picture {
                Image(uiImage: picture).resizable().scaledToFill()
            } else {
                look.mutedFill
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityHidden(true)
        .task(id: url) {
            let url = url
            picture = await Task.detached(priority: .utility) { Self.thumbnail(of: url, side: 144) }.value
        }
    }

    private nonisolated static func thumbnail(of url: URL, side: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: side,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) }
    }
}
