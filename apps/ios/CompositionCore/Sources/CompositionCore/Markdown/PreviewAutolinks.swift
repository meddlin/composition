import Foundation

// Bare web and e-mail addresses in the preview (GFM's autolink literals), found as the desktop's preview finds them. The desktop reads a note with
// remark-gfm 4, which finds them twice over: while it reads the text (micromark-extension-gfm-autolink-literal 2.1: `http://` and `https://`, `www.`,
// `name@host.tld`, each with its own rule for what may come before it and where it ends), and then once more over the text that is left
// (mdast-util-gfm-autolink-literal 2.0: two regular expressions, with a looser rule for what comes before, which links `x:www.a.test` and
// `www.`'s `www`). Both are ported here, in that order. swift-markdown has no autolink extension, so this reads the runs of plain text cmark leaves.
//
// The Live tab finds bare addresses by the desktop's editor's rules instead (lezer's, `LiveReader.bareAddresses`); they differ in places.
//
// fixtures/conformance/preview-text.json holds what remark-gfm makes of awkward cases, and `PreviewTextConformanceTests` replays it. What this cannot
// match: micromark reads an address before emphasis, code or an HTML tag in it (`www.a.test/*b*` is one link there, where cmark has found the emphasis
// first), it does not read one after an unclosed `[` with its first rule (the second still does, a little differently), and it reads `&amp;` in an
// address as written where cmark's text has `&`.
enum PreviewAutolinks {
    enum Piece: Equatable {
        case text(String)
        case link(url: String, text: String)
    }

    /// A run of plain text (what cmark leaves between other inline nodes; a soft line break is its `\n`) cut into text and links.
    static func pieces(_ text: String) -> [Piece] {
        guard text.contains("@") || text.contains("://") || text.range(of: "www.", options: .caseInsensitive) != nil else { return [.text(text)] }
        let units = Array(text.utf16)
        var segments = Reader(units: units).segments()
        segments = segments.flatMap { $0.url == nil ? Transform(units: units).urls(in: $0.range) : [$0] }
        segments = segments.flatMap { $0.url == nil ? Transform(units: units).emails(in: $0.range) : [$0] }
        return segments.map { segment in
            let string = String(decoding: units[segment.range], as: UTF16.self)
            return segment.url.map { .link(url: $0, text: string) } ?? .text(string)
        }
    }

    /// A piece of the run: text, or a link to `url` (written as the units of `range`).
    struct Segment {
        var range: Range<Int>
        var url: String?
    }

    // MARK: Characters (micromark-util-character)

    static func isAsciiAlpha(_ c: UInt16) -> Bool { (0x41...0x5A).contains(c) || (0x61...0x7A).contains(c) }
    static func isAsciiDigit(_ c: UInt16) -> Bool { (0x30...0x39).contains(c) }
    static func isAsciiAlphanumeric(_ c: UInt16) -> Bool { isAsciiAlpha(c) || isAsciiDigit(c) }
    static func isAsciiControl(_ c: UInt16) -> Bool { c < 0x20 || c == 0x7F }
    /// `markdownLineEndingOrSpace`: a tab, a line ending or a space.
    static func isSpaceOrLineEnding(_ c: UInt16) -> Bool { c == 0x09 || c == 0x0A || c == 0x0D || c == 0x20 }
    /// JavaScript's `\s`.
    static func isUnicodeWhitespace(_ c: UInt16) -> Bool {
        switch c {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    /// `\p{P}|\p{S}` of one UTF-16 unit (half of a surrogate pair is neither, as in JavaScript).
    static func isUnicodePunctuation(_ c: UInt16) -> Bool { Unicode.Scalar(c).map(isPunctuation) ?? false }

    static func isPunctuation(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation,
            .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol:
            true
        default: false
        }
    }

    /// `[\w]` as JavaScript reads it without the `u` flag.
    static func isWord(_ c: UInt16) -> Bool { isAsciiAlphanumeric(c) || c == 0x5F }

    // MARK: While reading (micromark-extension-gfm-autolink-literal)

    struct Reader {
        let units: [UInt16]

        private func at(_ i: Int) -> UInt16? { i < units.count ? units[i] : nil }

        /// The run cut where an address is read. micromark tries an e-mail address at every letter, digit and `+-._`, `http` at an `h` and `www.` at a
        /// `w` (the e-mail address first), each only after a character it allows.
        func segments() -> [Segment] {
            var out: [Segment] = []
            var textStart = 0, i = 0
            while i < units.count {
                let previous: UInt16? = i > 0 ? units[i - 1] : nil
                let c = units[i]
                var found: Segment?
                if isGfmAtext(c) { found = email(at: i, previous: previous) }
                if found == nil, c == 0x48 || c == 0x68 { found = protocolLink(at: i, previous: previous) }
                if found == nil, c == 0x57 || c == 0x77 { found = wwwLink(at: i, previous: previous) }
                guard let found else { i += 1; continue }
                if textStart < i { out.append(Segment(range: textStart..<i)) }
                out.append(found)
                i = found.range.upperBound
                textStart = i
            }
            if textStart < units.count { out.append(Segment(range: textStart..<units.count)) }
            return out
        }

        private func string(_ range: Range<Int>) -> String { String(decoding: units[range], as: UTF16.self) }

        private func isGfmAtext(_ c: UInt16) -> Bool { c == 0x2B || c == 0x2D || c == 0x2E || c == 0x5F || PreviewAutolinks.isAsciiAlphanumeric(c) }

        /// `tokenizeEmailAutolink`: letters, digits and `+-._`, an `@`, then a host with a dot in it that ends in a letter.
        private func email(at start: Int, previous: UInt16?) -> Segment? {
            if let previous, previous == 0x2F || isGfmAtext(previous) { return nil }
            var p = start
            while let c = at(p), isGfmAtext(c) { p += 1 }
            guard at(p) == 0x40 else { return nil }
            p += 1
            var dot = false, data = false
            while let c = at(p) {
                if c == 0x2E {
                    // A dot followed by a letter or digit is part of the host; any other ends it.
                    guard let next = at(p + 1), PreviewAutolinks.isAsciiAlphanumeric(next) else { break }
                    dot = true
                    p += 1
                } else if c == 0x2D || c == 0x5F || PreviewAutolinks.isAsciiAlphanumeric(c) {
                    data = true
                    p += 1
                } else {
                    break
                }
            }
            guard data, dot, PreviewAutolinks.isAsciiAlpha(units[p - 1]) else { return nil }
            return Segment(range: start..<p, url: "mailto:" + string(start..<p))
        }

        /// `tokenizeProtocolAutolink`: `http://` or `https://` in any case, then a host and a path.
        private func protocolLink(at start: Int, previous: UInt16?) -> Segment? {
            if let previous, PreviewAutolinks.isAsciiAlpha(previous) { return nil }
            var p = start + 1
            while let c = at(p), PreviewAutolinks.isAsciiAlpha(c), p - start < 5 { p += 1 }
            let scheme = string(start..<p).lowercased()
            guard at(p) == 0x3A, scheme == "http" || scheme == "https", at(p + 1) == 0x2F, at(p + 2) == 0x2F else { return nil }
            p += 3
            guard let c = at(p), !PreviewAutolinks.isAsciiControl(c), !PreviewAutolinks.isSpaceOrLineEnding(c), !PreviewAutolinks.isUnicodeWhitespace(c),
                !PreviewAutolinks.isUnicodePunctuation(c), let host = domain(from: p)
            else { return nil }
            let end = path(from: host)
            return Segment(range: start..<end, url: string(start..<end))
        }

        /// `tokenizeWwwAutolink`: `www.` in any case and something after it, then a host (from the first `w`) and a path.
        private func wwwLink(at start: Int, previous: UInt16?) -> Segment? {
            if let previous, ![0x28, 0x2A, 0x5F, 0x5B, 0x5D, 0x7E].contains(previous), !PreviewAutolinks.isSpaceOrLineEnding(previous) { return nil }
            for k in 0..<3 { guard let c = at(start + k), c == 0x57 || c == 0x77 else { return nil } }
            guard at(start + 3) == 0x2E, at(start + 4) != nil, let host = domain(from: start) else { return nil }
            let end = path(from: host)
            return Segment(range: start..<end, url: "http://" + string(start..<end))
        }

        /// `tokenizeDomain`: where a host that starts at `p` ends, or nil when it has none, or a `_` in either of its last two parts.
        private func domain(from start: Int) -> Int? {
            var p = start
            var underscoreInLast = false, underscoreInLastButOne = false, seen = false
            while true {
                let c = at(p)
                if c == 0x2E || c == 0x5F {
                    if trail(at: p) { break }
                    if c == 0x5F {
                        underscoreInLast = true
                    } else {
                        underscoreInLastButOne = underscoreInLast
                        underscoreInLast = false
                    }
                    p += 1
                    continue
                }
                guard let c, !PreviewAutolinks.isSpaceOrLineEnding(c), !PreviewAutolinks.isUnicodeWhitespace(c), c == 0x2D || !PreviewAutolinks.isUnicodePunctuation(c)
                else { break }
                seen = true
                p += 1
            }
            return underscoreInLast || underscoreInLastButOne || !seen ? nil : p
        }

        /// `tokenizePath`: where the path from `p` ends. Brackets are kept while they balance; punctuation is kept unless only punctuation follows.
        private func path(from start: Int) -> Int {
            var p = start
            var open = 0, close = 0
            while let c = at(p) {
                if c == 0x28 {
                    open += 1
                } else if c == 0x29, close < open {
                    close += 1
                } else if [0x21, 0x22, 0x26, 0x27, 0x29, 0x2A, 0x2C, 0x2E, 0x3A, 0x3B, 0x3C, 0x3F, 0x5D, 0x5F, 0x7E].contains(c) {
                    if trail(at: p) { return p }
                    if c == 0x29 { close += 1 }
                } else if PreviewAutolinks.isSpaceOrLineEnding(c) || PreviewAutolinks.isUnicodeWhitespace(c) {
                    return p
                }
                p += 1
            }
            return p
        }

        /// `tokenizeTrail`: whether what starts at `p` is only trailing punctuation (and `&name;`, and a `]` before a bracket or a space) to the end of
        /// the address, which is a space, a `<` or the end of the run.
        private func trail(at start: Int) -> Bool {
            var p = start
            while true {
                guard let c = at(p) else { return true }
                if [0x21, 0x22, 0x27, 0x29, 0x2A, 0x2C, 0x2E, 0x3A, 0x3B, 0x3F, 0x5F, 0x7E].contains(c) {
                    p += 1
                } else if c == 0x26 {
                    p += 1
                    guard let first = at(p), PreviewAutolinks.isAsciiAlpha(first) else { return false }
                    while let c = at(p), PreviewAutolinks.isAsciiAlpha(c) { p += 1 }
                    guard at(p) == 0x3B else { return false }
                    p += 1
                } else if c == 0x5D {
                    p += 1
                    guard let next = at(p) else { return true }
                    if next == 0x28 || next == 0x5B || PreviewAutolinks.isSpaceOrLineEnding(next) || PreviewAutolinks.isUnicodeWhitespace(next) { return true }
                } else {
                    return c == 0x3C || PreviewAutolinks.isSpaceOrLineEnding(c) || PreviewAutolinks.isUnicodeWhitespace(c)
                }
            }
        }
    }

    // MARK: Over the text left (mdast-util-gfm-autolink-literal)

    /// `transformGfmAutolinkLiterals`: `findAndReplace` over each piece of text left, which it treats as a text node of its own (its start counts as a
    /// space before it).
    struct Transform {
        let units: [UInt16]

        private func string(_ range: Range<Int>) -> String { String(decoding: units[range], as: UTF16.self) }

        /// `/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi` and `findUrl`.
        func urls(in range: Range<Int>) -> [Segment] {
            replacing(in: range) { p in
                guard let match = urlMatch(at: p, in: range), previousAllowed(p, in: range, email: false) else { return nil }
                let www = units[p] == 0x57 || units[p] == 0x77
                let domainStart = www ? p : match.domain.lowerBound
                guard correctDomain(domainStart..<match.domain.upperBound) else { return nil }
                let kept = splitURL(domainStart..<match.end)
                guard kept > domainStart else { return nil }
                return (link: Segment(range: p..<kept, url: (www ? "http://" : "") + string(p..<kept)), end: match.end)
            }
        }

        /// `/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu` and `findEmail`.
        func emails(in range: Range<Int>) -> [Segment] {
            replacing(in: range) { p in
                guard let end = emailMatch(at: p, in: range), previousAllowed(p, in: range, email: true) else { return nil }
                // The host may not end in `-`, a digit or `_`.
                let last = units[end - 1]
                guard last != 0x2D, last != 0x5F, !PreviewAutolinks.isAsciiDigit(last) else { return nil }
                return (link: Segment(range: p..<end, url: "mailto:" + string(p..<end)), end: end)
            }
        }

        /// What `findAndReplace` does with one expression: from the left, a match the handler refuses is tried again one place on; one it takes is
        /// replaced by the link and what follows the link up to the match's end (as text), and the search goes on after it.
        private func replacing(in range: Range<Int>, _ handler: (Int) -> (link: Segment, end: Int)?) -> [Segment] {
            var out: [Segment] = []
            var start = range.lowerBound, p = range.lowerBound
            while p < range.upperBound {
                guard let found = handler(p) else { p += 1; continue }
                if start < p { out.append(Segment(range: start..<p)) }
                out.append(found.link)
                if found.link.range.upperBound < found.end { out.append(Segment(range: found.link.range.upperBound..<found.end)) }
                start = found.end
                p = found.end
            }
            if start < range.upperBound { out.append(Segment(range: start..<range.upperBound)) }
            return out
        }

        private func at(_ i: Int, in range: Range<Int>) -> UInt16? { i < range.upperBound ? units[i] : nil }

        private func lowered(_ c: UInt16) -> UInt16 { (0x41...0x5A).contains(c) ? c + 0x20 : c }

        /// The URL expression matched at `p`: its host (`[-.\w]+`, after `http://`, `https://` or `www` before a dot) and where the path ends.
        private func urlMatch(at p: Int, in range: Range<Int>) -> (domain: Range<Int>, end: Int)? {
            func has(_ prefix: String, at q: Int) -> Bool {
                var i = q
                for unit in prefix.utf16 {
                    guard let c = at(i, in: range), lowered(c) == unit else { return false }
                    i += 1
                }
                return true
            }
            var domainStart: Int?
            if has("https://", at: p) { domainStart = p + 8 } else if has("http://", at: p) { domainStart = p + 7 }
            if domainStart == nil || at(domainStart!, in: range).map({ PreviewAutolinks.isWord($0) || $0 == 0x2D || $0 == 0x2E }) != true {
                guard has("www", at: p), at(p + 3, in: range) == 0x2E else { return nil }
                domainStart = p + 3
            }
            var q = domainStart!
            while let c = at(q, in: range), PreviewAutolinks.isWord(c) || c == 0x2D || c == 0x2E { q += 1 }
            guard q > domainStart! else { return nil }
            let domainEnd = q
            while let c = at(q, in: range), c != 0x20, c != 0x09, c != 0x0D, c != 0x0A { q += 1 }
            return (domainStart!..<domainEnd, q)
        }

        /// Where the e-mail expression matched at `p` ends.
        private func emailMatch(at p: Int, in range: Range<Int>) -> Int? {
            // Its lookbehind (the start of the text, a space, punctuation or a symbol before it) is left to `previousAllowed`, which asks the same
            // of the unit before (and refuses half of a surrogate pair, where the lookbehind would take the whole character): either way no link.
            var q = p
            while let c = at(q, in: range), PreviewAutolinks.isWord(c) || c == 0x2D || c == 0x2E || c == 0x2B { q += 1 }
            guard q > p, at(q, in: range) == 0x40 else { return nil }
            q += 1
            func label(_ from: Int) -> Int {
                var i = from
                while let c = at(i, in: range), PreviewAutolinks.isWord(c) || c == 0x2D { i += 1 }
                return i
            }
            let first = label(q)
            guard first > q else { return nil }
            var end = first, parts = 0
            while at(end, in: range) == 0x2E {
                let next = label(end + 1)
                guard next > end + 1 else { break }
                end = next
                parts += 1
            }
            return parts > 0 ? end : nil
        }

        /// `previous`: the match starts the text, or follows a space or punctuation (and, for an e-mail address, not a `/`).
        private func previousAllowed(_ p: Int, in range: Range<Int>, email: Bool) -> Bool {
            guard p > range.lowerBound else { return true }
            let c = units[p - 1]
            return (PreviewAutolinks.isUnicodeWhitespace(c) || PreviewAutolinks.isUnicodePunctuation(c)) && !(email && c == 0x2F)
        }

        /// `isCorrectDomain`: two parts at least, and neither of the last two (when not empty) holds a `_` or lacks a letter or digit.
        private func correctDomain(_ range: Range<Int>) -> Bool {
            let parts = units[range].split(separator: 0x2E, omittingEmptySubsequences: false)
            guard parts.count >= 2 else { return false }
            for part in parts.suffix(2) where !part.isEmpty {
                if part.contains(0x5F) || !part.contains(where: PreviewAutolinks.isAsciiAlphanumeric) { return false }
            }
            return true
        }

        /// `splitUrl`: where the link ends once trailing punctuation (`!"&'),.:;<>?]}`) is taken off, a `)` kept for each `(` it closes.
        private func splitURL(_ range: Range<Int>) -> Int {
            let trailing: Set<UInt16> = [0x21, 0x22, 0x26, 0x27, 0x29, 0x2C, 0x2E, 0x3A, 0x3B, 0x3C, 0x3E, 0x3F, 0x5D, 0x7D]
            var cut = range.upperBound
            while cut > range.lowerBound, trailing.contains(units[cut - 1]) { cut -= 1 }
            guard cut < range.upperBound else { return cut }
            let opening = units[range.lowerBound..<cut].filter { $0 == 0x28 }.count
            var closing = units[range.lowerBound..<cut].filter { $0 == 0x29 }.count
            var end = cut
            while opening > closing, let paren = units[end..<range.upperBound].firstIndex(of: 0x29) {
                end = paren + 1
                closing += 1
            }
            return end
        }
    }
}

extension PreviewAutolinks.Segment {
    init(range: Range<Int>) { self.init(range: range, url: nil) }
}
