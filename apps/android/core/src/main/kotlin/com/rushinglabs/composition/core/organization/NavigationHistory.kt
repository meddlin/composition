package com.rushinglabs.composition.core.organization

/**
 * Where the user has been, for stepping back to what they were just looking at and forward again: a port of `navHistory.ts`, by way
 * of NavigationHistory.swift, generic over what a place is. The desktop's places are a note, a group or Home; the app's are a note or
 * a choice in the sidebar, and the rules are the same. A history is not saved: relaunching starts a new one.
 *
 * Swift's is a value type changed in place; this one is a small mutable class, compared by its entries and cursor.
 */
class NavigationHistory<Place> {
    /** The oldest first. */
    var entries: List<Place> = emptyList()
        private set

    /** The entry being looked at; -1 only while nothing has been recorded. */
    var cursor: Int = -1
        private set

    companion object {
        /** The oldest entries are forgotten past this. */
        const val MAX_ENTRIES = 100
    }

    /**
     * Notes where the user now is. Looking at what the history already points at changes nothing, which is what lets a step back or
     * forward apply its target without recording it as a new visit. Anywhere else becomes the newest entry, dropping whatever was
     * ahead of the cursor, as a browser does.
     */
    fun record(place: Place) {
        if (cursor in entries.indices && entries[cursor] == place) return
        entries = (entries.subList(0, cursor + 1) + place).takeLast(MAX_ENTRIES)
        cursor = entries.size - 1
    }

    /**
     * The nearest earlier entry that is still worth showing, with the history moved onto it; null when there is none. Entries for
     * notes or groups that are gone are passed over but kept, so a forward step after a back step still lands where it should.
     */
    fun back(isValid: (Place) -> Boolean): Place? = step(-1, isValid)

    fun forward(isValid: (Place) -> Boolean): Place? = step(1, isValid)

    /** Whether a step in that direction would land anywhere (for dimming a button). */
    fun canGoBack(isValid: (Place) -> Boolean): Boolean = target(-1, isValid) != null

    fun canGoForward(isValid: (Place) -> Boolean): Boolean = target(1, isValid) != null

    private fun target(direction: Int, isValid: (Place) -> Boolean): Int? {
        var at = cursor + direction
        while (at in entries.indices) {
            if (isValid(entries[at])) return at
            at += direction
        }
        return null
    }

    private fun step(direction: Int, isValid: (Place) -> Boolean): Place? {
        val at = target(direction, isValid) ?: return null
        cursor = at
        return entries[at]
    }

    override fun equals(other: Any?): Boolean = other is NavigationHistory<*> && other.entries == entries && other.cursor == cursor

    override fun hashCode(): Int = entries.hashCode() * 31 + cursor

    override fun toString(): String = "NavigationHistory(entries=$entries, cursor=$cursor)"
}
