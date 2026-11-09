import CompositionCore
import CompositionPDF
import SwiftUI

// Export annotated PDF on the iPad (pdf-markup-plan.md, "Export annotated PDF"): a copy of the PDF with the marks in it, for other apps, through the
// share sheet or Files. Native annotations by default, or flattened. PDFKit writes it (`CompositionPDF.AnnotatedExport`), off the main thread; the PDF
// in the library is never written to.

/// What came of an export, for the sheet to say.
private struct ExportedPdf {
    let file: URL
    let outcome: AnnotatedExport.Outcome
    let bytes: Int64
}

struct PdfExportSheet: View {
    let reader: PdfReader
    @State private var flatten = false
    @State private var working = false
    @State private var made: ExportedPdf?
    @State private var failure: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look

    private var inkCount: Int { reader.marks.filter { $0.kind == .ink }.count }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Flatten markup", isOn: $flatten)
                        .accessibilityIdentifier("pdf-export-flatten")
                        .disabled(working)
                } footer: {
                    Text(flatten
                        ? "Your marks are drawn into the pages: every app shows them the same, and they can no longer be edited or taken off."
                        : "Your marks are standard annotations (highlights, underlines, strikethroughs and notes) that other apps draw and can still edit.")
                }
                Section {
                    LabeledContent("Marks to write", value: "\(reader.marks.count - inkCount)")
                    if inkCount > 0 { LabeledContent("Ink left out", value: "\(inkCount)") }
                    if reader.password != nil { Text("This PDF is protected. The copy asks for the same password.").font(.callout) }
                } footer: {
                    Text("The PDF in your library is not changed. Ink is not exported yet.")
                }
                Section {
                    if let made {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("Written: \(made.outcome.written) marks, \(DocumentNames.formatBytes(made.bytes))", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(look.success)
                                .accessibilityIdentifier("pdf-export-done")
                            if made.outcome.skippedInk > 0 { Text("\(made.outcome.skippedInk) ink marks were left out.").font(.callout) }
                            if made.outcome.skippedOffPage > 0 { Text("\(made.outcome.skippedOffPage) marks on pages this PDF does not have were left out.").font(.callout) }
                        }
                        ShareLink(item: made.file) { Label("Save or share…", systemImage: "square.and.arrow.up") }
                            .accessibilityIdentifier("pdf-export-share")
                    } else {
                        Button {
                            Task { await run() }
                        } label: {
                            if working { HStack { ProgressView(); Text("Exporting…") } } else { Label("Export…", systemImage: "square.and.arrow.up") }
                        }
                        .disabled(working)
                        .accessibilityIdentifier("pdf-export-go")
                    }
                    if let failure { Text(failure).foregroundStyle(look.error).font(.callout) }
                }
            }
            .navigationTitle("Export annotated PDF")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onChange(of: flatten) { made = nil }
        }
        .presentationDetents([.medium, .large])
    }

    private func run() async {
        guard let source = reader.source.url else { return }
        working = true
        failure = nil
        defer { working = false }
        let marks = reader.marks, password = reader.password, flatten = flatten
        let name = Self.copyName(for: reader.document.fileName)
        do {
            made = try await AppModel.perform {
                let folder = FileManager.default.temporaryDirectory.appending(path: "Exports", directoryHint: .isDirectory).appending(path: UUID().uuidString, directoryHint: .isDirectory)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let target = folder.appending(path: name)
                let outcome = try AnnotatedExport.export(source: source, password: password, marks: marks, flatten: flatten, to: target)
                let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int64) ?? 0
                return ExportedPdf(file: target, outcome: outcome, bytes: size)
            }
        } catch {
            failure = error.localizedDescription
        }
    }

    /// `Designing Data.pdf` becomes `Designing Data (annotated).pdf`.
    static func copyName(for fileName: String) -> String {
        let base = (fileName as NSString).deletingPathExtension
        return "\(base.isEmpty ? "PDF" : base) (annotated).pdf"
    }
}
