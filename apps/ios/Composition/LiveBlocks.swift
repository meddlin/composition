import CompositionCore
import SwiftUI
import UIKit

// The block layer of the Live tab (docs/ipad-live-default-plan.md, Step 5). A block (a table now; components, `<Toc />`, footnotes and the frontmatter's header in Steps 6
// and 7) is "this range of the note's text, drawn as this `PreviewBlock`": the range and the block come from the whole-note `NotePreview` the styler makes in its pause
// pass, off the main thread, as the Preview makes its own (`LivePreview`); the picture is the Preview's own SwiftUI view for that block (`PreviewBlockView`), rendered by
// `ImageRenderer`. Away from the selection every character of the block is hidden, its first paragraph is made as tall as the picture and the picture drawn there
// (`LiveDrawing.Kind.block`); while the selection is in it (decision D3) its source shows, with the last good picture under it (`.blockAfter`), redrawn after the pause.
// The text is never changed: no attachment, no `U+FFFC`.

/// Which blocks the Live tab draws as pictures: **the one place Steps 6 and 7 add to.** Everything else about a block (its range, its picture, hiding it, revealing it,
/// a tap on it, what the report and VoiceOver say) is the same for every kind.
enum LiveBlockKinds {
    /// The block's kind as the report names it (`block-table`), or nil when the Live tab leaves it to its own look (a paragraph, a list, a heading: Steps 1 to 4).
    static func kind(of block: PreviewBlock) -> String? {
        switch block {
        case .markdown(let blocks):
            guard blocks.count == 1, case .table = blocks[0] else { return nil }
            return "table"
        // Step 6: .panel, .chart, .repo, .youtube, .highlight, .notice (and .image for a component the picture layer does not draw). Step 7: .toc, .footnotes.
        default:
            return nil
        }
    }

    /// Whether the block is drawn at its own width, as the Preview's sideways scroll view lets a table be (and offered the text's width only when it is wider), rather
    /// than across the text's width, as a panel or a chart is.
    static func sizesToContent(_ block: PreviewBlock) -> Bool { kind(of: block) == "table" }

    /// Whether a note may hold a block that is drawn, so that a note that cannot is not read a second time in the pause (a table needs a pipe).
    static func mayHold(_ text: String) -> Bool { text.contains("|") }
}

/// A block the Live tab draws: where its source is, what it is, and the text of that source (what its picture is cached by).
struct LiveBlock: Sendable {
    var range: NSRange
    var block: PreviewBlock
    var kind: String
    var source: String

    /// The blocks of a note that are drawn, from its preview (`NotePreview.located`); made off the main thread, in the pause pass.
    static func blocks(of text: String) -> [LiveBlock] {
        guard LiveBlockKinds.mayHold(text) else { return [] }
        let whole = text as NSString
        return NotePreview.make(content: text).located.compactMap { located in
            guard let kind = LiveBlockKinds.kind(of: located.block), NSMaxRange(located.range) <= whole.length else { return nil }
            return LiveBlock(range: located.range, block: located.block, kind: kind, source: whole.substring(with: located.range))
        }
    }
}

/// The picture of a block, and how big it is drawn.
final class LiveBlockPicture: @unchecked Sendable {
    let image: UIImage
    init(image: UIImage) { self.image = image }

    /// The size it is drawn at in a line `available` points wide: its own size, or scaled down to fit (a table whose columns cannot wrap any narrower).
    func size(available: CGFloat) -> CGSize {
        let size = image.size
        guard size.width > available, size.width > 0 else { return size }
        return CGSize(width: available, height: size.height * available / size.width)
    }
}

/// The blocks of the note in the Live tab, with their pictures. Owned by `MarkdownStyler`, on the main thread.
@MainActor
final class LiveBlocks {
    /// What one drawn block is now: its block, and the picture it is drawn with, which may be the last good one of a block that has changed since (D3) and is then
    /// `stale` until the picture of what it is now has been rendered.
    struct Entry {
        var block: LiveBlock
        var picture: LiveBlockPicture?
        var stale: Bool
        /// Rendering it gave nothing: it is not tried again until the block changes.
        var failed = false
    }

    private(set) var entries: [Entry] = []
    /// Pictures already rendered, by the block's source and the width they were rendered at. Emptied when the look or the text size changes.
    private let cache = NSCache<NSString, LiveBlockPicture>()

    init() { cache.countLimit = 200 }

    /// The text changed between passes: the blocks after the edit move, and one the edit falls in grows or shrinks with it (it is the one the caret is in, so it is
    /// showing its source; the pause pass reads it again).
    func edited(replacing range: NSRange, withLength newLength: Int) {
        let delta = newLength - range.length
        for index in entries.indices {
            let block = entries[index].block.range
            // After the block: it is as it was. What is typed right at its end goes on its last line, so it is in the block (the caret is, and its source shows).
            if range.location > NSMaxRange(block) { continue }
            if NSMaxRange(range) <= block.location {
                entries[index].block.range.location += delta
                continue
            }
            let start = min(block.location, range.location)
            let end = max(NSMaxRange(block) + delta, range.location + newLength)
            entries[index].block.range = NSRange(location: start, length: max(0, end - start))
        }
    }

    /// The blocks a fresh pass found replace the ones there were. A block whose picture is cached has it; another keeps the picture of the block it replaces (the one
    /// at the same place), stale, until its own is rendered. Returns the ranges whose look changes.
    func replace(with fresh: [LiveBlock], width: CGFloat) -> [NSRange] {
        let old = entries
        var changed: [NSRange] = []
        var next: [Entry] = []
        for block in fresh {
            if let cached = cache.object(forKey: Self.key(block, width: width)) {
                next.append(Entry(block: block, picture: cached, stale: false))
            } else {
                let previous = old.first { NSIntersectionRange($0.block.range, block.range).length > 0 || $0.block.range.location == block.range.location }
                next.append(Entry(block: block, picture: previous?.picture, stale: true))
            }
        }
        // What changes: every block that is new, gone, moved or drawn with another picture.
        func signature(_ entry: Entry) -> String {
            "\(NSStringFromRange(entry.block.range))|\(entry.block.source.hashValue)|\(entry.picture.map { ObjectIdentifier($0).hashValue } ?? 0)"
        }
        let before = Set(old.map(signature)), after = Set(next.map(signature))
        for entry in next where !before.contains(signature(entry)) { changed.append(entry.block.range) }
        for entry in old where !after.contains(signature(entry)) { changed.append(entry.block.range) }
        entries = next
        return changed
    }

    /// Forgets every picture (the look, the text size or the width changed): they are rendered again as they come into view.
    func forgetPictures() {
        cache.removeAllObjects()
        for index in entries.indices { entries[index].stale = true }
    }

    /// Every picture is to be rendered again (the width changed): each is drawn with the one it has until then.
    func markStale() { for index in entries.indices { entries[index].stale = true } }

    func clear() { entries = [] }

    /// The blocks that touch `range` (ends included).
    func entries(touching range: NSRange) -> [Entry] {
        entries.filter { $0.block.range.location <= NSMaxRange(range) && NSMaxRange($0.block.range) >= range.location }
    }

    /// The ranges of the blocks the selection touches, ends included: a block shows its source while the selection is in it (D3).
    func ranges(touching selection: NSRange) -> [NSRange] { entries(touching: selection).map(\.block.range) }

    /// Renders the pictures that are missing or stale for the blocks near `window` (the characters on screen, widened), one at a time; `rendered` is called with the
    /// range of each block whose picture changed, to draw it again. Returns how many are left to render (the caller calls again on the next turn of the run loop, so that no
    /// frame is held for more than one block).
    func renderOne(near window: NSRange, width: CGFloat, look: Look, traits: UITraitCollection, imageFolder: URL?) -> NSRange? {
        guard let index = entries.indices.first(where: {
            (entries[$0].picture == nil || entries[$0].stale) && !entries[$0].failed && NSIntersectionRange(entries[$0].block.range, window).length > 0
        }) else { return nil }
        let block = entries[index].block
        let key = Self.key(block, width: width)
        let picture = cache.object(forKey: key) ?? LiveBlockRenderer.render(block.block, width: width, look: look, traits: traits, imageFolder: imageFolder).map { LiveBlockPicture(image: $0) }
        if let picture { cache.setObject(picture, forKey: key) }
        entries[index].picture = picture ?? entries[index].picture
        entries[index].stale = false
        entries[index].failed = picture == nil
        return block.range
    }

    private static func key(_ block: LiveBlock, width: CGFloat) -> NSString { "\(Int(width.rounded()))|\(block.source)" as NSString }
}

/// The Preview's own view of a block, rendered to a picture (one renderer: nothing here draws a block itself).
@MainActor
enum LiveBlockRenderer {
    /// `block` drawn as the Preview draws it, in a text `width` points wide, in `look` and at the text size of `traits`. The Preview's sideways scrolling is left out
    /// (`previewScrolls`): `ImageRenderer` does not draw a `ScrollView`'s content. A table (`sizesToContent`) is drawn at its own width, as in the Preview; one wider than
    /// the text is offered the text's width, so its cells wrap, and one still wider (columns that cannot wrap) comes back wider and is drawn scaled down to fit
    /// (`LiveBlockPicture.size`). It is never clipped.
    static func render(_ block: PreviewBlock, width: CGFloat, look: Look, traits: UITraitCollection, imageFolder: URL?) -> UIImage? {
        if LiveBlockKinds.sizesToContent(block), let own = render(block, proposing: nil, look: look, traits: traits, imageFolder: imageFolder), own.size.width <= width {
            return own
        }
        return render(block, proposing: max(width, 100), look: look, traits: traits, imageFolder: imageFolder)
    }

    private static func render(_ block: PreviewBlock, proposing width: CGFloat?, look: Look, traits: UITraitCollection, imageFolder: URL?) -> UIImage? {
        let content = PreviewBlockView(block: block)
            .environment(\.previewScrolls, false)
            .environment(\.look, look)
            .environment(\.imageFolder, imageFolder)
            .environment(\.colorScheme, look.colorScheme)
            .environment(\.dynamicTypeSize, DynamicTypeSize(traits.preferredContentSizeCategory) ?? .large)
            .fontDesign(look.previewFont.design)
            .foregroundStyle(look.foreground)
            .tint(look.link)
        let renderer = ImageRenderer(content: content)
        renderer.proposedSize = ProposedViewSize(width: width, height: nil)
        renderer.scale = traits.displayScale > 0 ? traits.displayScale : 2
        renderer.isOpaque = false
        return renderer.uiImage
    }
}
