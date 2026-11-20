package com.rushinglabs.composition.core.readinglist

// The part of the WHATWG URL Standard (https://url.spec.whatwg.org/) that the desktop's Reading List leans on through `new URL()`: an
// absolute address, with no base, parsed and written back the way a browser (and Node) does. Ported from WebAddress.swift. The Reading
// List stores the written form, and two links are the same link when those strings are equal, so the app must write exactly what the
// desktop writes. `fixtures/conformance/reading-list.json` holds what Node answered for a long list of links;
// `ReadingListConformanceTests` replays it.
//
// Not `java.net.URI` nor Android's `Uri`: both follow RFC 3986 (and differ from each other), not the URL Standard.
//
// What is here: the scheme, user name and password (only to say whether there are any), the host (a name, made ASCII by `Uts46` where it
// is not, an IPv4 address in any of its spellings, an IPv6 address), the port, the path with its dot segments resolved, and the query,
// each percent-encoded with the standard's sets. The fragment is dropped, since the Reading List drops it. What is not: relative
// addresses (there is never a base), `file:` (the Reading List refuses it first), and encodings other than UTF-8.
//
// The text is read as code points. A lone surrogate, which a Kotlin string (like a JavaScript one) can hold, is read as U+FFFD, as a
// browser's `new URL` reads it.

/** An absolute address as the URL Standard parses it, without its fragment. */
internal data class WebAddress(
    /** Lowercase, without the colon: `https`. */
    val scheme: String,
    val username: String,
    val password: String,
    /**
     * As it is written back: a lowercase ASCII name, `127.0.0.1`, `[2001:db8::1]`, or for a scheme that is not special the host as
     * given. Null when there is no host at all (`mailto:a@b.com`).
     */
    val host: String?,
    /** Null when there is none, or it is the scheme's own (443 for https). */
    val port: Int?,
    /** Written out: `/a/b`, `/` at the least for a special scheme. */
    val path: String,
    /** Without the `?`; null when there is no `?`, empty when there is one with nothing after it. */
    val query: String?,
) {
    /** The address written back, fragment left out: what `URL.href` is once `hash` is set to "". */
    val href: String
        get() = buildString {
            append(scheme).append(':')
            if (host != null) {
                append("//").append(host)
                if (port != null) append(':').append(port)
            }
            append(path)
            if (query != null) append('?').append(query)
        }

    /** `URL.hostname`: the host without the port; empty when there is none. */
    val hostname: String get() = host ?: ""

    companion object {
        /** The schemes the standard treats specially, with their own ports. `file` is special too but is never parsed here. */
        val specialSchemes = mapOf("http" to 80, "https" to 443, "ws" to 80, "wss" to 443, "ftp" to 21)

        /** Parses `input` as `new URL(input)` would (no base), or null where it would throw. */
        fun parse(input: String): WebAddress? {
            var chars = scalars(input)
            // Leading and trailing C0 controls and spaces go, and every tab and new line anywhere.
            var start = 0
            var end = chars.size
            while (start < end && chars[start] <= 0x20) start++
            while (end > start && chars[end - 1] <= 0x20) end--
            chars = chars.subList(start, end).filter { it != TAB && it != LF && it != CR }

            // The scheme: a letter, then letters, digits, + - and ., then a colon.
            val first = chars.firstOrNull() ?: return null
            if (!isAsciiLetter(first)) return null
            var index = 1
            while (index < chars.size && (isAsciiLetter(chars[index]) || isAsciiDigit(chars[index]) || chars[index] in SCHEME_PUNCTUATION)) index++
            if (index >= chars.size || chars[index] != COLON) return null
            val scheme = text(chars.subList(0, index)).lowercase(java.util.Locale.ROOT)
            var rest = chars.subList(index + 1, chars.size)
            rest.indexOf(HASH).takeIf { it >= 0 }?.let { rest = rest.subList(0, it) }

            if (scheme == "file") return null
            val special = scheme in specialSchemes
            val isSlash = { c: Int -> c == SLASH || (special && c == BACKSLASH) }

            var authority: List<Int>
            val remaining: List<Int>
            if (special) {
                // Any number of slashes (and backslashes) after the colon, even none.
                val bodyStart = rest.indexOfFirst { !isSlash(it) }.let { if (it < 0) rest.size else it }
                val body = rest.subList(bodyStart, rest.size)
                val bodyEnd = body.indexOfFirst { isSlash(it) || it == QUESTION }.let { if (it < 0) body.size else it }
                authority = body.subList(0, bodyEnd)
                remaining = body.subList(bodyEnd, body.size)
            } else if (rest.size >= 2 && rest[0] == SLASH && rest[1] == SLASH) {
                val body = rest.subList(2, rest.size)
                val bodyEnd = body.indexOfFirst { it == SLASH || it == QUESTION }.let { if (it < 0) body.size else it }
                authority = body.subList(0, bodyEnd)
                remaining = body.subList(bodyEnd, body.size)
            } else {
                // No authority: an opaque path (`mailto:a@b.com`), or a path that starts with one slash.
                return opaque(scheme, rest)
            }

            // A user name and password come before the last @.
            var username = ""
            var password = ""
            val at = authority.lastIndexOf(AT)
            if (at >= 0) {
                val userinfo = authority.subList(0, at)
                authority = authority.subList(at + 1, authority.size)
                // "https://a@" has a user and no host.
                if (authority.isEmpty()) return null
                val colon = userinfo.indexOf(COLON)
                if (colon >= 0) {
                    username = text(userinfo.subList(0, colon))
                    password = text(userinfo.subList(colon + 1, userinfo.size))
                } else {
                    username = text(userinfo)
                }
            }

            // The host ends at the first colon outside brackets; the port follows it.
            val hostChars = ArrayList<Int>()
            var portChars: List<Int>? = null
            var inBrackets = false
            for ((offset, char) in authority.withIndex()) {
                if (char == OPEN_BRACKET) inBrackets = true
                if (char == CLOSE_BRACKET) inBrackets = false
                if (char == COLON && !inBrackets) {
                    portChars = authority.subList(offset + 1, authority.size)
                    break
                }
                hostChars.add(char)
            }
            if (hostChars.isEmpty()) {
                // A special scheme needs a host; any scheme refuses a port, a user or a password with no host before it.
                if (special || portChars != null || COLON in authority) return null
                if (username != "" || password != "") return null
            }
            val host = if (hostChars.isEmpty()) "" else parseHost(hostChars, special) ?: return null

            var port: Int? = null
            if (portChars != null && portChars.isNotEmpty()) {
                if (!portChars.all(::isAsciiDigit)) return null
                var value = 0
                for (digit in portChars) {
                    value = value * 10 + (digit - '0'.code)
                    if (value > 65_535) return null
                }
                port = if (value == specialSchemes[scheme]) null else value
            }

            val question = remaining.indexOf(QUESTION)
            val pathChars = if (question >= 0) remaining.subList(0, question) else remaining
            val query = if (question >= 0) remaining.subList(question + 1, remaining.size) else null
            val path = if (special || pathChars.isNotEmpty()) resolvePath(pathChars, special) else ""
            val querySet = if (special) SPECIAL_QUERY_SET else QUERY_SET
            return WebAddress(scheme, username, password, host, port, path, query?.let { percentEncode(it, querySet) })
        }

        /** An address with no authority: `mailto:a@b.com`, `foo:/x`. */
        private fun opaque(scheme: String, rest: List<Int>): WebAddress {
            val question = rest.indexOf(QUESTION)
            val pathChars = if (question >= 0) rest.subList(0, question) else rest
            val query = if (question >= 0) rest.subList(question + 1, rest.size) else null
            val path = if (pathChars.firstOrNull() == SLASH) resolvePath(pathChars, false) else percentEncode(pathChars, C0_CONTROL_SET)
            return WebAddress(scheme, "", "", null, null, path, query?.let { percentEncode(it, QUERY_SET) })
        }

        // The path -----------------------------------------------------------------------------------------------------------

        /** The path's segments with `.` and `..` (and their percent-encoded spellings) resolved, each segment percent-encoded. */
        private fun resolvePath(chars: List<Int>, special: Boolean): String {
            val isSeparator = { c: Int -> c == SLASH || (special && c == BACKSLASH) }
            val body = if (chars.isNotEmpty() && isSeparator(chars[0])) chars.subList(1, chars.size) else chars
            // Split with the empty pieces kept: an empty body is one empty piece.
            val pieces = ArrayList<List<Int>>()
            var pieceStart = 0
            for (index in body.indices) {
                if (isSeparator(body[index])) {
                    pieces.add(body.subList(pieceStart, index))
                    pieceStart = index + 1
                }
            }
            pieces.add(body.subList(pieceStart, body.size))

            val segments = ArrayList<String>()
            for ((offset, piece) in pieces.withIndex()) {
                val isLast = offset == pieces.size - 1
                val segment = asciiLower(text(piece))
                if (segment == ".." || segment == ".%2e" || segment == "%2e." || segment == "%2e%2e") {
                    if (segments.isNotEmpty()) segments.removeAt(segments.size - 1)
                    if (isLast) segments.add("")
                } else if (segment == "." || segment == "%2e") {
                    if (isLast) segments.add("")
                } else {
                    segments.add(percentEncode(piece, PATH_SET))
                }
            }
            return segments.joinToString("") { "/$it" }
        }

        // Percent-encoding ---------------------------------------------------------------------------------------------------

        /** The code points a set leaves alone: printable ASCII but for the listed ones. Everything outside is written as UTF-8 escapes. */
        private fun asciiSet(excluding: String): BooleanArray = BooleanArray(0x80) { it in 0x21..0x7E && it.toChar() !in excluding }

        /** The C0 control set keeps printable ASCII and space. */
        private val C0_CONTROL_SET = asciiSet("").also { it[0x20] = true }
        private val QUERY_SET = asciiSet("\"#<>")
        private val SPECIAL_QUERY_SET = asciiSet("\"#<>'")
        private val PATH_SET = asciiSet("\"#<>?`{}^")

        private fun percentEncode(chars: List<Int>, keeping: BooleanArray): String {
            val out = StringBuilder()
            for (char in chars) {
                if (char < 0x80 && keeping[char]) {
                    out.append(char.toChar())
                } else {
                    for (byte in utf8(char)) out.append('%').append(HEX[byte shr 4]).append(HEX[byte and 0xF])
                }
            }
            return out.toString()
        }

        /** `%XX` sequences turned back into bytes; a `%` not followed by two hex digits stays as it is. */
        private fun percentDecode(text: String): ByteArray {
            val bytes = text.toByteArray(Charsets.UTF_8)
            val out = java.io.ByteArrayOutputStream(bytes.size)
            var index = 0
            while (index < bytes.size) {
                val high = if (index + 2 < bytes.size) hexValue(bytes[index + 1].toInt()) else -1
                val low = if (index + 2 < bytes.size) hexValue(bytes[index + 2].toInt()) else -1
                if (bytes[index] == '%'.code.toByte() && high >= 0 && low >= 0) {
                    out.write(high shl 4 or low)
                    index += 3
                } else {
                    out.write(bytes[index].toInt())
                    index += 1
                }
            }
            return out.toByteArray()
        }

        private fun hexValue(byte: Int): Int = when (byte) {
            in '0'.code..'9'.code -> byte - '0'.code
            in 'a'.code..'f'.code -> byte - 'a'.code + 10
            in 'A'.code..'F'.code -> byte - 'A'.code + 10
            else -> -1
        }

        // The host -----------------------------------------------------------------------------------------------------------

        /** Forbidden in any host (tab and new lines are gone by now). */
        private val FORBIDDEN_HOST = "\u0000\t\n\r #/:<>?@[\\]^|".map { it.code }.toSet()

        /** Forbidden in a domain: those, the C0 controls, `%` and DEL. */
        private fun isForbiddenInDomain(char: Int): Boolean = char in FORBIDDEN_HOST || char <= 0x1F || char == '%'.code || char == 0x7F

        /** The host as it is written back, or null when the standard refuses it. */
        private fun parseHost(chars: List<Int>, special: Boolean): String? {
            if (chars.first() == OPEN_BRACKET) {
                if (chars.size < 2 || chars.last() != CLOSE_BRACKET) return null
                val pieces = parseIPv6(chars.subList(1, chars.size - 1)) ?: return null
                return "[" + serializeIPv6(pieces) + "]"
            }
            if (!special) {
                if (chars.any { it != '%'.code && it in FORBIDDEN_HOST }) return null
                return percentEncode(chars, C0_CONTROL_SET)
            }
            val domain = String(percentDecode(text(chars)), Charsets.UTF_8)
            val ascii = domainToAscii(domain)
            if (ascii.isNullOrEmpty()) return null
            if (ascii.any { isForbiddenInDomain(it.code) }) return null
            if (endsInANumber(ascii)) {
                val address = parseIPv4(ascii) ?: return null
                return listOf(24, 16, 8, 0).joinToString(".") { (address shr it and 0xFF).toString() }
            }
            return ascii
        }

        /**
         * The URL Standard's "domain to ASCII", not strict, as the desktop's Node does it. An ASCII name is only lowercased: the standard
         * says that is all UTS #46 would do to one with no `xn--` label, and Node (ada) does no more to one with such labels either, so
         * `xn--abc-.com` is a host to the desktop although it is not Punycode for anything. Anything else goes through UTS #46 ToASCII
         * (`Uts46`). (The iPad sends `xn--` labels to Foundation's IDNA, which may refuse what Node takes.)
         */
        private fun domainToAscii(domain: String): String? {
            if (domain.all { it.code < 0x80 }) return asciiLower(domain)
            return Uts46.toAscii(domain)
        }

        /** Whether the last label (a trailing dot aside) is a number, which makes the whole host an IPv4 address or nothing. */
        private fun endsInANumber(host: String): Boolean {
            val parts = host.split('.').toMutableList()
            if (parts.last() == "") {
                if (parts.size == 1) return false
                parts.removeAt(parts.size - 1)
            }
            val last = parts.last()
            if (last.isEmpty()) return false
            if (last.all { it in '0'..'9' }) return true
            return ipv4Number(last) != null
        }

        /** One part of an IPv4 address: decimal, hexadecimal after `0x`, octal after a leading `0`. Capped, as anything that large fails anyway. */
        private fun ipv4Number(text: String): Long? {
            if (text.isEmpty()) return null
            var digits = text
            var radix = 10
            if (digits.startsWith("0x") || digits.startsWith("0X")) {
                radix = 16
                digits = digits.substring(2)
            } else if (digits.length >= 2 && digits.startsWith("0")) {
                radix = 8
                digits = digits.substring(1)
            }
            if (digits.isEmpty()) return 0
            var value = 0L
            for (char in digits) {
                val digit = if (char.code < 0x80) hexValue(char.code) else -1
                if (digit < 0 || digit >= radix) return null
                value = minOf(value * radix + digit, 1L shl 40)
            }
            return value
        }

        private fun parseIPv4(host: String): Long? {
            val parts = host.split('.').toMutableList()
            if (parts.last() == "" && parts.size > 1) parts.removeAt(parts.size - 1)
            if (parts.size > 4) return null
            val numbers = parts.map { ipv4Number(it) ?: return null }
            val last = numbers.last()
            if (numbers.dropLast(1).any { it > 255 }) return null
            if (last >= 1L shl (8 * (5 - numbers.size))) return null
            var address = last
            for ((offset, number) in numbers.dropLast(1).withIndex()) address += number shl (8 * (3 - offset))
            return address
        }

        /** The standard's IPv6 parser, step for step: eight pieces, one `::`, an IPv4 tail in the last two. */
        private fun parseIPv6(input: List<Int>): IntArray? {
            val address = IntArray(8)
            var pieceIndex = 0
            var compress: Int? = null
            var pointer = 0
            fun char(at: Int): Int? = if (at < input.size) input[at] else null
            fun hexDigit(c: Int?): Int = if (c != null && c < 0x80) hexValue(c) else -1

            if (char(pointer) == COLON) {
                if (char(pointer + 1) != COLON) return null
                pointer += 2
                pieceIndex += 1
                compress = pieceIndex
            }
            main@ while (char(pointer) != null) {
                if (pieceIndex == 8) return null
                if (char(pointer) == COLON) {
                    if (compress != null) return null
                    pointer += 1
                    pieceIndex += 1
                    compress = pieceIndex
                    continue
                }
                var value = 0
                var length = 0
                while (length < 4 && hexDigit(char(pointer)) >= 0) {
                    value = value * 16 + hexDigit(char(pointer))
                    pointer += 1
                    length += 1
                }
                if (char(pointer) == DOT) {
                    if (length == 0) return null
                    pointer -= length
                    if (pieceIndex > 6) return null
                    var numbersSeen = 0
                    while (char(pointer) != null) {
                        var piece: Int? = null
                        if (numbersSeen > 0) {
                            if (char(pointer) != DOT || numbersSeen >= 4) return null
                            pointer += 1
                        }
                        val d = char(pointer)
                        if (d == null || !isAsciiDigit(d)) return null
                        while (char(pointer)?.let(::isAsciiDigit) == true) {
                            val number = char(pointer)!! - '0'.code
                            val current = piece
                            piece = if (current == null) number else {
                                if (current == 0) return null
                                current * 10 + number
                            }
                            if (piece > 255) return null
                            pointer += 1
                        }
                        address[pieceIndex] = (address[pieceIndex] * 0x100 + piece!!) and 0xFFFF
                        numbersSeen += 1
                        if (numbersSeen == 2 || numbersSeen == 4) pieceIndex += 1
                    }
                    if (numbersSeen != 4) return null
                    break@main
                } else if (char(pointer) == COLON) {
                    pointer += 1
                    if (char(pointer) == null) return null
                } else if (char(pointer) != null) {
                    return null
                }
                address[pieceIndex] = value
                pieceIndex += 1
            }
            if (compress != null) {
                var swaps = pieceIndex - compress
                pieceIndex = 7
                while (pieceIndex != 0 && swaps > 0) {
                    val other = compress + swaps - 1
                    address[pieceIndex] = address[other].also { address[other] = address[pieceIndex] }
                    pieceIndex -= 1
                    swaps -= 1
                }
            } else if (pieceIndex != 8) {
                return null
            }
            return address
        }

        /** Lowercase hex, the first longest run of two or more zero pieces written as `::`. */
        private fun serializeIPv6(address: IntArray): String {
            var compress: Int? = null
            var bestLength = 1
            var index = 0
            while (index < 8) {
                if (address[index] == 0) {
                    var end = index
                    while (end < 8 && address[end] == 0) end += 1
                    if (end - index > bestLength) {
                        bestLength = end - index
                        compress = index
                    }
                    index = end
                } else {
                    index += 1
                }
            }
            val out = StringBuilder()
            var ignoreZero = false
            for ((offset, piece) in address.withIndex()) {
                if (ignoreZero && piece == 0) continue
                ignoreZero = false
                if (compress == offset) {
                    out.append(if (offset == 0) "::" else ":")
                    ignoreZero = true
                    continue
                }
                out.append(piece.toString(16))
                if (offset != 7) out.append(':')
            }
            return out.toString()
        }

        // Code points ----------------------------------------------------------------------------------------------------------

        private const val TAB = 0x09
        private const val LF = 0x0A
        private const val CR = 0x0D
        private const val HASH = '#'.code
        private const val SLASH = '/'.code
        private const val BACKSLASH = '\\'.code
        private const val QUESTION = '?'.code
        private const val COLON = ':'.code
        private const val AT = '@'.code
        private const val DOT = '.'.code
        private const val OPEN_BRACKET = '['.code
        private const val CLOSE_BRACKET = ']'.code
        private val SCHEME_PUNCTUATION = setOf('+'.code, '-'.code, '.'.code)
        private const val HEX = "0123456789ABCDEF"

        private fun isAsciiLetter(c: Int) = c in 'a'.code..'z'.code || c in 'A'.code..'Z'.code

        private fun isAsciiDigit(c: Int) = c in '0'.code..'9'.code

        /** The text's code points, a lone surrogate read as U+FFFD (a USVString, as the URL Standard takes its input). */
        private fun scalars(text: String): List<Int> {
            val out = ArrayList<Int>(text.length)
            var index = 0
            while (index < text.length) {
                val point = text.codePointAt(index)
                index += Character.charCount(point)
                out.add(if (point in 0xD800..0xDFFF) 0xFFFD else point)
            }
            return out
        }

        private fun text(points: List<Int>): String = buildString { for (point in points) appendCodePoint(point) }

        private fun utf8(point: Int): IntArray = when {
            point < 0x80 -> intArrayOf(point)
            point < 0x800 -> intArrayOf(0xC0 or (point shr 6), 0x80 or (point and 0x3F))
            point < 0x10000 -> intArrayOf(0xE0 or (point shr 12), 0x80 or (point shr 6 and 0x3F), 0x80 or (point and 0x3F))
            else -> intArrayOf(0xF0 or (point shr 18), 0x80 or (point shr 12 and 0x3F), 0x80 or (point shr 6 and 0x3F), 0x80 or (point and 0x3F))
        }

        /** Only A to Z lowered. */
        internal fun asciiLower(text: String): String = com.rushinglabs.composition.core.markdown.asciiLower(text)
    }
}
