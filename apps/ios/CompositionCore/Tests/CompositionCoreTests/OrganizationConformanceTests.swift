import Foundation
import Testing

@testable import CompositionCore

// Build plan Step 7: the desktop's `navHistory.ts`, `dropEdge.ts` and `groupListing.ts`, against the real functions. The inputs are
// apps/ios/conformance/organization-cases.json (72 histories of up to 45 steps with places going missing, 552 drags over three row
// heights and every set of allowed edges, 183 listings and 182 paths over random trees, loops and missing groups included); what the
// desktop made of each is organization-expected.json (see ConformanceTests.swift for how to run this).

private struct Place: Decodable, Equatable {
    let kind: String
    let id: Int?
}

private struct Cases: Decodable {
    struct Step: Decodable {
        let op: String
        let location: Place?
        let locations: [Place]?
    }

    struct Script: Decodable { let steps: [Step] }

    struct Group: Decodable { let id: Int64; let parentId: Int64? }
    struct Note: Decodable { let id: Int64; let groupId: Int64? }
    struct Drag: Decodable { let offsetY: Double; let height: Double; let allowed: [String] }
    struct Listing: Decodable { let groupId: Int64; let groups: [Group]; let notes: [Note]; let order: String }
    struct Path: Decodable { let groupId: Int64; let groups: [Group] }

    let navHistory: [Script]
    let dropEdge: [Drag]
    let groupListing: [Listing]
    let groupPath: [Path]
}

private struct Expected: Decodable {
    struct After: Decodable {
        let entries: [Place]
        let cursor: Int
        let result: Place?
    }

    struct Listing: Decodable, Equatable {
        let id: Int64
        let subgroups: [Listing]
        let notes: [Int64]
        let totalNotes: Int
    }

    let navHistory: [[After]]
    let dropEdge: [String?]
    let groupListing: [Listing?]
    let groupPath: [[Int64]]
}

@Suite("The sidebar's rules against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct OrganizationConformanceTests {
    private func load() throws -> (Cases, Expected) {
        let directory = try #require(conformanceDirectory)
        let cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: directory.appendingPathComponent("organization-cases.json")))
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("organization-expected.json")))
        return (cases, expected)
    }

    private func groups(_ rows: [Cases.Group]) -> [NoteGroup] { rows.map { NoteGroup(id: $0.id, name: "g\($0.id)", parentId: $0.parentId) } }

    private func shown(_ listing: GroupListing) -> Expected.Listing {
        Expected.Listing(id: listing.group.id, subgroups: listing.subgroups.map(shown), notes: listing.notes.map(\.id), totalNotes: listing.totalNotes)
    }

    @Test("navigation history makes the same entries, cursor and step as navHistory.ts at every step")
    func history() throws {
        let (cases, expected) = try load()
        #expect(cases.navHistory.count == expected.navHistory.count)
        for (number, script) in cases.navHistory.enumerated() {
            var history = NavigationHistory<Place>()
            var gone: [Place] = []
            let isValid: (Place) -> Bool = { place in !gone.contains(place) }
            for (index, step) in script.steps.enumerated() {
                var result: Place?
                switch step.op {
                case "record": history.record(try #require(step.location))
                case "gone": gone = try #require(step.locations)
                case "back": result = history.back(isValid: isValid)
                case "forward": result = history.forward(isValid: isValid)
                default: Issue.record("unknown step \(step.op)")
                }
                let want = expected.navHistory[number][index]
                #expect(history.entries == want.entries, "script \(number), step \(index): entries")
                #expect(history.cursor == want.cursor, "script \(number), step \(index): cursor")
                #expect(result == want.result, "script \(number), step \(index): where it landed")
            }
        }
    }

    @Test("every drag lands on the edge dropEdge.ts says")
    func edges() throws {
        let (cases, expected) = try load()
        #expect(cases.dropEdge.count == expected.dropEdge.count)
        for (index, drag) in cases.dropEdge.enumerated() {
            let allowed = drag.allowed.compactMap(DropEdge.init(rawValue:))
            let got = DropEdge.at(offsetY: drag.offsetY, height: drag.height, allowed: allowed)?.rawValue
            #expect(got == expected.dropEdge[index], "offset \(drag.offsetY) of \(drag.height), allowed \(drag.allowed)")
        }
    }

    @Test("every listing and path is the one groupListing.ts builds")
    func listings() throws {
        let (cases, expected) = try load()
        #expect(cases.groupListing.count == expected.groupListing.count)
        for (index, item) in cases.groupListing.enumerated() {
            let notes = item.notes.map { NoteSummary(id: $0.id, title: "n\($0.id)", groupId: $0.groupId) }
            let listing = GroupListing.build(groupId: item.groupId, groups: groups(item.groups), notes: notes, orderNotes: item.order == "reverse" ? { $0.reversed() } : { $0 })
            #expect(listing.map(shown) == expected.groupListing[index], "listing \(index)")
        }
        #expect(cases.groupPath.count == expected.groupPath.count)
        for (index, item) in cases.groupPath.enumerated() {
            #expect(GroupListing.path(to: item.groupId, in: groups(item.groups)).map(\.id) == expected.groupPath[index], "path \(index)")
        }
    }
}
