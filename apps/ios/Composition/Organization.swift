import CompositionCore
import CoreTransferable
import Foundation
import UniformTypeIdentifiers

// Build plan Step 7: what the sidebar can point at, where the user has been, and what is dragged. The rules underneath (the tree of a
// group, the history, which edge of a row a drag is on) are in CompositionCore and are checked against the desktop's.

/// What the first column can select, and what the second then lists: every note, the pinned ones, a notebook's top level, or one group.
enum SidebarItem: Hashable, Sendable {
    case all
    case favorites
    case notebook(Int64)
    case group(Int64)

    /// For `@SceneStorage`: `all`, `favorites`, `notebook:3`, `group:12`.
    var stored: String {
        switch self {
        case .all: "all"
        case .favorites: "favorites"
        case .notebook(let id): "notebook:\(id)"
        case .group(let id): "group:\(id)"
        }
    }

    init?(stored: String) {
        let parts = stored.split(separator: ":")
        switch (parts.first, parts.dropFirst().first.flatMap { Int64($0) }) {
        case ("all", nil): self = .all
        case ("favorites", nil): self = .favorites
        case ("notebook", let id?): self = .notebook(id)
        case ("group", let id?): self = .group(id)
        default: return nil
        }
    }
}

/// A place in the history: what the sidebar showed, or a note that was opened.
enum Place: Equatable, Sendable {
    case list(SidebarItem)
    case note(Int64)
}

/// One row of the sidebar, in the order it is drawn (the groups under an open notebook or group follow it).
struct SidebarRow: Identifiable, Equatable {
    let item: SidebarItem
    let title: String
    let systemImage: String
    let depth: Int
    let count: Int
    let expandable: Bool
    let isExpanded: Bool
    var id: SidebarItem { item }
}

/// Something a drag can land on: a notebook's row, a group's row, or a note's row in the list of `list` (whose order is the one a drop sets).
enum DropTarget: Equatable {
    case notebook(Int64)
    case group(Int64)
    case note(Int64, list: SidebarItem?)
}

/// The totals behind the sidebar's counts.
struct SidebarCounts: Equatable, Sendable {
    var groups: [Int64: Int] = [:]
    var notebooks: [Int64: Int] = [:]

    init() {}

    init(groups: [Int64: Int], notebooks: [Int64: Int]) {
        self.groups = groups
        self.notebooks = notebooks
    }

    /// Notes in each group and everything beneath it (`GroupListing.totalNotes`), and notes in each notebook.
    static func make(groups: [NoteGroup], notes: [NoteSummary]) -> SidebarCounts {
        var result = SidebarCounts()
        func record(_ listing: GroupListing) {
            result.groups[listing.group.id] = listing.totalNotes
            listing.subgroups.forEach(record)
        }
        for top in groups where top.parentId == nil {
            if let listing = GroupListing.build(groupId: top.id, groups: groups, notes: notes) { record(listing) }
        }
        for note in notes { if let notebook = note.notebookId { result.notebooks[notebook, default: 0] += 1 } }
        return result
    }
}

/// What is dragged around the sidebar and the note list: a note, a group or a notebook, by id.
struct DraggedItem: Codable, Transferable, Hashable, Identifiable {
    enum Kind: String, Codable { case note, group, notebook }
    let kind: Kind
    let id: Int64

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .compositionItem)
    }
}

extension UTType {
    /// Only ever travels inside this app (a drag offers it with `.ownProcess` visibility), so it needs no declaration in the Info.plist.
    static let compositionItem = UTType(exportedAs: "com.rushinglabs.composition.item", conformingTo: .data)
}
