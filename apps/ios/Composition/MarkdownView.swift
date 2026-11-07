import CompositionCore
import SwiftUI

/// The Markdown blocks of a note, drawn from `CompositionCore`'s model: the headings, text, lists, quotes, code and tables.
/// (The design settles on one read-only text view for the preview so that selection runs across blocks; this is the
/// quicker way to see every component draw, and what it cannot do is select across them.)
struct MarkdownView: View {
    let blocks: [MdBlock]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(blocks.indices, id: \.self) { MdBlockView(block: blocks[$0]) }
        }
    }
}

private struct MdBlockView: View {
    let block: MdBlock
    @Environment(\.look) private var look

    var body: some View {
        switch block {
        case .heading(let level, let ordinal, let inlines):
            Text(inlines.attributed(look))
                .font(Self.headingFont(level))
                .padding(.top, level <= 2 ? 6 : 2)
                .id(PreviewScroll.headingID(ordinal))
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let inlines):
            if let images = Self.onlyImages(inlines) {
                VStack(alignment: .leading, spacing: 8) { ForEach(images.indices, id: \.self) { InlineImageView(image: images[$0]) } }
            } else {
                Text(inlines.attributed(look)).textSelection(.enabled)
            }
        case .code(_, let text):
            ScrollView(.horizontal) {
                Text(text).font(.system(.callout, design: .monospaced)).textSelection(.enabled).padding(12)
            }
            .background(look.surface, in: RoundedRectangle(cornerRadius: 8))
        case .quote(let blocks):
            HStack(alignment: .top, spacing: 10) {
                Rectangle().fill(look.mutedText).frame(width: 3)
                MarkdownView(blocks: blocks).foregroundStyle(.secondary)
            }
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(items.indices, id: \.self) { index in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        marker(ordered: ordered, number: start + index, checked: items[index].checked)
                        MarkdownView(blocks: items[index].blocks)
                    }
                }
            }
        case .rule:
            Rectangle().fill(look.border).frame(height: 1)
        case .table(let alignments, let header, let rows):
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                    GridRow { ForEach(header.indices, id: \.self) { cell(header[$0], alignments, $0).bold() } }
                    Rectangle().fill(look.border).frame(height: 1)
                    ForEach(rows.indices, id: \.self) { row in
                        GridRow { ForEach(rows[row].indices, id: \.self) { cell(rows[row][$0], alignments, $0) } }
                    }
                }
            }
        case .html(let raw):
            Text(raw).font(.system(.callout, design: .monospaced)).foregroundStyle(.secondary)
        }
    }

    private func cell(_ inlines: [MdInline], _ alignments: [MdColumnAlignment], _ column: Int) -> some View {
        let alignment: Alignment = {
            switch column < alignments.count ? alignments[column] : .leading {
            case .leading: .leading
            case .center: .center
            case .trailing: .trailing
            }
        }()
        return Text(inlines.attributed(look)).frame(minWidth: 40, alignment: alignment)
    }

    @ViewBuilder
    private func marker(ordered: Bool, number: Int, checked: Bool?) -> some View {
        if let checked {
            Image(systemName: checked ? "checkmark.square.fill" : "square").foregroundStyle(checked ? look.brand : look.mutedText)
        } else if ordered {
            Text("\(number).").monospacedDigit().foregroundStyle(.secondary)
        } else {
            Text("•").foregroundStyle(.secondary)
        }
    }

    static func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title.bold()
        case 2: .title2.bold()
        case 3: .title3.bold()
        case 4: .headline
        case 5: .subheadline.bold()
        default: .footnote.bold()
        }
    }

    /// The images of a paragraph that is nothing but images (a paste inserts `![alt](app_data/x.png)` on its own line).
    private static func onlyImages(_ inlines: [MdInline]) -> [InlineImage]? {
        var images: [InlineImage] = []
        for inline in inlines {
            switch inline {
            case .image(let source, let alt, let title, let width): images.append(InlineImage(source: source, alt: alt, title: title, width: width))
            case .softBreak, .lineBreak: continue
            case .text(let text) where text.trimmingCharacters(in: .whitespaces).isEmpty: continue
            default: return nil
            }
        }
        return images.isEmpty ? nil : images
    }
}

struct InlineImage {
    let source: String
    let alt: String
    let title: String?
    let width: ImageWidth?
}

private struct InlineImageView: View {
    let image: InlineImage
    var body: some View {
        let stored = NoteImage.name(fromRef: image.source).map { PreviewImageSource.stored($0) } ?? .remote(image.source)
        PreviewImageView(source: stored, alt: image.alt, width: image.width, isDiagram: false)
    }
}

// MARK: Text

extension Array where Element == MdInline {
    /// The inline content as one styled run of text, in the scheme in force (code gets the faint fill, a `<Mark>` its tint).
    func attributed(_ look: Look) -> AttributedString {
        var out = AttributedString()
        for inline in self { out += inline.attributed(look) }
        return out
    }
}

private extension MdInline {
    func attributed(_ look: Look) -> AttributedString {
        switch self {
        case .text(let text): return AttributedString(text)
        case .code(let text):
            var run = AttributedString(text)
            run.inlinePresentationIntent = .code
            run.backgroundColor = look.mutedFill
            return run
        case .emphasis(let inner): return inner.attributed(look).adding(.emphasized)
        case .strong(let inner): return inner.attributed(look).adding(.stronglyEmphasized)
        case .strikethrough(let inner): return inner.attributed(look).adding(.strikethrough)
        case .link(let destination, let inner):
            var run = inner.attributed(look)
            if let destination, let url = URL(string: destination) { run.link = url }
            return run
        case .image(_, let alt, _, _):
            // An image inside a line of text cannot be a picture: its words stand in for it.
            var run = AttributedString(alt.isEmpty ? "image" : alt)
            run.inlinePresentationIntent = .emphasized
            return run
        case .mark(let color, let inner):
            var run = inner.attributed(look)
            run.backgroundColor = look.markTint(color)
            return run
        case .softBreak: return AttributedString(" ")
        case .lineBreak: return AttributedString("\n")
        }
    }
}

private extension AttributedString {
    func adding(_ intent: InlinePresentationIntent) -> AttributedString {
        var copy = self
        for run in copy.runs { copy[run.range].inlinePresentationIntent = (run.inlinePresentationIntent ?? []).union(intent) }
        return copy
    }
}
