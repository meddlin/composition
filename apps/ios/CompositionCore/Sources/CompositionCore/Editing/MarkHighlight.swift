import Foundation

/// Highlighting words in a note with `<Mark color="…">…</Mark>` (build plan Step 9). This is a **smaller** rule than the desktop's `highlightText.ts`,
/// which reads the note as MDX and puts a pair of tags around every run of plain text a selection touches, so it can cross formatting and paragraphs.
/// Here the selection must be plain words on one line: nothing that Markdown or MDX would read as something else, so that a pair of tags can never
/// change how the rest of the note is read. A selection that is not that is refused with the reason, and the person selects less. There is no oracle for
/// it (the desktop does more); the tests say what it does.
public enum MarkHighlight {
    public static let colors = MdxProps.highlightColors
    public static let defaultColor = "yellow"

    public enum Refusal: Error, Equatable, LocalizedError {
        case nothingSelected, acrossLines, inFrontmatter, inCode, inTag, hasMarkup

        public var errorDescription: String? {
            switch self {
            case .nothingSelected: "Select some words to highlight."
            case .acrossLines: "Highlight one line at a time: select words that are all on one line."
            case .inFrontmatter: "The frontmatter at the top of the note can't be highlighted."
            case .inCode: "Code can't be highlighted."
            case .inTag: "Text inside a tag can't be highlighted."
            case .hasMarkup: "Select just the words, without the marks around them (such as * _ ` [ ] < > { } \\ and &), then highlight."
            }
        }
    }

    /// A highlight already in the note.
    public struct Existing: Equatable, Sendable {
        /// The whole `<Mark …>…</Mark>`, in UTF-16 units of the note, and the words inside it.
        public var range: Range<Int>
        public var inner: Range<Int>
        public var color: String
    }

    // The marks a note can hold: the tag the editor writes (a colour, or none).
    private static let pair = try! NSRegularExpression(pattern: "<Mark(?: color=\"([a-z]*)\")?>([^<\\n]*)</Mark>")
    private static let forbidden = CharacterSet(charactersIn: "`*_[]<>{}\\&")

    private static func lineRange(_ source: NSString, _ offset: Int) -> NSRange {
        let start = JS.lineStart(source, caret: offset)
        let newline = JS.index(of: 0x0A, in: source, from: offset)
        return NSRange(location: start, length: (newline == -1 ? source.length : newline) - start)
    }

    /// The highlight the range sits inside, if any (on the line it is on).
    public static func existing(in text: String, range: Range<Int>) -> Existing? {
        let source = text as NSString
        guard range.lowerBound >= 0, range.upperBound <= source.length else { return nil }
        let line = lineRange(source, range.lowerBound)
        for match in pair.matches(in: text, range: line) {
            let whole = match.range, inner = match.range(at: 2)
            guard whole.location <= range.lowerBound, range.upperBound <= whole.location + whole.length else { continue }
            let color = match.range(at: 1).location == NSNotFound ? defaultColor : source.substring(with: match.range(at: 1))
            return Existing(range: whole.location..<(whole.location + whole.length), inner: inner.location..<(inner.location + inner.length), color: color)
        }
        return nil
    }

    /// The edit that highlights the selected words in `color`, or (when they are already highlighted) changes the colour; or why not.
    public static func highlight(_ text: String, range: Range<Int>, color: String) -> Result<LineEdit, Refusal> {
        guard colors.contains(color) else { return .failure(.hasMarkup) }
        let source = text as NSString
        guard range.upperBound <= source.length, range.lowerBound >= 0, range.lowerBound < range.upperBound else { return .failure(.nothingSelected) }
        if let mark = existing(in: text, range: range) {
            let open = "<Mark color=\"\(color)\">"
            let replacement = open + source.substring(with: NSRange(location: mark.inner.lowerBound, length: mark.inner.count)) + "</Mark>"
            let selectionStart = mark.range.lowerBound + (open as NSString).length
            return .success(LineEdit(start: mark.range.lowerBound, end: mark.range.upperBound, text: replacement, selection: selectionStart..<(selectionStart + mark.inner.count)))
        }
        let selected = source.substring(with: NSRange(location: range.lowerBound, length: range.count))
        let trimmed = JavaScriptText.trim(selected)
        guard !trimmed.isEmpty else { return .failure(.nothingSelected) }
        if selected.contains(where: \.isNewline) { return .failure(.acrossLines) }
        let frontmatterEnd = source.length - (NoteFrontmatter.parse(text).body as NSString).length
        if range.lowerBound < frontmatterEnd { return .failure(.inFrontmatter) }
        if trimmed.unicodeScalars.contains(where: { forbidden.contains($0) }) { return .failure(.hasMarkup) }

        // The words' place in the line: not in code (a fence, an indented block, a code span) and not inside a tag.
        let lineStart = JS.lineStart(source, caret: range.lowerBound)
        let before = source.substring(with: NSRange(location: lineStart, length: range.lowerBound - lineStart))
        if MarkdownImages.insideFence(source, lineStart: lineStart) || before.hasPrefix("    ") || before.hasPrefix("\t") || before.filter({ $0 == "`" }).count % 2 == 1 { return .failure(.inCode) }
        let line = source.substring(with: lineRange(source, range.lowerBound))
        if line.hasPrefix("```") || line.hasPrefix("~~~") { return .failure(.inCode) }
        if let open = before.lastIndex(of: "<"), before[open...].firstIndex(of: ">") == nil { return .failure(.inTag) }

        let leading = (selected as NSString).range(of: trimmed).location
        let start = range.lowerBound + (leading == NSNotFound ? 0 : leading)
        let end = start + (trimmed as NSString).length
        let open = "<Mark color=\"\(color)\">"
        let selectionStart = start + (open as NSString).length
        return .success(LineEdit(start: start, end: end, text: open + trimmed + "</Mark>", selection: selectionStart..<(selectionStart + (trimmed as NSString).length)))
    }

    /// The edit that takes the highlight the range sits inside off, leaving its words; nil when it sits in none.
    public static func remove(_ text: String, range: Range<Int>) -> LineEdit? {
        guard let mark = existing(in: text, range: range) else { return nil }
        let inner = (text as NSString).substring(with: NSRange(location: mark.inner.lowerBound, length: mark.inner.count))
        return LineEdit(start: mark.range.lowerBound, end: mark.range.upperBound, text: inner, selection: mark.range.lowerBound..<(mark.range.lowerBound + mark.inner.count))
    }
}
