import Charts
import CompositionCore
import SwiftUI

// A note's preview: Markdown and the ten components, drawn natively (spike S4, docs/ipad-app-design.md). The decisions
// (which component, what its props mean, what to say when they cannot be used) are made in `CompositionCore`'s `NotePreview`;
// these views only draw what it gives.

/// Where headings scroll to: a table of contents calls this with the heading's ordinal.
enum PreviewScroll {
    static func headingID(_ ordinal: Int) -> String { "heading-\(ordinal)" }
}

private struct ScrollToHeadingKey: EnvironmentKey {
    static let defaultValue: @MainActor (Int) -> Void = { _ in }
}

private struct ImageFolderKey: EnvironmentKey {
    static let defaultValue: URL? = nil
}

extension EnvironmentValues {
    var scrollToHeading: @MainActor (Int) -> Void {
        get { self[ScrollToHeadingKey.self] }
        set { self[ScrollToHeadingKey.self] = newValue }
    }

    /// The folder the notes' stored images are in (`app_data/`).
    var imageFolder: URL? {
        get { self[ImageFolderKey.self] }
        set { self[ImageFolderKey.self] = newValue }
    }
}

struct NotePreviewView: View {
    let preview: NotePreview

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let error = preview.error {
                NoticeView(text: "Couldn’t render this note’s components: \(error) Showing it as plain Markdown.", tone: .warning)
            }
            PreviewBlocksView(blocks: preview.blocks)
        }
    }
}

struct PreviewBlocksView: View {
    let blocks: [PreviewBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(blocks.indices, id: \.self) { PreviewBlockView(block: blocks[$0]) }
        }
    }
}

private struct PreviewBlockView: View {
    let block: PreviewBlock

    var body: some View {
        switch block {
        case .markdown(let blocks): MarkdownView(blocks: blocks)
        case .panel(let tone, let children): PanelView(tone: tone, children: children)
        case .toc(let entries): TocView(entries: entries)
        case .footnotes(let entries): FootnotesView(entries: entries)
        case .image(let source, let alt, _, let width, let isDiagram): PreviewImageView(source: source, alt: alt, width: width, isDiagram: isDiagram)
        case .chart(let spec, let title, let height): ChartView(spec: spec, title: title, height: height)
        case .repo(let ref, let description): RepoCard(ref: ref, description: description)
        case .youtube(let ref, let title): YouTubeCard(ref: ref, title: title)
        case .highlight(let color, let children):
            PreviewBlocksView(blocks: children)
                .padding(8)
                .background(MarkColor.color(named: color), in: RoundedRectangle(cornerRadius: 6))
        case .notice(let text): NoticeView(text: text, tone: .warning)
        }
    }
}

// MARK: Panels and notices

private struct PanelView: View {
    let tone: PanelTone
    let children: [PreviewBlock]

    private var color: Color { tone == .info ? .accentColor : .orange }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone == .info ? "info.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(color)
                .accessibilityLabel(tone == .info ? "Info" : "Warning")
            PreviewBlocksView(blocks: children)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .leading) { Rectangle().fill(color).frame(width: 3).clipShape(RoundedRectangle(cornerRadius: 2)) }
    }
}

private struct NoticeView: View {
    let text: String
    let tone: PanelTone

    var body: some View {
        Label(text, systemImage: "exclamationmark.circle")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Table of contents and footnotes

private struct TocView: View {
    let entries: [TocEntry]
    @Environment(\.scrollToHeading) private var scrollToHeading

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Contents").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            if entries.isEmpty { Text("No headings yet.").foregroundStyle(.secondary) }
            ForEach(entries.indices, id: \.self) { index in
                let entry = entries[index]
                Button(entry.text) { scrollToHeading(entry.ordinal) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                    .padding(.leading, CGFloat(entry.level) * 16)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct FootnotesView: View {
    let entries: [FootnoteEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()
            Text("Footnotes").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            if entries.isEmpty { Text("No footnotes yet.").foregroundStyle(.secondary) }
            ForEach(entries.indices, id: \.self) { index in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(entries[index].number).").monospacedDigit().foregroundStyle(.secondary)
                    MarkdownView(blocks: entries[index].blocks).font(.callout)
                }
            }
        }
    }
}

// MARK: Images and diagrams

struct PreviewImageView: View {
    let source: PreviewImageSource
    let alt: String
    let width: ImageWidth?
    let isDiagram: Bool
    @Environment(\.imageFolder) private var folder

    var body: some View {
        switch source {
        case .stored(let name):
            if let folder, let image = UIImage(contentsOfFile: folder.appendingPathComponent(name).path) {
                drawn(image)
            } else {
                NoticeView(text: "Image not found: \(name)", tone: .warning)
            }
        case .remote(let address):
            // Nothing is fetched from the network: the picture's words, and where it is.
            if let url = URL(string: address), ["http", "https"].contains(url.scheme?.lowercased()) {
                Link(destination: url) { Label(alt.isEmpty ? address : alt, systemImage: "photo") }
            } else {
                NoticeView(text: "Image not shown: \(address)", tone: .warning)
            }
        }
    }

    @ViewBuilder
    private func drawn(_ image: UIImage) -> some View {
        // A diagram is stored at twice the size it is drawn, unless the tag says how wide.
        let pixels = image.size.width * image.scale
        let picture = Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(alt.isEmpty ? "Image" : alt)
        switch width {
        case .some(let width) where width.unit == .percent:
            FractionalWidth(fraction: width.value / 100) { picture }
        case .some(let width):
            picture.frame(maxWidth: width.value)
        case .none:
            picture.frame(maxWidth: isDiagram ? pixels / 2 : pixels)
        }
    }
}

/// Gives its one child a share of the width it is offered: the column the note is in, not the window.
private struct FractionalWidth: Layout {
    var fraction: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        let width = proposal.width.map { $0 * fraction }
        return child.sizeThatFits(ProposedViewSize(width: width, height: proposal.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
}

// MARK: Chart

private struct ChartView: View {
    let spec: ChartSpec
    let title: String?
    let height: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title, !title.isEmpty { Text(title).font(.headline) }
            chart.frame(height: height)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(summary)
    }

    private var summary: String {
        "\(spec.type.rawValue.capitalized) chart\(title.map { " of \($0)" } ?? ""): \(spec.y.joined(separator: ", ")) by \(spec.x), \(spec.rows.count) rows"
    }

    @ViewBuilder
    private var chart: some View {
        switch spec.type {
        case .pie:
            // A pie draws only the first series, with `x` naming its slices.
            let series = spec.y[0]
            Chart(spec.rows.indices, id: \.self) { index in
                if let value = spec.rows[index].values[series] {
                    SectorMark(angle: .value(series, value), innerRadius: .ratio(0.0), angularInset: 1)
                        .foregroundStyle(by: .value(spec.x, spec.rows[index].label))
                }
            }
        default:
            Chart {
                ForEach(spec.y, id: \.self) { series in
                    ForEach(spec.rows.indices, id: \.self) { index in
                        if let value = spec.rows[index].values[series] { mark(label: spec.rows[index].label, value: value, series: series) }
                    }
                }
            }
        }
    }

    @ChartContentBuilder
    private func mark(label: String, value: Double, series: String) -> some ChartContent {
        switch spec.type {
        case .line:
            LineMark(x: .value(spec.x, label), y: .value(series, value)).foregroundStyle(by: .value("Series", series)).symbol(by: .value("Series", series))
        case .area:
            AreaMark(x: .value(spec.x, label), y: .value(series, value)).foregroundStyle(by: .value("Series", series)).opacity(0.6)
        default:
            BarMark(x: .value(spec.x, label), y: .value(series, value)).foregroundStyle(by: .value("Series", series)).position(by: .value("Series", series))
        }
    }
}

// MARK: Cards

private struct RepoCard: View {
    let ref: RepoRef
    let description: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let url = URL(string: ref.href) {
            Button { openURL(url) } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "shippingbox").font(.title2).foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ref.label).font(.headline).foregroundStyle(.primary)
                        Text(ref.service ?? ref.host).font(.caption).foregroundStyle(.secondary)
                        if let description { Text(description).font(.subheadline).foregroundStyle(.secondary).padding(.top, 2) }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right").foregroundStyle(.secondary)
                }
                .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Repository \(ref.label)")
        }
    }
}

private struct YouTubeCard: View {
    let ref: YouTubeRef
    let title: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let url = URL(string: ref.watchURL) {
            Button { openURL(url) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "play.rectangle.fill").font(.title).foregroundStyle(.red)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.headline).foregroundStyle(.primary)
                        Text("youtube.com\(ref.start > 0 ? " · from \(Self.clock(ref.start))" : "")").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right").foregroundStyle(.secondary)
                }
                .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Video: \(title)")
        }
    }

    private static func clock(_ seconds: Int) -> String {
        seconds >= 3600
            ? String(format: "%d:%02d:%02d", seconds / 3600, seconds % 3600 / 60, seconds % 60)
            : String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
