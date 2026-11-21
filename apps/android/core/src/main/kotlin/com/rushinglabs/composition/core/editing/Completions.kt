package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.markdown.JS_SPACE
import com.rushinglabs.composition.core.markdown.insideFence
import com.rushinglabs.composition.core.yaml.JavaScriptText

// The completion lists: components after a `<` (`completions.ts`), the frontmatter's properties (`frontmatterProps.ts`) and Markdown
// snippets after a `/` (`snippets.ts`), and the order the editor asks them in (`useMdxCompletion.ts`). Ported from MdxCompletions.swift,
// FrontmatterCompletions.swift and MarkdownSnippets.swift. The props inside a tag are MdxProps.

/** One entry of a completion list: a component, a prop, a value or a snippet (the desktop's `MdxCompletion`). */
data class EditorCompletion(
    val name: String,
    /** How the list shows it, when that isn't `<name>` (a prop or a value, rather than a component). */
    val label: String? = null,
    /** One line shown under the name in the list. */
    val description: String,
    /** What replaces the `<` and whatever was typed after it; `$0` marks where the caret lands. */
    val template: String,
)

/** What a list is offered for at the caret: the text it replaces and the choices (the desktop's `PropTarget`). */
data class CompletionTarget(
    /** The text the choice replaces, and what has been typed of it. */
    val start: Int,
    val end: Int,
    val query: String,
    val items: List<EditorCompletion>,
    /** What the list is called for assistive technology. */
    val label: String,
)

/** What the editor offers after a `<`, one entry per allowed component: a port of `completions.ts`. */
object MdxCompletions {
    /** In the desktop's order, which is the order the list shows them in. */
    val all: List<EditorCompletion> = listOf(
        EditorCompletion("Info", description = "Callout for background a reader should notice", template = "<Info>\n\n\$0\n\n</Info>"),
        EditorCompletion("Warning", description = "Callout for something to be careful about", template = "<Warning>\n\n\$0\n\n</Warning>"),
        EditorCompletion("Image", description = "An image, same as ![alt](src)", template = "<Image src=\"\$0\" alt=\"\" />"),
        EditorCompletion("Drawio", description = "A draw.io diagram you can edit from the preview (Ctrl/Cmd+Shift+D draws a new one)", template = "<Drawio src=\"\$0\" alt=\"\" />"),
        EditorCompletion("Toc", description = "Table of contents that follows the note's headings", template = "<Toc />\$0"),
        EditorCompletion("Mark", description = "Highlighted text, in a colour", template = "<Mark color=\"yellow\">\$0</Mark>"),
        EditorCompletion("Footnotes", description = "Footnotes list, numbered by where they are cited", template = "<Footnotes />\$0"),
        EditorCompletion("YouTube", description = "A YouTube video you can watch in the preview", template = "<YouTube url=\"\$0\" />"),
        EditorCompletion("Repo", description = "A card linking to a git repository (GitHub, GitLab, …)", template = "<Repo url=\"\$0\" />"),
        EditorCompletion("Chart", description = "A bar, line, area or pie chart of a CSV table written inside the tag", template = "<Chart type=\"bar\">\n\n```csv\n\$0\n```\n\n</Chart>"),
        EditorCompletion("Sheet", description = "A spreadsheet-style grid of a CSV table written inside the tag", template = "<Sheet>\n\n```csv\n\$0\n```\n\n</Sheet>"),
    )

    data class Trigger(
        /** Where the `<` is. */
        val start: Int,
        /** What has been typed after it. */
        val query: String,
    )

    /** The text to insert for a completion, and the caret's offset within it (-1 when the template has no `$0`). */
    data class Expansion(val text: String, val caret: Int)

    // A `<` that starts a tag: not glued to a word (`a<b`) and not part of `<<`. `\z`, since a JVM's `$` would also match before a `\r`.
    private val openTag = Regex("""(?:^|[^A-Za-z0-9_<])<([A-Za-z]*)\z""")

    /** The `<` the caret is just after, if the user is starting a tag there. Nothing is offered inside a fenced code block, where `<` is just text. */
    fun findTrigger(text: String, caret: Int): Trigger? {
        val lineStart = JS.lineStart(text, caret)
        val line = JS.slice(text, lineStart, caret)
        val query = openTag.find(line)?.groupValues?.get(1) ?: return null
        if (insideFence(text, lineStart)) return null
        return Trigger(caret - query.length - 1, query)
    }

    /** The components whose name starts with what was typed, ignoring case. */
    fun match(query: String): List<EditorCompletion> {
        val typed = query.lowercase()
        return all.filter { it.name.lowercase().startsWith(typed) }
    }

    fun expand(completion: EditorCompletion): Expansion {
        val marker = completion.template.indexOf("\$0")
        if (marker < 0) return Expansion(completion.template, -1)
        return Expansion(completion.template.removeRange(marker, marker + 2), marker)
    }

    /**
     * What the list offers at the caret, in the desktop's order: components after a `<`, else the props and values inside a component's
     * tag, else the frontmatter's properties, else the Markdown snippets after a `/` (`useMdxCompletion.ts`'s `findTarget`).
     */
    fun target(text: String, caret: Int): CompletionTarget? {
        findTrigger(text, caret)?.let { return CompletionTarget(it.start, caret, it.query, match(it.query), "MDX components") }
        return MdxProps.findTarget(text, caret) ?: FrontmatterCompletions.findTarget(text, caret) ?: MarkdownSnippets.findTarget(text, caret)
    }
}

/** The properties a note's frontmatter understands, offered on an empty line of its block: a port of `frontmatterProps.ts`. */
object FrontmatterCompletions {
    private class Property(val name: String, val description: String, val template: String)

    /** None is required; the list only offers what's missing. */
    private val properties = listOf(
        Property("title", "The note's title", "title: \$0"),
        Property("description", "A one-line summary of the note", "description: \$0"),
        Property("tags", "Labels for finding the note, e.g. [work, ideas]", "tags: [\$0]"),
        Property("createdAt", "The day the note was made (YYYY-MM-DD)", "createdAt: \$0"),
        Property("updatedAt", "The day the note last changed (YYYY-MM-DD)", "updatedAt: \$0"),
        Property("headerImage", "Picture above the title: app_data/… or a web address", "headerImage: \$0"),
        Property("headerImageLayout", "full, or centered at its own size", "headerImageLayout: \$0"),
    )

    private val opening = Regex("""^---\r?\n""")
    private val closing = Regex("""\r?\n---[ \t]*(?:\r?\n|\z)""")
    private val key = Regex("""^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:""")
    private val letters = Regex("""^[A-Za-z]*\z""")

    /**
     * What to offer when the caret is on an otherwise empty line of the note's frontmatter block, or part-way through typing a property
     * name there: the known properties the block doesn't have yet. Null anywhere else.
     */
    fun findTarget(text: String, caret: Int): CompletionTarget? {
        val open = opening.find(text) ?: return null
        val openLength = open.value.length
        if (caret < openLength) return null
        // The search starts on the opening line's own line break, which the closing line may share.
        val close = closing.find(text, openLength - 1) ?: return null
        // An unfinished block isn't frontmatter yet, and the closing line itself isn't inside it.
        if (caret > close.range.first) return null

        val lineStart = JS.lineStart(text, caret)
        val found = JS.index('\n', text, caret)
        val lineEnd = if (found == -1) text.length else found
        val query = JS.slice(text, lineStart, caret)
        if (!letters.matches(query) || JavaScriptText.trim(JS.slice(text, caret, lineEnd)).isNotEmpty()) return null

        val block = JS.slice(text, openLength, close.range.first)
        val present = HashSet<String>()
        var offset = openLength
        for (line in block.split('\n')) {
            if (offset != lineStart) key.find(line)?.let { present.add(it.groupValues[1]) }
            offset += line.length + 1
        }

        val typed = query.lowercase()
        val items = properties.filter { it.name !in present && it.name.lowercase().startsWith(typed) }
            .map { EditorCompletion(it.name, it.name, it.description, it.template) }
        return CompletionTarget(lineStart, caret, query, items, "Frontmatter properties")
    }
}

/** Pre-formatted Markdown offered after a `/`: a port of `snippets.ts`. `$0` marks where the caret lands. */
object MarkdownSnippets {
    private class Snippet(val name: String, val description: String, val template: String)

    private val all = listOf(
        Snippet("table", "A 3-column table with a header and two rows", "| \$0Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n"),
        Snippet("codeblock", "A fenced code block", "```\n\$0\n```\n"),
        Snippet("tasks", "A task list", "- [ ] \$0\n- [ ] \n- [ ] \n"),
        Snippet("divider", "A horizontal rule", "---\n\n\$0"),
    )

    // A `/` at the start of a line or after white space (JavaScript's), with letters typed after it.
    private val slash = Regex("""(?:^|$JS_SPACE)/([A-Za-z]*)\z""")

    /**
     * What to offer when the caret is just after a `/` that starts a word: the snippets whose name starts with what was typed. Null
     * anywhere else: inside a word like `and/or`, or in a fenced code block.
     */
    fun findTarget(text: String, caret: Int): CompletionTarget? {
        val lineStart = JS.lineStart(text, caret)
        val line = JS.slice(text, lineStart, caret)
        val query = slash.find(line)?.groupValues?.get(1) ?: return null
        if (insideFence(text, lineStart)) return null
        val typed = query.lowercase()
        val items = all.filter { it.name.startsWith(typed) }.map { EditorCompletion(it.name, "/${it.name}", it.description, it.template) }
        return CompletionTarget(caret - query.length - 1, caret, query, items, "Markdown snippets")
    }
}
