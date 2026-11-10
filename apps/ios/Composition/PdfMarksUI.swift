import CompositionCore
import CompositionPDF
import PDFKit
import SwiftUI

// The reader's marking screens (pdf-markup-plan.md, "The iPad"; docs/ui/pdf.md for the desktop's): the bar of colours and tools over a selection, a
// mark's card, the box a typed note is written in, the Highlights and Notes tabs, and the Export sheet.

extension PdfMarkPaint {
    var swiftUIFill: Color { Color(.sRGB, red: Double(fill.red) / 255, green: Double(fill.green) / 255, blue: Double(fill.blue) / 255, opacity: 1) }
    var swiftUILine: Color { Color(.sRGB, red: Double(line.red) / 255, green: Double(line.green) / 255, blue: Double(line.blue) / 255, opacity: 1) }
}

private let colorNames = ["yellow": "Yellow", "green": "Green", "blue": "Blue", "pink": "Pink", "orange": "Orange"]

/// The five colours a mark can be, as small discs; the one in use has a ring.
struct MarkColorDots: View {
    let current: String
    let choose: (String) -> Void
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 10) {
            ForEach(PdfMarkup.markColors, id: \.self) { name in
                let paint = PdfMarkPaint.paint(for: name)
                Button {
                    choose(name)
                } label: {
                    Circle()
                        .fill(paint.swiftUIFill)
                        .frame(width: 26, height: 26)
                        .overlay(Circle().stroke(paint.swiftUILine, lineWidth: 1.5))
                        .padding(9)
                        .overlay { if current == name { Circle().stroke(look.foreground, lineWidth: 2).padding(4) } }
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(colorNames[name] ?? name)
                .accessibilityAddTraits(current == name ? .isSelected : [])
                .accessibilityIdentifier("pdf-color-\(name)")
            }
        }
    }
}

/// Over the pages while words are selected: the colour, then highlight, underline or strikethrough.
struct PdfSelectionBar: View {
    let reader: PdfReader
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 4) {
            MarkColorDots(current: reader.color) { reader.color = $0 }
            Divider().frame(height: 28)
            tool("Highlight", "highlighter", .highlight, id: "pdf-highlight")
            tool("Underline", "underline", .underline, id: "pdf-underline")
            tool("Strikethrough", "strikethrough", .strikethrough, id: "pdf-strikethrough")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 2)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().stroke(look.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
        .tint(look.brand)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pdf-selection-bar")
    }

    private func tool(_ title: String, _ symbol: String, _ kind: PdfMarkKind, id: String) -> some View {
        Button { Task { await reader.markSelection(kind) } } label: {
            Label(title, systemImage: symbol).labelStyle(.iconOnly).font(.title3).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}

/// A mark's card: recolour it, comment on it, quote it into the note, retype it (a typed note) or delete it.
struct MarkCardView: View {
    let reader: PdfReader
    let mark: PdfMark
    @State private var comment: String
    @FocusState private var commenting: Bool
    @Environment(\.look) private var look

    init(reader: PdfReader, mark: PdfMark) {
        self.reader = reader
        self.mark = mark
        _comment = State(initialValue: mark.comment)
    }

    private var kindName: String {
        switch mark.kind {
        case .highlight: "Highlight"
        case .underline: "Underline"
        case .strikethrough: "Strikethrough"
        case .text: "Typed note"
        case .ink: "Ink"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(kindName), page \(mark.page + 1)").font(.headline)
                Spacer()
                Button("Delete", systemImage: "trash", role: .destructive) { Task { await reader.delete(mark) } }
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("pdf-mark-delete")
                Button("Close", systemImage: "xmark.circle.fill") { reader.card = nil }
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
                    .foregroundStyle(look.mutedText)
                    .accessibilityIdentifier("pdf-mark-close")
            }
            MarkColorDots(current: mark.color) { name in Task { await reader.recolour(mark, to: name) } }
            if mark.kind == .text, let note = mark.textNote {
                Text(note.text).font(.callout).foregroundStyle(look.mutedText).lineLimit(3)
                Button("Edit the note", systemImage: "pencil") { reader.edit(mark) }.accessibilityIdentifier("pdf-mark-edit")
            } else {
                if !mark.quote.isEmpty { Text(mark.quote).font(.callout).foregroundStyle(look.mutedText).lineLimit(3) }
                TextField("Add a comment", text: $comment)
                    .textFieldStyle(.roundedBorder)
                    .focused($commenting)
                    .submitLabel(.done)
                    .onSubmit { Task { await reader.setComment(mark, to: comment) } }
                    .onChange(of: commenting) { _, now in if !now { Task { await reader.setComment(mark, to: comment) } } }
                    .accessibilityIdentifier("pdf-mark-comment")
                Button("Quote in the note", systemImage: "text.quote") { reader.quote(mark) }.accessibilityIdentifier("pdf-mark-quote")
            }
        }
        .padding(14)
        .frame(maxWidth: 380)
        .tint(look.brand)
    }
}

/// The box a typed note is written in, over the page where it goes.
struct NoteDraftView: View {
    let reader: PdfReader
    @State private var draft: NoteDraft
    @FocusState private var focused: Bool

    init(reader: PdfReader, draft: NoteDraft) {
        self.reader = reader
        _draft = State(initialValue: draft)
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            TextEditor(text: $draft.text)
                .focused($focused)
                .frame(width: 300, height: 110)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.secondary.opacity(0.4)))
                .accessibilityLabel("Typed note")
                .accessibilityIdentifier("pdf-note-text")
            HStack {
                Button("Cancel", role: .cancel) { reader.draft = nil }.accessibilityIdentifier("pdf-note-cancel")
                Spacer()
                Button("Save") { Task { await reader.commit(draft) } }.buttonStyle(.borderedProminent).accessibilityIdentifier("pdf-note-save")
            }
        }
        .padding(14)
        .onAppear { focused = true }
    }
}

// MARK: - The Highlights tab

/// Every mark of the PDF by page, with its words and its comment; tapping one goes to it, and a quote button puts it into the note.
struct PdfHighlightsList: View {
    let reader: PdfReader
    var close: () -> Void
    @State private var filter = ""
    @Environment(\.look) private var look

    private var shown: [PdfMark] {
        let words = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !words.isEmpty else { return reader.marks }
        return reader.marks.filter { ($0.textNote?.text ?? $0.quote).lowercased().contains(words) || $0.comment.lowercased().contains(words) }
    }

    var body: some View {
        if reader.marks.isEmpty && reader.inkPages.isEmpty {
            ContentUnavailableView("No highlights", systemImage: "highlighter", description: Text("Press and hold a word in the PDF, drag to take more, then choose a colour and Highlight, Underline or Strikethrough. A typed note goes anywhere with the note button, and the pencil button draws on the pages."))
        } else {
            let quoted = reader.quotedMarks
            List {
                ForEach(shown, id: \.id) { mark in
                    row(mark, quoted: quoted.contains(mark.uuid))
                }
                if !reader.inkPages.isEmpty && filter.trimmingCharacters(in: .whitespaces).isEmpty {
                    Section("Ink") {
                        ForEach(reader.inkPages.sorted(), id: \.self) { page in inkRow(page) }
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $filter, placement: .navigationBarDrawer(displayMode: .always), prompt: "Filter highlights")
            .accessibilityIdentifier("pdf-highlights")
        }
    }

    private func row(_ mark: PdfMark, quoted: Bool) -> some View {
        let paint = PdfMarkPaint.paint(for: mark.color)
        return Button {
            reader.show(page: mark.page, mark: mark.uuid)
            close()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 3).fill(mark.kind == .highlight || mark.kind == .text ? paint.swiftUIFill : paint.swiftUILine).frame(width: 5).padding(.vertical, 2)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("Page \(mark.page + 1)").font(.caption.weight(.semibold)).foregroundStyle(look.mutedText)
                        Image(systemName: icon(mark.kind)).font(.caption).foregroundStyle(look.mutedText).accessibilityHidden(true)
                        if quoted { Image(systemName: "text.quote").font(.caption).foregroundStyle(look.brand).accessibilityLabel("Quoted in a note") }
                    }
                    Text(mark.textNote?.text ?? (mark.quote.isEmpty ? "(no words)" : mark.quote)).multilineTextAlignment(.leading).lineLimit(4)
                    if !mark.comment.isEmpty { Text(mark.comment).font(.callout).italic().foregroundStyle(look.mutedText).multilineTextAlignment(.leading) }
                }
                Spacer(minLength: 4)
                if mark.kind.marksText {
                    Button("Quote in the note", systemImage: "text.quote") { reader.quote(mark) }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("pdf-highlight-quote-\(mark.id)")
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) { Button("Delete", systemImage: "trash", role: .destructive) { Task { await reader.delete(mark) } } }
        .accessibilityIdentifier("pdf-highlight-\(mark.id)")
    }

    private func inkRow(_ page: Int) -> some View {
        Button {
            reader.go(toPage: page)
            close()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "pencil.tip").foregroundStyle(look.mutedText).accessibilityHidden(true)
                Text("Page \(page + 1)").font(.body)
                Text("handwriting").foregroundStyle(look.mutedText)
                Spacer(minLength: 4)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) { Button("Clear ink", systemImage: "trash", role: .destructive) { reader.clearInk(page: page) } }
        .accessibilityIdentifier("pdf-ink-page-\(page)")
    }

    private func icon(_ kind: PdfMarkKind) -> String {
        switch kind {
        case .highlight: "highlighter"
        case .underline: "underline"
        case .strikethrough: "strikethrough"
        case .text: "text.bubble"
        case .ink: "pencil.tip"
        }
    }
}

// MARK: - The Notes tab

/// The notes that belong with the PDF: its own first, then every note whose text links to it. Choosing one shows it beside the PDF.
struct PdfNotesList: View {
    let reader: PdfReader
    var close: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        List {
            ForEach(reader.citations, id: \.noteId) { citation in
                Button {
                    reader.app.openNote(citation.noteId, besidePdf: reader.documentId)
                    close()
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(citation.title.isEmpty ? "Untitled" : citation.title)
                            if citation.owner { Text("This PDF's own note").font(.caption).foregroundStyle(look.mutedText) }
                        }
                        Spacer(minLength: 8)
                        if !citation.pages.isEmpty {
                            Text(citation.pages.count == 1 ? "1 page" : "\(citation.pages.count) pages").font(.callout).foregroundStyle(look.mutedText)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pdf-note-\(citation.noteId)")
            }
            Section {
                Button {
                    let document = reader.document, title = reader.citedTitle
                    close()
                    Task { await reader.app.newNote(forPdf: document, title: title) }
                } label: {
                    Label("New note for this PDF", systemImage: "square.and.pencil")
                }
                .accessibilityIdentifier("pdf-new-note")
            }
        }
        .listStyle(.plain)
        .accessibilityIdentifier("pdf-notes")
    }
}

// MARK: - Drawing

/// What shows while the Pencil draws: where the ink goes, a switch for a finger that draws too, and Done.
struct PdfInkBanner: View {
    let reader: PdfReader
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "pencil.tip").accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(reader.fingerDraws ? "Drawing with a finger or the Pencil" : "Drawing with the Pencil").font(.subheadline.weight(.semibold))
                Text(reader.inkPages.isEmpty ? "No ink yet" : "Ink on \(reader.inkPages.count) \(reader.inkPages.count == 1 ? "page" : "pages")")
                    .font(.caption).foregroundStyle(look.mutedText)
                    .accessibilityIdentifier("pdf-ink-count")
            }
            Toggle("Finger draws", isOn: Binding(get: { reader.fingerDraws }, set: { reader.setFingerDraws($0) }))
                .toggleStyle(.switch)
                .fixedSize()
                .accessibilityIdentifier("pdf-ink-finger")
            Button("Done") { reader.setInking(false) }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("pdf-ink-done")
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().stroke(look.border, lineWidth: 1))
        .padding(.top, 10)
        // The words and the buttons in it stay separate for VoiceOver and for the tests (a container would otherwise be one element).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pdf-ink-banner")
    }
}
