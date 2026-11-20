package com.rushinglabs.composition.core.readinglist

import com.rushinglabs.composition.core.SettingsStore
import com.rushinglabs.composition.core.yaml.JavaScriptText
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The Reading List's pure rules: a port of the desktop's `readingList.ts` and the two limits in `readingListApi.ts`
// (docs/reading-list-plan.md, R4 to R6 and R9), by way of ReadingLinks.swift. `fixtures/conformance/reading-list.json` holds what the
// desktop's code answers for each of them; `ReadingListConformanceTests` replays it.

/** One link in the Reading List. `title` is empty until its page has been opened and said what it is called. */
data class ReadingItem(
    val id: Long,
    /** Always an absolute `http:` or `https:` address, as `ReadingLinks.normalize` writes it. */
    val url: String,
    val title: String = "",
    val read: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = "",
) {
    /** What a row is called: the page's title when it has one, else the host. */
    val label: String get() = ReadingLinks.label(url, title)

    /** The host, without a leading `www.`. */
    val host: String get() = ReadingLinks.hostLabel(url)
}

object ReadingLinks {
    /** The longest a link may be, in UTF-16 units as JavaScript counts a string's length. */
    const val MAX_URL_LENGTH = 2048

    /** The longest a stored title may be, in UTF-16 units; a longer page title is cut. */
    const val MAX_TITLE_LENGTH = 300

    /** The Reading List's id among the desktop's plugins (`plugins.ts`), the key in `settings.json`'s `plugins`. */
    const val PLUGIN_ID = "reading-list"

    /** Why a link was not taken, in the desktop's words. */
    enum class Problem(val message: String) {
        EMPTY("Paste a link to add."),
        TOO_LONG("That link is too long."),
        NOT_WEB("Only web links (http or https) can be added."),
        NOT_A_LINK("That does not look like a link."),
        HAS_CREDENTIALS("Remove the user name and password from the link."),
    }

    /** What `normalize` makes of a link: the address to store, or why it was not taken. */
    sealed interface Normalized {
        data class Link(val url: String) : Normalized
        data class Refused(val problem: Problem) : Normalized
    }

    /** The schemes named without `//`, which the "no scheme, so add https://" rule must not mistake for a host and port. */
    private val opaqueSchemes = listOf("javascript", "data", "file", "blob", "about", "mailto", "tel", "vbscript", "view-source", "chrome", "devtools", "app")

    /**
     * A link as it is stored (`normalizeReadingUrl`): trimmed, `https://` added when there is no scheme, the fragment dropped. Only
     * `http:` and `https:` pass, because the address becomes a navigation in a web view.
     */
    fun normalize(input: String): Normalized {
        val text = JavaScriptText.trim(input)
        if (text.isEmpty()) return Normalized.Refused(Problem.EMPTY)
        if (text.length > MAX_URL_LENGTH) return Normalized.Refused(Problem.TOO_LONG)
        val lowered = WebAddress.asciiLower(text)
        if (opaqueSchemes.any { lowered.startsWith("$it:") }) return Normalized.Refused(Problem.NOT_WEB)
        val parsed = WebAddress.parse(if (hasSchemeWithSlashes(text)) text else "https://$text") ?: return Normalized.Refused(Problem.NOT_A_LINK)
        if (parsed.scheme != "http" && parsed.scheme != "https") return Normalized.Refused(Problem.NOT_WEB)
        if (parsed.hostname == "") return Normalized.Refused(Problem.NOT_A_LINK)
        if (parsed.username != "" || parsed.password != "") return Normalized.Refused(Problem.HAS_CREDENTIALS)
        return Normalized.Link(parsed.href)
    }

    /** What to call a link until its page has said (`hostLabel`): the host name without a leading `www.`; the address itself when it has none. */
    fun hostLabel(url: String): String {
        val parsed = WebAddress.parse(url) ?: return url
        var host = parsed.hostname
        if (host.length >= 4 && WebAddress.asciiLower(host.substring(0, 4)) == "www.") host = host.substring(4)
        return host.ifEmpty { url }
    }

    /** What a row is called (`readingItemLabel`): the page's title when it has one, else the host. */
    fun label(url: String, title: String): String = title.ifEmpty { hostLabel(url) }

    /**
     * A page title as it is stored (`cleanReadingTitle`): on one line, trimmed, cut at the limit. Null when nothing is left.
     *
     * JavaScript cuts by UTF-16 unit, so a cut can fall between the two halves of a character outside the Basic Multilingual Plane. The
     * desktop's SQLite driver then stores the half as one U+FFFD under Node 24 and later (three under Node 22); one is written here. A
     * lone surrogate already in the title is stored as U+FFFD by the same driver, so it is one here from the start.
     */
    fun cleanTitle(title: String): String? {
        val oneLine = StringBuilder(title.length)
        var inSpace = false
        for ((index, unit) in title.withIndex()) {
            if (JavaScriptText.isWhitespace(unit.code)) {
                if (!inSpace) oneLine.append(' ')
                inSpace = true
                continue
            }
            inSpace = false
            val paired = if (unit.isHighSurrogate()) title.getOrNull(index + 1)?.isLowSurrogate() == true else unit.isLowSurrogate() && title.getOrNull(index - 1)?.isHighSurrogate() == true
            oneLine.append(if (unit.isSurrogate() && !paired) '\uFFFD' else unit)
        }
        val trimmed = JavaScriptText.trim(oneLine.toString())
        var cut = when {
            trimmed.length <= MAX_TITLE_LENGTH -> trimmed
            trimmed[MAX_TITLE_LENGTH - 1].isHighSurrogate() -> trimmed.substring(0, MAX_TITLE_LENGTH - 1) + "\uFFFD"
            else -> trimmed.substring(0, MAX_TITLE_LENGTH)
        }
        cut = trimEnd(cut)
        return cut.ifEmpty { null }
    }

    /** The list as it is shown (`sortReadingItems`): unread first, then read, each oldest first. */
    fun sorted(items: List<ReadingItem>): List<ReadingItem> = items.sortedWith(compareBy<ReadingItem>({ if (it.read) 1 else 0 }, { it.id }))

    /** JavaScript's `trimEnd`. */
    private fun trimEnd(text: String): String {
        var end = text.length
        while (end > 0 && JavaScriptText.isWhitespace(text[end - 1].code)) end--
        return text.substring(0, end)
    }

    /** `/^[a-z][a-z0-9+.-]*:\/\//i` */
    private fun hasSchemeWithSlashes(text: String): Boolean {
        fun isLetter(c: Char) = c in 'a'..'z' || c in 'A'..'Z'
        if (text.isEmpty() || !isLetter(text[0])) return false
        var index = 1
        while (index < text.length && (isLetter(text[index]) || text[index] in '0'..'9' || text[index] in "+.-")) index++
        return index + 2 < text.length && text[index] == ':' && text[index + 1] == '/' && text[index + 2] == '/'
    }
}

// Whether the plugin is on ------------------------------------------------------------------------------------------------------

/**
 * The desktop's built-in plugins as `settings.json` keeps them (`plugins.ts`, `parsePluginSettings`). The app has one of them, the
 * Reading List, which is off until someone turns it on, because it lets the app load web pages.
 */
object PluginSettings {
    /** Whether the Reading List is on, given what `plugins` holds in the settings file: only a real `true` or `false` counts. */
    fun readingListEnabled(settingsValue: JsonElement?): Boolean {
        val flag = (settingsValue as? JsonObject)?.get(ReadingLinks.PLUGIN_ID) as? JsonPrimitive ?: return false
        return !flag.isString && flag.content == "true"
    }
}

/** Whether the Reading List plugin is on: the desktop's `plugins["reading-list"]`, off unless the file says `true`. */
fun SettingsStore.readingListEnabled(): Boolean = locked { PluginSettings.readingListEnabled(it["plugins"]) }

/**
 * Turns the Reading List plugin on or off. The other plugins' entries (the desktop's to-do list, RSS Reader, Contacts) are kept as they
 * were; a `plugins` value that is not an object is replaced, as the desktop's parser would have ignored it.
 */
fun SettingsStore.setReadingListEnabled(enabled: Boolean) = edit { settings ->
    val plugins = LinkedHashMap((settings["plugins"] as? JsonObject) ?: emptyMap())
    plugins[ReadingLinks.PLUGIN_ID] = JsonPrimitive(enabled)
    settings["plugins"] = JsonObject(plugins)
}
