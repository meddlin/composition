import CompositionCore
import Foundation

/// The `<Ink>` tag a note holds: where its drawing's PNG is, and how wide to show it. Like `<Drawio>`, the picture is a stored image and the tag only
/// names it, so a note stays Markdown and the CLI and desktop show the PNG (docs/architecture/ink.md).
public enum InkTag {
    /// `<Ink src="app_data/…" alt="Drawing" width="80%" />`
    public static func markdown(forName name: String, alt: String = "Drawing", width: String = "80%") -> String {
        let cleaned = alt.filter { $0 != "\"" && $0 != "\n" && $0 != "\r" && $0 != "<" && $0 != ">" }
        return "<Ink src=\"\(StoredImages.ref(name))\" alt=\"\(cleaned)\" width=\"\(width)\" />"
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
