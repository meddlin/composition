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
// Code blocks (docs/ipad-live-default-plan.md, Step 3) are drawn as the desktop's `liveCode` draws them, and checked against it the same way
// (`live-code-expected.json`): a fenced block's two fences are hidden while the selection is elsewhere and both shown while it is anywhere in the
// block (the iPad's decision V2, which the desktop's Step 3 took too), a block with no code keeps its fences, and a top-level indented block's
// indent is hidden like a fence. Colours (code, links, tags, list and quote marks) are the Markdown tab's, so they are not here at all.

/// How the Live view draws a styled run of text.
public enum LiveStyle: String, Equatable, Sendable {
    case strong, emphasis, strike, code
}

/// Which tag writes a picture, which says how it is drawn: `![…](…)` and `<Image />` as the picture, `<Ink />` from the drawing's strokes in the scheme's colours
/// (its PNG when it carries none), and `<Drawio />` at half its pixel size unless the tag gives a width, as the Preview draws each (docs/ipad-live-default-plan.md, Step 1).
public enum LivePictureKind: String, Equatable, Sendable {
    case image, ink, drawio
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
        /// The text that writes the picture: `![alt](src "title")`, `<Image … />`, `<Ink … />` or `<Drawio … />`.
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
        public var kind: LivePictureKind = .image
    }

    public struct Tint: Equatable, Sendable {
        public var range: NSRange
        /// One of `MdxProps.highlightColors`.
        public var color: String
    }

    /// A line of a list or a quote (docs/ipad-live-default-plan.md, Step 4; the desktop's `listDecorations`, liveLists.ts). Every such line is indented one
    /// level for each list and quote it is in, and has a bar down its left side for each quote. Away from the selection the marks at its start (`> `, `- `,
    /// `1. `, and the indentation that carries an item on) are hidden, and a bullet, a number or a checkbox is drawn in their place.
    public struct ListLine: Equatable, Sendable {
        public enum Container: Hashable, Sendable {
            case quote
            /// A list item: `starts` on the line the item starts on, and `column` is how far into that line its text starts.
            case list(starts: Bool, column: Int)
        }

        /// What is drawn in place of an item's mark: its number as written (`3.`, `3)`), or a bullet.
        public struct Marker: Hashable, Sendable {
            public var text: String
            public var ordered: Bool
        }

        /// A task's `[ ]` or `[x]`.
        public struct Task: Hashable, Sendable {
            /// The box and the space after it: what is hidden.
            public var range: NSRange
            /// The three characters of the box, `[`, the space or `x`, `]`.
            public var box: NSRange
            public var checked: Bool

            /// What ticking or unticking the box writes: its middle character becomes `x`, or a space (the desktop's `toggleTask`).
            public var toggle: (range: NSRange, text: String) { (NSRange(location: box.location + 1, length: 1), checked ? " " : "x") }
        }

        /// The line, from its start to the end of its text.
        public var range: NSRange
        /// The lists and quotes the line is in, outermost first.
        public var containers: [Container]
        /// The selection reaches the line (ends included): its marks show as they are written, and nothing is drawn in their place.
        public var active: Bool
        /// Away from the selection, the marks and the indentation at the line's start, when there are any.
        public var hidden: NSRange?
        /// Away from the selection, on the line an item starts on (when that item is the innermost thing the line is in): its marker.
        public var marker: Marker?
        /// Away from the selection, a task's box, drawn as a checkbox; a tap on it ticks or unticks it (decision D4).
        public var task: Task?
    }

    /// A link (Step 2 of docs/ipad-live-default-plan.md): `[text](url "title")`, `[text][label]`, `<url>` or a bare address.
    public struct Link: Equatable, Sendable {
        /// What is drawn as the link: a link's words, or an address (an autolink's, without its `<` `>`, or a bare one).
        public var range: NSRange
        /// The whole construct, marks and address included.
        public var node: NSRange
        /// The address to follow, as the desktop's `hrefOf` makes it (`www.…` given `http://`, an email `mailto:`).
        public var href: String
        /// The selection touches it: its marks show, dimmed, and it can be followed with the ↗ beside it.
        public var active: Bool

        public init(range: NSRange, node: NSRange, href: String, active: Bool) {
            self.range = range
            self.node = node
            self.href = href
            self.active = active
        }
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
    /// A fenced block's fences (each its whole line), hidden while the selection is outside the block, and shown while it is in it (decision V2). A block
    /// with nothing between its fences keeps them, as on the desktop: hidden, it would be nothing at all.
    public var fencesHidden: [NSRange] = []
    public var fencesShown: [NSRange] = []

    /// A code block, drawn as the Preview draws one: its lines in the code font on one rounded fill (Step 3).
    public struct CodeBlock: Equatable, Sendable {
        /// The block, from the start of its first line to the end of its last.
        public var range: NSRange
        /// The start of each line drawn on the fill, in order: the fences' lines too while they show, but not while they are hidden. The first and the last
        /// are the fill's rounded ends.
        public var lines: [Int]
        /// The lines among `lines` that are fences (they show only while the selection is in the block).
        public var fences: [Int]
        /// The selection is in the block.
        public var active: Bool
    }

    public var codeBlocks: [CodeBlock] = []
    /// A top-level indented block's indent on each line (four columns), hidden while the selection is outside the block, as the desktop hides it.
    public var codeIndentsHidden: [NSRange] = []
    public var links: [Link] = []
    /// The lines of lists and quotes (Step 4 of docs/ipad-live-default-plan.md). What they hide is here and not in `hidden`, because it is drawn over.
    public var lists: [ListLine] = []
    /// The start of each line drawn with no height: a setext heading's underline while the selection is not in the heading (it is in `hidden` too).
    public var collapsedLines: [Int] = []
    /// Each footnote citation drawn as its number (Step 7): `[^label]` hidden, and the Preview's superscript number drawn in its place. One the selection
    /// touches shows its source, dimmed, and is in `shown` instead.
    public var footnoteRefs: [FootnoteRef] = []

    public struct FootnoteRef: Hashable, Sendable {
        public var range: NSRange
        public var number: Int
    }
}

public struct LiveModel: Sendable {
    struct HeadingNode: Sendable {
        var line: Int
        var level: Int
        var node: NSRange
        /// Each mark as it shows, and as it hides (the space after the opening `#`s goes with them, or the title would sit indented). A setext heading's one
        /// mark is its underline, hidden as its whole line.
        var marks: [(shown: NSRange, hidden: NSRange)]
        /// A setext heading's lines of text, each drawn as a heading (nil for an ATX heading, which is one line).
        var setextLines: [NSRange]? = nil
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

    /// A code block, fenced or indented.
    struct FenceNode: Sendable {
        var node: NSRange
        /// The fences' whole lines (none for an indented block).
        var fences: [NSRange]
        /// The start of each of the block's lines, fences included.
        var lines: [Int]
        var fenceLines: [Int]
        /// A line that is not a fence: what is left to show when the fences are hidden.
        var hasCode: Bool
        /// A top-level indented block's indent on each line.
        var indents: [NSRange]
    }

    struct LinkNode: Sendable {
        var node: NSRange
        /// What is drawn in the link colour.
        var text: NSRange
        var href: String
        /// The marks that show, dimmed, while the selection touches the link (`[`, `]`, `(`, `)`; `<` `>`).
        var marks: [NSRange]
        /// What is hidden while it does not (`[`, and `](url "title")` or `][label]`; `<` `>`). A part that runs over a line break is dimmed instead.
        var hide: [NSRange]
    }

    /// A line of a list or a quote, as the desktop's `readLines` (liveLists.ts) makes it: `node` is the line, from its start to the end of its text.
    struct ListLineNode: Hashable, Sendable {
        var node: NSRange
        var containers: [LiveDecorations.ListLine.Container]
        /// Where the marks and indentation at the line's start end (the desktop's `prefixEnd`): what is hidden away from the selection.
        var prefixEnd: Int
        var marker: LiveDecorations.ListLine.Marker?
        var task: LiveDecorations.ListLine.Task?
    }

    /// Everything in the note that the selection can reveal, in one list ordered by where it starts.
    enum Construct: Sendable {
        case heading(HeadingNode)
        case rule(RuleNode)
        case style(StyleNode)
        case picture(PictureNode)
        case fenced(FenceNode)
        case listLine(ListLineNode)
        case link(LinkNode)

        var node: NSRange {
            switch self {
            case .heading(let value): value.node
            case .rule(let value): value.node
            case .style(let value): value.node
            case .picture(let value): value.node
            case .fenced(let value): value.node
            case .listLine(let value): value.node
            case .link(let value): value.node
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
                value.setextLines = value.setextLines?.map(move)
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
                value.lines = value.lines.map { $0 + delta }
                value.fenceLines = value.fenceLines.map { $0 + delta }
                value.indents = value.indents.map(move)
                return .fenced(value)
            case .listLine(var value):
                value.node = move(value.node)
                value.prefixEnd += delta
                if var task = value.task {
                    task.range = move(task.range)
                    task.box = move(task.box)
                    value.task = task
                }
                return .listLine(value)
            case .link(var value):
                value.node = move(value.node)
                value.text = move(value.text)
                value.marks = value.marks.map(move)
                value.hide = value.hide.map(move)
                return .link(value)
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
    /// The footnote citations that have a definition, numbered as the Preview numbers them (Step 7). They are numbered by the whole note, so, like `scan`, they are
    /// moved with the edits between full reads and made right by the next one.
    private var footnoteRefs: [LiveDecorations.FootnoteRef]
    private let extrasLimit: Int?

    /// Reads `text`. `extrasLimit` is the length beyond which highlights and `<Image />` tags are not read; nil (the default, as on the desktop) reads them in any note.
    public init(text: String, extrasLimit: Int? = nil) {
        chars = Array(text.utf16)
        length = chars.count
        self.extrasLimit = extrasLimit
        let read = Self.read(text, frontmatter: true)
        constructs = read.constructs
        reach = Self.reach(of: read.constructs)
        frontmatterLines = read.frontmatterLines
        let count = chars.count
        scan = (extrasLimit.map { count <= $0 } ?? true) ? LiveScan.read(text) : LiveScan.Result()
        footnoteRefs = Self.footnoteRefs(of: text)
    }

    /// The citations of footnotes in `text` (a whole note), with their numbers: `NoteScanner`'s, which are the Preview's.
    static func footnoteRefs(of text: String) -> [LiveDecorations.FootnoteRef] {
        guard text.contains("[^") else { return [] }
        let body = NoteFrontmatter.split(text).body
        let offset = text.hasSuffix(body) ? text.utf16.count - body.utf16.count : 0
        return NoteScanner.scan(body, at: offset).footnoteCitations.map { .init(range: $0.range, number: $0.number) }
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
        constructs += reader.codeBlocks.map { .fenced($0) }
        constructs += reader.links.map { .link($0) }
        constructs += reader.listLines().map { .listLine($0) }
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
        // A citation the edit touches may be one no longer: it is left out until the full read. Those after it move.
        footnoteRefs = footnoteRefs.compactMap { ref in
            if NSMaxRange(ref.range) <= range.location { return ref }
            if ref.range.location >= NSMaxRange(range) { return .init(range: NSRange(location: ref.range.location + delta, length: ref.range.length), number: ref.number) }
            return nil
        }

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
                let active = touches(heading.node)
                if let textLines = heading.setextLines {
                    // A setext heading: each line of its text is a heading's line, and away from the selection its underline's line is hidden and has no height.
                    for line in textLines { out.headings.append(.init(line: line.location, level: heading.level, range: line)) }
                    for mark in heading.marks {
                        if active { out.shown.append(mark.shown) } else {
                            out.hidden.append(mark.hidden)
                            out.collapsedLines.append(mark.hidden.location)
                        }
                    }
                    break
                }
                let lineRange = NSRange(location: heading.line, length: NSMaxRange(heading.node) - heading.line)
                out.headings.append(.init(line: heading.line, level: heading.level, range: lineRange))
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
                let active = touches(block.node)
                let hideFences = !active && block.hasCode
                if hideFences { out.fencesHidden += block.fences } else { out.fencesShown += block.fences }
                if !active { out.codeIndentsHidden += block.indents }
                let drawn = hideFences ? block.lines.filter { !block.fenceLines.contains($0) } : block.lines
                let from = block.lines.first ?? block.node.location
                out.codeBlocks.append(.init(range: NSRange(location: from, length: NSMaxRange(block.node) - from), lines: drawn,
                    fences: hideFences ? [] : block.fenceLines, active: active))
            case .link(let link):
                let active = touches(link.node)
                out.links.append(.init(range: link.text, node: link.node, href: link.href, active: active))
                if active {
                    out.shown += link.marks
                } else {
                    for part in link.hide where part.length > 0 {
                        if containsLineBreak(part) { out.shown.append(part) } else { out.hidden.append(part) }
                    }
                }
            case .listLine(let line):
                out.lists.append(Self.listLine(line, active: touches(line.node)))
            }
        }

        for image in scan.images where inWindow(image.range) {
            out.pictures.append(.init(range: image.range, ownLine: isOwnLine(image.range), active: touches(image.range), src: image.src, alt: image.alt, title: image.title, width: image.width, kind: image.kind))
        }
        out.tints += scan.tints.filter { inWindow($0.range) }.map { .init(range: $0.range, color: $0.color) }
        for ref in footnoteRefs where inWindow(ref.range) {
            if touches(ref.range) { out.shown.append(ref.range) } else { out.footnoteRefs.append(ref) }
        }
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

    /// What a line of a list or a quote looks like with the selection on it (`active`) or away from it, as the desktop's `listDecorations` decides.
    private static func listLine(_ line: ListLineNode, active: Bool) -> LiveDecorations.ListLine {
        var out = LiveDecorations.ListLine(range: line.node, containers: line.containers, active: active)
        guard !active else { return out }
        if line.prefixEnd > line.node.location { out.hidden = NSRange(location: line.node.location, length: line.prefixEnd - line.node.location) }
        if let marker = line.marker, case .list(starts: true, _) = line.containers.last { out.marker = marker }
        out.task = line.task
        return out
    }

    /// The task box drawn at `position` (a box's three characters, or the space after it), with the selection where it is: what a tap on the box ticks or
    /// unticks. Nil when no box is drawn there (the selection is on its line, or there is no task).
    public func task(at position: Int, selection: NSRange) -> LiveDecorations.ListLine.Task? {
        var found: LiveDecorations.ListLine.Task?
        forEachConstruct(startingAtOrBefore: position, reaching: position) { construct in
            guard case .listLine(let line) = construct, let task = line.task, NSLocationInRange(position, task.range) || position == task.box.location else { return }
            if Self.listLine(line, active: selection.location <= NSMaxRange(line.node) && NSMaxRange(selection) >= line.node.location).task != nil { found = task }
        }
        return found
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
        for ref in footnoteRefs where ref.range.location <= NSMaxRange(selection) && NSMaxRange(ref.range) >= selection.location { found.append(ref.range) }
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

    /// The places where this model and `older` (what is on the text) differ in what the Live look draws beyond the Markdown: highlights, `<Image />` tags, footnote
    /// numbers and the frontmatter. The Markdown's own constructs are what `HighlightModel.differences(from:)` compares.
    public func differences(from older: LiveModel) -> [NSRange] {
        var found = scan.differences(from: older.scan)
        // The lines of lists and quotes: a quick read of a window can end an item or a quote early (a line it takes in lazily, below the window), and the colours,
        // which `HighlightModel` compares, do not show it.
        let lines = Set(listLineNodes), olderLines = Set(older.listLineNodes)
        found += lines.symmetricDifference(olderLines).map(\.node)
        if frontmatterRange != older.frontmatterRange { found += [frontmatterRange, older.frontmatterRange].compactMap { $0 } }
        // Footnote numbers pair across the note: a citation typed early renumbers every one after it.
        found += Set(footnoteRefs).symmetricDifference(Set(older.footnoteRefs)).map(\.range)
        return found
    }

    private var listLineNodes: [ListLineNode] {
        constructs.compactMap { if case .listLine(let line) = $0 { line } else { nil } }
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
