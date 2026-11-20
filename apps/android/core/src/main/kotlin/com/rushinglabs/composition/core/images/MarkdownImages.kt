package com.rushinglabs.composition.core.images

import com.rushinglabs.composition.core.markdown.JS_ANY
import com.rushinglabs.composition.core.markdown.JS_SPACE
import com.rushinglabs.composition.core.markdown.JS_SPACE_CHARS
import com.rushinglabs.composition.core.markdown.insideFence

/**
 * The edit that turns Markdown images into `<Image />` tags: a port of `imageToMdx.ts`, from MarkdownImages.swift. Offsets are UTF-16
 * units, as in the desktop's JavaScript and in a Kotlin `String`.
 */
data class ImageConversion(
    /** The stretch of the note to replace, and what to put there. */
    val start: Int,
    val end: Int,
    val text: String,
    /** Where the caret goes within `text`: at the end of the last tag's attributes, ready for another one. */
    val caret: Int,
)

object MarkdownImages {
    // `![alt](src)` and `![alt](src "title")`. An address with spaces or parentheses (or in `<…>`) is left alone. `\s` and `.` are
    // spelled out as JavaScript means them.
    private val image =
        Regex("""!\[((?:[^\]\[\\\n]|\\$JS_ANY)*)\]\($JS_SPACE*([^$JS_SPACE_CHARS()<>]*)(?:$JS_SPACE+"((?:[^"\\\n]|\\$JS_ANY)*)")?$JS_SPACE*\)""")
    private val escape = Regex("""\\([!-/:-@\[-`{-~])""")
    // An `&` that already starts a character reference means that reference; any other one is just an ampersand.
    private val bareAmpersand = Regex("&(?!(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)")
    private const val CLOSING_TAG = " />"

    /** A Markdown string as the inside of a double-quoted JSX attribute: escapes undone, `"` and bare `&` written as references. */
    private fun attribute(markdown: String): String =
        markdown.replace(escape, "\$1").replace(bareAmpersand, "&amp;").replace("\"", "&quot;")

    /** Whether `index` sits in a fenced code block or an inline code span, where `![](…)` is just text. */
    private fun insideCode(text: String, index: Int): Boolean {
        val lineStart = text.lastIndexOf('\n', index - 1) + 1
        if (insideFence(text, lineStart)) return true
        return text.substring(lineStart, index).count { it == '`' } % 2 == 1
    }

    private class Found(val start: Int, val end: Int, val tag: String)

    /**
     * The edit that turns the Markdown images at the caret, or touched by the selection, into `<Image src alt />` tags, which can say how
     * wide to be. Null when there is no such image. The caret counts as on an image anywhere from its `!` to just after its `)`; a
     * selection takes every image it overlaps, so it can convert a whole note's worth at once (select all).
     */
    fun toMdx(text: String, selectionStart: Int, selectionEnd: Int): ImageConversion? {
        val found = ArrayList<Found>()
        for (match in image.findAll(text)) {
            val start = match.range.first
            val end = match.range.last + 1
            val touched = if (selectionStart == selectionEnd) start <= selectionStart && selectionStart <= end
            else start < selectionEnd && selectionStart < end
            if (!touched || insideCode(text, start)) continue
            val alt = match.groups[1]?.value ?: ""
            val src = match.groups[2]?.value ?: ""
            val title = match.groups[3]?.value
            val tag = StringBuilder("<Image src=\"${attribute(src)}\" alt=\"${attribute(alt)}\"")
            if (title != null) tag.append(" title=\"${attribute(title)}\"")
            found.add(Found(start, end, tag.append(CLOSING_TAG).toString()))
        }
        val first = found.firstOrNull() ?: return null

        // Everything between the first and the last stays as it was.
        val converted = StringBuilder()
        var from = first.start
        for (item in found) {
            converted.append(text, from, item.start).append(item.tag)
            from = item.end
        }
        return ImageConversion(first.start, from, converted.toString(), converted.length - CLOSING_TAG.length)
    }
}
