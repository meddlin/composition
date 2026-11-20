import Foundation

// What the import sheet needs before a scan's PDF is made: the pictures in the order a scanner named them, a title for the note, and which files
// are pictures at all (docs/architecture/scans.md, "Getting the scans in").

public enum ScanImport {
    /// Kinds of picture a page can be made from, by file extension (lowercase). HEIC and TIFF are what phones and scanners write.
    public static let pictureExtensions: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "tif", "tiff"]

    /// The most pages one import takes. A term of notes is a few hundred; a PDF of thousands of pictures is better as one per course.
    public static let maxPages = 1000

    public static func isPicture(_ url: URL) -> Bool { pictureExtensions.contains(url.pathExtension.lowercased()) }

    /// File names in the order a scanner meant them: numbers compared as numbers (`scan_2` before `scan_10`), case ignored, then by the name as it
    /// is so the order is always the same.
    public static func ordered(_ urls: [URL]) -> [URL] {
        urls.sorted { a, b in
            let order = a.lastPathComponent.compare(b.lastPathComponent, options: [.numeric, .caseInsensitive, .widthInsensitive])
            return order == .orderedSame ? a.lastPathComponent < b.lastPathComponent : order == .orderedAscending
        }
    }

    /// A title for a scan made from these files: what their names share before the page numbers (`Physics 101 - 001.jpg`, `Physics 101 - 002.jpg`
    /// give `Physics 101`), or "Scanned notes" when they share nothing that reads as a name.
    public static func title(forFiles urls: [URL]) -> String {
        let names = urls.map { $0.deletingPathExtension().lastPathComponent }
        guard var common = names.first else { return fallbackTitle }
        for name in names.dropFirst() {
            common = String(zip(common, name).prefix { $0 == $1 }.map(\.0))
        }
        if names.count == 1 {
            // One file: its page number is the number it ends with.
            common = common.replacingOccurrences(of: #"\d+$"#, with: "", options: .regularExpression)
        } else if names.contains(where: { $0.count > common.count && $0[$0.index($0.startIndex, offsetBy: common.count)].isNumber }) {
            // The shared part stops inside the page numbers (`… - 00` of `… - 001` and `… - 002`): the digits it ends with are theirs.
            common = common.replacingOccurrences(of: #"\d+$"#, with: "", options: .regularExpression)
        }
        let trimmed = common.trimmingCharacters(in: CharacterSet(charactersIn: " _-–.").union(.whitespacesAndNewlines))
        // Names a scanner or a phone makes for itself say nothing about the notes.
        let generic = ["scan", "img", "image", "photo", "page", "dsc", "document", "pxl"]
        guard trimmed.count >= 3, !generic.contains(trimmed.lowercased()) else { return fallbackTitle }
        return trimmed.replacingOccurrences(of: "_", with: " ")
    }

    public static let fallbackTitle = "Scanned notes"
}
