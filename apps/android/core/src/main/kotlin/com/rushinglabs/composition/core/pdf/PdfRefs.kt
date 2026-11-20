package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.yaml.JavaScriptText

// How a note's Markdown points at a PDF, a page of it, or a mark on it, ported from PdfRefs.swift: the twin of `pdfRefs.ts`
// (docs/pdf-markup-plan.md, "Notes and citations"). A citation is ordinary Markdown whose target is `pdf:<uuid>` with an optional fragment:
//
//   [*Designing Data*, p. 42](pdf:3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a#p=44&a=7b1d…)
//
// The document is named by its uuid, not its id, so a note never has to be rewritten when two devices meet. `p` is the physical page
// (counted from 1); the words in the brackets show the printed page label when the PDF has one. `a` is a mark's uuid. Both are optional.
// The desktop's own code writes `fixtures/conformance/pdf-refs.json` (apps/ios/scripts/pdf-refs-oracle.mjs) and PdfRefsConformanceTests
// replays it, so what this writes into a note is what the desktop writes, and what it reads is what the desktop reads.
//
// Every character the rules name is ASCII, so the text is walked in UTF-16 units, as JavaScript walks it.

/** What a `pdf:` target names: the PDF, and optionally a page (from 1) and a mark. */
data class PdfRef(val uuid: String, val page: Int? = null, val mark: String? = null)

/** What the notes that cite a PDF say of it, found by reading their text. */
data class PdfCitations(val pages: List<Int> = emptyList(), val marks: List<String> = emptyList())

/** A note that belongs with a PDF: its owner, or one whose text links to it. */
data class PdfCitation(val noteId: Long, val title: String, val owner: Boolean, val pages: List<Int> = emptyList(), val marks: List<String> = emptyList())

/** The text of a note, with when it last changed: what `PdfRefs.citations(notes, …)` reads. */
data class PdfNoteText(val id: Long, val title: String, val content: String, val updatedAt: String)

object PdfRefs {
    /** The scheme in a link's target. */
    const val SCHEME = "pdf:"

    // Reading a target --------------------------------------------------------------------------------------------------------------

    private fun isLowerHex(c: Char) = c in '0'..'9' || c in 'a'..'f'

    /** `[0-9a-f]{32}` */
    internal fun isUuid(text: String): Boolean = text.length == 32 && text.all(::isLowerHex)

    /** JavaScript's `.`: anything but a line terminator. */
    private fun isLineTerminator(c: Char) = c == '\n' || c == '\r' || c == '\u2028' || c == '\u2029'

    /** `/^[1-9]\d{0,6}$/` */
    private fun pageNumber(text: String): Int? {
        if (text.length !in 1..7 || text[0] !in '1'..'9' || !text.all { it in '0'..'9' }) return null
        return text.toInt()
    }

    /** The page and mark of a fragment; a part that is not a page or a mark's uuid is dropped, and so is a key nobody knows. */
    private fun parseFragment(fragment: String?): Pair<Int?, String?> {
        var page: Int? = null
        var mark: String? = null
        for (part in (fragment ?: "").split("&")) {
            // `part.split("=")`: the first two pieces are the key and the value; a third is ignored.
            val pieces = part.split("=", limit = 3)
            val key = pieces[0]
            val value = pieces.getOrElse(1) { "" }
            val number = if (key == "p") pageNumber(value) else null
            if (number != null) {
                page = number
            } else if (key == "a" && isUuid(value)) {
                mark = value
            }
        }
        return page to mark
    }

    /** What a link target names, or null when it is not a `pdf:` link. */
    fun parse(href: String): PdfRef? {
        if (href.length < SCHEME.length + 32 || !href.startsWith(SCHEME)) return null
        val uuid = href.substring(SCHEME.length, SCHEME.length + 32)
        if (!isUuid(uuid)) return null
        val rest = href.substring(SCHEME.length + 32)
        if (rest.isEmpty()) return PdfRef(uuid)
        if (rest[0] != '#' || rest.drop(1).any(::isLineTerminator)) return null
        val (page, mark) = parseFragment(rest.substring(1))
        return PdfRef(uuid, page, mark)
    }

    // Writing a target --------------------------------------------------------------------------------------------------------------

    /** The Markdown target for a PDF, with the page and mark when there are any. */
    fun ref(uuid: String, page: Int? = null, mark: String? = null): String {
        val parts = ArrayList<String>()
        if (page != null) parts.add("p=$page")
        if (mark != null) parts.add("a=$mark")
        return SCHEME + uuid + (if (parts.isEmpty()) "" else "#" + parts.joinToString("&"))
    }

    /** Markdown's own punctuation, and the characters MDX reads as the start of a tag or an expression, made literal. */
    private const val SPECIAL = "\\`*_{}[]<>~|"

    /** Text from a PDF made safe to put into a note: it shows as itself and starts nothing (a tag, emphasis, a heading, a list). */
    fun escapeMarkdown(text: String): String {
        val escaped = StringBuilder()
        for (c in text) {
            if (c in SPECIAL) escaped.append('\\')
            escaped.append(c)
        }
        // `.replace(/^(\s*)([#+-]|\d+[.)])(?=\s|$)/, "$1\\$2")`: a line that would start a heading or a list is made literal.
        var lead = 0
        while (lead < escaped.length && JavaScriptText.isWhitespace(escaped[lead].code)) lead += 1
        var end = lead
        if (end < escaped.length && (escaped[end] == '#' || escaped[end] == '+' || escaped[end] == '-')) {
            end += 1
        } else {
            var digits = end
            while (digits < escaped.length && escaped[digits] in '0'..'9') digits += 1
            if (digits > end && digits < escaped.length && (escaped[digits] == '.' || escaped[digits] == ')')) end = digits + 1
        }
        if (end > lead && (end == escaped.length || JavaScriptText.isWhitespace(escaped[end].code))) escaped.insert(lead, '\\')
        return escaped.toString()
    }

    /** The page as a reader names it: the printed label when the PDF has one, else the physical number. */
    fun pageLabel(page: Int, labels: List<String>?): String {
        if (labels != null && page >= 1 && page <= labels.size) {
            val label = JavaScriptText.trim(labels[page - 1])
            if (label.isNotEmpty()) return label
        }
        return page.toString()
    }

    /** `text.replace(/\s+/g, " ").trim()`: runs of white space become one space, in the JavaScript sense of white space. */
    fun collapse(text: String): String {
        val out = StringBuilder()
        var inRun = false
        for (c in text) {
            if (JavaScriptText.isWhitespace(c.code)) {
                if (!inRun) out.append(' ')
                inRun = true
            } else {
                out.append(c)
                inRun = false
            }
        }
        return JavaScriptText.trim(out.toString())
    }

    /** What a citation of a page says: `Title, p. 42`, with the title in italics. */
    private fun citationText(title: String, page: Int, labels: List<String>?): String {
        val name = collapse(title)
        return (if (name.isEmpty()) "" else "*${escapeMarkdown(name)}*, ") + "p. ${escapeMarkdown(pageLabel(page, labels))}"
    }

    /** `[Title](pdf:…)`, a link to the whole PDF, for the first line of a note made for it. */
    fun link(uuid: String, title: String): String {
        val name = collapse(title)
        return "[${escapeMarkdown(name.ifEmpty { "PDF" })}](${ref(uuid)})"
    }

    /** `[Title, p. 42](pdf:…#p=44)`, ready to put into a note. */
    fun pageCitation(uuid: String, title: String, page: Int, labels: List<String>? = null): String =
        "[${citationText(title, page, labels)}](${ref(uuid, page)})"

    /**
     * A quote from a PDF as a block quote with its citation:
     *
     *     > The selected text.
     *     >
     *     > — [*Title*, p. 42](pdf:…#p=44&a=…)
     *
     * The empty quoted line makes the citation a paragraph of its own. The words are copied in, so the note still reads when the PDF is gone.
     */
    fun quoteBlock(uuid: String, title: String, quote: String, page: Int, mark: String?, labels: List<String>? = null): String {
        val words = collapse(quote)
        val cite = "[${citationText(title, page, labels)}](${ref(uuid, page, mark)})"
        return (if (words.isEmpty()) "" else "> ${escapeMarkdown(words)}\n>\n") + "> — $cite"
    }

    // Reading a note ----------------------------------------------------------------------------------------------------------------

    /** The pages and marks of `uuid` that a note's text cites, each once, in the order they first appear. */
    fun citations(text: String, uuid: String): PdfCitations {
        val pages = ArrayList<Int>()
        val marks = ArrayList<String>()
        for ((found, fragment) in references(text)) {
            if (found != uuid) continue
            val (page, mark) = parseFragment(fragment)
            if (page != null && page !in pages) pages.add(page)
            if (mark != null && mark !in marks) marks.add(mark)
        }
        return PdfCitations(pages, marks)
    }

    /** Whether a note's text cites the PDF at all. */
    fun cites(text: String, uuid: String): Boolean = text.contains(SCHEME + uuid)

    /** `/pdf:([0-9a-f]{32})(?:#([^\s)]*))?/g`: every `pdf:` target in a text, left to right. */
    private fun references(text: String): List<Pair<String, String?>> {
        val found = ArrayList<Pair<String, String?>>()
        var at = 0
        while (at + SCHEME.length + 32 <= text.length) {
            if (!text.startsWith(SCHEME, at) || !(at + SCHEME.length until at + SCHEME.length + 32).all { isLowerHex(text[it]) }) {
                at += 1
                continue
            }
            val uuid = text.substring(at + SCHEME.length, at + SCHEME.length + 32)
            var end = at + SCHEME.length + 32
            var fragment: String? = null
            if (end < text.length && text[end] == '#') {
                var stop = end + 1
                while (stop < text.length && !JavaScriptText.isWhitespace(text[stop].code) && text[stop] != ')') stop += 1
                fragment = text.substring(end + 1, stop)
                end = stop
            }
            found.add(uuid to fragment)
            at = end
        }
        return found
    }

    /**
     * The notes that belong with a PDF: its owner first (whether or not its text links to it), then every other note whose text does, the
     * most recently changed first, each with the pages and marks its links name.
     */
    fun citations(notes: List<PdfNoteText>, documentUuid: String, ownerNoteId: Long): List<PdfCitation> {
        val found = ArrayList<Pair<PdfCitation, String>>()
        for (note in notes) {
            val owner = note.id == ownerNoteId
            if (!owner && !cites(note.content, documentUuid)) continue
            val named = citations(note.content, documentUuid)
            found.add(PdfCitation(note.id, note.title, owner, named.pages, named.marks) to note.updatedAt)
        }
        val others = found.filter { !it.first.owner }.sortedWith(compareByDescending<Pair<PdfCitation, String>> { it.second }.thenByDescending { it.first.noteId })
        return found.filter { it.first.owner }.map { it.first } + others.map { it.first }
    }
}
