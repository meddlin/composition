import Foundation

// The names and checks around a PDF's file: the Swift twins of `documentNames.ts` and of the parts of `attachmentNames.ts` that a PDF
// uses (the name it is stored under, the name shown for it, a size in words). The desktop's own functions were run over the inputs in
// fixtures/conformance/document-names.json, and DocumentNamesConformanceTests replays them.

public enum DocumentNames {
    /// Largest PDF the app imports: the same limit as an attachment. The bytes sit on disk, so this is a sanity limit.
    public static let maxBytes: Int64 = 1_000_000_000

    /// How far into a file `%PDF-` is looked for: some PDFs have a few bytes of junk before the header.
    public static let headerWindow = 1024

    /// Whether the start of a file (at least its first `headerWindow` bytes) has a PDF header.
    public static func looksLikePdf(_ head: [UInt8]) -> Bool {
        let limit = min(head.count, headerWindow) - 4
        var index = 0
        while index < limit {
            if head[index] == 0x25, head[index + 1] == 0x50, head[index + 2] == 0x44, head[index + 3] == 0x46, head[index + 4] == 0x2d { return true }
            index += 1
        }
        return false
    }

    /// The name a file is stored under: `<unique prefix>-<original name, made safe>`. The extension survives; anything outside
    /// `A-Za-z0-9_-` (path separators included) becomes `_`, and the stem cannot start with a dot or an underscore, so the stored file is never hidden.
    public static func storedName(prefix: String, fileName: String) -> String {
        let base = lastComponent(fileName)
        let scalars = Array(base.unicodeScalars)
        // A leading dot (".env") is part of the stem, not an extension.
        let dot = scalars.lastIndex(of: ".").flatMap { $0 > 0 ? $0 : nil }
        let rawStem = dot.map { String(String.UnicodeScalarView(scalars[..<$0])) } ?? base
        let rawExt = dot.map { String(String.UnicodeScalarView(scalars[($0 + 1)...])) } ?? ""

        let extensionName = String(trimmingUnderscores(clean(rawExt)).prefix(20))
        var stem = String(clean(rawStem).drop { $0 == "." || $0 == "_" }.prefix(100))
        if stem.isEmpty { stem = "file" }
        return "\(prefix)-\(stem)\(extensionName.isEmpty ? "" : ".\(extensionName)")"
    }

    /// The file name to show for a path the user picked.
    public static func displayName(_ path: String) -> String {
        let name = lastComponent(path)
        return name.isEmpty ? "file" : name
    }

    /// The title a note made for an imported PDF starts with: the file's name without `.pdf`, underscores read as spaces
    /// ("Designing_Data.pdf" is "Designing Data").
    public static func titleFromFileName(_ path: String) -> String {
        var scalars = Array(lastComponent(path).unicodeScalars)
        let suffix = Array(".pdf".unicodeScalars)
        if scalars.count >= suffix.count, zip(scalars.suffix(suffix.count), suffix).allSatisfy({ lowercased($0.0) == $0.1 }) {
            scalars.removeLast(suffix.count)
        }
        // `_+` to one space, then `\s+` to one space, then trim
        var spaced = String.UnicodeScalarView()
        var inSpace = false
        for scalar in scalars {
            if scalar == "_" || JavaScriptText.isWhitespace(scalar) {
                if !inSpace { spaced.append(" ") }
                inSpace = true
            } else {
                inSpace = false
                spaced.append(scalar)
            }
        }
        let title = JavaScriptText.trim(String(spaced))
        return title.isEmpty ? "PDF" : title
    }

    /// `1.4 MB`, `812 B`: decimal units, which is what Finder shows.
    public static func formatBytes(_ bytes: Int64) -> String {
        if bytes < 1000 { return "\(bytes) B" }
        let units = ["KB", "MB", "GB", "TB"]
        var value = Double(bytes) / 1000
        var unit = 0
        while value >= 1000 && unit < units.count - 1 {
            value /= 1000
            unit += 1
        }
        let shown = value >= 100 ? PdfMarkup.javaScriptRound(value) : PdfMarkup.javaScriptRound(value * 10) / 10
        return "\(JavaScriptText.numberString(shown)) \(units[unit])"
    }

    // MARK: Pieces

    /// `path.split(/[\\/]/).pop()`: what follows the last slash or backslash.
    private static func lastComponent(_ path: String) -> String {
        let scalars = path.unicodeScalars
        guard let separator = scalars.lastIndex(where: { $0 == "/" || $0 == "\\" }) else { return path }
        return String(scalars[scalars.index(after: separator)...])
    }

    /// `text.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_")`: each run of anything else is one underscore.
    private static func clean(_ text: String) -> String {
        var result = ""
        var inRun = false
        for scalar in text.decomposedStringWithCompatibilityMapping.unicodeScalars {
            if isSafe(scalar) {
                result.unicodeScalars.append(scalar)
                inRun = false
            } else if !inRun {
                result += "_"
                inRun = true
            }
        }
        return result
    }

    private static func isSafe(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x30...0x39, 0x41...0x5a, 0x61...0x7a, 0x5f, 0x2d: true
        default: false
        }
    }

    /// `.replace(/^_+|_+$/g, "")`
    private static func trimmingUnderscores(_ text: String) -> Substring {
        var slice = Substring(text)
        while slice.first == "_" { slice.removeFirst() }
        while slice.last == "_" { slice.removeLast() }
        return slice
    }

    private static func lowercased(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
        (0x41...0x5a).contains(scalar.value) ? Unicode.Scalar(scalar.value + 0x20)! : scalar
    }
}
