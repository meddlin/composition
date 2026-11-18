import Foundation
import Markdown

// Reads a note with swift-markdown and finds what the Live view changes the look of: ATX headings, rules, bold, italic, strikethrough and code with
// their marks, pictures written as `![alt](src "title")`, and code blocks (fenced and indented). The desktop gets these from lezer's syntax tree, so the marks are
// worked out as lezer works them out (a heading's closing `#`s, a rule's whole line, an image's raw address), from the text and not from what
// cmark makes of it, because the two disagree on what is in a mark and on what an address is.

struct LiveReader: MarkupWalker {
    let map: SourceMap
    let lines: LineIndex
    var headings: [LiveModel.HeadingNode] = []
    var rules: [LiveModel.RuleNode] = []
    var styles: [LiveModel.StyleNode] = []
    var pictures: [LiveModel.PictureNode] = []
    var codeBlocks: [LiveModel.FenceNode] = []
    var links: [LiveModel.LinkNode] = []
    /// How many links and images the walk is inside: a bare address in a link's text or an image's alt is that construct's, not a link of its own.
    private var linkDepth = 0
    /// The lines of lists and quotes, by where each starts, as the walk finds their containers (outermost first, since a container is visited before what it holds).
    private var lists: [Int: ListFacts] = [:]

    /// What a line of a list or a quote is made of (the desktop's `LineInfo`, liveLists.ts).
    private struct ListFacts {
        var start: Int
        var end: Int
        var containers: [LiveDecorations.ListLine.Container] = []
        /// Where the marks at the line's start (`> `, `- `, `1. `) end; the line's start when it has none.
        var marksEnd: Int
        var marker: LiveDecorations.ListLine.Marker?
        var task: LiveDecorations.ListLine.Task?
    }

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
        if let node = atx(heading) ?? setext(heading) { headings.append(node) }
        bareAddresses(in: heading)
        descendInto(heading)
    }

    /// A setext heading (docs/ipad-live-default-plan.md, Step 7; the desktop's `liveSetext`): a paragraph underlined with `===` (level 1) or `---` (level 2). Each of its
    /// lines is drawn as a heading; the underline is its mark, from its first `=` or `-` to its last (lezer's `HeaderMark`), shown dimmed while the selection is in the
    /// heading, and otherwise its whole line hidden and drawn with no height.
    private func setext(_ heading: Heading) -> LiveModel.HeadingNode? {
        guard heading.level <= 2, let range = map.range(of: heading), range.count > 0 else { return nil }
        let firstLine = lines.line(containing: range.lowerBound)
        let character: UInt16 = heading.level == 1 ? 0x3D : 0x2D
        /// The underline's mark on line `index`, if the line is one: `=` or `-` alone, after space or a quote's `>`, with nothing but space after.
        func underline(_ index: Int) -> (line: NSRange, mark: NSRange)? {
            let start = lines.starts[index], end = lineEnd(from: start)
            var markEnd = end
            while markEnd > start, isSpace(chars[markEnd - 1]) { markEnd -= 1 }
            var markStart = markEnd
            while markStart > start, chars[markStart - 1] == character { markStart -= 1 }
            guard markStart < markEnd, markStart == start || isSpace(chars[markStart - 1]) || chars[markStart - 1] == 0x3E else { return nil }
            return (NSRange(location: start, length: end - start), NSRange(location: markStart, length: markEnd - markStart))
        }
        // The underline is the first such line after the heading's first: cmark's range can run on into the line after it (`text\n---\nmore` ends on `more`).
        let lastReached = lines.line(containing: max(range.lowerBound, range.upperBound - 1))
        guard let lastLine = (firstLine + 1..<min(lines.starts.count, max(lastReached, firstLine + 1) + 1)).first(where: { underline($0) != nil }),
            let found = underline(lastLine)
        else { return nil }
        let underlineStart = found.line.location, underlineEnd = NSMaxRange(found.line)
        let markStart = found.mark.location, markEnd = NSMaxRange(found.mark)

        var start = range.lowerBound
        while start < underlineStart, isSpace(chars[start]) { start += 1 }
        let textLines = (firstLine..<lastLine).map { index -> NSRange in
            let lineStart = lines.starts[index]
            return NSRange(location: lineStart, length: lineEnd(from: lineStart) - lineStart)
        }
        return LiveModel.HeadingNode(line: lines.starts[firstLine], level: heading.level, node: NSRange(location: start, length: underlineEnd - start),
                                     marks: [(NSRange(location: markStart, length: markEnd - markStart), found.line)], setextLines: textLines)
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

    /// A fenced or an indented code block, as the desktop's `liveCode` reads lezer's `FencedCode` and `CodeBlock`: each of its lines, which of them are
    /// fences (the opening one, and the closing one when the block is closed), whether any line is code, and, for an indented block at the top level, the
    /// indent of each of its lines (four columns, which the Preview does not show).
    mutating func visitCodeBlock(_ block: CodeBlock) {
        guard let range = map.range(of: block) else { return }
        var start = range.lowerBound
        while start < range.upperBound, chars[start] == 0x20 { start += 1 }
        var end = range.upperBound
        while end > range.lowerBound, chars[end - 1] == 0x0A || chars[end - 1] == 0x0D { end -= 1 }
        let first = lines.line(containing: range.lowerBound)
        var last = lines.line(containing: max(end, range.lowerBound))
        // cmark does not say which kind a block is. A fenced one spans more lines than its code has (its fences); an indented one, whose range starts
        // after the indent of its first line, spans as many (`    ```` is indented code, not a fence).
        let codeLines = block.code.utf16.reduce(0) { $1 == 0x0A ? $0 + 1 : $0 }
        let fenced = last - first + 1 > codeLines && start < range.upperBound && (chars[start] == 0x60 || chars[start] == 0x7E)
        var starts = Array(lines.starts[first...last])

        guard fenced else {
            // An indented block. Its range starts after the indent of its first line, as lezer's does, so a caret in that indent is outside the block.
            let from = range.lowerBound
            var indents: [NSRange] = []
            if block.parent?.parent == nil {  // at the top level: in a list or a quote the indent is the item's
                for line in starts {
                    let indent = indentWidth(at: line)
                    if indent > 0, line + indent < chars.count, !isLineBreak(chars[line + indent]) { indents.append(NSRange(location: line, length: indent)) }
                }
            }
            codeBlocks.append(.init(node: NSRange(location: from, length: end - from), fences: [], lines: starts, fenceLines: [], hasCode: true, indents: indents))
            return
        }

        let fenceCharacter = chars[start]
        var opening = 0
        while start + opening < range.upperBound, chars[start + opening] == fenceCharacter { opening += 1 }
        let firstEnd = lineEnd(from: start)
        // A fence is hidden as its whole line: what is before it on the line (a list item's indent, a quote's `>`) goes with it, as on the desktop.
        var fences = [NSRange(location: starts[0], length: firstEnd - starts[0])]
        var fenceLines = [starts[0]]
        let lastStart = starts[starts.count - 1]
        if starts.count > 1 {
            var closing = 0
            var p = lastStart
            while p < end, chars[p] == 0x20 || chars[p] == 0x3E { p += 1 }  // the indent, or a quote's `>` and its space
            while p + closing < end, chars[p + closing] == fenceCharacter { closing += 1 }
            let onlyFence = (p + closing..<end).allSatisfy { isSpace(chars[$0]) }
            if closing >= opening, onlyFence {
                fences.append(NSRange(location: lastStart, length: lineEnd(from: lastStart) - lastStart))
                fenceLines.append(lastStart)
            }
        }
        if fenceLines.count == 1, (end..<chars.count).allSatisfy({ isLineBreak(chars[$0]) }), end < chars.count {
            // Not closed, and nothing after it: it runs to the end of the note, the empty line after a last line break included, as lezer's does.
            end = chars.count
            last = lines.starts.count - 1
            starts = Array(lines.starts[first...last])
        }
        let hasCode = starts.count > fenceLines.count
        codeBlocks.append(.init(node: NSRange(location: range.lowerBound, length: end - range.lowerBound), fences: fences, lines: starts, fenceLines: fenceLines, hasCode: hasCode, indents: []))
    }

    /// How many units of indent start the line at `line`, up to four columns (a tab goes to the next multiple of four).
    private func indentWidth(at line: Int) -> Int {
        var column = 0, i = line
        while i < chars.count, column < 4 {
            if chars[i] == 0x20 { column += 1 } else if chars[i] == 0x09 { column += 4 - column % 4 } else { break }
            i += 1
        }
        return column >= 4 ? i - line : 0
    }

    private func isLineBreak(_ unit: UInt16) -> Bool { unit == 0x0A || unit == 0x0D }

    // MARK: Lists and quotes

    // The desktop reads these from lezer's `Blockquote`, `ListItem`, `ListMark`, `QuoteMark` and `TaskMarker` nodes. cmark gives the quotes and the items, and
    // whether an item is a task; the marks are found in the text, where lezer finds them.

    /// The facts of the line starting at `start`, made when first asked for.
    private mutating func facts(atLine start: Int) -> ListFacts {
        lists[start] ?? ListFacts(start: start, end: lineEnd(from: start), marksEnd: start)
    }

    /// The start of each line `range` covers. A container ends where its last line's text ends; a range that ends just after a line break does not take in
    /// the line after it.
    private func lineStarts(of range: Range<Int>) -> [Int] {
        let first = lines.line(containing: range.lowerBound)
        let last = lines.line(containing: max(range.lowerBound, range.upperBound - 1))
        return (first...last).map { lines.starts[$0] }
    }

    /// Where a container's content ends: the end of its last child (lezer's node ends there; cmark's may take in blank lines after it), or its first line's end when
    /// it has no children.
    private func contentEnd(of markup: any Markup, from start: Int) -> Int {
        var end = lineEnd(from: start)
        for child in markup.children { if let range = map.range(of: child) { end = max(end, range.upperBound) } }
        while end > start, chars[end - 1] == 0x0A || chars[end - 1] == 0x0D { end -= 1 }
        return end
    }

    /// How many spaces follow `at`, as the gap between a list mark and its text: one to four, or none at the line's end (the desktop's `gapAfter`).
    private func gapAfter(_ at: Int) -> Int {
        let rest = lineEnd(from: at)
        var count = 0
        while at + count < rest, count < 5, chars[at + count] == 0x20 { count += 1 }
        // Five or more spaces start an indented code block; the item's text is then one space in.
        return count > 4 ? 1 : count
    }

    mutating func visitBlockQuote(_ quote: BlockQuote) {
        if let range = map.range(of: quote) {
            let end = contentEnd(of: quote, from: range.lowerBound)
            for start in lineStarts(of: range.lowerBound..<max(end, range.lowerBound + 1)) {
                var line = facts(atLine: start)
                line.containers.append(.quote)
                // The quote's `>` on this line, after the marks of what holds the quote (and the indentation that carries a list item on): a line taken in lazily has none.
                var p = line.marksEnd
                if case .list(starts: false, let column) = line.containers.dropLast().last { p = max(p, min(start + column, line.end)) }
                while p < line.end, isSpace(chars[p]) { p += 1 }
                if p < line.end, chars[p] == 0x3E {
                    line.marksEnd = max(line.marksEnd, p + 1 + (p + 1 < chars.count && chars[p + 1] == 0x20 ? 1 : 0))
                }
                lists[start] = line
            }
        }
        descendInto(quote)
    }

    mutating func visitListItem(_ item: ListItem) {
        if let range = map.range(of: item), let mark = listMark(at: range.lowerBound) {
            let first = lines.start(ofLineContaining: mark.lowerBound)
            let gap = gapAfter(mark.upperBound)
            let column = mark.upperBound + gap - first
            let end = contentEnd(of: item, from: range.lowerBound)
            for start in lineStarts(of: range.lowerBound..<max(end, range.lowerBound + 1)) {
                var line = facts(atLine: start)
                line.containers.append(.list(starts: start == first, column: column))
                if start == first {
                    line.marksEnd = max(line.marksEnd, mark.upperBound + gap)
                    line.marker = .init(text: string(mark.lowerBound, mark.upperBound), ordered: item.parent is OrderedList)
                    if item.checkbox != nil { line.task = task(from: mark.upperBound, lineEnd: line.end) }
                }
                lists[start] = line
            }
        }
        descendInto(item)
    }

    /// The list mark at `start`: `-`, `*` or `+`, or one to nine digits and a `.` or `)`.
    private func listMark(at start: Int) -> Range<Int>? {
        guard start < chars.count else { return nil }
        if [0x2D, 0x2A, 0x2B].contains(chars[start]) { return start..<start + 1 }
        var p = start
        while p < chars.count, p - start < 9, (0x30...0x39).contains(chars[p]) { p += 1 }
        guard p > start, p < chars.count, chars[p] == 0x2E || chars[p] == 0x29 else { return nil }
        return start..<p + 1
    }

    /// A task's `[ ]`, `[x]` or `[X]` after the item's mark, and the space after it.
    private func task(from markEnd: Int, lineEnd end: Int) -> LiveDecorations.ListLine.Task? {
        var p = markEnd
        while p < end, isSpace(chars[p]) { p += 1 }
        guard p + 3 <= end, chars[p] == 0x5B, chars[p + 2] == 0x5D, [0x20, 0x78, 0x58].contains(chars[p + 1]) else { return nil }
        let gap = p + 3 < chars.count && chars[p + 3] == 0x20 ? 1 : 0
        return .init(range: NSRange(location: p, length: 3 + gap), box: NSRange(location: p, length: 3), checked: chars[p + 1] != 0x20)
    }

    /// The lines of lists and quotes the walk found, in order, with what is hidden on each away from the selection worked out.
    func listLines() -> [LiveModel.ListLineNode] {
        lists.values.sorted { $0.start < $1.start }.compactMap { line in
            guard let inner = line.containers.last else { return nil }
            var end = line.marksEnd
            // A line that carries on an item (its second paragraph, or a wrapped line typed with a break) is indented to the item's text in the source; that indentation
            // goes too, and no further, so an indented code block keeps its own (the desktop's `prefixEnd`).
            if case .list(starts: false, let column) = inner {
                let limit = min(line.start + column, line.end)
                while end < limit, isSpace(chars[end]) { end += 1 }
            }
            return .init(node: NSRange(location: line.start, length: line.end - line.start), containers: line.containers, prefixEnd: end, marker: line.marker, task: line.task)
        }
    }
}
