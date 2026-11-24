import CompositionCore
import SwiftUI
import UIKit

// The block layer of the Live tab (docs/ipad-live-default-plan.md, Step 5). A block (a table, and the components of Step 6; `<Toc />`, footnotes and the frontmatter's
// header in Step 7) is "this range of the note's text, drawn as this `PreviewBlock`": the range and the block come from the whole-note `NotePreview` the styler makes in its pause
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
        // Step 6: the components, each the Preview's own view of it (its children drawn inside a panel or a block `<Mark>`). `<Image>`, `<Ink>` and `<Drawio>` are not
        // here: the picture layer (`LiveScan`, Step 1) already draws them where their tag is, at the Preview's size.
        case .panel(let tone, _): return tone == .info ? "info" : "warning"
        case .chart: return "chart"
        case .youtube: return "youtube"
        case .repo: return "repo"
        case .highlight: return "mark"
        case .notice: return "notice"
        // Step 7: `<Toc />`, and `<Footnotes />` or a run of footnote definitions (`NotePreview.footnoteDefinitions`), both drawn as the Preview's list.
        case .toc: return "toc"
        case .footnotes: return "footnotes"
        default:
            return nil
        }
    }

    /// Where a block's ↗ goes while the selection is in it (owner decision I6): a `<YouTube>` video on youtube.com, a `<Repo>` at its address, the same places the
    /// Preview's cards open. Nil for every other block, which a tap only edits.
    static func address(of block: PreviewBlock) -> String? {
        switch block {
        case .youtube(let ref, _): return ref.watchURL
        case .repo(let ref, _): return ref.href
        default: return nil
        }
    }

    /// Whether the block is drawn at its own width, as the Preview's sideways scroll view lets a table be (and offered the text's width only when it is wider), rather
    /// than across the text's width, as a panel or a chart is.
    static func sizesToContent(_ block: PreviewBlock) -> Bool { kind(of: block) == "table" }

    /// Whether a note may hold a block that is drawn, so that a note that cannot is not read a second time in the pause (a table needs a pipe, a component a `<`;
    /// Step 7's need `<Toc`, `<Footnotes`, a footnote's `[^` or a frontmatter).
    static func mayHold(_ text: String) -> Bool { mayHoldInBody(text) || text.hasPrefix("---") || text.hasPrefix("\u{FEFF}---") }

    /// Whether the note's body may hold a block, so that the note is read as the Preview reads it (a note with only a frontmatter, which most have, is not).
    static func mayHoldInBody(_ text: String) -> Bool { text.contains("|") || text.contains("<") || text.contains("[^") }

    /// The frontmatter's header (Step 7, D5): drawn in place of the YAML away from the caret, and while the caret is in it only the YAML shows, with no picture under it.
    static let frontmatter = "frontmatter"

    /// Whether a block shows its last picture after its source while the selection is in it (D3). The frontmatter does not (D5).
    static func picturedWhileEditing(_ kind: String) -> Bool { kind != frontmatter }
}

/// A block the Live tab draws: where its source is, what it is, and the text of that source.
struct LiveBlock: Sendable {
    var range: NSRange
    var block: PreviewBlock
    var kind: String
    var source: String
    /// The frontmatter's header (Step 7): what `NoteReader` shows above the body, drawn in place of the YAML. `block` is then an empty `.markdown([])`.
    var header: LiveHeader? = nil
    /// What its picture is cached and compared by: its source, and, for a block drawn from more of the note than its own text, what it is drawn from. Gate LD7
    /// (docs/manual-tests/ipad.md items 364 and 365) found `<Toc />` never gaining a heading added above it, and a footnote list keeping its old numbers after a
    /// citation was added: their source had not changed, so the picture cached by it was drawn again, and the block was not seen to change.
    let identity: String

    init(range: NSRange, block: PreviewBlock, kind: String, source: String, header: LiveHeader? = nil) {
        self.range = range
        self.block = block
        self.kind = kind
        self.source = source
        self.header = header
        identity = Self.drawnFromTheWholeNote(kind: kind, source: source) ? source + "\u{1F}" + String(describing: block) : source
    }

    /// Whether what a block draws depends on the rest of the note: `<Toc />` (the headings), a footnote list (the numbers and the footnotes' text), and any block
    /// that cites a footnote (its number).
    static func drawnFromTheWholeNote(kind: String, source: String) -> Bool {
        kind == "toc" || kind == "footnotes" || source.contains("[^")
    }

    /// The blocks of a note that are drawn, from its preview (`NotePreview.located`); made off the main thread, in the pause pass. Nil while the note is not valid MDX
    /// (Step 6): the Preview then draws it as plain Markdown under its notice, and the Live tab keeps the pictures it last drew, with no notice of its own, until the
    /// note is valid again (a tag half typed should not un-draw every panel and chart in the note).
    static func blocks(of text: String) -> [LiveBlock]? {
        guard LiveBlockKinds.mayHold(text) else { return [] }
        let whole = text as NSString
        var found: [LiveBlock] = []
        // The frontmatter, drawn as the Preview's header (D5).
        if let header = LiveHeader.of(text) {
            found.append(LiveBlock(range: header.range, block: .markdown([]), kind: LiveBlockKinds.frontmatter, source: whole.substring(with: header.range), header: header))
        }
        guard LiveBlockKinds.mayHoldInBody(text) else { return found }
        let preview = NotePreview.make(content: text)
        guard preview.error == nil else { return nil }
        found += preview.located.compactMap { located in
            guard let kind = LiveBlockKinds.kind(of: located.block), NSMaxRange(located.range) <= whole.length else { return nil }
            return LiveBlock(range: located.range, block: located.block, kind: kind, source: whole.substring(with: located.range))
        }
        // Step 7: the footnotes' definitions, each run of them drawn as the Preview's list of their entries. One inside a component is that component's to draw.
        for run in preview.footnoteDefinitions where NSMaxRange(run.range) <= whole.length {
            guard !preview.located.contains(where: { NSIntersectionRange($0.range, run.range).length > 0 }) else { continue }
            found.append(LiveBlock(range: run.range, block: run.block, kind: "footnotes", source: whole.substring(with: run.range)))
        }
        return found.sorted { $0.range.location < $1.range.location }
    }
}

/// What the Preview shows above a note's body, from its frontmatter (`NoteReader`'s header: the header image, the title, the date and the tags), and where the frontmatter
/// is written. Only for a frontmatter that reads: one that does not stays its YAML, so nothing typed wrongly is hidden behind a header that says "Untitled".
struct LiveHeader: Sendable, Equatable {
    var range: NSRange
    var title: String
    var updated: String
    var tags: String
    var headerImage: HeaderImage?

    static func of(_ text: String) -> LiveHeader? {
        let body = NoteFrontmatter.split(text).body
        guard text.hasSuffix(body) else { return nil }
        var end = text.utf16.count - body.utf16.count
        guard end > 0, let frontmatter = NoteFrontmatter.parse(text).frontmatter else { return nil }
        // To the end of the closing `---`'s line: its line break is the body's.
        let units = Array(text.utf16.prefix(end))
        while end > 0, units[end - 1] == 0x0A || units[end - 1] == 0x0D { end -= 1 }
        return LiveHeader(range: NSRange(location: 0, length: end), title: frontmatter.title, updated: frontmatter.updatedAt,
                          tags: NoteFrontmatter.tagsToString(frontmatter.tags).tagLine, headerImage: frontmatter.headerImage)
    }
}

/// A row of a drawn list that can be followed (Gate LD7, docs/manual-tests/ipad.md items 364 and 365): a `<Toc />` entry, or the ↩ after a footnote. Where it is
/// drawn in the picture (in the picture's points, as rendered) and where it goes. ⌘-tap on it follows it, and while the block shows its source each row has a ↗
/// (`LiveLinks`), as a link does.
struct LiveBlockRow: Sendable, Equatable {
    enum Target: Sendable, Equatable {
        /// A heading, by its number among the note's headings (`TocEntry.ordinal`, which is `OutlineHeading.ordinal`).
        case heading(Int)
        /// The first citation of the footnote of this number (the desktop's `#fnref-label`).
        case citation(Int)
    }

    var frame: CGRect
    var target: Target
    /// What VoiceOver calls its ↗.
    var label: String
}

/// The picture of a block, and how big it is drawn.
final class LiveBlockPicture: @unchecked Sendable {
    let image: UIImage
    /// The rows in it that can be followed (a `<Toc />`'s entries, a footnote list's ↩s), where the renderer drew them.
    let rows: [LiveBlockRow]
    init(image: UIImage, rows: [LiveBlockRow] = []) {
        self.image = image
        self.rows = rows
    }

    /// The rows as drawn in `rect` (the picture scaled to it), in the same coordinates as `rect`.
    func rows(drawnIn rect: CGRect) -> [LiveBlockRow] {
        let scale = image.size.width > 0 ? rect.width / image.size.width : 1
        return rows.map { row in
            var moved = row
            moved.frame = CGRect(x: rect.minX + row.frame.minX * scale, y: rect.minY + row.frame.minY * scale, width: row.frame.width * scale, height: row.frame.height * scale)
            return moved
        }
    }

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
            "\(NSStringFromRange(entry.block.range))|\(entry.block.identity.hashValue)|\(entry.picture.map { ObjectIdentifier($0).hashValue } ?? 0)"
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
        let picture = cache.object(forKey: key) ?? LiveBlockRenderer.picture(of: block, width: width, look: look, traits: traits, imageFolder: imageFolder)
        if let picture { cache.setObject(picture, forKey: key) }
        entries[index].picture = picture ?? entries[index].picture
        entries[index].stale = false
        entries[index].failed = picture == nil
        return block.range
    }

    private static func key(_ block: LiveBlock, width: CGFloat) -> NSString { "\(Int(width.rounded()))|\(block.identity)" as NSString }
}

/// The Preview's own view of a block, rendered to a picture (one renderer: nothing here draws a block itself).
@MainActor
enum LiveBlockRenderer {
    /// `block` drawn as the Preview draws it, in a text `width` points wide, in `look` and at the text size of `traits`. The Preview's sideways scrolling is left out
    /// (`previewScrolls`): `ImageRenderer` does not draw a `ScrollView`'s content. A table (`sizesToContent`) is drawn at its own width, as in the Preview; one wider than
    /// the text is offered the text's width, so its cells wrap, and one still wider (columns that cannot wrap) comes back wider and is drawn scaled down to fit
    /// (`LiveBlockPicture.size`). It is never clipped.
    /// A Live block: the Preview's view of its `PreviewBlock`, or for the frontmatter the Preview's header (`NoteReaderHeader`), with where the rows that can be
    /// followed were drawn in it (Gate LD7).
    static func picture(of block: LiveBlock, width: CGFloat, look: Look, traits: UITraitCollection, imageFolder: URL?) -> LiveBlockPicture? {
        guard let header = block.header else { return picture(of: block.block, width: width, look: look, traits: traits, imageFolder: imageFolder) }
        // The header image is read here, at once: `ImageRenderer` draws a view as it first is, before any task of its own has run.
        var picture: (image: UIImage, pixels: CGSize)?
        if let headerImage = header.headerImage, let folder = imageFolder, case .stored(let name)? = HeaderImageSource.resolve(headerImage.image) {
            picture = DownsampledPicture.load(folder.appendingPathComponent(name), maxPixel: 2048)
        }
        let content = NoteReaderHeader(title: header.title, updated: header.updated, tags: header.tags, headerImage: header.headerImage, loadedImage: picture)
        return draw(content, proposing: max(width, 100), look: look, traits: traits, imageFolder: imageFolder)
    }

    static func render(_ block: PreviewBlock, width: CGFloat, look: Look, traits: UITraitCollection, imageFolder: URL?) -> UIImage? {
        picture(of: block, width: width, look: look, traits: traits, imageFolder: imageFolder)?.image
    }

    static func picture(of block: PreviewBlock, width: CGFloat, look: Look, traits: UITraitCollection, imageFolder: URL?) -> LiveBlockPicture? {
        if LiveBlockKinds.sizesToContent(block), let own = picture(of: block, proposing: nil, look: look, traits: traits, imageFolder: imageFolder), own.image.size.width <= width {
            return own
        }
        return picture(of: block, proposing: max(width, 100), look: look, traits: traits, imageFolder: imageFolder)
    }

    private static func picture(of block: PreviewBlock, proposing width: CGFloat?, look: Look, traits: UITraitCollection, imageFolder: URL?) -> LiveBlockPicture? {
        draw(PreviewBlockView(block: block), proposing: width, look: look, traits: traits, imageFolder: imageFolder)
    }

    private static func draw(_ view: some View, proposing width: CGFloat?, look: Look, traits: UITraitCollection, imageFolder: URL?) -> LiveBlockPicture? {
        // Where the rows that can be followed are drawn (a `<Toc />`'s entries, a footnote's ↩): the views report their frames as they are laid out (`PreviewRowFrames`).
        let rows = PreviewRowFrames()
        let content = view
            .environment(\.previewRowFrames, rows)
            .coordinateSpace(.named(PreviewRowFrames.space))
            .environment(\.previewScrolls, false)
            .environment(\.horizontalSizeClass, UserInterfaceSizeClass(traits.horizontalSizeClass))
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
        guard let image = renderer.uiImage else { return nil }
        // In the order drawn, top to bottom (SwiftUI lays the rows out in no set order).
        return LiveBlockPicture(image: image, rows: rows.rows.sorted { ($0.frame.minY, $0.frame.minX) < ($1.frame.minY, $1.frame.minX) })
    }
}
