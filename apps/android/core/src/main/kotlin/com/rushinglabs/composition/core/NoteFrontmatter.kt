package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.yaml.JavaScriptText
import com.rushinglabs.composition.core.yaml.YamlMapping
import com.rushinglabs.composition.core.yaml.YamlReader
import com.rushinglabs.composition.core.yaml.YamlValue
import com.rushinglabs.composition.core.yaml.YamlWriter

// The YAML block at the top of a note (`---`, then `key: value` lines, then `---`): the desktop's `frontmatter.ts`, function for
// function, ported from NoteFrontmatter.swift. Every note ever saved carries a block written by it, so Android reads one exactly
// as the desktop does and, when it saves a note, writes the bytes the desktop would have written. A block that is not a YAML
// mapping, or that does not parse, leaves the note with no frontmatter, and the text stays as it is.

/** How a note's header image sits above its title: across the whole note, or at its own size in the middle. */
enum class HeaderImageLayout(val rawValue: String) {
    FULL("full"), CENTERED("centered");

    companion object {
        fun of(rawValue: String): HeaderImageLayout? = entries.firstOrNull { it.rawValue == rawValue }
    }
}

/** A picture shown above the note's title: `app_data/<name>` for a stored image, or an `https://` address. */
data class HeaderImage(val image: String, val layout: HeaderImageLayout = HeaderImageLayout.FULL)

data class Frontmatter(
    val title: String,
    val description: String = "",
    val tags: List<String> = emptyList(),
    val createdAt: String,
    val updatedAt: String,
    /** Absent (not empty) when the note has none, so a note without one is written exactly as it was before this existed. */
    val headerImage: HeaderImage? = null,
)

object NoteFrontmatter {
    /** The opening `---` line, a non-greedy YAML body, then the closing `---` line, anchored at the very start of the text. */
    private val block = Regex("""^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?""")

    private fun match(content: String): Pair<String, String>? {
        val found = block.find(content) ?: return null
        if (found.range.first != 0) return null
        return found.groupValues[1] to content.substring(found.range.last + 1)
    }

    private fun mapping(yaml: String): YamlMapping? =
        (runCatching { YamlReader.load(yaml) }.getOrNull() as? YamlValue.Mapping)?.mapping

    /**
     * `parse`: the frontmatter and the body after it; null and the whole text when there is no block at the very top, the block
     * is not a YAML mapping, or the YAML does not parse. It never fails: the block is free-form text a person edits.
     */
    fun parse(content: String): Pair<Frontmatter?, String> {
        val found = match(content) ?: return null to content
        val record = mapping(found.first) ?: return null to content
        var frontmatter = Frontmatter(
            title = asString(record["title"]),
            description = asString(record["description"]),
            tags = asTagList(record["tags"]),
            createdAt = dateOnly(asString(record["createdAt"])),
            updatedAt = dateOnly(asString(record["updatedAt"])),
        )
        val image = JavaScriptText.trim(asString(record["headerImage"]))
        if (image.isNotEmpty()) frontmatter = frontmatter.copy(headerImage = HeaderImage(image, asLayout(record["headerImageLayout"])))
        return frontmatter to found.second
    }

    /** The block's YAML text (without the dashes) and the body after it, with the same idea of a block as `parse`. */
    fun split(content: String): Pair<String?, String> {
        val found = match(content) ?: return null to content
        if (mapping(found.first) == null) return null to content
        return found.first to found.second
    }

    /** `strip`: the content with any leading frontmatter block removed. */
    fun strip(content: String): String = parse(content).second

    /** `generate`: a new block. */
    fun generate(title: String, createdAt: String, updatedAt: String, description: String = "", tags: List<String> = emptyList()): String =
        serialize(Frontmatter(title, description, tags, createdAt, updatedAt))

    /** `render`: content reassembled from a (possibly edited) frontmatter and a body. */
    fun render(frontmatter: Frontmatter, body: String): String = serialize(frontmatter) + body

    /** `withHeaderImage`: `content` with its header image set (null removes it), keeping everything else. */
    fun withHeaderImage(content: String, header: HeaderImage?, fallbackTitle: String, fallbackCreatedAt: String, fallbackUpdatedAt: String): String {
        val (parsed, body) = parse(content)
        val frontmatter = (parsed ?: Frontmatter(fallbackTitle, createdAt = fallbackCreatedAt, updatedAt = fallbackUpdatedAt)).copy(headerImage = header)
        return render(frontmatter, body)
    }

    /** A list of tags as the database keeps them: trimmed, without empty ones, joined by commas. */
    fun tagsToString(tags: List<String>): String = tags.map(JavaScriptText::trim).filter { it.isNotEmpty() }.joinToString(",")

    fun tagsFromString(tags: String): List<String> = tags.split(",").map(JavaScriptText::trim).filter { it.isNotEmpty() }

    private fun serialize(frontmatter: Frontmatter): String {
        val pairs = mutableListOf<Pair<String, YamlWriter.Value>>(
            "title" to YamlWriter.Value.Text(frontmatter.title),
            "description" to YamlWriter.Value.Text(frontmatter.description),
            "tags" to YamlWriter.Value.List(frontmatter.tags),
            "createdAt" to YamlWriter.Value.Text(dateOnly(frontmatter.createdAt)),
            "updatedAt" to YamlWriter.Value.Text(dateOnly(frontmatter.updatedAt)),
        )
        // After the keys every version has always written, and only when set.
        val header = frontmatter.headerImage
        if (header != null && header.image.isNotEmpty()) {
            pairs.add("headerImage" to YamlWriter.Value.Text(header.image))
            pairs.add("headerImageLayout" to YamlWriter.Value.Text(header.layout.rawValue))
        }
        // A bare date would be read back as a timestamp, so the writer quotes it; unquote it so the editor shows plain dates.
        val yaml = YamlWriter.dump(pairs).split("\n").joinToString("\n") { unquotedDate(it) }
        return "---\n$yaml---\n"
    }

    /** `createdAt: '2026-11-06'` → `createdAt: 2026-11-06` (the same for `updatedAt`); any other line is returned as it is. */
    private fun unquotedDate(line: String): String {
        for (key in listOf("createdAt: '", "updatedAt: '")) {
            if (!line.startsWith(key)) continue
            val rest = line.substring(key.length)
            if (rest.length != 11 || rest[10] != '\'' || !isDate(rest.substring(0, 10))) return line
            return key.dropLast(1) + rest.substring(0, 10)
        }
        return line
    }

    private fun isDate(text: String): Boolean {
        if (text.length != 10) return false
        for ((index, char) in text.withIndex()) {
            if (index == 4 || index == 7) { if (char != '-') return false } else if (char !in '0'..'9') return false
        }
        return true
    }

    /**
     * The frontmatter shows only the date; the full timestamp lives in the database. Takes the leading `YYYY-MM-DD` of an ISO
     * string as written (no time zone conversion); anything else is left alone.
     */
    internal fun dateOnly(value: String): String {
        val trimmed = JavaScriptText.trim(value)
        if (trimmed.length < 10 || !isDate(trimmed.substring(0, 10))) return value
        if (trimmed.length != 10 && trimmed[10] != 'T' && trimmed[10] != ' ') return value
        return trimmed.substring(0, 10)
    }

    /** JavaScript's `asString`: nothing is empty, a date is its ISO text, anything else is `String(value)`. */
    private fun asString(value: YamlValue?): String = when (value) {
        null, YamlValue.Null -> ""
        is YamlValue.Timestamp -> JavaScriptText.isoString(value.milliseconds)
        else -> JavaScriptText.string(value)
    }

    private fun asLayout(value: YamlValue?): HeaderImageLayout =
        HeaderImageLayout.of(JavaScriptText.trim(asString(value)).lowercase()) ?: HeaderImageLayout.FULL

    private fun asTagList(value: YamlValue?): List<String> = when (value) {
        is YamlValue.Sequence -> value.items.map { JavaScriptText.trim(JavaScriptText.string(it)) }.filter { it.isNotEmpty() }
        is YamlValue.Str -> tagsFromString(value.value)
        else -> emptyList()
    }
}
