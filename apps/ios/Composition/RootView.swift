import SwiftUI
import UniformTypeIdentifiers

struct RootView: View {
    @Bindable var model: AppModel
    @State private var choosingBackup = false

    var body: some View {
        content
            // Any file: a backup is a `.tar.gz`, which the system may not name as a type this app could list.
            .fileImporter(isPresented: $choosingBackup, allowedContentTypes: [.data]) { result in
                switch result {
                case .success(let url): Task { await model.importBackup(from: url) }
                case .failure(let error): model.errorMessage = error.localizedDescription
                }
            }
            .overlay { if let message = model.busyMessage { BusyOverlay(message: message) } }
            .alert("Something went wrong", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.errorMessage ?? "")
            }
            .alert("Done", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.notice ?? "")
            }
            .sheet(item: $model.exportedBackup) { ExportSheet(backup: $0) }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .starting:
            ProgressView()
        case .empty:
            ContentUnavailableView {
                Label("No notes yet", systemImage: "tray")
            } description: {
                Text("In the desktop app, open Settings and choose Backup. Get the file to this iPad (AirDrop, iCloud Drive or a cable), then choose it here.")
            } actions: {
                Button("Choose a backup…") { choosingBackup = true }.buttonStyle(.borderedProminent)
            }
        case .ready:
            BrowserView(model: model) { choosingBackup = true }
        }
    }
}

struct BusyOverlay: View {
    let message: String

    var body: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea()
            ProgressView(message)
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}
