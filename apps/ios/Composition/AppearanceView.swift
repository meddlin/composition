import CompositionCore
import SwiftUI

/// How the app looks (build plan Step 10): the colour scheme and the two type families. A choice is written to `settings.json` at once and every
/// open view is drawn again.
struct AppearanceView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("System", detail: "Light by day and dark at night, as the iPad is set", choice: .system, id: "system") { SystemSwatch() }
                    ForEach(Theme.all, id: \.name) { theme in
                        row(theme.label, detail: nil, choice: .theme(theme.name), id: theme.name) { SchemeSwatch(theme: theme) }
                    }
                } header: {
                    Text("Colour scheme").foregroundStyle(look.mutedText)
                }
                .listRowBackground(look.surface)

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
                    Text("The iPad's own faces. The desktop's open-source families (Geist, Lora, Literata …) are not on the iPad yet, and “Follow the sun” is not either.").foregroundStyle(look.mutedText)
                }
                .listRowBackground(look.surface)
            }
            .scrollContentBackground(.hidden)
            .background(look.background)
            .navigationTitle("Appearance")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
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
