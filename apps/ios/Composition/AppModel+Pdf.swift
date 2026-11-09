import CompositionCore
import Foundation
import PDFKit

// M2, the PDFs (pdf-markup-plan.md, "The iPad"): importing a PDF from Files, finding the PDF a note owns, and what the reader keeps (where
// it was, its bookmarks). The rows and the files are `CompositionCore`'s (`DocumentLibrary`, `DocumentsStore`, `PdfMarkupStore`); this is the
// screens' side of them.

/// A PDF waiting to be imported, and what to do when it has been dealt with: let go of the access the picker gave, or delete the copy a drop made.
struct PdfFile: @unchecked Sendable {
    let url: URL
    let release: @Sendable () -> Void

    /// A file chosen in Files: read inside the security-scoped access the system grants, which `release` gives back.
    static func picked(_ url: URL) -> PdfFile {
        let scoped = url.startAccessingSecurityScopedResource()
        return PdfFile(url: url) { if scoped { url.stopAccessingSecurityScopedResource() } }
    }

    /// A file already in our own folders (a drop's copy, or a path given at launch); `cleanup` is the folder to remove afterwards, if any.
    static func local(_ url: URL, cleanup: URL? = nil) -> PdfFile {
        PdfFile(url: url) { if let cleanup { try? FileManager.default.removeItem(at: cleanup) } }
    }
}

/// A PDF whose bytes the library already holds. The person is asked whether to open the one held, import a separate copy, or neither;
/// until they answer, the file stays readable.
struct DuplicatePdf: Identifiable {
    let id = UUID()
    let file: PdfFile
    let existing: [ExistingPdf]
    let target: SidebarItem?

    var name: String { DocumentNames.displayName(file.url.path) }
}

/// The PDF a note owns, as the reader opens it. `url` is nil when the file is gone from the folder (deleted behind the app's back).
struct PdfSource: Sendable, Equatable {
    let document: StoredDocument
    let url: URL?
}

extension AppModel {
    /// The PDF files' operations; nil until the notes are open.
    var library: DocumentLibrary? { store.map { DocumentLibrary(store: $0, location: location) } }

    // MARK: Import

    /// Makes a note of each PDF, in the group or notebook `target` names (the notes list's own when nil), and opens the last. A PDF the library already holds
    /// is not imported twice without asking (`duplicatePdf`); one that is refused is said, in the desktop's words.
    func importPdfs(_ files: [PdfFile], into target: SidebarItem?) async {
        guard let library, !files.isEmpty else {
            files.forEach { $0.release() }
            return
        }
        var group: Int64?
        var notebook: Int64?
        switch target {
        case .group(let id)?: group = id
        case .notebook(let id)?: notebook = id
        default: (group, notebook) = newNoteTarget
        }
        busyMessage = files.count == 1 ? "Importing the PDF…" : "Importing \(files.count) PDFs…"
        defer { busyMessage = nil }
        var opened: Int64?
        var problems: [String] = []
        for file in files {
            switch await importOne(file, library: library, group: group, notebook: notebook, allowDuplicate: false) {
            case .added(let id):
                opened = id
                file.release()
            case .duplicate(let existing):
                // One question at a time: a second duplicate in the same batch is said, not asked.
                if duplicatePdf == nil {
                    duplicatePdf = DuplicatePdf(file: file, existing: existing, target: target)
                } else {
                    problems.append("\(DocumentNames.displayName(file.url.path)) is already here.")
                    file.release()
                }
            case .refused(let message):
                problems.append(message)
                file.release()
            }
        }
        await finishImport(opened: opened, group: group, notebook: notebook, problems: problems)
    }

    /// Takes the question away to answer it. Done at once, in the button's own action: the alert closing after the button sets it to nothing, and would
    /// otherwise let go of the file that the answer still needs.
    func takeDuplicatePdf() -> DuplicatePdf? {
        defer { duplicatePdf = nil }
        return duplicatePdf
    }

    /// The answer to the duplicate question: a separate copy.
    func importDuplicateAnyway(_ pending: DuplicatePdf) async {
        guard let library else {
            pending.file.release()
            return
        }
        var group: Int64?
        var notebook: Int64?
        switch pending.target {
        case .group(let id)?: group = id
        case .notebook(let id)?: notebook = id
        default: (group, notebook) = newNoteTarget
        }
        busyMessage = "Importing the PDF…"
        defer { busyMessage = nil }
        var opened: Int64?
        var problems: [String] = []
        switch await importOne(pending.file, library: library, group: group, notebook: notebook, allowDuplicate: true) {
        case .added(let id): opened = id
        case .refused(let message): problems.append(message)
        case .duplicate: break
        }
        pending.file.release()
        await finishImport(opened: opened, group: group, notebook: notebook, problems: problems)
    }

    /// The answer to the duplicate question: open the note that owns the PDF already held, if it is not in the Trash Can.
    func openExistingPdf(_ pending: DuplicatePdf) async {
        pending.file.release()
        guard let noteId = pending.existing.first?.document.noteId else { return }
        await reload()
        if orderedNotes.contains(where: { $0.id == noteId }) {
            followNoteLink(noteId)
        } else {
            errorMessage = "That PDF's note is in the Trash Can. Restore it from there."
        }
    }

    /// The answer to the duplicate question: neither.
    func dismissDuplicatePdf() {
        duplicatePdf?.file.release()
        duplicatePdf = nil
    }

    private enum ImportOne: Sendable {
        case added(Int64)
        case duplicate([ExistingPdf])
        case refused(String)
    }

    /// One PDF through `DocumentLibrary.importPdf`, off the main thread, and its pages counted when it is in.
    private func importOne(_ file: PdfFile, library: DocumentLibrary, group: Int64?, notebook: Int64?, allowDuplicate: Bool) async -> ImportOne {
        do {
            return try await Self.perform {
                switch try library.importPdf(from: file.url, groupId: group, notebookId: notebook, allowDuplicate: allowDuplicate) {
                case .added(let note, let document):
                    // The reader is what can count pages; a PDF that asks for a password is counted when it is opened.
                    if let pdf = PDFDocument(url: library.location.documentsURL.appendingPathComponent(document.storedName)), pdf.pageCount > 0 {
                        try library.store.database.setPageCount(id: document.id, pageCount: pdf.pageCount)
                    }
                    return .added(note.id)
                case .duplicate(let existing): return .duplicate(existing)
                case .refused(let message): return .refused(message)
                }
            }
        } catch {
            return .refused(error.localizedDescription)
        }
    }

    private func finishImport(opened: Int64?, group: Int64?, notebook: Int64?, problems: [String]) async {
        await reload()
        if let opened {
            query = ""
            open(opened)
        }
        if let group { expanded.insert(.group(group)) }
        if let notebook { expanded.insert(.notebook(notebook)) }
        if !problems.isEmpty { errorMessage = problems.joined(separator: "\n") }
    }

    // MARK: The PDF a note owns

    /// The PDF the note owns, if it owns one, and where its file is.
    func pdfSource(forNote id: Int64) async -> PdfSource? {
        guard let library else { return nil }
        return try? await Self.perform {
            guard let document = try library.store.database.documentForNote(id) else { return nil }
            return PdfSource(document: document, url: try library.documentFile(id: document.id)?.url)
        }
    }

    /// Remembers where the reader was (the page, and the zoom only if the person zoomed), keeping what else the row holds (the desktop's dark pages).
    func saveViewState(documentId: Int64, page: Int, zoom: Double?) async {
        guard let database = store?.database else { return }
        _ = try? await Self.perform {
            guard var state = try database.document(id: documentId)?.viewState else { return }
            state.page = page
            state.zoom = zoom
            try database.setViewState(id: documentId, state: state)
        }
    }

    /// A PDF that was unlocked with its password is counted then, if it was not before.
    func setPageCountIfUnknown(documentId: Int64, pageCount: Int) async {
        guard let database = store?.database, pageCount > 0 else { return }
        _ = try? await Self.perform {
            guard let document = try database.document(id: documentId), document.pageCount == 0 else { return }
            try database.setPageCount(id: documentId, pageCount: pageCount)
        }
    }

    // MARK: Bookmarks

    func bookmarks(documentId: Int64) async -> [PdfBookmark] {
        guard let database = store?.database else { return [] }
        return (try? await Self.perform { try database.bookmarks(documentId: documentId) }) ?? []
    }

    func addBookmark(documentId: Int64, page: Int, label: String = "") async {
        guard let database = store?.database else { return }
        do {
            _ = try await Self.perform { try database.addBookmark(documentId: documentId, page: page, label: label) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func renameBookmark(id: Int64, label: String) async {
        guard let database = store?.database else { return }
        do {
            _ = try await Self.perform { try database.renameBookmark(id: id, label: label) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteBookmark(id: Int64) async {
        guard let database = store?.database else { return }
        do {
            try await Self.perform { try database.deleteBookmark(id: id) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
