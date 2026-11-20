package com.rushinglabs.composition.core.yaml

// A reader for YAML that decides what the desktop's js-yaml 4 decides. A port of YAMLReader.swift, itself a port of js-yaml's
// `loader.js` (block and flow collections, plain, quoted and block scalars, anchors, tags, merge keys), kept close to its shape
// so the three can be compared side by side, and checked against the real library on frontmatter-cases.json.
//
// Differences from js-yaml, all on input no note has (the iPad's): `%TAG` directives are refused, the optional types `!!binary`,
// `!!omap`, `!!pairs` and `!!set` keep the value as read, and a date used as a mapping key is spelled in ISO form. The iPad
// also refuses a document that would use the last of its thread's stack; the JVM cannot measure that, so here only the depth
// limit (100) applies, which needs far less stack than any thread has.

internal class YamlException(message: String) : Exception(message)

internal class YamlReader private constructor(text: String) {
    private enum class Kind { SCALAR, SEQUENCE, MAPPING }
    private enum class Context { FLOW_IN, FLOW_OUT, BLOCK_IN, BLOCK_OUT }
    private enum class Chomping { CLIP, STRIP, KEEP }

    private data class Snapshot(
        val position: Int, val line: Int, val lineStart: Int, val lineIndent: Int, val firstTabInLine: Int,
        val tag: String?, val anchor: String?, val kind: Kind?, val result: YamlValue?,
    )

    companion object {
        private const val MAX_DEPTH = 100
        private const val MAX_TOTAL_MERGE_KEYS = 10_000

        /** The value of the single document in `text`; null when it is empty or null. Throws what js-yaml throws. */
        fun load(text: String): YamlValue? {
            val reader = YamlReader(text)
            while (reader.position < reader.length - 1) {
                val before = reader.position
                reader.readDocument()
                if (reader.position == before) throw YamlException("the reader is stuck")
            }
            return when (reader.documents.size) {
                0 -> null
                1 -> reader.documents[0]
                else -> throw YamlException("expected a single document in the stream, but found more")
            }
        }

        private fun isEol(c: Int) = c == 0x0A || c == 0x0D
        private fun isWhiteSpace(c: Int) = c == 0x09 || c == 0x20
        private fun isWsOrEol(c: Int) = c == 0x09 || c == 0x20 || c == 0x0A || c == 0x0D
        private fun isFlowIndicator(c: Int) = c == 0x2C || c == 0x5B || c == 0x5D || c == 0x7B || c == 0x7D

        private fun hexValue(c: Int): Int? {
            if (c in 0x30..0x39) return c - 0x30
            val lower = c or 0x20
            if (lower in 0x61..0x66) return lower - 0x61 + 10
            return null
        }

        private fun decimalValue(c: Int): Int? = if (c in 0x30..0x39) c - 0x30 else null

        private fun escapeFor(c: Int): Int? = when (c) {
            0x30 -> 0x00
            0x61 -> 0x07
            0x62 -> 0x08
            0x74, 0x09 -> 0x09
            0x6E -> 0x0A
            0x76 -> 0x0B
            0x66 -> 0x0C
            0x72 -> 0x0D
            0x65 -> 0x1B
            0x20 -> 0x20
            0x22 -> 0x22
            0x2F -> 0x2F
            0x5C -> 0x5C
            0x4E -> 0x85
            0x5F -> 0xA0
            0x4C -> 0x2028
            0x50 -> 0x2029
            else -> null
        }

        private fun isNonPrintable(c: Int) = c <= 0x08 || c == 0x0B || c == 0x0C || c in 0x0E..0x1F || c in 0x7F..0x84 ||
            c in 0x86..0x9F || c == 0xFFFE || c == 0xFFFF

        private fun writeFoldedLines(buffer: StringBuilder, count: Int) {
            if (count == 1) buffer.append(' ') else if (count > 1) repeat(count - 1) { buffer.append('\n') }
        }

        /** The type that an explicit `!!tag` names, and whether its value is a scalar or a collection. */
        private fun explicitType(tag: String): Pair<String, Kind>? {
            val prefix = "tag:yaml.org,2002:"
            if (!tag.startsWith(prefix)) return null
            return when (val name = tag.removePrefix(prefix)) {
                "str", "null", "bool", "int", "float", "timestamp", "merge", "binary" -> name to Kind.SCALAR
                "seq", "omap", "pairs" -> name to Kind.SEQUENCE
                "map", "set" -> name to Kind.MAPPING
                else -> null
            }
        }
    }

    private val input: IntArray
    private val length: Int
    private var position = 0
    private var line = 0
    private var lineStart = 0
    private var lineIndent = 0
    private var firstTabInLine = -1
    private var depth = 0
    private var totalMergeKeys = 0

    private var tag: String? = null
    private var anchor: String? = null
    private var kind: Kind? = null
    /** What was just read; null is a YAML null or nothing at all. */
    private var result: YamlValue? = null
    private var anchors = HashMap<String, YamlValue>()
    private val documents = ArrayList<YamlValue?>()
    private var version: String? = null

    init {
        val units = ArrayList<Int>(text.length + 2)
        for (char in text) units.add(char.code)
        if (units.isNotEmpty()) {
            if (units.last() != 0x0A && units.last() != 0x0D) units.add(0x0A)
            if (units.first() == 0xFEFF) units.removeAt(0)
        }
        if (units.contains(0)) throw YamlException("null byte is not allowed in input")
        length = units.size
        units.add(0)
        input = units.toIntArray()
        while (input[position] == 0x20) {
            lineIndent += 1
            position += 1
        }
    }

    // Characters

    private fun ch(index: Int): Int = if (index >= 0 && index < input.size) input[index] else 0

    private fun fail(message: String) = YamlException("$message (line ${line + 1})")

    private fun text(from: Int, until: Int): String {
        val builder = StringBuilder(until - from)
        for (index in from until until) builder.append(input[index].toChar())
        return builder.toString()
    }

    // State

    private fun snapshot() = Snapshot(position, line, lineStart, lineIndent, firstTabInLine, tag, anchor, kind, result)

    private fun restore(s: Snapshot) {
        position = s.position; line = s.line; lineStart = s.lineStart; lineIndent = s.lineIndent; firstTabInLine = s.firstTabInLine
        tag = s.tag; anchor = s.anchor; kind = s.kind; result = s.result
    }

    private fun storeAnchor(name: String, value: YamlValue?) { anchors[name] = value ?: YamlValue.Null }

    private fun readLineBreak() {
        val c = ch(position)
        if (c == 0x0A) {
            position += 1
        } else if (c == 0x0D) {
            position += 1
            if (ch(position) == 0x0A) position += 1
        } else {
            throw fail("a line break is expected")
        }
        line += 1
        lineStart = position
        firstTabInLine = -1
    }

    /** Skips white space, line breaks and (when allowed) comments; the number of line breaks passed. */
    private fun skipSeparationSpace(allowComments: Boolean): Int {
        var lineBreaks = 0
        var c = ch(position)
        while (c != 0) {
            while (isWhiteSpace(c)) {
                if (c == 0x09 && firstTabInLine == -1) firstTabInLine = position
                position += 1
                c = ch(position)
            }
            if (allowComments && c == 0x23) {
                do {
                    position += 1
                    c = ch(position)
                } while (c != 0x0A && c != 0x0D && c != 0)
            }
            if (isEol(c)) {
                runCatching { readLineBreak() }
                c = ch(position)
                lineBreaks += 1
                lineIndent = 0
                while (c == 0x20) {
                    lineIndent += 1
                    position += 1
                    c = ch(position)
                }
            } else {
                break
            }
        }
        return lineBreaks
    }

    private fun testDocumentSeparator(): Boolean {
        val c = ch(position)
        if ((c == 0x2D || c == 0x2E) && c == ch(position + 1) && c == ch(position + 2)) {
            val after = ch(position + 3)
            return after == 0 || isWsOrEol(after)
        }
        return false
    }

    private fun capture(buffer: StringBuilder, start: Int, end: Int, json: Boolean) {
        if (start >= end) return
        for (index in start until end) {
            val unit = input[index]
            if (json) {
                if (!(unit == 0x09 || unit >= 0x20)) throw fail("expected valid JSON character")
            } else if (isNonPrintable(unit)) {
                throw fail("the stream contains non-printable characters")
            }
        }
        for (index in start until end) buffer.append(input[index].toChar())
    }

    // Mapping pairs

    /** JavaScript's `String(key)` for a key node, which is how js-yaml names the property. */
    private fun keyName(key: YamlValue?): String {
        if (key == null) return "null"
        if (key is YamlValue.Sequence) {
            for (item in key.items) if (item is YamlValue.Sequence) throw fail("nested arrays are not supported inside keys")
        }
        return JavaScriptText.string(key)
    }

    private fun chargeMergeWork() {
        totalMergeKeys += 1
        if (totalMergeKeys > MAX_TOTAL_MERGE_KEYS) throw fail("merge keys exceeded maxTotalMergeKeys")
    }

    private fun mergeMappings(map: YamlMapping, source: YamlValue?, overridable: MutableSet<String>) {
        if (source !is YamlValue.Mapping) throw fail("cannot merge mappings; the provided source object is unacceptable")
        chargeMergeWork()
        for ((key, value) in source.mapping.pairs) {
            chargeMergeWork()
            if (!map.has(key)) {
                map[key] = value
                overridable.add(key)
            }
        }
    }

    private fun storeMappingPair(map: YamlMapping, overridable: MutableSet<String>, keyTag: String?, key: YamlValue?, value: YamlValue?) {
        val name = keyName(key)
        if (keyTag == YamlScalars.MERGE_TAG) {
            if (value is YamlValue.Sequence) {
                if (value.items.size > 100) throw fail("abnormal merge sequence size")
                for (source in value.items) mergeMappings(map, source, overridable)
            } else {
                mergeMappings(map, value, overridable)
            }
        } else {
            if (!overridable.contains(name) && map.has(name)) throw fail("duplicated mapping key")
            map[name] = value ?: YamlValue.Null
            overridable.remove(name)
        }
    }

    // Scalars

    private fun readPlainScalar(nodeIndent: Int, withinFlow: Boolean): Boolean {
        val savedKind = kind
        val savedResult = result
        var c = ch(position)

        if (isWsOrEol(c) || isFlowIndicator(c) || c == 0x23 || c == 0x26 || c == 0x2A || c == 0x21 || c == 0x7C || c == 0x3E ||
            c == 0x27 || c == 0x22 || c == 0x25 || c == 0x40 || c == 0x60
        ) return false
        if (c == 0x3F || c == 0x2D) {
            val following = ch(position + 1)
            if (isWsOrEol(following) || (withinFlow && isFlowIndicator(following))) return false
        }

        kind = Kind.SCALAR
        result = YamlValue.Str("")
        val buffer = StringBuilder()
        var captureStart = position
        var captureEnd = position
        var hasPendingContent = false
        var savedLine = 0
        var savedLineStart = 0
        var savedLineIndent = 0

        scanning@ while (c != 0) {
            if (c == 0x3A) {
                val following = ch(position + 1)
                if (isWsOrEol(following) || (withinFlow && isFlowIndicator(following))) break@scanning
            } else if (c == 0x23) {
                if (isWsOrEol(ch(position - 1))) break@scanning
            } else if ((position == lineStart && testDocumentSeparator()) || (withinFlow && isFlowIndicator(c))) {
                break@scanning
            } else if (isEol(c)) {
                savedLine = line
                savedLineStart = lineStart
                savedLineIndent = lineIndent
                skipSeparationSpace(allowComments = false)
                if (lineIndent >= nodeIndent) {
                    hasPendingContent = true
                    c = ch(position)
                    continue@scanning
                } else {
                    position = captureEnd
                    line = savedLine
                    lineStart = savedLineStart
                    lineIndent = savedLineIndent
                    break@scanning
                }
            }

            if (hasPendingContent) {
                capture(buffer, captureStart, captureEnd, json = false)
                writeFoldedLines(buffer, line - savedLine)
                captureStart = position
                captureEnd = position
                hasPendingContent = false
            }
            if (!isWhiteSpace(c)) captureEnd = position + 1
            position += 1
            c = ch(position)
        }

        capture(buffer, captureStart, captureEnd, json = false)
        if (buffer.isNotEmpty()) {
            result = YamlValue.Str(buffer.toString())
            return true
        }
        kind = savedKind
        result = savedResult
        return false
    }

    private fun readSingleQuotedScalar(): Boolean {
        if (ch(position) != 0x27) return false
        kind = Kind.SCALAR
        result = YamlValue.Str("")
        position += 1
        val buffer = StringBuilder()
        var captureStart = position
        var captureEnd = position

        while (true) {
            val c = ch(position)
            if (c == 0) break
            if (c == 0x27) {
                capture(buffer, captureStart, position, json = true)
                position += 1
                if (ch(position) == 0x27) {
                    captureStart = position
                    position += 1
                    captureEnd = position
                } else {
                    result = YamlValue.Str(buffer.toString())
                    return true
                }
            } else if (isEol(c)) {
                capture(buffer, captureStart, captureEnd, json = true)
                writeFoldedLines(buffer, skipSeparationSpace(allowComments = false))
                captureStart = position
                captureEnd = position
            } else if (position == lineStart && testDocumentSeparator()) {
                throw fail("unexpected end of the document within a single quoted scalar")
            } else {
                position += 1
                if (!isWhiteSpace(c)) captureEnd = position
            }
        }
        throw fail("unexpected end of the stream within a single quoted scalar")
    }

    private fun readDoubleQuotedScalar(): Boolean {
        if (ch(position) != 0x22) return false
        kind = Kind.SCALAR
        result = YamlValue.Str("")
        position += 1
        val buffer = StringBuilder()
        var captureStart = position
        var captureEnd = position

        while (true) {
            var c = ch(position)
            if (c == 0) break
            if (c == 0x22) {
                capture(buffer, captureStart, position, json = true)
                position += 1
                result = YamlValue.Str(buffer.toString())
                return true
            } else if (c == 0x5C) {
                capture(buffer, captureStart, position, json = true)
                position += 1
                c = ch(position)
                val simple = escapeFor(c)
                if (isEol(c)) {
                    skipSeparationSpace(allowComments = false)
                } else if (simple != null) {
                    buffer.append(simple.toChar())
                    position += 1
                } else if (c == 0x78 || c == 0x75 || c == 0x55) {
                    var remaining = if (c == 0x78) 2 else if (c == 0x75) 4 else 8
                    var code = 0L
                    while (remaining > 0) {
                        position += 1
                        val digit = hexValue(ch(position)) ?: throw fail("expected hexadecimal character")
                        code = (code shl 4) + digit
                        remaining -= 1
                    }
                    if (code <= 0xFFFF) {
                        buffer.append(code.toInt().toChar())
                    } else if (code <= 0x10FFFF) {
                        buffer.append((((code - 0x10000) shr 10) + 0xD800).toInt().toChar())
                        buffer.append((((code - 0x10000) and 0x3FF) + 0xDC00).toInt().toChar())
                    } else {
                        throw fail("code point within a string may not be greater than 0x10FFFF")
                    }
                    position += 1
                } else {
                    throw fail("unknown escape sequence")
                }
                captureStart = position
                captureEnd = position
            } else if (isEol(c)) {
                capture(buffer, captureStart, captureEnd, json = true)
                writeFoldedLines(buffer, skipSeparationSpace(allowComments = false))
                captureStart = position
                captureEnd = position
            } else if (position == lineStart && testDocumentSeparator()) {
                throw fail("unexpected end of the document within a double quoted scalar")
            } else {
                position += 1
                if (!isWhiteSpace(c)) captureEnd = position
            }
        }
        throw fail("unexpected end of the stream within a double quoted scalar")
    }

    private fun readBlockScalar(nodeIndent: Int): Boolean {
        var chomping = Chomping.CLIP
        var didReadContent = false
        var detectedIndent = false
        var textIndent = nodeIndent
        var emptyLines = 0
        var atMoreIndented = false
        var c = ch(position)

        val folding = when (c) {
            0x7C -> false
            0x3E -> true
            else -> return false
        }
        kind = Kind.SCALAR
        val buffer = StringBuilder()
        fun newlines(count: Int) { repeat(maxOf(0, count)) { buffer.append('\n') } }

        while (c != 0) {
            position += 1
            c = ch(position)
            val digit = decimalValue(c)
            if (c == 0x2B || c == 0x2D) {
                if (chomping == Chomping.CLIP) {
                    chomping = if (c == 0x2B) Chomping.KEEP else Chomping.STRIP
                } else {
                    throw fail("repeat of a chomping mode identifier")
                }
            } else if (digit != null) {
                if (digit == 0) {
                    throw fail("bad explicit indentation width of a block scalar; it cannot be less than one")
                } else if (!detectedIndent) {
                    textIndent = nodeIndent + digit - 1
                    detectedIndent = true
                } else {
                    throw fail("repeat of an indentation width identifier")
                }
            } else {
                break
            }
        }

        if (isWhiteSpace(c)) {
            do {
                position += 1
                c = ch(position)
            } while (isWhiteSpace(c))
            if (c == 0x23) {
                do {
                    position += 1
                    c = ch(position)
                } while (!isEol(c) && c != 0)
            }
        }

        while (c != 0) {
            readLineBreak()
            lineIndent = 0
            c = ch(position)

            while ((!detectedIndent || lineIndent < textIndent) && c == 0x20) {
                lineIndent += 1
                position += 1
                c = ch(position)
            }
            if (!detectedIndent && lineIndent > textIndent) textIndent = lineIndent

            if (isEol(c)) {
                emptyLines += 1
                continue
            }
            if (!detectedIndent && textIndent == 0) throw fail("missing indentation for block scalar")

            if (lineIndent < textIndent) {
                if (chomping == Chomping.KEEP) {
                    newlines(if (didReadContent) 1 + emptyLines else emptyLines)
                } else if (chomping == Chomping.CLIP && didReadContent) {
                    buffer.append('\n')
                }
                break
            }

            if (folding) {
                if (isWhiteSpace(c)) {
                    atMoreIndented = true
                    newlines(if (didReadContent) 1 + emptyLines else emptyLines)
                } else if (atMoreIndented) {
                    atMoreIndented = false
                    newlines(emptyLines + 1)
                } else if (emptyLines == 0) {
                    if (didReadContent) buffer.append(' ')
                } else {
                    newlines(emptyLines)
                }
            } else {
                newlines(if (didReadContent) 1 + emptyLines else emptyLines)
            }

            didReadContent = true
            detectedIndent = true
            emptyLines = 0
            val captureStart = position
            while (!isEol(c) && c != 0) {
                position += 1
                c = ch(position)
            }
            capture(buffer, captureStart, position, json = false)
        }

        result = YamlValue.Str(buffer.toString())
        return true
    }

    // Collections

    private fun readFlowCollection(nodeIndent: Int): Boolean {
        var readNext = true
        val savedTag = tag
        val savedAnchor = anchor
        var c = ch(position)
        val terminator: Int
        val isMapping: Boolean
        val items = ArrayList<YamlValue>()
        val map = YamlMapping()
        val overridable = HashSet<String>()

        if (c == 0x5B) {
            terminator = 0x5D
            isMapping = false
        } else if (c == 0x7B) {
            terminator = 0x7D
            isMapping = true
        } else {
            return false
        }
        anchor?.let { storeAnchor(it, if (isMapping) YamlValue.Mapping(map.snapshot()) else YamlValue.Sequence(items.toList())) }

        position += 1
        c = ch(position)
        while (c != 0) {
            skipSeparationSpace(allowComments = true)
            c = ch(position)

            if (c == terminator) {
                position += 1
                tag = savedTag
                anchor = savedAnchor
                kind = if (isMapping) Kind.MAPPING else Kind.SEQUENCE
                result = if (isMapping) YamlValue.Mapping(map.snapshot()) else YamlValue.Sequence(items.toList())
                return true
            } else if (!readNext) {
                throw fail("missed comma between flow collection entries")
            } else if (c == 0x2C) {
                throw fail("expected the node content, but found ','")
            }

            var isPair = false
            var isExplicitPair = false
            var valueNode: YamlValue? = null

            if (c == 0x3F && isWsOrEol(ch(position + 1))) {
                isPair = true
                isExplicitPair = true
                position += 1
                skipSeparationSpace(allowComments = true)
            }

            val startLine = line
            composeNode(nodeIndent, Context.FLOW_IN, allowToSeek = false, allowCompact = true)
            val keyTag = tag
            val keyNode = result
            skipSeparationSpace(allowComments = true)
            c = ch(position)

            if ((isExplicitPair || line == startLine) && c == 0x3A) {
                isPair = true
                position += 1
                c = ch(position)
                skipSeparationSpace(allowComments = true)
                composeNode(nodeIndent, Context.FLOW_IN, allowToSeek = false, allowCompact = true)
                valueNode = result
            }

            if (isMapping) {
                storeMappingPair(map, overridable, keyTag, keyNode, valueNode)
            } else if (isPair) {
                val pair = YamlMapping()
                storeMappingPair(pair, HashSet(), keyTag, keyNode, valueNode)
                items.add(YamlValue.Mapping(pair))
            } else {
                items.add(keyNode ?: YamlValue.Null)
            }

            skipSeparationSpace(allowComments = true)
            c = ch(position)
            if (c == 0x2C) {
                readNext = true
                position += 1
                c = ch(position)
            } else {
                readNext = false
            }
        }
        throw fail("unexpected end of the stream within a flow collection")
    }

    private fun readBlockSequence(nodeIndent: Int): Boolean {
        val savedTag = tag
        val savedAnchor = anchor
        val items = ArrayList<YamlValue>()
        var detected = false

        if (firstTabInLine != -1) return false
        anchor?.let { storeAnchor(it, YamlValue.Sequence(items.toList())) }

        var c = ch(position)
        while (c != 0) {
            if (firstTabInLine != -1) throw fail("tab characters must not be used in indentation")
            if (c != 0x2D) break
            if (!isWsOrEol(ch(position + 1))) break

            detected = true
            position += 1

            if (skipSeparationSpace(allowComments = true) > 0 && lineIndent <= nodeIndent) {
                items.add(YamlValue.Null)
                c = ch(position)
                continue
            }

            val startLine = line
            composeNode(nodeIndent, Context.BLOCK_IN, allowToSeek = false, allowCompact = true)
            items.add(result ?: YamlValue.Null)
            skipSeparationSpace(allowComments = true)
            c = ch(position)

            if ((line == startLine || lineIndent > nodeIndent) && c != 0) {
                throw fail("bad indentation of a sequence entry")
            } else if (lineIndent < nodeIndent) {
                break
            }
        }

        if (detected) {
            tag = savedTag
            anchor = savedAnchor
            kind = Kind.SEQUENCE
            result = YamlValue.Sequence(items.toList())
            return true
        }
        return false
    }

    private fun readBlockMapping(nodeIndent: Int, flowIndent: Int): Boolean {
        val savedTag = tag
        val savedAnchor = anchor
        val map = YamlMapping()
        val overridable = HashSet<String>()
        var keyTag: String? = null
        var keyNode: YamlValue? = null
        var valueNode: YamlValue? = null
        var atExplicitKey = false
        var detected = false
        var allowCompact = false

        if (firstTabInLine != -1) return false
        anchor?.let { storeAnchor(it, YamlValue.Mapping(map.snapshot())) }

        var c = ch(position)
        while (c != 0) {
            if (!atExplicitKey && firstTabInLine != -1) throw fail("tab characters must not be used in indentation")

            val following = ch(position + 1)
            val startLine = line

            if ((c == 0x3F || c == 0x3A) && isWsOrEol(following)) {
                if (c == 0x3F) {
                    if (atExplicitKey) {
                        storeMappingPair(map, overridable, keyTag, keyNode, null)
                        keyTag = null
                        keyNode = null
                        valueNode = null
                    }
                    detected = true
                    atExplicitKey = true
                    allowCompact = true
                } else if (atExplicitKey) {
                    atExplicitKey = false
                    allowCompact = true
                } else {
                    throw fail("incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line")
                }
                position += 1
                c = following
            } else {
                if (!composeNode(flowIndent, Context.FLOW_OUT, allowToSeek = false, allowCompact = true)) break

                if (line == startLine) {
                    c = ch(position)
                    while (isWhiteSpace(c)) {
                        position += 1
                        c = ch(position)
                    }
                    if (c == 0x3A) {
                        position += 1
                        c = ch(position)
                        if (!isWsOrEol(c)) throw fail("a whitespace character is expected after the key-value separator within a block mapping")
                        if (atExplicitKey) {
                            storeMappingPair(map, overridable, keyTag, keyNode, null)
                            keyTag = null
                            keyNode = null
                            valueNode = null
                        }
                        detected = true
                        atExplicitKey = false
                        allowCompact = false
                        keyTag = tag
                        keyNode = result
                    } else if (detected) {
                        throw fail("can not read an implicit mapping pair; a colon is missed")
                    } else {
                        tag = savedTag
                        anchor = savedAnchor
                        return true
                    }
                } else if (detected) {
                    throw fail("can not read a block mapping entry; a multiline key may not be an implicit key")
                } else {
                    tag = savedTag
                    anchor = savedAnchor
                    return true
                }
            }

            if (line == startLine || lineIndent > nodeIndent) {
                if (composeNode(nodeIndent, Context.BLOCK_OUT, allowToSeek = true, allowCompact = allowCompact)) {
                    if (atExplicitKey) keyNode = result else valueNode = result
                }
                if (!atExplicitKey) {
                    storeMappingPair(map, overridable, keyTag, keyNode, valueNode)
                    keyTag = null
                    keyNode = null
                    valueNode = null
                }
                skipSeparationSpace(allowComments = true)
                c = ch(position)
            }

            if ((line == startLine || lineIndent > nodeIndent) && c != 0) {
                throw fail("bad indentation of a mapping entry")
            } else if (lineIndent < nodeIndent) {
                break
            }
        }

        if (atExplicitKey) storeMappingPair(map, overridable, keyTag, keyNode, null)
        if (detected) {
            tag = savedTag
            anchor = savedAnchor
            kind = Kind.MAPPING
            result = YamlValue.Mapping(map.snapshot())
        }
        return detected
    }

    // Properties

    private fun readTagProperty(): Boolean {
        var isVerbatim = false
        var isNamed = false
        var handle: String
        var name: String
        var c = ch(position)

        if (c != 0x21) return false
        if (tag != null) throw fail("duplication of a tag property")
        position += 1
        c = ch(position)

        if (c == 0x3C) {
            isVerbatim = true
            handle = ""
            position += 1
            c = ch(position)
        } else if (c == 0x21) {
            isNamed = true
            handle = "!!"
            position += 1
            c = ch(position)
        } else {
            handle = "!"
        }

        var start = position
        if (isVerbatim) {
            do {
                position += 1
                c = ch(position)
            } while (c != 0 && c != 0x3E)
            if (position < length) {
                name = text(start, position)
                position += 1
            } else {
                throw fail("unexpected end of the stream within a verbatim tag")
            }
        } else {
            while (c != 0 && !isWsOrEol(c)) {
                if (c == 0x21) {
                    // A named handle (`!e!name`) is never declared here, so it ends in an undeclared-handle error either way.
                    if (isNamed) throw fail("tag suffix cannot contain exclamation marks")
                    handle = text(start - 1, position + 1)
                    isNamed = true
                    start = position + 1
                }
                position += 1
                c = ch(position)
            }
            name = text(start, position)
            if (name.any { isFlowIndicator(it.code) }) throw fail("tag suffix cannot contain flow indicator characters")
        }

        tag = when {
            isVerbatim -> name
            handle == "!" -> "!$name"
            handle == "!!" -> "tag:yaml.org,2002:$name"
            else -> throw fail("undeclared tag handle \"$handle\"")
        }
        return true
    }

    private fun readAnchorProperty(): Boolean {
        if (ch(position) != 0x26) return false
        if (anchor != null) throw fail("duplication of an anchor property")
        position += 1
        val start = position
        var c = ch(position)
        while (c != 0 && !isWsOrEol(c) && !isFlowIndicator(c)) {
            position += 1
            c = ch(position)
        }
        if (position == start) throw fail("name of an anchor node must contain at least one character")
        anchor = text(start, position)
        return true
    }

    private fun readAlias(): Boolean {
        if (ch(position) != 0x2A) return false
        position += 1
        val start = position
        var c = ch(position)
        while (c != 0 && !isWsOrEol(c) && !isFlowIndicator(c)) {
            position += 1
            c = ch(position)
        }
        if (position == start) throw fail("name of an alias node must contain at least one character")
        val name = text(start, position)
        val value = anchors[name] ?: throw fail("unidentified alias \"$name\"")
        result = if (value == YamlValue.Null) null else value
        skipSeparationSpace(allowComments = true)
        return true
    }

    /** Reads `&anchor !tag` in front of an implicit key as part of that key, not of the mapping it starts. */
    private fun tryReadBlockMappingFromProperty(propertyStart: Snapshot, nodeIndent: Int, flowIndent: Int): Boolean {
        val fallback = snapshot()
        val savedAnchors = HashMap(anchors)
        restore(propertyStart)
        tag = null
        anchor = null
        kind = null
        result = null
        if (readBlockMapping(nodeIndent, flowIndent) && kind == Kind.MAPPING) return true
        anchors = savedAnchors
        restore(fallback)
        return false
    }

    // Nodes

    private fun composeNode(parentIndent: Int, context: Context, allowToSeek: Boolean, allowCompact: Boolean): Boolean {
        var indentStatus = 1
        var atNewLine = false
        var hasContent = false
        var propertyStart: Snapshot? = null

        if (depth >= MAX_DEPTH) throw fail("nesting exceeded maxDepth")
        depth += 1
        try {
            tag = null
            anchor = null
            kind = null
            result = null

            val allowBlockStyles = context == Context.BLOCK_OUT || context == Context.BLOCK_IN
            val allowBlockScalars = allowBlockStyles
            var allowBlockCollections = allowBlockStyles

            fun status(indent: Int, parent: Int) = if (indent > parent) 1 else if (indent == parent) 0 else -1

            if (allowToSeek && skipSeparationSpace(allowComments = true) > 0) {
                atNewLine = true
                indentStatus = status(lineIndent, parentIndent)
            }

            if (indentStatus == 1) {
                while (true) {
                    val c = ch(position)
                    val propertyState = snapshot()

                    // A second property token after a line break can be the first key of a nested mapping.
                    if (atNewLine && ((c == 0x21 && tag != null) || (c == 0x26 && anchor != null))) break
                    if (!readTagProperty()) {
                        if (!readAnchorProperty()) break
                    }
                    if (propertyStart == null) propertyStart = propertyState

                    if (skipSeparationSpace(allowComments = true) > 0) {
                        atNewLine = true
                        allowBlockCollections = allowBlockStyles
                        indentStatus = status(lineIndent, parentIndent)
                    } else {
                        allowBlockCollections = false
                    }
                }
            }

            if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact

            if (indentStatus == 1 || context == Context.BLOCK_OUT) {
                val flowIndent = if (context == Context.FLOW_IN || context == Context.FLOW_OUT) parentIndent else parentIndent + 1
                val blockIndent = position - lineStart

                if (indentStatus == 1) {
                    var found = false
                    if (allowBlockCollections) {
                        if (readBlockSequence(blockIndent)) found = true
                        else if (readBlockMapping(blockIndent, flowIndent)) found = true
                    }
                    if (!found && readFlowCollection(flowIndent)) found = true

                    if (found) {
                        hasContent = true
                    } else {
                        val c = ch(position)
                        val start = propertyStart
                        if (start != null && allowBlockStyles && !allowBlockCollections && c != 0x7C && c != 0x3E &&
                            tryReadBlockMappingFromProperty(start, start.position - start.lineStart, flowIndent)
                        ) {
                            hasContent = true
                        } else if ((allowBlockScalars && readBlockScalar(flowIndent)) || readSingleQuotedScalar() || readDoubleQuotedScalar()) {
                            hasContent = true
                        } else if (readAlias()) {
                            hasContent = true
                            if (tag != null || anchor != null) throw fail("alias node should not have any properties")
                        } else if (readPlainScalar(flowIndent, withinFlow = context == Context.FLOW_IN)) {
                            hasContent = true
                            if (tag == null) tag = "?"
                        }
                        anchor?.let { storeAnchor(it, result) }
                    }
                } else if (indentStatus == 0) {
                    // Block sequences may sit at their parent mapping key's indent.
                    if (allowBlockCollections) hasContent = readBlockSequence(blockIndent)
                }
            }

            val currentTag = tag
            if (currentTag == null) {
                anchor?.let { storeAnchor(it, result) }
            } else if (currentTag == "?") {
                if (result != null && kind != Kind.SCALAR) throw fail("unacceptable node kind for !<?> tag; it should be \"scalar\"")
                val raw = (result as? YamlValue.Str)?.value
                val resolved = raw?.let { YamlScalars.resolve(it) }
                if (resolved != null) {
                    result = if (resolved.second == YamlValue.Null) null else resolved.second
                    tag = resolved.first
                    anchor?.let { storeAnchor(it, result) }
                }
            } else if (currentTag != "!") {
                val type = explicitType(currentTag) ?: throw fail("unknown tag !<$currentTag>")
                if (result != null && type.second != kind) throw fail("unacceptable node kind for !<$currentTag> tag")
                val raw = if (type.second == Kind.SCALAR) (result as? YamlValue.Str)?.value else null
                fun refuse(): Nothing = throw fail("cannot resolve a node with !<$currentTag> explicit tag")
                when (type.first) {
                    "str" -> result = YamlValue.Str(raw ?: "")
                    "null" -> {
                        if (raw != null && !YamlScalars.isNull(raw)) refuse()
                        result = null
                    }
                    "bool" -> result = YamlValue.Bool(raw?.let(YamlScalars::boolean) ?: refuse())
                    "int" -> result = YamlValue.Number(raw?.let(YamlScalars::integer) ?: refuse())
                    "float" -> result = YamlValue.Number(raw?.let(YamlScalars::float) ?: refuse())
                    "timestamp" -> result = YamlValue.Timestamp(raw?.let(YamlScalars::timestamp) ?: refuse())
                    "merge" -> if (raw != null && raw != "<<") refuse()
                    "seq", "omap", "pairs" -> if (result == null) result = YamlValue.Sequence(emptyList())
                    "map", "set" -> if (result == null) result = YamlValue.Mapping(YamlMapping())
                }
                anchor?.let { storeAnchor(it, result) }
            }

            return tag != null || anchor != null || hasContent
        } finally {
            depth -= 1
        }
    }

    // Documents

    private fun readDocument() {
        var hasDirectives = false
        anchors = HashMap()
        version = null

        while (ch(position) != 0) {
            skipSeparationSpace(allowComments = true)
            var c = ch(position)
            if (lineIndent > 0 || c != 0x25) break

            hasDirectives = true
            position += 1
            c = ch(position)
            var start = position
            while (c != 0 && !isWsOrEol(c)) {
                position += 1
                c = ch(position)
            }
            val name = text(start, position)
            val arguments = ArrayList<String>()
            if (name.isEmpty()) throw fail("directive name must not be less than one character in length")

            while (c != 0) {
                while (isWhiteSpace(c)) {
                    position += 1
                    c = ch(position)
                }
                if (c == 0x23) {
                    do {
                        position += 1
                        c = ch(position)
                    } while (c != 0 && !isEol(c))
                    break
                }
                if (isEol(c)) break
                start = position
                while (c != 0 && !isWsOrEol(c)) {
                    position += 1
                    c = ch(position)
                }
                arguments.add(text(start, position))
            }
            if (c != 0) readLineBreak()

            when (name) {
                "YAML" -> {
                    if (version != null) throw fail("duplication of %YAML directive")
                    if (arguments.size != 1) throw fail("YAML directive accepts exactly one argument")
                    val parts = arguments[0].split(".")
                    if (parts.size != 2 || !parts.all { part -> part.isNotEmpty() && part.all { it in '0'..'9' } }) {
                        throw fail("ill-formed argument of the YAML directive")
                    }
                    version = arguments[0]
                    if (parts[0] != "1") throw fail("unacceptable YAML version of the document")
                }
                "TAG" -> throw fail("%TAG directives are not supported")
                else -> {}
            }
        }

        skipSeparationSpace(allowComments = true)

        if (lineIndent == 0 && ch(position) == 0x2D && ch(position + 1) == 0x2D && ch(position + 2) == 0x2D) {
            position += 3
            skipSeparationSpace(allowComments = true)
        } else if (hasDirectives) {
            throw fail("directives end mark is expected")
        }

        composeNode(lineIndent - 1, Context.BLOCK_OUT, allowToSeek = false, allowCompact = true)
        skipSeparationSpace(allowComments = true)

        documents.add(result)

        if (position == lineStart && testDocumentSeparator()) {
            if (ch(position) == 0x2E) {
                position += 3
                skipSeparationSpace(allowComments = true)
            }
            return
        }
        if (position < length - 1) throw fail("end of the stream or a document separator is expected")
    }
}
