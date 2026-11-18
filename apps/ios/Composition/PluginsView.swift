import SwiftUI

/// More ▸ Plugins: the desktop's built-in plugins that the iPad has (the Reading List), switched on and off as on the desktop, and the
/// ones it does not have yet. The switch is the desktop's own `plugins` entry in `settings.json`, so it travels in a backup.
struct PluginsView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.look) private var look
    @State private var confirmingClear = false
    @State private var cleared = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: Binding(get: { model.readingListEnabled }, set: { on in Task { await model.setReadingListEnabled(on) } })) {
                        Label("Reading List", systemImage: "eyeglasses")
                    }
                    .accessibilityIdentifier("plugin-reading-list")
                    if model.readingListEnabled {
                        Button(cleared ? "Browsing Data Cleared" : "Clear Browsing Data…", role: .destructive) { confirmingClear = true }
                            .disabled(cleared)
                            .accessibilityIdentifier("reading-clear-data")
                    }
                } footer: {
                    Text("A list of article links, with the page of the one you pick shown beside it, so a reading list can be read without leaving the app. Off until you turn it on, because it lets the app load web pages. Turning it off hides it; your links are kept, and they are in your backups either way.")
                }
                .listRowBackground(look.surface)
                Section {
                    LabeledContent("To-do", value: "Desktop app only")
                    LabeledContent("RSS Reader", value: "Desktop app only")
                    LabeledContent("Contacts", value: "Desktop app only")
                } header: {
                    Text("Not on the iPad yet")
                } footer: {
                    Text("What they keep is in your backups either way, and a backup made here gives it back to the desktop app as it was.")
                }
                .listRowBackground(look.surface)
            }
            .scrollContentBackground(.hidden)
            .background(look.background)
            .navigationTitle("Plugins")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Clear the Reading List's browsing data?", isPresented: $confirmingClear, titleVisibility: .visible) {
                Button("Clear Browsing Data", role: .destructive) {
                    Task {
                        await ReadingPage.clearBrowsingData()
                        cleared = true
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Cookies, site data and the cache of pages opened in the Reading List are wiped, so you are signed out of any site you signed in to there. Your links are kept.")
            }
        }
    }
}
