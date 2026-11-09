import Foundation
import Markdown

// The Live view's model (docs/ipad-live-view-plan.md, step L2). The Live view is the Markdown editor with its syntax hidden away from the caret: a
// note drawn as it will read, the marks (`#`, `**`, `~~`, backticks, a rule's dashes, a highlight's tags) showing only where you are writing. This
// is the part that needs no text view: from the note's text and a selection, which ranges are hidden and which shown, which are styled, which lines
// are headings or rules, which stretches are tinted and which pictures are drawn. The desktop's `liveDecorations` (liveMarkdown.ts) is the spec, and
// LiveConformanceTests run it, on a real CodeMirror state, over the same texts and selections: what it hides, shows, styles, draws and tints, this
// does too. Offsets are UTF-16 units, as in the text view. The desktop works on text with one `\n` for each line break (CodeMirror reads `\r\n` as
// one); this reads the text as it is, and its offsets are the text's.
//
// Two parts are the iPad's own and are not in the check, because the desktop has nothing to compare: a fenced code block's two fences are hidden
// while the selection is elsewhere and both shown while it is anywhere in the block (decision V2), and colours (code, links, tags, list and quote
// marks) are the Markdown tab's, so they are not here at all.

/// How the Live view draws a styled run of text.
public enum LiveStyle: String, Equatable, Sendable {
    case strong, emphasis, strike, code
}

/// What the Live view does to a note for one selection. Ranges are in the note's text; each list is in the order the note holds them.
public struct LiveDecorations: Equatable, Sendable {
    public struct Heading: Equatable, Sendable {
        /// The start of the heading's line.
        public var line: Int
        public var level: Int
        /// The whole line, from its start to the end of its text: what is drawn large.
        public var range: NSRange
    }

    public struct Style: Equatable, Sendable {
        public var style: LiveStyle
        public var range: NSRange
    }

    public struct Picture: Equatable, Sendable {
        /// The text that writes the picture: `![alt](src "title")` or `<Image … />`.
        public var range: NSRange
        /// Nothing but space is on its line with it: such a picture is drawn in place of its text. One in the middle of a sentence (the desktop draws it inline) is
        /// left as its text, because drawing it in the line would need something in the text that is not its characters.
        public var ownLine = false
        /// The selection is on that text. It stays showing, and the picture is drawn after it; otherwise the picture is drawn in its place.
        public var active: Bool
        public var src: String
        public var alt: String
        public var title: String
        public var width: String
    }

    public struct Tint: Equatable, Sendable {
        public var range: NSRange
        /// One of `MdxProps.highlightColors`.
        public var color: String
    }

    /// The start of each line of the frontmatter (it is drawn set apart, and never hidden).
    public var frontmatterLines: [Int] = []
    /// The whole frontmatter, from its first character to the end of its last line, when the note has one.
    public var frontmatterRange: NSRange?
    public var headings: [Heading] = []
    /// The start of the line of each rule that is drawn as a line (a rule the selection is on shows its dashes and is not drawn).
    public var rules: [Int] = []
    public var styles: [Style] = []
    /// Marks that are not drawn at all.
    public var hidden: [NSRange] = []
    /// Marks that show, dimmed, because the selection is in their construct.
    public var shown: [NSRange] = []
    public var pictures: [Picture] = []
    public var tints: [Tint] = []
    /// The iPad's own (decision V2): a fenced block's fences, hidden while the selection is outside the block, and shown while it is in it.
    public var fencesHidden: [NSRange] = []
    public var fencesShown: [NSRange] = []
}

public struct LiveModel: Sendable {
    /// The desktop reads highlights and `<Image />` tags only in a note this long or shorter (`MAX_HIGHLIGHT_CHARS`).
    public static let desktopExtrasLimit = 100_000

    struct HeadingNode: Sendable {
        var line: Int
        var level: Int
        var node: NSRange
        /// Each mark as it shows, and as it hides (the space after the opening `#`s goes with them, or the title would sit indented).
        var marks: [(shown: NSRange, hidden: NSRange)]
    }

    struct RuleNode: Sendable {
        var line: Int
        var node: NSRange
    }

    struct StyleNode: Sendable {
        var style: LiveStyle
        var node: NSRange
        var marks: [NSRange]
    }

    struct PictureNode: Sendable {
        var node: NSRange
        var src: String
        var alt: String
        var title: String
    }

    struct FenceNode: Sendable {
        var node: NSRange
        var fences: [NSRange]
    }

    /// Everything in the note that the selection can reveal, in one list ordered by where it starts.
    enum Construct: Sendable {
        case heading(HeadingNode)
        case rule(RuleNode)
        case style(StyleNode)
        case picture(PictureNode)
        case fenced(FenceNode)

        var node: NSRange {
            switch self {
            case .heading(let value): value.node
            case .rule(let value): value.node
            case .style(let value): value.node
            case .picture(let value): value.node
            case .fenced(let value): value.node
            }
        }

        /// The same construct `delta` units further on in the text.
        func shifted(by delta: Int) -> Construct {
            func move(_ range: NSRange) -> NSRange { NSRange(location: range.location + delta, length: range.length) }
            switch self {
            case .heading(var value):
                value.line += delta
                value.node = move(value.node)
                value.marks = value.marks.map { (move($0.shown), move($0.hidden)) }
                return .heading(value)
            case .rule(var value):
                value.line += delta
                value.node = move(value.node)
                return .rule(value)
            case .style(var value):
                value.node = move(value.node)
                value.marks = value.marks.map(move)
                return .style(value)
            case .picture(var value):
                value.node = move(value.node)
                return .picture(value)
            case .fenced(var value):
                value.node = move(value.node)
                value.fences = value.fences.map(move)
                return .fenced(value)
            }
        }
    }

    /// The length of the text, in UTF-16 units.
    public private(set) var length: Int
    private var chars: [UInt16]
    private var constructs: [Construct]
    /// `reach[i]` is how far any of the first `i + 1` constructs reaches: it never goes down, so the first construct that reaches a place is found by search.
    private var reach: [Int]
    private var frontmatterLines: [Int]
    private var scan: LiveScan.Result
    private let extrasLimit: Int?

    /// Reads `text`. `extrasLimit` is the length beyond which highlights and `<Image />` tags are not read, as on the desktop; nil reads them in any note.
    public init(text: String, extrasLimit: Int? = LiveModel.desktopExtrasLimit) {
        chars = Array(text.utf16)
        length = chars.count
        self.extrasLimit = extrasLimit
        let read = Self.read(text, frontmatter: true)
        constructs = read.constructs
        reach = Self.reach(of: read.constructs)
        frontmatterLines = read.frontmatterLines
        let count = chars.count
        scan = (extrasLimit.map { count <= $0 } ?? true) ? LiveScan.read(text) : LiveScan.Result()
    }

    /// The constructs of `text`, with positions in it, and the lines of its frontmatter. `frontmatter` says whether a `---` block at the very start is
    /// frontmatter: it is not when `text` is only a piece taken from the middle of a note.
    private static func read(_ text: String, frontmatter: Bool) -> (constructs: [Construct], frontmatterLines: [Int]) {
        let chars = Array(text.utf16)
        let lines = LineIndex(chars)

        // The frontmatter is YAML, not Markdown: it is left out of the read (its text blanked, its line breaks kept) and drawn set apart.
        let body = frontmatter ? NoteFrontmatter.split(text).body : text
        let frontmatterEnd = chars.count - body.utf16.count
        var frontmatterLines: [Int] = []
        var source = text
        if frontmatterEnd > 0 {
            let last = lines.line(containing: min(frontmatterEnd - 1, chars.count))
            frontmatterLines = Array(lines.starts[0...last])
            let head = String(decoding: chars[0..<frontmatterEnd], as: UTF16.self)
            source = String(head.unicodeScalars.map { $0 == "\n" || $0 == "\r" ? Character($0) : " " }) + body
        }

        var reader = LiveReader(map: SourceMap(text: text), lines: lines)
        reader.visit(Document(parsing: source))
        var constructs: [Construct] = []
        constructs += reader.headings.map { .heading($0) }
        constructs += reader.rules.map { .rule($0) }
        constructs += reader.styles.map { .style($0) }
        constructs += reader.pictures.map { .picture($0) }
        constructs += reader.fenced.map { .fenced($0) }
        constructs.sort { $0.node.location < $1.node.location }
        return (constructs, frontmatterLines)
    }

    private static func reach(of constructs: [Construct]) -> [Int] {
        var farthest = 0
        return constructs.map {
            farthest = max(farthest, NSMaxRange($0.node))
            return farthest
        }
    }

    // MARK: After an edit

    /// Brings the model up to date with an edit: `range` of the old text became `newLength` units, `text` is the text now, and `window` (in the new text) is
    /// the part of it to read again, which must hold the edit and whole top-level blocks (it is what `HighlightModel.edited` gives back). Everything after
    /// the window moves with the edit; what the window holds is read again. The places of highlights and `<Image />` tags are moved with the edit (see
    /// `LiveScan.Result.shifted`) and made right again when `LiveModel` is made again from the whole text (the full read a pause after typing, and
    /// `differences(from:)` says what that changed), because they pair across blocks.
    public mutating func edited(replacing range: NSRange, withLength newLength: Int, rereading window: NSRange, in text: NSString) {
        let delta = newLength - range.length
        let oldWindow = NSRange(location: window.location, length: window.length - delta)
        guard range.location >= 0, NSMaxRange(range) <= length, oldWindow.length >= 0, NSMaxRange(window) <= text.length else {
            self = LiveModel(text: text as String, extrasLimit: extrasLimit)
            return
        }
        chars.replaceSubrange(range.location..<NSMaxRange(range), with: (0..<newLength).map { text.character(at: range.location + $0) })
        length += delta
        scan = scan.shifted(replacing: range, by: delta)

        // What starts in the old window is dropped, and what starts after it moves; what starts before it stays (and should end before it).
        let low = firstIndex(startingAtOrAfter: oldWindow.location)
        let high = firstIndex(startingAtOrAfter: NSMaxRange(oldWindow))
        for index in high..<constructs.count { constructs[index] = constructs[index].shifted(by: delta) }
        let fresh = Self.read(text.substring(with: window), frontmatter: window.location == 0)
        constructs.replaceSubrange(low..<high, with: fresh.constructs.map { $0.shifted(by: window.location) })
        reach = Self.reach(of: constructs)
        if window.location == 0 { frontmatterLines = fresh.frontmatterLines }
    }

    /// The index of the first construct that starts at or after `position`.
    private func firstIndex(startingAtOrAfter position: Int) -> Int {
        var low = 0, high = constructs.count
        while low < high {
            let middle = (low + high) / 2
            if constructs[middle].node.location >= position { high = middle } else { low = middle + 1 }
        }
        return low
    }

    /// Calls `body` for each construct that starts at or before `start` and reaches at least `reaching`, in order.
    private func forEachConstruct(startingAtOrBefore start: Int, reaching: Int, _ body: (Construct) -> Void) {
        var low = 0, high = reach.count
        while low < high {
            let middle = (low + high) / 2
            if reach[middle] >= reaching { high = middle } else { low = middle + 1 }
        }
        var index = low
        while index < constructs.count, constructs[index].node.location <= start {
            if NSMaxRange(constructs[index].node) >= reaching { body(constructs[index]) }
            index += 1
        }
    }

    // MARK: Reading

    /// What the Live view does to the whole note while `selection` (a caret is a range of length 0) is where it is.
    public func decorations(selection: NSRange) -> LiveDecorations {
        decorations(in: NSRange(location: 0, length: length), selection: selection, wholeNote: true)
    }

    /// What the Live view does to the part of the note in `window` (everything that touches it), while `selection` is where it is. A construct that is only
    /// partly in the window is given whole: clip it to what is being drawn.
    public func decorations(in window: NSRange, selection: NSRange) -> LiveDecorations {
        decorations(in: window, selection: selection, wholeNote: false)
    }

    private func decorations(in window: NSRange, selection: NSRange, wholeNote: Bool) -> LiveDecorations {
        let low = selection.location, high = NSMaxRange(selection)
        /// Whether the selection reaches `from`...`to`, ends included: `**bold**|` still shows its marks, `**bold** |` does not.
        func touches(_ range: NSRange) -> Bool { low <= NSMaxRange(range) && high >= range.location }
        func inWindow(_ range: NSRange) -> Bool { wholeNote || (range.location < NSMaxRange(window) && NSMaxRange(range) > window.location) }

        var out = LiveDecorations()
        out.frontmatterLines = frontmatterLines.filter { wholeNote || ($0 >= window.location && $0 < NSMaxRange(window)) }
        out.frontmatterRange = frontmatterRange

        forEachConstruct(startingAtOrBefore: NSMaxRange(window) - 1, reaching: window.location + 1) { construct in
            switch construct {
            case .heading(let heading):
                let lineRange = NSRange(location: heading.line, length: NSMaxRange(heading.node) - heading.line)
                out.headings.append(.init(line: heading.line, level: heading.level, range: lineRange))
                let active = touches(heading.node)
                for mark in heading.marks {
                    if active { out.shown.append(mark.shown) } else { out.hidden.append(mark.hidden) }
                }
            case .rule(let rule):
                if !touches(rule.node) {
                    out.rules.append(rule.line)
                    out.hidden.append(rule.node)
                }
            case .style(let style):
                out.styles.append(.init(style: style.style, range: style.node))
                let active = touches(style.node)
                for mark in style.marks where mark.length > 0 {
                    if active { out.shown.append(mark) } else { out.hidden.append(mark) }
                }
            case .picture(let picture):
                out.pictures.append(.init(range: picture.node, ownLine: isOwnLine(picture.node), active: touches(picture.node), src: picture.src, alt: picture.alt, title: picture.title, width: ""))
            case .fenced(let block):
                if touches(block.node) { out.fencesShown += block.fences } else { out.fencesHidden += block.fences }
            }
        }

        for image in scan.images where inWindow(image.range) {
            out.pictures.append(.init(range: image.range, ownLine: isOwnLine(image.range), active: touches(image.range), src: image.src, alt: image.alt, title: image.title, width: image.width))
        }
        out.tints += scan.tints.filter { inWindow($0.range) }.map { .init(range: $0.range, color: $0.color) }
        for element in scan.elements {
            let whole = NSRange(location: element.open.location, length: NSMaxRange(element.close) - element.open.location)
            guard inWindow(whole) else { continue }
            let active = touches(whole)
            for tag in [element.open, element.close] {
                // A tag that runs over a line break cannot be hidden, so it is left showing, dimmed like the rest.
                if active || containsLineBreak(tag) { out.shown.append(tag) } else { out.hidden.append(tag) }
            }
        }
        return out
    }

    /// The places of the constructs `selection` touches (ends included): the text whose look changes when the selection moves in or out of them.
    public func constructRanges(touching selection: NSRange) -> [NSRange] {
        var found: [NSRange] = []
        forEachConstruct(startingAtOrBefore: NSMaxRange(selection), reaching: selection.location) { found.append($0.node) }
        for element in scan.elements {
            let whole = NSRange(location: element.open.location, length: NSMaxRange(element.close) - element.open.location)
            if whole.location <= NSMaxRange(selection), NSMaxRange(whole) >= selection.location { found.append(whole) }
        }
        for image in scan.images where image.range.location <= NSMaxRange(selection) && NSMaxRange(image.range) >= selection.location { found.append(image.range) }
        return found
    }

    /// Where the pictures drawn in place of their text are: those with nothing but space on their line. They are what has to be laid out again when the
    /// width of the text changes, because a picture is as tall as its width allows.
    public var drawnPictureRanges: [NSRange] {
        var found: [NSRange] = []
        for case .picture(let picture) in constructs where isOwnLine(picture.node) { found.append(picture.node) }
        for image in scan.images where isOwnLine(image.range) { found.append(image.range) }
        return found.sorted { $0.location < $1.location }
    }

    /// The places where this model and `older` (what is on the text) differ in what the Live look draws beyond the Markdown: highlights, `<Image />` tags and the
    /// frontmatter. The Markdown's own constructs are what `HighlightModel.differences(from:)` compares.
    public func differences(from older: LiveModel) -> [NSRange] {
        var found = scan.differences(from: older.scan)
        if frontmatterRange != older.frontmatterRange { found += [frontmatterRange, older.frontmatterRange].compactMap { $0 } }
        return found
    }

    /// The whole frontmatter, from its first character to the end of its last line.
    private var frontmatterRange: NSRange? {
        guard let first = frontmatterLines.first, let last = frontmatterLines.last else { return nil }
        var end = last
        while end < chars.count, chars[end] != 0x0A, chars[end] != 0x0D { end += 1 }
        return NSRange(location: first, length: end - first)
    }

    /// Nothing but space and tabs is on the line with `range`.
    private func isOwnLine(_ range: NSRange) -> Bool {
        var before = range.location
        while before > 0, chars[before - 1] != 0x0A, chars[before - 1] != 0x0D {
            guard chars[before - 1] == 0x20 || chars[before - 1] == 0x09 else { return false }
            before -= 1
        }
        var after = NSMaxRange(range)
        while after < chars.count, chars[after] != 0x0A, chars[after] != 0x0D {
            guard chars[after] == 0x20 || chars[after] == 0x09 else { return false }
            after += 1
        }
        return true
    }

    private func containsLineBreak(_ range: NSRange) -> Bool {
        chars[range.location..<NSMaxRange(range)].contains { $0 == 0x0A || $0 == 0x0D }
    }
}

/// Where lines start, as CodeMirror counts them: a `\n`, a `\r\n` or a lone `\r` ends a line.
struct LineIndex {
    let starts: [Int]

    init(_ chars: [UInt16]) {
        var starts = [0]
        var i = 0
        while i < chars.count {
            if chars[i] == 0x0A {
                starts.append(i + 1)
            } else if chars[i] == 0x0D {
                if i + 1 < chars.count, chars[i + 1] == 0x0A { i += 1 }
                starts.append(i + 1)
            }
            i += 1
        }
        self.starts = starts
    }

    /// The index of the line holding `position`.
    func line(containing position: Int) -> Int {
        var low = 0, high = starts.count
        while low < high {
            let middle = (low + high) / 2
            if starts[middle] <= position { low = middle + 1 } else { high = middle }
        }
        return max(low - 1, 0)
    }

    func start(ofLineContaining position: Int) -> Int { starts[line(containing: position)] }
}
