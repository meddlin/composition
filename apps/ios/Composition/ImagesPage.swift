import CompositionCore
import SwiftUI
import UIKit

// The Images page (the tracker's M3† row; the desktop's Images screen, `ImageLibrary.tsx`): every image stored with the notes as thumbnails, including the ones no note
// uses any more, filtered by name or by "Not used". A tap shows the picture, the Markdown and component that put it in a note (to copy), and the notes that use it.
//
// Beyond the desktop, which only browses: **Insert in Open Note**, and **Delete**, which is allowed only for an image nothing refers to, in a live note or in one in the
// Trash Can (`StoredImages.remove`), and asks first. Opened from the sidebar's More menu.

/// A stored picture, small: the system reads only what it needs, off the main thread.
struct StoredThumbnail: View {
    let url: URL
    var maxPixel = 480
    @Environment(\.look) private var look
    @State private var picture: UIImage?

    var body: some View {
        Group {
            if let picture { Image(uiImage: picture).resizable().scaledToFit() } else { Color.clear }
        }
        .background(look.mutedFill)
        .accessibilityHidden(true)
        .task(id: url) {
            let url = url, maxPixel = maxPixel
            picture = await Task.detached(priority: .utility) { DownsampledPicture.load(url, maxPixel: maxPixel)?.image }.value
        }
    }
}

/// A card's picture: a square as wide as the card, the picture fitted inside it. (The square is the box and the picture an overlay on it, so the card cannot shrink it.)
private struct StoredSquareThumbnail: View {
    let url: URL
    @Environment(\.look) private var look
    @State private var picture: UIImage?

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { if let picture { Image(uiImage: picture).resizable().scaledToFit() } }
            .background(look.mutedFill)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityHidden(true)
            .task(id: url) {
                let url = url
                picture = await Task.detached(priority: .utility) { DownsampledPicture.load(url, maxPixel: 480)?.image }.value
            }
    }
}

struct ImagesPage: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look
    @State private var images: [StoredImageInfo]?
    @State private var failed = false
    @State private var query = ""
    @State private var filter = Filter.all
    /// The file name of the image being looked at (a name is Hashable; the listing is searched for the rest).
    @State private var selected: String?

    enum Filter: Hashable { case all, unused }

    private var unused: [StoredImageInfo] { images.map(StoredImages.unused(in:)) ?? [] }
    private var shown: [StoredImageInfo] { StoredImages.match(filter == .unused ? unused : (images ?? []), query: query, limit: .max) }

    var body: some View {
        NavigationStack {
            content
                .background(look.background)
                .navigationTitle("Images")
                .navigationBarTitleDisplayMode(.inline)
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Filter by file name")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("images-done") } }
                .navigationDestination(item: $selected) { name in
                    if let image = images?.first(where: { $0.name == name }) {
                        ImageDetail(model: model, image: image, closePage: { dismiss() }, deleted: { name in
                            selected = nil
                            images?.removeAll { $0.name == name }
                        })
                    }
                }
        }
        .accessibilityIdentifier("images-page")
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if failed {
            ContentUnavailableView("Could not load the images", systemImage: "exclamationmark.triangle")
        } else if let images {
            if images.isEmpty {
                ContentUnavailableView("No images yet", systemImage: "photo.on.rectangle", description: Text("Add a photo, a file or a pasted picture to a note, and it will appear here, ready to use again."))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        controls(images)
                        if shown.isEmpty {
                            if filter == .unused && query.trimmingCharacters(in: .whitespaces).isEmpty {
                                Text("Every image is used in a note.").foregroundStyle(look.mutedText).padding(.top, 24).frame(maxWidth: .infinity)
                            } else {
                                ContentUnavailableView.search(text: query)
                            }
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                                ForEach(shown) { card($0) }
                            }
                        }
                    }
                    .padding()
                }
            }
        } else {
            ProgressView("Loading images…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func controls(_ images: [StoredImageInfo]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Show", selection: $filter) {
                Text("All (\(images.count))").tag(Filter.all)
                Text("Not used (\(unused.count))").tag(Filter.unused)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("images-filter")
            Text(summary(images)).font(.footnote).foregroundStyle(look.mutedText).accessibilityIdentifier("images-summary")
        }
    }

    private func summary(_ images: [StoredImageInfo]) -> String {
        let all = "\(images.count) \(images.count == 1 ? "image" : "images"), \(StoredImages.sizeLabel(bytes: StoredImages.totalSize(of: images)))"
        return unused.isEmpty ? all : "\(all). \(unused.count) not used, \(StoredImages.sizeLabel(bytes: StoredImages.totalSize(of: unused))) that could be freed."
    }

    private func card(_ image: StoredImageInfo) -> some View {
        Button { selected = image.name } label: {
            VStack(alignment: .leading, spacing: 6) {
                StoredSquareThumbnail(url: model.location.imagesURL.appendingPathComponent(image.name))
                Text(image.name).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).foregroundStyle(look.foreground)
                Text(image.usedIn.isEmpty ? "Not used" : StoredImages.usageLabel(count: image.usedIn.count))
                    .font(.caption.weight(image.usedIn.isEmpty ? .semibold : .regular))
                    .foregroundStyle(image.usedIn.isEmpty ? look.brand : look.mutedText)
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(look.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(look.border) }
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(StoredImages.alt(forName: image.name)), \(StoredImages.usageLabel(count: image.usedIn.count)), \(StoredImages.sizeLabel(bytes: image.size))")
        .accessibilityIdentifier("image-card-\(image.name)")
    }

    private func load() async {
        // What was typed a moment ago may have taken a picture out of a note, or put one in: it is written first, so that "used in" is true.
        model.flushEditing()
        if let listed = await model.storedImages() { images = listed } else { failed = true }
    }
}

/// One image: the picture, what puts it in a note (to copy), the notes that use it, and what can be done with it.
private struct ImageDetail: View {
    let model: AppModel
    let image: StoredImageInfo
    let closePage: () -> Void
    let deleted: (String) -> Void
    @Environment(\.look) private var look
    @State private var confirmingDelete = false
    @State private var outcome: StoredImages.RemoveOutcome?
    @State private var copied: String?
    @State private var deleting = false

    private var url: URL { model.location.imagesURL.appendingPathComponent(image.name) }
    private var addedOn: String { String(image.modifiedAt.prefix(10)) }
    private var isUnused: Bool { image.usedIn.isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                StoredThumbnail(url: url, maxPixel: 1600)
                    .frame(maxWidth: .infinity, maxHeight: 420)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .accessibilityHidden(false)
                    .accessibilityLabel(StoredImages.alt(forName: image.name))
                    .accessibilityAddTraits(.isImage)
                VStack(alignment: .leading, spacing: 4) {
                    Text(image.name).font(.footnote.monospaced()).textSelection(.enabled)
                    Text("\(StoredImages.sizeLabel(bytes: image.size)) · added \(addedOn)").font(.footnote).foregroundStyle(look.mutedText)
                }
                VStack(alignment: .leading, spacing: 8) {
                    copyRow("Markdown", StoredImages.markdown(forName: image.name))
                    if let tag = try? StoredImages.tag(forName: image.name) { copyRow("Component", tag) }
                }
                usage
                actions
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(look.background)
        .navigationTitle("Image")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Delete this image?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete Image", role: .destructive) { delete() }
        } message: {
            Text("“\(image.name)” (\(StoredImages.sizeLabel(bytes: image.size))) is deleted from this iPad, and backups made from now on will not hold it. No note refers to it, and nothing in the Trash Can does. It cannot be brought back.")
        }
        .accessibilityIdentifier("image-detail")
    }

    private func copyRow(_ label: String, _ text: String) -> some View {
        HStack(spacing: 8) {
            Text(text).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle)
                .padding(.horizontal, 8).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(look.mutedFill, in: RoundedRectangle(cornerRadius: 6))
            Button {
                UIPasteboard.general.string = text
                copied = label
            } label: {
                Label(copied == label ? "Copied" : "Copy", systemImage: copied == label ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Copy \(label)")
            .accessibilityIdentifier("image-copy-\(label.lowercased())")
        }
    }

    @ViewBuilder private var usage: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(StoredImages.usageLabel(count: image.usedIn.count)).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(look.mutedText)
            if isUnused {
                Text("Nothing refers to this file now. Copy its Markdown into a note to use it again.").foregroundStyle(look.mutedText)
            } else {
                ForEach(image.usedIn, id: \.id) { use in
                    Button {
                        closePage()
                        model.followNoteLink(use.id)
                    } label: {
                        Label(use.title.trimmingCharacters(in: .whitespaces).isEmpty ? "Untitled" : use.title, systemImage: "doc.text")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(look.link)
                    .accessibilityHint("Opens the note")
                }
            }
        }
    }

    @ViewBuilder private var actions: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                model.imageToInsert = image.name
                closePage()
            } label: {
                Label("Insert in Open Note", systemImage: "photo.badge.plus")
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.selection == nil)
            .accessibilityIdentifier("image-insert")
            if model.selection == nil { Text("Open a note first.").font(.footnote).foregroundStyle(look.mutedText) }
            if isUnused {
                Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete Image…", systemImage: "trash") }
                    .buttonStyle(.bordered)
                    .disabled(deleting)
                    .accessibilityIdentifier("image-delete")
            } else {
                Text("It is used in \(image.usedIn.count == 1 ? "a note" : "\(image.usedIn.count) notes"), so it cannot be deleted. Take the picture out of \(image.usedIn.count == 1 ? "that note" : "those notes") first.")
                    .font(.footnote).foregroundStyle(look.mutedText)
            }
            if let message { Text(message).font(.footnote).foregroundStyle(look.error).accessibilityIdentifier("image-delete-problem") }
        }
    }

    private var message: String? {
        switch outcome {
        case .usedByNotes(let count)?: "A note now refers to this picture (\(count) in all), so it was kept."
        case .usedInTrash?: "A note in the Trash Can refers to this picture. Restoring that note would bring it back with a missing picture, so it was kept. Delete the note for good first."
        case .notFound?: "This image is already gone."
        case .failed(let text)?: text
        case .removed?, nil: nil
        }
    }

    private func delete() {
        deleting = true
        Task {
            let result = await model.deleteStoredImage(image.name)
            deleting = false
            outcome = result
            if result == .removed || result == .notFound { deleted(image.name) }
        }
    }
}
