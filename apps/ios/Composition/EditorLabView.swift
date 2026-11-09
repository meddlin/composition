import CompositionCore
import SwiftUI

/// Spike S3's lab (see EditorLab.swift): the text view on TextKit 2 with the experiments around it, and numbers.
struct EditorLabView: View {
    enum Scenario: String, CaseIterable, Identifiable {
        case sample = "Sample note"
        case selected = "Selected note (not saved)"
        case editing = "Editing spike (L5)"
        case big = "5,000 lines"
        case bigViews = "5,000 lines with views"
        var id: String { rawValue }
    }

    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var lab = EditorLab()
    @State private var scenario = Scenario.sample
    @State private var benchmark: String?

    var body: some View {
        NavigationStack {
            EditorTextView(lab: lab)
                .ignoresSafeArea(.keyboard, edges: [])
                .safeAreaInset(edge: .top) { tips }
                .safeAreaInset(edge: .bottom) { hud }
                .navigationTitle("Editor lab (S3)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
        }
        .task {
            // Developer shortcut: `-labBenchmark 1` opens the 5,000-line note with views, types into it, and writes lab-benchmark.json.
            if UserDefaults.standard.integer(forKey: "labSettle") > 0 {
                // Developer shortcut: `-labSettle 20000` checks that the background colouring settles on a note of that many lines (see `runSettleCheck`).
                try? await Task.sleep(for: .seconds(1))
                benchmark = await lab.runSettleCheck(lines: UserDefaults.standard.integer(forKey: "labSettle"))
            } else if UserDefaults.standard.integer(forKey: "labLiveBenchmark") > 0 {
                // Developer shortcut: `-labLiveBenchmark 5000` runs the Live look's speed test (spike L7) on a note of that many lines.
                try? await Task.sleep(for: .seconds(2))
                benchmark = await lab.runLiveBenchmark(lines: UserDefaults.standard.integer(forKey: "labLiveBenchmark"))
            } else if UserDefaults.standard.bool(forKey: "labBenchmark") {
                await load(.bigViews)
                try? await Task.sleep(for: .seconds(2))
                benchmark = await lab.runTypingBenchmark()
            } else {
                await load(.sample)
                // Developer shortcut: `-labHide live` (or `attributes`) chooses a way of hiding at launch.
                switch UserDefaults.standard.string(forKey: "labReveal") {
                case "construct": lab.revealMode = .construct
                case "never": lab.revealMode = .never
                default: break
                }
                if UserDefaults.standard.string(forKey: "labText") == "editing" { await load(.editing) }
                switch UserDefaults.standard.string(forKey: "labAX") {
                case "withoutMarks": lab.axMode = .withoutMarks
                case "silentMarks": lab.axMode = .silentMarks
                default: break
                }
                switch UserDefaults.standard.string(forKey: "labHide") {
                case "live": lab.hideMode = .live
                case "attributes": lab.hideMode = .attributes
                default: break
                }
                // Developer shortcut: `-labAXProbe <file>` writes what the text view tells the accessibility tree to that file, once the look is on.
                if let file = UserDefaults.standard.string(forKey: "labAXProbe") {
                    try? await Task.sleep(for: .seconds(2))
                    let data = (try? JSONSerialization.data(withJSONObject: lab.textView.accessibilityProbe(), options: [.prettyPrinted, .sortedKeys])) ?? Data()
                    try? data.write(to: URL(fileURLWithPath: file))
                }
            }
        }
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
                Picker("Reveal", selection: Binding(get: { lab.revealMode }, set: { lab.revealMode = $0 })) {
                    ForEach(RevealMode.allCases) { Text($0.rawValue).tag($0) }
                }
                Picker("VoiceOver", selection: Binding(get: { lab.axMode }, set: { lab.axMode = $0 })) {
                    ForEach(LabAXMode.allCases) { Text($0.rawValue).tag($0) }
                }
            } label: { Label("Hide syntax", systemImage: "eye.slash") }

            Menu {
                Button("Picture", systemImage: "photo") { lab.insertAttachment(.picture) }
                Button("Ink canvas", systemImage: "pencil.tip") { lab.insertAttachment(.ink) }
                Button("SwiftUI panel", systemImage: "rectangle.on.rectangle") { lab.insertAttachment(.panel) }
            } label: { Label("Insert a view", systemImage: "plus.rectangle.on.rectangle") }

            Button { Task { benchmark = await lab.runTypingBenchmark() } } label: { Label("Typing speed test", systemImage: "speedometer") }
            Button { lab.presentFind() } label: { Label("Find", systemImage: "magnifyingglass") }
            Button { lab.measureFullLayout() } label: { Label("Lay out everything", systemImage: "ruler") }
        }
    }

    /// What to try, since the buttons above are icons: the Pencil, the canvas, and where the numbers are.
    private var tips: some View {
        Text("Write with the Apple Pencil in the text (Scribble: turn it on in Settings, Apple Pencil). To draw, tap the + button above (Insert a view), choose Ink canvas, and draw in the grey box. Hide syntax ▸ Live look is the Live view's drawing spike (step L1). The numbers below are for the manual test.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.bar)
    }

    private var hud: some View {
        let s = lab.stats
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(s.textKit2 ? "TextKit 2" : "TextKit 1 (fell back!)") · \(s.lines) lines · \(s.characters) characters · \(s.attachments) views · \(s.spans) blocks")
            Text(String(format: "colour per edit: last %.2f ms · worst %.2f ms · re-read %d characters · %d quick, %d not", s.lastEditMilliseconds, s.worstEditMilliseconds, s.rereadCharacters, s.incrementalEdits, s.fallbackEdits))
            Text(String(format: "full read: %.0f ms off the main thread · put on in steps: worst %.1f ms, all %.0f ms · corrections %d (%d characters last)", s.fullReadMilliseconds, s.worstSliceMilliseconds, s.sliceTotalMilliseconds, s.corrections, s.lastCorrectionCharacters)
                + (s.fullLayoutMilliseconds.map { String(format: " · whole layout %.0f ms", $0) } ?? ""))
            if let benchmark { Text(benchmark).accessibilityIdentifier("lab-benchmark") }
            if lab.tracksSelection { Text(s.selection).accessibilityIdentifier("lab-selection") }
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
        case .editing: lab.load(LabText.editing)
        case .big: lab.load(LabText.big(lines: 5_000))
        case .bigViews:
            lab.load(LabText.big(lines: 5_000))
            lab.addAttachments(everyLines: 250)
        case .selected:
            if let id = model.selection, let note = await model.detail(of: id) { lab.load(note.content) } else { lab.load("Select a note in the list first, then open this again.") }
        }
    }
}
