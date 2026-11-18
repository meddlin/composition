import Foundation

/// Return continues a list or a quote, and Backspace just after an item's marker takes the marker away: the desktop's Markdown keys, CodeMirror's
/// `insertNewlineContinueMarkup` and `deleteMarkupBackward` (@codemirror/lang-markdown 6.5.2), ported to answer a `LineEdit` (docs/ipad-live-default-plan.md,
/// Step 4). Both read the note's block structure as lezer reads it (`MarkdownBlocks`, a port of the part of @lezer/markdown's block parser they look at),
/// since which marks they write depends on where lezer's list items and quotes begin and end. Nil where the desktop's command declines, and the key then does
/// what it always does. Offsets are UTF-16 units; the note's lines end in `\n`.
///
/// What it does, as the desktop does it:
/// - Return at the end of an item (or in its text) breaks the line and writes the next item's marker: the same bullet, the next number with the same delimiter
///   (the numbers after it go up by one), `- [ ] ` for a task, `> ` for a quote, with the marks of what holds it (a quote around a list, a list around a list)
///   kept and the indentation too. Spaces before the caret are taken off the line it leaves.
/// - Return on an empty item takes its marker off: the list ends, or a nested item moves out to the list that holds it. On the second item of a list whose two
///   items are tight, the desktop first puts a blank line before the item instead (the list becomes loose); Return again then ends it.
/// - Return on an empty quote line after another empty one ends the quote; on the first it writes another `>`.
/// - Backspace just after an item's marker turns the marker into spaces (a further Backspace takes the spaces): an empty item goes, and an item with text
///   becomes a further line of the item above. Just after a quote's `> ` it takes the `> ` off.
public enum ListContinuation {
    /// Return with the caret at `caret`.
    public static func newline(_ text: String, at caret: Int) -> LineEdit? {
        let doc = Doc(text)
        guard caret >= 0, caret <= doc.units.count else { return nil }
        let tree = MarkdownBlocks.parse(doc.units)
        return Commands(doc: doc, tree: tree).newline(at: caret)
    }

    /// Backspace with the caret at `caret` and nothing selected.
    public static func deleteBackward(_ text: String, at caret: Int) -> LineEdit? {
        let doc = Doc(text)
        guard caret > 0, caret <= doc.units.count else { return nil }
        // The command only ever acts just after a space or the last character of a marker; most Backspaces are elsewhere, and are not worth a parse.
        let before = doc.units[caret - 1]
        guard isJSSpace(before) || [0x3E, 0x2D, 0x2B, 0x2A, 0x2E, 0x29, 0x5D].contains(before) else { return nil }
        let tree = MarkdownBlocks.parse(doc.units)
        return Commands(doc: doc, tree: tree).deleteBackward(at: caret)
    }
}

// MARK: - The text

/// The note's text as UTF-16 units, with its lines (CodeMirror's `doc.lineAt`).
struct Doc {
    struct Line {
        let number: Int  // from 1
        let from: Int
        let to: Int
        let text: [UInt16]
    }

    let units: [UInt16]
    /// Where each line starts.
    let starts: [Int]

    init(_ text: String) {
        units = Array(text.utf16)
        var starts = [0]
        for (index, unit) in units.enumerated() where unit == 0x0A { starts.append(index + 1) }
        self.starts = starts
    }

    func lineAt(_ position: Int) -> Line {
        var low = 0, high = starts.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if starts[mid] <= position { low = mid } else { high = mid - 1 }
        }
        let from = starts[low]
        let to = low + 1 < starts.count ? starts[low + 1] - 1 : units.count
        return Line(number: low + 1, from: from, to: to, text: Array(units[from..<to]))
    }

    func slice(_ from: Int, _ to: Int) -> [UInt16] {
        let a = max(0, min(from, units.count)), b = max(a, min(to, units.count))
        return Array(units[a..<b])
    }
}

/// JavaScript's `\s`.
func isJSSpace(_ unit: UInt16) -> Bool {
    switch unit {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
}

/// `string.slice(from, to)` as JavaScript does it on UTF-16 units: clamped, and empty when `to` is not past `from`.
private func jsSlice(_ units: [UInt16], _ from: Int, _ to: Int? = nil) -> [UInt16] {
    let a = max(0, min(from, units.count)), b = max(0, min(to ?? units.count, units.count))
    return a < b ? Array(units[a..<b]) : []
}

private func utf16(_ string: String) -> [UInt16] { Array(string.utf16) }

/// CodeMirror's `countColumn(string, tabSize, to)`: columns up to `to`, a tab reaching the next multiple of `tabSize`, a cluster (an emoji) counting one.
private func countColumn(_ units: [UInt16], _ tabSize: Int, _ to: Int) -> Int {
    var n = 0, i = 0
    while i < to {
        if i < units.count, units[i] == 0x09 {
            n += tabSize - n % tabSize
            i += 1
        } else {
            n += 1
            i = nextClusterBreak(units, i)
        }
    }
    return n
}

/// Where the grapheme cluster starting at `i` ends (one unit past the end of the text).
private func nextClusterBreak(_ units: [UInt16], _ i: Int) -> Int {
    guard i < units.count else { return i + 1 }
    let string = String(decoding: units, as: UTF16.self)
    let utf16View = string.utf16
    guard let index = utf16View.index(utf16View.startIndex, offsetBy: i, limitedBy: utf16View.endIndex),
          let start = index.samePosition(in: string)
    else { return i + 1 }
    let next = string.index(after: start)
    return utf16View.distance(from: utf16View.startIndex, to: next)
}

// MARK: - The commands

private struct Commands {
    let doc: Doc
    let tree: MarkdownBlocks.Node

    /// A level of list or quote markup on a line (the desktop's `Context`): the columns are on the line where its node starts.
    struct Context {
        let node: MarkdownBlocks.Node  // the quote, or the list for a list item
        let from: Int
        let to: Int
        let spaceBefore: [UInt16]
        let spaceAfter: [UInt16]
        let type: [UInt16]
        let item: MarkdownBlocks.Node?

        func blank(_ maxWidth: Int?, trailing: Bool = true) -> [UInt16] {
            var result = spaceBefore + (node.type == .blockquote ? [0x3E] : [])
            if let maxWidth {
                while result.count < maxWidth { result.append(0x20) }
                return result
            }
            var i = to - from - result.count - spaceAfter.count
            while i > 0 { result.append(0x20); i -= 1 }
            return result + (trailing ? spaceAfter : [])
        }

        func marker(_ doc: Doc, add: Int) -> [UInt16] {
            var number: [UInt16] = []
            if node.type == .orderedList, let item, let found = itemNumber(item, doc) { number = utf16(String(found.number + add)) }
            return spaceBefore + number + type + spaceAfter
        }
    }

    /// The item's number, and the lengths of the space before it and of the space and the number: `/^(\s*)(\d+)(?=[.)])/` over its first ten characters.
    static func itemNumber(_ item: MarkdownBlocks.Node, _ doc: Doc) -> (space: Int, end: Int, number: Int)? {
        let text = doc.slice(item.from, item.from + 10)
        var i = 0
        while i < text.count, isJSSpace(text[i]) { i += 1 }
        let digits = i
        while i < text.count, (0x30...0x39).contains(text[i]) { i += 1 }
        guard i > digits, i < text.count, text[i] == 0x2E || text[i] == 0x29 else { return nil }
        let number = Int(String(decoding: text[digits..<i], as: UTF16.self)) ?? 0
        return (digits, i, number)
    }

    private func itemNumber(_ item: MarkdownBlocks.Node, _ doc: Doc) -> (space: Int, end: Int, number: Int)? { Self.itemNumber(item, doc) }

    /// The levels of markup around `node`, outermost first; none inside a fenced code block (the desktop's `getContext`).
    func context(of node: MarkdownBlocks.Node) -> [Context] {
        var nodes: [MarkdownBlocks.Node] = []
        var current: MarkdownBlocks.Node? = node
        while let cur = current {
            if cur.type == .fencedCode { return [] }
            if cur.type == .listItem || cur.type == .blockquote { nodes.append(cur) }
            current = cur.parent
        }
        var context: [Context] = []
        for node in nodes.reversed() {
            let line = doc.lineAt(node.from)
            let startPos = node.from - line.from
            let rest = jsSlice(line.text, startPos)
            if node.type == .blockquote, let match = Self.quoteMatch(rest) {
                context.append(Context(node: node, from: startPos, to: startPos + match.length, spaceBefore: [], spaceAfter: match.after, type: [0x3E], item: nil))
            } else if node.type == .listItem, let parent = node.parent, parent.type == .orderedList, let match = Self.orderedMatch(rest) {
                var after = match.after, length = match.length
                if after.count >= 4 { after = Array(after.dropLast(4)); length -= 4 }
                context.append(Context(node: parent, from: startPos, to: startPos + length, spaceBefore: match.before, spaceAfter: after, type: match.delimiter, item: node))
            } else if node.type == .listItem, let parent = node.parent, parent.type == .bulletList, let match = Self.bulletMatch(rest) {
                var after = match.after, length = match.length
                if after.count > 4 { after = Array(after.dropLast(4)); length -= 4 }
                context.append(Context(node: parent, from: startPos, to: startPos + length, spaceBefore: match.before, spaceAfter: after, type: match.type, item: node))
            }
        }
        return context
    }

    /// `/^ *>( ?)/`
    static func quoteMatch(_ s: [UInt16]) -> (length: Int, after: [UInt16])? {
        var i = 0
        while i < s.count, s[i] == 0x20 { i += 1 }
        guard i < s.count, s[i] == 0x3E else { return nil }
        i += 1
        if i < s.count, s[i] == 0x20 { return (i + 1, [0x20]) }
        return (i, [])
    }

    /// `/^( *)\d+([.)])( *)/`
    static func orderedMatch(_ s: [UInt16]) -> (length: Int, before: [UInt16], delimiter: [UInt16], after: [UInt16])? {
        var i = 0
        while i < s.count, s[i] == 0x20 { i += 1 }
        let before = Array(s[0..<i])
        let digits = i
        while i < s.count, (0x30...0x39).contains(s[i]) { i += 1 }
        guard i > digits, i < s.count, s[i] == 0x2E || s[i] == 0x29 else { return nil }
        let delimiter = [s[i]]
        i += 1
        let spaces = i
        while i < s.count, s[i] == 0x20 { i += 1 }
        return (i, before, delimiter, Array(s[spaces..<i]))
    }

    /// `/^( *)([-+*])( {1,4}\[[ xX]\])?( +)/`, with the task's box written unticked into the type.
    static func bulletMatch(_ s: [UInt16]) -> (length: Int, before: [UInt16], type: [UInt16], after: [UInt16])? {
        var i = 0
        while i < s.count, s[i] == 0x20 { i += 1 }
        let before = Array(s[0..<i])
        guard i < s.count, [0x2D, 0x2B, 0x2A].contains(s[i]) else { return nil }
        var type = [s[i]]
        i += 1
        // The optional box: one to four spaces and `[ ]`, `[x]` or `[X]`, taken only if spaces follow it (the regex backtracks otherwise).
        var j = i
        while j < s.count, j - i < 4, s[j] == 0x20 { j += 1 }
        if j > i, j + 3 <= s.count, s[j] == 0x5B, [0x20, 0x78, 0x58].contains(s[j + 1]), s[j + 2] == 0x5D, j + 3 < s.count, s[j + 3] == 0x20 {
            type += Array(s[i..<j]) + [0x5B, 0x20, 0x5D]
            i = j + 3
        }
        let spaces = i
        while i < s.count, s[i] == 0x20 { i += 1 }
        guard i > spaces else { return nil }
        return (i, before, type, Array(s[spaces..<i]))
    }

    // MARK: Return

    func newline(at pos: Int) -> LineEdit? {
        // The command is declined where the Markdown language is not active on either side: inside an HTML block or tag, which the desktop hands to its HTML parser.
        if tree.htmlCovers(pos, side: 0) { return nil }
        let line = doc.lineAt(pos)
        var context = context(of: tree.resolveInner(pos))
        while let last = context.last, last.from > pos - line.from { context.removeLast() }
        guard let inner = context.last else { return nil }
        if inner.to - inner.spaceAfter.count > pos - line.from { return nil }
        let emptyLine = pos >= inner.to - inner.spaceAfter.count && !jsSlice(line.text, inner.to).contains(where: { !isJSSpace($0) })

        // An empty item.
        if let item = inner.item, emptyLine {
            if item.from < line.from && !onlySpaceOrQuote(jsSlice(line.text, 0, inner.to)) { return nil }
            let first = inner.node.children.first
            let second = inner.node.secondItem
            let blankBefore = line.from > 0 && onlySpaceOrQuote(doc.lineAt(line.from - 1).text)
            if (first.map { $0.to >= pos } ?? false) || (second.map { $0.to < pos } ?? false) || blankBefore {
                // Not the second item, or a blank line before it: take a level of markup off.
                let next = context.count > 1 ? context[context.count - 2] : nil
                var delTo: Int
                var insert: [UInt16] = []
                if let next, next.item != nil {
                    delTo = line.from + next.from
                    insert = next.marker(doc, add: 1)
                } else {
                    delTo = line.from + (next?.to ?? 0)
                }
                var changes = [Change(from: delTo, to: pos, insert: insert)]
                if inner.node.type == .orderedList { renumber(after: item, into: &changes, offset: -2) }
                if let next, next.node.type == .orderedList, let nextItem = next.item { renumber(after: nextItem, into: &changes) }
                return edit(changes, caret: delTo + insert.count)
            } else {
                // Move the second item down, making a tight two-item list loose.
                let insert = blankLine(context, line)
                return edit([Change(from: line.from, to: line.from, insert: insert + [0x0A])], caret: pos + insert.count + 1)
            }
        }

        // Two aligned empty quote lines in a row end the quote.
        if inner.node.type == .blockquote, emptyLine, line.from > 0 {
            let previous = doc.lineAt(line.from - 1)
            var end = previous.text.count
            while end > 0, isJSSpace(previous.text[end - 1]) { end -= 1 }
            if end > 0, previous.text[end - 1] == 0x3E, end - 1 == inner.from {
                let first = Change(from: previous.from + end - 1, to: previous.to, insert: [])
                let second = Change(from: line.from + inner.from, to: line.to, insert: [])
                return edit([first, second], caret: second.from - (first.to - first.from))
            }
        }

        var changes: [Change] = []
        if inner.node.type == .orderedList, let item = inner.item { renumber(after: item, into: &changes) }
        let continued = inner.item.map { $0.from < line.from } ?? false
        var insert: [UInt16] = []
        // Unless the line is outdented from the item.
        if !continued || markupPrefixLength(line.text) >= inner.to {
            let e = context.count - 1
            for i in 0...e {
                insert += i == e && !continued
                    ? context[i].marker(doc, add: 1)
                    : context[i].blank(i < e ? countColumn(line.text, 4, context[i + 1].from) - insert.count : nil)
            }
        }
        var from = pos
        while from > line.from, isJSSpace(line.text[from - line.from - 1]) { from -= 1 }
        if inner.node.isLooseList(doc) { insert = blankLine(context, line) + [0x0A] + insert }
        changes.append(Change(from: from, to: pos, insert: [0x0A] + insert))
        return edit(changes, caret: from + insert.count + 1)
    }

    /// `/^[\s>]*$/`
    private func onlySpaceOrQuote(_ s: [UInt16]) -> Bool { s.allSatisfy { isJSSpace($0) || $0 == 0x3E } }

    /// The length of `/^[\s\d.)\-+*>]*/`.
    private func markupPrefixLength(_ s: [UInt16]) -> Int {
        var i = 0
        while i < s.count, isJSSpace(s[i]) || (0x30...0x39).contains(s[i]) || [0x2E, 0x29, 0x2D, 0x2B, 0x2A, 0x3E].contains(s[i]) { i += 1 }
        return i
    }

    /// The markup of the levels around an item for a blank line (the desktop's `blankLine`).
    private func blankLine(_ context: [Context], _ line: Doc.Line) -> [UInt16] {
        var insert: [UInt16] = []
        let e = context.count - 2
        guard e >= 0 else { return insert }
        for i in 0...e {
            insert += context[i].blank(i < e ? countColumn(line.text, 4, context[i + 1].from) - insert.count : nil, trailing: i < e)
        }
        return insert
    }

    /// The numbers of the items after `item` that follow on from it, moved on (the desktop's `renumberList`).
    private func renumber(after item: MarkdownBlocks.Node, into changes: inout [Change], offset: Int = 0) {
        var previous = -1
        var node: MarkdownBlocks.Node? = item
        while let current = node {
            if current.type == .listItem, let found = itemNumber(current, doc) {
                if previous >= 0 {
                    if found.number != previous + 1 { return }
                    changes.append(Change(from: current.from + found.space, to: current.from + found.end, insert: utf16(String(previous + 2 + offset))))
                }
                previous = found.number
            }
            node = current.nextSibling
        }
    }

    // MARK: Backspace

    func deleteBackward(at pos: Int) -> LineEdit? {
        if tree.htmlCovers(pos, side: -1) { return nil }
        let line = doc.lineAt(pos)
        let context = context(of: contextNodeForDelete(pos))
        guard let inner = context.last else { return nil }
        let column = pos - line.from
        let spaceEnd = inner.to - inner.spaceAfter.count + (inner.spaceAfter.isEmpty ? 0 : 1)
        // Extra space after the markup goes first.
        if column > spaceEnd && !jsSlice(line.text, spaceEnd, column).contains(where: { !isJSSpace($0) }) {
            return edit([Change(from: line.from + spaceEnd, to: pos, insert: [])], caret: line.from + spaceEnd)
        }
        // Only on the line that has the construct's markup, or where there is only indentation before it.
        guard column == spaceEnd, (inner.item.map { line.from <= $0.from } ?? false) || onlySpaceOrQuote(jsSlice(line.text, 0, inner.to)) else { return nil }
        let start = line.from + inner.from
        // A list item's marker becomes spaces.
        if let item = inner.item, inner.node.from < item.from, jsSlice(line.text, inner.from, inner.to).contains(where: { !isJSSpace($0) }) {
            let insert = inner.blank(countColumn(line.text, 4, inner.to) - countColumn(line.text, 4, inner.from))
            return edit([Change(from: start, to: line.from + inner.to, insert: insert)], caret: start + insert.count)
        }
        // Delete one level of indentation.
        if start < pos { return edit([Change(from: start, to: pos, insert: [])], caret: start) }
        return nil
    }

    /// The node whose markup Backspace at `pos` would delete (the desktop's `contextNodeForDelete`): past the marks just before it, and into the last item of a
    /// list that ends there.
    private func contextNodeForDelete(_ pos: Int) -> MarkdownBlocks.Node {
        var node = tree.resolveInner(pos)
        var scan = pos
        if node.type.isMark, let parent = node.parent {
            scan = node.from
            node = parent
        }
        while let previous = node.childBefore(scan) {
            if previous.type.isMark {
                scan = previous.from
            } else if previous.type == .bulletList || previous.type == .orderedList, let last = previous.children.last {
                node = last
                scan = last.to
            } else {
                break
            }
        }
        return node
    }

    // MARK: The edit

    struct Change {
        let from: Int
        let to: Int
        let insert: [UInt16]
    }

    /// The changes (in the old text, not overlapping) as one replacement from the first to the end of the last, and the caret afterwards.
    private func edit(_ changes: [Change], caret: Int) -> LineEdit {
        let sorted = changes.sorted { $0.from < $1.from }
        let start = sorted.first!.from, end = sorted.map(\.to).max()!
        var out: [UInt16] = []
        var at = start
        for change in sorted {
            out += doc.slice(at, change.from)
            out += change.insert
            at = change.to
        }
        out += doc.slice(at, end)
        return LineEdit(start: start, end: end, text: String(decoding: out, as: UTF16.self), selection: caret..<caret)
    }
}
