package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.images.StoredImages
import java.io.File

/**
 * The `<Ink>` tag a note holds: where its drawing's PNG is, and how wide to show it. Like `<Drawio>`, the picture is a stored image and
 * the tag only names it, so a note stays Markdown and the CLI and desktop show the PNG (docs/architecture/ink.md). Ported from
 * InkTag.swift.
 */
object InkTag {
    /** The `alt` of a drawing nobody has put words to. */
    const val DEFAULT_ALT = "Drawing"

    /**
     * `<Ink src="app_data/…" alt="Drawing" />`: no `width`, so the drawing is shown at the size of its page (never wider than the
     * column), which is its ink and a margin (`InkCrop`). A reader who wants it narrower writes `width="50%"`.
     */
    fun markdown(forName: String, alt: String = DEFAULT_ALT, width: String? = null): String =
        "<Ink src=\"${StoredImages.ref(forName)}\" alt=\"${attribute(alt)}\"" + (width?.let { " width=\"$it\"" } ?: "") + " />"

    /**
     * The note's text with the `alt` of every `<Ink>` that shows `name` made `transcript` (or "Drawing" when there is none), **if it was
     * never put in words by a person**: it is empty, the default, or `previous`, the words this program read from the drawing before it
     * was edited. Words a person wrote or changed are theirs and stay.
     */
    fun refreshingAlt(ofDrawing: String, previous: String?, transcript: String, text: String): String {
        val new = attribute(transcript.ifEmpty { DEFAULT_ALT })
        val source = "src=\"${StoredImages.ref(ofDrawing)}\""
        val tags = tagRanges(text)
        if (tags.isEmpty()) return text
        val result = StringBuilder(text)
        // Last tag first, so the ranges of the earlier ones stay where they are.
        for (tag in tags.asReversed()) {
            val markup = text.substring(tag.first, tag.last + 1)
            if (!markup.contains(source)) continue
            val alt = altValueRange(markup) ?: continue
            val current = markup.substring(alt.first, alt.last + 1)
            if (!(current.isEmpty() || current == DEFAULT_ALT || (previous != null && previous.isNotEmpty() && current == previous))) continue
            result.replace(tag.first + alt.first, tag.first + alt.last + 1, new)
        }
        return result.toString()
    }

    /** The note's text with one stored drawing named in place of another, wherever it is referred to (the drawing was edited: its new PNG has a new name). */
    fun replacing(old: String, new: String, text: String): String = text.replace(StoredImages.ref(old), StoredImages.ref(new))

    /** The ink a stored PNG carries, if any. */
    fun contents(ofFile: File): InkPng.Contents? {
        if (ofFile.extension.lowercase() != "png") return null
        val data = try {
            ofFile.readBytes()
        } catch (_: Exception) {
            return null
        }
        val contents = try {
            InkPng.contents(data)
        } catch (_: InkError) {
            return null
        }
        return contents.takeIf { it.strokeJson != null || it.pencilKit != null }
    }

    /**
     * What an attribute can hold: no quotes, angle brackets or line breaks. Swift filters `Character`s, so there a `\r\n` pair (one
     * character, which is neither `\r` nor `\n`) stays; here both go, as was meant.
     */
    private fun attribute(text: String): String = text.filter { it != '"' && it != '\n' && it != '\r' && it != '<' && it != '>' }

    /**
     * Where each `<Ink\b[^>]*>` is, as the Swift's `NSRegularExpression` finds them, left to right and not overlapping (inclusive ranges).
     * `\b` is written out (`isWordCharacter`): a JVM's and Android's regex `\b` disagree outside ASCII.
     */
    private fun tagRanges(text: String): List<IntRange> {
        val out = ArrayList<IntRange>()
        var from = 0
        while (true) {
            val start = text.indexOf("<Ink", from)
            if (start < 0) break
            val after = start + 4
            if (after < text.length && isWordCharacter(text[after])) {
                from = start + 1
                continue
            }
            val end = text.indexOf('>', after)
            if (end < 0) break
            out.add(start..end)
            from = end + 1
        }
        return out
    }

    /** The first `\balt="([^"]*)"` in a tag: the range of what is between the quotes (inclusive, and empty when they are side by side). */
    private fun altValueRange(markup: String): IntRange? {
        var from = 0
        while (true) {
            val start = markup.indexOf("alt=\"", from)
            if (start < 0) return null
            if (start == 0 || !isWordCharacter(markup[start - 1])) {
                val open = start + 5
                val close = markup.indexOf('"', open)
                if (close >= 0) return open until close
            }
            from = start + 1
        }
    }

    /** ICU's `\w`, which `NSRegularExpression`'s `\b` is the edge of: letters, marks, digits, connector punctuation and the joiners. */
    private fun isWordCharacter(c: Char): Boolean = Character.isAlphabetic(c.code) || Character.isDigit(c) ||
        when (Character.getType(c).toByte()) {
            Character.NON_SPACING_MARK, Character.ENCLOSING_MARK, Character.COMBINING_SPACING_MARK, Character.CONNECTOR_PUNCTUATION -> true
            else -> c == '\u200C' || c == '\u200D'
        }
}
