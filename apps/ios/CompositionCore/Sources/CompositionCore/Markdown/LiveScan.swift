import Foundation

// What the Live view needs to know of a note's text beyond its Markdown tree: the desktop's `scanOf` (liveMarkdown.ts), which reads the text with
// `tokenizeMarkdown` (markdownTokens.ts, to tell where code is), `markTints` and `markElements` (markTints.ts) and `imageElements` (liveImages.ts).
// A port, and checked as one: LiveConformanceTests runs the desktop's real code over the same texts. The regular expressions are the desktop's with
// JavaScript's `\w`, `\s`, `\S`, `\b` and `.` written out, because ICU's are wider (Unicode word characters and spaces, more line terminators).

enum LiveScan {
    struct Tint: Hashable, Sendable {
        var range: NSRange
        var color: String
    }

    /// A highlight's pair of tags.
    struct MarkElement: Hashable, Sendable {
        var open: NSRange
        var close: NSRange
    }

    /// An `<Image … />` as the text writes it.
    struct ImageTag: Hashable, Sendable {
        var range: NSRange
        var src: String
        var alt: String
        var title: String
        var width: String
    }

    struct Result: Equatable, Sendable {
        var tints: [Tint] = []
        var elements: [MarkElement] = []
        var images: [ImageTag] = []

        /// Where these places are after `edit` (a range of the old text) was replaced by text `delta` units longer: what is before it stays, what is after it moves,
        /// a highlight's tinted stretch that holds the edit takes it in (so typing in a highlight keeps it tinted), and a tag or an `<Image />` that the edit
        /// touches is dropped, as it may no longer be one. A full read after a pause puts right what this gets wrong (a tag typed, or broken).
        func shifted(replacing edit: NSRange, by delta: Int) -> Result {
            func moved(_ range: NSRange) -> NSRange? {
                if NSMaxRange(range) <= edit.location { return range }
                if range.location >= NSMaxRange(edit) { return NSRange(location: range.location + delta, length: range.length) }
                return nil
            }
            var out = Result()
            for tint in tints {
                if tint.range.location <= edit.location, NSMaxRange(edit) <= NSMaxRange(tint.range) {
                    out.tints.append(Tint(range: NSRange(location: tint.range.location, length: tint.range.length + delta), color: tint.color))
                } else if let range = moved(tint.range) {
                    out.tints.append(Tint(range: range, color: tint.color))
                }
            }
            for element in elements {
                if let open = moved(element.open), let close = moved(element.close) { out.elements.append(MarkElement(open: open, close: close)) }
            }
            for image in images {
                if let range = moved(image.range) { out.images.append(ImageTag(range: range, src: image.src, alt: image.alt, title: image.title, width: image.width)) }
            }
            return out
        }

        /// The places in which this and `other` differ: what one has and the other has not.
        func differences(from other: Result) -> [NSRange] {
            var found: [NSRange] = []
            let oldTints = Set(other.tints), newTints = Set(tints)
            found += newTints.symmetricDifference(oldTints).map(\.range)
            func whole(_ element: MarkElement) -> NSRange { NSRange(location: element.open.location, length: NSMaxRange(element.close) - element.open.location) }
            found += Set(elements).symmetricDifference(Set(other.elements)).map(whole)
            found += Set(images).symmetricDifference(Set(other.images)).map(\.range)
            // In order, with places that overlap or touch made into one.
            var joined: [NSRange] = []
            for range in found.sorted(by: { $0.location < $1.location }) {
                if let last = joined.last, range.location <= NSMaxRange(last) { joined[joined.count - 1] = NSUnionRange(last, range) } else { joined.append(range) }
            }
            return joined
        }
    }

    // JavaScript's `\s`, `\w`, and `.`, as character-class contents.
    private static let space = #"\t\n\u000B\f\r    -     　﻿"#
    private static let word = "A-Za-z0-9_"
    private static let dot = #"[^\n\r  ]"#

    private static let markTag = try! NSRegularExpression(pattern: "<Mark(?![\(word)])[^<>]*>|</Mark[\(space)]*>")
    private static let color = try! NSRegularExpression(pattern: "(?<![\(word)])color=\"([^\"]*)\"")
    private static let imageTag = try! NSRegularExpression(pattern: "<Image(?![\(word)])[^<>]*/>")
    private static let prop = try! NSRegularExpression(
        pattern: "(?<![\(word)])([A-Za-z]+)[\(space)]*=[\(space)]*(?:\"([^\"]*)\"|'([^']*)'|\\{[\(space)]*\"([^\"]*)\"[\(space)]*\\})")

    /// Reads `text`: the highlights' tints and tags, and the `<Image />` tags, outside code and frontmatter.
    static func read(_ text: String) -> Result {
        let ns = text as NSString
        let hasMark = ns.range(of: "<Mark", options: .literal).location != NSNotFound
        let hasImage = ns.range(of: "<Image", options: .literal).location != NSNotFound
        guard hasMark || hasImage else { return Result() }
        let literal = Literals(MarkdownLiterals.ranges(in: ns))
        var result = Result()
        if hasMark { markUp(ns, literal: literal, into: &result) }
        if hasImage { imagesIn(ns, literal: literal, into: &result) }
        return result
    }

    /// `markTints` and `markElements` together: they pair tags in the same way. A tag left open, one closed twice and a self-closing one are ignored.
    private static func markUp(_ text: NSString, literal: Literals, into result: inout Result) {
        final class Open { var color: String; var closed = false; init(_ color: String) { self.color = color } }
        var open: [(owner: Open, tag: NSRange)] = []
        var spans: [(range: NSRange, color: String, owner: Open)] = []
        var elements: [MarkElement] = []
        var cursor = 0
        for match in markTag.matches(in: text as String, range: NSRange(location: 0, length: text.length)) {
            let tag = match.range
            if literal.contains(tag.location) { continue }
            let source = text.substring(with: tag)
            let closing = source.hasPrefix("</")
            if !closing, source.hasSuffix("/>") { continue }
            if closing, open.isEmpty { continue }

            if let owner = open.last?.owner, tag.location > cursor {
                spans.append((NSRange(location: cursor, length: tag.location - cursor), owner.color, owner))
            }
            cursor = NSMaxRange(tag)
            if closing {
                let opened = open.removeLast()
                opened.owner.closed = true
                elements.append(MarkElement(open: opened.tag, close: tag))
            } else {
                let given = color.firstMatch(in: source, range: NSRange(location: 0, length: (source as NSString).length))
                    .map { (source as NSString).substring(with: $0.range(at: 1)) }
                open.append((Open(MarkHighlight.colors.contains(given ?? "") ? given! : MarkHighlight.defaultColor), tag))
            }
        }
        result.tints = spans.filter(\.owner.closed).map { Tint(range: $0.range, color: $0.color) }
        result.elements = elements.sorted { $0.open.location < $1.open.location }
    }

    /// `imageElements`: each complete `<Image … />`, with the props it writes as quoted text. One with no `src` is skipped.
    private static func imagesIn(_ text: NSString, literal: Literals, into result: inout Result) {
        for match in imageTag.matches(in: text as String, range: NSRange(location: 0, length: text.length)) {
            if literal.contains(match.range.location) { continue }
            let tag = text.substring(with: match.range) as NSString
            var props: [String: String] = [:]
            for found in prop.matches(in: tag as String, range: NSRange(location: 0, length: tag.length)) {
                let name = tag.substring(with: found.range(at: 1))
                for group in 2...4 where found.range(at: group).location != NSNotFound {
                    props[name] = tag.substring(with: found.range(at: group))
                    break
                }
            }
            guard let src = props["src"], !src.isEmpty else { continue }
            result.images.append(ImageTag(range: match.range, src: src, alt: props["alt"] ?? "", title: props["title"] ?? "", width: props["width"] ?? ""))
        }
    }

    /// Whether an index is in a stretch whose tags are not tags (`literalFinder`).
    struct Literals {
        private let ranges: [NSRange]

        init(_ ranges: [NSRange]) { self.ranges = ranges }

        func contains(_ index: Int) -> Bool {
            var low = 0, high = ranges.count
            while low < high {
                let middle = (low + high) / 2
                if NSMaxRange(ranges[middle]) <= index { low = middle + 1 } else { high = middle }
            }
            return low < ranges.count && ranges[low].location <= index
        }
    }

    // MARK: Where code is

    /// `tokenizeMarkdown`, as far as it says where code is: the stretches it calls frontmatter, a fence or code, in order. Line by line, remembering
    /// only whether it is inside a fence, as the desktop's does.
    enum MarkdownLiterals {
        private static let frontmatter = try! NSRegularExpression(pattern: #"^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?"#)
        /// The desktop's INLINE, one alternation so the leftmost construct wins: 1 an escape, 2 code, 4 a link, 7 a tag, 8 bold, 9 italic.
        private static let inline: NSRegularExpression = {
            let s = LiveScan.space, w = LiveScan.word, dot = LiveScan.dot
            let pattern = #"""
            (\\[\\`*_{}\[\]()#+\-.!<>~|])\
            |((`+)(?!`)\#(dot)+?(?<!`)\3(?!`))\
            |((!?\[[^\]]*\])(\([^)]*\)))\
            |(<\/?[A-Za-z][^<>]*>)\
            |(\*\*(?=[^\#(s)])\#(dot)+?(?<=[^\#(s)])\*\*|(?<![\#(w)])__(?=[^\#(s)])\#(dot)+?(?<=[^\#(s)])__(?![\#(w)]))\
            |((?<!\*)\*(?=[^\#(s)*])\#(dot)+?(?<=[^\#(s)*])\*(?!\*)|(?<![\#(w)])_(?=[^\#(s)_])\#(dot)+?(?<=[^\#(s)_])_(?![\#(w)]))
            """#
            return try! NSRegularExpression(pattern: pattern.replacingOccurrences(of: "\\\n", with: ""))
        }()

        /// Past this a line is left plain (`MAX_INLINE_LINE`).
        private static let maxInlineLine = 2000

        static func ranges(in text: NSString) -> [NSRange] {
            let chars = (0..<text.length).map { text.character(at: $0) }
            var out: [NSRange] = []
            var position = 0
            if let block = frontmatter.firstMatch(in: text as String, range: NSRange(location: 0, length: text.length)) {
                out.append(block.range)
                position = NSMaxRange(block.range)
            }
            var fence: (char: UInt16, length: Int)?
            while position < text.length {
                var end = position
                while end < text.length, chars[end] != 0x0A { end += 1 }
                var lineEnd = end
                if lineEnd > position, chars[lineEnd - 1] == 0x0D { lineEnd -= 1 }
                fence = line(NSRange(location: position, length: lineEnd - position), in: text, chars: chars, fence: fence, out: &out)
                position = end + 1
            }
            return out
        }

        /// One line; returns the fence the next line is inside, if any.
        private static func line(_ range: NSRange, in text: NSString, chars: [UInt16], fence: (char: UInt16, length: Int)?, out: inout [NSRange]) -> (char: UInt16, length: Int)? {
            let start = range.location, end = NSMaxRange(range)
            func skipSpaces(_ from: Int, max count: Int) -> Int {
                var i = from
                while i < end, i - from < count, chars[i] == 0x20 { i += 1 }
                return i
            }
            /// A run of three or more backticks or tildes after up to three spaces: its character, its length and where it ends.
            func fenceRun() -> (char: UInt16, length: Int, end: Int)? {
                let i = skipSpaces(start, max: 3)
                guard i < end, chars[i] == 0x60 || chars[i] == 0x7E else { return nil }
                var j = i
                while j < end, chars[j] == chars[i] { j += 1 }
                return j - i >= 3 ? (chars[i], j - i, j) : nil
            }

            if let fence {
                if let run = fenceRun(), run.char == fence.char, run.length >= fence.length,
                    (run.end..<end).allSatisfy({ chars[$0] == 0x20 || chars[$0] == 0x09 }) {
                    out.append(range)
                    return nil
                }
                out.append(range)
                return fence
            }

            if let run = fenceRun() {
                let info = (run.end..<end).map { chars[$0] }
                // The rest of the line must be one JavaScript `.` can cross (no `\r`, U+2028 or U+2029), and an info string cannot hold a backtick.
                if !info.contains(where: { $0 == 0x0D || $0 == 0x2028 || $0 == 0x2029 }), !(run.char == 0x60 && info.contains(0x60)) {
                    out.append(range)
                    return (run.char, run.length)
                }
            }

            // A heading: up to three spaces, one to six `#`, then a space, a tab or the end.
            var i = skipSpaces(start, max: 3)
            var hashes = 0
            while i + hashes < end, chars[i + hashes] == 0x23 { hashes += 1 }
            if (1...6).contains(hashes), i + hashes == end || chars[i + hashes] == 0x20 || chars[i + hashes] == 0x09 { return nil }
            if isThematicBreak(chars, start, end) { return nil }

            // The quote marks, then the list marker, then the text.
            var rest = start
            i = skipSpaces(start, max: 3)
            if i < end, chars[i] == 0x3E {
                while i < end, chars[i] == 0x3E {
                    i += 1
                    if i < end, chars[i] == 0x20 || chars[i] == 0x09 { i += 1 }
                }
                rest = i
            }
            i = rest
            while i < end, chars[i] == 0x20 || chars[i] == 0x09 { i += 1 }
            var after = i
            if after < end, [0x2D, 0x2A, 0x2B].contains(chars[after]) {
                after += 1
            } else {
                while after < end, after - i < 10, (0x30...0x39).contains(chars[after]) { after += 1 }
                if (1...9).contains(after - i), after < end, chars[after] == 0x2E || chars[after] == 0x29 { after += 1 } else { after = i }
            }
            if after > i, after < end, chars[after] == 0x20 || chars[after] == 0x09 {
                while after < end, chars[after] == 0x20 || chars[after] == 0x09 { after += 1 }
                rest = after
            }

            guard end - rest <= maxInlineLine, end > rest else { return nil }
            for match in inline.matches(in: text as String, range: NSRange(location: rest, length: end - rest))
            where match.range(at: 1).location == NSNotFound && match.range(at: 2).location != NSNotFound {
                out.append(match.range)
            }
            return nil
        }

        /// Three or more of one of `-`, `*`, `_`, with spaces or tabs between and after them, after up to three spaces (`isThematicBreak`).
        private static func isThematicBreak(_ chars: [UInt16], _ start: Int, _ end: Int) -> Bool {
            var i = start
            while i < end, i - start < 3, chars[i] == 0x20 { i += 1 }
            guard i < end, [0x2D, 0x2A, 0x5F].contains(chars[i]) else { return false }
            let marker = chars[i]
            var count = 0
            while i < end {
                if chars[i] == marker { count += 1 } else if chars[i] != 0x20, chars[i] != 0x09 { return false }
                i += 1
            }
            return count >= 3
        }
    }
}
