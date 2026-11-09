import CompositionCore
import SwiftUI
import UniformTypeIdentifiers

// Build plan Step 7: picking things up and putting them down. Rows are dragged with the system's drag and drop (a finger or the Pencil
// held on a row, or a trackpad), and a row says where the item would land as it hovers over it: onto it, or above or below it. The
// rules for which of those a drag may do are in AppModel+Organization.swift, and the arithmetic of which edge the finger is on is
// `DropEdge` in the core, checked against the desktop's.

#if DEBUG
/// Debug only: what the drag and drop did, in `dnd.log` in the app's tmp folder, for the scripts that check it.
func dndLog(_ line: String) {
    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("dnd.log")
    let data = Data((line + "\n").utf8)
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    } else {
        try? data.write(to: url)
    }
}
#else
@inline(__always) func dndLog(_ line: String) {}
#endif

extension View {
    /// Makes the view something to pick up. What is dragged is remembered in the model while the drag lasts, so that the rows it hovers over
    /// can say what they would accept; the item itself travels in the drag only inside this app.
    func dragSource(_ item: DraggedItem, in model: AppModel) -> some View {
        onDrag {
            dndLog("lift \(item.kind) \(item.id)")
            model.dragging = item
            let provider = NSItemProvider()
            provider.registerDataRepresentation(forTypeIdentifier: UTType.compositionItem.identifier, visibility: .ownProcess) { completion in
                completion(try? JSONEncoder().encode(item), nil)
                return nil
            }
            return provider
        }
    }

    /// Makes the view something a dragged item can land on, with a line above or below it, or a tint on it, to show where.
    func dropTarget(_ target: DropTarget, in model: AppModel) -> some View {
        modifier(EdgeDrop(model: model, target: target))
    }
}

/// The list that rows are dropped in names a coordinate space, because a drop reports where the finger is in the list's space and not the row's.
extension View {
    func dropList() -> some View { coordinateSpace(name: DropSpace.name) }
}

private enum DropSpace {
    static let name = "dropList"
}

private struct RowFrame: PreferenceKey {
    static let defaultValue = CGRect.zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { value = nextValue() }
}

private struct EdgeDrop: ViewModifier {
    let model: AppModel
    let target: DropTarget
    @State private var frame = CGRect.zero
    @State private var edge: DropEdge?

    func body(content: Content) -> some View {
        content
            .background(GeometryReader { Color.clear.preference(key: RowFrame.self, value: $0.frame(in: .named(DropSpace.name))) })
            .onPreferenceChange(RowFrame.self) { frame = $0 }
            .background {
                if edge == .into { RoundedRectangle(cornerRadius: 8).fill(Color.accentColor.opacity(0.22)) }
            }
            .overlay(alignment: .top) { if edge == .before { line } }
            .overlay(alignment: .bottom) { if edge == .after { line } }
            .onDrop(of: [.compositionItem, .plainText, .pdf], delegate: EdgeDropDelegate(model: model, target: target, frame: frame, edge: $edge))
    }

    private var line: some View {
        Capsule().fill(Color.accentColor).frame(height: 3).padding(.horizontal, 4)
    }
}

private struct EdgeDropDelegate: DropDelegate {
    let model: AppModel
    let target: DropTarget
    /// The row, in the list's coordinate space.
    let frame: CGRect
    @Binding var edge: DropEdge?

    private func edge(at info: DropInfo) -> DropEdge? {
        if isText(info) { return .into }
        guard info.hasItemsConforming(to: [.compositionItem]), let item = model.dragging else { return nil }
        return DropEdge.at(offsetY: info.location.y - frame.minY, height: max(frame.height, 1), allowed: model.allowedEdges(of: item, on: target))
    }

    /// Text or a PDF dropped from Files or another app, rather than one of our own rows.
    private func isText(_ info: DropInfo) -> Bool {
        !info.hasItemsConforming(to: [.compositionItem]) && info.hasItemsConforming(to: [.plainText, .pdf]) && model.acceptsText(on: target)
    }

    func validateDrop(info: DropInfo) -> Bool {
        dndLog("validate \(target) conforming \(info.hasItemsConforming(to: [.compositionItem])) dragging \(String(describing: model.dragging))")
        if isText(info) { return true }
        guard info.hasItemsConforming(to: [.compositionItem]), let item = model.dragging else { return false }
        return !model.allowedEdges(of: item, on: target).isEmpty
    }

    func dropEntered(info: DropInfo) {
        edge = edge(at: info)
        dndLog("entered \(target) edge \(String(describing: edge))")
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        edge = edge(at: info)
        return DropProposal(operation: edge == nil ? .cancel : .copy)
    }

    func dropExited(info: DropInfo) {
        dndLog("exited \(target)")
        edge = nil
    }

    func performDrop(info: DropInfo) -> Bool {
        defer { edge = nil }
        dndLog("perform \(target) dragging \(String(describing: model.dragging)) edge \(String(describing: edge(at: info)))")
        if isText(info) {
            let into: SidebarItem
            switch target {
            case .group(let id): into = .group(id)
            case .notebook(let id): into = .notebook(id)
            case .note: return false
            }
            if info.hasItemsConforming(to: [.pdf]) { return DroppedPdfs.take(info, into: into, model: model) }
            return DroppedTexts.take(info, into: into, model: model)
        }
        guard let item = model.dragging, let landed = edge(at: info) else { return false }
        model.dragging = nil
        Task { await model.drop(item, on: target, edge: landed) }
        return true
    }
}

/// Reading what was dropped from Files or another app: the text of each Markdown or text file (named after the file), or of a selection of text.
@MainActor
enum DroppedTexts {
    /// Starts reading the dropped items and makes the notes when they are read. True when there was anything to read.
    static func take(_ info: DropInfo, into item: SidebarItem?, model: AppModel) -> Bool {
        let providers = info.itemProviders(for: [.plainText])
        guard !providers.isEmpty else { return false }
        Task {
            var texts: [AppModel.DroppedText] = []
            for provider in providers {
                let name = provider.suggestedName
                let data: Data? = await withCheckedContinuation { continuation in
                    _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier) { data, _ in continuation.resume(returning: data) }
                }
                // Anything over 5 MB is not a note someone dropped.
                if let data, data.count <= 5_000_000, let text = String(data: data, encoding: .utf8) { texts.append(AppModel.DroppedText(name: name, text: text)) }
            }
            await model.importTexts(texts, into: item)
        }
        return true
    }
}

extension View {
    /// Lets text files and selections of text be dropped anywhere on the list, into the group or notebook the sidebar points at.
    func textDrop(into item: SidebarItem?, model: AppModel) -> some View {
        onDrop(of: [.plainText], delegate: ListTextDropDelegate(model: model, item: item))
    }
}

private struct ListTextDropDelegate: DropDelegate {
    let model: AppModel
    let item: SidebarItem?

    func validateDrop(info: DropInfo) -> Bool {
        !info.hasItemsConforming(to: [.compositionItem]) && info.hasItemsConforming(to: [.plainText])
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .copy) }

    func performDrop(info: DropInfo) -> Bool { DroppedTexts.take(info, into: item, model: model) }
}

/// Reading what was dropped from Files or another app that is a PDF: each file is copied to a folder of its own first (the system's copy lasts only while
/// it is being handed over), and the copy is what is imported and then removed.
@MainActor
enum DroppedPdfs {
    /// Starts copying the dropped PDFs and imports them when they are copied. True when there was anything to take.
    static func take(_ info: DropInfo, into item: SidebarItem?, model: AppModel) -> Bool {
        let providers = info.itemProviders(for: [.pdf])
        guard !providers.isEmpty else { return false }
        Task {
            var files: [PdfFile] = []
            for provider in providers {
                if let file = await copy(provider) { files.append(file) }
            }
            await model.importPdfs(files, into: item)
        }
        return true
    }

    private static func copy(_ provider: NSItemProvider) async -> PdfFile? {
        await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { url, _ in
                guard let url else { return continuation.resume(returning: nil) }
                let folder = FileManager.default.temporaryDirectory.appending(path: "Dropped-\(UUID().uuidString)", directoryHint: .isDirectory)
                let copy = folder.appending(path: url.lastPathComponent)
                do {
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: copy)
                    continuation.resume(returning: PdfFile.local(copy, cleanup: folder))
                } catch {
                    try? FileManager.default.removeItem(at: folder)
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}

extension View {
    /// Lets PDF files be dropped anywhere on the list, into the group or notebook the sidebar points at.
    func pdfDrop(into item: SidebarItem?, model: AppModel) -> some View {
        onDrop(of: [.pdf], delegate: ListPdfDropDelegate(model: model, item: item))
    }
}

private struct ListPdfDropDelegate: DropDelegate {
    let model: AppModel
    let item: SidebarItem?

    func validateDrop(info: DropInfo) -> Bool {
        !info.hasItemsConforming(to: [.compositionItem]) && info.hasItemsConforming(to: [.pdf])
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .copy) }

    func performDrop(info: DropInfo) -> Bool { DroppedPdfs.take(info, into: item, model: model) }
}
