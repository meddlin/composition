import Foundation

// Breaking a line that has grown past a column, for the editor's reflow setting: a port of the desktop's `reflowText.ts`, checked against it by
// `ReflowConformanceTests` over fixtures/conformance/reflow.json.
//
// This works on the line being typed, the way a plain-text editor's auto-wrap does: it moves the words past the column onto a new line and leaves every
// other line alone. Lines whose shape matters to Markdown are never broken: frontmatter, code, headings, HTML and JSX, and (unless told otherwise) table
// rows. A continuation line keeps the line's indent and any `>` quote marks, and sits under the text of a list item rather than under its bullet.
//
// Offsets are UTF-16 units, as JavaScript counts them (and as `NSRange` and a `UITextView` do), and what counts as white space is JavaScript's, not
// Unicode's: U+FEFF is white space here and U+0085 is not. The work is done on arrays of UTF-16 units for both reasons.

public struct ReflowOptions: Equatable, Sendable {
    /// The most characters a line may hold.
    public var column: Int
    /// Leave table rows whole.
    public var keepTables: Bool

    public init(column: Int, keepTables: Bool) { (self.column, self.keepTables) = (column, keepTables) }
}

/// The text after a break, and where the caret is in it.
public struct ReflowEdit: Equatable, Sendable {
    public var text: String
    public var caret: Int

    public init(text: String, caret: Int) { (self.text, self.caret) = (text, caret) }
}

/// The stretch of one text that turned into `insert` to make another (UTF-16 offsets).
public struct ReflowSpan: Equatable, Sendable {
    public var start: Int
    public var end: Int
    public var insert: String
}

public enum ReflowText {
    private typealias Units = [UInt16]

    // MARK: JavaScript's character classes

    /// `\s`, `trim()`, `trimStart()` and `trimEnd()`: JavaScript's white space and line terminators.
    private static func isSpace(_ unit: UInt16) -> Bool {
        switch unit {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    /// A character as the UTF-16 unit it is.
    private static func u(_ scalar: Unicode.Scalar) -> UInt16 { UInt16(scalar.value) }

    private static let newline: UInt16 = 0x0A
    private static let space: UInt16 = 0x20
    private static let tab: UInt16 = 0x09

    private static func isSpaceOrTab(_ unit: UInt16) -> Bool { unit == space || unit == tab }

    private static func trimmed(_ line: ArraySlice<UInt16>, start: Bool = true, end: Bool = true) -> ArraySlice<UInt16> {
        var from = line.startIndex, to = line.endIndex
        if start { while from < to, isSpace(line[from]) { from += 1 } }
        if end { while to > from, isSpace(line[to - 1]) { to -= 1 } }
        return line[from..<to]
    }

    private static func units(_ text: String) -> Units { Array(text.utf16) }

    private static func string(_ units: some Sequence<UInt16>) -> String { String(decoding: Array(units), as: UTF16.self) }

    // MARK: The shapes of a line

    /// `PREFIX`: leading white space and quote marks, then an optional list marker (and task checkbox). `lead` is the white space and quote marks,
    /// `bulletEnd` is where the marker ends before any checkbox, and `end` where the whole prefix does.
    private struct Prefix {
        var lead: Int
        var bulletEnd: Int
        var end: Int
        var hasMarker: Bool
    }

    private static func prefix(of line: Units) -> Prefix {
        let n = line.count
        var i = 0
        while i < n, isSpace(line[i]) { i += 1 }
        while i < n, line[i] == u(">") {
            i += 1
            while i < n, isSpaceOrTab(line[i]) { i += 1 }
        }
        let lead = i

        // `(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?`
        var k = i
        if k < n, [u("-"), u("*"), u("+")].contains(line[k]) {
            k += 1
        } else {
            var digits = 0
            while k < n, digits < 9, line[k] >= 0x30, line[k] <= 0x39 {
                k += 1
                digits += 1
            }
            guard digits >= 1, k < n, line[k] == u(".") || line[k] == u(")") else { return Prefix(lead: lead, bulletEnd: lead, end: lead, hasMarker: false) }
            k += 1
        }
        var m = k
        while m < n, isSpaceOrTab(line[m]) { m += 1 }
        guard m > k else { return Prefix(lead: lead, bulletEnd: lead, end: lead, hasMarker: false) }
        let bulletEnd = m
        // The optional task checkbox: `[ ]`, `[x]` or `[X]`, then at least one space or tab.
        if m + 2 < n, line[m] == u("["), [space, u("x"), u("X")].contains(line[m + 1]), line[m + 2] == u("]") {
            var after = m + 3
            while after < n, isSpaceOrTab(line[after]) { after += 1 }
            if after > m + 3 { return Prefix(lead: lead, bulletEnd: bulletEnd, end: after, hasMarker: true) }
        }
        return Prefix(lead: lead, bulletEnd: bulletEnd, end: bulletEnd, hasMarker: true)
    }

    /// `FENCE`: up to three white-space characters, then three or more of one fence character. Returns the run of it.
    private static func fence(_ line: Units) -> Units? {
        let n = line.count
        var i = 0
        while i < n, i < 3, isSpace(line[i]) { i += 1 }
        guard i < n, line[i] == u("`") || line[i] == u("~") else { return nil }
        let character = line[i]
        var j = i
        while j < n, line[j] == character { j += 1 }
        return j - i >= 3 ? Array(line[i..<j]) : nil
    }

    /// `HEADING`: up to three white-space characters, one to six `#`, then white space or the end.
    private static func isHeading(_ line: Units) -> Bool {
        let n = line.count
        var i = 0
        while i < n, i < 3, isSpace(line[i]) { i += 1 }
        var hashes = 0
        while i < n, line[i] == u("#") {
            i += 1
            hashes += 1
        }
        guard (1...6).contains(hashes) else { return false }
        return i == n || isSpace(line[i])
    }

    /// `TABLE_DELIMITER`: `^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$`, as a scan.
    private static func isDelimiterRow(_ line: Units) -> Bool {
        let n = line.count
        guard line.contains(u("|")) else { return false }
        var i = 0
        func skipSpace() { while i < n, isSpace(line[i]) { i += 1 } }
        /// `:?-+:?\s*`
        func cell() -> Bool {
            var j = i
            if j < n, line[j] == u(":") { j += 1 }
            guard j < n, line[j] == u("-") else { return false }
            while j < n, line[j] == u("-") { j += 1 }
            if j < n, line[j] == u(":") { j += 1 }
            i = j
            skipSpace()
            return true
        }
        skipSpace()
        if i < n, line[i] == u("|") { i += 1 }
        skipSpace()
        guard cell() else { return false }
        while i < n, line[i] == u("|") {
            let before = i
            i += 1
            skipSpace()
            if !cell() {
                i = before
                break
            }
        }
        if i < n, line[i] == u("|") { i += 1 }
        skipSpace()
        return i == n
    }

    /// Whether line `i` is inside the frontmatter block at the top of the note.
    private static func inFrontmatter(_ lines: [Units], _ i: Int) -> Bool {
        let dashes: Units = Array("---".utf16)
        guard Array(trimmed(lines[0][...], start: false)) == dashes else { return false }
        let close = lines.indices.first { $0 > 0 && Array(trimmed(lines[$0][...], start: false)) == dashes }
        guard let close else { return true }
        return i <= close
    }

    /// Whether line `i` is a code fence or sits between a fence's opening and closing lines.
    private static func inFence(_ lines: [Units], _ i: Int) -> Bool {
        var open: (character: UInt16, length: Int)?
        for index in 0...i {
            guard let marker = fence(lines[index]) else { continue }
            if open == nil {
                open = (marker[0], marker.count)
                if index == i { return true }
            } else if let current = open, marker[0] == current.character, marker.count >= current.length, Array(trimmed(lines[index][...])) == marker {
                if index == i { return true }
                open = nil
            }
        }
        return open != nil
    }

    private static func isTableRow(_ lines: [Units], _ i: Int) -> Bool {
        let line = lines[i]
        if trimmed(line[...], end: false).first == u("|") { return true }
        guard line.contains(u("|")) else { return false }
        // A run of lines with pipes is a table once it has a delimiter row, and the header is the line above it.
        var first = i
        while first > 0, lines[first - 1].contains(u("|")) { first -= 1 }
        var last = i
        while last < lines.count - 1, lines[last + 1].contains(u("|")) { last += 1 }
        guard first + 1 <= last else { return false }
        for d in (first + 1)...last where isDelimiterRow(lines[d]) && i >= d - 1 { return true }
        return false
    }

    /// Whether Markdown would read line `i` as something other than flowing text, so that breaking it changes its meaning.
    private static func isRigid(_ lines: [Units], _ i: Int, keepTables: Bool) -> Bool {
        let line = lines[i]
        if inFrontmatter(lines, i) || inFence(lines, i) { return true }
        if isHeading(line) || trimmed(line[...], end: false).first == u("<") { return true }
        if keepTables && isTableRow(lines, i) { return true }
        // Indented four spaces after a blank line is a code block, unless it is a list item.
        let indented = (line.count >= 4 && line[0..<4].allSatisfy { $0 == space }) || line.first == tab
        let listItem = prefix(of: line).hasMarker
        return indented && !listItem && (i == 0 || trimmed(lines[i - 1][...]).isEmpty)
    }

    /// The run of spaces to break at: the last one that leaves the line within `column`, else the first one after it.
    private static func findBreak(_ line: ArraySlice<UInt16>, prefixLength: Int, column: Int) -> (start: Int, end: Int)? {
        var fallback: (start: Int, end: Int)?
        var best: (start: Int, end: Int)?
        let base = line.startIndex
        var index = base
        while index < line.endIndex {
            guard line[index] == space else {
                index += 1
                continue
            }
            var stop = index
            while stop < line.endIndex, line[stop] == space { stop += 1 }
            let start = index - base, end = stop - base
            index = stop
            // Nothing to break off before the line's own text starts, or after its last word.
            if start <= prefixLength || end >= line.count { continue }
            if start <= column {
                best = (start, end)
            } else {
                fallback = (start, end)
                break
            }
        }
        return best ?? fallback
    }

    // MARK: Reflow

    /// Breaks the line the caret is on, once or as often as it takes, until it fits in `column` or has nowhere left to break (one long word or URL stays
    /// whole). Returns nil when the line needs no change.
    public static func reflowAtCaret(_ text: String, caret: Int, options: ReflowOptions) -> ReflowEdit? {
        let original = units(text)
        let caret = min(max(caret, 0), original.count)
        var start = 0
        if caret != 0 {
            var back = min(caret - 1, original.count - 1)
            while back >= 0, original[back] != newline { back -= 1 }
            start = back + 1
        }
        var end = original[start...].firstIndex(of: newline) ?? original.count
        if end - start <= options.column { return nil }

        let lines = original.split(separator: newline, omittingEmptySubsequences: false).map { Array($0) }
        let index = original[0..<start].reduce(0) { $0 + ($1 == newline ? 1 : 0) }
        if isRigid(lines, index, keepTables: options.keepTables) { return nil }

        let line = lines[index]
        let shape = prefix(of: line)
        // Continuation lines line up under the list item's text, not under its bullet or checkbox.
        let indent: Units = Array(line[0..<shape.lead]) + Units(repeating: space, count: shape.hasMarker ? shape.bulletEnd - shape.lead : 0)

        var out = original
        var moved = caret
        var prefixLength = shape.end
        while true {
            end = out[start...].firstIndex(of: newline) ?? out.count
            let current = out[start..<end]
            if current.count <= options.column { break }
            guard let found = findBreak(current, prefixLength: prefixLength, column: options.column) else { break }
            let from = start + found.start, to = start + found.end
            out = Array(out[0..<from]) + [newline] + indent + Array(out[to...])
            if moved >= to { moved += 1 + indent.count - (to - from) } else if moved > from { moved = from + 1 + indent.count }
            start = from + 1
            prefixLength = indent.count
        }
        return out == original ? nil : ReflowEdit(text: string(out), caret: moved)
    }

    /// The stretch of `before` that turned into `insert` to make `after`: what to hand an editor command so the rest of the text is left alone.
    public static func changedSpan(before: String, after: String) -> ReflowSpan {
        let a = units(before), b = units(after)
        var start = 0
        while start < a.count, start < b.count, a[start] == b[start] { start += 1 }
        var tail = 0
        while tail < a.count - start, tail < b.count - start, a[a.count - 1 - tail] == b[b.count - 1 - tail] { tail += 1 }
        return ReflowSpan(start: start, end: a.count - tail, insert: string(b[start..<(b.count - tail)]))
    }
}
