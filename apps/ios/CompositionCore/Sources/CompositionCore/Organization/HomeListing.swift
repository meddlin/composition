import Foundation
import GRDB

// What the home page lists: the Swift twin of the desktop's `homeListing.ts` (`recentNotes`, `pinnedItems`, `noteExcerpt`, `relativeTime`), cut down to what the
// iPad has. The desktop also lets the person pick a notebook to draw recent notes from, order them by when they were opened, pin whole notebooks and choose which
// sections show; none of that is kept in `settings.json` by the iPad (it keeps the favorites and nothing else of the home page), so these are the defaults.

public enum HomeListing {
    /// How many recent notes the home page shows (`RECENT_NOTE_LIMIT`).
    public static let recentLimit = 12

    /// The most recently edited notes, newest first, the later id first when two were edited at the same moment.
    public static func recent(_ notes: [NoteSummary], limit: Int = recentLimit) -> [NoteSummary] {
        Array(notes.sorted { ($0.updatedAt, $0.id) > ($1.updatedAt, $1.id) }.prefix(max(limit, 0)))
    }

    /// One thing pinned to the top of the home page.
    public enum Pinned: Equatable, Sendable {
        case group(NoteGroup)
        case note(NoteSummary)
    }

    /// What is pinned, in the order it was pinned. A pin whose group or note is gone is skipped.
    public static func pinned(favorites: [Favorite], groups: [NoteGroup], notes: [NoteSummary]) -> [Pinned] {
        let groupById = Dictionary(groups.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let noteById = Dictionary(notes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return favorites.compactMap { favorite in
            switch favorite.kind {
            case .group: groupById[favorite.id].map(Pinned.group)
            case .note: noteById[favorite.id].map(Pinned.note)
            }
        }
    }

    // MARK: Excerpt

    private static let fence = regex("```[\\s\\S]*?```")
    private static let image = regex("!\\[[^\\]]*\\]\\([^)]*\\)")
    private static let link = regex("\\[([^\\]]*)\\]\\([^)]*\\)")
    private static let blockMark = regex("^\\s{0,3}(#{1,6}|[-*+>]|\\d+\\.)\\s+", options: [.anchorsMatchLines])
    private static let emphasis = regex("[*_`~|]")
    private static let spaces = regex("\\s+")

    private static func regex(_ pattern: String, options: NSRegularExpression.Options = []) -> NSRegularExpression {
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static func replacing(_ expression: NSRegularExpression, in text: String, with template: String) -> String {
        expression.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: template)
    }

    /// A one-line plain-text preview of a note's body: no frontmatter, headings or markup.
    public static func excerpt(of content: String, max: Int = 110) -> String {
        var text = NoteFrontmatter.strip(content)
        text = replacing(fence, in: text, with: " ")
        text = replacing(image, in: text, with: " ")
        text = replacing(link, in: text, with: "$1")
        text = replacing(blockMark, in: text, with: "")
        text = replacing(emphasis, in: text, with: "")
        text = replacing(spaces, in: text, with: " ")
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let units = text as NSString
        guard units.length > max else { return text }
        return units.substring(to: max).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    // MARK: Relative time

    /// "just now", "5 min ago", "3 days ago". nil when `iso` is not a timestamp or the time is a month or more ago, which the screen writes as a date.
    public static func relativeTime(_ iso: String, now: Date = Date()) -> String? {
        guard let then = parse(iso) else { return nil }
        let minutes = Int((now.timeIntervalSince(then) / 60).rounded(.down))
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes) min ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours) hr ago" }
        let days = hours / 24
        if days < 31 { return "\(days) \(days == 1 ? "day" : "days") ago" }
        return nil
    }

    private static func parse(_ iso: String) -> Date? {
        if let date = try? Date(iso, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
        return try? Date(iso, strategy: Date.ISO8601FormatStyle())
    }
}

extension CompositionDatabase {
    /// A line of each note's text, by the note's id, for the cards of the home page: the first 4,000 characters are read, which is far more than a card shows.
    public func excerpts(of ids: [Int64]) throws -> [Int64: String] {
        guard !ids.isEmpty else { return [:] }
        return try pool.read { db in
            let marks = Array(repeating: "?", count: ids.count).joined(separator: ",")
            var result: [Int64: String] = [:]
            for row in try Row.fetchAll(db, sql: "SELECT id, substr(content, 1, 4000) AS head FROM notes WHERE id IN (\(marks))", arguments: StatementArguments(ids)) {
                result[row["id"]] = HomeListing.excerpt(of: row["head"])
            }
            return result
        }
    }
}
