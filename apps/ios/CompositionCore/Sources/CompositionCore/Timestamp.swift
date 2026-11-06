import Foundation

enum Timestamp {
    /// The format the desktop writes: `new Date().toISOString()`, e.g. `2026-11-05T20:53:20.123Z` (UTC, milliseconds).
    static func now(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
