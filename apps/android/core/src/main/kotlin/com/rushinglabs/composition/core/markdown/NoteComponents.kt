package com.rushinglabs.composition.core.markdown

import java.net.URLDecoder

// What the components read from their props: ports of the desktop's chartData.ts, repoRef.ts, youtubeRef.ts, imageWidth.ts and the
// `app_data/` part of imageRefs.ts, by way of the iPad's NoteComponents.swift. Pure, so they are checked against the real TypeScript
// (fixtures/conformance/component-cases.json and what the desktop answers for each, in MdxComponentTests).
//
// The one thing with no equal on any platform is JavaScript's `new URL`, the WHATWG parser. The iPad reads addresses with Foundation's
// URLComponents; Android has its own `Uri`, which a desktop JVM does not, so `ParsedUrl` below reads them itself, the way URLComponents
// does for an address a note can have (RFC 3986, a default port dropped, `.` and `..` segments resolved).

private fun trimmed(text: String) = NoteScanner.trim(text)

/** The parts of a URL that a note's address can have, read the way URLComponents reads them. */
private class ParsedUrl(
    /** Lower case, without the colon. */
    val scheme: String,
    /** Lower case, with the port unless it is the scheme's default. */
    val host: String,
    val hostname: String,
    val path: String,
    val query: List<Pair<String, String>>,
) {
    fun parameter(name: String) = query.firstOrNull { it.first == name }?.second

    companion object {
        private val shape = Regex("^([A-Za-z][A-Za-z0-9+.-]*):(?://([^/?#]*))?([^?#]*)(?:\\?([^#]*))?(?:#(.*))?$")
        private val defaults = mapOf("https" to 443, "http" to 80, "ssh" to 22, "git" to 9418)

        /** What RFC 3986 lets an address hold: unreserved, reserved and `%`. URLComponents refuses anything else. */
        private fun allowed(c: Char) = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c in "-._~:/?#[]@!$&'()*+,;=%"

        private fun percentValid(text: String): Boolean {
            var i = 0
            while (i < text.length) {
                if (text[i] == '%') {
                    if (i + 2 >= text.length || !text[i + 1].isHex() || !text[i + 2].isHex()) return false
                    i += 3
                } else i++
            }
            return true
        }

        private fun Char.isHex() = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

        private fun decode(text: String): String = runCatching { URLDecoder.decode(text.replace("+", "%2B"), Charsets.UTF_8) }.getOrDefault(text)

        fun parse(text: String): ParsedUrl? {
            if (!text.all(::allowed) || !percentValid(text)) return null
            val match = shape.matchEntire(text) ?: return null
            val scheme = match.groupValues[1].lowercase()
            val authority = match.groups[2]?.value ?: ""
            val hostAndPort = authority.substringAfterLast('@')
            val hostname: String
            var port: Int? = null
            if (hostAndPort.startsWith("[")) {
                val close = hostAndPort.indexOf(']')
                if (close < 0) return null
                hostname = hostAndPort.substring(0, close + 1).lowercase()
                val rest = hostAndPort.substring(close + 1)
                if (rest.isNotEmpty()) {
                    if (!rest.startsWith(":")) return null
                    if (rest.length > 1) port = rest.drop(1).toIntOrNull() ?: return null
                }
            } else {
                val colon = hostAndPort.lastIndexOf(':')
                if (colon >= 0) {
                    val digits = hostAndPort.substring(colon + 1)
                    if (digits.isNotEmpty()) port = if (digits.all { it in '0'..'9' }) digits.toIntOrNull() ?: return null else return null
                    hostname = decode(hostAndPort.substring(0, colon)).lowercase()
                } else hostname = decode(hostAndPort).lowercase()
            }
            val host = if (port != null && port != defaults[scheme]) "$hostname:$port" else hostname
            // `.` and `..` segments are resolved, as a browser does before a path is looked at.
            val kept = ArrayList<String>()
            for (segment in match.groupValues[3].split("/")) {
                if (segment == ".") continue
                if (segment == "..") {
                    if (kept.size > 1) kept.removeAt(kept.size - 1)
                    continue
                }
                kept.add(segment)
            }
            val query = match.groups[4]?.value?.let { raw ->
                raw.split("&").map { item ->
                    val equals = item.indexOf('=')
                    if (equals < 0) decode(item) to "" else decode(item.substring(0, equals)) to decode(item.substring(equals + 1))
                }
            } ?: emptyList()
            return ParsedUrl(scheme, host, hostname, kept.joinToString("/"), query)
        }
    }
}

private val hasScheme = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)

/** `new URL(text)` for an address with or without `https://`. */
private fun addressUrl(text: String) = ParsedUrl.parse(if (hasScheme.containsMatchIn(text)) text else "https://$text")

// <Chart> ----------------------------------------------------------------------------------------------------------------------

enum class ChartType(val rawValue: String) {
    BAR("bar"), LINE("line"), AREA("area"), PIE("pie");

    companion object {
        fun of(rawValue: String) = entries.firstOrNull { it.rawValue == rawValue }
    }
}

data class ChartRow(
    val label: String,
    /** A series' number for this row; a cell that is not a number is a gap, so the column is missing. */
    val values: Map<String, Double>,
)

data class ChartSpec(val type: ChartType, val x: String, val y: List<String>, val rows: List<ChartRow>)

sealed interface ChartParse {
    data class Chart(val spec: ChartSpec) : ChartParse
    /** In words, for the notice shown where the chart would be. */
    data class Failure(val message: String) : ChartParse
}

object NoteChart {
    val DEFAULT_TYPE = ChartType.BAR
    const val MAX_ROWS = 500

    /**
     * CSV as rows of cells. Cells may be quoted (`"a, b"`, `""` for a quote), a quoted cell may hold a newline, `\r\n` is one line
     * break, and blank lines are skipped.
     */
    fun parseCsv(text: String): List<List<String>> {
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>()
        val cell = StringBuilder()
        var quoted = false
        val points = text.codePoints().toArray()

        fun endCell() {
            row.add(cell.toString())
            cell.clear()
        }
        fun endRow() {
            endCell()
            if (row.any { trimmed(it).isNotEmpty() }) rows.add(row.map(::trimmed))
            row = ArrayList()
        }

        var i = 0
        while (i < points.size) {
            val c = points[i]
            if (quoted) {
                if (c == '"'.code && i + 1 < points.size && points[i + 1] == '"'.code) {
                    cell.append('"')
                    i++
                } else if (c == '"'.code) quoted = false else cell.appendCodePoint(c)
            } else if (c == '"'.code && trimmed(cell.toString()).isEmpty()) {
                cell.clear()
                quoted = true
            } else if (c == ','.code) {
                endCell()
            } else if (c == '\n'.code) {
                endRow()
            } else if (c == '\r'.code) {
                if (i + 1 < points.size && points[i + 1] == '\n'.code) i++
                endRow()
            } else {
                cell.appendCodePoint(c)
            }
            i++
        }
        endRow()
        return rows
    }

    private val numberPattern = Regex("^[-+]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\\.[0-9]+)?\\z|^[-+]?\\.[0-9]+\\z")

    /** A cell as a number: plain, with thousands separators, or a percentage (`12%` is 12). Nothing else is a number. */
    fun parseNumber(cell: String): Double? {
        var text = trimmed(cell)
        if (text.endsWith("%")) text = text.dropLast(1)
        if (!numberPattern.containsMatchIn(text)) return null
        val value = text.replace(",", "").toDoubleOrNull() ?: return null
        return if (value.isFinite()) value else null
    }

    private fun columns(value: String?) = (value ?: "").split(",").map(::trimmed).filter { it.isNotEmpty() }

    /**
     * The chart for a CSV table: the first row names the columns, `x` picks the label column (the first by default), `y` the series
     * (every other column of numbers by default).
     */
    fun parse(type: String?, x: String?, y: String?, csv: String): ChartParse {
        val table = parseCsv(csv)
        val header = table.firstOrNull() ?: return ChartParse.Failure("Chart: add a ```csv block with a header row and the data.")
        val body = table.drop(1)
        if (body.isEmpty()) return ChartParse.Failure("Chart: the data has a header but no rows.")
        if (body.size > MAX_ROWS) return ChartParse.Failure("Chart: ${body.size} rows is too many to draw (up to $MAX_ROWS).")
        if (header.toSet().size != header.size) return ChartParse.Failure("Chart: two columns have the same name.")

        val chartType = type?.let { ChartType.of(trimmed(it)) } ?: DEFAULT_TYPE
        val xName = x?.let(::trimmed)?.takeIf { it.isNotEmpty() } ?: header[0]
        if (xName !in header) return ChartParse.Failure("Chart: no column named “$xName”. Columns: ${header.joinToString(", ")}.")

        val requested = columns(y)
        requested.firstOrNull { it !in header }?.let { return ChartParse.Failure("Chart: no column named “$it”. Columns: ${header.joinToString(", ")}.") }

        fun holdsNumbers(name: String): Boolean {
            val at = header.indexOf(name)
            if (at < 0) return false
            return body.any { parseNumber(if (at < it.size) it[at] else "") != null }
        }
        val series = (if (requested.isEmpty()) header.filter { it != xName && holdsNumbers(it) } else requested).filter { it != xName }
        if (series.isEmpty()) return ChartParse.Failure("Chart: no column of numbers to draw. Name one with y=\"column\".")
        if (requested.isNotEmpty()) series.firstOrNull { !holdsNumbers(it) }?.let { return ChartParse.Failure("Chart: column “$it” has no numbers.") }

        val xAt = header.indexOf(xName)
        val rows = body.map { cells ->
            val values = LinkedHashMap<String, Double>()
            for (name in series) {
                val at = header.indexOf(name)
                parseNumber(if (at < cells.size) cells[at] else "")?.let { values[name] = it }
            }
            ChartRow(if (xAt < cells.size) cells[xAt] else "", values)
        }
        return ChartParse.Chart(ChartSpec(chartType, xName, series, rows))
    }
}

// <Repo> -----------------------------------------------------------------------------------------------------------------------

data class RepoRef(
    val host: String,
    /** Who runs it, when the host is a known one. */
    val service: String?,
    val owner: String,
    val name: String,
    /** Where to open it: `https://host/owner/name`, rebuilt, never the text as written. */
    val href: String,
) {
    val label get() = "$owner/$name"
}

object NoteRepo {
    private val knownHosts = mapOf(
        "github.com" to ("GitHub" to false), "gitlab.com" to ("GitLab" to true), "bitbucket.org" to ("Bitbucket" to false),
        "codeberg.org" to ("Codeberg" to false), "git.sr.ht" to ("SourceHut" to false),
    )
    private val pageSegments = setOf("-", "tree", "blob", "src", "raw", "commit", "commits", "issues", "pulls", "pull", "merge_requests", "releases", "wiki", "actions")
    private val segment = Regex("^[A-Za-z0-9_.~-]+\\z")
    private val scpLike = Regex("^[A-Za-z0-9_.-]+@([A-Za-z0-9_.-]+):(?!/)(.+)$")

    /** What a note's `<Repo url="…" />` points at; null when it is not an address with an owner and a repository name. */
    fun parse(url: String?): RepoRef? {
        val text = url?.let(::trimmed)?.takeIf { it.isNotEmpty() } ?: return null
        if (text.codePoints().anyMatch(NoteScanner::isWhitespace)) return null

        var host: String
        val path: String
        var scheme = "https"
        val scp = scpLike.find(text)
        if (scp != null) {
            host = scp.groupValues[1]
            path = scp.groupValues[2]
        } else {
            val link = addressUrl(text) ?: return null
            if (link.scheme == "https" || link.scheme == "http") scheme = link.scheme else if (link.scheme != "ssh" && link.scheme != "git") return null
            host = link.host
            path = link.path
        }

        host = host.lowercase()
        if (host.startsWith("www.")) host = host.substring(4)
        if ('.' !in host) return null  // a name with no dot is a typo, not a host

        val segments = path.split("/").filter { it.isNotEmpty() }
        val known = knownHosts[host]
        val end = if (known != null && !known.second) 2 else segments.indices.firstOrNull { it >= 2 && segments[it] in pageSegments } ?: segments.size
        val repoPath = segments.take(end)
        if (repoPath.size < 2 || !repoPath.all { segment.containsMatchIn(it) }) return null

        var name = repoPath.last()
        if (name.endsWith(".git")) name = name.dropLast(4)
        if (name.isEmpty() || name == "." || name == "..") return null
        val owner = repoPath.dropLast(1).joinToString("/")
        return RepoRef(host, known?.first, owner, name, "$scheme://$host/$owner/$name")
    }
}

// <YouTube> --------------------------------------------------------------------------------------------------------------------

data class YouTubeRef(
    val id: String,
    /** Where to begin playing, in whole seconds (64-bit, as Swift's `Int` is). */
    val start: Long,
) {
    /** The privacy-enhanced player: YouTube sets no cookies until the video is played. */
    val embedUrl get() = "https://www.youtube-nocookie.com/embed/$id?rel=0" + (if (start > 0) "&start=$start" else "")
    /** Where the video is on youtube.com, for opening it there. */
    val watchUrl get() = "https://www.youtube.com/watch?v=$id" + (if (start > 0) "&t=${start}s" else "")
}

object NoteYouTube {
    private val id = Regex("^[A-Za-z0-9_-]{11}\\z")
    private val hosts = setOf("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com")
    private val idPaths = setOf("embed", "shorts", "live", "v")
    private val seconds = Regex("^[0-9]+s?\\z")
    private val clock = Regex("^(?:([0-9]+):)?([0-9]{1,2}):([0-9]{1,2})\\z")
    private val units = Regex("^(?:([0-9]+)h)?(?:([0-9]+)m)?(?:([0-9]+)s)?\\z")

    /** A start time in seconds: `90`, `90s`, `1:30`, `1:02:03` or `1m30s`. Null for anything else. */
    fun parseStart(value: String?): Long? {
        val text = value?.let { trimmed(it).lowercase() }?.takeIf { it.isNotEmpty() } ?: return null
        if (seconds.containsMatchIn(text)) return text.removeSuffix("s").toLongOrNull()
        fun number(match: MatchResult, index: Int) = match.groups[index]?.value?.toLongOrNull() ?: 0L
        clock.find(text)?.let { return number(it, 1) * 3600 + number(it, 2) * 60 + number(it, 3) }
        units.find(text)?.let { return number(it, 1) * 3600 + number(it, 2) * 60 + number(it, 3) }
        return null
    }

    /** What a note's `<YouTube url="…" start="…" />` points at; null when it is not a YouTube video. */
    fun parse(url: String?, start: String? = null): YouTubeRef? {
        val text = url?.let(::trimmed)?.takeIf { it.isNotEmpty() } ?: return null
        val explicitStart = parseStart(start)
        if (id.containsMatchIn(text)) return YouTubeRef(text, explicitStart ?: 0)

        val link = addressUrl(text) ?: return null
        if (link.scheme != "https" && link.scheme != "http") return null
        val segments = link.path.split("/").filter { it.isNotEmpty() }
        val videoId = when {
            link.hostname == "youtu.be" -> segments.firstOrNull()
            link.hostname in hosts -> if (segments.firstOrNull() == "watch") link.parameter("v") else segments.firstOrNull()?.takeIf { it in idPaths && segments.size > 1 }?.let { segments[1] }
            else -> null
        }
        if (videoId == null || !id.containsMatchIn(videoId)) return null
        val fromLink = parseStart(link.parameter("t") ?: link.parameter("start"))
        return YouTubeRef(videoId, explicitStart ?: fromLink ?: 0)
    }
}

// <Image> ----------------------------------------------------------------------------------------------------------------------

data class ImageWidth(val value: Double, val unit: Unit) {
    enum class Unit(val rawValue: String) { PX("px"), PERCENT("%") }
}

object NoteImage {
    private val width = Regex("^$JS_SPACE*([0-9]+(?:\\.[0-9]+)?)$JS_SPACE*(px|%)?$JS_SPACE*\\z", RegexOption.IGNORE_CASE)
    private val imageName = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*\\.(png|jpe?g|gif|webp)\\z", RegexOption.IGNORE_CASE)
    const val DIRECTORY_NAME = "app_data"

    /**
     * How wide an `<Image>` is drawn: pixels (`400`, `400px`) or a share of the note's width (`50%`, never over 100). Anything else is
     * null, so a half-typed value leaves the image at full size.
     */
    fun parseWidth(raw: String?): ImageWidth? {
        val match = raw?.let { width.find(it) } ?: return null
        val value = match.groupValues[1].toDoubleOrNull() ?: return null
        if (value <= 0) return null
        val percent = match.groups[2]?.value == "%"
        return ImageWidth(if (percent) minOf(value, 100.0) else value, if (percent) ImageWidth.Unit.PERCENT else ImageWidth.Unit.PX)
    }

    /** The file name a note's `app_data/…` path refers to, or null when it is not a stored image. */
    fun nameFromRef(src: String): String? {
        val prefix = "$DIRECTORY_NAME/"
        val rest = when {
            src.startsWith("./$prefix") -> src.substring(2 + prefix.length)
            src.startsWith(prefix) -> src.substring(prefix.length)
            else -> return null
        }
        return if (imageName.containsMatchIn(rest)) rest else null
    }
}
