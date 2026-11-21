package com.rushinglabs.composition.core.markdown

/** A range of a note's text in UTF-16 units (what a text view counts in): the counterpart of the iPad's `NSRange`. */
data class TextRange(val location: Int, val length: Int) {
    val end get() = location + length
}

/** The smallest range holding both, from the earlier start to the later end: `NSUnionRange`. */
internal fun union(a: TextRange, b: TextRange): TextRange {
    val start = minOf(a.location, b.location)
    return TextRange(start, maxOf(a.end, b.end) - start)
}

/** Sorted, with ranges that overlap or touch made into one (the iPad's `HighlightModel.joined`). */
internal fun joined(ranges: List<TextRange>): List<TextRange> {
    val result = ArrayList<TextRange>()
    for (range in ranges.sortedBy { it.location }) {
        val last = result.lastOrNull()
        if (last != null && range.location <= last.end) result[result.lastIndex] = union(last, range) else result.add(range)
    }
    return result
}
