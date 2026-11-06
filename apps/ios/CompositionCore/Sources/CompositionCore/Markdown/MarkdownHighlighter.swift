import Foundation
import Markdown

// Syntax colours for the editor (spike S3, docs/ipad-app-design.md, "The editor"): where in a note's text a heading, bold, code, a
// link, a list marker, a component tag and so on are, as UTF-16 ranges a text view can put attributes on. It reads the note with
// swift-markdown and its source ranges, so it agrees with the preview about what is code and what is not. It knows nothing of UIKit.
//
// `.mark` is the syntax itself (`#`, `**`, backticks, `[` and `](url)`, `>`): what the Live tab would hide away from the caret.
// Spans come outermost first, a node's own span before its marks, so applying them in order lets the later one win.

public enum HighlightKind: Equatable, Sendable {
    case frontmatter
    case heading(level: Int)
    case strong
    case emphasis
    case strikethrough
    case inlineCode
    case codeBlock
    case linkText
    case quote
    case listMarker
    case rule
    /// A component tag (`<Info>`, `<Toc />`), or any raw HTML.
    case tag
    /// The syntax characters of the constructs above.
    case mark
}

public struct HighlightSpan: Equatable, Sendable {
    public var range: NSRange
    public var kind: HighlightKind
}

public enum MarkdownHighlighter {
    /// The spans of `text`, outermost first.
    public static func spans(in text: String) -> [HighlightSpan] {
        var builder = Builder(text: text)
        return builder.run()
    }

    private struct Builder: MarkupWalker {
        let text: String
        /// Where each line starts, in UTF-8 bytes.
        private var lineStarts: [Int] = [0]
        private let utf8: [UInt8]
        /// The text as UTF-16 units, which is what the ranges are in.
        private let chars: [UInt16]
        /// UTF-8 byte offset to UTF-16 offset, or nil when the text is ASCII (they are then the same).
        private var utf16At: [Int32]?
        private var spans: [HighlightSpan] = []

        init(text: String) {
            self.text = text
            utf8 = Array(text.utf8)
            chars = Array(text.utf16)
            for (index, byte) in utf8.enumerated() where byte == 0x0A { lineStarts.append(index + 1) }
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

        mutating func run() -> [HighlightSpan] {
            // The frontmatter is dimmed, and hidden from the parse by blanking it (keeping its line breaks), so offsets stay put.
            var source = text
            if let end = Self.frontmatterEnd(in: text) {
                let head = String(text.unicodeScalars.prefix(end))
                spans.append(HighlightSpan(range: NSRange(location: 0, length: head.utf16.count), kind: .frontmatter))
                let blank = String(head.map { $0 == "\n" ? "\n" : " " })
                source = blank + String(text.dropFirst(head.count))
            }
            visit(Document(parsing: source))
            return spans
        }

        /// The end (in scalars) of a leading `---` block, as `NoteFrontmatter` finds it.
        private static func frontmatterEnd(in text: String) -> Int? {
            guard text.hasPrefix("---\n") || text.hasPrefix("---\r\n") else { return nil }
            let split = NoteFrontmatter.split(text)
            guard split.frontmatter != nil else { return nil }
            return text.unicodeScalars.count - split.body.unicodeScalars.count
        }

        // MARK: Positions

        private func offset(_ location: SourceLocation) -> Int {
            let line = max(location.line - 1, 0)
            let byte = min((line < lineStarts.count ? lineStarts[line] : utf8.count) + max(location.column - 1, 0), utf8.count)
            return utf16At.map { Int($0[byte]) } ?? byte
        }

        private func range(of markup: any Markup) -> Range<Int>? {
            guard let source = markup.range else { return nil }
            let start = offset(source.lowerBound), end = offset(source.upperBound)
            return start <= end ? start..<end : nil
        }

        private mutating func add(_ range: Range<Int>?, _ kind: HighlightKind) {
            guard let range, !range.isEmpty else { return }
            spans.append(HighlightSpan(range: NSRange(location: range.lowerBound, length: range.count), kind: kind))
        }

        /// A node's span, then the syntax around its children as marks.
        private mutating func wrap(_ markup: any Markup, _ kind: HighlightKind) {
            guard let whole = range(of: markup) else { return descendInto(markup) }
            add(whole, kind)
            descendInto(markup)
            let kids = markup.children.compactMap { range(of: $0) }
            if let first = kids.first, let last = kids.last {
                add(whole.lowerBound..<first.lowerBound, .mark)
                add(last.upperBound..<whole.upperBound, .mark)
            }
        }

        // MARK: Nodes

        mutating func visitHeading(_ heading: Heading) { wrap(heading, .heading(level: heading.level)) }
        mutating func visitStrong(_ strong: Strong) { wrap(strong, .strong) }
        mutating func visitEmphasis(_ emphasis: Emphasis) { wrap(emphasis, .emphasis) }
        mutating func visitStrikethrough(_ strike: Strikethrough) { wrap(strike, .strikethrough) }

        mutating func visitInlineCode(_ code: InlineCode) {
            guard let whole = range(of: code) else { return }
            add(whole, .inlineCode)
            // The backtick runs at each end.
            var left = whole.lowerBound
            while left < whole.upperBound, chars[left] == 0x60 { left += 1 }
            var right = whole.upperBound
            while right > left, chars[right - 1] == 0x60 { right -= 1 }
            add(whole.lowerBound..<left, .mark)
            add(right..<whole.upperBound, .mark)
        }

        mutating func visitCodeBlock(_ block: CodeBlock) {
            guard let whole = range(of: block) else { return }
            add(whole, .codeBlock)
            // A fenced block: its first and last lines are the fences.
            var start = whole.lowerBound
            while start < whole.upperBound, chars[start] == 0x20 { start += 1 }
            guard start < whole.upperBound, chars[start] == 0x60 || chars[start] == 0x7E else { return }
            var firstEnd = whole.lowerBound
            while firstEnd < whole.upperBound, chars[firstEnd] != 0x0A { firstEnd += 1 }
            add(whole.lowerBound..<firstEnd, .mark)
            var lastStart = whole.upperBound
            while lastStart > firstEnd, chars[lastStart - 1] == 0x0A { lastStart -= 1 }  // a trailing break is not part of the line
            let lineEnd = lastStart
            while lastStart > firstEnd, chars[lastStart - 1] != 0x0A { lastStart -= 1 }
            if lastStart > firstEnd { add(lastStart..<lineEnd, .mark) }
        }

        mutating func visitLink(_ link: Link) { wrapLink(link) }
        mutating func visitImage(_ image: Image) { wrapLink(image) }

        private mutating func wrapLink(_ link: any Markup) {
            guard let whole = range(of: link) else { return descendInto(link) }
            let kids = link.children.compactMap { range(of: $0) }
            if let first = kids.first, let last = kids.last {
                add(first.lowerBound..<last.upperBound, .linkText)
                descendInto(link)
                add(whole.lowerBound..<first.lowerBound, .mark)
                add(last.upperBound..<whole.upperBound, .mark)
            } else {
                add(whole, .linkText)
            }
        }

        mutating func visitBlockQuote(_ quote: BlockQuote) {
            guard let whole = range(of: quote) else { return descendInto(quote) }
            add(whole, .quote)
            descendInto(quote)
            // The `>` that starts each line of the quote.
            var line = whole.lowerBound
            while line < whole.upperBound {
                var p = line
                while p < whole.upperBound, chars[p] == 0x20 { p += 1 }
                while p < whole.upperBound, chars[p] == 0x3E { add(p..<(p + 1), .mark); p += 1; if p < whole.upperBound, chars[p] == 0x20 { p += 1 } }
                while line < whole.upperBound, chars[line] != 0x0A { line += 1 }
                line += 1
            }
        }

        mutating func visitListItem(_ item: ListItem) {
            if let whole = range(of: item) {
                    var p = whole.lowerBound
                if p < chars.count, [0x2D, 0x2A, 0x2B].contains(chars[p]) { p += 1 } else {
                    while p < chars.count, (0x30...0x39).contains(chars[p]) { p += 1 }
                    if p < chars.count, chars[p] == 0x2E || chars[p] == 0x29 { p += 1 }
                }
                add(whole.lowerBound..<p, .listMarker)
                // A task item's `[ ]` or `[x]`.
                var q = p
                while q < chars.count, chars[q] == 0x20 { q += 1 }
                if item.checkbox != nil, q + 2 < chars.count, chars[q] == 0x5B { add(q..<(q + 3), .listMarker) }
            }
            descendInto(item)
        }

        mutating func visitThematicBreak(_ rule: ThematicBreak) { add(range(of: rule), .rule) }
        mutating func visitHTMLBlock(_ html: HTMLBlock) { add(range(of: html), .tag) }
        mutating func visitInlineHTML(_ html: InlineHTML) { add(range(of: html), .tag) }
    }
}
