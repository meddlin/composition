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
    }

    public struct Style: Equatable, Sendable {
        public var style: LiveStyle
        public var range: NSRange
    }

    public struct Picture: Equatable, Sendable {
        /// The text that writes the picture: `![alt](src "title")` or `<Image … />`.
        public var range: NSRange
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

    /// The length of the text, in UTF-16 units.
    public let length: Int
    private let chars: [UInt16]
    private let frontmatterLines: [Int]
    private let headings: [HeadingNode]
    private let rules: [RuleNode]
    private let styles: [StyleNode]
    private let pictures: [PictureNode]
    private let fenced: [FenceNode]
    private let scan: LiveScan.Result

    /// Reads `text`. `extrasLimit` is the length beyond which highlights and `<Image />` tags are not read, as on the desktop; nil reads them in any note.
    public init(text: String, extrasLimit: Int? = LiveModel.desktopExtrasLimit) {
        chars = Array(text.utf16)
        length = chars.count
        let lines = LineIndex(chars)

        // The frontmatter is YAML, not Markdown: it is left out of the read (its text blanked, its line breaks kept) and drawn set apart.
        let body = NoteFrontmatter.split(text).body
        let frontmatterEnd = length - body.utf16.count
        if frontmatterEnd > 0 {
            let last = lines.line(containing: min(frontmatterEnd - 1, length))
            frontmatterLines = Array(lines.starts[0...last])
        } else {
            frontmatterLines = []
        }

        var source = text
        if frontmatterEnd > 0 {
            let head = String(decoding: chars[0..<frontmatterEnd], as: UTF16.self)
            source = String(head.unicodeScalars.map { $0 == "\n" || $0 == "\r" ? Character($0) : " " }) + body
        }
        var reader = LiveReader(map: SourceMap(text: text), lines: lines)
        reader.visit(Document(parsing: source))
        headings = reader.headings
        rules = reader.rules
        styles = reader.styles
        pictures = reader.pictures
        fenced = reader.fenced

        let count = chars.count
        scan = (extrasLimit.map { count <= $0 } ?? true) ? LiveScan.read(text) : LiveScan.Result()
    }

    /// What the Live view does to the note while `selection` (a caret is a range of length 0) is where it is.
    public func decorations(selection: NSRange) -> LiveDecorations {
        let low = selection.location, high = NSMaxRange(selection)
        /// Whether the selection reaches `from`...`to`, ends included: `**bold**|` still shows its marks, `**bold** |` does not.
        func touches(_ range: NSRange) -> Bool { low <= NSMaxRange(range) && high >= range.location }

        var out = LiveDecorations()
        out.frontmatterLines = frontmatterLines

        for heading in headings {
            out.headings.append(.init(line: heading.line, level: heading.level))
            let active = touches(heading.node)
            for mark in heading.marks {
                if active { out.shown.append(mark.shown) } else { out.hidden.append(mark.hidden) }
            }
        }
        for rule in rules where !touches(rule.node) {
            out.rules.append(rule.line)
            out.hidden.append(rule.node)
        }
        for style in styles {
            out.styles.append(.init(style: style.style, range: style.node))
            let active = touches(style.node)
            for mark in style.marks where mark.length > 0 {
                if active { out.shown.append(mark) } else { out.hidden.append(mark) }
            }
        }
        for picture in pictures {
            out.pictures.append(.init(range: picture.node, active: touches(picture.node), src: picture.src, alt: picture.alt, title: picture.title, width: ""))
        }
        for image in scan.images {
            out.pictures.append(.init(range: image.range, active: touches(image.range), src: image.src, alt: image.alt, title: image.title, width: image.width))
        }
        out.tints = scan.tints.map { .init(range: $0.range, color: $0.color) }
        for element in scan.elements {
            let active = touches(NSRange(location: element.open.location, length: NSMaxRange(element.close) - element.open.location))
            for tag in [element.open, element.close] {
                // A tag that runs over a line break cannot be hidden, so it is left showing, dimmed like the rest.
                if active || containsLineBreak(tag) { out.shown.append(tag) } else { out.hidden.append(tag) }
            }
        }
        for block in fenced {
            if touches(block.node) { out.fencesShown += block.fences } else { out.fencesHidden += block.fences }
        }
        return out
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
