import Foundation
import Markdown

/// Where things are in a note's text. swift-markdown reports a line and a UTF-8 column; everything built on it (the highlighter, the Live model) wants
/// UTF-16 units, which is what a text view counts in.
///
/// Two of cmark's ways of counting are put right here, so that places agree with the desktop's (lezer, remark):
/// - a line ends at `\n`, `\r\n` or a lone `\r`, as cmark counts lines (counting `\n` alone put everything after a lone `\r` on the wrong line);
/// - after a paragraph's (or a setext heading's) leading link reference definitions, which include a footnote's written `[^1]: text`, cmark leaves the
///   definitions out of the block's text but still counts the lines of what is left from the block's first line, and starts the block there. Here such a
///   block starts on its own first line and what is inside it is on the lines it is written on (`DefinitionLines`).
struct SourceMap {
    /// The text as UTF-16 units.
    let chars: [UInt16]
    /// Where each line starts, in UTF-8 bytes.
    private var lineStarts: [Int] = [0]
    private let utf8Count: Int
    /// UTF-8 byte offset to UTF-16 offset, or nil when the text is ASCII (they are then the same).
    private var utf16At: [Int32]?
    /// Whether the text holds a `]:` at all, without which there is no definition and no block to put right.
    private let mayHaveDefinitions: Bool
    /// What each block that starts with a `[` has been found to need, by where cmark says it starts. A class, so that a `let` map can remember.
    private let definitionLines = DefinitionLinesCache()

    init(text: String) {
        let utf8 = Array(text.utf8)
        utf8Count = utf8.count
        chars = Array(text.utf16)
        var definitions = false
        for (index, byte) in utf8.enumerated() {
            if byte == 0x0A || (byte == 0x0D && (index + 1 == utf8.count || utf8[index + 1] != 0x0A)) { lineStarts.append(index + 1) }
            if byte == 0x3A, index > 0, utf8[index - 1] == 0x5D { definitions = true }
        }
        mayHaveDefinitions = definitions
        if utf8.count != text.utf16.count {
            var map = [Int32](repeating: 0, count: utf8.count + 1)
            var u8 = 0, u16 = 0
            for scalar in text.unicodeScalars {
                let value = scalar.value
                let width8 = value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4, width16 = value > 0xFFFF ? 2 : 1
                for step in 0..<width8 { map[u8 + step] = Int32(u16) }
                u8 += width8
                u16 += width16
            }
            map[utf8.count] = Int32(u16)
            utf16At = map
        }
    }

    func offset(_ location: SourceLocation) -> Int {
        let line = max(location.line - 1, 0)
        let byte = min((line < lineStarts.count ? lineStarts[line] : utf8Count) + max(location.column - 1, 0), utf8Count)
        return utf16At.map { Int($0[byte]) } ?? byte
    }

    func range(of markup: any Markup) -> Range<Int>? {
        guard var source = markup.range else { return nil }
        if mayHaveDefinitions, let found = definitionLines(around: markup) {
            source = markup is Paragraph || markup is Heading ? found.fix.blockRange(found.block) : found.fix.moved(source)
        }
        let start = offset(source.lowerBound), end = offset(source.upperBound)
        return start <= end ? start..<end : nil
    }

    // MARK: After link reference definitions

    /// The paragraph or heading `markup` is (or is inside), with how its places are to be put right, when it starts with definitions cmark left out.
    private func definitionLines(around markup: any Markup) -> (block: SourceRange, fix: DefinitionLines)? {
        var current: (any Markup)? = markup
        while let node = current, !(node is Paragraph || node is Heading) {
            if node is BlockMarkup { return nil }  // an inline in a table cell, or a block of another kind
            current = node.parent
        }
        guard let block = current, let range = block.range else { return nil }
        let key = DefinitionLinesCache.Key(line: range.lowerBound.line, column: range.lowerBound.column)
        if let known = definitionLines.found[key] { return known.map { (range, $0) } }
        let found = findDefinitionLines(block, range)
        definitionLines.found[key] = found
        return found.map { (range, $0) }
    }

    /// How many whole lines at the top of `block` are definitions cmark left out of it, or nil when there are none.
    ///
    /// cmark reports what is inside the block that many lines too early, so the highest line anything in it reports, against the block's own last line,
    /// says how many at most (cmark also ends a link whose address or title goes onto the next line on its first line, which makes this an upper bound,
    /// not the answer). Each count from there down is checked by reading those lines alone: definitions and nothing else make an empty document.
    private func findDefinitionLines(_ block: any Markup, _ range: SourceRange) -> DefinitionLines? {
        let first = offset(range.lowerBound)
        // cmark looks for definitions only where the block's text starts with `[` (or `^[`, its attribute definitions).
        guard first < chars.count, chars[first] == 0x5B || (chars[first] == 0x5E && first + 1 < chars.count && chars[first + 1] == 0x5B) else { return nil }
        // A setext heading's last line is its underline (an ATX heading starts with `#`, and was not let past the `[`).
        let lastLine = range.upperBound.line - (block is Heading ? 1 : 0)
        var reported = range.lowerBound.line
        func walk(_ markup: any Markup) {
            for child in markup.children {
                if let r = child.range { reported = max(reported, r.lowerBound.line, r.upperBound.line) }
                walk(child)
            }
        }
        walk(block)
        let start = range.lowerBound.line
        guard lastLine - reported > 0 else { return nil }
        for lines in stride(from: lastLine - reported, through: 1, by: -1) where onlyDefinitions(lines: start..<(start + lines), from: first) {
            // The block's text starts on the next line, after the marks of the containers it is in (`>`) and the spaces before it.
            let line = start + lines
            var at = offset(SourceLocation(line: line, column: 1, source: nil))
            let lineStart = at
            while at < chars.count, chars[at] == 0x20 || chars[at] == 0x09 || chars[at] == 0x3E { at += 1 }
            // Those characters are ASCII, so as many UTF-8 bytes as UTF-16 units: the column cmark would have given.
            let column = 1 + at - lineStart
            return DefinitionLines(firstLine: start, lines: lines, columnShift: column - range.lowerBound.column, start: SourceLocation(line: line, column: column, source: nil))
        }
        return nil
    }

    /// Whether `lines` of the text (the first read from `first`, the block's start, the rest without the marks of their containers) are definitions and
    /// nothing else, read by cmark itself.
    private func onlyDefinitions(lines: Range<Int>, from first: Int) -> Bool {
        var text: [UInt16] = []
        for line in lines {
            var from = line == lines.lowerBound ? first : offset(SourceLocation(line: line, column: 1, source: nil))
            if line != lines.lowerBound { while from < chars.count, chars[from] == 0x20 || chars[from] == 0x09 || chars[from] == 0x3E { from += 1 } }
            var to = from
            while to < chars.count, chars[to] != 0x0A, chars[to] != 0x0D { to += 1 }
            if !text.isEmpty { text.append(0x0A) }
            text += chars[from..<to]
        }
        return !text.isEmpty && Document(note: String(decoding: text, as: UTF16.self)).childCount == 0
    }
}

/// How cmark's places inside a block that starts with definitions are put right: the definitions' lines are added to every line, and the block's first
/// line of text, which cmark places at the block's own column, is moved to where that text starts.
struct DefinitionLines: Sendable {
    /// The block's first line, the first definition's, where cmark puts the first line of the block's text.
    var firstLine: Int
    /// How many lines the definitions take.
    var lines: Int
    /// What to add to a column on that first line.
    var columnShift: Int
    /// Where the block's text starts.
    var start: SourceLocation

    func moved(_ location: SourceLocation) -> SourceLocation {
        SourceLocation(line: location.line + lines, column: location.column + (location.line == firstLine ? columnShift : 0), source: location.source)
    }

    func moved(_ range: SourceRange) -> SourceRange { moved(range.lowerBound)..<moved(range.upperBound) }

    /// The block's own range: from where its text starts, to where cmark ends it (which it has right).
    func blockRange(_ range: SourceRange) -> SourceRange { min(start, range.upperBound)..<range.upperBound }
}

final class DefinitionLinesCache {
    struct Key: Hashable {
        var line: Int
        var column: Int
    }

    var found: [Key: DefinitionLines?] = [:]
}

extension Document {
    /// A note's Markdown, read as the desktop's preview reads it (remark-gfm): straight quotes, `--`, `---` and `...` stay as they are written. swift-markdown
    /// on its own turns them into curly quotes, dashes and an ellipsis (cmark's smart punctuation), which the desktop does not.
    init(note markdown: String) {
        self.init(parsing: markdown, options: [.disableSmartOpts])
    }
}
