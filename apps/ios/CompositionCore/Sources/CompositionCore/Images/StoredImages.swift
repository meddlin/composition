import CryptoKit
import Foundation

// Images in notes (build plan Step 8): the Swift twins of the desktop's `images.ts` (sniffImage, imageFileName, storeImage) and the
// parts of `imageRefs.ts` that write and read a note's image paths (imageAlt, imageMarkdown, imageTag, findImageRefs). Pure and
// platform-free: turning a photo into JPEG bytes is the app's job. They are checked against the real functions over
// apps/ios/conformance/images-cases.json (see ImagesConformanceTests).

/// What the desktop stores: only these four, whatever a file claims to be. SVG is left out on purpose (it can carry script).
public enum StoredImageType: String, Sendable, CaseIterable {
    case png, jpg, gif, webp
}

public enum StoredImages {
    /// The folder inside the data folder, and the prefix of an image's path in a note.
    public static let directoryName = "app_data"

    // MARK: What the bytes are

    /// What the bytes actually are, whatever the file says; nil for anything else (a HEIC photo, SVG, a PDF) or a short input.
    public static func sniff(_ data: Data) -> StoredImageType? {
        let head = [UInt8](data.prefix(12))
        func starts(_ bytes: [UInt8], at offset: Int = 0) -> Bool {
            head.count >= offset + bytes.count && Array(head[offset..<(offset + bytes.count)]) == bytes
        }
        if starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return .png }
        if starts([0xFF, 0xD8, 0xFF]) { return .jpg }
        if starts(Array("GIF87a".utf8)) || starts(Array("GIF89a".utf8)) { return .gif }
        if starts(Array("RIFF".utf8)) && starts(Array("WEBP".utf8), at: 8) { return .webp }
        return nil
    }

    // MARK: Names

    private static func slug(_ text: String, maxLength: Int) -> String {
        // NFKD, then the combining marks go, then lower case: so "Café" is "cafe" and a full-width "ＡＢＣ" is "abc".
        var plain = String.UnicodeScalarView()
        for scalar in text.decomposedStringWithCompatibilityMapping.unicodeScalars where !(0x300...0x36F).contains(scalar.value) { plain.append(scalar) }
        var out: [Character] = []
        var pendingDash = false
        for scalar in String(plain).lowercased().unicodeScalars {
            let isWord = (scalar.value >= 0x61 && scalar.value <= 0x7A) || (scalar.value >= 0x30 && scalar.value <= 0x39)
            if isWord {
                if pendingDash && !out.isEmpty { out.append("-") }
                pendingDash = false
                out.append(Character(scalar))
            } else {
                pendingDash = true
            }
        }
        // A run of other characters is one dash, but never one at either end; and cutting to the length can leave one at the end.
        var result = Array(out.prefix(maxLength))
        while result.last == "-" { result.removeLast() }
        return String(result)
    }

    /// `<note title>-<image file name>-<content hash>.<ext>`, e.g. `trip-plan-map-3f9c2a71b0de.png`.
    public static func fileName(noteTitle: String, fileName: String, data: Data, type: StoredImageType) -> String {
        // The last part of the path (either kind of slash), without its last extension.
        var lastPart = String.UnicodeScalarView()
        for scalar in fileName.unicodeScalars {
            if scalar == "/" || scalar == "\\" { lastPart = String.UnicodeScalarView() } else { lastPart.append(scalar) }
        }
        let name = String(lastPart)
        var stem = name
        if let dot = name.unicodeScalars.lastIndex(of: ".") { stem = String(name.unicodeScalars[..<dot]) }
        let hash = SHA256.hash(data: data).prefix(6).map { String(format: "%02x", $0) }.joined()
        let title = slug(noteTitle, maxLength: 40)
        let image = slug(stem, maxLength: 40)
        return "\(title.isEmpty ? "note" : title)-\(image.isEmpty ? "image" : image)-\(hash).\(type.rawValue)"
    }

    private static let imageName = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*\\.(png|jpe?g|gif|webp)\\z", options: [.caseInsensitive])

    /// A single path segment with an image extension, so a name can never leave the folder.
    public static func isImageName(_ name: String) -> Bool {
        imageName.firstMatch(in: name, range: NSRange(location: 0, length: (name as NSString).length)) != nil
    }

    /// The path a note's Markdown uses for a stored image.
    public static func ref(_ name: String) -> String { "\(directoryName)/\(name)" }

    // MARK: What goes in the note

    /// Words for an image's alt text from its file name: `trip-plan-route-map-3f9c2a71b0de.png` is `trip plan route map`.
    public static func alt(forName name: String) -> String {
        var stem = name
        if let dot = name.unicodeScalars.lastIndex(of: ".") { stem = String(name.unicodeScalars[..<dot]) }
        // The `-<12 hex digits>` before the extension.
        let scalars = Array(stem.unicodeScalars)
        if scalars.count >= 13, scalars[scalars.count - 13] == "-", scalars.suffix(12).allSatisfy({ ($0.value >= 0x30 && $0.value <= 0x39) || ($0.value >= 0x61 && $0.value <= 0x66) }) {
            var trimmed = String.UnicodeScalarView()
            trimmed.append(contentsOf: scalars.dropLast(13))
            stem = String(trimmed)
        }
        var words: [Character] = []
        var pendingSpace = false
        for scalar in stem.unicodeScalars {
            let isWord = (scalar.value >= 0x41 && scalar.value <= 0x5A) || (scalar.value >= 0x61 && scalar.value <= 0x7A) || (scalar.value >= 0x30 && scalar.value <= 0x39)
            if isWord {
                if pendingSpace && !words.isEmpty { words.append(" ") }
                pendingSpace = false
                words.append(Character(scalar))
            } else {
                pendingSpace = true
            }
        }
        let text = String(words)  // already trimmed: a run of other characters only ever became a single space between two words
        return text.isEmpty ? "image" : text
    }

    /// The Markdown that shows a stored image. `alt` falls back to words from the file name; brackets and line breaks can't be in alt text.
    public static func markdown(forName name: String, alt: String? = nil) -> String {
        var cleaned = ""
        if let alt {
            // `[[\]\r\n]+` becomes a space, then every run of white space (the JavaScript kind) becomes one, then the ends are trimmed.
            var step = String.UnicodeScalarView()
            var inBrackets = false
            for scalar in alt.unicodeScalars {
                if scalar == "[" || scalar == "]" || scalar == "\r" || scalar == "\n" {
                    if !inBrackets { step.append(" ") }
                    inBrackets = true
                } else {
                    inBrackets = false
                    step.append(scalar)
                }
            }
            var collapsed = String.UnicodeScalarView()
            var inSpace = false
            for scalar in step {
                if JavaScriptText.isWhitespace(scalar) {
                    if !inSpace { collapsed.append(" ") }
                    inSpace = true
                } else {
                    inSpace = false
                    collapsed.append(scalar)
                }
            }
            cleaned = JavaScriptText.trim(String(collapsed))
        }
        return "![\(cleaned.isEmpty ? Self.alt(forName: name) : cleaned)](\(ref(name)))"
    }

    public struct NotAnImageName: Error, Equatable, LocalizedError {
        public let name: String
        public var errorDescription: String? { "Not a stored image name: \(name)" }
    }

    /// The `<Image>` tag that shows a stored image (it can then say how wide to be).
    public static func tag(forName name: String) throws -> String {
        guard isImageName(name) else { throw NotAnImageName(name: name) }
        return "<Image src=\"\(ref(name))\" alt=\"\" />"
    }

    private static let imageRef = try! NSRegularExpression(pattern: "(?<![A-Za-z0-9_/.-])(?:\\./)?app_data/[A-Za-z0-9][A-Za-z0-9._-]*")

    /// Every stored image a note's text refers to, by file name. Finds `![](app_data/x.png)` and `<Image src="app_data/x.png" />` alike.
    public static func findRefs(in content: String) -> Set<String> {
        var names = Set<String>()
        let text = content as NSString
        for match in imageRef.matches(in: content, range: NSRange(location: 0, length: text.length)) {
            var candidate = text.substring(with: match.range)
            // A path at the end of a sentence picks up its full stop.
            while candidate.hasSuffix(".") { candidate.removeLast() }
            if let name = NoteImage.name(fromRef: candidate) { names.insert(name) }
        }
        return names
    }

    // MARK: Storing

    public enum StoreResult: Equatable, Sendable {
        case stored(name: String)
        case failed(String)
    }

    /// Writes the image under a name from the note's and the file's names plus a hash of the bytes, so that two different images never
    /// share one and the same image pasted again into the same note reuses its file. `maxBytes` is a size limit, or nil for none (as on
    /// the desktop app). Writes to a temporary file and renames it, so nothing ever reads half an image.
    public static func store(noteTitle: String, fileName: String, data: Data, in location: DataLocation, maxBytes: Int? = nil) -> StoreResult {
        if data.isEmpty { return .failed("That image is empty.") }
        if let maxBytes, data.count > maxBytes { return .failed("Images can be at most \(JavaScriptText.numberString(Double(maxBytes) / (1024 * 1024))) MB.") }
        guard let type = sniff(data) else { return .failed("Only PNG, JPEG, GIF, and WebP images are supported.") }
        let name = Self.fileName(noteTitle: noteTitle, fileName: fileName, data: data, type: type)
        let directory = location.imagesURL
        let target = directory.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: target.path) {
                let temporary = directory.appendingPathComponent(".\(name).tmp")
                try data.write(to: temporary)
                try FileManager.default.moveItem(at: temporary, to: target)
            }
        } catch {
            return .failed("Could not save the image: \(error.localizedDescription)")
        }
        return .stored(name: name)
    }
}
