import Foundation

// The text of a PDF's pages as search keeps it: a port of `pageSearchText` in the desktop's `pdfText.ts`, replaying
// fixtures/conformance/pdf-text.json (PdfTextConformanceTests). The page's raw text comes from PDFKit (`PdfTextExtractor` in
// CompositionPDF); this is the rule both sides apply to it before it is indexed.

/// One page of a PDF's own text, as read from the file: 0-based, with its printed label if the PDF gives one.
public struct PdfTextPage: Equatable, Sendable {
    public var page: Int
    public var label: String?
    public var text: String

    public init(page: Int, label: String? = nil, text: String) {
        (self.page, self.label, self.text) = (page, label, text)
    }
}

public enum PdfSearchText {
    /// The words of one page as they are indexed: line breaks made `\n` whatever they were, compatibility forms made plain (NFKC: `ﬁ` is `fi`,
    /// full-width letters are letters), each line trimmed, soft hyphens dropped except at a line's end, empty lines dropped. A word broken over two
    /// lines with a hyphen is also added whole, after the page's lines (`extrac-` / `tion` adds `extraction`). A page with no text is "".
    public static func pageSearchText(_ raw: String) -> String {
        let unified = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = unified.precomposedStringWithCompatibilityMapping
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { withoutInnerSoftHyphens(JavaScriptText.trim(String($0))) }
            .filter { !$0.isEmpty }
        var joined: [String] = []
        for index in lines.indices.dropLast() {
            if let start = brokenStart(lines[index]), let end = brokenEnd(lines[index + 1]) { joined.append(start + end) }
        }
        return (lines + (joined.isEmpty ? [] : [joined.joined(separator: " ")])).joined(separator: "\n")
    }

    /// What a search result found in a PDF's text puts in the reader's find bar, which looks for one run of text: the query's first quoted phrase,
    /// or else its longest word (every word is on the page found, but not always side by side). Filters (`tag:` …) are left out. "" for none.
    public static func findText(forQuery query: String) -> String {
        let text = SearchQueryParser.parse(query).text
        let parts = text.components(separatedBy: "\"")
        // The odd pieces were between quotes.
        if let phrase = parts.enumerated().first(where: { $0.offset % 2 == 1 && !$0.element.trimmingCharacters(in: .whitespaces).isEmpty })?.element {
            return phrase.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        }
        let words = text.split { !($0.isLetter || $0.isNumber) }.map(String.init)
        return words.enumerated().max { ($0.element.count, -$0.offset) < ($1.element.count, -$1.offset) }?.element ?? ""
    }

    private static let softHyphen: Unicode.Scalar = "\u{00AD}"

    /// `line.replace(/­(?!$)/gu, "")`
    private static func withoutInnerSoftHyphens(_ line: String) -> String {
        let scalars = Array(line.unicodeScalars)
        guard scalars.contains(softHyphen) else { return line }
        var view = String.UnicodeScalarView()
        for (index, scalar) in scalars.enumerated() where scalar != softHyphen || index == scalars.count - 1 { view.append(scalar) }
        return String(view)
    }

    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: true
        default: false
        }
    }

    /// `/(\p{L}+)[-­‐]$/u`: the letters before a hyphen that ends the line.
    private static func brokenStart(_ line: String) -> String? {
        let scalars = Array(line.unicodeScalars)
        guard let last = scalars.last, ["-", softHyphen, "\u{2010}"].contains(last) else { return nil }
        var start = scalars.count - 1
        while start > 0, isLetter(scalars[start - 1]) { start -= 1 }
        guard start < scalars.count - 1 else { return nil }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars[start..<(scalars.count - 1)])
        return String(view)
    }

    /// `/^(\p{Ll}+)/u`: the lowercase letters a line starts with.
    private static func brokenEnd(_ line: String) -> String? {
        var view = String.UnicodeScalarView()
        for scalar in line.unicodeScalars {
            guard scalar.properties.generalCategory == .lowercaseLetter else { break }
            view.append(scalar)
        }
        return view.isEmpty ? nil : String(view)
    }
}
