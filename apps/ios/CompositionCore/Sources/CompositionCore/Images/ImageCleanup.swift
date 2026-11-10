import Foundation
import GRDB

// Cleaning up stored images (the iPad's Images page). The desktop's Images screen only browses: it lists every image, filters by name or by "not used",
// and shows which notes point at each. It never deletes (images outlive the text that mentions them, so one can be found and used again). Deleting is the
// iPad's addition, so it is narrower than the browsing: only an image **nothing refers to** can go, and "nothing" includes the notes in the Trash Can, whose
// text the desktop's "not used" does not read. Without that a note restored from the Trash Can would come back with a missing picture.

extension CompositionDatabase {
    /// The text of every note in the Trash Can: the notes that can still come back, and so still point at images.
    public func trashedNoteTexts() throws -> [String] {
        try pool.read { db in try String.fetchAll(db, sql: "SELECT content FROM trashed_notes ORDER BY id") }
    }
}

extension StoredImages {
    /// The images no live note refers to (the desktop's "Not used" filter), in the order given.
    public static func unused(in images: [StoredImageInfo]) -> [StoredImageInfo] {
        images.filter { $0.usedIn.isEmpty }
    }

    /// The total size of `images`, in bytes.
    public static func totalSize(of images: [StoredImageInfo]) -> Int {
        images.reduce(0) { $0 + $1.size }
    }

    public enum RemoveOutcome: Equatable, Sendable {
        case removed
        /// A note's text still points at it; nothing was deleted.
        case usedByNotes(Int)
        /// A note in the Trash Can points at it; nothing was deleted, because restoring that note would bring it back without its picture.
        case usedInTrash
        /// There is no stored image of that name (or the name is not a stored image's).
        case notFound
        case failed(String)
    }

    /// Deletes a stored image, if nothing refers to it **now**: `liveNotes` and `trashedTexts` are read again by the caller just before, so a screen that
    /// was open while a note was edited cannot delete a picture that was put back in the meantime. The name must be a plain image file name, so it can
    /// never leave the folder.
    public static func remove(named name: String, in location: DataLocation, liveNotes: [NoteText], trashedTexts: [String]) -> RemoveOutcome {
        guard isImageName(name) else { return .notFound }
        let using = liveNotes.filter { findRefs(in: $0.content).contains(name) }.count
        if using > 0 { return .usedByNotes(using) }
        if trashedTexts.contains(where: { findRefs(in: $0).contains(name) }) { return .usedInTrash }
        let url = location.imagesURL.appendingPathComponent(name)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else { return .notFound }
        do {
            try FileManager.default.removeItem(at: url)
            return .removed
        } catch {
            return .failed("Could not delete the image: \(error.localizedDescription)")
        }
    }
}
