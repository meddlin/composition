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
        guard let store else { return }
        do {
            _ = try await Self.perform { try store.addBookmark(documentId: documentId, page: page, label: label) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func renameBookmark(id: Int64, label: String) async {
        guard let store else { return }
        do {
            _ = try await Self.perform { try store.renameBookmark(id: id, label: label) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteBookmark(id: Int64) async {
        guard let store else { return }
        do {
            try await Self.perform { try store.deleteBookmark(id: id) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Marks, citations and links (M2, typed markup)

/// A PDF a `pdf:` link can name: its id and the note that owns it.
struct PdfEntry: Equatable, Sendable {
    let documentId: Int64
    let noteId: Int64
}

/// A link's request to show a page of a PDF and flash a mark on it. `sequence` tells a new request from one the reader has taken.
struct PdfGoTo: Equatable {
    let documentId: Int64
    /// 0-based.
    let page: Int?
    let mark: String?
    let sequence: Int
}

extension AppModel {
    /// The editor of one PDF's marks, with its undo and redo (made by the reader once and kept as long as the PDF is open).
    func markEditor(documentId: Int64) -> PdfMarkEditor? { store.map { PdfMarkEditor(store: $0, documentId: documentId) } }

    /// The PDF with this id, as the reader opens it.
    func pdfSource(forDocument id: Int64) async -> PdfSource? {
        guard let library else { return nil }
        return try? await Self.perform {
            guard let document = try library.store.database.document(id: id) else { return nil }
            return PdfSource(document: document, url: try library.documentFile(id: document.id)?.url)
        }
    }

    /// The notes that belong with a PDF: its own first, then every note whose text links to it, each with the pages it cites.
    func citations(of document: StoredDocument) async -> [PdfCitation] {
        guard let database = store?.database else { return [] }
        let uuid = document.uuid, owner = document.noteId
        return (try? await Self.perform { PdfRefs.citations(among: try database.notesForPdf(uuid: uuid, ownerNoteId: owner), documentUuid: uuid, ownerNoteId: owner) }) ?? []
    }

    /// Whether the PDF a link names is on this iPad and open to read: its note is here, not in the Trash Can.
    func isPdfHere(uuid: String) -> Bool {
        guard let entry = pdfsByUuid[uuid] else { return false }
        return orderedNotes.contains { $0.id == entry.noteId }
    }

    // MARK: Following a link

    /// A `pdf:` link was opened in a note's preview. The PDF opens beside the note the link is in (the note stays where it is), at the page and mark
    /// the link names. A PDF that is not here (a backup without it, or one in the Trash Can) is said, and the quote the note carries stays.
    func followPdfLink(_ ref: PdfRef, from noteId: Int64?) {
        guard let entry = pdfsByUuid[ref.uuid], orderedNotes.contains(where: { $0.id == entry.noteId }) else {
            errorMessage = pdfsByUuid[ref.uuid] == nil ? "PDF not on this device. The quote in the note stays, but its link has nothing to open." : "That PDF is in the Trash Can. Restore it from there to open its links."
            return
        }
        if let noteId, noteId != entry.noteId {
            pdfBeside[noteId] = entry.documentId
        } else if noteId == nil || selection != entry.noteId {
            followNoteLink(entry.noteId)
        }
        pdfGoToCount += 1
        pdfGoTo = PdfGoTo(documentId: entry.documentId, page: ref.page.map { $0 - 1 }, mark: ref.mark, sequence: pdfGoToCount)
    }

    /// The reader has taken the request.
    func clearPdfGoTo(_ sequence: Int) {
        if pdfGoTo?.sequence == sequence { pdfGoTo = nil }
    }

    // MARK: The Notes tab

    /// Shows a note that cites a PDF beside the PDF, in the note's own place in the lists.
    func openNote(_ noteId: Int64, besidePdf documentId: Int64) {
        if let owned = pdfsByUuid.values.first(where: { $0.noteId == noteId }), owned.documentId == documentId {
            pdfBeside[noteId] = nil
        } else {
            pdfBeside[noteId] = documentId
        }
        followNoteLink(noteId)
    }

    /// **New note for this PDF**: a note in the owner's group whose first line is a link to the PDF, so it is one of the PDF's notes at once, shown
    /// beside the PDF.
    func newNote(forPdf document: StoredDocument, title: String) async {
        guard let store else { return }
        let owner = orderedNotes.first { $0.id == document.noteId }
        let name = "Notes on \(title)"
        do {
            let (group, notebook) = (owner?.groupId, owner?.notebookId)
            let created = try await Self.perform {
                let note = try store.createNote(title: name, groupId: group, notebookId: group == nil ? notebook : nil)
                guard let frontmatter = NoteFrontmatter.parse(note.content).frontmatter else { return note }
                let link = PdfRefs.link(uuid: document.uuid, title: title)
                return try store.saveNoteContent(id: note.id, content: NoteFrontmatter.render(frontmatter, body: link + "\n\n"))
            }
            await reload()
            pdfBeside[created.id] = document.id
            followNoteLink(created.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
