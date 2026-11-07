import Foundation

// Colouring only what was typed (build plan, Step 5; risk R13). The editor used to read the whole note and re-colour all of it after every
// keystroke: 87 ms for a 5,000-line note, in a Release build (S3). This keeps the colours as a list of the note's top-level blocks, each with
// the spans inside it, and after an edit re-reads only the blocks around it: the one that was typed in, and its neighbours, in case what
// was typed joined or split them.
//
// A piece read alone can be wrong. A fence typed on one line swallows the lines below it, which are not in the piece; a list that goes on
// past a blank line is two lists to a reader that sees one of them. So after a pause the whole note is read again, off the main thread, and
// `differences(from:)` says which blocks the quick read had wrong, and only those are re-coloured. Knowing nothing of UIKit, this is plain
// text and numbers, and tested against the full read.

/// The text positions touched by a run of edits, as one edit: what to replace in the text as it was, and how long the replacement is now.
/// A text view can change several times before anyone looks (a composition, an undo, a paste with a correction after it).
public struct EditAccumulator: Equatable, Sendable {
    public private(set) var start = 0
    /// The end of the touched piece in the text as it was before any of the edits.
    public private(set) var oldEnd = 0
    /// The end of the touched piece in the text as it is now.
    public private(set) var newEnd = 0
    public private(set) var isEmpty = true

    public init() {}

    /// Notes one more edit: `range` is where it replaced text, in the text as it was just before it, and `newLength` is how long the
    /// replacement is.
    public mutating func record(range: NSRange, newLength: Int) {
        if isEmpty {
            (start, oldEnd, newEnd, isEmpty) = (range.location, range.upperBound, range.location + newLength, false)
            return
        }
        if range.upperBound > newEnd {
            // The edit reaches past the touched piece, over text that none of the edits touched: that text joins the piece.
            oldEnd += range.upperBound - newEnd
            newEnd = range.location + newLength
        } else {
            newEnd += newLength - range.length
        }
        start = min(start, range.location)
    }

    /// The touched piece as a single edit: what it replaced in the original text (`range`) and how long the text there is now.
    public var merged: (range: NSRange, newLength: Int)? {
        isEmpty ? nil : (NSRange(location: start, length: oldEnd - start), newEnd - start)
    }
}

public struct HighlightModel: Equatable, Sendable {
    /// A top-level block, with its spans held relative to the start of its range so that moving the block moves them all.
    struct Block: Equatable, Sendable {
        var range: NSRange
        var spans: [HighlightSpan]  // positions relative to `range.location`

        init(_ block: HighlightedBlock) {
            range = block.range
            spans = block.spans.map { HighlightSpan(range: NSRange(location: $0.range.location - block.range.location, length: $0.range.length), kind: $0.kind) }
        }

        /// Two blocks colour the text the same when they start at the same place and hold the same spans. Their lengths may differ by a line
        /// break at the end, depending on whether the text the parser was given ended there, and that colours nothing.
        static func == (lhs: Block, rhs: Block) -> Bool { lhs.range.location == rhs.range.location && lhs.spans == rhs.spans }

        func absolute() -> [HighlightSpan] {
            spans.map { HighlightSpan(range: NSRange(location: $0.range.location + range.location, length: $0.range.length), kind: $0.kind) }
        }
    }

    private(set) var blocks: [Block]
    /// The length, in UTF-16 units, of the text this describes.
    public private(set) var length: Int

    /// Reads all of `text`.
    public init(text: String) {
        length = text.utf16.count
        blocks = MarkdownHighlighter.blocks(in: text).map(Block.init)
    }

    public var blockCount: Int { blocks.count }

    // MARK: After an edit

    /// Brings the model up to date with an edit: `range` of the old text became `newLength` units, and `text` is the text now. Re-reads the
    /// blocks around the edit (the lines they cover), and returns the range of the new text whose colours must be put on again.
    @discardableResult
    public mutating func edited(replacing range: NSRange, withLength newLength: Int, in text: NSString) -> NSRange {
        let delta = newLength - range.length
        length += delta
        guard !blocks.isEmpty else {
            blocks = MarkdownHighlighter.blocks(in: text as String).map(Block.init)
            return NSRange(location: 0, length: text.length)
        }

        // The blocks the edit touches, and one more on each side: what was typed may join them to the block it is next to, or split one.
        var first = firstBlock(endingAtOrAfter: range.location)
        if first > 0 { first -= 1 }
        first = min(first, blocks.count - 1)
        var last = lastBlock(startingAtOrBefore: range.upperBound)
        if last + 1 < blocks.count { last += 1 }
        last = max(last, first)

        let start = min(blocks[first].range.location, range.location)
        let end = max(blocks[last].range.upperBound, range.upperBound) + delta
        let upper = min(max(end, start), text.length)
        let window = text.lineRange(for: NSRange(location: min(start, text.length), length: upper - min(start, text.length)))

        let reread = MarkdownHighlighter.blocks(in: text.substring(with: window), frontmatter: window.location == 0).map { block in
            Block(HighlightedBlock(
                range: NSRange(location: block.range.location + window.location, length: block.range.length),
                spans: block.spans.map { HighlightSpan(range: NSRange(location: $0.range.location + window.location, length: $0.range.length), kind: $0.kind) }))
        }

        // Everything after the edit moves by what the edit added or removed; the blocks that were re-read are replaced.
        for index in (last + 1)..<blocks.count { blocks[index].range.location += delta }
        blocks.replaceSubrange(first...last, with: reread)
        joinOverlaps(from: max(first - 1, 0), through: min(first + reread.count, blocks.count - 1))
        return window
    }

    /// A re-read piece can start inside the block before it when a block ends in the middle of a line (a frontmatter closed by `---` with text
    /// after it on that line). Such blocks are joined, so that blocks always stay in order and apart.
    private mutating func joinOverlaps(from start: Int, through end: Int) {
        var index = start + 1
        var stop = end
        while index <= stop, index < blocks.count {
            let previous = blocks[index - 1], current = blocks[index]
            if current.range.location < previous.range.upperBound {
                let range = NSUnionRange(previous.range, current.range)
                blocks.replaceSubrange((index - 1)...index, with: [Block(HighlightedBlock(range: range, spans: previous.absolute() + current.absolute()))])
                stop -= 1
            } else {
                index += 1
            }
        }
    }

    /// The index of the first block that ends at or after `position`, or `blocks.count`.
    private func firstBlock(endingAtOrAfter position: Int) -> Int {
        var low = 0, high = blocks.count
        while low < high {
            let middle = (low + high) / 2
            if blocks[middle].range.upperBound >= position { high = middle } else { low = middle + 1 }
        }
        return low
    }

    /// The index of the last block that starts at or before `position`, or -1.
    private func lastBlock(startingAtOrBefore position: Int) -> Int {
        var low = 0, high = blocks.count
        while low < high {
            let middle = (low + high) / 2
            if blocks[middle].range.location <= position { low = middle + 1 } else { high = middle }
        }
        return low - 1
    }

    // MARK: Reading the colours

    /// The spans to put on `range`, in the order to put them on (a later one wins), with positions in the whole text. A span may stick out
    /// of `range`: clip it to what is being coloured.
    public func spans(in range: NSRange) -> [HighlightSpan] {
        guard !blocks.isEmpty else { return [] }
        var first = firstBlock(endingAtOrAfter: range.location)
        var result: [HighlightSpan] = []
        while first < blocks.count, blocks[first].range.location < range.upperBound {
            result += blocks[first].absolute()
            first += 1
        }
        return result
    }

    // MARK: Against a full read

    /// The ranges where this model's colours are not the ones `older` describes, ready to be put on again: every block that one has and the other
    /// does not, from both, joined where they touch. With `older` being what is on the text, and `self` a fresh read of all of it, this is
    /// what the quick reads got wrong.
    public func differences(from older: HighlightModel) -> [NSRange] {
        var dirty: [NSRange] = []
        var i = 0, j = 0
        while i < blocks.count || j < older.blocks.count {
            if i < blocks.count, j < older.blocks.count, blocks[i] == older.blocks[j] {
                i += 1
                j += 1
            } else if j >= older.blocks.count || (i < blocks.count && blocks[i].range.location < older.blocks[j].range.location) {
                dirty.append(blocks[i].range)
                i += 1
            } else if i >= blocks.count || older.blocks[j].range.location < blocks[i].range.location {
                dirty.append(older.blocks[j].range)
                j += 1
            } else {
                // The same place, but not the same block: both are to be redone.
                dirty.append(NSUnionRange(blocks[i].range, older.blocks[j].range))
                i += 1
                j += 1
            }
        }
        return Self.joined(dirty)
    }

    /// Sorted, with ranges that overlap or touch made into one.
    static func joined(_ ranges: [NSRange]) -> [NSRange] {
        var result: [NSRange] = []
        for range in ranges.sorted(by: { $0.location < $1.location }) {
            if let last = result.last, range.location <= last.upperBound {
                result[result.count - 1] = NSUnionRange(last, range)
            } else {
                result.append(range)
            }
        }
        return result
    }
}
