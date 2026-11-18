import Foundation

/// A note's block structure as lezer reads it: a port of the part of @lezer/markdown 1.8.1's block parser (`BlockContext`, its block parsers and the
/// `skipContextMarkup` handlers) that decides where quotes, lists and list items begin and end, with the desktop's Markdown language (CommonMark and GFM).
/// `ListContinuation` reads it, because the desktop's list keys read lezer's tree, and where lezer ends an item or a quote is not where cmark (swift-markdown)
/// ends it. Leaf blocks are kept whole and opaque (a paragraph, a heading, a code block, an HTML block), except that a fenced code block and an HTML block
/// are told apart; inline syntax is not parsed, apart from finding HTML tags in a paragraph (`htmlCovers`). GFM tables and link reference definitions are
/// not recognised: they are leaf blocks either way, and only the lines they would take from a paragraph after them could differ.
enum MarkdownBlocks {
    enum NodeType: Equatable {
        case document, blockquote, bulletList, orderedList, listItem, quoteMark, listMark
        case fencedCode, codeBlock, htmlBlock, commentBlock, processingBlock, leaf

        var isMark: Bool { self == .quoteMark || self == .listMark }
        var isComposite: Bool { [.document, .blockquote, .bulletList, .orderedList, .listItem].contains(self) }
        /// Inline syntax is parsed in it (where HTML tags are found).
        var isInlineLeaf: Bool { self == .leaf }
    }

    final class Node {
        let type: NodeType
        let from: Int
        var to: Int
        var children: [Node] = []
        weak var parent: Node?

        init(_ type: NodeType, from: Int, to: Int) {
            (self.type, self.from, self.to) = (type, from, to)
        }

        var nextSibling: Node? {
            guard let parent, let index = parent.children.firstIndex(where: { $0 === self }), index + 1 < parent.children.count else { return nil }
            return parent.children[index + 1]
        }

        /// lezer's `childBefore`: the last child that starts before `pos`.
        func childBefore(_ pos: Int) -> Node? { children.last { $0.from < pos } }

        /// lezer's `getChild("ListItem", "ListItem")`: the first item after the first item.
        var secondItem: Node? {
            guard let first = children.firstIndex(where: { $0.type == .listItem }) else { return nil }
            return children[(first + 1)...].first { $0.type == .listItem }
        }

        /// The innermost node that holds `pos`, a node ending there included and one starting there not (lezer's `resolveInner(pos, -1)`).
        func resolveInner(_ pos: Int) -> Node {
            var node = self
            while let child = node.children.last(where: { $0.from < pos && $0.to >= pos }) { node = child }
            return node
        }

        /// A list with a blank line between its first two items (the desktop's `nonTightList`).
        func isLooseList(_ doc: Doc) -> Bool {
            guard type == .bulletList || type == .orderedList, let first = children.first, let second = secondItem else { return false }
            let line1 = doc.lineAt(first.to), line2 = doc.lineAt(second.from)
            let empty = line1.text.allSatisfy { isJSSpace($0) || $0 == 0x3E }
            return line1.number + (empty ? 0 : 1) < line2.number
        }

        /// The document's HTML (blocks, comment blocks and, in paragraphs and headings, tags), which the desktop parses as HTML: there the Markdown
        /// language is not active. `side` -1 asks about the place just before `pos` (an HTML node ending at `pos` counts); 0 asks whether it is HTML
        /// on both sides (strictly inside).
        var html: [Range<Int>] = []

        func htmlCovers(_ pos: Int, side: Int) -> Bool {
            html.contains { side < 0 ? $0.lowerBound < pos && pos <= $0.upperBound : $0.lowerBound < pos && pos < $0.upperBound }
        }
    }

    // MARK: Parsing

    static func parse(_ units: [UInt16]) -> Node {
        let context = BlockContext(units)
        let document = context.run()
        var html: [Range<Int>] = []
        func collect(_ node: Node) {
            switch node.type {
            case .htmlBlock, .commentBlock: html.append(node.from..<node.to)
            case .leaf: html += InlineHTMLTags.find(in: units, from: node.from, to: node.to)
            default: break
            }
            node.children.forEach(collect)
        }
        collect(document)
        document.html = html
        return document
    }

    /// A mark on a line that a container's markup skipped (a `>`): it goes to the block that is innermost when the line is read.
    struct Mark {
        let type: NodeType
        let from: Int
        let to: Int
    }

    /// A container being parsed (lezer's `CompositeBlock`).
    final class Composite {
        let type: NodeType
        /// A list item's indentation, a list's marker character.
        let value: Int
        let from: Int
        var end: Int
        var children: [Node] = []
        var blankFirstLine = false

        init(_ type: NodeType, value: Int, from: Int, end: Int) {
            (self.type, self.value, self.from, self.end) = (type, value, from, end)
        }

        func toNode(end: Int? = nil) -> Node {
            var to = end ?? self.end
            if let last = children.last { to = max(to, last.to) }
            let node = Node(type, from: from, to: to)
            node.children = children
            for child in children { child.parent = node }
            return node
        }
    }

    /// lezer's `Line`.
    final class Line {
        var text: [UInt16] = []
        var baseIndent = 0
        var basePos = 0
        var depth = 0
        var markers: [Mark] = []
        var pos = 0
        var indent = 0
        var next = -1

        func forward() { if basePos > pos { forwardInner() } }

        func forwardInner() {
            let newPos = skipSpace(basePos)
            indent = countIndent(newPos, pos, indent)
            pos = newPos
            next = newPos == text.count ? -1 : Int(text[newPos])
        }

        func skipSpace(_ from: Int) -> Int { MarkdownBlocks.skipSpace(text, from) }

        func reset(_ text: [UInt16]) {
            self.text = text
            baseIndent = 0; basePos = 0; pos = 0; indent = 0
            forwardInner()
            depth = 1
            markers.removeAll()
        }

        func moveBase(_ to: Int) {
            basePos = to
            baseIndent = countIndent(to, pos, indent)
        }

        func moveBaseColumn(_ indent: Int) {
            baseIndent = indent
            basePos = findColumn(indent)
        }

        func countIndent(_ to: Int, _ from: Int = 0, _ indent: Int = 0) -> Int {
            var indent = indent
            var i = from
            while i < to {
                indent += i < text.count && text[i] == 0x09 ? 4 - indent % 4 : 1
                i += 1
            }
            return indent
        }

        func findColumn(_ goal: Int) -> Int {
            var i = 0, indent = 0
            while i < text.count, indent < goal {
                indent += text[i] == 0x09 ? 4 - indent % 4 : 1
                i += 1
            }
            return i
        }

        func char(_ i: Int) -> Int { i >= 0 && i < text.count ? Int(text[i]) : -1 }
    }

    static func space(_ ch: Int) -> Bool { ch == 32 || ch == 9 || ch == 10 || ch == 13 }

    static func skipSpace(_ text: [UInt16], _ from: Int) -> Int {
        var i = from
        while i < text.count, space(Int(text[i])) { i += 1 }
        return i
    }

    // MARK: Block starts

    static func isFencedCode(_ line: Line) -> Int {
        guard line.next == 96 || line.next == 126 else { return -1 }
        var pos = line.pos + 1
        while pos < line.text.count, Int(line.text[pos]) == line.next { pos += 1 }
        if pos < line.pos + 3 { return -1 }
        if line.next == 96 { for i in pos..<line.text.count where line.text[i] == 96 { return -1 } }
        return pos
    }

    static func isBlockquote(_ line: Line) -> Int {
        line.next != 62 ? -1 : line.char(line.pos + 1) == 32 ? 2 : 1
    }

    static func isHorizontalRule(_ line: Line, _ cx: BlockContext, _ breaking: Bool) -> Int {
        guard line.next == 42 || line.next == 45 || line.next == 95 else { return -1 }
        var count = 1
        for pos in (line.pos + 1)..<max(line.pos + 1, line.text.count) {
            let ch = Int(line.text[pos])
            if ch == line.next { count += 1 } else if !space(ch) { return -1 }
        }
        // Setext headings take precedence.
        if breaking && line.next == 45 && isSetextUnderline(line) > -1 && line.depth == cx.stack.count { return -1 }
        return count < 3 ? -1 : 1
    }

    static func inList(_ cx: BlockContext, _ type: NodeType) -> Bool { cx.stack.contains { $0.type == type } }

    static func isBulletList(_ line: Line, _ cx: BlockContext, _ breaking: Bool) -> Int {
        (line.next == 45 || line.next == 43 || line.next == 42)
            && (line.pos == line.text.count - 1 || space(line.char(line.pos + 1)))
            && (!breaking || inList(cx, .bulletList) || line.skipSpace(line.pos + 2) < line.text.count) ? 1 : -1
    }

    static func isOrderedList(_ line: Line, _ cx: BlockContext, _ breaking: Bool) -> Int {
        var pos = line.pos, next = line.next
        while next >= 48 && next <= 57 {
            pos += 1
            if pos == line.text.count { return -1 }
            next = Int(line.text[pos])
        }
        if pos == line.pos || pos > line.pos + 9 || (next != 46 && next != 41)
            || (pos < line.text.count - 1 && !space(line.char(pos + 1)))
            || breaking && !inList(cx, .orderedList) && (line.skipSpace(pos + 1) == line.text.count || pos > line.pos + 1 || line.next != 49) {
            return -1
        }
        return pos + 1 - line.pos
    }

    static func isAtxHeading(_ line: Line) -> Int {
        guard line.next == 35 else { return -1 }
        var pos = line.pos + 1
        while pos < line.text.count, line.text[pos] == 35 { pos += 1 }
        if pos < line.text.count && !space(Int(line.text[pos])) { return -1 }
        let size = pos - line.pos
        return size > 6 ? -1 : size
    }

    static func isSetextUnderline(_ line: Line) -> Int {
        guard line.next == 45 || line.next == 61, line.indent < line.baseIndent + 4 else { return -1 }
        var pos = line.pos + 1
        while pos < line.text.count, Int(line.text[pos]) == line.next { pos += 1 }
        let end = pos
        while pos < line.text.count, space(Int(line.text[pos])) { pos += 1 }
        return pos == line.text.count ? end : -1
    }

    private static func regex(_ pattern: String) -> NSRegularExpression {
        try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    private static let emptyLine = try! NSRegularExpression(pattern: "^[ \\t]*$")
    private static let commentEnd = try! NSRegularExpression(pattern: "-->")
    private static let processingEnd = try! NSRegularExpression(pattern: "\\?>")

    /// lezer's `HTMLBlockStyle`: how each kind of HTML block starts and what ends it.
    private static let htmlBlockStyles: [(start: NSRegularExpression, end: NSRegularExpression)] = [
        (regex("^<(?:script|pre|style|textarea)(?:\\s|>|$)"), regex("</(?:script|pre|style|textarea)>")),
        (regex("^\\s*<!--"), commentEnd),
        (regex("^\\s*<\\?"), processingEnd),
        (try! NSRegularExpression(pattern: "^\\s*<![A-Z]"), try! NSRegularExpression(pattern: ">")),
        (regex("^\\s*<!\\[CDATA\\["), regex("\\]\\]>")),
        (regex(
            "^\\s*</?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\\s|/?>|$)"
        ), emptyLine),
        (regex(
            "^\\s*(?:</[a-z][A-Za-z0-9_-]*\\s*>|<[a-z][A-Za-z0-9_-]*(\\s+[a-z:_][A-Za-z0-9_.-]*(?:\\s*=\\s*(?:[^\\s\"'=<>`]+|'[^']*'|\"[^\"]*\"))?)*\\s*>)\\s*$"
        ), emptyLine),
    ]

    static func test(_ expression: NSRegularExpression, _ units: [UInt16]) -> Bool {
        let string = String(decoding: units, as: UTF16.self) as NSString
        return expression.firstMatch(in: string as String, range: NSRange(location: 0, length: string.length)) != nil
    }

    static func isHTMLBlock(_ line: Line, _ breaking: Bool) -> Int {
        guard line.next == 60 else { return -1 }
        let rest = Array(line.text[line.pos...])
        let count = htmlBlockStyles.count - (breaking ? 1 : 0)
        for i in 0..<count where test(htmlBlockStyles[i].start, rest) { return i }
        return -1
    }

    static func getListIndent(_ line: Line, _ pos: Int) -> Int {
        let indentAfter = line.countIndent(pos, line.pos, line.indent)
        let skipped = line.skipSpace(pos)
        let indented = line.countIndent(skipped, pos, indentAfter)
        return indented >= indentAfter + 5 || skipped == line.text.count ? indentAfter + 1 : indented
    }

    // MARK: The parse

    /// lezer's `BlockContext`, for one whole text.
    final class BlockContext {
        let units: [UInt16]
        let to: Int
        let line = Line()
        var atEnd = false
        var lineStart = 0
        var absoluteLineEnd = 0
        var stack: [Composite]
        var block: Composite { stack[stack.count - 1] }

        init(_ units: [UInt16]) {
            self.units = units
            to = units.count
            stack = [Composite(.document, value: 0, from: 0, end: 0)]
            readLine()
        }

        func run() -> Node {
            while true { if let done = advance() { return done } }
        }

        private func prevLineEnd() -> Int { atEnd ? lineStart : lineStart - 1 }

        private func scanLine(_ start: Int) -> (text: [UInt16], end: Int) {
            if start >= to { return ([], start) }
            var end = start
            while end < to, units[end] != 0x0A { end += 1 }
            return (Array(units[start..<end]), end)
        }

        private func readLine() {
            let (text, end) = scanLine(lineStart)
            absoluteLineEnd = end
            line.reset(text)
            while line.depth < stack.count {
                let cx = stack[line.depth]
                let marks = line.markers.count
                if !skipMarkup(cx) {
                    if line.markers.count > marks { cx.end = line.markers[line.markers.count - 1].to }
                    line.forward()
                    break
                }
                line.forward()
                line.depth += 1
            }
        }

        @discardableResult
        private func nextLine() -> Bool {
            lineStart += line.text.count
            if absoluteLineEnd >= to {
                atEnd = true
                readLine()
                return false
            }
            lineStart += 1
            readLine()
            return true
        }

        /// lezer's `DefaultSkipMarkup`: whether the line carries on the container `bl`, moving past its markup.
        private func skipMarkup(_ bl: Composite) -> Bool {
            switch bl.type {
            case .blockquote:
                guard line.next == 62 else { return false }
                line.markers.append(Mark(type: .quoteMark, from: lineStart + line.pos, to: lineStart + line.pos + 1))
                line.moveBase(line.pos + (MarkdownBlocks.space(line.char(line.pos + 1)) ? 2 : 1))
                bl.end = lineStart + line.text.count
                return true
            case .listItem:
                if line.next < 0 ? bl.blankFirstLine && bl.children.count == 1 : line.indent < line.baseIndent + bl.value { return false }
                line.moveBaseColumn(line.baseIndent + bl.value)
                return true
            case .bulletList, .orderedList:
                if line.pos == line.text.count || (bl !== block && line.indent >= stack[line.depth + 1].value + line.baseIndent) { return true }
                if line.indent >= line.baseIndent + 4 { return false }
                let size = bl.type == .orderedList ? isOrderedList(line, self, false) : isBulletList(line, self, false)
                return size > 0 && (bl.type != .bulletList || isHorizontalRule(line, self, false) < 0) && line.char(line.pos + size - 1) == bl.value
            default:
                return true
            }
        }

        private func startContext(_ type: NodeType, _ start: Int, _ value: Int = 0) {
            stack.append(Composite(type, value: value, from: lineStart + start, end: lineStart + line.text.count))
        }

        private func addNode(_ type: NodeType, _ from: Int, _ to: Int? = nil) {
            block.children.append(Node(type, from: from, to: to ?? prevLineEnd()))
        }

        private func finishContext() {
            let cx = stack.removeLast()
            block.children.append(cx.toNode())
        }

        private func finish() -> Node {
            while stack.count > 1 { finishContext() }
            return block.toNode(end: lineStart)
        }

        /// One step: a block, or the blank lines before one. The document when the text is done.
        private func advance() -> Node? {
            while true {
                var markI = 0
                while true {
                    let next = line.depth < stack.count ? stack[stack.count - 1] : nil
                    while markI < line.markers.count, next == nil || line.markers[markI].from < next!.end {
                        let mark = line.markers[markI]
                        markI += 1
                        addNode(mark.type, mark.from, mark.to)
                    }
                    if next == nil { break }
                    finishContext()
                }
                if line.pos < line.text.count { break }
                // An empty line.
                if !nextLine() { return finish() }
            }

            start: while true {
                for parser in [indentedCode, fencedCode, blockquote, horizontalRule, bulletList, orderedList, atxHeading, htmlBlock] {
                    if let result = parser() {
                        if result { return nil }
                        continue
                    }
                    // A container was opened: look for more on the rest of the line.
                    line.forward()
                    continue start
                }
                break
            }
            if line.pos == line.text.count { return nextLine() ? nil : finish() }

            // A paragraph (or a setext heading), with the lines that carry it on.
            let leafStart = lineStart + line.pos
            var leafEnd = lineStart + line.text.count
            lines: while nextLine() {
                if line.pos == line.text.count { break }
                if line.indent < line.baseIndent + 4 {
                    if isAtxHeading(line) >= 0 || isFencedCode(line) >= 0 || isBlockquote(line) >= 0 || isBulletList(line, self, true) >= 0
                        || isOrderedList(line, self, true) >= 0 || isHorizontalRule(line, self, true) >= 0 || isHTMLBlock(line, true) >= 0 {
                        break lines
                    }
                }
                if line.depth >= stack.count, isSetextUnderline(line) >= 0 {
                    nextLine()
                    addNode(.leaf, leafStart, prevLineEnd())
                    return nil
                }
                leafEnd = lineStart + line.text.count
            }
            addNode(.leaf, leafStart, leafEnd)
            return nil
        }

        // Each answers nil when it opened a container, true when it took a leaf block, false when the line is not its kind.

        private func indentedCode() -> Bool? {
            let base = line.baseIndent + 4
            guard line.indent >= base else { return false }
            let from = lineStart + line.findColumn(base)
            var to = lineStart + line.text.count
            var pending: [Mark] = []
            while nextLine() && line.depth >= stack.count {
                if line.pos == line.text.count {
                    pending += line.markers
                } else if line.indent < base {
                    break
                } else {
                    pending = []
                    to = lineStart + line.text.count
                }
            }
            if !pending.isEmpty { line.markers = pending + line.markers }
            addNode(.codeBlock, from, to)
            return true
        }

        private func fencedCode() -> Bool? {
            let fenceEnd = isFencedCode(line)
            guard fenceEnd >= 0 else { return false }
            let from = lineStart + line.pos, ch = line.next, length = fenceEnd - line.pos
            while nextLine() && line.depth >= stack.count {
                var i = line.pos
                if line.indent - line.baseIndent < 4 { while i < line.text.count, Int(line.text[i]) == ch { i += 1 } }
                if i - line.pos >= length && line.skipSpace(i) == line.text.count {
                    nextLine()
                    break
                }
            }
            addNode(.fencedCode, from)
            return true
        }

        private func blockquote() -> Bool? {
            let size = isBlockquote(line)
            guard size >= 0 else { return false }
            startContext(.blockquote, line.pos)
            addNode(.quoteMark, lineStart + line.pos, lineStart + line.pos + 1)
            line.moveBase(line.pos + size)
            return nil
        }

        private func horizontalRule() -> Bool? {
            guard isHorizontalRule(line, self, false) >= 0 else { return false }
            let from = lineStart + line.pos
            nextLine()
            addNode(.leaf, from)
            return true
        }

        private func bulletList() -> Bool? {
            let size = isBulletList(line, self, false)
            guard size >= 0 else { return false }
            if block.type != .bulletList { startContext(.bulletList, line.basePos, line.next) }
            let newBase = getListIndent(line, line.pos + 1)
            startContext(.listItem, line.basePos, newBase - line.baseIndent)
            addNode(.listMark, lineStart + line.pos, lineStart + line.pos + size)
            line.moveBaseColumn(newBase)
            block.blankFirstLine = newBase >= line.text.count
            return nil
        }

        private func orderedList() -> Bool? {
            let size = isOrderedList(line, self, false)
            guard size >= 0 else { return false }
            if block.type != .orderedList { startContext(.orderedList, line.basePos, Int(line.text[line.pos + size - 1])) }
            let newBase = getListIndent(line, line.pos + size)
            startContext(.listItem, line.basePos, newBase - line.baseIndent)
            addNode(.listMark, lineStart + line.pos, lineStart + line.pos + size)
            line.moveBaseColumn(newBase)
            block.blankFirstLine = newBase == line.text.count
            return nil
        }

        private func atxHeading() -> Bool? {
            guard isAtxHeading(line) >= 0 else { return false }
            let from = lineStart + line.pos
            let to = lineStart + line.text.count
            nextLine()
            addNode(.leaf, from, to)
            return true
        }

        private func htmlBlock() -> Bool? {
            let type = isHTMLBlock(line, false)
            guard type >= 0 else { return false }
            let from = lineStart + line.pos, end = htmlBlockStyles[type].end
            var trailing = end !== emptyLine
            while !test(end, line.text) && nextLine() {
                if line.depth < stack.count {
                    trailing = false
                    break
                }
            }
            if trailing { nextLine() }
            addNode(end === commentEnd ? .commentBlock : end === processingEnd ? .processingBlock : .htmlBlock, from)
            return true
        }
    }
}

/// The HTML tags in a paragraph, as lezer's inline `HTMLTag` parser finds them: past backslash escapes and code spans, and not an autolink, a comment or a
/// processing instruction (which the desktop does not hand to its HTML parser).
enum InlineHTMLTags {
    private static let autolink = try! NSRegularExpression(
        pattern: "^(?:[a-z][-A-Za-z0-9_+.]+:[^\\s>]+|[a-z\\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\\d](?:[a-z\\d-]{0,61}[a-z\\d])?(?:\\.[a-z\\d](?:[a-z\\d-]{0,61}[a-z\\d])?)*)>",
        options: [.caseInsensitive])
    private static let comment = try! NSRegularExpression(pattern: "^!--(?:-?>|[\\s\\S]*?-->)")
    private static let processing = try! NSRegularExpression(pattern: "^\\?[\\s\\S]*?\\?>")
    private static let tag = try! NSRegularExpression(
        pattern: "^(?:![A-Z][\\s\\S]*?>|!\\[CDATA\\[[\\s\\S]*?\\]\\]>|/[a-zA-Z][A-Za-z0-9_-]*\\s*>|[a-zA-Z][A-Za-z0-9_-]*(\\s+[a-zA-Z:_][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:[^\\s\"'=<>`]+|'[^']*'|\"[^\"]*\"))?)*\\s*/?>)")

    static func find(in units: [UInt16], from: Int, to: Int) -> [Range<Int>] {
        guard units[from..<to].contains(0x3C) else { return [] }
        var found: [Range<Int>] = []
        var i = from
        while i < to {
            let ch = units[i]
            if ch == 0x5C { i += 2; continue }  // an escape
            if ch == 0x60 {  // a code span: a run of backticks, to the next run as long
                var run = i
                while run < to, units[run] == 0x60 { run += 1 }
                let size = run - i
                var j = run, close = -1
                while j < to {
                    if units[j] == 0x60 {
                        var k = j
                        while k < to, units[k] == 0x60 { k += 1 }
                        if k - j == size { close = k; break }
                        j = k
                    } else {
                        j += 1
                    }
                }
                i = close >= 0 ? close : run
                continue
            }
            if ch == 0x3C, i < to - 1 {
                let after = String(decoding: units[(i + 1)..<to], as: UTF16.self)
                let range = NSRange(location: 0, length: (after as NSString).length)
                if let m = autolink.firstMatch(in: after, range: range) { i += 1 + m.range.length; continue }
                if let m = comment.firstMatch(in: after, range: range) { i += 1 + m.range.length; continue }
                if let m = processing.firstMatch(in: after, range: range) { i += 1 + m.range.length; continue }
                if let m = tag.firstMatch(in: after, range: range) {
                    found.append(i..<(i + 1 + m.range.length))
                    i += 1 + m.range.length
                    continue
                }
            }
            i += 1
        }
        return found
    }
}
