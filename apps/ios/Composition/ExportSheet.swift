import CompositionCore
import SwiftUI

/// A backup that has been made, ready to save to Files, AirDrop to a Mac, and so on.
struct ExportSheet: View {
    let backup: ExportedBackup
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                Image(systemName: "externaldrive.badge.checkmark").font(.system(size: 56)).foregroundStyle(.green)
                Text("Backup ready").font(.title2.bold())
                let counts = backup.summary.counts
                Text("\(counts.notes) notes, \(counts.trashedNotes) in the Trash Can, \(counts.images) images, \(counts.attachments) attached files · \(ByteCountFormatter.string(fromByteCount: backup.summary.bytes, countStyle: .file))")
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                ShareLink(item: backup.summary.file) { Label("Save or share…", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.borderedProminent)
                Text("Restore it in the desktop app from Settings, Restore.").font(.footnote).foregroundStyle(.secondary)
            }
            .padding(32)
            .frame(maxWidth: 480)
            .navigationTitle("Export a backup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
