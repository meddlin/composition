import Foundation

// How far a typed word may be from a word in the notes and still count as a match: Meilisearch's rules (measured against
// version 1.53.1 for spike S2, not read from its documentation). The budget depends on the typed word's length, a swapped
// pair of neighbouring letters is one edit, and the word being typed (the last one) also matches as the start of a longer
// word. A wrong, missing or extra *first letter* costs two edits, not one, so only a word long enough to be allowed two
// (9 letters) can have one: `xubernetes` finds Kubernetes and `ocker` does not find Docker.

enum Typo {
    /// Edits allowed in a word of `length` letters: none up to 4, one for 5 to 8, two from 9.
    static func budget(forLength length: Int) -> Int { length >= 9 ? 2 : length >= 5 ? 1 : 0 }

    /// How forgiving a search is of mistakes. The first is Meilisearch's, which the desktop uses; the others are this app's own.
    struct Rules: Equatable, Sendable {
        /// What a wrong, missing or extra *first letter* costs, in edits. Meilisearch counts it as two.
        var firstLetterCost: Int
        /// Whether a word of 3 or 4 letters is allowed one mistake (Meilisearch allows none up to 4).
        var shortWordsGetOne: Bool

        static let meilisearch = Rules(firstLetterCost: 2, shortWordsGetOne: false)
        /// A first-letter mistake costs one edit, like any other.
        static let forgiving = Rules(firstLetterCost: 1, shortWordsGetOne: false)
        /// What `forgiving` falls back to when a search finds nothing: short words may have a mistake too.
        static let forgivingFallback = Rules(firstLetterCost: 1, shortWordsGetOne: true)

        /// Edits allowed in a word of `length` letters (counted in the word as typed).
        func budget(forLength length: Int) -> Int {
            shortWordsGetOne && (3...4).contains(length) ? 1 : Typo.budget(forLength: length)
        }
    }

    /// Words as lowercase, diacritic-free text, which is how the index stores them (FTS5 `unicode61 remove_diacritics 2`).
    static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    /// The runs of letters and digits in `text`, folded: where the index splits words too.
    static func words(in text: String) -> [String] {
        var words: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in fold(text).unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                current.append(scalar)
            } else if !current.isEmpty {
                words.append(String(current))
                current = String.UnicodeScalarView()
            }
        }
        if !current.isEmpty { words.append(String(current)) }
        return words
    }

    /// The edit distance from `word` to `term`, where swapping two neighbouring letters counts once, or nil if it is over `limit`.
    static func distance(_ word: [UInt32], to term: [UInt32], limit: Int, firstLetterCost: Int = 2) -> Int? {
        guard abs(word.count - term.count) <= limit else { return nil }
        return search(word, term, limit: limit, prefix: false, first: firstLetterCost)?.distance
    }

    /// The smallest edit distance from `word` to any start of `term` (its first `n` letters, for any `n`), with the shortest
    /// such start, or nil if it is over `limit`. This is how the word being typed matches: `kubernet` is 0 from `kubernetes`.
    static func prefixDistance(_ word: [UInt32], to term: [UInt32], limit: Int, firstLetterCost: Int = 2) -> (distance: Int, prefixLength: Int)? {
        guard term.count + limit >= word.count else { return nil }
        return search(word, term, limit: limit, prefix: true, first: firstLetterCost)
    }

    /// Optimal string alignment distance over three rolling rows, giving up once no cell can come back under `limit`.
    /// Any edit at the first letter of `a` costs `first` (2 in Meilisearch, 1 in a forgiving search): that is the `first` on
    /// the first row and column, on a substituted first letter, and on a swapped first pair.
    private static func search(_ a: [UInt32], _ b: [UInt32], limit: Int, prefix: Bool, first: Int) -> (distance: Int, prefixLength: Int)? {
        let m = a.count, n = b.count
        var older = [Int](repeating: 0, count: n + 1)
        var previous = (0...n).map { $0 == 0 ? 0 : $0 - 1 + first }
        var current = [Int](repeating: 0, count: n + 1)
        var previousMinimum = 0

        if m == 0 { return prefix ? (0, 0) : (n <= limit ? (n, n) : nil) }
        for i in 1...m {
            current[0] = i - 1 + first
            var minimum = i - 1 + first
            for j in stride(from: 1, through: n, by: 1) {
                let substitution = a[i - 1] == b[j - 1] ? 0 : (i == 1 ? first : 1)
                var best = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitution)
                if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] { best = min(best, older[j - 2] + (i == 2 ? first : 1)) }
                current[j] = best
                if best < minimum { minimum = best }
            }
            // Cells only ever grow from the rows above, so once two rows in a row are all over the limit, it is over.
            if minimum > limit && previousMinimum > limit { return nil }
            previousMinimum = minimum
            swap(&older, &previous)
            swap(&previous, &current)
        }
        if !prefix { return previous[n] <= limit ? (previous[n], n) : nil }
        var best = (distance: Int.max, prefixLength: 0)
        for j in 0...n where previous[j] < best.distance { best = (previous[j], j) }
        return best.distance <= limit ? best : nil
    }
}
