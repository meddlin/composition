import CompositionCore
import Foundation

/// The `<Ink>` tag a note holds: where its drawing's PNG is, and how wide to show it. Like `<Drawio>`, the picture is a stored image and the tag only
/// names it, so a note stays Markdown and the CLI and desktop show the PNG (docs/architecture/ink.md).
public enum InkTag {
    /// The `alt` of a drawing nobody has put words to.
    public static let defaultAlt = "Drawing"

    /// `<Ink src="app_data/…" alt="Drawing" />`: no `width`, so the drawing is shown at the size of its page (never wider than the column), which is its ink and a margin
    /// (`InkCrop`). A reader who wants it narrower writes `width="50%"`.
    public static func markdown(forName name: String, alt: String = defaultAlt, width: String? = nil) -> String {
        let cleaned = alt.filter { $0 != "\"" && $0 != "\n" && $0 != "\r" && $0 != "<" && $0 != ">" }
        return "<Ink src=\"\(StoredImages.ref(name))\" alt=\"\(cleaned)\"" + (width.map { " width=\"\($0)\"" } ?? "") + " />"
    }

    /// The note's text with the `alt` of every `<Ink>` that shows `name` made `transcript` (or "Drawing" when there is none), **if it was never put in words by a person**:
    /// it is empty, the default, or `previous`, the words this program read from the drawing before it was edited. Words a person wrote or changed are theirs and stay.
    public static func refreshingAlt(ofDrawing name: String, previous: String?, to transcript: String, in text: String) -> String {
        let new = transcript.isEmpty ? defaultAlt : transcript
        let source = StoredImages.ref(name)
        guard let tag = try? NSRegularExpression(pattern: "<Ink\\b[^>]*>"), let alt = try? NSRegularExpression(pattern: "(\\balt=\")([^\"]*)(\")") else { return text }
        var result = text as NSString
        // Last tag first, so the ranges of the earlier ones stay where they are.
        for match in tag.matches(in: text, range: NSRange(location: 0, length: result.length)).reversed() {
            let markup = result.substring(with: match.range)
            guard markup.contains("src=\"\(source)\""), let found = alt.firstMatch(in: markup, range: NSRange(location: 0, length: (markup as NSString).length)) else { continue }
            let current = (markup as NSString).substring(with: found.range(at: 2))
            guard current.isEmpty || current == defaultAlt || (previous.map { !$0.isEmpty && current == $0 } ?? false) else { continue }
            let cleaned = new.filter { $0 != "\"" && $0 != "\n" && $0 != "\r" && $0 != "<" && $0 != ">" }
            let replaced = (markup as NSString).replacingCharacters(in: found.range(at: 2), with: cleaned)
            result = result.replacingCharacters(in: match.range, with: replaced) as NSString
        }
        return result as String
    }

    /// The note's text with one stored drawing named in place of another, wherever it is referred to (the drawing was edited: its new PNG has a new name).
    public static func replacing(_ old: String, with new: String, in text: String) -> String {
        text.replacingOccurrences(of: StoredImages.ref(old), with: StoredImages.ref(new))
    }

    /// The ink a stored PNG carries, if any. Reads only the file's chunk headers where it can (the pixels are memory-mapped, not copied).
    public static func contents(ofFileAt url: URL) -> InkPNG.Contents? {
        guard url.pathExtension.lowercased() == "png", let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        guard let contents = try? InkPNG.contents(of: data), contents.strokeJSON != nil || contents.pencilKit != nil else { return nil }
        return contents
    }
}
