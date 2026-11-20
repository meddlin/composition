import Foundation
import Markdown

// What the preview draws (spike S4): a note read by `NoteScanner`, turned into blocks a view can draw without making any
// decision of its own. The Markdown comes out of swift-markdown as our own small model (so the app never imports it, and a
// different renderer, such as the text view the design settles on, can use the same model); the components arrive with their
// props already read, and the notices the desktop shows for props it cannot use (a link that is not a repository, a chart
// with no numbers) are decided here.

public enum MdInline: Equatable, Sendable {
    case text(String)
    case code(String)
    case emphasis([MdInline])
    case strong([MdInline])
    case strikethrough([MdInline])
    case link(destination: String?, [MdInline])
    case image(source: String, alt: String, title: String?, width: ImageWidth?)
    /// `<Mark color="green">…</Mark>` in a line of text; the colour is as written, and an unknown one is yellow.
    case mark(color: String?, [MdInline])
    case softBreak
    case lineBreak
}

public struct MdListItem: Equatable, Sendable {
    /// `[x]` or `[ ]` in front of the item: nil for an ordinary item, else whether it is ticked.
    public var checked: Bool?
    public var blocks: [MdBlock]
}

public enum MdColumnAlignment: Equatable, Sendable { case leading, center, trailing }

public indirect enum MdBlock: Equatable, Sendable {
    /// `ordinal` counts the note's headings from 0 in the order they appear: what a table of contents scrolls to.
    case heading(level: Int, ordinal: Int, [MdInline])
    case paragraph([MdInline])
    case code(language: String?, text: String)
    case quote([MdBlock])
    case list(ordered: Bool, start: Int, [MdListItem])
    case rule
    case table(alignments: [MdColumnAlignment], header: [[MdInline]], rows: [[[MdInline]]])
    /// Raw HTML in a note that is not MDX, which the desktop shows as text.
    case html(String)
}

public enum PanelTone: Equatable, Sendable { case info, warning }

public struct TocEntry: Equatable, Sendable {
    /// 0 for a top-level heading, 1 for one nested under it, and so on.
    public var level: Int
    public var text: String
    /// The heading it scrolls to (`MdBlock.heading`'s `ordinal`).
    public var ordinal: Int
}

public struct FootnoteEntry: Equatable, Sendable {
    public var number: Int
    public var blocks: [MdBlock]
}

public enum PreviewImageSource: Equatable, Sendable {
    /// A file stored with the notes, by name in `app_data/`.
    case stored(String)
    case remote(String)
}

public indirect enum PreviewBlock: Equatable, Sendable {
    case markdown([MdBlock])
    case panel(PanelTone, [PreviewBlock])
    case toc([TocEntry])
    case footnotes([FootnoteEntry])
    /// `<Image>`, `<Drawio>` (a diagram is a stored picture) and `<Ink>` (so is a drawing; the app draws it from its strokes when the picture carries them).
    case image(source: PreviewImageSource, alt: String, title: String?, width: ImageWidth?, isDiagram: Bool)
    case chart(ChartSpec, title: String?, height: Double)
    case repo(RepoRef, description: String?)
    case youtube(YouTubeRef, title: String)
    /// `<Mark>` on lines of its own: what is in it, highlighted.
    case highlight(color: String?, [PreviewBlock])
    /// Said in words where a component could not be drawn, so the rest of the note stays put.
    case notice(String)
}

/// A block of a note's preview and where its source is in the note's text, in UTF-16 units (what a text view counts in): what the Live tab draws in place of
/// that text (docs/ipad-live-default-plan.md, Step 5). A component is one, from its opening tag to the end of its closing one; a run of Markdown between
/// components is one per Markdown block in it (a paragraph, a list, a table), each `.markdown` with that one block, so that the Live tab can draw a table as
/// the Preview does and leave the paragraphs round it to its own look.
public struct LocatedBlock: Equatable, Sendable {
    public var range: NSRange
    public var block: PreviewBlock

    public init(range: NSRange, block: PreviewBlock) {
        self.range = range
        self.block = block
    }
}

public struct NotePreview: Sendable {
    public var blocks: [PreviewBlock]
    /// Why the note's components are not drawn (it is not valid MDX): shown above the note drawn as plain Markdown.
    public var error: String?
    public var headings: [NoteHeading]
    /// The top-level blocks with where they are written, in order, never overlapping: the same blocks as `blocks`, with each run of Markdown split into its
    /// own blocks. The footnotes listed at the end of a note with no `<Footnotes />` are written nowhere, and so are not among them.
    public var located: [LocatedBlock] = []
    /// The footnotes' definitions as they are written, each run of them (definitions with only blank lines between) a `.footnotes` block of their entries, in the
    /// order written, numbered as the list numbers them: what the Live tab draws in place of them (docs/ipad-live-default-plan.md, Step 7). At the end of a
    /// note, where definitions are usually written, a run reads as the list the Preview adds there. Only definitions that are cited.
    public var footnoteDefinitions: [LocatedBlock] = []

    /// The preview of a note's stored text, frontmatter and all. The located blocks' ranges are in `content`.
    public static func make(content: String) -> NotePreview {
        let body = NoteFrontmatter.split(content).body
        let offset = content.hasSuffix(body) ? content.utf16.count - body.utf16.count : 0
        return make(scanned: NoteScanner.scan(body, at: offset))
    }

    public static func make(scanned: ScannedNote) -> NotePreview {
        var builder = Builder(scanned: scanned)
        var (blocks, located) = builder.buildTop()
        // A note with footnotes and no `<Footnotes />` lists them at the end, as the desktop does.
        if !builder.placedFootnotes, !scanned.footnotes.isEmpty { blocks.append(.footnotes(builder.footnoteEntries())) }
        var preview = NotePreview(blocks: blocks, error: scanned.error, headings: scanned.headings, located: located)
        if !scanned.footnoteDefinitions.isEmpty {
            let entries = builder.footnoteEntries()
            preview.footnoteDefinitions = scanned.footnoteDefinitions.compactMap { run in
                guard let first = run.first, let last = run.last else { return nil }
                let range = NSRange(location: first.range.location, length: NSMaxRange(last.range) - first.range.location)
                return LocatedBlock(range: range, block: .footnotes(run.map { entries[$0.number - 1] }))
            }
        }
        return preview
    }

    // MARK: Components

    private struct Builder {
        let scanned: ScannedNote
        var converter: MarkdownConverter
        let footnoteNumbers: [String: Int]
        var placedFootnotes = false

        init(scanned: ScannedNote) {
            self.scanned = scanned
            footnoteNumbers = Dictionary(uniqueKeysWithValues: scanned.footnotes.enumerated().map { ($1, $0 + 1) })
            converter = MarkdownConverter(footnoteNumbers: footnoteNumbers)
        }

        /// The note's own blocks, as `build` makes them, and the same blocks located in the note: each run of Markdown is parsed once, and its blocks are converted
        /// one by one (what `MarkdownConverter.blocks` does) so that each keeps where swift-markdown found it.
        mutating func buildTop() -> (blocks: [PreviewBlock], located: [LocatedBlock]) {
            var blocks: [PreviewBlock] = []
            var located: [LocatedBlock] = []
            for (index, block) in scanned.blocks.enumerated() {
                switch block {
                case .markdown(let source):
                    let document = Document(note: source)
                    let map = SourceMap(text: source)
                    let locator = scanned.locator(ofRun: index, text: source)
                    var all: [MdBlock] = []
                    for child in document.children {
                        guard let converted = converter.block(child) else { continue }
                        all.append(converted)
                        if let written = map.range(of: child), let range = locator?.noteRange(written) {
                            located.append(LocatedBlock(range: range, block: .markdown([converted])))
                        }
                    }
                    blocks.append(.markdown(all))
                case .element(let name, let props, let children):
                    let made = element(name, props, children)
                    blocks += made
                    if made.count == 1, index < scanned.blockRanges.count { located.append(LocatedBlock(range: scanned.blockRanges[index], block: made[0])) }
                }
            }
            return (blocks, located)
        }

        mutating func build(_ blocks: [NoteBlock]) -> [PreviewBlock] {
            blocks.flatMap { block -> [PreviewBlock] in
                switch block {
                case .markdown(let source): return [.markdown(converter.blocks(Document(note: source)))]
                case .element(let name, let props, let children): return element(name, props, children)
                }
            }
        }

        private func text(_ props: [String: MdxPropValue], _ name: String) -> String? {
            if case .text(let value) = props[name] { return value }
            return nil
        }

        private mutating func element(_ name: String, _ props: [String: MdxPropValue], _ children: [NoteBlock]) -> [PreviewBlock] {
            switch name {
            case "Info": return [.panel(.info, build(children))]
            case "Warning": return [.panel(.warning, build(children))]
            case "Mark": return [.highlight(color: text(props, "color"), build(children))]
            case "Image", "Drawio", "Ink":
                guard let src = text(props, "src")?.trimmingCharacters(in: .whitespaces), !src.isEmpty else { return [] }
                let source: PreviewImageSource = NoteImage.name(fromRef: src).map { .stored($0) } ?? .remote(src)
                return [.image(source: source, alt: text(props, "alt") ?? "", title: text(props, "title"), width: NoteImage.parseWidth(text(props, "width")), isDiagram: name == "Drawio")]
            case "Toc": return [.toc(tocEntries(maxDepth: text(props, "maxDepth")))]
            case "Footnotes":
                // The first tag holds the list; a second is left empty.
                guard !placedFootnotes else { return [] }
                placedFootnotes = true
                return [.footnotes(footnoteEntries())]
            case "YouTube":
                let url = text(props, "url")?.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let ref = NoteYouTube.parse(url, start: text(props, "start")) else {
                    return [.notice(url.map { $0.isEmpty ? "YouTube video: add a url" : "Not a YouTube video: \($0)" } ?? "YouTube video: add a url")]
                }
                let title = text(props, "title")?.trimmingCharacters(in: .whitespacesAndNewlines)
                return [.youtube(ref, title: title.flatMap { $0.isEmpty ? nil : $0 } ?? "YouTube video")]
            case "Repo":
                let url = text(props, "url")?.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let ref = NoteRepo.parse(url) else {
                    return [.notice(url.map { $0.isEmpty ? "Repository: add a url" : "Not a repository address: \($0)" } ?? "Repository: add a url")]
                }
                let description = text(props, "description")?.trimmingCharacters(in: .whitespacesAndNewlines)
                return [.repo(ref, description: description.flatMap { $0.isEmpty ? nil : $0 })]
            case "Chart":
                switch NoteChart.parse(type: text(props, "type"), x: text(props, "x"), y: text(props, "y"), csv: csv(in: children)) {
                case .failure(let message): return [.notice(message)]
                case .chart(let spec):
                    let height = text(props, "height").flatMap { Double($0.trimmingCharacters(in: .whitespaces)) } ?? 280
                    return [.chart(spec, title: text(props, "title"), height: min(max(height, 120), 800))]
                }
            default: return []
            }
        }

        /// The CSV of a chart: the code blocks (and text) inside the tag.
        private func csv(in blocks: [NoteBlock]) -> String {
            blocks.map { block -> String in
                switch block {
                case .markdown(let source): NotePreview.codeAndText(Document(note: source))
                case .element(_, _, let children): csv(in: children)
                }
            }.joined(separator: "\n")
        }

        /// The lines of a table of contents. A heading nests under the closest one above it that is shallower; `maxDepth` stops at
        /// that heading level, 1 to 6, and is 6 when missing or out of range.
        private func tocEntries(maxDepth: String?) -> [TocEntry] {
            let deepest = maxDepth.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) } ?? 6
            let limit = (1...6).contains(deepest) ? deepest : 6
            var open: [Int] = []
            var entries: [TocEntry] = []
            for (ordinal, heading) in scanned.headings.enumerated() where heading.depth <= limit {
                while let last = open.last, last >= heading.depth { open.removeLast() }
                entries.append(TocEntry(level: open.count, text: heading.text, ordinal: ordinal))
                open.append(heading.depth)
            }
            return entries
        }

        func footnoteEntries() -> [FootnoteEntry] {
            scanned.footnotes.enumerated().map { index, label in
                var plain = MarkdownConverter(countsHeadings: false, footnoteNumbers: footnoteNumbers)
                return FootnoteEntry(number: index + 1, blocks: plain.blocks(Document(note: scanned.footnoteBodies[label] ?? "")))
            }
        }
    }

    static func codeAndText(_ markup: any Markup) -> String {
        switch markup {
        case let code as CodeBlock: return code.code
        case let text as Text: return text.string
        case let code as InlineCode: return code.code
        default: return markup.children.map { codeAndText($0) }.joined(separator: "\n")
        }
    }
}

/// swift-markdown's tree as `MdBlock`s.
struct MarkdownConverter {
    var countsHeadings = true
    /// Footnote numbers by label: a `[^label]` in the text becomes its number in superscript digits (as in the terminal app).
    var footnoteNumbers: [String: Int] = [:]
    private var headings = 0
    /// How many links the inlines being read are inside: a bare address in a link's own text is not made a link of its own.
    private var linkDepth = 0

    init(countsHeadings: Bool = true, footnoteNumbers: [String: Int] = [:]) {
        self.countsHeadings = countsHeadings
        self.footnoteNumbers = footnoteNumbers
    }

    /// `text` with each citation of a footnote that exists replaced by its number. Done on the parsed text, not the source: the
    /// source's `**back up <Mark>first</Mark>**[^a]` would stop closing its bold if the `[` were replaced by a digit.
    private func numbered(_ text: String) -> String {
        guard !footnoteNumbers.isEmpty, text.contains("[^") else { return text }
        var out = ""
        var rest = Substring(text)
        while let open = rest.range(of: "[^") {
            out += rest[..<open.lowerBound]
            let after = rest[open.upperBound...]
            if let close = after.firstIndex(of: "]"), case let label = String(after[..<close]), !label.isEmpty,
                !label.contains(where: \.isWhitespace), let number = footnoteNumbers[label] {
                out += NoteScanner.superscript(number)
                rest = after[after.index(after: close)...]
            } else {
                out += "[^"
                rest = after
            }
        }
        return out + rest
    }

    mutating func blocks(_ container: any Markup) -> [MdBlock] {
        container.children.compactMap { block($0) }
    }

    mutating func block(_ markup: any Markup) -> MdBlock? {
        switch markup {
        case let heading as Heading:
            let ordinal = headings
            if countsHeadings { headings += 1 }
            return .heading(level: heading.level, ordinal: ordinal, inlines(heading.children))
        case let paragraph as Paragraph:
            return .paragraph(inlines(paragraph.children))
        case let code as CodeBlock:
            return .code(language: code.language.flatMap { $0.isEmpty ? nil : $0 }, text: code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code)
        case let quote as BlockQuote:
            return .quote(blocks(quote))
        case let list as UnorderedList:
            return .list(ordered: false, start: 1, items(of: list))
        case let list as OrderedList:
            return .list(ordered: true, start: Int(list.startIndex), items(of: list))
        case is ThematicBreak:
            return .rule
        case let table as Table:
            let alignments = table.columnAlignments.map { alignment -> MdColumnAlignment in
                switch alignment { case .center: .center; case .right: .trailing; default: .leading }
            }
            let header = Array(table.head.cells).map { inlines($0.children) }
            let rows = Array(table.body.rows).map { row in Array(row.cells).map { inlines($0.children) } }
            return .table(alignments: alignments, header: header, rows: rows)
        case let html as HTMLBlock:
            return .html(html.rawHTML.trimmingCharacters(in: .whitespacesAndNewlines))
        default:
            let text = NoteScanner.plainText(markup)
            return text.isEmpty ? nil : .paragraph([.text(text)])
        }
    }

    private mutating func items(of list: any ListItemContainer) -> [MdListItem] {
        list.listItems.map { item in
            MdListItem(checked: item.checkbox.map { $0 == .checked }, blocks: blocks(item))
        }
    }

    /// Inline content. `<Mark>` and an inline `<Image>` arrive as raw HTML, found again here by reading each tag.
    mutating func inlines(_ children: some Sequence<any Markup>) -> [MdInline] {
        let nodes = Array(children)
        var out: [MdInline] = []
        var i = 0
        while i < nodes.count {
            let node = nodes[i]
            i += 1
            if let html = node as? InlineHTML {
                guard let tag = NoteScanner.lone(html.rawHTML) else { continue }  // any other HTML: not shown
                if tag.name == "Mark", !tag.closing {
                    // Everything up to the matching `</Mark>` among these siblings is the highlighted text.
                    var depth = 1
                    var j = i
                    while j < nodes.count {
                        if let inner = (nodes[j] as? InlineHTML).flatMap({ NoteScanner.lone($0.rawHTML) }), inner.name == "Mark" {
                            depth += inner.closing ? -1 : 1
                            if depth == 0 { break }
                        }
                        j += 1
                    }
                    let color = tag.props["color"].flatMap { if case .text(let value) = $0 { value } else { nil } }
                    out.append(.mark(color: color, inlines(nodes[i..<min(j, nodes.count)])))
                    i = min(j + 1, nodes.count)
                } else if tag.name == "Image", !tag.closing {
                    func prop(_ name: String) -> String? { if case .text(let value) = tag.props[name] { value } else { nil } }
                    if let src = prop("src"), !src.isEmpty {
                        out.append(.image(source: src, alt: prop("alt") ?? "", title: prop("title"), width: NoteImage.parseWidth(prop("width"))))
                    }
                }
                continue
            }
            if let inline = inline(node) { out.append(inline) }
        }
        return joined(out)
    }

    /// Neighbouring text as one, as the desktop has it (cmark leaves a run of text in pieces where it tried a `_` or a `[` and did not use it), with the
    /// bare addresses in it made links (`PreviewAutolinks`) unless it is a link's own text. A soft line break is read as the `\n` it stands for.
    private func joined(_ inlines: [MdInline]) -> [MdInline] {
        var out: [MdInline] = []
        var run: String?
        func flush() {
            guard let text = run else { return }
            run = nil
            for piece in linkDepth == 0 ? PreviewAutolinks.pieces(text) : [.text(text)] {
                switch piece {
                case .link(let url, let text): out.append(.link(destination: url, [.text(text)]))
                case .text(let text):
                    for (index, line) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
                        if index > 0 { out.append(.softBreak) }
                        if !line.isEmpty { out.append(.text(String(line))) }
                    }
                }
            }
        }
        for inline in inlines {
            switch inline {
            case .text(let text): run = (run ?? "") + text
            case .softBreak: run = (run ?? "") + "\n"
            default:
                flush()
                out.append(inline)
            }
        }
        flush()
        return out
    }

    private mutating func inline(_ markup: any Markup) -> MdInline? {
        switch markup {
        case let text as Text: return .text(numbered(text.string))
        case let code as InlineCode: return .code(code.code)
        case let emphasis as Emphasis: return .emphasis(inlines(emphasis.children))
        case let strong as Strong: return .strong(inlines(strong.children))
        case let strike as Strikethrough: return .strikethrough(inlines(strike.children))
        case let link as Link:
            linkDepth += 1
            defer { linkDepth -= 1 }
            return .link(destination: link.destination, inlines(link.children))
        case let image as Image: return .image(source: image.source ?? "", alt: NoteScanner.plainText(image), title: image.title, width: nil)
        case is SoftBreak: return .softBreak
        case is LineBreak: return .lineBreak
        case let symbol as SymbolLink: return .code(symbol.destination ?? "")
        default:
            let text = NoteScanner.plainText(markup)
            return text.isEmpty ? nil : .text(text)
        }
    }
}
