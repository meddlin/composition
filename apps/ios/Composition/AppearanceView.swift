import CompositionCore
import SwiftUI

/// How the app looks (build plan Step 10): the colour scheme and the two type families. A choice is written to `settings.json` at once and every
/// open view is drawn again.
struct AppearanceView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look
    /// What is typed in the city field, and what the last Save city came to.
    @State private var city = ""
    @State private var cityOutcome: SunService.CityResult?
    @State private var looking = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("System", detail: "Light by day and dark at night, as the iPad is set", choice: .system, id: "system") { SystemSwatch() }
                    ForEach(Theme.all, id: \.name) { theme in
                        row(theme.label, detail: nil, choice: .theme(theme.name), id: theme.name) { SchemeSwatch(theme: theme) }
                    }
                    row("Follow the sun", detail: "Dark at night and light by day, fading around sunrise and sunset where you live", choice: .sun, id: "sun") {
                        SunSwatch(pair: model.appearance.sunPair)
                    }
                } header: {
                    Text("Colour scheme").foregroundStyle(look.mutedText)
                }
                .listRowBackground(look.surface)

                if model.appearance.scheme == .sun { followTheSun }

                Section {
                    Picker("Editor", selection: Binding(get: { model.appearance.editorFont }, set: { model.chooseEditorFont($0) })) {
                        ForEach(FontFamily.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .accessibilityIdentifier("editor-font")
                    Picker("Preview", selection: Binding(get: { model.appearance.previewFont }, set: { model.choosePreviewFont($0) })) {
                        ForEach(FontFamily.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .accessibilityIdentifier("preview-font")
                } header: {
                    Text("Fonts").foregroundStyle(look.mutedText)
                } footer: {
                    Text("The iPad's own faces. The desktop's open-source families (Geist, Lora, Literata …) are not on the iPad yet.").foregroundStyle(look.mutedText)
                }
                .listRowBackground(look.surface)

                writing
            }
            .scrollContentBackground(.hidden)
            .background(look.background)
            .navigationTitle("Appearance")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    // MARK: Writing

    private func writingBinding<Value>(_ keyPath: WritableKeyPath<WritingSettings, Value>) -> Binding<Value> {
        Binding(get: { model.writing[keyPath: keyPath] }, set: { value in model.chooseWriting { $0[keyPath: keyPath] = value } })
    }

    /// The ruler and reflow, which help with the shape of the text in the Markdown and Live tabs (the desktop's Settings ▸ Writing). Both are off until switched on.
    @ViewBuilder private var writing: some View {
        Section {
            Toggle("Ruler", isOn: writingBinding(\.rulerEnabled)).accessibilityIdentifier("ruler-toggle")
            if model.writing.rulerEnabled {
                Stepper(value: writingBinding(\.rulerColumn), in: WritingSettings.minColumn...WritingSettings.maxColumn) {
                    Text("Ruler at column \(model.writing.rulerColumn)")
                }
                .accessibilityIdentifier("ruler-column")
            }
            Toggle("Break lines as you type", isOn: writingBinding(\.reflowEnabled)).accessibilityIdentifier("reflow-toggle")
            if model.writing.reflowEnabled {
                Stepper(value: writingBinding(\.reflowColumn), in: WritingSettings.minColumn...WritingSettings.maxColumn) {
                    Text("Break at column \(model.writing.reflowColumn)")
                }
                .accessibilityIdentifier("reflow-column")
                Toggle("Keep tables whole", isOn: writingBinding(\.reflowKeepsTables)).accessibilityIdentifier("reflow-tables")
            }
        } header: {
            Text("Writing").foregroundStyle(look.mutedText)
        } footer: {
            Text("The ruler is a guide: a line at a column of the text. Breaking acts on the text: as you type, a line that grows past its column is broken at the last space before it. Headings, code, front matter and HTML are never broken; a table row stays whole while Keep tables whole is on. Pasting, deleting and undoing leave the text as it is.")
                .foregroundStyle(look.mutedText)
        }
        .listRowBackground(look.surface)
    }

    // MARK: Follow the sun

    /// Which light and dark colours it fades between, and the city whose sunrise and sunset it follows (the desktop's Settings ▸ Styling ▸ Follow the sun).
    @ViewBuilder private var followTheSun: some View {
        Section {
            ForEach(SunPairName.allCases, id: \.self) { pair in
                Button { model.chooseSunPair(pair) } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(pair.label)
                            SunStrip(pair: pair)
                        }
                        Spacer()
                        if model.appearance.sunPair == pair { Image(systemName: "checkmark").foregroundStyle(look.brand).accessibilityHidden(true) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sun-pair-\(pair.rawValue)")
                .accessibilityAddTraits(model.appearance.sunPair == pair ? [.isSelected] : [])
            }
        } header: {
            Text("Light and dark colours").foregroundStyle(look.mutedText)
        } footer: {
            Text("Each strip runs from full day to full night, the way the page looks as the sun sets. The colours fade across 90 minutes around each sunrise and sunset; the text changes halfway through the fade.")
                .foregroundStyle(look.mutedText)
        }
        .listRowBackground(look.surface)

        Section {
            TextField("Austin, TX", text: $city)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit(saveCity)
                .accessibilityIdentifier("sun-city")
            Button(action: saveCity) {
                Text(looking ? "Looking up…" : "Save city")
            }
            .disabled(looking)
            .accessibilityIdentifier("sun-city-save")
            cityStatus
        } header: {
            Text("Your city").foregroundStyle(look.mutedText)
        } footer: {
            Text("Sets the sunrise and sunset that Follow the sun tracks. Try Austin, TX or Paris. The city is looked up, and its times asked for, on open-meteo.com; nothing else is sent. Clear the field and save to forget the city.")
                .foregroundStyle(look.mutedText)
        }
        .listRowBackground(look.surface)
        .onAppear { if city.isEmpty { city = model.sun.location?.name ?? "" } }
    }

    @ViewBuilder private var cityStatus: some View {
        switch cityOutcome {
        case .saved(let name, let times):
            Text("Using \(name): \(times.summary).").foregroundStyle(look.success).accessibilityIdentifier("sun-city-status")
        case .failed(let message):
            Text(message).foregroundStyle(look.error).accessibilityIdentifier("sun-city-status")
        case .forgotten:
            Text("City forgotten, so Follow the sun is using 6:30 AM and 6:30 PM.").foregroundStyle(look.warning).accessibilityIdentifier("sun-city-status")
        case nil:
            if let place = model.sun.location {
                Text(model.sun.todaysTimes().map { "Using \(place.name): \($0.summary)." } ?? "Using \(place.name).")
                    .foregroundStyle(look.mutedText).accessibilityIdentifier("sun-city-status")
            } else {
                Text("No city saved yet, so Follow the sun is using 6:30 AM and 6:30 PM.").foregroundStyle(look.warning).accessibilityIdentifier("sun-city-status")
            }
        }
    }

    private func saveCity() {
        guard !looking else { return }
        looking = true
        Task {
            let result = await model.saveCity(city)
            looking = false
            cityOutcome = result
            // After a save the field shows the name that matched; after a failure it keeps what was typed.
            if case .saved(let name, _) = result { city = name } else if case .forgotten = result { city = "" }
        }
    }

    private func row<Swatch: View>(_ title: String, detail: String?, choice: SchemeChoice, id: String, @ViewBuilder swatch: () -> Swatch) -> some View {
        Button { model.chooseScheme(choice) } label: {
            HStack(spacing: 12) {
                swatch()
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    if let detail { Text(detail).font(.caption).foregroundStyle(look.mutedText) }
                }
                Spacer()
                if model.appearance.scheme == choice { Image(systemName: "checkmark").foregroundStyle(look.brand).accessibilityHidden(true) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("scheme-\(id)")
        .accessibilityAddTraits(model.appearance.scheme == choice ? [.isSelected] : [])
    }
}

/// A scheme in three colours: its page, a card on it and its accent, with text on the page.
private struct SchemeSwatch: View {
    let theme: Theme

    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(theme.background.color)
            .frame(width: 52, height: 34)
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 3) {
                    Capsule().fill(theme.foreground.color).frame(width: 22, height: 4)
                    HStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 2).fill(theme.surface.color).frame(width: 14, height: 9)
                        RoundedRectangle(cornerRadius: 2).fill(theme.brand.color).frame(width: 14, height: 9)
                    }
                }
                .padding(6)
            }
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(theme.foreground.color(opacity: Theme.Share.mutedForeground), lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}

/// Light and dark side by side, for System.
private struct SystemSwatch: View {
    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(Theme.named("light")!.background.color)
            Rectangle().fill(Theme.named("dark")!.background.color)
        }
        .frame(width: 52, height: 34)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.gray, lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}

/// A pair's day in colour, from full light to full night: each cell is the scheme as it looks at that point of the fade, with the text it has there.
private struct SunStrip: View {
    let pair: SunPairName
    private static let levels: [Double] = [1, 0.83, 0.66, 0.5, 0.34, 0.17, 0]

    var body: some View {
        HStack(spacing: 8) {
            Text("day").font(.caption)
            HStack(spacing: 0) {
                ForEach(Self.levels, id: \.self) { level in
                    let theme = Theme.sun(pair: pair, level: level)
                    Text("Aa").font(.caption.weight(.medium)).foregroundStyle(theme.foreground.color)
                        .frame(width: 30, height: 26)
                        .background(theme.background.color)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.gray.opacity(0.4), lineWidth: 0.5))
            Text("night").font(.caption)
        }
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(pair.label), from day to night")
    }
}

/// Follow the sun in the list of schemes: the selected pair's day, dusk and night side by side.
private struct SunSwatch: View {
    let pair: SunPairName

    var body: some View {
        HStack(spacing: 0) {
            ForEach([1.0, 0.5, 0.0], id: \.self) { level in
                Rectangle().fill(Theme.sun(pair: pair, level: level).background.color)
            }
        }
        .frame(width: 52, height: 34)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.gray, lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}
