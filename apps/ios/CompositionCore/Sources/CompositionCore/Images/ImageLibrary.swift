import Foundation

// Inserting an image that is already stored (the tracker's "Insert a stored image"): the Swift twins of the desktop's `listImages` (images.ts), the join
// with the notes that point at each image (`imageUsage` in imageRefs.ts), and the picker's own `matchImages`, `usageLabel` and `formatSize`
// (imagePicker.ts). Pure apart from reading the folder. They are checked against the real functions over fixtures/conformance/images-cases.json
// (see ImagesConformanceTests).

/// One image in `app_data/`.
public struct StoredImageFile: Equatable, Sendable {
    public let name: String
    /// Size in bytes.
    public let size: Int
    /// When the file was first written (ISO 8601, as the desktop's `toISOString`).
    public let modifiedAt: String

    public init(name: String, size: Int, modifiedAt: String) {
        self.name = name
        self.size = size
        self.modifiedAt = modifiedAt
    }
}

/// A note that points at a stored image.
public struct ImageUse: Equatable, Sendable {
    public let id: Int64
    public let title: String

    public init(id: Int64, title: String) {
        self.id = id
        self.title = title
    }
}

/// A stored image and the notes that still point at it (empty once the last one has been deleted).
public struct StoredImageInfo: Equatable, Sendable, Identifiable {
    public let name: String
    public let size: Int
    public let modifiedAt: String
    public let usedIn: [ImageUse]
    public var id: String { name }

    public init(name: String, size: Int, modifiedAt: String, usedIn: [ImageUse]) {
        self.name = name
        self.size = size
        self.modifiedAt = modifiedAt
        self.usedIn = usedIn
    }
}

/// A note's id, title and text: what is needed to see which images it points at.
public struct NoteText: Equatable, Sendable {
    public let id: Int64
    public let title: String
    public let content: String

    public init(id: Int64, title: String, content: String) {
        self.id = id
        self.title = title
        self.content = content
    }
}

extension StoredImages {
    /// How many images the picker lists at once; typing narrows the rest.
    public static let pickerLimit = 50

    // MARK: Listing

    /// Every image in `app_data/`, newest first (ties by name). A missing folder is no images; files that are not images, and half-written ones
    /// (`.name.tmp`), are skipped.
    public static func list(in location: DataLocation) -> [StoredImageFile] {
        let directory = location.imagesURL
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return [] }
        var found: [StoredImageFile] = []
        for name in names where isImageName(name) {
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(name).path),
                attributes[.type] as? FileAttributeType == .typeRegular,
                let size = attributes[.size] as? NSNumber, let modified = attributes[.modificationDate] as? Date
            else { continue }  // Gone between the listing and the stat, or a folder.
            found.append(StoredImageFile(name: name, size: size.intValue, modifiedAt: Timestamp.now(modified)))
        }
        return found.sorted { $0.modifiedAt != $1.modifiedAt ? $0.modifiedAt > $1.modifiedAt : nameComes($0.name, before: $1.name) }
    }

    /// JavaScript's `a.localeCompare(b) < 0` for the characters a stored name can hold (`[A-Za-z0-9._-]`): by ICU's order, which puts `_` before `-`
    /// before `.` before digits before letters, and ignores case. (Two names that differ only in case cannot both be in the folder, whose file system
    /// ignores case, so what ICU does after that, lower case first, is not needed.)
    static func nameComes(_ a: String, before b: String) -> Bool {
        func rank(_ unit: UInt8) -> Int {
            switch unit {
            case 0x5F: 0
            case 0x2D: 1
            case 0x2E: 2
            case 0x30...0x39: 3 + Int(unit - 0x30)
            case 0x41...0x5A: 13 + Int(unit - 0x41)
            default: 13 + Int(unit - 0x61)
            }
        }
        let left = Array(a.utf8), right = Array(b.utf8)
        for (x, y) in zip(left, right) where rank(x) != rank(y) { return rank(x) < rank(y) }
        return left.count < right.count
    }

    // MARK: Who uses each

    /// The notes that point at each image, by file name, in the order the notes are given.
    public static func usage(in notes: [NoteText]) -> [String: [ImageUse]] {
        var usedIn: [String: [ImageUse]] = [:]
        for note in notes {
            for name in findRefs(in: note.content) { usedIn[name, default: []].append(ImageUse(id: note.id, title: note.title)) }
        }
        return usedIn
    }

    /// Every stored image, newest first, with the notes that still refer to it. Images are never deleted along with the text that mentions them, so
    /// this is how one is found again. `notes` is read only when there are images.
    public static func library(in location: DataLocation, notes: () throws -> [NoteText]) rethrows -> [StoredImageInfo] {
        let files = list(in: location)
        let usedIn = files.isEmpty ? [:] : usage(in: try notes())
        return files.map { StoredImageInfo(name: $0.name, size: $0.size, modifiedAt: $0.modifiedAt, usedIn: usedIn[$0.name] ?? []) }
    }

    // MARK: What the picker shows

    /// The images the picker offers for what was typed, in the order given (newest first). Every word has to appear in the file name, which starts
    /// with the title of the note the image was put into, so `trip map` finds `trip-plan-route-map-…`.
    public static func match(_ images: [StoredImageInfo], query: String, limit: Int = pickerLimit) -> [StoredImageInfo] {
        var words: [String] = []
        var word = String.UnicodeScalarView()
        for scalar in query.lowercased().unicodeScalars {
            if JavaScriptText.isWhitespace(scalar) {
                if !word.isEmpty { words.append(String(word)) }
                word = String.UnicodeScalarView()
            } else {
                word.append(scalar)
            }
        }
        if !word.isEmpty { words.append(String(word)) }
        let hits = images.filter { image in
            let name = image.name.lowercased() as NSString
            return words.allSatisfy { name.range(of: $0, options: .literal).location != NSNotFound }
        }
        return Array(hits.prefix(limit))
    }

    /// "Not used in any note", or how many notes still point at the image.
    public static func usageLabel(count: Int) -> String {
        count == 0 ? "Not used in any note" : count == 1 ? "Used in 1 note" : "Used in \(count) notes"
    }

    /// A file size the way a person reads it: `812 KB`, `2.4 MB`.
    public static func sizeLabel(bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded())) KB" }
        // `toFixed(1)`: the nearest tenth, the larger one when two are as near (an exact quarter of a megabyte, say), which `%.1f` would round to even.
        let tenths = Int((Double(bytes) / (1024 * 1024) * 10 + 0.5).rounded(.down))
        return "\(tenths / 10).\(tenths % 10) MB"
    }
}
