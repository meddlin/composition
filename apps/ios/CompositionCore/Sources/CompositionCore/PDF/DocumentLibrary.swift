import CryptoKit
import Foundation
import GRDB

// The PDFs' files, and the operations that join a file to its row: a port of `documents.ts` and of the PDF half of `service.ts`
// (`importPdf`, `permanentlyDeleteNote`, `purgeExpiredTrash`). A PDF is a row (DocumentsStore.swift) and a plain file in
// `<application data>/documents/` (`DataLocation.documentsURL`), copied in once and never written again.

/// What copying a PDF into the library came to. `refused` is for something the person can fix (not a PDF, too large, the note already has
/// one); the message is the desktop's and is safe to show. `duplicate` lists the PDFs with exactly these bytes and nothing was copied: the
/// caller offers to open one, or imports again with `allowDuplicate` for a separate copy.
public enum ImportDocumentResult: Equatable, Sendable {
    case added(StoredDocument)
    case duplicate([StoredDocument])
    case refused(String)
}

/// A PDF the library already holds, and the title of the note that owns it (live or in the Trash Can).
public struct ExistingPdf: Equatable, Sendable {
    public let document: StoredDocument
    public let noteTitle: String
}

/// What `importPdf` came to: the note and PDF made, or the PDFs that already hold these bytes, or a reason to show.
public enum ImportPdfOutcome: Equatable, Sendable {
    case added(note: NoteDetail, document: StoredDocument)
    case duplicate([ExistingPdf])
    case refused(String)
}

public struct DocumentLibrary: Sendable {
    public let store: NoteStore
    public let location: DataLocation

    public init(store: NoteStore, location: DataLocation) {
        (self.store, self.location) = (store, location)
    }

    private var database: CompositionDatabase { store.database }

    /// Bytes read and written at a time, so a book of hundreds of megabytes is never held in memory.
    static let chunkSize = 1 << 20

    // MARK: Import

    /// Copies a PDF into the documents folder and gives it to the note. `pageCount` is what the caller counted (the reader's job, so 0 is allowed
    /// and means not counted yet). The copy goes to a hidden temporary name and is renamed when it is whole, so a file is never visible half
    /// written, and the hash is taken from the bytes as they are copied, not from a second read. A file picked in Files is read inside the
    /// caller's `startAccessingSecurityScopedResource`.
    public func importDocument(noteId: Int64, from source: URL, pageCount: Int = 0, allowDuplicate: Bool = false, now: Date = Date()) throws -> ImportDocumentResult {
        let fileManager = FileManager.default
        let fileName = DocumentNames.displayName(source.path)
        let file = source.resolvingSymlinksInPath()
        let unreadable = ImportDocumentResult.refused("\(fileName): could not be read.")

        guard let attributes = try? fileManager.attributesOfItem(atPath: file.path) else { return unreadable }
        guard attributes[.type] as? FileAttributeType == .typeRegular else { return .refused("\(fileName): only files can be imported, not folders.") }
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        guard size <= DocumentNames.maxBytes else { return .refused("\(fileName): files can be at most \(DocumentNames.formatBytes(DocumentNames.maxBytes)).") }

        if try database.documentForNote(noteId) != nil { return .refused(DocumentError.hasDocument.errorDescription ?? "") }

        guard let input = try? FileHandle(forReadingFrom: file) else { return unreadable }
        defer { try? input.close() }
        let head = (try? input.read(upToCount: Int(min(size, Int64(DocumentNames.headerWindow))))) ?? Data()
        guard DocumentNames.looksLikePdf(Array(head)) else { return .refused("\(fileName): this doesn't look like a PDF.") }
        try input.seek(toOffset: 0)

        let directory = location.documentsURL
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let storedName = DocumentNames.storedName(prefix: Self.randomPrefix(), fileName: fileName)
        let target = directory.appendingPathComponent(storedName)
        let temporary = directory.appendingPathComponent(".\(storedName).tmp")
        guard fileManager.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw CocoaError(.fileWriteUnknown) }
        // Whatever happens next, the hidden copy does not stay: after a successful rename there is nothing at this name to remove.
        defer { try? fileManager.removeItem(at: temporary) }

        let copied = try Self.copyHashing(input, to: temporary)
        if !allowDuplicate {
            let existing = try database.documents(sha256: copied.sha256)
            if !existing.isEmpty { return .duplicate(existing) }
        }
        try fileManager.moveItem(at: temporary, to: target)
        do {
            return .added(try database.addDocument(noteId: noteId, fileName: fileName, storedName: storedName, sha256: copied.sha256, size: copied.size, pageCount: pageCount, now: now))
        } catch let error as DocumentError {
            try? fileManager.removeItem(at: target)
            return .refused(error.errorDescription ?? "")
        } catch {
            try? fileManager.removeItem(at: target)
            throw error
        }
    }

    /// Makes a note for the PDF at `source` (in `groupId`, or `notebookId`) and imports the file into it. Nothing is left behind when the file is
    /// refused, or is one the library already has and the caller did not ask for a separate copy: the note was never shown, so it goes for
    /// good, not to the Trash Can.
    public func importPdf(from source: URL, groupId: Int64? = nil, notebookId: Int64? = nil, allowDuplicate: Bool = false, now: Date = Date()) throws -> ImportPdfOutcome {
        let note = try store.createNote(title: DocumentNames.titleFromFileName(source.path), groupId: groupId, notebookId: notebookId, now: now)
        let result: ImportDocumentResult
        do {
            result = try importDocument(noteId: note.id, from: source, allowDuplicate: allowDuplicate, now: now)
        } catch {
            try? discard(note.id)
            throw error
        }
        switch result {
        case .added(let document):
            return .added(note: note, document: document)
        case .refused(let message):
            try discard(note.id)
            return .refused(message)
        case .duplicate(let existing):
            try discard(note.id)
            return .duplicate(try existing.map { ExistingPdf(document: $0, noteTitle: try ownerTitle($0.noteId)) })
        }
    }

    // MARK: Files

    /// Where a PDF's bytes are, or nil when the row is gone or the file has been deleted behind the app's back. The path is built from the stored
    /// name, and only a name of the shape the app makes is used, so a damaged or hostile row cannot point outside the folder.
    public func documentFile(id: Int64) throws -> (url: URL, document: StoredDocument)? {
        guard let document = try database.document(id: id), BackupNames.isStoredName(document.storedName) else { return nil }
        let url = location.documentsURL.appendingPathComponent(document.storedName)
        return FileManager.default.fileExists(atPath: url.path) ? (url, document) : nil
    }

    /// Deletes a PDF, its marks, its bookmarks and its stored file. False when there was no such PDF.
    @discardableResult
    public func removeDocument(id: Int64) throws -> Bool {
        guard let document = try database.deleteDocument(id: id) else { return false }
        removeFiles([document])
        return true
    }

    /// Deletes the PDFs (rows, marks, bookmarks and stored files) of notes that no longer exist anywhere, trashed or not. Run after a note is
    /// permanently deleted, by hand or because it outlived the Trash Can's retention window; anything missed is found by the next sweep.
    public func removeOrphans() throws {
        removeFiles(try database.deleteOrphanedDocuments())
    }

    /// `permanentlyDeleteNote`: the note leaves the Trash Can for good, and so does its PDF.
    public func permanentlyDeleteNote(id: Int64) throws {
        try database.purgeNote(id: id)
        try removeOrphans()
    }

    /// `purgeExpiredTrash`: clears what has been in the Trash Can past its retention window, and the PDFs of any notes among it.
    public func purgeExpiredTrash(now: Date = Date()) throws {
        try database.purgeExpired(now: now)
        try removeOrphans()
    }

    // MARK: Pieces

    /// A file that is already gone is not an error, and neither is one that cannot be removed: the row is what matters, and a stray file is
    /// left for the person to find in a backup's file list, not a reason to fail a delete.
    private func removeFiles(_ documents: [StoredDocument]) {
        for document in documents where BackupNames.isStoredName(document.storedName) {
            try? FileManager.default.removeItem(at: location.documentsURL.appendingPathComponent(document.storedName))
        }
    }

    private func discard(_ noteId: Int64) throws {
        try store.deleteNote(id: noteId)
        try database.purgeNote(id: noteId)
    }

    /// The title of a note that owns a PDF, whether the note is live or in the Trash Can.
    private func ownerTitle(_ noteId: Int64) throws -> String {
        if let note = try database.note(id: noteId) { return note.title }
        let trashed = try database.pool.read { try String.fetchOne($0, sql: "SELECT title FROM trashed_notes WHERE id = ?", arguments: [noteId]) }
        return trashed ?? "Untitled"
    }

    /// Six random bytes as twelve hex digits: what keeps two PDFs of the same name apart.
    private static func randomPrefix() -> String {
        var generator = SystemRandomNumberGenerator()
        return (0..<6).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max, using: &generator)) }.joined()
    }

    private static func copyHashing(_ input: FileHandle, to destination: URL) throws -> (sha256: String, size: Int64) {
        let output = try FileHandle(forWritingTo: destination)
        do {
            var hasher = SHA256()
            var size: Int64 = 0
            while let chunk = try autoreleasepool(invoking: { try input.read(upToCount: chunkSize) }), !chunk.isEmpty {
                hasher.update(data: chunk)
                try output.write(contentsOf: chunk)
                size += Int64(chunk.count)
            }
            try output.close()
            return (hasher.finalize().map { String(format: "%02x", $0) }.joined(), size)
        } catch {
            try? output.close()
            throw error
        }
    }
}
