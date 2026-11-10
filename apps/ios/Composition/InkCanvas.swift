import CompositionCore
import CompositionInk
import PencilKit
import SwiftUI
import UIKit

// M2: drawing. A drawing is a stored PNG (docs/architecture/ink.md) that carries its strokes, and `<Ink src="app_data/…" />` in a note shows it. This file is
// the full-screen canvas: PencilKit's own view with its tool picker, which gives the system's latency, prediction and palm rejection. It opens on a blank page
// or on a stored drawing, and what it hands back is the new PNG; the caller stores it and writes the tag (a new drawing) or names it in the note's place of the old
// one (an edited drawing).

/// A drawing to edit. `stored` is the image it comes from (nil for a new one); `drawing` and `pencilKit` are what its PNG carried.
struct InkEditing: Identifiable {
    let id = UUID()
    var stored: String?
    var drawing: InkDocument?
    /// PencilKit's own copy of the strokes, when it is still the strokes' (nothing else has edited the PNG since).
    var pencilKit: Data?

    static var blank: InkEditing { InkEditing(stored: nil, drawing: nil, pencilKit: nil) }

    /// The drawing in a stored picture, for editing; nil when the picture is not a drawing the app can read.
    static func load(named name: String, from folder: URL) -> InkEditing? {
        guard var contents = InkTag.contents(ofFileAt: folder.appendingPathComponent(name)), let drawing = try? contents.drawing() else { return nil }
        // PencilKit's blob is the lossless copy, but only while the strokes are still the ones it was made from.
        return InkEditing(stored: name, drawing: drawing, pencilKit: drawing.pencilKitBlobIsCurrent ? contents.pencilKit : nil)
    }

    /// The names the strokes carry are drawn in PencilKit with black for `ink` (PencilKit turns black to white on a dark scheme itself) and the scheme's own colours for the rest.
    static func editingPalette(_ theme: Theme) -> InkPalette {
        InkPalette(ink: ThemeColor(red: 0, green: 0, blue: 0), accent: theme.brand)
    }
}

/// The canvas as a screen: Cancel, Done and PencilKit's tool picker. `finished` gets the new PNG.
struct InkCanvasScreen: View {
    let editing: InkEditing
    let look: Look
    let finished: (Data) -> Void
    let cancelled: () -> Void
    @State private var canvas = InkCanvasBox()
    @State private var saving = false

    var body: some View {
        NavigationStack {
            InkCanvasRepresentable(box: canvas, editing: editing, look: look)
                .ignoresSafeArea(.container, edges: .bottom)
                .accessibilityIdentifier("ink-canvas")
                .navigationTitle(editing.stored == nil ? "New Drawing" : "Drawing")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancelled).accessibilityIdentifier("ink-cancel") }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { Task { await finish() } }
                            .disabled(saving)
                            .accessibilityIdentifier("ink-done")
                    }
                }
        }
        .preferredColorScheme(look.colorScheme)
        .interactiveDismissDisabled()
    }

    /// Turns what was drawn into the PNG. A new page with nothing on it is a cancel; an old one emptied on purpose is saved empty.
    private func finish() async {
        let drawing = canvas.view.drawing
        guard !drawing.strokes.isEmpty || editing.stored != nil else { return cancelled() }
        saving = true
        var document = InkDocument(drawing: drawing, size: canvas.view.contentSize)
        document.markPencilKitCurrent()
        let blob = drawing.dataRepresentation()
        let palette = InkPalette(theme: look.theme)
        let png = await Task.detached(priority: .userInitiated) { try? InkRenderer.pngData(of: document, palette: palette, scale: 2, pencilKit: blob) }.value
        saving = false
        if let png { finished(png) } else { cancelled() }
    }
}

/// Holds the PencilKit view so the screen can read its drawing when Done is tapped.
@MainActor
final class InkCanvasBox {
    let view = InkCanvasView()
    let toolPicker = PKToolPicker()
}

/// A PencilKit canvas that takes the tool picker once it is on screen and, if it is a new page, the size of the screen it opens on.
final class InkCanvasView: PKCanvasView {
    var wantsInitialSize = true
    var picker: PKToolPicker?

    override func layoutSubviews() {
        super.layoutSubviews()
        // A new page is as big as the screen it was opened on; a stored one keeps the size it was drawn at (the canvas scrolls when that is bigger).
        if wantsInitialSize, bounds.width > 0 {
            contentSize = bounds.size
            wantsInitialSize = false
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, let picker else { return }
        picker.setVisible(true, forFirstResponder: self)
        picker.addObserver(self)
        becomeFirstResponder()
    }
}

struct InkCanvasRepresentable: UIViewRepresentable {
    let box: InkCanvasBox
    let editing: InkEditing
    let look: Look

    func makeUIView(context: Context) -> InkCanvasView {
        let canvas = box.view
        canvas.picker = box.toolPicker
        canvas.drawingPolicy = .default
        canvas.isOpaque = false
        canvas.alwaysBounceVertical = true
        canvas.minimumZoomScale = 1
        canvas.maximumZoomScale = 4
        if let stored = editing.drawing {
            canvas.contentSize = CGSize(width: stored.width, height: stored.height)
            canvas.wantsInitialSize = false
            if let blob = editing.pencilKit, let kit = try? PKDrawing(data: blob) {
                canvas.drawing = kit
            } else {
                canvas.drawing = stored.pkDrawing(palette: InkEditing.editingPalette(look.theme))
            }
        }
        return canvas
    }

    func updateUIView(_ canvas: InkCanvasView, context: Context) {
        // PencilKit shows black ink as white in a dark interface, so the canvas takes the scheme's style and its page colour.
        canvas.overrideUserInterfaceStyle = look.theme.isDark ? .dark : .light
        canvas.backgroundColor = look.uiBackground
    }
}

// MARK: In the preview

/// A stored drawing, drawn from its strokes in the scheme in force (so black ink is white on a dark scheme), and tappable to edit. A picture that carries no
/// strokes is not handed here: it is drawn as any image.
struct InkPictureView: View {
    let name: String
    let alt: String
    let width: ImageWidth?
    let strokes: InkDocument
    @Environment(\.look) private var look
    @Environment(\.displayScale) private var displayScale
    @Environment(\.editInk) private var edit
    @State private var image: CGImage?

    var body: some View {
        Group {
            if let image {
                let picture = Image(decorative: image, scale: displayScale).resizable().scaledToFit()
                switch width {
                case .some(let width) where width.unit == .percent: FractionalWidth(fraction: width.value / 100) { picture }
                case .some(let width): picture.frame(maxWidth: width.value)
                case .none: picture.frame(maxWidth: strokes.width)
                }
            } else {
                Rectangle().fill(look.mutedFill).aspectRatio(strokes.width / max(strokes.height, 1), contentMode: .fit).frame(maxWidth: strokes.width)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { edit?(name) }
        // One element for the whole drawing, which VoiceOver can activate to edit it.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(alt.isEmpty ? "Drawing" : alt)
        .accessibilityAddTraits(edit == nil ? .isImage : [.isImage, .isButton])
        .accessibilityAction { edit?(name) }
        .accessibilityIdentifier("ink-picture")
        .task(id: "\(name)|\(look.theme.name)|\(displayScale)") {
            let document = strokes, palette = InkPalette(theme: look.theme), scale = displayScale
            image = await Task.detached(priority: .userInitiated) { InkRenderer.image(of: document, palette: palette, scale: scale) }.value
        }
    }
}

private struct EditInkKey: EnvironmentKey {
    static let defaultValue: (@MainActor (String) -> Void)? = nil
}

extension EnvironmentValues {
    /// Opens the canvas on a stored drawing (set by the screen that owns the sheet; nil where drawings cannot be edited).
    var editInk: (@MainActor (String) -> Void)? {
        get { self[EditInkKey.self] }
        set { self[EditInkKey.self] = newValue }
    }
}
