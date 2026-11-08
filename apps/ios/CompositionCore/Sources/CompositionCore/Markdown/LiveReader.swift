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
        descendInto(image)
    }

    /// `![alt](src "title")` as lezer's inline link parser reads it, from the raw text: the alt text up to the `]` that closes it, the address (with its
    /// `<` `>` taken off) and the title (with its quotes off). Nil for a reference image (`![alt][ref]`), which has no address of its own, and for an
    /// empty address.
    private func markdownImage(from start: Int, limit: Int) -> LiveModel.PictureNode? {
        guard start + 1 < limit, chars[start] == 0x21, chars[start + 1] == 0x5B else { return nil }
        var depth = 1
        var i = start + 2
        while i < limit {
            if chars[i] == 0x5C { i += 2; continue }
            if chars[i] == 0x5B { depth += 1 } else if chars[i] == 0x5D {
                depth -= 1
                if depth == 0 { break }
            }
            i += 1
        }
        guard i < limit, depth == 0, i + 1 < limit, chars[i + 1] == 0x28 else { return nil }
        let alt = string(start + 2, i)

        func skipSpace(_ from: Int) -> Int {
            var p = from
            while p < limit, [0x20, 0x09, 0x0A, 0x0D].contains(chars[p]) { p += 1 }
            return p
        }
        var p = skipSpace(i + 2)
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
            if p == addressStart { return nil }
        }
        var address = string(addressStart, p)
        if address.hasPrefix("<"), address.hasSuffix(">") { address = String(address.dropFirst().dropLast()) }
        guard !address.isEmpty else { return nil }

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
        return LiveModel.PictureNode(node: NSRange(location: start, length: p + 1 - start), src: address, alt: alt, title: title)
    }

    private func string(_ from: Int, _ to: Int) -> String { String(decoding: chars[from..<to], as: UTF16.self) }

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
