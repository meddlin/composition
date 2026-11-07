import Foundation

/// An edit to whole lines of a note: `[start, end)` of the text is swapped for `text`, and the selection afterwards is `selection` (the desktop's
/// `IndentEdit`). Offsets are UTF-16 units.
public struct LineEdit: Equatable, Sendable {
    public var start: Int
    public var end: Int
    public var text: String
    public var selection: Range<Int>

    public init(start: Int, end: Int, text: String, selection: Range<Int>) {
        (self.start, self.end, self.text, self.selection) = (start, end, text, selection)
    }
}

/// Indenting and outdenting the lines under the selection, the way a code editor does: a port of `indentLines.ts`.
public enum IndentLines {
    public enum Command: String, Sendable { case indent, outdent }

    /// The width of the leading spaces one outdent takes off a line that is indented with spaces, not a tab.
    private static let spaceIndent = 4

    /// How many characters an outdent takes off the front of `line`: a tab, or up to four spaces.
    private static func outdentWidth(_ line: [UInt16]) -> Int {
        if line.first == 0x09 { return 1 }
        var width = 0
        while width < spaceIndent, width < line.count, line[width] == 0x20 { width += 1 }
        return width
    }

    /// Indents or outdents every line the selection touches: a selection that ends at the very start of a line does not touch that line, an empty
    /// line is not indented, and the selection stays on the same text. Nil when nothing would change.
    public static func edit(_ text: String, from: Int, to: Int, command: Command) -> LineEdit? {
        let units = Array(text.utf16)
        func lastNewline(atOrBefore index: Int) -> Int {
            var i = min(max(index, 0), units.count - 1)
            while i >= 0 { if units[i] == 0x0A { return i }; i -= 1 }
            return -1
        }
        let start = lastNewline(atOrBefore: from - 1) + 1
        let lastChar = to > from && to - 1 < units.count && units[to - 1] == 0x0A ? to - 1 : to
        var found = -1
        var scan = max(lastChar, 0)
        while scan < units.count { if units[scan] == 0x0A { found = scan; break }; scan += 1 }
        let end = found == -1 ? units.count : found

        // Each line, and by how much its front grows (or, below zero, shrinks).
        var lines: [(offset: Int, delta: Int, line: [UInt16])] = []
        var offset = start
        let slice = start >= end ? [] : Array(units[start..<end])
        for line in slice.split(separator: 0x0A, omittingEmptySubsequences: false).map(Array.init) {
            let delta = command == .indent ? (line.isEmpty ? 0 : 1) : -outdentWidth(line)
            lines.append((offset, delta, line))
            offset += line.count + 1
        }
        if slice.isEmpty && lines.isEmpty { lines.append((start, 0, [])) }
        if lines.allSatisfy({ $0.delta == 0 }) { return nil }

        var out: [UInt16] = []
        for (index, item) in lines.enumerated() {
            if index > 0 { out.append(0x0A) }
            if item.delta > 0 { out.append(0x09); out.append(contentsOf: item.line) } else { out.append(contentsOf: item.line.dropFirst(-item.delta)) }
        }

        // Where a position of the old text lands: past the edits before it, and (for a caret inside the front of a line that lost it) no further back
        // than the line's start. A position at a line's start stays there on indent.
        func move(_ position: Int) -> Int {
            var shift = 0
            for item in lines {
                if position < item.offset { break }
                let column = position - item.offset
                if position > item.offset + item.line.count { shift += item.delta } else { shift += item.delta > 0 ? (column > 0 ? item.delta : 0) : max(item.delta, -column) }
            }
            return position + shift
        }
        return LineEdit(start: start, end: end, text: String(decoding: out, as: UTF16.self), selection: move(from)..<move(to))
    }
}
