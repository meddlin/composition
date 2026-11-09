import Foundation

/// Why a backup or restore was refused. The wording follows `ArchiveError` in the desktop's `backup.ts` and
/// `tarArchive.ts`, so a person sees the same sentence whichever app turned the file down.
public enum BackupError: Error, Equatable, LocalizedError {
    case cannotRead(String)
    /// The manifest is missing or wrong.
    case notABackup
    /// A bad gzip stream or a tar header that fails its checksum.
    case damaged
    case endsUnexpectedly
    case damagedHeader
    case containsNonFile(String)
    case duplicateEntry(String)
    case unknownFile(String)
    case newerFormat(Int)
    case jsonTooLarge(String)
    case jsonDamaged(String)
    case noDatabase
    case databaseUnopenable
    case databaseDamaged
    case shrank(String)
    case tooLarge(String)
    case restoreFailed(String)

    public var errorDescription: String? {
        switch self {
        case .cannotRead(let path): "Can't read \(path)."
        case .notABackup: "This is not a Composition backup."
        case .damaged: "This is not a Composition backup (or it is damaged)."
        case .endsUnexpectedly: "The backup ends unexpectedly."
        case .damagedHeader: "The backup has a damaged header."
        case .containsNonFile(let name):
            "The backup contains something other than files (\(name.isEmpty ? "an unnamed entry" : name)), so it was not restored."
        case .duplicateEntry(let name): "The backup lists \(name) twice."
        case .unknownFile(let name):
            "The backup contains a file Composition doesn't know (\(name)), so it was not restored."
        case .newerFormat(let version):
            "This backup was made by a newer version of Composition (backup format \(version)); update Composition to restore it."
        case .jsonTooLarge(let what): "The backup's \(what) is too large to be real."
        case .jsonDamaged(let what): "The backup's \(what) is damaged."
        case .noDatabase: "This backup has no database in it, so nothing was restored."
        case .databaseUnopenable: "The database inside this backup can't be opened, so nothing was restored."
        case .databaseDamaged:
            "The database inside this backup is damaged or isn't a Composition database, so nothing was restored."
        case .shrank(let path): "\(path) shrank while it was being backed up."
        case .tooLarge(let name): "\(name) is too large to put in a backup."
        case .restoreFailed(let message): "Could not restore: \(message). Your previous data was put back."
        }
    }
}
