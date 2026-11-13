import CompositionCore
import SwiftUI
import UIKit

/// The second column while the sidebar is on the Reading List: a box to add a link, and the links, unread first (the desktop's
/// `ReadingListPanel`, docs/reading-list-plan.md). Picking one opens its page in the third column.
struct ReadingListColumn: View {
    @Bindable var model: AppModel
    @Environment(\.look) private var look
    @Environment(\.openURL) private var openURL
    @State private var link = ""
    @State private var problem: String?
    @State private var deleting: ReadingItem?
    @FocusState private var typing: Bool

    var body: some View {
        List(selection: Binding(get: { model.readingSelection }, set: { model.readingSelection = $0 })) {
            ForEach(model.sortedReadingItems) { row($0) }
        }
        .overlay { empty }
        .scrollContentBackground(.hidden)
        .background(look.surface)
        .tint(look.selectionFill)
        .safeAreaInset(edge: .top, spacing: 0) { addBox }
        // A link dragged from Safari, in Split View or Slide Over, joins the list.
        .dropDestination(for: URL.self) { urls, _ in
            Task { for url in urls { problem = await model.addReadingLink(url.absoluteString) } }
            return !urls.isEmpty
        }
        .navigationTitle("Reading List")
        .toolbar {
            ToolbarItemGroup(placement: .topBarLeading) {
                Button("Back", systemImage: "chevron.backward") { model.goBack() }
                    .keyboardShortcut("[", modifiers: .command)
                    .disabled(!model.canGoBack)
                Button("Forward", systemImage: "chevron.forward") { model.goForward() }
                    .keyboardShortcut("]", modifiers: .command)
                    .disabled(!model.canGoForward)
            }
            ToolbarItem(placement: .primaryAction) {
                // The system's own paste button, which reads the clipboard without asking, because the person pressed it.
                PasteButton(payloadType: String.self) { strings in
                    guard let text = strings.first else { return }
                    Task { await add(text, clearing: false) }
                }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("reading-paste")
            }
        }
        .confirmationDialog("Delete this link?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { item in
            Button("Delete", role: .destructive) { Task { await model.deleteReadingLink(item.id) } }
            Button("Cancel", role: .cancel) {}
        } message: { item in
            Text("“\(item.label)” will be removed from your Reading List for good. It is not sent to the Trash Can; to get it back, add the link again.")
        }
    }

    // MARK: Adding

    /// Type or paste a link and press Return. The box stays for the next one; a link it refuses stays in it, with the reason under it.
    private var addBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "link").foregroundStyle(look.mutedText).accessibilityHidden(true)
                TextField("Add a link", text: $link, prompt: Text("Paste a link and press Return"))
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($typing)
                    .onSubmit { Task { await add(link, clearing: true) } }
                    .onChange(of: link) { problem = nil }
                    .accessibilityIdentifier("reading-add-field")
                if !link.isEmpty {
                    Button("Add") { Task { await add(link, clearing: true) } }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("reading-add-button")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(look.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(look.border))
            if let problem {
                Text(problem)
                    .font(.footnote)
                    .foregroundStyle(look.error)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("reading-problem")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(look.surface)
    }

    private func add(_ text: String, clearing: Bool) async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        problem = await model.addReadingLink(text)
        if problem == nil, clearing { link = "" }
    }

    // MARK: Rows

    private func row(_ item: ReadingItem) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle()
                .fill(item.read ? Color.clear : look.brand)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.label).font(.headline).lineLimit(2)
                    .foregroundStyle(item.read ? look.mutedText : look.foreground)
                Text(item.host).font(.caption).foregroundStyle(look.mutedText).lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .tag(item.id)
        .accessibilityElement(children: .combine)
        .accessibilityValue(item.read ? "Read" : "Unread")
        .accessibilityIdentifier("reading-row-\(item.id)")
        .swipeActions(edge: .leading) {
            Button(item.read ? "Unread" : "Read", systemImage: item.read ? "circle" : "checkmark.circle") {
                Task { await model.setReadingRead(item.id, !item.read) }
            }
            .tint(look.brand)
        }
        .swipeActions(edge: .trailing) {
            // Not a destructive role: that would take the row away before the question is answered.
            Button("Delete", systemImage: "trash") { deleting = item }.tint(.red)
        }
        .contextMenu {
            if let url = URL(string: item.url) {
                Button("Open in Safari", systemImage: "safari") { openURL(url) }
                Button("Copy Link", systemImage: "doc.on.doc") { UIPasteboard.general.url = url }
                ShareLink(item: url) { Label("Share…", systemImage: "square.and.arrow.up") }
            }
            Button(item.read ? "Mark as Unread" : "Mark as Read", systemImage: item.read ? "circle" : "checkmark.circle") {
                Task { await model.setReadingRead(item.id, !item.read) }
            }
            Divider()
            Button("Delete…", systemImage: "trash", role: .destructive) { deleting = item }
        }
    }

    @ViewBuilder private var empty: some View {
        if model.readingItems.isEmpty {
            ContentUnavailableView("No links yet", systemImage: "eyeglasses", description: Text("Paste one above, or drag a link here from Safari."))
        }
    }
}
