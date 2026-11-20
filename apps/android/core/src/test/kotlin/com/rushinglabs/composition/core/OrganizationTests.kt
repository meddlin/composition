package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.organization.DropEdge
import com.rushinglabs.composition.core.organization.GroupListing
import com.rushinglabs.composition.core.organization.NavigationHistory
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The pure rules behind the sidebar, ported from OrganizationTests.swift. OrganizationConformanceTests holds them against the desktop's
// real code; these say what each rule is, in plain cases.

private sealed interface SidebarPlace {
    data class Note(val id: Int) : SidebarPlace
    data class Group(val id: Int) : SidebarPlace
    data object Home : SidebarPlace
}

@DisplayName("Navigation history")
class NavigationHistoryTests {
    private fun visited(vararg places: SidebarPlace): NavigationHistory<SidebarPlace> {
        val history = NavigationHistory<SidebarPlace>()
        for (place in places) history.record(place)
        return history
    }

    @Test
    @DisplayName("starts at the first place and adds each new one after the last")
    fun record() {
        val history = visited(SidebarPlace.Note(1), SidebarPlace.Note(2), SidebarPlace.Home)
        assertEquals(listOf(SidebarPlace.Note(1), SidebarPlace.Note(2), SidebarPlace.Home), history.entries)
        assertEquals(2, history.cursor)
    }

    @Test
    @DisplayName("ignores the place it already points at, and keeps a return to an earlier one")
    fun repeats() {
        val history = visited(SidebarPlace.Note(1), SidebarPlace.Note(2))
        history.record(SidebarPlace.Note(2))
        assertEquals(listOf(SidebarPlace.Note(1), SidebarPlace.Note(2)), history.entries)
        history.record(SidebarPlace.Note(1))
        assertEquals(listOf(SidebarPlace.Note(1), SidebarPlace.Note(2), SidebarPlace.Note(1)), history.entries)
    }

    @Test
    @DisplayName("going back and then somewhere new drops what was ahead")
    fun branch() {
        val history = visited(SidebarPlace.Note(1), SidebarPlace.Note(2), SidebarPlace.Note(3))
        assertEquals(SidebarPlace.Note(2), history.back { true })
        history.record(SidebarPlace.Note(4))
        assertEquals(listOf(SidebarPlace.Note(1), SidebarPlace.Note(2), SidebarPlace.Note(4)), history.entries)
        assertEquals(2, history.cursor)
        assertNull(history.forward { true })
    }

    @Test
    @DisplayName("passes over places that are gone, and forward still lands where it should")
    fun gone() {
        val history = visited(SidebarPlace.Note(1), SidebarPlace.Group(2), SidebarPlace.Note(3))
        val isValid: (SidebarPlace) -> Boolean = { it != SidebarPlace.Group(2) }
        assertEquals(SidebarPlace.Note(1), history.back(isValid))
        assertNull(history.back(isValid))
        assertEquals(SidebarPlace.Note(3), history.forward(isValid))
        assertEquals(3, history.entries.size)
    }

    @Test
    @DisplayName("can say whether a step would land anywhere")
    fun canStep() {
        val history = visited(SidebarPlace.Note(1), SidebarPlace.Note(2))
        assertTrue(history.canGoBack { true })
        assertFalse(history.canGoForward { true })
        assertFalse(history.canGoBack { false })
    }

    @Test
    @DisplayName("forgets the oldest entries past the cap")
    fun cap() {
        val history = NavigationHistory<SidebarPlace>()
        for (id in 1..(NavigationHistory.MAX_ENTRIES + 5)) history.record(SidebarPlace.Note(id))
        assertEquals(NavigationHistory.MAX_ENTRIES, history.entries.size)
        assertEquals(SidebarPlace.Note(6), history.entries.first())
        assertEquals(NavigationHistory.MAX_ENTRIES - 1, history.cursor)
    }
}

@DisplayName("Where a drag lands on a row")
class DropEdgeTests {
    @Test
    @DisplayName("a row that can be dropped onto keeps its middle for that")
    fun into() {
        val all = DropEdge.entries
        assertEquals(DropEdge.BEFORE, DropEdge.at(2.0, 40.0, all))
        assertEquals(DropEdge.INTO, DropEdge.at(20.0, 40.0, all))
        assertEquals(DropEdge.AFTER, DropEdge.at(38.0, 40.0, all))
    }

    @Test
    @DisplayName("a row that can only be placed beside splits down the middle")
    fun beside() {
        assertEquals(DropEdge.BEFORE, DropEdge.at(10.0, 40.0, listOf(DropEdge.BEFORE, DropEdge.AFTER)))
        assertEquals(DropEdge.AFTER, DropEdge.at(30.0, 40.0, listOf(DropEdge.BEFORE, DropEdge.AFTER)))
        assertEquals(DropEdge.AFTER, DropEdge.at(10.0, 40.0, listOf(DropEdge.AFTER)))
        assertNull(DropEdge.at(10.0, 40.0, emptyList()))
    }
}

@DisplayName("Group listing")
class GroupListingTests {
    private fun group(id: Long, parent: Long? = null) = NoteGroup(id, "", "g$id", parent, null, "", "")
    private fun note(id: Long, group: Long?) = NoteSummary(id, "", "n$id", "", null, group, "", "")

    @Test
    @DisplayName("lists sub-groups and notes in the order given, with totals")
    fun tree() {
        val groups = listOf(group(1), group(2, 1), group(3, 1), group(4, 2), group(5))
        val notes = listOf(note(101, 1), note(102, 2), note(103, 4), note(104, 4), note(105, null), note(106, 5))
        val listing = assertNotNull(GroupListing.build(1, groups, notes))
        assertEquals(listOf(2L, 3L), listing.subgroups.map { it.group.id })
        assertEquals(listOf(101L), listing.notes.map { it.id })
        assertEquals(listOf(103L, 104L), listing.subgroups[0].subgroups[0].notes.map { it.id })
        assertEquals(4, listing.totalNotes)
        assertEquals(0, listing.subgroups[1].totalNotes)
    }

    @Test
    @DisplayName("a group that is not there has no listing, and a loop in the parents ends")
    fun edges() {
        assertNull(GroupListing.build(9, listOf(group(1)), emptyList()))
        val loop = listOf(group(1, 2), group(2, 3), group(3, 1))
        val listing = assertNotNull(GroupListing.build(2, loop, listOf(note(1, 3))))
        // 2 holds 1, which holds 3; 3's parent chain comes back to 2, which was already listed.
        assertEquals(listOf(1L), listing.subgroups.map { it.group.id })
        assertEquals(listOf(3L), listing.subgroups[0].subgroups.map { it.group.id })
        assertTrue(listing.subgroups[0].subgroups[0].subgroups.isEmpty())
        assertEquals(1, listing.totalNotes)
    }

    @Test
    @DisplayName("the path runs from the top level down to the group")
    fun path() {
        val groups = listOf(group(1), group(2, 1), group(4, 2))
        assertEquals(listOf(1L, 2L, 4L), GroupListing.path(4, groups).map { it.id })
        assertTrue(GroupListing.path(9, groups).isEmpty())
    }
}
