import Foundation
import Testing

@testable import CompositionCore

/// How typo search grows with the number of different words in the notes, which is what its cost depends on (it looks
/// each typed word up against all of them). The generated notes are made of random pronounceable words, so the vocabulary
/// is as large and as flat as a real one can be: a harder case than real notes, which repeat their words a lot.
///
/// Release builds are what ships, and run this about 20 times faster than debug builds do, so the 200 ms target is checked
/// for every size in a release build (`swift test -c release -Xswiftc -enable-testing --filter SearchScaleTests`) and,
/// in a debug build, only up to 2,000 different words (the margin shrinks with size, and a busy machine would make a check near the line flaky). The numbers are printed either way.
@Suite("Search at scale")
struct SearchScaleTests {
    /// A small deterministic random number generator, so a run is repeatable.
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

    private static let consonants = Array("bcdfghjklmnprstvwz"), vowels = Array("aeiou")

    private func makeWords(_ count: Int, _ random: inout Seeded) -> [String] {
        var words = Set<String>()
        while words.count < count {
            let syllables = Int.random(in: 2...5, using: &random)
            words.insert((0..<syllables).map { _ in
                String([Self.consonants.randomElement(using: &random)!, Self.vowels.randomElement(using: &random)!])
            }.joined() + (Bool.random(using: &random) ? String(Self.consonants.randomElement(using: &random)!) : ""))
        }
        return Array(words).sorted()
    }

    /// One edit in the middle of the word (the first letter costs two, which a plain one-edit test should not hit).
    private func misspelt(_ word: String, _ random: inout Seeded) -> String {
        var letters = Array(word)
        let i = Int.random(in: 1..<letters.count, using: &random)
        letters[i] = letters[i] == "x" ? "q" : "x"
        return String(letters)
    }

    @Test("answers in well under 200 ms as the number of different words grows", arguments: [2_000, 20_000, 100_000])
    func vocabularyGrowth(distinctWords: Int) throws {
        #if DEBUG
        // 100,000 words take about 40 seconds in a debug build and are not checked there: run it in release.
        guard distinctWords <= 20_000 else { return }
        #endif
        var random = Seeded(state: UInt64(distinctWords))
        let pool = makeWords(distinctWords, &random)
        try withScratch { scratch in
            let index = try SearchIndex.open(at: scratch.directory.appendingPathComponent("search.db"))
            defer { try? index.close() }

            // 1,000 notes of 120 words each, drawn so that every word of the pool appears somewhere.
            var notes: [IndexedNote] = []
            var cursor = 0
            for id in 1...1000 {
                var words: [String] = []
                for _ in 0..<120 { words.append(pool[cursor % pool.count]); cursor += 1 + Int.random(in: 0...(max(1, pool.count / 400)), using: &random) }
                let title = (0..<3).map { _ in pool.randomElement(using: &random)! }.joined(separator: " ")
                notes.append(IndexedNote(id: Int64(id), title: title, description: "", content: words.joined(separator: " "), tags: "",
                                         createdAt: "2026-01-01T00:00:00.000Z", updatedAt: Timestamp.string(milliseconds: 1_767_225_600_000 + Int64(id) * 1000)))
            }
            let built = Date()
            try index.upsert(notes)
            let buildMs = Date().timeIntervalSince(built) * 1000

            var queries: [String] = []
            let longWords = pool.filter { $0.count >= 5 }
            for _ in 0..<60 {
                let word = longWords.randomElement(using: &random)!
                queries += [word, misspelt(word, &random), String(word.prefix(4)), word + " " + pool.randomElement(using: &random)!, misspelt(word, &random) + " " + String(pool.randomElement(using: &random)!.prefix(3))]
            }
            let first = Date()
            _ = try index.search(queries[0])
            let firstMs = Date().timeIntervalSince(first) * 1000

            var timings: [(String, Double)] = []
            for query in queries {
                let start = DispatchTime.now()
                _ = try index.search(query)
                timings.append((query, Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e6))
            }
            let sorted = timings.map(\.1).sorted()
            let slowest = timings.max { $0.1 < $1.1 }!
            let mode: String
            #if DEBUG
            mode = "debug build"
            #else
            mode = "release build"
            #endif
            print(String(format: "S2 scale (%@): %7d different words, 1,000 notes: indexed in %6.0f ms; first search %6.1f ms; %d searches: median %5.1f ms, 95th %5.1f ms, slowest %6.1f ms (%@)",
                         mode, distinctWords, buildMs, firstMs, timings.count, sorted[sorted.count / 2], sorted[sorted.count * 95 / 100], slowest.1, String(reflecting: slowest.0)))
            #if DEBUG
            let checked = distinctWords <= 2_000
            #else
            let checked = true
            #endif
            if checked {
                #expect(slowest.1 < 200, "every query under 200 ms with \(distinctWords) different words (slowest: \(String(reflecting: slowest.0)))")
            } else {
                print("     (not checked in a debug build)")
            }
        }
    }
}
