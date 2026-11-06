import Foundation
import Testing

@testable import CompositionCore

#if os(macOS)
/// Which mistakes does typo search forgive, on real English words? For each word length from 3 to 12 and each kind of mistake,
/// the share of misspelt queries that still find the note the word is in. The words come from the macOS dictionary (about
/// 236,000 of them), so this runs on a Mac only; the notes are made of them. A release build uses a vocabulary of 12,000 words
/// and 40 words per length (about 6 seconds); a debug build, which is that much slower, 3,000 and 8.
///
/// It runs the same notes and the same misspelt queries through both tolerances (`SearchTolerance`), and prints a table for each,
/// so what a person sees as "no typo tolerance" can be read off them. What it pins is the rules in `TypoMatching.swift`: those of
/// Meilisearch (none up to 4 letters, one mistake for 5 to 8, two from 9, a swapped pair is one mistake, a mistake at the first
/// letter costs two) and the forgiving ones (the same, but a first-letter mistake costs one). A cell that the rules forgive must be
/// 100%. The forgiving mode's extra pass for short words, which runs only when a search finds nothing, is reported and not pinned:
/// whether it runs depends on what else the typed letters happen to match.
@Suite("Search forgives the mistakes it should", .serialized)
struct SearchTypoCoverageTests {
    private struct Seeded: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
    }

    enum Mistake: String, CaseIterable {
        case middleSubstituted = "middle: wrong letter"
        case middleDeleted = "middle: missing letter"
        case middleInserted = "middle: extra letter"
        case middleSwapped = "middle: two swapped"
        case firstWrong = "first letter wrong"
        case firstMissing = "first letter missing"
        case lastWrong = "last letter wrong"
        case lastMissing = "last letter missing"
        case twoInMiddle = "two mistakes, middle"

        /// How many edits the rules count it as.
        func cost(_ rules: Typo.Rules) -> Int {
            switch self {
            case .firstWrong, .firstMissing: rules.firstLetterCost
            case .twoInMiddle: 2
            default: 1
            }
        }
    }

    private static func misspell(_ word: String, _ mistake: Mistake, _ random: inout Seeded) -> String? {
        var c = Array(word)
        let n = c.count
        let letters = Array("abcdefghijklmnopqrstuvwxyz")
        func other(than letter: Character) -> Character { letters.filter { $0 != letter }.randomElement(using: &random)! }
        switch mistake {
        case .middleSubstituted:
            guard n >= 3 else { return nil }
            let i = Int.random(in: 1..<(n - 1), using: &random); c[i] = other(than: c[i])
        case .middleDeleted:
            guard n >= 3 else { return nil }
            c.remove(at: Int.random(in: 1..<(n - 1), using: &random))
        case .middleInserted:
            guard n >= 2 else { return nil }
            c.insert(letters.randomElement(using: &random)!, at: Int.random(in: 1..<n, using: &random))
        case .middleSwapped:
            guard n >= 4 else { return nil }
            let pairs = (1..<(n - 2)).filter { c[$0] != c[$0 + 1] }
            guard let i = pairs.randomElement(using: &random) else { return nil }
            c.swapAt(i, i + 1)
        case .firstWrong: c[0] = other(than: c[0])
        case .firstMissing: guard n >= 2 else { return nil }; c.removeFirst()
        case .lastWrong: c[n - 1] = other(than: c[n - 1])
        case .lastMissing: guard n >= 2 else { return nil }; c.removeLast()
        case .twoInMiddle:
            guard n >= 5 else { return nil }
            let positions = Array(1..<(n - 1)).shuffled(using: &random).prefix(2)
            for i in positions { c[i] = other(than: c[i]) }
        }
        let result = String(c)
        return result == word ? nil : result
    }

    /// Whether the rules forgive this mistake. The budget comes from the length of the word as *typed*, not of the word meant:
    /// a 5-letter word with a letter missing is typed as 4 letters, which are allowed none.
    private static func forgiven(_ mistake: Mistake, typed: String, rules: Typo.Rules) -> Bool {
        switch mistake {
        // The word being typed is also a start of a longer word, so a missing last letter leaves a start of the word and no
        // mistake to forgive. A start of fewer than 5 letters matches too many words for the note to be among the first 50.
        case .lastMissing: return typed.count >= 5
        default: return rules.budget(forLength: typed.count) >= mistake.cost(rules)
        }
    }

    @Test("by word length and kind of mistake, on real English words")
    func coverage() throws {
        let all = try String(contentsOfFile: "/usr/share/dict/words", encoding: .utf8).split(separator: "\n").map(String.init)
            .filter { $0.count >= 3 && $0.count <= 12 && $0.allSatisfy { ("a"..."z").contains($0) } }
        #if DEBUG
        let (vocabularySize, wordsPerLength, otherNotes) = (3_000, 8, 300)
        #else
        let (vocabularySize, wordsPerLength, otherNotes) = (12_000, 40, 1_100)
        #endif
        var random = Seeded(state: 20_261_106)
        let pool = Array(all.shuffled(using: &random).prefix(vocabularySize))

        // Words of each length, each the title of a note of its own.
        var targets: [Int: [String]] = [:]
        for length in 3...12 { targets[length] = Array(all.filter { $0.count == length }.shuffled(using: &random).prefix(wordsPerLength)) }

        // Notes and queries are made once, so both tolerances answer the same questions.
        var notes: [IndexedNote] = []
        var noteOf: [String: Int64] = [:]
        func add(title: String, target: String? = nil) {
            let id = Int64(notes.count + 1)
            let content = (0..<30).map { _ in pool.randomElement(using: &random)! }.joined(separator: " ")
            notes.append(IndexedNote(id: id, title: title, description: "", content: content, tags: "", createdAt: "2026-01-01T00:00:00.000Z",
                                     updatedAt: Timestamp.string(milliseconds: 1_767_225_600_000 + id * 60_000)))
            if let target { noteOf[target] = id }
        }
        for length in 3...12 { for word in targets[length]! { add(title: "\(word) \(pool.randomElement(using: &random)!)", target: word) } }
        for _ in 0..<otherNotes { add(title: (0..<3).map { _ in pool.randomElement(using: &random)! }.joined(separator: " ")) }

        struct Query { let length: Int; let mistake: Mistake; let word: String; let typed: String; let id: Int64 }
        var queries: [Query] = []
        for length in 3...12 {
            for mistake in Mistake.allCases {
                for word in targets[length]! {
                    if let typed = Self.misspell(word, mistake, &random), let id = noteOf[word] {
                        queries.append(Query(length: length, mistake: mistake, word: word, typed: typed, id: id))
                    }
                }
            }
        }

        try withScratch { scratch in
            for (name, tolerance, rules) in [("Meilisearch's rules", SearchTolerance.matchesMeilisearch, Typo.Rules.meilisearch), ("forgiving", .forgiving, .forgiving)] {
                let index = try SearchIndex.open(at: scratch.directory.appendingPathComponent("search-\(name.prefix(4)).db"), tolerance: tolerance)
                defer { try? index.close() }
                try index.upsert(notes)

                // Row per length, a cell per mistake: found / tried.
                var table: [Int: [Mistake: (found: Int, tried: Int)]] = [:]
                var shouldWorkButDidNot: [String] = []
                for query in queries {
                    var cell = table[query.length]?[query.mistake] ?? (found: 0, tried: 0)
                    cell.tried += 1
                    if try index.search(query.typed).contains(query.id) { cell.found += 1 }
                    else if Self.forgiven(query.mistake, typed: query.typed, rules: rules) {
                        shouldWorkButDidNot.append("\(query.typed) (for \(query.word), \(query.mistake.rawValue))")
                    }
                    table[query.length, default: [:]][query.mistake] = cell
                }

                // The table: a person's view of what is forgiven.
                let short = ["wrong", "missing", "extra", "swapped", "1st wrong", "1st missing", "last wrong", "last missing", "two wrong"]
                print("\nS2 typo coverage, \(name), on real English words (the note was found / the queries tried)")
                print("  letters  " + short.map { $0.padding(toLength: 11, withPad: " ", startingAt: 0) }.joined())
                for length in 3...12 {
                    let cells = Mistake.allCases.map { mistake -> String in
                        let c = table[length]?[mistake] ?? (found: 0, tried: 0)
                        return (c.tried == 0 ? "-" : "\(Int((100 * Double(c.found) / Double(c.tried)).rounded()))%").padding(toLength: 11, withPad: " ", startingAt: 0)
                    }
                    print("  \(String(length).padding(toLength: 7, withPad: " ", startingAt: 0))  " + cells.joined())
                }
                if !shouldWorkButDidNot.isEmpty { print("\n  forgiven by the rules but not found (\(shouldWorkButDidNot.count)): \(shouldWorkButDidNot.prefix(25))") }

                #expect(shouldWorkButDidNot.isEmpty, "\(name): every mistake the rules forgive finds the note: \(shouldWorkButDidNot.prefix(10))")
            }
            print("  (columns 1 to 4 are mistakes in the middle of the word; 'wrong' and 'extra' and so on are one mistake each)")
        }
    }
}
#endif
