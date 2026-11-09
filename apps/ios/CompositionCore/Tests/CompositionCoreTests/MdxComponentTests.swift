import Foundation
import Testing

@testable import CompositionCore

// Spike S4: the Swift ports of the helpers behind the components against the desktop's real functions (chartData.ts,
// repoRef.ts, youtubeRef.ts, imageWidth.ts, imageRefs.ts). The inputs are fixtures/conformance/component-cases.json, the
// answers component-expected.json (see ConformanceTests.swift for how to run this).

private struct Cases: Decodable {
    struct Chart: Decodable { let type: String?; let x: String?; let y: String?; let csv: String }
    struct YouTube: Decodable { let url: String; let start: String? }
    let chart: [Chart]
    let repo: [String]
    let youtube: [YouTube]
    let start: [String]
    let width: [String]
    let imageRef: [String]
}

private struct Expected: Decodable {
    struct Chart: Decodable {
        struct Row: Decodable { let label: String; let values: [String: Double] }
        let error: String?
        let type: String?
        let x: String?
        let y: [String]?
        let rows: [Row]?
    }
    struct Repo: Decodable { let host: String; let service: String?; let owner: String; let name: String; let href: String }
    struct YouTube: Decodable { let id: String; let start: Int; let embed: String; let watch: String }
    struct Width: Decodable { let value: Double; let unit: String }
    let chart: [Chart]
    let repo: [Repo?]
    let youtube: [YouTube?]
    let start: [Int?]
    let width: [Width?]
    let imageRef: [String?]
}

@Suite("Component helpers against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct MdxComponentTests {
    private func load() throws -> (Cases, Expected) {
        let directory = try #require(conformanceDirectory)
        let cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: directory.appendingPathComponent("component-cases.json")))
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("component-expected.json")))
        return (cases, expected)
    }

    @Test("every input answered as the desktop answers it")
    func helpers() throws {
        let (cases, expected) = try load()
        var different: [String] = []
        func check<T: Equatable>(_ kind: String, _ input: String, _ ours: T, _ theirs: T) {
            if ours != theirs { different.append("  \(kind) \(String(reflecting: input.prefix(70))): ours \(ours), desktop \(theirs)") }
        }

        for (index, input) in cases.chart.enumerated() {
            let want = expected.chart[index]
            let got = NoteChart.parse(type: input.type, x: input.x, y: input.y, csv: input.csv)
            let label = "\(input.type ?? "-")/\(input.x ?? "-")/\(input.y ?? "-")/\(input.csv)"
            switch got {
            case .failure(let message): check("chart", label, "error: \(message)", "error: \(want.error ?? "(a chart)")")
            case .chart(let spec):
                let summary = "\(spec.type.rawValue) x=\(spec.x) y=\(spec.y) \(spec.rows.map { "\($0.label):\($0.values.sorted { $0.key < $1.key })" })"
                let theirs = want.error != nil ? "error: \(want.error!)" : "\(want.type!) x=\(want.x!) y=\(want.y!) \(want.rows!.map { "\($0.label):\($0.values.sorted { $0.key < $1.key })" })"
                check("chart", label, summary, theirs)
            }
        }
        for (index, url) in cases.repo.enumerated() {
            let want = expected.repo[index]
            let got = NoteRepo.parse(url)
            check("repo", url, got.map { "\($0.host)|\($0.service ?? "-")|\($0.owner)|\($0.name)|\($0.href)" } ?? "nil",
                  want.map { "\($0.host)|\($0.service ?? "-")|\($0.owner)|\($0.name)|\($0.href)" } ?? "nil")
        }
        for (index, input) in cases.youtube.enumerated() {
            let want = expected.youtube[index]
            let got = NoteYouTube.parse(input.url, start: input.start)
            check("youtube", "\(input.url) start=\(input.start ?? "-")", got.map { "\($0.id)|\($0.start)|\($0.embedURL)|\($0.watchURL)" } ?? "nil",
                  want.map { "\($0.id)|\($0.start)|\($0.embed)|\($0.watch)" } ?? "nil")
        }
        for (index, value) in cases.start.enumerated() { check("start", value, NoteYouTube.parseStart(value), expected.start[index]) }
        for (index, value) in cases.width.enumerated() {
            let want = expected.width[index]
            let got = NoteImage.parseWidth(value)
            check("width", value, got.map { "\($0.value)\($0.unit.rawValue)" } ?? "nil", want.map { "\($0.value)\($0.unit == "%" ? "%" : "px")" } ?? "nil")
        }
        for (index, value) in cases.imageRef.enumerated() { check("imageRef", value, NoteImage.name(fromRef: value), expected.imageRef[index]) }

        let total = cases.chart.count + cases.repo.count + cases.youtube.count + cases.start.count + cases.width.count + cases.imageRef.count
        print("\nS4 components: \(total - different.count) of \(total) inputs answered as the desktop does")
        for line in different { print(line) }
        #expect(different.isEmpty, "inputs that differ: \(different.count)")
    }
}
