import Foundation

/// A group with everything beneath it: a port of `groupListing.ts` (build plan Step 7).
public struct GroupListing: Equatable, Sendable {
    public var group: NoteGroup
    public var subgroups: [GroupListing]
    public var notes: [NoteSummary]
    /// Notes in this group and every group beneath it.
    public var totalNotes: Int

    /// The full subtree under `groupId`: each group's sub-groups (in the order `groups` lists them) and direct notes (in the order
    /// `notes` lists them; `orderNotes` reorders each group's own). Nil when the group does not exist. A group is listed once, so a
    /// loop in the parents (which the store refuses to make, but a restored backup could hold) ends the listing instead of repeating it.
    public static func build(groupId: Int64, groups: [NoteGroup], notes: [NoteSummary], orderNotes: ([NoteSummary]) -> [NoteSummary] = { $0 }) -> GroupListing? {
        guard let root = groups.first(where: { $0.id == groupId }) else { return nil }
        var visited = Set<Int64>()

        func build(_ group: NoteGroup) -> GroupListing {
            visited.insert(group.id)
            let children = groups.filter { $0.parentId == group.id && !visited.contains($0.id) }
            let subgroups = children.map(build)
            let own = orderNotes(notes.filter { $0.groupId == group.id })
            return GroupListing(group: group, subgroups: subgroups, notes: own, totalNotes: own.count + subgroups.reduce(0) { $0 + $1.totalNotes })
        }

        return build(root)
    }

    /// Ancestors of a group from the top level down to (and including) the group.
    public static func path(to groupId: Int64, in groups: [NoteGroup]) -> [NoteGroup] {
        let byId = Dictionary(groups.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        var path: [NoteGroup] = []
        var seen = Set<Int64>()
        var current = byId[groupId]
        while let group = current, !seen.contains(group.id) {
            seen.insert(group.id)
            path.insert(group, at: 0)
            current = group.parentId.flatMap { byId[$0] }
        }
        return path
    }
}
