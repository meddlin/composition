import CompositionCore
import SwiftUI

/// How the app looks (build plan Step 10): the colour scheme and the two type families. A choice is written to `settings.json` at once and every
/// open view is drawn again.
struct AppearanceView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look
    /// The four hours as they are on the pickers, which are saved by Save hours (a half-changed set may not go round the clock in order), and what the last save came to.
    @State private var hoursDraft = SunHours.default
    @State private var hoursSaved = false
    @State private var hoursRefusal: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("System", detail: "Light by day and dark at night, as the iPad is set", choice: .system, id: "system") { SystemSwatch() }
                    ForEach(Theme.all, id: \.name) { theme in
                        row(theme.label, detail: nil, choice: .theme(theme.name), id: theme.name) { SchemeSwatch(theme: theme) }
                    }
                    row("Follow the sun", detail: "Dark at night and light by day, fading at the hours you set", choice: .sun, id: "sun") {
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

    /// Which light and dark colours it fades between, and the four hours, set by hand, at which it gets lighter and darker (the desktop's Settings ▸ Styling ▸ Follow the sun).
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
            Text("Each strip runs from full day to full night, the way the page looks as the evening fade goes on. The text changes halfway through a fade.")
                .foregroundStyle(look.mutedText)
        }
        .listRowBackground(look.surface)

        Section {
            hourRow(SunHours.labels[0], \.lightenFrom, id: "sun-hour-lightenFrom")
            hourRow(SunHours.labels[1], \.lightFrom, id: "sun-hour-lightFrom")
            hourRow(SunHours.labels[2], \.darkenFrom, id: "sun-hour-darkenFrom")
            hourRow(SunHours.labels[3], \.darkFrom, id: "sun-hour-darkFrom")
            DayStrip(pair: model.appearance.sunPair, hours: hoursDraft.goesRoundTheClock ? hoursDraft : model.sun.hours)
            if let problem = hoursDraft.problem {
                Text(problem).foregroundStyle(look.error).accessibilityIdentifier("sun-hours-problem")
            }
            if let refusal = hoursRefusal {
                Text(refusal).foregroundStyle(look.error).accessibilityIdentifier("sun-hours-status")
            } else if hoursSaved, hoursDraft == model.sun.hours {
                Text("Saved.").foregroundStyle(look.success).accessibilityIdentifier("sun-hours-status")
            }
            Button("Save hours", action: saveHours)
                .disabled(!hoursDraft.goesRoundTheClock || hoursDraft == model.sun.hours)
                .accessibilityIdentifier("sun-hours-save")
            Button("Use the defaults") {
                hoursDraft = .default
                hoursSaved = false
                hoursRefusal = nil
            }
            .disabled(hoursDraft == .default)
            .accessibilityIdentifier("sun-hours-default")
        } header: {
            Text("When it changes").foregroundStyle(look.mutedText)
        } footer: {
            Text("Times on this iPad's own clock, so they follow it if it changes zone. They go once round the clock in order, starting anywhere (to be light over the night, start in the evening), each at least a minute after the one before. The defaults are 05:45, 07:15, 17:45 and 19:15. Nothing is looked up: there is no city, no location and no network request.")
                .foregroundStyle(look.mutedText)
        }
        .listRowBackground(look.surface)
        .onAppear { hoursDraft = model.sun.hours }
    }

    /// Hours are kept as minutes after midnight, and shown in a picker that reads them as a time in a fixed zone (GMT, a day with no clock change), so that a
    /// time such as 02:30 is never one the iPad's own clock skips.
    private static let pickerCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    private func hourRow(_ title: String, _ keyPath: WritableKeyPath<SunHours, Int>, id: String) -> some View {
        let calendar = Self.pickerCalendar
        return DatePicker(
            title,
            selection: Binding(
                get: {
                    let minutes = hoursDraft[keyPath: keyPath]
                    return calendar.date(from: DateComponents(year: 2001, month: 1, day: 1, hour: minutes / 60, minute: minutes % 60)) ?? Date(timeIntervalSinceReferenceDate: 0)
                },
                set: { date in
                    let parts = calendar.dateComponents([.hour, .minute], from: date)
                    hoursDraft[keyPath: keyPath] = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
                    hoursSaved = false
                    hoursRefusal = nil
                }),
            displayedComponents: .hourAndMinute
        )
        .environment(\.calendar, calendar)
        .environment(\.timeZone, calendar.timeZone)
        .accessibilityIdentifier(id)
    }

    private func saveHours() {
        hoursRefusal = model.saveSunHours(hoursDraft)
        hoursSaved = hoursRefusal == nil
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

/// The whole day from midnight to midnight in the chosen pair's colours, at the level the hours make of each hour of it, so that they can be judged by eye.
private struct DayStrip: View {
    let pair: SunPairName
    let hours: SunHours

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 0) {
                ForEach(0..<24, id: \.self) { hour in
                    let level = Sun.level(hours, msOfDay: Int64(hour * 60 + 30) * Sun.millisecondsPerMinute)
                    Rectangle().fill(Theme.sun(pair: pair, level: level).background.color).frame(height: 26)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.gray.opacity(0.4), lineWidth: 0.5))
            HStack {
                Text("00:00"); Spacer(); Text("06:00"); Spacer(); Text("12:00"); Spacer(); Text("18:00"); Spacer(); Text("24:00")
            }
            .font(.caption2)
        }
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("The day from midnight to midnight in \(pair.label) colours, with the hours as set")
        .accessibilityIdentifier("sun-day-strip")
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
