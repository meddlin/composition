import CompositionCore
import SwiftUI

/// Which half of a narrow pane is showing. (Outside `PdfWithNote`: an enum nested in a generic view made the compiler crash.)
private enum PdfPane: Hashable { case pdf, note }

/// A note that owns a PDF, with the PDF beside it: side by side, with a divider that can be dragged, where the pane is wide enough for two readable
/// halves (an iPad in landscape, with the lists hidden), and one at a time with a switch where it is not (portrait, or Split View). The PDF stays
/// open while the note is shown, so that switching back finds it where it was.
struct PdfWithNote<NoteContent: View>: View {
    /// Wide enough for the PDF and the note side by side: two halves of at least 450 points. A portrait iPad's pane is narrower than this, and a
    /// landscape one with the lists hidden is wider.
    private static var sideBySideWidth: CGFloat { 900 }

    @State private var reader: PdfReader
    @State private var pane = PdfPane.pdf
    private let note: NoteContent
    @Environment(\.look) private var look

    private let insertion: PdfInsertion

    init(model: AppModel, source: PdfSource, insertion: PdfInsertion = PdfInsertion(), @ViewBuilder note: () -> NoteContent) {
        _reader = State(initialValue: PdfReader(source: source, app: model))
        self.insertion = insertion
        self.note = note()
    }

    var body: some View {
        // Quote and Cite this page write into the note shown beside the PDF, which is a different note when the person chooses one in the Notes tab.
        let _ = { reader.insertion = insertion }()
        GeometryReader { geometry in
            layout(wide: geometry.size.width >= Self.sideBySideWidth)
        }
    }

    @ViewBuilder private func layout(wide: Bool) -> some View {
        if wide { sideBySide } else { switched }
    }

    private var sideBySide: some View {
        SplitLayout(labels: .pdfAndNote) {
            PdfReaderPane(reader: reader)
        } trailing: {
            note
        }
    }

    private var switched: some View {
        VStack(spacing: 0) {
            Picker("Show", selection: $pane) {
                Text("PDF").tag(PdfPane.pdf)
                Text("Note").tag(PdfPane.note)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .accessibilityIdentifier("pdf-pane-picker")
            ZStack {
                PdfReaderPane(reader: reader)
                    .opacity(pane == .pdf ? 1 : 0)
                    .allowsHitTesting(pane == .pdf)
                    .accessibilityHidden(pane != .pdf)
                if pane == .note { note }
            }
        }
    }
}
