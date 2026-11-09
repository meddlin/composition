import CompositionCore
import SwiftUI
import UIKit

// Build plan Step 8: putting pictures in a note. A picture comes from the Photos picker, the camera, a file, the clipboard or a drop; whichever it is,
// it is made into bytes the desktop can show (a HEIC photo becomes JPEG, C18), stored in `app_data/` under the desktop's naming (`StoredImages`,
// checked against the desktop), and written into the note as `![name](app_data/...)` at the caret, as a paste does on the desktop.

/// A picture's bytes and the name it had.
struct ImageInput: Sendable {
    let data: Data
    let fileName: String
}

enum ImageImport {
    /// PNG, JPEG, GIF and WebP go in as they are. Anything else the system can read (a HEIC photo, a TIFF, a BMP) becomes JPEG, since the desktop shows
    /// only those four; nil when it is not a picture at all.
    nonisolated static func prepare(_ input: ImageInput) -> ImageInput? {
        if StoredImages.sniff(input.data) != nil { return input }
        guard let image = UIImage(data: input.data), let jpeg = image.jpegData(compressionQuality: 0.9) else { return nil }
        let stem = (input.fileName as NSString).deletingPathExtension
        return ImageInput(data: jpeg, fileName: (stem.isEmpty ? "photo" : stem) + ".jpg")
    }

    /// The pictures on the clipboard as they were copied (their own PNG or JPEG bytes, not a re-encoding), when the clipboard holds pictures and no text:
    /// cells copied from a spreadsheet arrive as text and a picture of that text, and the text is what was meant.
    @MainActor static func fromPasteboard() -> [ImageInput]? {
        let board = UIPasteboard.general
        guard board.hasImages, !board.hasStrings else { return nil }
        let kinds = [("public.png", "png"), ("public.jpeg", "jpg"), ("com.compuserve.gif", "gif"), ("org.webmproject.webp", "webp"), ("public.heic", "heic"), ("public.tiff", "tiff")]
        var found: [ImageInput] = []
        for item in board.items {
            for (type, ext) in kinds {
                if let data = item[type] as? Data {
                    found.append(ImageInput(data: data, fileName: "image.\(ext)"))
                    break
                } else if let image = item[type] as? UIImage, let data = image.pngData() {
                    found.append(ImageInput(data: data, fileName: "image.png"))
                    break
                }
            }
        }
        if found.isEmpty, let images = board.images { found = images.compactMap { $0.pngData() }.map { ImageInput(data: $0, fileName: "image.png") } }
        return found.isEmpty ? nil : found
    }
}

/// The camera, as a full-screen cover (not in the Simulator, which has none).
struct CameraView: UIViewControllerRepresentable {
    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }
    let picked: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(picked: picked) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let picked: (UIImage?) -> Void
        init(picked: @escaping (UIImage?) -> Void) { self.picked = picked }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            picked(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picked(nil) }
    }
}
