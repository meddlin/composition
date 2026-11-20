package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.markdown.JS_SPACE
import com.rushinglabs.composition.core.markdown.insideFence
import com.rushinglabs.composition.core.yaml.JavaScriptText

/** Links from one note to another, written as `[title](note:id)`: a port of `noteRefs.ts` and `noteLinks.ts`, from NoteLinks.swift. */
object NoteLinks {
    /** How many notes the picker lists at once. */
    const val MAX_PICKER_NOTES = 8

    /** The scheme in a link's target. */
    const val SCHEME = "note:"

    /** The largest integer JavaScript holds exactly. */
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

    data class Trigger(
        /** Where the `[[` is. */
        val start: Int,
        /** What has been typed after it. */
        val query: String,
    )

    /** A note to offer: its id and title (an empty title reads as "Untitled"). */
    data class Candidate(val id: Long, val title: String) {
        internal val shownTitle: String get() = JavaScriptText.trim(title).ifEmpty { "Untitled" }
    }

    /** The Markdown target for a note's id. */
    fun ref(id: Long): String = "$SCHEME$id"

    private val target = Regex("""^note:([0-9]+)\z""")

    /** The note id a link target refers to, or null when it isn't a note link. */
    fun id(href: String): Long? {
        val digits = target.find(href)?.groupValues?.get(1) ?: return null
        return digits.toLongOrNull()?.takeIf { it <= MAX_SAFE_INTEGER }
    }

    private val lineBreaks = Regex("""$JS_SPACE*[\r\n]+$JS_SPACE*""")

    /** Link text is bracketed, so a bracket or backslash in it has to be escaped; a line break would split the link. */
    private fun escapeLinkText(text: String): String {
        val out = StringBuilder()
        for (c in text.replace(lineBreaks, " ")) {
            if (c == '\\' || c == '[' || c == ']') out.append('\\')
            out.append(c)
        }
        return out.toString()
    }

    /** `[label](note:id)`, ready to put into a note. */
    fun link(label: String, id: Long): String = "[${escapeLinkText(JavaScriptText.trim(label).ifEmpty { "Untitled" })}](${ref(id)})"

    /** The Markdown to insert for a note; `label` is the words the link should show, the note's title when absent. */
    fun link(note: Candidate, label: String? = null): String {
        val words = label?.let(JavaScriptText::trim) ?: ""
        return link(words.ifEmpty { note.shownTitle }, note.id)
    }

    // `[[` and what follows it up to the caret, with no bracket or line break in between.
    private val openLink = Regex("""\[\[([^\[\]\n]*)\z""")

    /** The `[[` the caret is just after, if the user is starting a note link there. Nothing is offered inside a fenced code block. */
    fun findTrigger(text: String, caret: Int): Trigger? {
        val lineStart = JS.lineStart(text, caret)
        val line = JS.slice(text, lineStart, caret)
        val query = openLink.find(line)?.groupValues?.get(1) ?: return null
        if (insideFence(text, lineStart)) return null
        return Trigger(caret - query.length - 2, query)
    }

    /**
     * The notes the picker offers for what was typed: those whose title contains it (ignoring case), the ones that start with it first.
     * `excluding` is the note being edited, which there is no point linking to.
     */
    fun match(notes: List<Candidate>, query: String, excluding: Long? = null): List<Candidate> {
        val typed = JavaScriptText.trim(query).lowercase()
        val starts = ArrayList<Candidate>()
        val contains = ArrayList<Candidate>()
        for (note in notes) {
            if (note.id == excluding) continue
            // `title.indexOf("")` is 0, so with nothing typed every note starts with it.
            when (note.shownTitle.lowercase().indexOf(typed)) {
                0 -> starts.add(note)
                -1 -> {}
                else -> contains.add(note)
            }
        }
        return (starts + contains).take(MAX_PICKER_NOTES)
    }
}
