import Foundation
import Markdown

// Reads a note with swift-markdown and finds what the Live view changes the look of: ATX headings, rules, bold, italic, strikethrough and code with
// their marks, pictures written as `![alt](src "title")`, and fenced code blocks. The desktop gets these from lezer's syntax tree, so the marks are
// worked out as lezer works them out (a heading's closing `#`s, a rule's whole line, an image's raw address), from the text and not from what
// cmark makes of it, because the two disagree on what is in a mark and on what an address is.

struct LiveReader: MarkupWalker {
    let map: SourceMap
    let lines: LineIndex
    var headings: [LiveModel.HeadingNode] = []
    var rules: [LiveModel.RuleNode] = []
    var styles: [LiveModel.StyleNode] = []
    var pictures: [LiveModel.PictureNode] = []
    var fenced: [LiveModel.FenceNode] = []
    var links: [LiveModel.LinkNode] = []
    /// How many links and images the walk is inside: a bare address in a link's text or an image's alt is that construct's, not a link of its own.
    private var linkDepth = 0

    private var chars: [UInt16] { map.chars }

    init(map: SourceMap, lines: LineIndex) {
        self.map = map
        self.lines = lines
    }

    // MARK: Positions

    /// The end of the line holding `position`: where its text ends, before a `\n` or `\r\n`.
    private func lineEnd(from position: Int) -> Int {
        var i = position
        while i < chars.count, chars[i] != 0x0A, chars[i] != 0x0D { i += 1 }
        return i
    }

    private func isSpace(_ unit: UInt16) -> Bool { unit == 0x20 || unit == 0x09 }

    // MARK: Headings and rules

    mutating func visitHeading(_ heading: Heading) {
        if let node = atx(heading) { headings.append(node) }  // a setext heading is not drawn: the desktop's `ATXHeading` is the only one it reads
        bareAddresses(in: heading)
        descendInto(heading)
    }

    /// An ATX heading as lezer's `parseATXHeading` reads it: the opening `#`s and, when they are preceded by a space and are not the whole line, the closing ones.
    private func atx(_ heading: Heading) -> LiveModel.HeadingNode? {
        guard let range = map.range(of: heading) else { return nil }
        var start = range.lowerBound
        while start < range.upperBound, chars[start] == 0x20 { start += 1 }
        var size = 0
        while start + size < chars.count, chars[start + size] == 0x23 { size += 1 }
        guard (1...6).contains(size) else { return nil }
        let end = lineEnd(from: start)
        guard start + size == end || isSpace(chars[start + size]) else { return nil }

        let gap = start + size < chars.count && chars[start + size] == 0x20 ? 1 : 0
        var marks = [(shown: NSRange(location: start, length: size), hidden: NSRange(location: start, length: size + gap))]

        var endOfSpace = end
        while endOfSpace > start, isSpace(chars[endOfSpace - 1]) { endOfSpace -= 1 }
        var after = endOfSpace
        while after > start, chars[after - 1] == 0x23 { after -= 1 }
        if after != endOfSpace, after != start, isSpace(chars[after - 1]) {
            let closing = NSRange(location: after, length: endOfSpace - after)
            marks.append((closing, closing))
        }
        return LiveModel.HeadingNode(line: lines.start(ofLineContaining: start), level: size, node: NSRange(location: start, length: end - start), marks: marks)
    }

    mutating func visitThematicBreak(_ rule: ThematicBreak) {
        guard let range = map.range(of: rule) else { return }
        var start = range.lowerBound
        while start < range.upperBound, isSpace(chars[start]) { start += 1 }
        guard start < chars.count else { return }
        // The whole line: lezer's rule runs to the end of its line, trailing spaces included.
        rules.append(.init(line: lines.start(ofLineContaining: start), node: NSRange(location: start, length: lineEnd(from: start) - start)))
    }

    // MARK: Styled text

    mutating func visitStrong(_ strong: Strong) {
        // `***both***`: cmark makes an emphasis around a strong, as lezer does, but gives the strong the emphasis's whole range, `*` marks included.
        var inset = 0
        if let parent = strong.parent as? Emphasis, map.range(of: parent) == map.range(of: strong) { inset = 1 }
        styled(strong, .strong, delimiter: 2, characters: [0x2A, 0x5F], inset: inset)
        descendInto(strong)
    }

    mutating func visitEmphasis(_ emphasis: Emphasis) {
        styled(emphasis, .emphasis, delimiter: 1, characters: [0x2A, 0x5F])
        descendInto(emphasis)
    }

    mutating func visitStrikethrough(_ strike: Strikethrough) {
        // lezer reads only `~~`; cmark's strikethrough also takes a single `~`.
        styled(strike, .strike, delimiter: 2, characters: [0x7E])
        descendInto(strike)
    }

    mutating func visitInlineCode(_ code: InlineCode) {
        guard let range = map.range(of: code), range.count >= 2 else { return }
        var run = 0
        while range.lowerBound + run < range.upperBound, chars[range.lowerBound + run] == 0x60 { run += 1 }
        guard run > 0, range.count >= 2 * run else { return }
        styles.append(.init(style: .code, node: nsRange(range), marks: [
            NSRange(location: range.lowerBound, length: run), NSRange(location: range.upperBound - run, length: run),
        ]))
    }

    private mutating func styled(_ markup: any Markup, _ style: LiveStyle, delimiter: Int, characters: [UInt16], inset: Int = 0) {
        guard let whole = map.range(of: markup), whole.count >= 2 * (delimiter + inset) else { return }
        let range = (whole.lowerBound + inset)..<(whole.upperBound - inset)
        let first = chars[range.lowerBound], last = chars[range.upperBound - 1]
        guard characters.contains(first), characters.contains(last),
            (0..<delimiter).allSatisfy({ chars[range.lowerBound + $0] == first && chars[range.upperBound - 1 - $0] == last })
        else { return }
        styles.append(.init(style: style, node: nsRange(range), marks: [
            NSRange(location: range.lowerBound, length: delimiter), NSRange(location: range.upperBound - delimiter, length: delimiter),
        ]))
    }

    private func nsRange(_ range: Range<Int>) -> NSRange { NSRange(location: range.lowerBound, length: range.count) }

    // MARK: Pictures

    mutating func visitImage(_ image: Image) {
        if let range = map.range(of: image), let found = markdownImage(from: range.lowerBound, limit: range.upperBound) {
            pictures.append(found)
            return  // a drawn picture is not read further: what is in its alt text is not drawn
        }
        linkDepth += 1
        descendInto(image)
        linkDepth -= 1
    }

    /// `![alt](src "title")` as lezer's inline link parser reads it, from the raw text: the alt text up to the `]` that closes it, the address (with its
    /// `<` `>` taken off) and the title (with its quotes off). Nil for a reference image (`![alt][ref]`), which has no address of its own, and for an
    /// empty address.
    private func markdownImage(from start: Int, limit: Int) -> LiveModel.PictureNode? {
        guard start + 1 < limit, chars[start] == 0x21, chars[start + 1] == 0x5B, let i = closingBracket(after: start + 1, limit: limit) else { return nil }
        guard i + 1 < limit, chars[i + 1] == 0x28, let target = inlineTarget(at: i + 1, limit: limit) else { return nil }
        guard !target.address.isEmpty else { return nil }
        return LiveModel.PictureNode(node: NSRange(location: start, length: target.end - start), src: target.address, alt: string(start + 2, i), title: target.title)
    }

    /// The `]` that closes the `[` at `open`, counting nested brackets and skipping escaped ones; nil when there is none before `limit`.
    private func closingBracket(after open: Int, limit: Int) -> Int? {
        var depth = 1
        var i = open + 1
        while i < limit {
            if chars[i] == 0x5C { i += 2; continue }
            if chars[i] == 0x5B { depth += 1 } else if chars[i] == 0x5D {
                depth -= 1
                if depth == 0 { return i }
            }
            i += 1
        }
        return nil
    }

    /// `(src "title")` from the `(` at `paren`: the address as written (with its `<` `>` taken off, and empty for `()`), the title (quotes off), and where
    /// the `)` ends. Nil when it is not closed as lezer closes it.
    private func inlineTarget(at paren: Int, limit: Int) -> (address: String, title: String, end: Int)? {
        func skipSpace(_ from: Int) -> Int {
            var p = from
            while p < limit, [0x20, 0x09, 0x0A, 0x0D].contains(chars[p]) { p += 1 }
            return p
        }
        var p = skipSpace(paren + 1)
        // The address.
        let addressStart = p
        if p < limit, chars[p] == 0x3C {
            p += 1
            while p < limit, chars[p] != 0x3E { if chars[p] == 0x3C || chars[p] == 0x0A { return nil }; p += 1 }
            guard p < limit else { return nil }
            p += 1
        } else {
            var nesting = 0
            var escaped = false
            while p < limit {
                let unit = chars[p]
                if [0x20, 0x09, 0x0A, 0x0D].contains(unit) { break }
                if escaped { escaped = false } else if unit == 0x28 { nesting += 1 } else if unit == 0x29 {
                    if nesting == 0 { break }
                    nesting -= 1
                } else if unit == 0x5C { escaped = true }
                p += 1
            }
        }
        var address = string(addressStart, p)
        if address.hasPrefix("<"), address.hasSuffix(">") { address = String(address.dropFirst().dropLast()) }

        // An optional title, set off from the address by space; then the `)`.
        var title = ""
        let afterAddress = skipSpace(p)
        p = afterAddress
        if afterAddress > addressStart, p < limit, let closer = [0x22: 0x22, 0x27: 0x27, 0x28: 0x29][Int(chars[p])] {
            let titleStart = p
            p += 1
            var escaped = false
            var closed = false
            while p < limit {
                let unit = chars[p]
                if escaped { escaped = false } else if unit == 0x5C { escaped = true } else if Int(unit) == closer { closed = true; break }
                p += 1
            }
            guard closed else { return nil }
            p += 1
            title = string(titleStart, p)
            title = title.count >= 2 ? String(title.dropFirst().dropLast()) : ""
            p = skipSpace(p)
        }
        guard p < limit, chars[p] == 0x29 else { return nil }
        return (address, title, p + 1)
    }

    private func string(_ from: Int, _ to: Int) -> String { String(decoding: chars[from..<to], as: UTF16.self) }

    // MARK: Links

    mutating func visitLink(_ link: Link) {
        if let range = map.range(of: link), let found = linkNode(link, range) { links.append(found) }
        // Its text is still read, so a bold word in a link's text is bold.
        linkDepth += 1
        descendInto(link)
        linkDepth -= 1
    }

    /// A link as the desktop's `drawLink` draws it, its marks found in the raw text as lezer finds them: `<url>`, `[text](url "title")`, and `[text][label]`,
    /// `[text][]` or `[text]` with a definition (cmark has already found it, and its address is the one followed). Nil for what the desktop leaves as
    /// written: a footnote's `[^1]`, a link with no text (`[](url)`), an empty address (`[text]()`).
    private func linkNode(_ link: Link, _ range: Range<Int>) -> LiveModel.LinkNode? {
        let start = range.lowerBound, limit = range.upperBound
        guard start < limit else { return nil }
        if chars[start] == 0x3C {
            // `<https://…>` or `<a@b.test>`: the address between the angle brackets.
            guard limit - start > 2, chars[limit - 1] == 0x3E else { return nil }
            let url = NSRange(location: start + 1, length: limit - 1 - (start + 1))
            let open = NSRange(location: start, length: 1), close = NSRange(location: limit - 1, length: 1)
            return .init(node: NSRange(location: start, length: limit - start), text: url, href: Self.href(string(start + 1, limit - 1), bare: true), marks: [open, close], hide: [open, close])
        }
        guard chars[start] == 0x5B, let close = closingBracket(after: start, limit: limit) else { return nil }
        // `[^1]` is a footnote reference, as the Preview draws it, not a link (Step 7 of the plan draws footnotes).
        if start + 1 < limit, chars[start + 1] == 0x5E { return nil }
        // `[](url)` has no text to draw it as.
        guard close > start + 1 else { return nil }
        var marks = [NSRange(location: start, length: 1), NSRange(location: close, length: 1)]
        let href: String
        var end = close + 1
        if close + 1 < limit, chars[close + 1] == 0x28, let target = inlineTarget(at: close + 1, limit: limit) {
            guard !target.address.isEmpty else { return nil }
            href = Self.href(target.address, bare: false)
            marks += [NSRange(location: close + 1, length: 1), NSRange(location: target.end - 1, length: 1)]
            end = target.end
        } else {
            // A reference: `[label]` after it (no marks of its own), or nothing.
            if close + 1 < limit, chars[close + 1] == 0x5B, let labelEnd = closingBracket(after: close + 1, limit: limit) {
                if labelEnd > close + 2, chars[close + 2] == 0x5E { return nil }
                end = labelEnd + 1
            }
            guard let destination = link.destination, !destination.isEmpty else { return nil }
            href = destination
        }
        return .init(node: NSRange(location: start, length: end - start), text: NSRange(location: start + 1, length: close - start - 1), href: href, marks: marks,
            hide: [NSRange(location: start, length: 1), NSRange(location: close, length: end - close)])
    }

    /// A link's address as written, made into one to follow (the desktop's `hrefOf`): `<…>` taken off, and, for a bare address or an autolink, a bare
    /// `www.` given `http://` and an email `mailto:`.
    static func href(_ url: String, bare: Bool) -> String {
        let address = url.hasPrefix("<") && url.hasSuffix(">") && url.count >= 2 ? String(url.dropFirst().dropLast()) : url
        if !bare || address.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*:", options: .regularExpression) != nil { return address }
        return address.contains("@") ? "mailto:\(address)" : "http://\(address)"
    }

    // MARK: Bare addresses

    mutating func visitParagraph(_ paragraph: Paragraph) { bareAddresses(in: paragraph); descendInto(paragraph) }
    mutating func visitTableCell(_ cell: Table.Cell) { bareAddresses(in: cell); descendInto(cell) }

    /// The bare addresses in the text of `container` (a paragraph or a table cell, and what it holds, outside links, images and code), found as lezer's GFM
    /// `Autolink` finds them: `www.`, `http://`, `https://`, `mailto:`, `xmpp:` and email addresses. cmark here has no autolink extension, so these are
    /// read from the runs of plain text it leaves: neighbouring text nodes are read as one, so that an address with a `_` or a `*` in it is whole.
    private mutating func bareAddresses(in container: any Markup) {
        var runs: [Range<Int>] = []
        func collect(_ markup: any Markup, inLink: Bool) {
            for child in markup.children {
                if child is Link || child is Image || child is InlineCode || child is InlineHTML { if let r = map.range(of: child) { runs.append(r.upperBound..<r.upperBound) }; continue }
                if child is Text, let r = map.range(of: child) {
                    if let last = runs.last, last.upperBound == r.lowerBound, !last.isEmpty { runs[runs.count - 1] = last.lowerBound..<r.upperBound } else { runs.append(r) }
                } else if child is SoftBreak || child is LineBreak {
                    runs.append(0..<0)
                } else {
                    collect(child, inLink: inLink)
                }
            }
        }
        guard linkDepth == 0 else { return }
        collect(container, inLink: false)
        for run in runs where !run.isEmpty { scanAddresses(run) }
    }

    private static func isWord(_ unit: UInt16) -> Bool {
        (0x30...0x39).contains(unit) || (0x41...0x5A).contains(unit) || (0x61...0x7A).contains(unit) || unit == 0x5F
    }

    private mutating func scanAddresses(_ run: Range<Int>) {
        var pos = run.lowerBound
        while pos < run.upperBound {
            if pos > 0, Self.isWord(chars[pos - 1]) { pos += 1; continue }
            if let end = addressEnd(at: pos, limit: run.upperBound), end > pos {
                let url = NSRange(location: pos, length: end - pos)
                links.append(.init(node: url, text: url, href: Self.href(string(pos, end), bare: true), marks: [], hide: []))
                pos = end
            } else {
                pos += 1
            }
        }
    }

    private func has(_ prefix: String, at pos: Int, limit: Int, ignoringCase: Bool = false) -> Bool {
        let units = Array(prefix.utf16)
        guard pos + units.count <= limit else { return false }
        for (k, unit) in units.enumerated() {
            var c = chars[pos + k]
            if ignoringCase, (0x41...0x5A).contains(c) { c += 0x20 }
            if c != unit { return false }
        }
        return true
    }

    /// Where a bare address starting at `pos` ends, or nil (lezer's `Autolink.parse`).
    private func addressEnd(at pos: Int, limit: Int) -> Int? {
        if has("www.", at: pos, limit: limit) { return urlEnd(from: pos + 4, start: pos, limit: limit) }
        if has("http://", at: pos, limit: limit) { return urlEnd(from: pos + 7, start: pos, limit: limit) }
        if has("https://", at: pos, limit: limit) { return urlEnd(from: pos + 8, start: pos, limit: limit) }
        // `[\w.+-]{1,100}@`: an email address.
        var p = pos
        while p < limit, p - pos < 100, Self.isEmailLocal(chars[p]) { p += 1 }
        if p > pos, p < limit, chars[p] == 0x40 { return emailEnd(from: pos, limit: limit) }
        if has("mailto:", at: pos, limit: limit) { return emailEnd(from: pos + 7, limit: limit) }
        if has("xmpp:", at: pos, limit: limit) {
            guard var end = emailEnd(from: pos + 5, limit: limit) else { return nil }
            // `/[a-zA-Z\d@.]+`: a resource after it.
            if end < limit, chars[end] == 0x2F {
                var q = end + 1
                while q < limit, Self.isWord(chars[q]) && chars[q] != 0x5F || chars[q] == 0x40 || chars[q] == 0x2E { q += 1 }
                if q > end + 1 { end = q }
            }
            return end
        }
        return nil
    }

    private static func isEmailLocal(_ unit: UInt16) -> Bool { isWord(unit) || unit == 0x2E || unit == 0x2B || unit == 0x2D }
    private static func isDomain(_ unit: UInt16) -> Bool { isWord(unit) || unit == 0x2D }

    /// `[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s<]*)?` from `from`, then trailing punctuation taken off (lezer's `autolinkURLEnd`).
    private func urlEnd(from: Int, start: Int, limit: Int) -> Int? {
        var p = from
        var labels: [Range<Int>] = []
        while true {
            let labelStart = p
            while p < limit, Self.isDomain(chars[p]) { p += 1 }
            guard p > labelStart else { if labels.isEmpty { return nil }; p = labelStart - 1; break }
            labels.append(labelStart..<p)
            if p < limit, chars[p] == 0x2E, p + 1 < limit, Self.isDomain(chars[p + 1]) { p += 1 } else { break }
        }
        guard labels.count >= 2 else { return nil }
        // The last two words of the domain may not hold a `_`.
        if labels.suffix(2).contains(where: { r in r.contains { chars[$0] == 0x5F } }) { return nil }
        if p < limit, chars[p] == 0x3A {
            var q = p + 1
            while q < limit, (0x30...0x39).contains(chars[q]) { q += 1 }
            if q > p + 1 { p = q }
        }
        if p < limit, chars[p] == 0x2F {
            p += 1
            while p < limit, ![0x20, 0x09, 0x0A, 0x0D, 0x0C, 0x0B, 0x3C].contains(chars[p]) { p += 1 }
        }
        var end = p
        while end > from {
            let last = chars[end - 1]
            if [0x3F, 0x21, 0x2E, 0x2C, 0x3A, 0x2A, 0x5F, 0x7E].contains(last) {
                end -= 1
            } else if last == 0x29, count(0x29, from: start, to: end) > count(0x28, from: start, to: end) {
                end -= 1
            } else if last == 0x3B, let entity = trailingEntity(from: start, to: end) {
                end = entity
            } else {
                break
            }
        }
        return end
    }

    private func count(_ unit: UInt16, from: Int, to: Int) -> Int { (from..<to).reduce(0) { $0 + (chars[$1] == unit ? 1 : 0) } }

    /// Where `&name;`, `&#12;` or `&#x1f;` at the very end of `from..<to` starts.
    private func trailingEntity(from: Int, to: Int) -> Int? {
        var p = to - 2
        while p >= from, chars[p] != 0x26 {
            let c = chars[p]
            guard Self.isWord(c) || c == 0x23 else { return nil }
            p -= 1
        }
        guard p >= from else { return nil }
        let body = string(p + 1, to - 1)
        let ok = body.range(of: "^(#\\d+|#x[a-f\\d]+|\\w+)$", options: .regularExpression) != nil
        return ok ? p : nil
    }

    /// `[\w.+-]+@[\w-]+(\.[\w.-]+)+` from `from`, less a final `.`; nil when it ends in `_` or `-` (lezer's `autolinkEmailEnd`).
    private func emailEnd(from: Int, limit: Int) -> Int? {
        var p = from
        while p < limit, Self.isEmailLocal(chars[p]) { p += 1 }
        guard p > from, p < limit, chars[p] == 0x40 else { return nil }
        p += 1
        let domain = p
        while p < limit, Self.isDomain(chars[p]) { p += 1 }
        guard p > domain else { return nil }
        var parts = 0
        while p < limit, chars[p] == 0x2E {
            var q = p + 1
            while q < limit, Self.isDomain(chars[q]) || chars[q] == 0x2E { q += 1 }
            guard q > p + 1 else { break }
            p = q
            parts += 1
        }
        guard parts > 0 else { return nil }
        let last = chars[p - 1]
        if last == 0x5F || last == 0x2D { return nil }
        return last == 0x2E ? p - 1 : p
    }

    // MARK: Code blocks

    mutating func visitCodeBlock(_ block: CodeBlock) {
        guard let range = map.range(of: block) else { return }
        // A fenced block: its first and last lines are the fences (a block that is not closed has no last one).
        var start = range.lowerBound
        while start < range.upperBound, chars[start] == 0x20 { start += 1 }
        guard start < range.upperBound, chars[start] == 0x60 || chars[start] == 0x7E else { return }
        let fenceCharacter = chars[start]
        var opening = 0
        while start + opening < range.upperBound, chars[start + opening] == fenceCharacter { opening += 1 }
        let firstEnd = lineEnd(from: start)

        var end = range.upperBound
        while end > range.lowerBound, chars[end - 1] == 0x0A || chars[end - 1] == 0x0D { end -= 1 }
        var fences = [NSRange(location: range.lowerBound, length: firstEnd - range.lowerBound)]
        var lastStart = end
        while lastStart > firstEnd, chars[lastStart - 1] != 0x0A, chars[lastStart - 1] != 0x0D { lastStart -= 1 }
        if lastStart > firstEnd {
            var closing = 0
            var p = lastStart
            while p < end, chars[p] == 0x20 { p += 1 }
            while p + closing < end, chars[p + closing] == fenceCharacter { closing += 1 }
            let onlyFence = (p + closing..<end).allSatisfy { isSpace(chars[$0]) }
            if closing >= opening, onlyFence { fences.append(NSRange(location: lastStart, length: end - lastStart)) }
        }
        fenced.append(.init(node: NSRange(location: range.lowerBound, length: end - range.lowerBound), fences: fences))
    }
}
