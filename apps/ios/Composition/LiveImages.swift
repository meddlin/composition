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
}
