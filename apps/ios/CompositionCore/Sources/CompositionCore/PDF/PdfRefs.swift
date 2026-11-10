import Foundation

// How a note's Markdown points at a PDF, a page of it, or a mark on it: the Swift twin of `pdfRefs.ts` (docs/pdf-markup-plan.md,
// "Notes and citations"). A citation is ordinary Markdown whose target is `pdf:<uuid>` with an optional fragment:
//
//   [*Designing Data*, p. 42](pdf:3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a#p=44&a=7b1d…)
//
// The document is named by its uuid, not its id, so a note never has to be rewritten when two devices meet. `p` is the physical page
// (counted from 1); the words in the brackets show the printed page label when the PDF has one. `a` is a mark's uuid. Both are optional.
// The desktop's own code writes `fixtures/conformance/pdf-refs.json` (apps/ios/scripts/pdf-refs-oracle.mjs) and PdfRefsConformanceTests
// replays it, so what this writes into a note is what the desktop writes, and what it reads is what the desktop reads.

/// What a `pdf:` target names: the PDF, and optionally a page (from 1) and a mark.
public struct PdfRef: Equatable, Sendable {
    public var uuid: String
    public var page: Int?
    public var mark: String?

    public init(uuid: String, page: Int? = nil, mark: String? = nil) { (self.uuid, self.page, self.mark) = (uuid, page, mark) }
}

/// What the notes that cite a PDF say of it, found by reading their text.
public struct PdfCitations: Equatable, Sendable {
    public var pages: [Int]
    public var marks: [String]

    public init(pages: [Int] = [], marks: [String] = []) { (self.pages, self.marks) = (pages, marks) }
}

/// A note that belongs with a PDF: its owner, or one whose text links to it.
public struct PdfCitation: Equatable, Sendable {
    public var noteId: Int64
    public var title: String
    public var owner: Bool
    public var pages: [Int]
    public var marks: [String]

    public init(noteId: Int64, title: String, owner: Bool, pages: [Int] = [], marks: [String] = []) {
        (self.noteId, self.title, self.owner, self.pages, self.marks) = (noteId, title, owner, pages, marks)
    }
}

/// The text of a note, with when it last changed: what `PdfRefs.citations(in:of:)` reads.
public struct PdfNoteText: Equatable, Sendable {
    public var id: Int64
    public var title: String
    public var content: String
    public var updatedAt: String

    public init(id: Int64, title: String, content: String, updatedAt: String) { (self.id, self.title, self.content, self.updatedAt) = (id, title, content, updatedAt) }
}

public enum PdfRefs {
    /// The scheme in a link's target.
    public static let scheme = "pdf:"

    // MARK: Reading a target

    private static func isLowerHex(_ scalar: Unicode.Scalar) -> Bool { (0x30...0x39).contains(scalar.value) || (0x61...0x66).contains(scalar.value) }

    /// `[0-9a-f]{32}`
    static func isUuid(_ text: String) -> Bool {
        let scalars = text.unicodeScalars
        return scalars.count == 32 && scalars.allSatisfy(isLowerHex)
    }

    /// JavaScript's `.`: anything but a line terminator.
    private static func isLineTerminator(_ scalar: Unicode.Scalar) -> Bool { scalar == "\n" || scalar == "\r" || scalar.value == 0x2028 || scalar.value == 0x2029 }

    /// `/^[1-9]\d{0,6}$/`
    private static func pageNumber(_ text: String) -> Int? {
        let bytes = Array(text.utf8)
        guard (1...7).contains(bytes.count), (0x31...0x39).contains(bytes[0]), bytes.allSatisfy({ (0x30...0x39).contains($0) }) else { return nil }
        return Int(text)
    }

    /// The page and mark of a fragment; a part that is not a page or a mark's uuid is dropped, and so is a key nobody knows.
    private static func parseFragment(_ fragment: String?) -> (page: Int?, mark: String?) {
        var page: Int?
        var mark: String?
        for part in (fragment ?? "").split(separator: "&", omittingEmptySubsequences: false) {
            // `part.split("=")`: the first two pieces are the key and the value; a third is ignored.
            let pieces = part.split(separator: "=", maxSplits: 2, omittingEmptySubsequences: false)
            let key = pieces.first.map(String.init) ?? ""
            let value = pieces.count > 1 ? String(pieces[1]) : ""
            if key == "p", let number = pageNumber(value) {
                page = number
            } else if key == "a", isUuid(value) {
                mark = value
            }
        }
        return (page, mark)
    }

    /// What a link target names, or nil when it is not a `pdf:` link.
    public static func parse(_ href: String) -> PdfRef? {
        let scalars = Array(href.unicodeScalars)
        let prefix = Array(scheme.unicodeScalars)
        guard scalars.count >= prefix.count + 32, Array(scalars[0..<prefix.count]) == prefix else { return nil }
        var uuid = String.UnicodeScalarView()
        uuid.append(contentsOf: scalars[prefix.count..<(prefix.count + 32)])
        guard isUuid(String(uuid)) else { return nil }
        let rest = Array(scalars[(prefix.count + 32)...])
        if rest.isEmpty { return PdfRef(uuid: String(uuid)) }
        guard rest[0] == "#", !rest.dropFirst().contains(where: isLineTerminator) else { return nil }
        var fragment = String.UnicodeScalarView()
        fragment.append(contentsOf: rest.dropFirst())
        let (page, mark) = parseFragment(String(fragment))
        return PdfRef(uuid: String(uuid), page: page, mark: mark)
    }

    // MARK: Writing a target

    /// The Markdown target for a PDF, with the page and mark when there are any.
    public static func ref(uuid: String, page: Int? = nil, mark: String? = nil) -> String {
        var parts: [String] = []
        if let page { parts.append("p=\(page)") }
        if let mark { parts.append("a=\(mark)") }
        return scheme + uuid + (parts.isEmpty ? "" : "#" + parts.joined(separator: "&"))
    }

    /// Markdown's own punctuation, and the characters MDX reads as the start of a tag or an expression, made literal.
    private static let special: Set<Unicode.Scalar> = ["\\", "`", "*", "_", "{", "}", "[", "]", "<", ">", "~", "|"]

    /// Text from a PDF made safe to put into a note: it shows as itself and starts nothing (a tag, emphasis, a heading, a list).
    public static func escapeMarkdown(_ text: String) -> String {
        var escaped: [Unicode.Scalar] = []
        for scalar in text.unicodeScalars {
            if special.contains(scalar) { escaped.append("\\") }
            escaped.append(scalar)
        }
        // `.replace(/^(\s*)([#+-]|\d+[.)])(?=\s|$)/, "$1\\$2")`: a line that would start a heading or a list is made literal.
        var lead = 0
        while lead < escaped.count, JavaScriptText.isWhitespace(escaped[lead]) { lead += 1 }
        var end = lead
        if end < escaped.count, escaped[end] == "#" || escaped[end] == "+" || escaped[end] == "-" {
            end += 1
        } else {
            var digits = end
            while digits < escaped.count, (0x30...0x39).contains(escaped[digits].value) { digits += 1 }
            if digits > end, digits < escaped.count, escaped[digits] == "." || escaped[digits] == ")" { end = digits + 1 }
        }
        if end > lead, end == escaped.count || JavaScriptText.isWhitespace(escaped[end]) { escaped.insert("\\", at: lead) }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: escaped)
        return String(view)
    }

    /// The page as a reader names it: the printed label when the PDF has one, else the physical number.
    public static func pageLabel(page: Int, labels: [String]?) -> String {
        if let labels, page >= 1, page <= labels.count {
            let label = JavaScriptText.trim(labels[page - 1])
            if !label.isEmpty { return label }
        }
        return String(page)
    }

    /// `text.replace(/\s+/g, " ").trim()`: runs of white space become one space, in the JavaScript sense of white space.
    public static func collapse(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        var inRun = false
        for scalar in text.unicodeScalars {
            if JavaScriptText.isWhitespace(scalar) {
                if !inRun { out.append(" ") }
                inRun = true
            } else {
                out.append(scalar)
                inRun = false
            }
        }
        return JavaScriptText.trim(String(out))
    }

    /// What a citation of a page says: `Title, p. 42`, with the title in italics.
    private static func citationText(title: String, page: Int, labels: [String]?) -> String {
        let name = collapse(title)
        return (name.isEmpty ? "" : "*\(escapeMarkdown(name))*, ") + "p. \(escapeMarkdown(pageLabel(page: page, labels: labels)))"
    }

    /// `[Title](pdf:…)`, a link to the whole PDF, for the first line of a note made for it.
    public static func link(uuid: String, title: String) -> String {
        let name = collapse(title)
        return "[\(escapeMarkdown(name.isEmpty ? "PDF" : name))](\(ref(uuid: uuid)))"
    }

    /// `[Title, p. 42](pdf:…#p=44)`, ready to put into a note.
    public static func pageCitation(uuid: String, title: String, page: Int, labels: [String]? = nil) -> String {
        "[\(citationText(title: title, page: page, labels: labels))](\(ref(uuid: uuid, page: page)))"
    }

    /// A quote from a PDF as a block quote with its citation:
    ///
    ///     > The selected text.
    ///     >
    ///     > — [*Title*, p. 42](pdf:…#p=44&a=…)
    ///
    /// The empty quoted line makes the citation a paragraph of its own. The words are copied in, so the note still reads when the PDF is gone.
    public static func quoteBlock(uuid: String, title: String, quote: String, page: Int, mark: String?, labels: [String]? = nil) -> String {
        let words = collapse(quote)
        let cite = "[\(citationText(title: title, page: page, labels: labels))](\(ref(uuid: uuid, page: page, mark: mark)))"
        return (words.isEmpty ? "" : "> \(escapeMarkdown(words))\n>\n") + "> — \(cite)"
    }

    // MARK: Reading a note

    /// The pages and marks of `uuid` that a note's text cites, each once, in the order they first appear.
    public static func citations(inText text: String, of uuid: String) -> PdfCitations {
        var found = PdfCitations()
        for match in references(in: text) where match.uuid == uuid {
            let (page, mark) = parseFragment(match.fragment)
            if let page, !found.pages.contains(page) { found.pages.append(page) }
            if let mark, !found.marks.contains(mark) { found.marks.append(mark) }
        }
        return found
    }

    /// Whether a note's text cites the PDF at all.
    public static func cites(_ text: String, uuid: String) -> Bool { text.contains(scheme + uuid) }

    /// `/pdf:([0-9a-f]{32})(?:#([^\s)]*))?/g`: every `pdf:` target in a text, left to right.
    private static func references(in text: String) -> [(uuid: String, fragment: String?)] {
        let scalars = Array(text.unicodeScalars)
        let prefix = Array(scheme.unicodeScalars)
        var found: [(String, String?)] = []
        var at = 0
        while at + prefix.count + 32 <= scalars.count {
            guard Array(scalars[at..<(at + prefix.count)]) == prefix, scalars[(at + prefix.count)..<(at + prefix.count + 32)].allSatisfy(isLowerHex) else {
                at += 1
                continue
            }
            var uuid = String.UnicodeScalarView()
            uuid.append(contentsOf: scalars[(at + prefix.count)..<(at + prefix.count + 32)])
            var end = at + prefix.count + 32
            var fragment: String?
            if end < scalars.count, scalars[end] == "#" {
                var stop = end + 1
                while stop < scalars.count, !JavaScriptText.isWhitespace(scalars[stop]), scalars[stop] != ")" { stop += 1 }
                var view = String.UnicodeScalarView()
                view.append(contentsOf: scalars[(end + 1)..<stop])
                fragment = String(view)
                end = stop
            }
            found.append((String(uuid), fragment))
            at = end
        }
        return found
    }

    /// The notes that belong with a PDF: its owner first (whether or not its text links to it), then every other note whose text does, the most
    /// recently changed first, each with the pages and marks its links name.
    public static func citations(among notes: [PdfNoteText], documentUuid uuid: String, ownerNoteId: Int64) -> [PdfCitation] {
        var found: [(citation: PdfCitation, changed: String)] = []
        for note in notes {
            let owner = note.id == ownerNoteId
            if !owner && !cites(note.content, uuid: uuid) { continue }
            let named = citations(inText: note.content, of: uuid)
            found.append((PdfCitation(noteId: note.id, title: note.title, owner: owner, pages: named.pages, marks: named.marks), note.updatedAt))
        }
        let others = found.filter { !$0.citation.owner }.sorted { a, b in
            if a.changed != b.changed { return a.changed > b.changed }
            return a.citation.noteId > b.citation.noteId
        }
        return found.filter(\.citation.owner).map(\.citation) + others.map(\.citation)
    }
}
