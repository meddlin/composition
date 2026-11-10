import Foundation

// The outline of a note: its headings in order, for the heading rail (the iPad's Outline popover; the desktop's `HeadingRail`). A tap on one scrolls to it,
// in the preview by `ordinal` (the number `MdBlock.heading` carries, which is also what `<Toc />` scrolls to) and in the editor by `offset`.
//
// The labels and the numbering are the preview's (`NoteScanner`'s headings, which agree with the desktop's); the places in the text are the editor's reading
// of the same text (`MarkdownHighlighter`, which is what colours it). They agree on a plain Markdown note. Where a component tag makes them differ (the
// editor reads `<Info>` followed by `## Title` with no blank line as raw HTML, the preview as a heading inside the panel), a heading is paired with the
// next one of the same level, and one without a partner has no `offset`.

public struct OutlineHeading: Equatable, Sendable, Identifiable {
    /// The heading's number among the note's headings, counted from 0.
    public var ordinal: Int
    /// 1 to 6.
    public var level: Int
    /// The heading's words with no marks; empty for `#` alone.
    public var text: String
    /// Where its first character is in the note's whole text (frontmatter included), in UTF-16 units; nil when the editor sees no such heading.
    public var offset: Int?
    public var id: Int { ordinal }

    public init(ordinal: Int, level: Int, text: String, offset: Int?) {
        self.ordinal = ordinal
        self.level = level
        self.text = text
        self.offset = offset
    }
}

public enum NoteOutline {
    /// The headings of a note's stored text (frontmatter and all).
    public static func make(content: String) -> [OutlineHeading] {
        let scanned = NoteScanner.scan(NoteFrontmatter.split(content).body).headings
        guard !scanned.isEmpty else { return [] }
        let found = MarkdownHighlighter.spans(in: content).compactMap { span -> (offset: Int, level: Int)? in
            if case .heading(let level) = span.kind { return (span.range.location, level) }
            return nil
        }
        var next = 0
        return scanned.enumerated().map { ordinal, heading in
            var offset: Int?
            if let at = found[next...].firstIndex(where: { $0.level == heading.depth }) {
                offset = found[at].offset
                next = at + 1
            }
            return OutlineHeading(ordinal: ordinal, level: heading.depth, text: heading.text, offset: offset)
        }
    }

    /// The heading being read when the first visible character of the text is at `offset`: the last heading at or before it, or the first heading
    /// when none is. nil when no heading has a place.
    public static func current(in headings: [OutlineHeading], at offset: Int) -> OutlineHeading? {
        let placed = headings.filter { $0.offset != nil }
        return placed.last(where: { $0.offset! <= offset }) ?? placed.first
    }
}
