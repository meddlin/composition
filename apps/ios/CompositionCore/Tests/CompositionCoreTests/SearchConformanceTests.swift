import Foundation
import Testing

@testable import CompositionCore

// Spike S2, the acceptance test (docs/ipad-app-design.md, "Search"): the Swift search against a real Meilisearch, over the
// notes of `pnpm search:playground` and the queries in apps/ios/conformance/search-queries.json. Meilisearch's answers are
// committed (search-expected.json) and were produced through the desktop's own searchIndex.ts; see ConformanceTests.swift for
// how to run this. Set SEARCH_REPORT=1 to print every query that differs.
//
// The pass criteria were written down before the first run:
//   A  Queries with no typos: the same set of results as Meilisearch wherever it returned fewer than the cap of 50, and on
//      average at least 8 of its top 10 among our top 10.
//   B  Queries with typos: nothing Meilisearch finds is missed.
//   C  Every query answers in under 200 ms on 1,000 notes.

private struct Group: Decodable {
    let name: String
    let queries: [String]
}

private struct Expected: Decodable {
    struct Corpus: Decodable {
        struct Result: Decodable {
            let query: String
            let ids: [Int64]
        }
        let hash: String
        let results: [Result]
    }
    let meilisearch: String
    let corpora: [String: Corpus]
}

private struct Comparison {
    let group: String
    let query: String
    let meilisearch: [Int64]
    let swift: [Int64]

    var setEqual: Bool { Set(meilisearch) == Set(swift) }
    var capped: Bool { meilisearch.count >= SearchIndex.resultLimit }
    /// How much of Meilisearch's answer we found.
    var recall: Double { meilisearch.isEmpty ? 1 : Double(Set(meilisearch).intersection(swift).count) / Double(meilisearch.count) }
    /// How much of what we found Meilisearch found too.
    var precision: Double { swift.isEmpty ? 1 : Double(Set(swift).intersection(meilisearch).count) / Double(swift.count) }
    var topTenOverlap: Double {
        let theirs = Set(meilisearch.prefix(10))
        return theirs.isEmpty ? 1 : Double(theirs.intersection(swift.prefix(10)).count) / Double(theirs.count)
    }
    var topOne: Bool { meilisearch.first == swift.first }
}

private let typoGroupPrefixes = ["typo", "too short"]

@Suite("Search against Meilisearch", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct SearchConformanceTests {
    private func load() throws -> (groups: [Group], expected: Expected, directory: URL) {
        let directory = try #require(conformanceDirectory)
        struct File: Decodable { let groups: [Group] }
        let groups = try JSONDecoder().decode(File.self, from: Data(contentsOf: directory.appendingPathComponent("search-queries.json"))).groups
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("search-expected.json")))
        return (groups, expected, directory)
    }

    /// A search index over a copy of the generated notes.
    private func index(corpus: String, in directory: URL, scratch: Scratch) throws -> (SearchIndex, CompositionDatabase) {
        let folder = scratch.directory.appendingPathComponent(UUID().uuidString, isDirectory: true)  // one per call: a test may build several
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let copy = folder.appendingPathComponent("composition.db")
        try FileManager.default.copyItem(at: directory.appendingPathComponent("search-corpus-\(corpus).db"), to: copy)
        let database = try CompositionDatabase.open(at: copy)
        let index = try SearchIndex.open(at: folder.appendingPathComponent("search.db"))
        try index.rebuild(from: database)
        return (index, database)
    }

    private func compare(corpus: String, _ groups: [Group], _ expected: Expected, directory: URL, scratch: Scratch) throws -> [Comparison] {
        let (index, database) = try index(corpus: corpus, in: directory, scratch: scratch)
        defer { try? database.close(); try? index.close() }
        var answers: [String: [Int64]] = [:]
        for result in try #require(expected.corpora[corpus]).results { answers[result.query] = result.ids }
        return try groups.flatMap { group in
            try group.queries.map { Comparison(group: group.name, query: $0, meilisearch: answers[$0] ?? [], swift: try index.search($0)) }
        }
    }

    private func percent(_ part: Int, _ whole: Int) -> String { whole == 0 ? "   -" : String(format: "%3d%%", Int((100 * Double(part) / Double(whole)).rounded())) }

    private func report(_ title: String, _ comparisons: [Comparison]) {
        print("\nS2 \(title)")
        print("  \("group".padding(toLength: 58, withPad: " ", startingAt: 0)) queries  same set  recall  top-10  top-1")
        let order = comparisons.reduce(into: [String]()) { if !$0.contains($1.group) { $0.append($1.group) } }
        for name in order + ["ALL"] {
            let rows = name == "ALL" ? comparisons : comparisons.filter { $0.group == name }
            let uncapped = rows.filter { !$0.capped }
            let withHits = rows.filter { !$0.meilisearch.isEmpty }
            let recall = withHits.isEmpty ? 1 : withHits.map(\.recall).reduce(0, +) / Double(withHits.count)
            let top10 = withHits.isEmpty ? 1 : withHits.map(\.topTenOverlap).reduce(0, +) / Double(withHits.count)
            print("  \(name.padding(toLength: 58, withPad: " ", startingAt: 0)) \(String(rows.count).padding(toLength: 7, withPad: " ", startingAt: 0))  \(percent(uncapped.filter(\.setEqual).count, uncapped.count))      \(percent(Int((recall * 100).rounded()), 100))    \(percent(Int((top10 * 100).rounded()), 100))   \(percent(withHits.filter(\.topOne).count, withHits.count))")
        }
    }

    private func differences(_ comparisons: [Comparison], limit: Int = 60) {
        let different = comparisons.filter { !$0.setEqual && !$0.capped }
        print("\n  queries whose set differs (\(different.count)); missing = Meilisearch only, extra = ours only:")
        for c in different.prefix(limit) {
            let missing = Set(c.meilisearch).subtracting(c.swift).sorted(), extra = Set(c.swift).subtracting(c.meilisearch).sorted()
            print("    \(String(reflecting: c.query))  [\(c.group.prefix(24))]  meili \(c.meilisearch.count), ours \(c.swift.count)  missing \(missing.prefix(6)) extra \(extra.prefix(6))")
        }
    }

    @Test("the 100-note corpus: the same results as Meilisearch where no typo is involved, and nothing missed where one is")
    func acceptance() throws {
        let (groups, expected, directory) = try load()
        #expect(expected.meilisearch.hasPrefix("1."))
        try withScratch { scratch in
            let all = try compare(corpus: "100", groups, expected, directory: directory, scratch: scratch)
            report("100 notes (Meilisearch \(expected.meilisearch))", all)
            if ProcessInfo.processInfo.environment["SEARCH_REPORT"] != nil { differences(all) }

            let exact = all.filter { c in !typoGroupPrefixes.contains { c.group.hasPrefix($0) } && !c.group.hasPrefix("phrase") }
            let typos = all.filter { c in c.group.hasPrefix("typo") }

            // A: no typos
            let uncapped = exact.filter { !$0.capped }
            let sameSet = uncapped.filter(\.setEqual).count
            let meanTopTen = exact.filter { $0.meilisearch.count >= 10 }.map(\.topTenOverlap)
            let topTen = meanTopTen.reduce(0, +) / Double(max(meanTopTen.count, 1))
            print("\n  A  same set: \(sameSet) of \(uncapped.count); mean top-10 overlap \(String(format: "%.2f", topTen)) over \(meanTopTen.count) queries with at least 10 results")
            #expect(sameSet == uncapped.count, "A: every exact query finds Meilisearch's set")
            #expect(topTen >= 0.8, "A: at least 8 of Meilisearch's top 10 in ours")

            // B: typos
            let missed = typos.filter { !$0.capped && $0.recall < 1 }
            print("  B  typo queries that miss something Meilisearch finds: \(missed.count) of \(typos.count)")
            for c in missed.prefix(20) { print("       \(String(reflecting: c.query)) misses \(Set(c.meilisearch).subtracting(c.swift).sorted())") }
            #expect(missed.isEmpty, "B: nothing Meilisearch finds is missed")
        }
    }

    @Test("the 1,000-note corpus: report agreement, and answer every query in under 200 ms")
    func scaleAndSpeed() throws {
        let (groups, expected, directory) = try load()
        try withScratch { scratch in
            let started = Date()
            let (index, database) = try index(corpus: "1000", in: directory, scratch: scratch)
            defer { try? database.close(); try? index.close() }
            let buildSeconds = Date().timeIntervalSince(started)

            let queries = groups.flatMap(\.queries)
            var timings: [(query: String, seconds: Double)] = []
            // The first search of a run reads the vocabulary; every later one reuses it.
            let first = Date()
            _ = try index.search("kubernetes")
            let firstSeconds = Date().timeIntervalSince(first)
            for _ in 0..<3 {
                for query in queries {
                    let start = DispatchTime.now()
                    _ = try index.search(query)
                    timings.append((query, Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e9))
                }
            }
            let sorted = timings.map(\.seconds).sorted()
            func ms(_ s: Double) -> String { String(format: "%.1f ms", s * 1000) }
            let slowest = timings.max { $0.seconds < $1.seconds }!
            print("\nS2 speed, 1,000 notes: index built in \(ms(buildSeconds)); first search \(ms(firstSeconds)); \(timings.count) searches: median \(ms(sorted[sorted.count / 2])), 95th \(ms(sorted[sorted.count * 95 / 100])), slowest \(ms(slowest.seconds)) (\(String(reflecting: slowest.query)))")
            #expect(slowest.seconds < 0.2, "C: every query under 200 ms (slowest: \(String(reflecting: slowest.query)))")

            let all = try compare(corpus: "1000", groups, expected, directory: directory, scratch: scratch)
            report("1,000 notes (most queries hit the cap of 50, so the set is mostly ties)", all)
        }
    }
}
