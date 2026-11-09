import Testing

@testable import CompositionCore

// Build plan Step 7: the pure rules behind the sidebar. OrganizationConformanceTests holds them against the desktop's real code; these
// say what each rule is, in plain cases.

private enum Place: Equatable { case note(Int), group(Int), home }

@Suite("Navigation history")
struct NavigationHistoryTests {
    private func visited(_ places: Place...) -> NavigationHistory<Place> {
        var history = NavigationHistory<Place>()
        for place in places { history.record(place) }
        return history
    }

    @Test("starts at the first place and adds each new one after the last")
    func record() {
        let history = visited(.note(1), .note(2), .home)
        #expect(history.entries == [.note(1), .note(2), .home])
        #expect(history.cursor == 2)
    }

    @Test("ignores the place it already points at, and keeps a return to an earlier one")
    func repeats() {
        var history = visited(.note(1), .note(2))
        history.record(.note(2))
        #expect(history.entries == [.note(1), .note(2)])
        history.record(.note(1))
        #expect(history.entries == [.note(1), .note(2), .note(1)])
    }

    @Test("going back and then somewhere new drops what was ahead")
    func branch() {
        var history = visited(.note(1), .note(2), .note(3))
        #expect(history.back { _ in true } == .note(2))
        history.record(.note(4))
        #expect(history.entries == [.note(1), .note(2), .note(4)])
        #expect(history.cursor == 2)
        #expect(history.forward { _ in true } == nil)
    }

    @Test("passes over places that are gone, and forward still lands where it should")
    func gone() {
        var history = visited(.note(1), .group(2), .note(3))
        let isValid: (Place) -> Bool = { $0 != .group(2) }
        #expect(history.back(isValid: isValid) == .note(1))
        #expect(history.back(isValid: isValid) == nil)
        #expect(history.forward(isValid: isValid) == .note(3))
        #expect(history.entries.count == 3)
    }

    @Test("can say whether a step would land anywhere")
    func canStep() {
        let history = visited(.note(1), .note(2))
        #expect(history.canGoBack { _ in true })
        #expect(!history.canGoForward { _ in true })
        #expect(!history.canGoBack { _ in false })
    }

    @Test("forgets the oldest entries past the cap")
    func cap() {
        var history = NavigationHistory<Place>()
        for id in 1...(NavigationHistory<Place>.maxEntries + 5) { history.record(.note(id)) }
        #expect(history.entries.count == NavigationHistory<Place>.maxEntries)
        #expect(history.entries.first == .note(6))
        #expect(history.cursor == NavigationHistory<Place>.maxEntries - 1)
    }
}

@Suite("Where a drag lands on a row")
struct DropEdgeTests {
    @Test("a row that can be dropped onto keeps its middle for that")
    func into() {
        let all = DropEdge.allCases
        #expect(DropEdge.at(offsetY: 2, height: 40, allowed: all) == .before)
        #expect(DropEdge.at(offsetY: 20, height: 40, allowed: all) == .into)
        #expect(DropEdge.at(offsetY: 38, height: 40, allowed: all) == .after)
    }

    @Test("a row that can only be placed beside splits down the middle")
    func beside() {
        #expect(DropEdge.at(offsetY: 10, height: 40, allowed: [.before, .after]) == .before)
        #expect(DropEdge.at(offsetY: 30, height: 40, allowed: [.before, .after]) == .after)
        #expect(DropEdge.at(offsetY: 10, height: 40, allowed: [.after]) == .after)
        #expect(DropEdge.at(offsetY: 10, height: 40, allowed: []) == nil)
    }
}

@Suite("Group listing")
struct GroupListingTests {
    private func group(_ id: Int64, in parent: Int64? = nil) -> NoteGroup { NoteGroup(id: id, name: "g\(id)", parentId: parent) }
    private func note(_ id: Int64, in group: Int64?) -> NoteSummary { NoteSummary(id: id, title: "n\(id)", groupId: group) }

    @Test("lists sub-groups and notes in the order given, with totals")
    func tree() throws {
        let groups = [group(1), group(2, in: 1), group(3, in: 1), group(4, in: 2), group(5)]
        let notes = [note(101, in: 1), note(102, in: 2), note(103, in: 4), note(104, in: 4), note(105, in: nil), note(106, in: 5)]
        let listing = try #require(GroupListing.build(groupId: 1, groups: groups, notes: notes))
        #expect(listing.subgroups.map(\.group.id) == [2, 3])
        #expect(listing.notes.map(\.id) == [101])
        #expect(listing.subgroups[0].subgroups[0].notes.map(\.id) == [103, 104])
        #expect(listing.totalNotes == 4)
        #expect(listing.subgroups[1].totalNotes == 0)
    }

    @Test("a group that is not there has no listing, and a loop in the parents ends")
    func edges() throws {
        #expect(GroupListing.build(groupId: 9, groups: [group(1)], notes: []) == nil)
        let loop = [group(1, in: 2), group(2, in: 3), group(3, in: 1)]
        let listing = try #require(GroupListing.build(groupId: 2, groups: loop, notes: [note(1, in: 3)]))
        // 2 holds 1, which holds 3; 3's parent chain comes back to 2, which was already listed.
        #expect(listing.subgroups.map(\.group.id) == [1])
        #expect(listing.subgroups[0].subgroups.map(\.group.id) == [3])
        #expect(listing.subgroups[0].subgroups[0].subgroups.isEmpty)
        #expect(listing.totalNotes == 1)
    }

    @Test("the path runs from the top level down to the group")
    func path() {
        let groups = [group(1), group(2, in: 1), group(4, in: 2)]
        #expect(GroupListing.path(to: 4, in: groups).map(\.id) == [1, 2, 4])
        #expect(GroupListing.path(to: 9, in: groups).isEmpty)
    }
}
