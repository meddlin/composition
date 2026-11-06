import CompositionCore
import SwiftUI

/// Spike S3's lab (see EditorLab.swift): the text view on TextKit 2 with the experiments around it, and numbers.
struct EditorLabView: View {
    enum Scenario: String, CaseIterable, Identifiable {
        case sample = "Sample note"
        case selected = "Selected note (not saved)"
        case big = "5,000 lines"
        case bigViews = "5,000 lines with views"
        var id: String { rawValue }
    }

    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var lab = EditorLab()
    @State private var scenario = Scenario.sample

    var body: some View {
        NavigationStack {
            EditorTextView(lab: lab)
                .ignoresSafeArea(.keyboard, edges: [])
                .safeAreaInset(edge: .bottom) { hud }
                .navigationTitle("Editor lab (S3)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
        }
        .task { await load(.sample) }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
        ToolbarItemGroup(placement: .primaryAction) {
            Menu {
                Picker("Text", selection: $scenario) { ForEach(Scenario.allCases) { Text($0.rawValue).tag($0) } }
            } label: { Label("Text", systemImage: "doc.text") }
            .onChange(of: scenario) { Task { await load(scenario) } }

            Menu {
                Picker("Syntax", selection: Binding(get: { lab.hideMode }, set: { lab.hideMode = $0 })) {
                    ForEach(HideMode.allCases) { Text($0.rawValue).tag($0) }
                }
            } label: { Label("Hide syntax", systemImage: "eye.slash") }

            Menu {
                Button("Picture", systemImage: "photo") { lab.insertAttachment(.picture) }
                Button("Ink canvas", systemImage: "pencil.tip") { lab.insertAttachment(.ink) }
                Button("SwiftUI panel", systemImage: "rectangle.on.rectangle") { lab.insertAttachment(.panel) }
            } label: { Label("Insert a view", systemImage: "plus.rectangle.on.rectangle") }

            Button { lab.presentFind() } label: { Label("Find", systemImage: "magnifyingglass") }
            Button { lab.measureFullLayout() } label: { Label("Lay out everything", systemImage: "ruler") }
        }
    }

    private var hud: some View {
        let s = lab.stats
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(s.textKit2 ? "TextKit 2" : "TextKit 1 (fell back!)") · \(s.lines) lines · \(s.characters) characters · \(s.attachments) views · \(s.spans) spans")
            Text(String(format: "colour: parse %.1f ms + apply %.1f ms · last edit %.1f ms · worst %.1f ms", s.parseMilliseconds, s.applyMilliseconds, s.lastEditMilliseconds, s.worstEditMilliseconds)
                + (s.fullLayoutMilliseconds.map { String(format: " · whole layout %.0f ms", $0) } ?? ""))
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }

    private func load(_ scenario: Scenario) async {
        switch scenario {
        case .sample: lab.load(LabText.sample)
        case .big: lab.load(LabText.big(lines: 5_000))
        case .bigViews:
            lab.load(LabText.big(lines: 5_000))
            lab.addAttachments(everyLines: 250)
        case .selected:
            if let id = model.selection, let note = await model.detail(of: id) { lab.load(note.content) } else { lab.load("Select a note in the list first, then open this again.") }
        }
    }
}
