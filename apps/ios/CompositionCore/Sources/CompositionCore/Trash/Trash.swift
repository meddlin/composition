import Foundation

// What the Trash Can holds and how long it holds it: the Swift twin of `trash.ts`.

public enum TrashRetention {
    /// Items older than this are permanently deleted.
    public static let days = 60

    private static var milliseconds: Int64 { Int64(days) * Timestamp.millisecondsPerDay }

    /// When the Trash Can will delete an item deleted at `deletedAt` for good. Nil only if `deletedAt` is not a
    /// `toISOString` timestamp, which nothing in the app writes.
    public static func expiry(of deletedAt: String) -> String? {
        Timestamp.milliseconds(from: deletedAt).map { Timestamp.string(milliseconds: $0 + milliseconds) }
    }

    /// The `deleted_at` before which an item has outlived the retention window.
    public static func cutoff(now: Date = Date()) -> String {
        Timestamp.string(milliseconds: Timestamp.milliseconds(of: now) - milliseconds)
    }

    /// Whole days until `expiresAt`, rounded up so "0" never shows while it still exists, and never negative.
    public static func daysLeft(expiresAt: String, now: Date = Date()) -> Int {
        guard let expires = Timestamp.milliseconds(from: expiresAt) else { return 0 }
        let days = (Double(expires - Timestamp.milliseconds(of: now)) / Double(Timestamp.millisecondsPerDay)).rounded(.up)
        return max(0, Int(days))
    }
}

public struct TrashedNote: Equatable, Sendable {
    public let id: Int64
    public let title: String
    public let deletedAt: String
    /// When the Trash Can will delete it for good.
    public let expiresAt: String?
}

public struct TrashedGroup: Equatable, Sendable {
    public let id: Int64
    public let name: String
    public let deletedAt: String
    public let expiresAt: String?
}

/// Everything in the Trash Can, most recently deleted first.
public struct Trash: Equatable, Sendable {
    public let notes: [TrashedNote]
    public let groups: [TrashedGroup]
}

/// `restoredToTopLevel`: the item's original group or parent is gone, so it came back at the top.
public struct RestoreResult: Equatable, Sendable {
    public let restoredToTopLevel: Bool
}

public enum TrashError: Error, Equatable, LocalizedError {
    /// A group with sub-groups or notes cannot be trashed, so no trashed item ever hangs off another one.
    case groupNotEmpty(Int64)
    case noNotebooks

    public var errorDescription: String? {
        switch self {
        case .groupNotEmpty(let id): "Group \(id) still has sub-groups or notes; empty it before deleting."
        case .noNotebooks: "There are no notebooks."
        }
    }
}
