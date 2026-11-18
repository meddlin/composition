import Foundation
import Markdown

// The restricted MDX layer (spike S4, docs/ipad-app-design.md, "Markdown and MDX"). swift-markdown reads the CommonMark and GFM
// part of a note, but it has no notion of MDX: a note's `<Info>` arrives as raw HTML, and it has no footnotes at all (`[^1]`
// stays text). So the tags, and what MDX rejects, are found here, over the note's own text.
//
// What it has to agree with is the desktop's preview pipeline (remark-mdx with remarkRestrictMdx): the same notes valid and
// invalid, the same components with the same props, a tag on lines of its own a *block* and one inside a line of text *inline*,
// the same headings, and footnotes numbered in the same order. fixtures/conformance/mdx-notes.json holds the notes and
// apps/web/scripts/conformance-fixtures.test.ts what the real pipeline made of them. Like the desktop, a note that
// does not mention a component is not scanned at all: it is plain Markdown, where a stray `<` or `{` is fine.
//
// A note that is not valid MDX is not an error to show as a blank page: the caller draws it as plain Markdown, with the
// reason, as the desktop does.

/// A component tag's prop: `alt="x"` is text, a bare `hidden` is a flag.
public enum MdxPropValue: Equatable, Sendable {
    case text(String)
    case flag
}

/// A component in a note, in the order the opening tags are written.
public struct MdxElement: Equatable, Sendable {
    public var name: String
    public var props: [String: MdxPropValue]
    /// On lines of its own (a block), as opposed to inside a line of text.
    public var isBlock: Bool
    /// How many components it is inside.
    public var depth: Int

    public func text(_ prop: String) -> String? {
        if case .text(let value) = props[prop] { return value }
        return nil
    }
}

public struct NoteHeading: Equatable, Sendable {
    public var depth: Int
    public var text: String
}

/// The note split where block components stand: Markdown to draw, and components with what is inside them.
public indirect enum NoteBlock: Equatable, Sendable {
    case markdown(String)
    case element(name: String, props: [String: MdxPropValue], children: [NoteBlock])
}

public struct ScannedNote: Sendable {
    /// Whether the note mentions a component, and so was read as MDX.
    public var isMdx: Bool
    /// Why it is not valid MDX, if it is not. Then `blocks` is the whole note as plain Markdown.
    public var error: String?
    public var elements: [MdxElement]
    public var headings: [NoteHeading]
    /// The labels of the footnotes in the order they are first cited, which is their number.
    public var footnotes: [String]
    /// Each footnote's text by label, as written (its citations are `[^label]` still).
    public var footnoteBodies: [String: String]
    /// The note cut into blocks. The footnotes' own text is not in them: it is in `footnoteBodies`, for the list. The citations
    /// are (`[^label]`): they become numbers when the Markdown is parsed, since replacing them in the text would change which
    /// `**` and `_` mark emphasis.
    public var blocks: [NoteBlock]
    /// Where each of `blocks` is written, in the note's text, in UTF-16 units (what a text view counts in), in the same order: a component from its opening
    /// tag to the end of its closing one, a run of Markdown from the start of its first line that is not blank to the end of its last. The ranges are in order
    /// and never overlap (docs/ipad-live-default-plan.md, Step 5: what the Live tab draws a block in place of).
    public var blockRanges: [NSRange]
    /// For each run of Markdown, the pieces of the note it was copied from (the footnotes' own text is cut out of it), as scalars of the scanned text; empty for
    /// a component. With `index`, what turns a place in a run's text back into a place in the note.
    var runPieces: [[Range<Int>]]
    var index: SourceIndex

    public var isValid: Bool { error == nil }

    /// Where `range` (UTF-16 units of the text of `blocks[block]`, a run of Markdown) is in the note. Nil for a component. To locate many places in one run, make
    /// its `RunLocator` once (`locator(ofRun:text:)`): this makes one for each call.
    func noteRange(ofRun block: Int, text: String, _ range: Range<Int>) -> NSRange? {
        locator(ofRun: block, text: text)?.noteRange(range)
    }

    /// What turns places in the text of `blocks[block]` (a run of Markdown) into places in the note, made once for the run: its scalars' UTF-16 offsets are read
    /// once, not once for each of its blocks (a run of thousands of blocks was quadratic, found in Step 6 on a long note).
    func locator(ofRun block: Int, text: String) -> RunLocator? {
        guard block < runPieces.count, !runPieces[block].isEmpty else { return nil }
        return RunLocator(pieces: runPieces[block], text: text, index: index)
    }

    struct RunLocator {
        let pieces: [Range<Int>]
        let index: SourceIndex
        /// UTF-16 offsets of the run's text to its scalars.
        private let utf16: [Int]
        /// How many scalars of the run come before each piece.
        private let before: [Int]

        init(pieces: [Range<Int>], text: String, index: SourceIndex) {
            self.pieces = pieces
            self.index = index
            var utf16: [Int] = [0]
            utf16.reserveCapacity(text.utf16.count + 1)
            for scalar in text.unicodeScalars { utf16.append(utf16[utf16.count - 1] + (scalar.value > 0xFFFF ? 2 : 1)) }
            self.utf16 = utf16
            var before: [Int] = []
            var count = 0
            for piece in pieces { before.append(count); count += piece.count }
            self.before = before
        }

        private func scalar(at offset: Int) -> Int {
            var low = 0, high = utf16.count - 1
            while low < high {
                let middle = (low + high + 1) / 2
                if utf16[middle] <= offset { low = middle } else { high = middle - 1 }
            }
            return low
        }

        /// A scalar of the run's text as a scalar of the scanned text; an end that falls where one piece stops and the next starts belongs to the first.
        private func source(_ k: Int, end: Bool) -> Int {
            // The first piece that holds k (or ends at it, for an end): the last piece starting at or before k, stepped back for an end on a boundary.
            var low = 0, high = pieces.count - 1
            while low < high {
                let middle = (low + high + 1) / 2
                if before[middle] <= k { low = middle } else { high = middle - 1 }
            }
            // An end on a boundary belongs to the piece before it (the first piece it is the end of, as the scan of every piece in order had it).
            while end, low > 0, k <= before[low] { low -= 1 }
            let piece = pieces[low]
            if k - before[low] <= piece.count { return piece.lowerBound + (k - before[low]) }
            return pieces[pieces.count - 1].upperBound
        }

        func noteRange(_ range: Range<Int>) -> NSRange {
            let start = index.utf16(source(scalar(at: range.lowerBound), end: false))
            let stop = index.utf16(source(scalar(at: range.upperBound), end: true))
            return NSRange(location: start, length: max(0, stop - start))
        }
    }
}

/// Where the scalars the scanner reads are in the note's text: UTF-16 units, past the frontmatter, and counting the `\r` of each `\r\n` that the scanner
/// does not see.
struct SourceIndex: Sendable {
    private var units: [Int]

    init(body: String, offset: Int) {
        let scalars = Array(body.unicodeScalars)
        units = []
        units.reserveCapacity(scalars.count + 1)
        var position = offset
        var i = 0
        while i < scalars.count {
            if scalars[i] == "\r", i + 1 < scalars.count, scalars[i + 1] == "\n" {
                // The scanner reads `\r\n` as `\n`: its `\n` stands for both, so that what ends before it ends before the `\r`.
                units.append(position)
                position += 2
                i += 2
                continue
            }
            units.append(position)
            position += scalars[i].value > 0xFFFF ? 2 : 1
            i += 1
        }
        units.append(position)
    }

    /// The UTF-16 offset in the note of scalar `k` of the scanned text (its end, for the count of scalars).
    func utf16(_ k: Int) -> Int { units[min(max(k, 0), units.count - 1)] }

    func range(_ scalars: Range<Int>) -> NSRange {
        let start = utf16(scalars.lowerBound)
        return NSRange(location: start, length: utf16(scalars.upperBound) - start)
    }
}

public enum NoteScanner {
    /// The tags a note may use: the keys of the desktop's `mdxComponents`.
    /// `Ink` is the iPad's own so far (M2, docs/architecture/ink.md): the desktop's catalogue has no handwriting yet, so a note with an `<Ink>` shows it
    /// here and an error there until the web side is wired.
    public static let components = ["Info", "Warning", "Image", "Drawio", "Ink", "Toc", "Mark", "Footnotes", "YouTube", "Repo", "Chart"]

    /// Reads a note's body (its text without the frontmatter). `offset` is where the body starts in the note, in UTF-16 units: the block ranges are counted
    /// from the note's start.
    public static func scan(_ body: String, at offset: Int = 0) -> ScannedNote {
        let text = body.replacingOccurrences(of: "\r\n", with: "\n")
        let scalars = Array(text.unicodeScalars)
        let index = SourceIndex(body: body, offset: offset)
        var scanner = Scanner(scalars, readTags: mentionsComponent(scalars))
        scanner.run()
        let footnotes = scanner.footnotes()
        if scanner.readTags, scanner.failure == nil {
            let cut = scanner.blocks(footnotes)
            return ScannedNote(isMdx: true, error: nil, elements: scanner.elements, headings: headings(of: markdownRuns(cut.blocks)), footnotes: footnotes.order,
                               footnoteBodies: footnotes.bodies, blocks: cut.blocks, blockRanges: cut.ranges.map(index.range), runPieces: cut.pieces, index: index)
        }
        // Not MDX (it mentions no component), or not valid MDX: the whole note as plain Markdown, where footnotes still work.
        var plain = Scanner(scalars, readTags: false)
        plain.run()
        let plainFootnotes = plain.footnotes()
        let whole = plain.blocks(plainFootnotes)
        return ScannedNote(isMdx: scanner.readTags, error: scanner.failure, elements: [], headings: headings(of: markdownRuns(whole.blocks)), footnotes: plainFootnotes.order,
                           footnoteBodies: plainFootnotes.bodies, blocks: whole.blocks, blockRanges: whole.ranges.map(index.range), runPieces: whole.pieces, index: index)
    }

    /// The desktop's `usesMdxComponent`: `<` and a component's name, then a space, `/` or `>`. Code does not matter to it.
    static func mentionsComponent(_ s: [Unicode.Scalar]) -> Bool {
        var i = 0
        while i < s.count {
            if s[i] == "<" {
                for name in components {
                    let letters = Array(name.unicodeScalars)
                    let end = i + 1 + letters.count
                    guard end < s.count, Array(s[(i + 1)..<end]) == letters else { continue }
                    let next = s[end]
                    if next == "/" || next == ">" || Scanner.isWhitespace(next) { return true }
                }
            }
            i += 1
        }
        return false
    }

    private static func markdownRuns(_ blocks: [NoteBlock]) -> [String] {
        blocks.flatMap { block -> [String] in
            switch block {
            case .markdown(let source): [source]
            case .element(_, _, let children): markdownRuns(children)
            }
        }
    }

    /// Headings in document order, as the desktop lists them for `<Toc />`.
    static func headings(of runs: [String]) -> [NoteHeading] {
        var collector = HeadingCollector()
        for run in runs { collector.visit(Document(parsing: run)) }
        return collector.headings
    }

    private struct HeadingCollector: MarkupWalker {
        var headings: [NoteHeading] = []
        mutating func visitHeading(_ heading: Heading) {
            headings.append(NoteHeading(depth: heading.level, text: NoteScanner.plainText(heading).trimmingCharacters(in: .whitespacesAndNewlines)))
        }
    }

    /// A lone tag written as text, `<Mark color="green">`, `</Mark>` or `<Image src="a.png" />`, read the way a note's tags are.
    static func lone(_ html: String) -> (name: String, closing: Bool, selfClosing: Bool, props: [String: MdxPropValue])? {
        let scalars = Array(html.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars)
        let scanner = Scanner(scalars, readTags: true)
        guard case .tag(let tag) = scanner.parseTag(at: 0), tag.end == scalars.count else { return nil }
        return (tag.name, tag.closing, tag.selfClosing, tag.props)
    }

    /// A heading's words as the desktop reads them: the value of each piece of text and of code, with no marks. (swift-markdown's
    /// own `plainText` keeps the backticks around code.)
    static func plainText(_ markup: any Markup) -> String {
        switch markup {
        case let text as Text: return text.string
        case let code as InlineCode: return code.code
        case is SoftBreak: return "\n"
        case is LineBreak: return ""
        default: return markup.children.map { plainText($0) }.joined()
        }
    }

    // MARK: The scanner

    private struct Tag {
        var closing: Bool
        var selfClosing: Bool
        var name: String
        var props: [String: MdxPropValue]
        var start: Int
        var end: Int  // after the `>`
    }

    private enum TagResult {
        case notATag
        case error(String)
        case tag(Tag)
    }

    /// A block tag with where it sits, to cut the note into blocks.
    private struct FlowTag {
        var tag: Tag
    }

    /// What the footnote pass found: their order, their text, and what to cut or swap in the Markdown around them.
    private struct FootnoteInfo {
        var order: [String] = []
        var bodies: [String: String] = [:]
        var edits: [(range: Range<Int>, replacement: String)] = []
    }

    private struct Scanner {
        let s: [Unicode.Scalar]
        /// Whether to look for tags and braces (a note that mentions a component), or only for code.
        let readTags: Bool
        var failure: String?
        var elements: [MdxElement] = []
        private var stack: [(name: String, block: Bool)] = []
        private var flowTags: [FlowTag] = []
        /// Where code is, so that footnote marks in it are not marks.
        private var code: [Range<Int>] = []

        init(_ scalars: [Unicode.Scalar], readTags: Bool) { (s, self.readTags) = (scalars, readTags) }

        static func isWhitespace(_ c: Unicode.Scalar) -> Bool { c.properties.isWhitespace }
        private static func isNameStart(_ c: Unicode.Scalar) -> Bool { c == "_" || c == "$" || c.properties.isAlphabetic }
        private static func isNamePart(_ c: Unicode.Scalar) -> Bool { isNameStart(c) || c == "-" || (c.properties.numericType != nil) }

        private mutating func fail(_ message: String) { if failure == nil { failure = message } }

        private func lineEnd(from i: Int) -> Int {
            var j = i
            while j < s.count, s[j] != "\n" { j += 1 }
            return j
        }

        // MARK: Line by line: what is code, then what is in the line

        mutating func run() {
            var pos = 0
            var previousBlank = true
            var inList = false
            var fence: (mark: Unicode.Scalar, length: Int)?
            var inIndented = false
            while pos < s.count, failure == nil {
                let end = lineEnd(from: pos)
                var p = pos
                var columns = 0
                var quoted = false
                while p < end {
                    if s[p] == " " { columns += 1 } else if s[p] == "\t" { columns += 4 - columns % 4 } else if s[p] == ">" { quoted = true; columns = 0 } else { break }
                    p += 1
                }
                let content = p
                let blank = content >= end

                if let open = fence {
                    code.append(pos..<end)
                    if closes(fence: open, in: content..<end) { fence = nil }
                    pos = end + 1
                    previousBlank = false
                    continue
                }
                if blank {
                    endParagraph()
                    previousBlank = true
                    pos = end + 1
                    continue
                }
                if let opened = opensFence(in: content..<end) {
                    endParagraph()
                    fence = opened
                    code.append(pos..<end)
                    pos = end + 1
                    previousBlank = false
                    continue
                }
                if columns >= 4, !quoted, previousBlank || inIndented, !inList {
                    inIndented = true
                    code.append(pos..<end)
                    pos = end + 1
                    previousBlank = false
                    continue
                }
                inIndented = false
                if columns < 4 {
                    if startsListItem(at: content, end: end) { inList = true } else if columns == 0, previousBlank { inList = false }
                }
                if readTags, columns == 0, !quoted, previousBlank, startsEsm(at: content, end: end) {
                    fail("import and export are not supported.")
                    return
                }
                pos = scanLine(from: afterListMarkers(from: content, end: end))
                previousBlank = false
            }
            if readTags, failure == nil, let open = stack.last { fail("Expected a closing tag for `<\(open.name)>`.") }
        }

        private func opensFence(in range: Range<Int>) -> (mark: Unicode.Scalar, length: Int)? {
            guard range.lowerBound < range.upperBound else { return nil }
            let mark = s[range.lowerBound]
            guard mark == "`" || mark == "~" else { return nil }
            var n = 0
            while range.lowerBound + n < range.upperBound, s[range.lowerBound + n] == mark { n += 1 }
            guard n >= 3 else { return nil }
            // A backtick fence's info string may not contain a backtick (else it is an inline code span).
            if mark == "`", s[(range.lowerBound + n)..<range.upperBound].contains("`") { return nil }
            return (mark, n)
        }

        private func closes(fence: (mark: Unicode.Scalar, length: Int), in range: Range<Int>) -> Bool {
            var n = 0
            while range.lowerBound + n < range.upperBound, s[range.lowerBound + n] == fence.mark { n += 1 }
            guard n >= fence.length else { return false }
            return s[(range.lowerBound + n)..<range.upperBound].allSatisfy { $0 == " " || $0 == "\t" }
        }

        /// Where a line's own content begins, past any list markers (`- `, `1. `): a tag alone after a marker is still a block.
        private func afterListMarkers(from i: Int, end: Int) -> Int {
            var at = i
            while startsListItem(at: at, end: end) {
                var j = at
                if s[j] == "-" || s[j] == "*" || s[j] == "+" { j += 1 } else {
                    while j < end, s[j].properties.numericType != nil { j += 1 }
                    j += 1
                }
                while j < end, s[j] == " " || s[j] == "\t" { j += 1 }
                if j >= end { return i }  // an empty item: nothing after the marker
                at = j
            }
            return at
        }

        private mutating func endParagraph() {
            if let open = stack.last, !open.block { fail("Expected a closing tag for `<\(open.name)>` before the end of paragraph.") }
        }

        private func startsListItem(at i: Int, end: Int) -> Bool {
            guard i < end else { return false }
            var j = i
            if s[j] == "-" || s[j] == "*" || s[j] == "+" { j += 1 } else {
                while j < end, s[j].properties.numericType != nil { j += 1 }
                guard j > i, j < end, s[j] == "." || s[j] == ")" else { return false }
                j += 1
            }
            return j >= end || s[j] == " " || s[j] == "\t"
        }

        /// `import ` or `export ` at the start of a line of its own: ESM, which an MDX note may not have.
        private func startsEsm(at i: Int, end: Int) -> Bool {
            for word in ["import", "export"] {
                let letters = Array(word.unicodeScalars)
                let stop = i + letters.count
                if stop < end, Array(s[i..<stop]) == letters, s[stop] == " " || s[stop] == "\t" { return true }
            }
            return false
        }

        /// Reads the rest of a line from `start`, which may carry on over several lines (a tag with its props on many lines, a
        /// code span); returns where the next line to read begins.
        private mutating func scanLine(from start: Int) -> Int {
            var i = start
            // Tags and nothing else on the line: blocks.
            if readTags, s[i] == "<", let group = tagsAloneOnLine(at: i) {
                for tag in group.tags { register(tag, block: true) }
                return min(group.end + 1, s.count + 1)
            }
            while i < s.count, failure == nil {
                switch s[i] {
                case "\n":
                    return i + 1
                case "\\":
                    i += (i + 1 < s.count && s[i + 1] != "\n") ? 2 : 1
                case "`":
                    i = skipCodeSpan(at: i)
                case "{" where readTags:
                    fail("{expressions} are not supported.")
                case "<" where readTags:
                    switch parseTag(at: i) {
                    case .notATag: i += 1
                    case .error(let message): fail(message)
                    case .tag(let tag):
                        register(tag, block: false)
                        i = tag.end
                    }
                default:
                    i += 1
                }
            }
            return s.count + 1
        }

        /// Backticks that open a code span are skipped to its closing run (exactly as many, within the paragraph); without one
        /// they are plain characters.
        private mutating func skipCodeSpan(at i: Int) -> Int {
            var open = i
            while open < s.count, s[open] == "`" { open += 1 }
            let length = open - i
            var k = open
            while k < s.count {
                if s[k] == "\n" {
                    // A blank line ends the paragraph.
                    var j = k + 1
                    while j < s.count, s[j] == " " || s[j] == "\t" { j += 1 }
                    if j >= s.count || s[j] == "\n" { break }
                }
                if s[k] == "`" {
                    var run = k
                    while run < s.count, s[run] == "`" { run += 1 }
                    if run - k == length {
                        code.append(i..<run)
                        return run
                    }
                    k = run
                } else {
                    k += 1
                }
            }
            return open
        }

        /// The tags of a line made of tags and white space only, from `i`, and where the last one ends.
        private func tagsAloneOnLine(at i: Int) -> (tags: [Tag], end: Int)? {
            var tags: [Tag] = []
            var p = i
            while true {
                guard p < s.count, s[p] == "<", case .tag(let tag) = parseTag(at: p) else { return nil }
                tags.append(tag)
                p = tag.end
                while p < s.count, s[p] == " " || s[p] == "\t" { p += 1 }
                if p >= s.count || s[p] == "\n" { return (tags, p) }
            }
        }

        // MARK: Tags

        func parseTag(at i: Int) -> TagResult {
            var p = i + 1
            guard p < s.count else { return .error("Unexpected end of file before name.") }
            if Scanner.isWhitespace(s[p]) { return .notATag }  // `a < b` is text
            var closing = false
            switch s[p] {
            case "/":
                closing = true
                p += 1
                while p < s.count, Scanner.isWhitespace(s[p]) { p += 1 }
                if p < s.count, s[p] == ">" { return .error("Fragments (<>…</>) are not supported.") }
            case ">":
                return .error("Fragments (<>…</>) are not supported.")
            case "!", "?":
                return .error("Unexpected character `\(s[p])` before name, expected a character that can start a name.")
            default:
                break
            }
            guard p < s.count, Scanner.isNameStart(s[p]) else {
                return .error("Unexpected character before name, expected a character that can start a name.")
            }
            var name = ""
            while p < s.count, Scanner.isNamePart(s[p]) || s[p] == "." || s[p] == ":" {
                name.unicodeScalars.append(s[p])
                p += 1
            }
            guard NoteScanner.components.contains(name) else {
                return .error("Unknown component <\(name)>. Available: \(NoteScanner.components.map { "<\($0)>" }.joined(separator: ", ")).")
            }
            if closing {
                while p < s.count, Scanner.isWhitespace(s[p]) { p += 1 }
                guard p < s.count, s[p] == ">" else { return .error("Unexpected character in closing tag, expected `>`.") }
                return .tag(Tag(closing: true, selfClosing: false, name: name, props: [:], start: i, end: p + 1))
            }

            var props: [String: MdxPropValue] = [:]
            while true {
                while p < s.count, Scanner.isWhitespace(s[p]) { p += 1 }
                guard p < s.count else { return .error("Unexpected end of file before attribute name.") }
                if s[p] == "/" {
                    p += 1
                    while p < s.count, Scanner.isWhitespace(s[p]) { p += 1 }
                    guard p < s.count, s[p] == ">" else { return .error("Unexpected character after self-closing slash, expected `>`.") }
                    return .tag(Tag(closing: false, selfClosing: true, name: name, props: props, start: i, end: p + 1))
                }
                if s[p] == ">" { return .tag(Tag(closing: false, selfClosing: false, name: name, props: props, start: i, end: p + 1)) }
                if s[p] == "{" { return .error("{expressions} are not supported.") }
                guard Scanner.isNameStart(s[p]) else { return .error("Unexpected character before attribute name.") }
                var attribute = ""
                while p < s.count, Scanner.isNamePart(s[p]) || s[p] == ":" {
                    attribute.unicodeScalars.append(s[p])
                    p += 1
                }
                var q = p
                while q < s.count, Scanner.isWhitespace(s[q]) { q += 1 }
                guard q < s.count, s[q] == "=" else {
                    props[attribute] = .flag
                    continue
                }
                q += 1
                while q < s.count, Scanner.isWhitespace(s[q]) { q += 1 }
                guard q < s.count else { return .error("Unexpected end of file before attribute value.") }
                if s[q] == "{" { return .error("{expressions} are not supported.") }
                guard s[q] == "\"" || s[q] == "'" else { return .error("Unexpected character before attribute value, expected a quote.") }
                let quote = s[q]
                var value = String.UnicodeScalarView()
                q += 1
                while q < s.count, s[q] != quote {
                    value.append(s[q])
                    q += 1
                }
                guard q < s.count else { return .error("Unexpected end of file in attribute value.") }
                props[attribute] = .text(NoteScanner.decodeEntities(String(value)))
                p = q + 1
            }
        }

        private mutating func register(_ tag: Tag, block: Bool) {
            if tag.closing {
                guard let open = stack.last else { return fail("Unexpected closing slash `/` in tag, expected an open tag first.") }
                guard open.name == tag.name else { return fail("Unexpected closing tag `</\(tag.name)>`, expected corresponding closing tag for `<\(open.name)>`.") }
                // A tag on lines of its own and one inside a line of text cannot be a pair.
                guard open.block == block else { return fail("Expected the closing tag `</\(tag.name)>` in the same kind of place as the opening one.") }
                stack.removeLast()
            } else {
                // A block cannot start inside a line of text that is still open.
                if block, let open = stack.last, !open.block { return fail("Expected a closing tag for `<\(open.name)>` before the end of paragraph.") }
                elements.append(MdxElement(name: tag.name, props: tag.props, isBlock: block, depth: stack.count))
                if !tag.selfClosing { stack.append((tag.name, block)) }
            }
            if block { flowTags.append(FlowTag(tag: tag)) }
        }

        // MARK: Blocks

        /// The note cut at its block tags: what is between them is Markdown, and what a pair of tags holds is the element's children. With the top-level
        /// blocks' places (in scalars of the text) and, for each run of Markdown, the pieces of the text its own text was copied from.
        func blocks(_ footnotes: FootnoteInfo) -> (blocks: [NoteBlock], ranges: [Range<Int>], pieces: [[Range<Int>]]) {
            var root: [NoteBlock] = []
            var ranges: [Range<Int>] = []
            var pieces: [[Range<Int>]] = []
            var open: [(name: String, props: [String: MdxPropValue], children: [NoteBlock], start: Int)] = []
            var at = 0

            func add(_ block: NoteBlock, at range: Range<Int>, copied: [Range<Int>] = []) {
                if open.isEmpty {
                    root.append(block)
                    ranges.append(range)
                    pieces.append(copied)
                } else {
                    open[open.count - 1].children.append(block)
                }
            }
            func flush(to end: Int) {
                guard at < end else { return }
                let (text, copied) = applying(footnotes.edits, to: at..<end)
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { add(.markdown(text), at: written(at..<end), copied: copied) }
            }
            for flow in flowTags {
                let tag = flow.tag
                flush(to: tag.start)
                at = tag.end
                if tag.closing {
                    if let top = open.popLast() { add(.element(name: top.name, props: top.props, children: top.children), at: top.start..<tag.end) }
                } else if tag.selfClosing {
                    add(.element(name: tag.name, props: tag.props, children: []), at: tag.start..<tag.end)
                } else {
                    open.append((tag.name, tag.props, [], tag.start))
                }
            }
            flush(to: s.count)
            return (root, ranges, pieces)
        }

        /// `range` less its blank lines at either end: from the start of its first line with something on it to the last thing on its last.
        private func written(_ range: Range<Int>) -> Range<Int> {
            var first = range.lowerBound
            while first < range.upperBound, Self.isWhitespace(s[first]) { first += 1 }
            var last = range.upperBound
            while last > first, Self.isWhitespace(s[last - 1]) { last -= 1 }
            var start = first
            while start > range.lowerBound, s[start - 1] != "\n" { start -= 1 }
            return start..<max(start, last)
        }

        // MARK: Footnotes

        /// `s[range]` with the edits that lie inside it made, and the pieces of `s` that were copied into it, in order.
        func applying(_ edits: [(range: Range<Int>, replacement: String)], to range: Range<Int>) -> (text: String, pieces: [Range<Int>]) {
            var out = String.UnicodeScalarView()
            var pieces: [Range<Int>] = []
            var at = range.lowerBound
            for edit in edits.sorted(by: { $0.range.lowerBound < $1.range.lowerBound })
            where edit.range.lowerBound >= at && edit.range.upperBound <= range.upperBound {
                out.append(contentsOf: s[at..<edit.range.lowerBound])
                if at < edit.range.lowerBound { pieces.append(at..<edit.range.lowerBound) }
                out.append(contentsOf: edit.replacement.unicodeScalars)  // only ever "" (a footnote's text cut out): nothing in the note to point at
                at = edit.range.upperBound
            }
            out.append(contentsOf: s[at..<range.upperBound])
            if at < range.upperBound { pieces.append(at..<range.upperBound) }
            return (String(out), pieces)
        }

        /// The footnotes. GFM's footnotes are not in swift-markdown, so `[^label]` and `[^label]: text` are read here, outside
        /// code. Footnotes are numbered by where they are first cited (those in a footnote's own text after those in the note),
        /// a citation without a definition is text, and a definition nobody cites is not listed. Where a definition is, the
        /// Markdown loses it: its text is in `bodies`.
        func footnotes() -> FootnoteInfo {
            enum Sink { case text, definition(String), ignored }
            var defined = Set<String>()
            var seen: [(label: String, range: Range<Int>, sink: Sink)] = []
            var lines: [String: [Range<Int>]] = [:]
            var removals: [Range<Int>] = []
            var sink = Sink.text
            var span: (start: Int, end: Int)?
            var previousBlank = true
            var lineStart = 0

            func closeSpan() {
                if let open = span { removals.append(open.start..<min(open.end, s.count)) }
                span = nil
            }
            func note(_ found: [(label: String, range: Range<Int>)], in sink: Sink) {
                for mark in found { seen.append((mark.label, mark.range, sink)) }
            }

            while lineStart <= s.count {
                let end = lineEnd(from: lineStart)
                defer { lineStart = end + 1 }
                if isCode(at: lineStart) {
                    closeSpan()
                    sink = .text
                    previousBlank = true
                    continue
                }
                var p = lineStart
                var indent = 0
                while p < end, s[p] == " " || s[p] == "\t" { indent += s[p] == "\t" ? 4 : 1; p += 1 }
                let blank = p >= end
                if indent < 4, let definition = definitionStart(at: p, end: end) {
                    closeSpan()
                    // The first definition of a label is the one that counts.
                    sink = defined.insert(definition.label).inserted ? .definition(definition.label) : .ignored
                    if case .definition(let label) = sink { lines[label, default: []].append(definition.contentStart..<end) }
                    span = (lineStart, end + 1)
                    note(marks(in: definition.contentStart..<end), in: sink)
                    previousBlank = false
                    continue
                }
                if case .text = sink {} else {
                    // A definition goes on over indented lines, lazy ones that follow a non-blank line, and blanks between them.
                    if blank { previousBlank = true; continue }
                    if indent >= 4 || !previousBlank {
                        if case .definition(let label) = sink { lines[label, default: []].append(p..<end) }
                        span?.end = end + 1
                        note(marks(in: p..<end), in: sink)
                        previousBlank = false
                        continue
                    }
                    closeSpan()
                    sink = .text
                }
                previousBlank = blank
                if !blank { note(marks(in: p..<end), in: .text) }
            }
            closeSpan()

            var info = FootnoteInfo()
            func cite(_ labels: [String]) {
                for label in labels where defined.contains(label) && !info.order.contains(label) { info.order.append(label) }
            }
            cite(seen.compactMap { if case .text = $0.sink { $0.label } else { nil } })
            var index = 0
            while index < info.order.count {
                cite(seen.compactMap { if case .definition(let label) = $0.sink, label == info.order[index] { $0.label } else { nil } })
                index += 1
            }

            for label in info.order {
                info.bodies[label] = (lines[label] ?? []).map { trimmed(String(String.UnicodeScalarView(s[$0]))) }.joined(separator: "\n")
            }
            info.edits = removals.map { ($0, "") }
            return info
        }

        private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

        private func isCode(at i: Int) -> Bool { code.contains { $0.contains(i) } }

        private func definitionStart(at i: Int, end: Int) -> (label: String, contentStart: Int)? {
            guard i + 3 < end, s[i] == "[", s[i + 1] == "^" else { return nil }
            var j = i + 2
            var label = ""
            while j < end, s[j] != "]", !Scanner.isWhitespace(s[j]) {
                label.unicodeScalars.append(s[j])
                j += 1
            }
            guard !label.isEmpty, j + 1 < end + 1, j < end, s[j] == "]", j + 1 < end, s[j + 1] == ":" else { return nil }
            return (label, j + 2)
        }

        /// `[^label]` marks in `range`, not in code and not backslash-escaped.
        private func marks(in range: Range<Int>) -> [(label: String, range: Range<Int>)] {
            var found: [(label: String, range: Range<Int>)] = []
            var i = range.lowerBound
            while i + 2 < range.upperBound {
                if s[i] == "[", s[i + 1] == "^", !isCode(at: i), i == 0 || s[i - 1] != "\\" {
                    var j = i + 2
                    var label = ""
                    while j < range.upperBound, s[j] != "]", !Scanner.isWhitespace(s[j]) {
                        label.unicodeScalars.append(s[j])
                        j += 1
                    }
                    if !label.isEmpty, j < range.upperBound, s[j] == "]" {
                        found.append((label, i..<(j + 1)))
                        i = j + 1
                        continue
                    }
                }
                i += 1
            }
            return found
        }
    }

    /// `12` as `¹²`: a citation, which the Markdown would otherwise read as a link if it were `[12]`.
    static func superscript(_ number: Int) -> String {
        let digits = Array("⁰¹²³⁴⁵⁶⁷⁸⁹")
        return String(String(number).compactMap { $0.wholeNumberValue.map { digits[$0] } })
    }

    /// The character references a prop's value may use.
    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        let named = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{a0}"]
        var out = ""
        var rest = Substring(text)
        while let amp = rest.firstIndex(of: "&") {
            out += rest[..<amp]
            let after = rest[rest.index(after: amp)...]
            if let semicolon = after.firstIndex(of: ";"), after.distance(from: after.startIndex, to: semicolon) <= 10 {
                let name = String(after[..<semicolon])
                var replacement: String?
                if let known = named[name] {
                    replacement = known
                } else if name.hasPrefix("#x") || name.hasPrefix("#X"), let value = UInt32(name.dropFirst(2), radix: 16), let scalar = Unicode.Scalar(value) {
                    replacement = String(Character(scalar))
                } else if name.hasPrefix("#"), let value = UInt32(name.dropFirst()), let scalar = Unicode.Scalar(value) {
                    replacement = String(Character(scalar))
                }
                if let replacement {
                    out += replacement
                    rest = after[after.index(after: semicolon)...]
                    continue
                }
            }
            out.append("&")
            rest = after
        }
        return out + rest
    }
}
