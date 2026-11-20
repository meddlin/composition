package com.rushinglabs.composition.core.organization

import com.rushinglabs.composition.core.NoteGroup
import com.rushinglabs.composition.core.NoteSummary

/** A group with everything beneath it: a port of `groupListing.ts`, by way of GroupListing.swift. */
data class GroupListing(
    val group: NoteGroup,
    val subgroups: List<GroupListing>,
    val notes: List<NoteSummary>,
    /** Notes in this group and every group beneath it. */
    val totalNotes: Int,
) {
    companion object {
        /**
         * The full subtree under `groupId`: each group's sub-groups (in the order `groups` lists them) and direct notes (in the order
         * `notes` lists them; `orderNotes` reorders each group's own). Null when the group does not exist. A group is listed once, so
         * a loop in the parents (which the store refuses to make, but a restored backup could hold) ends the listing instead of
         * repeating it.
         */
        fun build(
            groupId: Long,
            groups: List<NoteGroup>,
            notes: List<NoteSummary>,
            orderNotes: (List<NoteSummary>) -> List<NoteSummary> = { it },
        ): GroupListing? {
            val root = groups.firstOrNull { it.id == groupId } ?: return null
            val visited = HashSet<Long>()

            fun build(group: NoteGroup): GroupListing {
                visited.add(group.id)
                // The children are chosen before any of them is walked, as the Swift does.
                val children = groups.filter { it.parentId == group.id && it.id !in visited }
                val subgroups = children.map { build(it) }
                val own = orderNotes(notes.filter { it.groupId == group.id })
                return GroupListing(group, subgroups, own, own.size + subgroups.sumOf { it.totalNotes })
            }

            return build(root)
        }

        /** Ancestors of a group from the top level down to (and including) the group. */
        fun path(groupId: Long, groups: List<NoteGroup>): List<NoteGroup> {
            // The last group listed with an id wins, as in the Swift.
            val byId = groups.associateBy { it.id }
            val path = ArrayDeque<NoteGroup>()
            val seen = HashSet<Long>()
            var current = byId[groupId]
            while (current != null && current.id !in seen) {
                seen.add(current.id)
                path.addFirst(current)
                current = current.parentId?.let { byId[it] }
            }
            return path.toList()
        }
    }
}
