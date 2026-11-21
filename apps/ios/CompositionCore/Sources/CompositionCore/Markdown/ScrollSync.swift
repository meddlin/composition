import Foundation

/// Keeps the two halves of the Split tab at the same place in the note: scrolling one scrolls the other to the matching spot.
///
/// The halves are matched by where they are in the note's text, not by how far down they are scrolled: a picture, a table, a chart or a component is much
/// taller (or shorter) in the Preview than in the editor, so the same fraction of each would show different parts of the note. One side's top is turned into
/// a place in the text, and the other side scrolls so that the same place is at its top.
///
/// The Preview says where it draws each of its blocks, and each block knows where it is written (`NotePreview.located`). Between those points the place is
/// taken to move evenly: inside a block (a tall picture is passed through as its tag is), and in the gaps between blocks.
public enum ScrollSync {
    /// A place in the note's text (in UTF-16 units, fractional inside a line or a block) and how far down a side draws it, in points.
    public struct Mark: Equatable, Sendable {
        public var offset: Double
        public var y: Double

        public init(offset: Double, y: Double) {
            self.offset = offset
            self.y = y
        }
    }

    /// A block of the Preview: where it is written in the note (`LocatedBlock.range`) and where the Preview draws it (its top and bottom).
    public struct Block: Equatable, Sendable {
        public var range: NSRange
        public var top: Double
        public var bottom: Double

        public init(range: NSRange, top: Double, bottom: Double) {
            self.range = range
            self.top = top
            self.bottom = bottom
        }
    }

    /// The Preview's marks: the start of the note at its top, the top and bottom of each block that is drawn, and the end of the note at the bottom of
    /// what the Preview draws (`height`). Above the first block is the Preview's header (the title, the date, the tags), which stands for the frontmatter.
    /// Kept in order both ways (a block that would go back up the text or the page is left out), so that the map from one to the other never turns back.
    public static func marks(blocks: [Block], textLength: Int, height: Double) -> [Mark] {
        var out = [Mark(offset: 0, y: 0)]
        func add(_ offset: Double, _ y: Double) {
            guard let last = out.last, offset >= last.offset, y >= last.y else { return }
            out.append(Mark(offset: offset, y: y))
        }
        for block in blocks.sorted(by: { $0.range.location < $1.range.location }) where block.bottom >= block.top {
            add(Double(block.range.location), block.top)
            add(Double(NSMaxRange(block.range)), block.bottom)
        }
        add(Double(textLength), max(height, out.last?.y ?? 0))
        return out
    }

    /// How far down the side the marks describe draws the place `offset` in the text.
    public static func y(atOffset offset: Double, in marks: [Mark]) -> Double {
        interpolate(offset, marks, from: \.offset, to: \.y)
    }

    /// The place in the text that the side the marks describe draws at `y`.
    public static func offset(atY y: Double, in marks: [Mark]) -> Double {
        interpolate(y, marks, from: \.y, to: \.offset)
    }

    /// Where the other side scrolls to, given where it would put the matching place (`matched`), how far it can scroll (`targetMax`), and where the side
    /// that moved is (`sourceTop`, out of `sourceMax`). At the very top, the other goes to its top; at the very bottom, to its bottom, so that the end of
    /// the note shows in both even where one side's last screen holds more of the note than the other's.
    public static func follow(matched: Double, targetMax: Double, sourceTop: Double, sourceMax: Double) -> Double {
        let most = max(targetMax, 0)
        if sourceTop <= 1 { return 0 }
        if sourceMax > 1, sourceTop >= sourceMax - 1 { return most }
        return min(max(matched, 0), most)
    }

    /// Piecewise-linear between the marks: `value` measured along `from` gives the matching point along `to`. Before the first mark is the first; after the
    /// last, the last. Where several marks share a value (a block with no height, or text with nothing drawn), the first of them is taken.
    private static func interpolate(_ value: Double, _ marks: [Mark], from: KeyPath<Mark, Double>, to: KeyPath<Mark, Double>) -> Double {
        guard let first = marks.first, let last = marks.last else { return 0 }
        if value <= first[keyPath: from] { return first[keyPath: to] }
        let end = min(value, last[keyPath: from])
        // The first mark at or past `value`.
        var low = 0, high = marks.count - 1
        while low < high {
            let middle = (low + high) / 2
            if marks[middle][keyPath: from] >= end { high = middle } else { low = middle + 1 }
        }
        let after = marks[low]
        if after[keyPath: from] == end { return after[keyPath: to] }
        let before = marks[low - 1]
        let fraction = (end - before[keyPath: from]) / (after[keyPath: from] - before[keyPath: from])
        return before[keyPath: to] + fraction * (after[keyPath: to] - before[keyPath: to])
    }
}
