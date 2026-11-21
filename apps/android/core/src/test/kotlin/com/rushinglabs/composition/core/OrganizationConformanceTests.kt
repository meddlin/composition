package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.organization.DropEdge
import com.rushinglabs.composition.core.organization.GroupListing
import com.rushinglabs.composition.core.organization.NavigationHistory
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The desktop's `navHistory.ts`, `dropEdge.ts` and `groupListing.ts` against the real functions, ported from
// OrganizationConformanceTests.swift. The inputs are fixtures/conformance/organization-cases.json (72 histories of up to 45 steps with
// places going missing, 552 drags over three row heights and every set of allowed edges, 183 listings and 182 paths over random trees,
// loops and missing groups included); what the desktop made of each is organization-expected.json. Each test gathers every difference
// before failing, so one run shows them all.

private data class HistoryPlace(val kind: String, val id: Long?)

private fun place(element: JsonElement?): HistoryPlace? {
    val obj = element as? JsonObject ?: return null
    val id = obj["id"]?.takeIf { it != JsonNull }?.jsonPrimitive?.long
    return HistoryPlace(obj.getValue("kind").jsonPrimitive.content, id)
}

private fun group(element: JsonElement): NoteGroup {
    val obj = element.jsonObject
    val id = obj.getValue("id").jsonPrimitive.long
    val parent = obj["parentId"]?.takeIf { it != JsonNull }?.jsonPrimitive?.long
    return NoteGroup(id, "", "g$id", parent, null, "", "")
}

private fun note(element: JsonElement): NoteSummary {
    val obj = element.jsonObject
    val id = obj.getValue("id").jsonPrimitive.long
    val groupId = obj["groupId"]?.takeIf { it != JsonNull }?.jsonPrimitive?.long
    return NoteSummary(id, "", "n$id", "", null, groupId, "", "")
}

/** A listing as the desktop's fixture writes it. */
private fun shown(listing: GroupListing): JsonElement = JsonObject(
    mapOf(
        "id" to JsonPrimitive(listing.group.id),
        "subgroups" to JsonArray(listing.subgroups.map(::shown)),
        "notes" to JsonArray(listing.notes.map { JsonPrimitive(it.id) }),
        "totalNotes" to JsonPrimitive(listing.totalNotes),
    ),
)

@DisplayName("The sidebar's rules against the desktop")
class OrganizationConformanceTests {
    private class Fixtures(val cases: JsonObject, val expected: JsonObject) {
        fun cases(key: String) = cases.getValue(key).jsonArray
        fun expected(key: String) = expected.getValue(key).jsonArray
    }

    private fun load(): Fixtures {
        val directory = requireConformance()
        return Fixtures(
            readJson(File(directory, "organization-cases.json")).jsonObject,
            readJson(File(directory, "organization-expected.json")).jsonObject,
        )
    }

    private fun report(what: String, total: Int, different: List<String>) {
        println("Organization, $what: ${total - different.size} of $total agree with the desktop")
        different.take(40).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "$what that differ: ${different.size}")
    }

    @Test
    @DisplayName("navigation history makes the same entries, cursor and step as navHistory.ts at every step")
    fun history() {
        val f = load()
        assertEquals(f.cases("navHistory").size, f.expected("navHistory").size)
        val different = ArrayList<String>()
        var total = 0
        for ((number, script) in f.cases("navHistory").withIndex()) {
            val history = NavigationHistory<HistoryPlace>()
            var gone = emptyList<HistoryPlace>()
            val isValid: (HistoryPlace) -> Boolean = { it !in gone }
            for ((index, element) in script.jsonObject.getValue("steps").jsonArray.withIndex()) {
                val step = element.jsonObject
                total += 1
                var result: HistoryPlace? = null
                when (val op = step.getValue("op").jsonPrimitive.content) {
                    "record" -> history.record(place(step["location"])!!)
                    "gone" -> gone = step.getValue("locations").jsonArray.map { place(it)!! }
                    "back" -> result = history.back(isValid)
                    "forward" -> result = history.forward(isValid)
                    else -> error("unknown step $op")
                }
                val want = f.expected("navHistory")[number].jsonArray[index].jsonObject
                val wantEntries = want.getValue("entries").jsonArray.map { place(it)!! }
                val wantCursor = want.getValue("cursor").jsonPrimitive.int
                val wantResult = place(want["result"])
                if (history.entries != wantEntries || history.cursor != wantCursor || result != wantResult) {
                    different.add(
                        "script $number, step $index: ours ${history.entries} at ${history.cursor} -> $result, " +
                            "desktop $wantEntries at $wantCursor -> $wantResult",
                    )
                }
            }
        }
        report("history steps", total, different)
    }

    @Test
    @DisplayName("every drag lands on the edge dropEdge.ts says")
    fun edges() {
        val f = load()
        assertEquals(f.cases("dropEdge").size, f.expected("dropEdge").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("dropEdge").withIndex()) {
            val drag = element.jsonObject
            val offsetY = drag.getValue("offsetY").jsonPrimitive.double
            val height = drag.getValue("height").jsonPrimitive.double
            val names = drag.getValue("allowed").jsonArray.map { it.jsonPrimitive.content }
            val got = DropEdge.at(offsetY, height, names.mapNotNull(DropEdge::of))?.rawValue
            val want = (f.expected("dropEdge")[index] as? JsonPrimitive)?.takeIf { it != JsonNull }?.content
            if (got != want) different.add("offset $offsetY of $height, allowed $names: ours $got, desktop $want")
        }
        report("drags", f.cases("dropEdge").size, different)
    }

    @Test
    @DisplayName("every listing and path is the one groupListing.ts builds")
    fun listings() {
        val f = load()
        assertEquals(f.cases("groupListing").size, f.expected("groupListing").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("groupListing").withIndex()) {
            val item = element.jsonObject
            val groups = item.getValue("groups").jsonArray.map(::group)
            val notes = item.getValue("notes").jsonArray.map(::note)
            val reverse = item.getValue("order").jsonPrimitive.content == "reverse"
            val listing = GroupListing.build(item.getValue("groupId").jsonPrimitive.long, groups, notes, if (reverse) { it -> it.reversed() } else { it -> it })
            val got: JsonElement = listing?.let(::shown) ?: JsonNull
            val want = f.expected("groupListing")[index]
            got.difference(want)?.let { different.add("listing $index: $it") }
        }
        report("listings", f.cases("groupListing").size, different)

        assertEquals(f.cases("groupPath").size, f.expected("groupPath").size)
        val paths = ArrayList<String>()
        for ((index, element) in f.cases("groupPath").withIndex()) {
            val item = element.jsonObject
            val got = GroupListing.path(item.getValue("groupId").jsonPrimitive.long, item.getValue("groups").jsonArray.map(::group)).map { it.id }
            val want = f.expected("groupPath")[index].jsonArray.map { it.jsonPrimitive.long }
            if (got != want) paths.add("path $index: ours $got, desktop $want")
        }
        report("paths", f.cases("groupPath").size, paths)
    }
}
