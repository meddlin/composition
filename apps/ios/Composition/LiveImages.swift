import CompositionCore
import CompositionInk
import ImageIO
import UIKit

/// The pictures the Live tab draws in the text, read from the notes' image folder: their size at once (the header of the file is all that takes), and the picture
/// itself in the background, at the size it will be drawn (a photo is not decoded whole to be shown a few hundred points wide). Nothing is fetched from the network,
/// as in the Preview: a picture that is not a stored one stays its text.
final class LiveImages: @unchecked Sendable {
    static let shared = LiveImages()
    /// Posted (on the main thread) when a picture that was asked for has come in, so that the text can be drawn again.
    static let didLoad = Notification.Name("LiveImages.didLoad")

    private let sizes = NSCache<NSString, NSValue>()
    private let thumbnails = NSCache<NSString, UIImage>()
    private let lock = NSLock()
    private var loading: Set<String> = []
    /// The strokes of each stored drawing that has been read (`Strokes.none` for a PNG that carries none), by path, and its pictures in a scheme.
    private let strokes = NSCache<NSString, Strokes>()
    private let inkSizes = NSCache<NSString, NSValue>()
    private let inkPictures = NSCache<NSString, UIImage>()

    /// The size of the picture in pixels, as its file says (turned if the camera held it on its side), or nil when there is no such file.
    func pixelSize(of url: URL) -> CGSize? {
        let key = url.path as NSString
        if let cached = sizes.object(forKey: key) { return cached.cgSizeValue }
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
            let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue, width > 0, height > 0
        else { return nil }  // not remembered: the file may be stored a moment later
        let turned = ((properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1) >= 5
        let size = turned ? CGSize(width: height, height: width) : CGSize(width: width, height: height)
        sizes.setObject(NSValue(cgSize: size), forKey: key)
        return size
    }

    /// The picture, no larger than `maxPixel` on its long side: at once when it is ready, otherwise nil, and `didLoad` is posted when it is.
    func thumbnail(at url: URL, maxPixel: Int) -> UIImage? {
        // In steps, so that a divider being dragged does not ask for a new size at every point.
        let bucket = max(256, ((maxPixel + 255) / 256) * 256)
        let key = "\(url.path)@\(bucket)"
        if let ready = thumbnails.object(forKey: key as NSString) { return ready }
        lock.lock()
        let started = loading.insert(key).inserted
        lock.unlock()
        guard started else { return nil }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            var made: UIImage?
            if let source = CGImageSourceCreateWithURL(url as CFURL, nil) {
                let options: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: bucket, kCGImageSourceShouldCacheImmediately: true,
                ]
                made = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) }
            }
            DispatchQueue.main.async { [self] in
                lock.lock()
                loading.remove(key)
                lock.unlock()
                if let made {
                    thumbnails.setObject(made, forKey: key as NSString, cost: Int(made.size.width * made.size.height * 4))
                    NotificationCenter.default.post(name: Self.didLoad, object: nil)
                }
            }
        }
        return nil
    }

    // MARK: Drawings (docs/ipad-live-default-plan.md, Step 1)

    /// A drawing's strokes as read from its PNG, or none (a PNG that carries no strokes, or ones that cannot be read: it is drawn as its pixels, as in the Preview).
    final class Strokes {
        let document: InkDocument?
        init(_ document: InkDocument?) { self.document = document }
    }

    /// The strokes of the stored drawing at `url`: nil while they are being read (`didLoad` is posted when they are), `Strokes(nil)` when it carries none. A drawing
    /// that is edited is stored under a new name, so what a name holds never changes and is read once.
    func strokes(at url: URL) -> Strokes? {
        let path = url.path
        if let ready = strokes.object(forKey: path as NSString) { return ready }
        let job = "strokes:\(url.path)"
        lock.lock()
        let started = loading.insert(job).inserted
        lock.unlock()
        guard started else { return nil }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let exists = FileManager.default.fileExists(atPath: url.path)
            let document = InkTag.contents(ofFileAt: url).flatMap { try? $0.drawing() }
            DispatchQueue.main.async { [self] in
                lock.lock()
                loading.remove(job)
                lock.unlock()
                // A file that is not there yet is not remembered: it may be stored a moment later.
                guard exists else { return }
                strokes.setObject(Strokes(document), forKey: path as NSString)
                // `resized`: the size the drawing is drawn at may be another now (a PNG with no strokes is drawn at its pixels), so the paragraphs are made again.
                NotificationCenter.default.post(name: Self.didLoad, object: nil, userInfo: ["resized": true])
            }
        }
        return nil
    }

    /// The size a stored drawing is drawn at when its tag gives no width, in points: its canvas, as the Preview's `InkPictureView` draws it. Before its strokes
    /// are read, its pixels at the density its PNG says (`pHYs`), which is the same size; a PNG with no strokes is its pixels, as the Preview draws it. Nil when
    /// there is no such file.
    func drawingSize(at url: URL) -> CGSize? {
        if let read = strokes(at: url) {
            if let document = read.document { return CGSize(width: document.width, height: document.height) }
            return pixelSize(of: url)
        }
        let key = url.path as NSString
        if let cached = inkSizes.object(forKey: key) { return cached.cgSizeValue }
        guard let pixels = pixelSize(of: url), let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        let density = CGFloat(InkPNG.pixelsPerPoint(of: data))
        let size = CGSize(width: pixels.width / density, height: pixels.height / density)
        inkSizes.setObject(NSValue(cgSize: size), forKey: key)
        return size
    }

    /// The drawing drawn from its strokes in `theme`'s colours (so black ink is white on a dark scheme), `scale` pixels to a point: at once when it is ready,
    /// otherwise nil, and `didLoad` is posted when it is.
    func drawingPicture(of document: InkDocument, at url: URL, theme: Theme, scale: CGFloat) -> UIImage? {
        let key = "\(url.path)|\(theme.name)|\(scale)"
        if let ready = inkPictures.object(forKey: key as NSString) { return ready }
        let job = "ink:\(key)"
        lock.lock()
        let started = loading.insert(job).inserted
        lock.unlock()
        guard started else { return nil }
        let palette = InkPalette(theme: theme)
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let made = InkRenderer.image(of: document, palette: palette, scale: scale).map { UIImage(cgImage: $0, scale: scale, orientation: .up) }
            DispatchQueue.main.async { [self] in
                lock.lock()
                loading.remove(job)
                lock.unlock()
                if let made {
                    inkPictures.setObject(made, forKey: key as NSString, cost: Int(made.size.width * made.size.height * scale * scale * 4))
                    NotificationCenter.default.post(name: Self.didLoad, object: nil)
                }
            }
        }
        return nil
    }
}
