import Foundation
import Markdown

/// Where things are in a note's text. swift-markdown reports a line and a UTF-8 column; everything built on it (the highlighter, the Live model) wants
/// UTF-16 units, which is what a text view counts in.
///
/// Three of cmark's ways of counting are put right here, so that places agree with the desktop's (lezer, remark):
/// - a line ends at `\n`, `\r\n` or a lone `\r`, as cmark counts lines (counting `\n` alone put everything after a lone `\r` on the wrong line);
/// - on a paragraph's (or a setext heading's) second and later lines, cmark places what is there at where it is in the text it read from that line, plus
///   the block's own start column, as if every line started where the first does. A line indented more or less than the first, or a lazy line (one
///   without its quote's `>`, or short of its list item's indent), had everything on it that many columns out. Here each line's text is found where
///   cmark starts reading it, by matching the quotes and list items the block is in as cmark does (`BlockPlaces`);
/// - after a paragraph's (or a setext heading's) leading link reference definitions, which include a footnote's written `[^1]: text`, cmark leaves the
///   definitions out of the block's text but still counts the lines of what is left from the block's first line, and starts the block there. Here such a
///   block starts on its own first line and what is inside it is on the lines it is written on.
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
    /// By line (from 0): whether cmark can have placed something on it away from where it is written. Only a line that can go on with a paragraph can be
    /// out (one after a line that is not blank), and only when it starts with space, a tab or `>`, or the lines before it, back to a blank one, include
    /// one that starts with those or with a list's mark (a paragraph whose first line has something before its text). Everything else keeps the quick way.
    private var mayBeOut: [Bool] = []
    /// What each paragraph and heading has been found to need, by where cmark says it starts. A class, so that a `let` map can remember.
    private let blocks = BlockPlacesCache()

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
        var out = [Bool](repeating: false, count: lineStarts.count)
        var previousBlank = true, runMarked = false
        for (index, start) in lineStarts.enumerated() {
            var at = start
            while at < utf8.count, utf8[at] == 0x20 || utf8[at] == 0x09 { at += 1 }
            let blank = at == utf8.count || utf8[at] == 0x0A || utf8[at] == 0x0D
            let first = start < utf8.count ? utf8[start] : 0
            let indented = first == 0x20 || first == 0x09 || first == 0x3E
            out[index] = !previousBlank && (indented || runMarked)
            let marked = indented || first == 0x2D || first == 0x2B || first == 0x2A || (0x30...0x39).contains(first)
            runMarked = !blank && (runMarked || marked)
            previousBlank = blank
        }
        mayBeOut = out
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
        guard let source = markup.range else { return nil }
        var lower = source.lowerBound, upper = source.upperBound
        // HTML that runs onto a later line ends one short there whatever the indent (see `BlockPlaces.moved`).
        let suspect = mayHaveDefinitions || mayBeOut(lower.line) || mayBeOut(upper.line) || (markup is InlineHTML && upper.line > lower.line)
        if suspect, let places = places(around: markup) {
            if markup is Paragraph || markup is Heading {
                lower = places.blockStart(lower, end: upper)
            } else {
                (lower, upper) = places.moved(source, of: markup)
            }
        }
        let start = offset(lower), end = offset(upper)
        return start <= end ? start..<end : nil
    }

    private func mayBeOut(_ line: Int) -> Bool { line >= 1 && line <= mayBeOut.count && mayBeOut[line - 1] }

    // MARK: A block's lines

    /// How cmark's places in the paragraph or heading `markup` is (or is inside) are put right, or nil when they are right as they are.
    private func places(around markup: any Markup) -> BlockPlaces? {
        var current: (any Markup)? = markup
        while let node = current, !(node is Paragraph || node is Heading) {
            if node is BlockMarkup { return nil }  // an inline in a table cell, or a block of another kind
            current = node.parent
        }
        guard let block = current, let range = block.range else { return nil }
        let key = BlockPlacesCache.Key(line: range.lowerBound.line, column: range.lowerBound.column)
        if let known = blocks.found[key] { return known }
        let found = findPlaces(block, range)
        blocks.found[key] = .some(found)
        return found
    }

    private func findPlaces(_ block: any Markup, _ range: SourceRange) -> BlockPlaces? {
        let containers = containers(around: block)
        let definitions = mayHaveDefinitions ? definitionLines(block, range, containers) : 0
        let first = range.lowerBound.line, last = range.upperBound.line
        guard definitions > 0 || last > first else { return nil }
        let textStarts = (first < last ? Array((first + 1)...last) : []).map { textStart(line: $0, in: containers) }
        return BlockPlaces(firstLine: first, column: range.lowerBound.column, definitionLines: definitions, textStarts: textStarts)
    }

    /// A quote or list item a paragraph is in, as cmark matches it at the start of each of the paragraph's lines.
    private enum Container {
        /// Up to three spaces, `>`, and a space after it.
        case quote
        /// A list item whose marker is on `line`, and whose later lines are its when they are indented `indent` columns (cmark's `marker_offset + padding`).
        case item(line: Int, indent: Int)
    }

    /// The quotes and list items `block` is in, outermost first.
    private func containers(around block: any Markup) -> [Container] {
        var chain: [any Markup] = []
        var current = block.parent
        while let node = current {
            if node is BlockQuote || node is ListItem { chain.append(node) }
            current = node.parent
        }
        var containers: [Container] = []
        for node in chain.reversed() {
            if node is BlockQuote {
                containers.append(.quote)
            } else if let marker = node.range?.lowerBound {
                containers.append(.item(line: marker.line, indent: itemIndent(marker: marker, inside: containers)))
            }
        }
        return containers
    }

    /// How many columns, after the marks of the containers outside it, a later line must be indented to belong to the list item whose marker is at
    /// `marker`: as far as the marker is from those marks, plus the marker and the spaces after it (one, when there are five or more, or none).
    private func itemIndent(marker: SourceLocation, inside outer: [Container]) -> Int {
        let (outside, outsideColumn, _) = marks(line: marker.line, outer)
        let markerAt = offset(marker)
        var column = outsideColumn
        for at in outside..<max(outside, markerAt) { column = Self.column(after: chars[at], at: column) }
        let lead = column - outsideColumn
        var end = markerAt
        if end < chars.count, chars[end] == 0x2D || chars[end] == 0x2B || chars[end] == 0x2A {
            end += 1
        } else {
            while end < chars.count, (0x30...0x39).contains(chars[end]) { end += 1 }
            end += 1  // the `.` or `)`
        }
        let width = end - markerAt
        column += width
        var at = end, spaced = column
        while at < chars.count, chars[at] == 0x20 || chars[at] == 0x09, spaced - column <= 5 {
            spaced = Self.column(after: chars[at], at: spaced)
            at += 1
        }
        let spaces = spaced - column
        let blank = at >= chars.count || chars[at] == 0x0A || chars[at] == 0x0D
        return lead + width + (spaces >= 5 || spaces < 1 || blank ? 1 : spaces)
    }

    /// Where the marks of `containers` end on `line`, as cmark matches them: a UTF-16 offset, the column there (a tab going on to the next multiple of
    /// four), and whether one of them did not match, which makes the line a lazy one. A list item on its own first line is its marker and the spaces after.
    private func marks(line: Int, _ containers: [Container]) -> (at: Int, column: Int, lazy: Bool) {
        var at = offset(SourceLocation(line: line, column: 1, source: nil)), column = 0
        let end = lineEnd(from: at)
        for container in containers {
            var text = at, textColumn = column
            while text < end, chars[text] == 0x20 || chars[text] == 0x09 {
                textColumn = Self.column(after: chars[text], at: textColumn)
                text += 1
            }
            switch container {
            case .quote:
                guard textColumn - column <= 3, text < end, chars[text] == 0x3E else { return (at, column, true) }
                at = text + 1
                column = textColumn + 1
                if at < end, chars[at] == 0x20 || chars[at] == 0x09 {
                    column = Self.column(after: chars[at], at: column)
                    at += 1
                }
            case .item(let first, let indent):
                if first != line, textColumn - column < indent { return (at, column, true) }
                let from = column
                while at < end, column - from < indent {
                    column = Self.column(after: chars[at], at: column)
                    at += 1
                }
            }
        }
        return (at, column, false)
    }

    /// Where cmark starts reading the text of `line`, a later line of a block in `containers`: in UTF-8 bytes from the line's start, which are as many as
    /// UTF-16 units since everything before it is ASCII. Past the marks of the containers, and the spaces after them when every container matched; a lazy
    /// line keeps those spaces in what cmark reads, and so in where it counts from.
    private func textStart(line: Int, in containers: [Container]) -> Int {
        let lineStart = offset(SourceLocation(line: line, column: 1, source: nil))
        var (at, _, lazy) = marks(line: line, containers)
        if !lazy {
            let end = lineEnd(from: at)
            while at < end, chars[at] == 0x20 || chars[at] == 0x09 { at += 1 }
        }
        return at - lineStart
    }

    private func lineEnd(from position: Int) -> Int {
        var at = position
        while at < chars.count, chars[at] != 0x0A, chars[at] != 0x0D { at += 1 }
        return at
    }

    private static func column(after unit: UInt16, at column: Int) -> Int { unit == 0x09 ? column + 4 - column % 4 : column + 1 }

    // MARK: After link reference definitions

    /// How many whole lines at the top of `block` are definitions cmark left out of it: none, most often.
    ///
    /// cmark reports what is inside the block that many lines too early, so the highest line anything in it reports, against the block's own last line,
    /// says how many at most (cmark also ends a link whose address or title goes onto the next line on its first line, which makes this an upper bound,
    /// not the answer). Each count from there down is checked by reading those lines alone: definitions and nothing else make an empty document.
    private func definitionLines(_ block: any Markup, _ range: SourceRange, _ containers: [Container]) -> Int {
        let first = offset(range.lowerBound)
        // cmark looks for definitions only where the block's text starts with `[` (or `^[`, its attribute definitions).
        guard first < chars.count, chars[first] == 0x5B || (chars[first] == 0x5E && first + 1 < chars.count && chars[first + 1] == 0x5B) else { return 0 }
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
        guard lastLine - reported > 0 else { return 0 }
        for lines in stride(from: lastLine - reported, through: 1, by: -1) where onlyDefinitions(lines: start..<(start + lines), from: first, containers) {
            return lines
        }
        return 0
    }

    /// Whether `lines` of the text (the first read from `first`, the block's start, the rest from where cmark reads them) are definitions and nothing
    /// else, read by cmark itself.
    private func onlyDefinitions(lines: Range<Int>, from first: Int, _ containers: [Container]) -> Bool {
        var text: [UInt16] = []
        for line in lines {
            let from = line == lines.lowerBound ? first : offset(SourceLocation(line: line, column: 1, source: nil)) + textStart(line: line, in: containers)
            if !text.isEmpty { text.append(0x0A) }
            text += chars[from..<lineEnd(from: from)]
        }
        return !text.isEmpty && Document(note: String(decoding: text, as: UTF16.self)).childCount == 0
    }
}

/// How cmark's places inside a paragraph or a setext heading are put right: each later line's are moved to where that line's text starts, and, after
/// leading definitions, everything is moved down by the definitions' lines and the block starts on its own first line.
struct BlockPlaces: Sendable {
    /// The block's first line, where cmark starts it (the first definition's, when it has some).
    var firstLine: Int
    /// The block's column on that line, in UTF-8 bytes. cmark adds it to the place of everything in the block, on every line.
    var column: Int
    /// How many lines of definitions cmark left out at the block's top, and so how many lines early it reports what follows them.
    var definitionLines: Int
    /// For each line after the first, where cmark reads its text from, in bytes from the line's start.
    var textStarts: [Int]

    /// Where an inline's range is written. cmark ends code and HTML that run onto a later line by where their end is in that line's text alone, without
    /// the block's column (and, for HTML, before its closing `>`), so their ends are moved by that much more.
    func moved(_ range: SourceRange, of markup: any Markup) -> (SourceLocation, SourceLocation) {
        var extra = 0
        if range.upperBound.line > range.lowerBound.line {
            if markup is InlineCode { extra = column - 1 } else if markup is InlineHTML { extra = column }
        }
        return (moved(range.lowerBound, by: 0), moved(range.upperBound, by: extra))
    }

    private func moved(_ location: SourceLocation, by extra: Int) -> SourceLocation {
        let line = location.line + definitionLines
        let later = line - firstLine - 1
        guard later >= 0, later < textStarts.count else { return SourceLocation(line: line, column: location.column, source: location.source) }
        return SourceLocation(line: line, column: location.column + textStarts[later] + 1 - column + extra, source: location.source)
    }

    /// Where the block itself starts: where cmark says, or, after definitions, where its text starts on its own first line (never after its end, which
    /// cmark has right).
    func blockStart(_ start: SourceLocation, end: SourceLocation) -> SourceLocation {
        let later = definitionLines - 1
        guard definitionLines > 0, later < textStarts.count else { return start }
        return min(SourceLocation(line: firstLine + definitionLines, column: textStarts[later] + 1, source: nil), end)
    }
}

final class BlockPlacesCache {
    struct Key: Hashable {
        var line: Int
        var column: Int
    }

    var found: [Key: BlockPlaces?] = [:]
}

extension Document {
    /// A note's Markdown, read as the desktop's preview reads it (remark-gfm): straight quotes, `--`, `---` and `...` stay as they are written. swift-markdown
    /// on its own turns them into curly quotes, dashes and an ellipsis (cmark's smart punctuation), which the desktop does not.
    init(note markdown: String) {
        self.init(parsing: markdown, options: [.disableSmartOpts])
    }
}
