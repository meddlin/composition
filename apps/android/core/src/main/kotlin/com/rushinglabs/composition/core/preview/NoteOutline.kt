package com.rushinglabs.composition.core.preview

import com.rushinglabs.composition.core.NoteFrontmatter
import com.rushinglabs.composition.core.markdown.NoteScanner

// The outline of a note, ported from the iPad's NoteOutline.swift: its headings in order, for the heading rail (the iPad's Outline popover;
// the desktop's `HeadingRail`). A tap on one scrolls to it, in the preview by `ordinal` (the number `MdBlock.Heading` carries, which is also
// what `<Toc />` scrolls to) and in the editor by `offset`.
//
// The labels and the numbering are the preview's (`NoteScanner`'s headings, which agree with the desktop's); the places in the text are
// the editor's reading of the same text (`MarkdownHighlighter`, which is what colours it). They agree on a plain Markdown note. Where a
// component tag makes them differ (the editor reads `<Info>` followed by `## Title` with no blank line as raw HTML, the preview as a
// heading inside the panel), a heading is paired with the next one of the same level, and one without a partner has no `offset`.

data class OutlineHeading(
    /** The heading's number among the note's headings, counted from 0. */
    val ordinal: Int,
    /** 1 to 6. */
    val level: Int,
    /** The heading's words with no marks; empty for `#` alone. */
    val text: String,
    /** Where its first character is in the note's whole text (frontmatter included), in UTF-16 units; null when the editor sees no such heading. */
    val offset: Int?,
) {
    val id get() = ordinal
}

object NoteOutline {
    /** The headings of a note's stored text (frontmatter and all). */
    fun make(content: String): List<OutlineHeading> {
        val scanned = NoteScanner.scan(NoteFrontmatter.split(content).second).headings
        if (scanned.isEmpty()) return emptyList()
        val found = MarkdownHighlighter.spans(content).mapNotNull { span ->
            (span.kind as? HighlightKind.Heading)?.let { span.range.location to it.level }
        }
        var next = 0
        return scanned.mapIndexed { ordinal, heading ->
            var offset: Int? = null
            val at = (next until found.size).firstOrNull { found[it].second == heading.depth }
            if (at != null) {
                offset = found[at].first
                next = at + 1
            }
            OutlineHeading(ordinal, heading.depth, heading.text, offset)
        }
    }

    /**
     * The heading being read when the first visible character of the text is at `offset`: the last heading at or before it, or the first
     * heading when none is. Null when no heading has a place.
     */
    fun current(headings: List<OutlineHeading>, offset: Int): OutlineHeading? {
        val placed = headings.filter { it.offset != null }
        return placed.lastOrNull { it.offset!! <= offset } ?: placed.firstOrNull()
    }
}
