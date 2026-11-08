import Foundation

enum Stamp {
    private static let style = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

    /// The date in a timestamp the desktop wrote (`2026-11-05T20:53:20.123Z`).
    static func date(_ iso: String) -> Date? { try? Date(iso, strategy: style) }
}

extension String {
    /// `a, b` as `#a #b`.
    var tagLine: String {
        split(separator: ",").map { "#" + $0.trimmingCharacters(in: .whitespaces) }.filter { $0 != "#" }.joined(separator: " ")
    }
}
