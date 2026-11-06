import Foundation

// The search bar's `field: value` syntax, parsed the way `searchQuery.ts` does it, character for character. Pure, so it is
// safe to run on every keystroke. The rules are in docs/architecture/search.md; the conformance test runs every query in
// apps/ios/conformance/search-queries.json through the desktop's parser and compares.

/// A condition on a note: the parsed form of `tag:` and the date fields.
public enum SearchFilter: Equatable, Sendable {
    public enum DateField: String, Sendable {
        case created = "created_at_ts"
        case updated = "updated_at_ts"
    }

    case tag(String)
    /// `field >= seconds` (`atLeast`) or `field < seconds` (`before`), in whole seconds since 1970.
    case atLeast(DateField, Int64)
    case before(DateField, Int64)

    /// The clause in the form the desktop hands to Meilisearch, which is what the conformance test compares.
    var meilisearchClause: String {
        switch self {
        case .tag(let value):
            "tags = \"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
        case .atLeast(let field, let seconds): "\(field.rawValue) >= \(seconds)"
        case .before(let field, let seconds): "\(field.rawValue) < \(seconds)"
        }
    }
}

public struct ParsedSearchQuery: Equatable, Sendable {
    /// Free text to search for. May be empty.
    public var text: String
    /// Every one must hold.
    public var filters: [SearchFilter]
    /// Restricts which attributes `text` is matched against (`title`, `description`); nil means all.
    public var attributes: [String]?

    var meilisearchFilters: [String] { filters.map(\.meilisearchClause) }
}

public enum SearchQueryParser {
    private enum Field {
        case tag
        case text(String)
        case date(SearchFilter.DateField)
    }

    // Lowercased aliases. The frontmatter names (`createdAt`) and the CLI's (`createdOn`) both work.
    private static let fields: [String: Field] = [
        "tag": .tag, "tags": .tag,
        "title": .text("title"), "description": .text("description"),
        "created": .date(.created), "createdat": .date(.created), "createdon": .date(.created),
        "updated": .date(.updated), "updatedat": .date(.updated), "updatedon": .date(.updated),
    ]
    private static let keys = fields.keys.map { Array($0.unicodeScalars) }

    /// JavaScript's `\s` (and `trim`): not the same set as Swift's `isWhitespace`.
    static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    private static func trimmed(_ scalars: ArraySlice<Unicode.Scalar>) -> String {
        var slice = scalars
        while let first = slice.first, isSpace(first) { slice.removeFirst() }
        while let last = slice.last, isSpace(last) { slice.removeLast() }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: slice)
        return String(view)
    }

    /// A key at `index` followed by its colon, compared without regard to case. Returns the field and the index past the
    /// colon and any spaces after it (`^(key):\s*`).
    private static func key(in s: [Unicode.Scalar], at index: Int) -> (field: Field, next: Int)? {
        for key in keys {
            guard index + key.count < s.count, s[index + key.count] == ":" else { continue }
            let matches = (0..<key.count).allSatisfy { lowercased(s[index + $0]) == key[$0] }
            guard matches else { continue }
            var next = index + key.count + 1
            while next < s.count, isSpace(s[next]) { next += 1 }
            return (fields[String(String.UnicodeScalarView(key))]!, next)
        }
        return nil
    }

    /// ASCII lowercasing is enough: every key is ASCII, and a non-ASCII letter must not turn into one (`K`, the Kelvin sign).
    private static func lowercased(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
        (0x41...0x5A).contains(scalar.value) ? Unicode.Scalar(scalar.value + 0x20)! : scalar
    }

    /// `\s(?:key):` first occurring at or after `from`: the index of that space, or nil.
    private static func nextKey(in s: [Unicode.Scalar], from: Int) -> Int? {
        var i = from
        while i < s.count {
            if isSpace(s[i]), i + 1 < s.count {
                for key in keys where i + 1 + key.count < s.count && s[i + 1 + key.count] == ":" {
                    if (0..<key.count).allSatisfy({ lowercased(s[i + 1 + $0]) == key[$0] }) { return i }
                }
            }
            i += 1
        }
        return nil
    }

    /// The value after a `key:`. A leading double quote delimits it (`tags:"web development"`); otherwise it runs up to the
    /// next `key:` or the end of the input. Returns the value and the index just past it.
    private static func readValue(_ s: [Unicode.Scalar], from: Int) -> (value: String, end: Int) {
        if from < s.count, s[from] == "\"" {
            if let close = s[(from + 1)...].firstIndex(of: "\"") {
                return (trimmed(s[(from + 1)..<close]), close + 1)
            }
            return (trimmed(s[min(from + 1, s.count)...]), s.count)
        }
        let end = nextKey(in: s, from: from).map { $0 } ?? s.count
        return (trimmed(s[min(from, s.count)..<end]), end)
    }

    /// `[op]YYYY-MM-DD` over a unix-seconds field, or nil if it is not that or not a real date.
    private static func dateFilters(_ field: SearchFilter.DateField, _ raw: String) -> [SearchFilter]? {
        var rest = Array(raw.unicodeScalars)
        var op = "="
        for candidate in [">=", "<=", ">", "<", "="] where rest.starts(with: candidate.unicodeScalars) {
            op = candidate
            rest.removeFirst(candidate.unicodeScalars.count)
            break
        }
        guard rest.count == 10, rest[4] == "-", rest[7] == "-" else { return nil }
        func digits(_ range: Range<Int>) -> Int64? {
            var value: Int64 = 0
            for i in range {
                guard (0x30...0x39).contains(rest[i].value) else { return nil }
                value = value * 10 + Int64(rest[i].value - 0x30)
            }
            return value
        }
        guard var year = digits(0..<4), let month = digits(5..<7), let day = digits(8..<10) else { return nil }
        // JavaScript's Date.UTC reads the years 0 to 99 as 1900 to 1999.
        if year < 100 { year += 1900 }
        // Date.UTC rolls 2026-02-31 over to March; that is malformed here, not a date.
        guard (1...12).contains(month), day >= 1, day <= Timestamp.daysInMonth(year: year, month: month) else { return nil }
        let start = Timestamp.daysFromCivil(year: year, month: month, day: day) * 86_400
        let end = start + 86_400

        switch op {
        case ">": return [.atLeast(field, end)]
        case ">=": return [.atLeast(field, start)]
        case "<": return [.before(field, start)]
        case "<=": return [.before(field, end)]
        default: return [.atLeast(field, start), .before(field, end)]
        }
    }

    public static func parse(_ raw: String) -> ParsedSearchQuery {
        let s = Array(raw.unicodeScalars)
        var filters: [SearchFilter] = []
        var textAttributes: [String] = []
        var textValues: [String] = []
        var freeText: [String] = []

        var i = 0
        while i < s.count {
            if isSpace(s[i]) { i += 1; continue }
            // Every iteration starts at a word boundary: the start, or just past whitespace or a value.
            guard let found = key(in: s, at: i) else {
                var end = i
                while end < s.count, !isSpace(s[end]) { end += 1 }
                freeText.append(trimmed(s[i..<end]))
                i = end
                continue
            }
            let (value, end) = readValue(s, from: found.next)
            let consumed = trimmed(s[i..<end])
            i = end

            // A half-typed `tags:` has no value yet: ignore it rather than searching for the word "tags:".
            if value.isEmpty { continue }

            switch found.field {
            case .tag:
                filters.append(.tag(value))
            case .text(let attribute):
                if !textAttributes.contains(attribute) { textAttributes.append(attribute) }
                textValues.append(value)
            case .date(let field):
                // Malformed date: keep it as literal text, so a half-typed date finds nothing instead of silently dropping the constraint.
                if let clauses = dateFilters(field, value) { filters.append(contentsOf: clauses) } else { freeText.append(consumed) }
            }
        }

        let text = (textValues + freeText)
            .map { trimmed(ArraySlice($0.unicodeScalars)) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return ParsedSearchQuery(text: collapseSpaces(text), filters: filters, attributes: textAttributes.isEmpty ? nil : textAttributes)
    }

    /// `.replace(/\s+/g, " ")`
    private static func collapseSpaces(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        var previousWasSpace = false
        for scalar in text.unicodeScalars {
            if isSpace(scalar) {
                if !previousWasSpace { out.append(" ") }
                previousWasSpace = true
            } else {
                out.append(scalar)
                previousWasSpace = false
            }
        }
        return String(out)
    }
}
