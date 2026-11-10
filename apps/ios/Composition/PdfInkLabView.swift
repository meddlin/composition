import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Spike B's lab as a screen (see `PdfInkLab`): the PDF with a canvas on each page near the screen, a readout above it, and the controls in the toolbar.
/// Reached from the notebooks column's More menu (*PDF ink lab (spike B)*), or with `-openPdfInkLab 1`.
struct PdfInkLabView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var lab = PdfInkLab()
    @State private var showingChecklist = false
    @State private var showingReport = false
    @State private var importing = false
    @State private var asking = false
    @State private var pageText = ""

    var body: some View {
        @Bindable var lab = lab
        NavigationStack {
            PdfInkLabHost(lab: lab)
                .ignoresSafeArea(edges: .bottom)
                .accessibilityIdentifier("pdfink-pdf")
                .safeAreaInset(edge: .top, spacing: 0) { readout }
                .overlay(alignment: .bottom) { working }
                .navigationTitle("PDF ink lab (spike B)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { lab.close(); dismiss() }.accessibilityIdentifier("pdfink-done") }
                    ToolbarItemGroup(placement: .primaryAction) {
                        bookMenu
                        penMenu
                        canvasMenu
                        runMenu
                        handMenu
                        Button { showingChecklist = true } label: { Label("Cases to try", systemImage: "checklist") }.accessibilityIdentifier("pdfink-checklist")
                        Button { showingReport = true } label: { Label("Report", systemImage: "doc.plaintext") }.accessibilityIdentifier("pdfink-report")
                    }
                }
        }
        .task { await lab.start() }
        .onChange(of: lab.settingsKey) { lab.settingsChanged() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            if case .success(let url) = result { Task { await lab.open(fileAt: url) } }
        }
        .alert("Go to page", isPresented: $asking) {
            TextField("Page number", text: $pageText).keyboardType(.numberPad)
            Button("Cancel", role: .cancel) {}
            Button("Go") { if let number = Int(pageText) { lab.jump(to: number - 1) } }
        }
        .sheet(isPresented: $showingChecklist) { ChecklistSheet(lab: lab) }
        .sheet(isPresented: $showingReport) { ReportSheet(lab: lab) }
        .interactiveDismissDisabled()
    }

    // MARK: Readout

    private var readout: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(lab.pageCount > 0 ? "\(lab.bookName), \(lab.pageCount) pages" : lab.bookName).font(.caption.weight(.semibold))
            Text(lab.hud).accessibilityIdentifier("pdfink-hud")
            if !lab.status.isEmpty { Text(lab.status).foregroundStyle(.orange) }
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }

    @ViewBuilder private var working: some View {
        if let busy = lab.busy {
            HStack(spacing: 12) {
                if let progress = lab.progress { ProgressView(value: min(max(progress, 0), 1)).frame(width: 120) } else { ProgressView() }
                Text(busy).font(.footnote)
                Button("Stop") { lab.stop() }.buttonStyle(.bordered).accessibilityIdentifier("pdfink-stop")
            }
            .padding(12)
            .background(.regularMaterial, in: Capsule())
            .padding(.bottom, 24)
        } else if lab.recording {
            HStack(spacing: 12) {
                Image(systemName: "record.circle").foregroundStyle(.red)
                Text("Recording what you do by hand").font(.footnote)
                Button("Stop recording") { lab.toggleRecording() }.buttonStyle(.borderedProminent).accessibilityIdentifier("pdfink-stop-recording")
            }
            .padding(12)
            .background(.regularMaterial, in: Capsule())
            .padding(.bottom, 24)
        }
    }

    // MARK: Menus

    private var bookMenu: some View {
        Menu {
            Button("Make a 500-page book") { Task { await lab.openGenerated(pages: 500) } }
            Button("Make a 30-page book") { Task { await lab.openGenerated(pages: 30) } }
            Button("Make a 30-page book with turned and cropped pages") { Task { await lab.openGenerated(pages: 30, turned: true) } }
            Button("Open a PDF from Files…", systemImage: "folder") { importing = true }
            Divider()
            Button("Go to page…", systemImage: "arrow.right.to.line") { pageText = ""; asking = true }
        } label: { Label("Book", systemImage: "book") }
        .accessibilityIdentifier("pdfink-book-menu")
    }

    private var penMenu: some View {
        @Bindable var lab = lab
        return Menu {
            Picker("Tool", selection: $lab.tool) { ForEach(PdfInkLab.Tool.allCases) { Text($0.rawValue).tag($0) } }
            Toggle("A finger draws; two fingers scroll (the Simulator has no Pencil)", isOn: $lab.fingerDraws)
            Button("Clear all ink", systemImage: "trash", role: .destructive) { lab.clearInk() }
        } label: { Label("Pen", systemImage: "pencil.tip") }
        .accessibilityIdentifier("pdfink-pen-menu")
    }

    private var canvasMenu: some View {
        @Bindable var lab = lab
        return Menu {
            Toggle("Canvases on the pages", isOn: $lab.canvasesOn)
            Toggle("Let touches through PDFKit's page view", isOn: $lab.touchesThrough)
            Picker("When a page leaves the screen", selection: $lab.retention) { ForEach(Retention.allCases) { Text($0.rawValue).tag($0) } }
            Picker("Ink of pages off the screen", selection: $lab.holding) { ForEach(InkHolding.allCases) { Text($0.rawValue).tag($0) } }
            Toggle("Build the stroke format when a page leaves", isOn: $lab.buildsStrokeFormat)
            Toggle("Empty a canvas when its page leaves", isOn: $lab.emptiesOnLeave)
            Toggle("System tool picker", isOn: $lab.systemPicker)
        } label: { Label("Canvases", systemImage: "square.stack.3d.up") }
        .accessibilityIdentifier("pdfink-canvas-menu")
    }

    private var runMenu: some View {
        @Bindable var lab = lab
        return Menu {
            Section("Settings for the runs") {
                Picker("Scroll speed", selection: $lab.speed) {
                    Text("4 pages a second (reading)").tag(4.0)
                    Text("12 pages a second (looking for a page)").tag(12.0)
                    Text("30 pages a second (a hard flick)").tag(30.0)
                }
                Picker("Ink for the draw runs", selection: $lab.density) { ForEach(LabInk.Density.allCases) { Text($0.rawValue).tag($0) } }
            }
            Section("Runs that go by themselves") {
                Button("Scroll through every page") { lab.start("Scrolling through every page") { await lab.scrollThroughEveryPage() } }
                Button("Draw on 5 pages") { lab.start("Drawing on 5 pages") { await lab.drawOnPages(5) } }
                Button("Draw on 50 pages") { lab.start("Drawing on 50 pages") { await lab.drawOnPages(50) } }
                Button("Draw on 200 pages") { lab.start("Drawing on 200 pages") { await lab.drawOnPages(200) } }
            }
        } label: { Label("Runs", systemImage: "gauge.with.dots.needle.67percent") }
        .accessibilityIdentifier("pdfink-run-menu")
    }

    /// What is done with the Pencil and the fingers on the glass: a recording of the touches, the frames and the memory, and the readings that go beside it.
    private var handMenu: some View {
        Menu {
            Button("Start recording", systemImage: "record.circle") { lab.toggleRecording() }.disabled(lab.recording)
            Button("Add a memory line to the report", systemImage: "memorychip") { lab.markMemory() }
            Button("Where does a touch go?", systemImage: "hand.point.up.left") { lab.whereTouchesGo() }
        } label: { Label("By hand", systemImage: "hand.draw") }
        .accessibilityIdentifier("pdfink-hand-menu")
    }
}

// MARK: The PDF

/// The `PDFView`, handed to the lab to drive.
struct PdfInkLabHost: UIViewRepresentable {
    let lab: PdfInkLab

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        lab.attach(view)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}

// MARK: Sheets

private struct ChecklistSheet: View {
    let lab: PdfInkLab
    @Environment(\.dismiss) private var dismiss
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Try each on the book, with the Pencil drawing and your fingers scrolling and selecting. Mark what you found; the marks go into the report. The ones that need a number rather than a look are in the Runs menu.")
                        .font(.footnote)
                }
                ForEach(LabCase.all) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title).font(.body.weight(.medium))
                        Text(item.lookFor).font(.footnote).foregroundStyle(.secondary)
                        Picker(item.title, selection: Binding(get: { lab.cases[item.id] ?? .untried }, set: { lab.cases[item.id] = $0 })) {
                            ForEach(LabCaseState.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                    .padding(.vertical, 4)
                }
                Section("What else you saw") {
                    TextField("Notes for the report", text: Binding(get: { lab.notes }, set: { lab.notes = $0 }), axis: .vertical).lineLimit(3...8)
                }
            }
            .navigationTitle("Cases to try")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

private struct ReportSheet: View {
    let lab: PdfInkLab
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let text = lab.report()
        NavigationStack {
            ScrollView {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .accessibilityIdentifier("pdfink-report-text")
            }
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { UIPasteboard.general.string = text } label: { Label("Copy", systemImage: "doc.on.doc") }.accessibilityIdentifier("pdfink-copy")
                    ShareLink(item: text)
                }
            }
        }
    }
}
