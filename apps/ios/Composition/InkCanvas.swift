import CompositionCore
import CompositionInk
import PencilKit
import SwiftUI
import UIKit

// M2: drawing. A drawing is a stored PNG (docs/architecture/ink.md) that carries its strokes, and `<Ink src="app_data/…" />` in a note shows it. This file is
// the full-screen canvas: PencilKit's own view with its tool picker, which gives the system's latency, prediction and palm rejection. It opens on a blank page
// or on a stored drawing, and what it hands back is the new PNG, cut to what was drawn (`InkCrop`), and the words Vision read from it; the caller stores the PNG and
// writes the tag (a new drawing) or names it in the note's place of the old one (an edited drawing).

/// A drawing to edit. `stored` is the image it comes from (nil for a new one); `drawing` and `pencilKit` are what its PNG carried.
struct InkEditing: Identifiable {
    let id = UUID()
    var stored: String?
    var drawing: InkDocument?
    /// PencilKit's own copy of the strokes, when it is still the strokes' (nothing else has edited the PNG since).
    var pencilKit: Data?
    /// The words read from the drawing when it was last saved: the note's `alt` is those words until a person changes it, and then it is left alone.
    var transcript: String? { drawing?.transcript }

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

/// What Done hands back: the PNG to store and the words read from the drawing (empty when none were, or the reading failed).
struct InkSaved {
    let png: Data
    let transcript: String
}

/// The canvas as a screen: Cancel, Done and PencilKit's tool picker. `finished` gets the new PNG.
struct InkCanvasScreen: View {
    let editing: InkEditing
    let look: Look
    let finished: (InkSaved) -> Void
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
                        // Done also reads the words in the drawing (Vision), which the first time can take a few seconds while its model loads.
                        if saving {
                            ProgressView().accessibilityLabel("Saving the drawing")
                        } else {
                            Button("Done") { Task { await finish() } }.accessibilityIdentifier("ink-done")
                        }
                    }
                }
        }
        .preferredColorScheme(look.colorScheme)
        .interactiveDismissDisabled()
    }

    /// Turns what was drawn into the PNG, cut to the ink, with Vision's reading of it in `alt` (C11). A new page with nothing on it is a cancel; an old one emptied
    /// on purpose is saved empty.
    private func finish() async {
        let drawing = canvas.view.drawing
        guard !drawing.strokes.isEmpty || editing.stored != nil else { return cancelled() }
        saving = true
        let (cut, kit) = InkDocument.cropping(drawing: drawing, size: canvas.view.contentSize)
        let blob = kit.dataRepresentation()
        let palette = InkPalette(theme: look.theme)
        let saved = await Task.detached(priority: .userInitiated) { () -> InkSaved? in
            var document = cut
            let transcript = await InkTranscript.text(of: document, using: VisionTextRecognizer())
            document.transcript = transcript.isEmpty ? nil : transcript
            document.markPencilKitCurrent()
            guard let png = try? InkRenderer.pngData(of: document, palette: palette, scale: 2, pencilKit: blob) else { return nil }
            return InkSaved(png: png, transcript: transcript)
        }.value
        saving = false
        if let saved { finished(saved) } else { cancelled() }
    }
}

/// Holds the PencilKit view so the screen can read its drawing when Done is tapped.
@MainActor
final class InkCanvasBox {
    let view = InkCanvasView()
    let toolPicker = PKToolPicker()
}

/// A PencilKit canvas that takes the tool picker once it is on screen and sizes its page the first time it is laid out: a new page is as big as the screen it opens
/// on, and a stored drawing gets `InkCrop.editingRoom` on every side and is never smaller than the screen (what is stored is cut to the ink again on Done).
final class InkCanvasView: PKCanvasView {
    /// The page of the drawing being edited, nil for a new one.
    var storedSize: CGSize?
    private var sized = false
    var picker: PKToolPicker?

    override func layoutSubviews() {
        super.layoutSubviews()
        if !sized, bounds.width > 0 {
            if let storedSize {
                contentSize = CGSize(width: max(bounds.width, storedSize.width + 2 * InkCrop.editingRoom), height: max(bounds.height, storedSize.height + 2 * InkCrop.editingRoom))
            } else {
                contentSize = bounds.size
            }
            sized = true
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
            canvas.storedSize = CGSize(width: stored.width, height: stored.height)
            let kit: PKDrawing
            if let blob = editing.pencilKit, let drawing = try? PKDrawing(data: blob) {
                kit = drawing
            } else {
                kit = stored.pkDrawing(palette: InkEditing.editingPalette(look.theme))
            }
            // The drawing sits in the middle of the roomier page, so there is room to draw on every side of it.
            canvas.drawing = kit.transformed(using: CGAffineTransform(translationX: InkCrop.editingRoom, y: InkCrop.editingRoom))
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
