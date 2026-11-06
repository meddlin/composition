import SwiftUI

/// What this build is, and what it is running on, for reading the search timings in context.
struct AboutView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("This build") {
                    LabeledContent("Version", value: "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?") (prototype)")
                    LabeledContent("Does", value: "Browse, search, Trash Can, backups")
                    LabeledContent("Search forgives", value: "Typos, also in first letters and short words")
                    LabeledContent("Does not yet", value: "Edit, render Markdown, images, ink")
                }
                Section("Your notes") {
                    LabeledContent("Notes", value: "\(model.noteCount)")
                    LabeledContent("In the Trash Can", value: "\(model.trashedNotes.count + model.trashedGroups.count)")
                    LabeledContent("Search index rebuilt at launch", value: model.indexRebuiltAtOpen ? "Yes" : "No")
                    if let milliseconds = model.lastSearchMilliseconds {
                        LabeledContent("Last search", value: String(format: "%.1f ms", milliseconds))
                    }
                }
                Section("Running on") {
                    LabeledContent("SQLite", value: model.sqliteVersion)
                    LabeledContent("Data folder", value: model.location.directory.lastPathComponent)
                    #if DEBUG
                    LabeledContent("Build", value: "Debug (slower than a release build)")
                    #else
                    LabeledContent("Build", value: "Release")
                    #endif
                }
            }
            .navigationTitle("About this build")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
