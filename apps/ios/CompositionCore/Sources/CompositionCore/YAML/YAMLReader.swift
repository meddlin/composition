import Foundation

// A reader for YAML that decides what the desktop's js-yaml 4 decides (build plan, Step 3).
//
// The desktop reads a note's frontmatter with js-yaml, and "is this note's top block a YAML mapping?" is what makes it
// frontmatter at all. There is no YAML library in the iPad's dependencies, and a lookalike reader that disagrees with js-yaml
// would show a note's header as text on one device and hide it on the other. So this is a port of js-yaml's `loader.js` (block
// and flow collections, plain, quoted and block scalars, anchors, tags, merge keys), kept close to its shape so the two can be
// compared side by side, and checked against the real library on a corpus of frontmatter blocks (frontmatter-cases.json).
//
// Differences from js-yaml, all of them on input no note has: `%TAG` directives are refused, the optional YAML types
// `!!binary`, `!!omap`, `!!pairs` and `!!set` keep the value as read, and a date used as a mapping key is spelled in ISO form.

struct YAMLError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

struct YAMLReader {
    private enum Kind { case scalar, sequence, mapping }
    private enum Context { case flowIn, flowOut, blockIn, blockOut }
    private enum Chomping { case clip, strip, keep }

    private struct Snapshot {
        var position: Int, line: Int, lineStart: Int, lineIndent: Int, firstTabInLine: Int
        var tag: String?, anchor: String?, kind: Kind?, result: YAMLValue?
    }

    private static let maxDepth = 100
    private static let maxTotalMergeKeys = 10_000
    /// The reader recurses once per level of nesting, and a thread other than the main one may have only 512 KB of stack (a
    /// debug build spends several KB a level). A document that would use the last of it is refused, as one past `maxDepth` is.
    private static let stackReserve = 160_000

    private static func remainingStack() -> Int {
        let thread = pthread_self()
        let top = Int(bitPattern: pthread_get_stackaddr_np(thread))
        let size = Int(pthread_get_stacksize_np(thread))
        var marker = 0
        let here = withUnsafeMutablePointer(to: &marker) { Int(bitPattern: $0) }
        return here - (top - size)
    }

    private var input: [UInt16]
    private let length: Int
    private var position = 0
    private var line = 0
    private var lineStart = 0
    private var lineIndent = 0
    private var firstTabInLine = -1
    private var depth = 0
    private var totalMergeKeys = 0

    private var tag: String?
    private var anchor: String?
    private var kind: Kind?
    /// What was just read; nil is a YAML null or nothing at all.
    private var result: YAMLValue?
    private var anchors: [String: YAMLValue] = [:]
    private var documents: [YAMLValue?] = []
    private var version: String?

    /// The value of the single document in `text`; nil when it is empty or null. Throws what js-yaml throws.
    static func load(_ text: String) throws -> YAMLValue? {
        var reader = try YAMLReader(text)
        while reader.position < reader.length - 1 {
            let before = reader.position
            try reader.readDocument()
            if reader.position == before { throw YAMLError(message: "the reader is stuck") }
        }
        switch reader.documents.count {
        case 0: return nil
        case 1: return reader.documents[0]
        default: throw YAMLError(message: "expected a single document in the stream, but found more")
        }
    }

    private init(_ text: String) throws {
        var units = Array(text.utf16)
        if !units.isEmpty {
            if units.last != 0x0A && units.last != 0x0D { units.append(0x0A) }
            if units.first == 0xFEFF { units.removeFirst() }
        }
        if units.contains(0) { throw YAMLError(message: "null byte is not allowed in input") }
        length = units.count
        units.append(0)
        input = units
        while input[position] == 0x20 {
            lineIndent += 1
            position += 1
        }
    }

    // MARK: Characters

    private func ch(_ index: Int) -> UInt16 { index >= 0 && index < input.count ? input[index] : 0 }

    private static func isEol(_ c: UInt16) -> Bool { c == 0x0A || c == 0x0D }
    private static func isWhiteSpace(_ c: UInt16) -> Bool { c == 0x09 || c == 0x20 }
    private static func isWsOrEol(_ c: UInt16) -> Bool { c == 0x09 || c == 0x20 || c == 0x0A || c == 0x0D }
    private static func isFlowIndicator(_ c: UInt16) -> Bool { c == 0x2C || c == 0x5B || c == 0x5D || c == 0x7B || c == 0x7D }

    private static func hexValue(_ c: UInt16) -> Int? {
        if c >= 0x30 && c <= 0x39 { return Int(c) - 0x30 }
        let lower = c | 0x20
        if lower >= 0x61 && lower <= 0x66 { return Int(lower) - 0x61 + 10 }
        return nil
    }

    private static func decimalValue(_ c: UInt16) -> Int? { c >= 0x30 && c <= 0x39 ? Int(c) - 0x30 : nil }

    private static func escape(for c: UInt16) -> UInt16? {
        switch c {
        case 0x30: 0x00
        case 0x61: 0x07
        case 0x62: 0x08
        case 0x74, 0x09: 0x09
        case 0x6E: 0x0A
        case 0x76: 0x0B
        case 0x66: 0x0C
        case 0x72: 0x0D
        case 0x65: 0x1B
        case 0x20: 0x20
        case 0x22: 0x22
        case 0x2F: 0x2F
        case 0x5C: 0x5C
        case 0x4E: 0x85
        case 0x5F: 0xA0
        case 0x4C: 0x2028
        case 0x50: 0x2029
        default: nil
        }
    }

    private static func isNonPrintable(_ c: UInt16) -> Bool {
        (c <= 0x08) || c == 0x0B || c == 0x0C || (c >= 0x0E && c <= 0x1F) || (c >= 0x7F && c <= 0x84) || (c >= 0x86 && c <= 0x9F)
            || c == 0xFFFE || c == 0xFFFF
    }

    private func fail(_ message: String) -> YAMLError { YAMLError(message: "\(message) (line \(line + 1))") }

    // MARK: State

    private func snapshot() -> Snapshot {
        Snapshot(position: position, line: line, lineStart: lineStart, lineIndent: lineIndent, firstTabInLine: firstTabInLine,
            tag: tag, anchor: anchor, kind: kind, result: result)
    }

    private mutating func restore(_ s: Snapshot) {
        (position, line, lineStart, lineIndent, firstTabInLine) = (s.position, s.line, s.lineStart, s.lineIndent, s.firstTabInLine)
        (tag, anchor, kind, result) = (s.tag, s.anchor, s.kind, s.result)
    }

    private mutating func storeAnchor(_ name: String, _ value: YAMLValue?) { anchors[name] = value ?? .null }

    private mutating func readLineBreak() throws {
        let c = ch(position)
        if c == 0x0A {
            position += 1
        } else if c == 0x0D {
            position += 1
            if ch(position) == 0x0A { position += 1 }
        } else {
            throw fail("a line break is expected")
        }
        line += 1
        lineStart = position
        firstTabInLine = -1
    }

    /// Skips white space, line breaks and (when allowed) comments; the number of line breaks passed.
    @discardableResult
    private mutating func skipSeparationSpace(allowComments: Bool) -> Int {
        var lineBreaks = 0
        var c = ch(position)
        while c != 0 {
            while Self.isWhiteSpace(c) {
                if c == 0x09 && firstTabInLine == -1 { firstTabInLine = position }
                position += 1
                c = ch(position)
            }
            if allowComments && c == 0x23 {
                repeat {
                    position += 1
                    c = ch(position)
                } while c != 0x0A && c != 0x0D && c != 0
            }
            if Self.isEol(c) {
                try? readLineBreak()
                c = ch(position)
                lineBreaks += 1
                lineIndent = 0
                while c == 0x20 {
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

    private func testDocumentSeparator() -> Bool {
        let c = ch(position)
        if (c == 0x2D || c == 0x2E) && c == ch(position + 1) && c == ch(position + 2) {
            let after = ch(position + 3)
            return after == 0 || Self.isWsOrEol(after)
        }
        return false
    }

    private func capture(_ buffer: inout [UInt16], _ start: Int, _ end: Int, json: Bool) throws {
        guard start < end else { return }
        for index in start..<end {
            let unit = input[index]
            if json {
                if !(unit == 0x09 || unit >= 0x20) { throw fail("expected valid JSON character") }
            } else if Self.isNonPrintable(unit) {
                throw fail("the stream contains non-printable characters")
            }
        }
        buffer.append(contentsOf: input[start..<end])
    }

    private static func writeFoldedLines(_ buffer: inout [UInt16], _ count: Int) {
        if count == 1 {
            buffer.append(0x20)
        } else if count > 1 {
            buffer.append(contentsOf: [UInt16](repeating: 0x0A, count: count - 1))
        }
    }

    private static func text(_ units: [UInt16]) -> String { String(decoding: units, as: UTF16.self) }

    // MARK: Mapping pairs

    /// JavaScript's `String(key)` for a key node, which is how js-yaml names the property.
    private func keyName(_ key: YAMLValue?) throws -> String {
        guard let key else { return "null" }
        if case .sequence(let items) = key {
            for item in items {
                if case .sequence = item { throw fail("nested arrays are not supported inside keys") }
            }
        }
        return JavaScriptText.string(key)
    }

    private mutating func chargeMergeWork() throws {
        totalMergeKeys += 1
        if totalMergeKeys > Self.maxTotalMergeKeys { throw fail("merge keys exceeded maxTotalMergeKeys") }
    }

    private mutating func mergeMappings(into map: inout YAMLMapping, _ source: YAMLValue?, _ overridable: inout Set<String>) throws {
        guard case .mapping(let sourceMap)? = source else { throw fail("cannot merge mappings; the provided source object is unacceptable") }
        try chargeMergeWork()
        for (key, value) in sourceMap.pairs {
            try chargeMergeWork()
            if !map.has(key) {
                map.set(key, value)
                overridable.insert(key)
            }
        }
    }

    private mutating func storeMappingPair(_ map: inout YAMLMapping, _ overridable: inout Set<String>, keyTag: String?, key: YAMLValue?, value: YAMLValue?) throws {
        let name = try keyName(key)
        if keyTag == YAMLScalars.mergeTag {
            if case .sequence(let sources)? = value {
                if sources.count > 100 { throw fail("abnormal merge sequence size") }
                for source in sources { try mergeMappings(into: &map, source, &overridable) }
            } else {
                try mergeMappings(into: &map, value, &overridable)
            }
        } else {
            if !overridable.contains(name) && map.has(name) { throw fail("duplicated mapping key") }
            map.set(name, value ?? .null)
            overridable.remove(name)
        }
    }

    // MARK: Scalars

    private mutating func readPlainScalar(nodeIndent: Int, withinFlow: Bool) throws -> Bool {
        let savedKind = kind, savedResult = result
        var c = ch(position)

        if Self.isWsOrEol(c) || Self.isFlowIndicator(c) || c == 0x23 || c == 0x26 || c == 0x2A || c == 0x21 || c == 0x7C || c == 0x3E
            || c == 0x27 || c == 0x22 || c == 0x25 || c == 0x40 || c == 0x60
        {
            return false
        }
        if c == 0x3F || c == 0x2D {
            let following = ch(position + 1)
            if Self.isWsOrEol(following) || (withinFlow && Self.isFlowIndicator(following)) { return false }
        }

        kind = .scalar
        result = .string("")
        var buffer: [UInt16] = []
        var captureStart = position, captureEnd = position
        var hasPendingContent = false
        var savedLine = 0, savedLineStart = 0, savedLineIndent = 0

        scanning: while c != 0 {
            if c == 0x3A {
                let following = ch(position + 1)
                if Self.isWsOrEol(following) || (withinFlow && Self.isFlowIndicator(following)) { break scanning }
            } else if c == 0x23 {
                if Self.isWsOrEol(ch(position - 1)) { break scanning }
            } else if (position == lineStart && testDocumentSeparator()) || (withinFlow && Self.isFlowIndicator(c)) {
                break scanning
            } else if Self.isEol(c) {
                savedLine = line
                savedLineStart = lineStart
                savedLineIndent = lineIndent
                skipSeparationSpace(allowComments: false)
                if lineIndent >= nodeIndent {
                    hasPendingContent = true
                    c = ch(position)
                    continue scanning
                } else {
                    position = captureEnd
                    line = savedLine
                    lineStart = savedLineStart
                    lineIndent = savedLineIndent
                    break scanning
                }
            }

            if hasPendingContent {
                try capture(&buffer, captureStart, captureEnd, json: false)
                Self.writeFoldedLines(&buffer, line - savedLine)
                captureStart = position
                captureEnd = position
                hasPendingContent = false
            }
            if !Self.isWhiteSpace(c) { captureEnd = position + 1 }
            position += 1
            c = ch(position)
        }

        try capture(&buffer, captureStart, captureEnd, json: false)
        if !buffer.isEmpty {
            result = .string(Self.text(buffer))
            return true
        }
        kind = savedKind
        result = savedResult
        return false
    }

    private mutating func readSingleQuotedScalar(nodeIndent: Int) throws -> Bool {
        guard ch(position) == 0x27 else { return false }
        kind = .scalar
        result = .string("")
        position += 1
        var buffer: [UInt16] = []
        var captureStart = position, captureEnd = position

        while true {
            let c = ch(position)
            if c == 0 { break }
            if c == 0x27 {
                try capture(&buffer, captureStart, position, json: true)
                position += 1
                if ch(position) == 0x27 {
                    captureStart = position
                    position += 1
                    captureEnd = position
                } else {
                    result = .string(Self.text(buffer))
                    return true
                }
            } else if Self.isEol(c) {
                try capture(&buffer, captureStart, captureEnd, json: true)
                Self.writeFoldedLines(&buffer, skipSeparationSpace(allowComments: false))
                captureStart = position
                captureEnd = position
            } else if position == lineStart && testDocumentSeparator() {
                throw fail("unexpected end of the document within a single quoted scalar")
            } else {
                position += 1
                if !Self.isWhiteSpace(c) { captureEnd = position }
            }
        }
        throw fail("unexpected end of the stream within a single quoted scalar")
    }

    private mutating func readDoubleQuotedScalar(nodeIndent: Int) throws -> Bool {
        guard ch(position) == 0x22 else { return false }
        kind = .scalar
        result = .string("")
        position += 1
        var buffer: [UInt16] = []
        var captureStart = position, captureEnd = position

        while true {
            var c = ch(position)
            if c == 0 { break }
            if c == 0x22 {
                try capture(&buffer, captureStart, position, json: true)
                position += 1
                result = .string(Self.text(buffer))
                return true
            } else if c == 0x5C {
                try capture(&buffer, captureStart, position, json: true)
                position += 1
                c = ch(position)
                if Self.isEol(c) {
                    skipSeparationSpace(allowComments: false)
                } else if let simple = Self.escape(for: c) {
                    buffer.append(simple)
                    position += 1
                } else if c == 0x78 || c == 0x75 || c == 0x55 {
                    var remaining = c == 0x78 ? 2 : (c == 0x75 ? 4 : 8)
                    var code = 0
                    while remaining > 0 {
                        position += 1
                        guard let digit = Self.hexValue(ch(position)) else { throw fail("expected hexadecimal character") }
                        code = (code << 4) + digit
                        remaining -= 1
                    }
                    if code <= 0xFFFF {
                        buffer.append(UInt16(code))
                    } else if code <= 0x10FFFF {
                        buffer.append(UInt16(((code - 0x10000) >> 10) + 0xD800))
                        buffer.append(UInt16(((code - 0x10000) & 0x3FF) + 0xDC00))
                    } else {
                        throw fail("code point within a string may not be greater than 0x10FFFF")
                    }
                    position += 1
                } else {
                    throw fail("unknown escape sequence")
                }
                captureStart = position
                captureEnd = position
            } else if Self.isEol(c) {
                try capture(&buffer, captureStart, captureEnd, json: true)
                Self.writeFoldedLines(&buffer, skipSeparationSpace(allowComments: false))
                captureStart = position
                captureEnd = position
            } else if position == lineStart && testDocumentSeparator() {
                throw fail("unexpected end of the document within a double quoted scalar")
            } else {
                position += 1
                if !Self.isWhiteSpace(c) { captureEnd = position }
            }
        }
        throw fail("unexpected end of the stream within a double quoted scalar")
    }

    private mutating func readBlockScalar(nodeIndent: Int) throws -> Bool {
        var chomping = Chomping.clip
        var didReadContent = false, detectedIndent = false
        var textIndent = nodeIndent
        var emptyLines = 0
        var atMoreIndented = false
        var c = ch(position)

        let folding: Bool
        if c == 0x7C {
            folding = false
        } else if c == 0x3E {
            folding = true
        } else {
            return false
        }
        kind = .scalar
        var buffer: [UInt16] = []
        func newlines(_ count: Int) -> [UInt16] { [UInt16](repeating: 0x0A, count: max(0, count)) }

        while c != 0 {
            position += 1
            c = ch(position)
            if c == 0x2B || c == 0x2D {
                if chomping == .clip {
                    chomping = c == 0x2B ? .keep : .strip
                } else {
                    throw fail("repeat of a chomping mode identifier")
                }
            } else if let digit = Self.decimalValue(c) {
                if digit == 0 {
                    throw fail("bad explicit indentation width of a block scalar; it cannot be less than one")
                } else if !detectedIndent {
                    textIndent = nodeIndent + digit - 1
                    detectedIndent = true
                } else {
                    throw fail("repeat of an indentation width identifier")
                }
            } else {
                break
            }
        }

        if Self.isWhiteSpace(c) {
            repeat {
                position += 1
                c = ch(position)
            } while Self.isWhiteSpace(c)
            if c == 0x23 {
                repeat {
                    position += 1
                    c = ch(position)
                } while !Self.isEol(c) && c != 0
            }
        }

        while c != 0 {
            try readLineBreak()
            lineIndent = 0
            c = ch(position)

            while (!detectedIndent || lineIndent < textIndent) && c == 0x20 {
                lineIndent += 1
                position += 1
                c = ch(position)
            }
            if !detectedIndent && lineIndent > textIndent { textIndent = lineIndent }

            if Self.isEol(c) {
                emptyLines += 1
                continue
            }
            if !detectedIndent && textIndent == 0 { throw fail("missing indentation for block scalar") }

            if lineIndent < textIndent {
                if chomping == .keep {
                    buffer.append(contentsOf: newlines(didReadContent ? 1 + emptyLines : emptyLines))
                } else if chomping == .clip, didReadContent {
                    buffer.append(0x0A)
                }
                break
            }

            if folding {
                if Self.isWhiteSpace(c) {
                    atMoreIndented = true
                    buffer.append(contentsOf: newlines(didReadContent ? 1 + emptyLines : emptyLines))
                } else if atMoreIndented {
                    atMoreIndented = false
                    buffer.append(contentsOf: newlines(emptyLines + 1))
                } else if emptyLines == 0 {
                    if didReadContent { buffer.append(0x20) }
                } else {
                    buffer.append(contentsOf: newlines(emptyLines))
                }
            } else {
                buffer.append(contentsOf: newlines(didReadContent ? 1 + emptyLines : emptyLines))
            }

            didReadContent = true
            detectedIndent = true
            emptyLines = 0
            let captureStart = position
            while !Self.isEol(c) && c != 0 {
                position += 1
                c = ch(position)
            }
            try capture(&buffer, captureStart, position, json: false)
        }

        result = .string(Self.text(buffer))
        return true
    }

    // MARK: Collections

    private mutating func readFlowCollection(nodeIndent: Int) throws -> Bool {
        var readNext = true
        let savedTag = tag, savedAnchor = anchor
        var c = ch(position)
        let terminator: UInt16
        let isMapping: Bool
        var items: [YAMLValue] = []
        var map = YAMLMapping()
        var overridable = Set<String>()

        if c == 0x5B {
            terminator = 0x5D
            isMapping = false
        } else if c == 0x7B {
            terminator = 0x7D
            isMapping = true
        } else {
            return false
        }
        if let name = anchor { storeAnchor(name, isMapping ? .mapping(map) : .sequence(items)) }

        position += 1
        c = ch(position)
        while c != 0 {
            skipSeparationSpace(allowComments: true)
            c = ch(position)

            if c == terminator {
                position += 1
                tag = savedTag
                anchor = savedAnchor
                kind = isMapping ? .mapping : .sequence
                result = isMapping ? .mapping(map) : .sequence(items)
                return true
            } else if !readNext {
                throw fail("missed comma between flow collection entries")
            } else if c == 0x2C {
                throw fail("expected the node content, but found ','")
            }

            var isPair = false, isExplicitPair = false
            var valueNode: YAMLValue?

            if c == 0x3F, Self.isWsOrEol(ch(position + 1)) {
                isPair = true
                isExplicitPair = true
                position += 1
                skipSeparationSpace(allowComments: true)
            }

            let startLine = line
            try composeNode(parentIndent: nodeIndent, context: .flowIn, allowToSeek: false, allowCompact: true)
            let keyTag = tag
            let keyNode = result
            skipSeparationSpace(allowComments: true)
            c = ch(position)

            if (isExplicitPair || line == startLine) && c == 0x3A {
                isPair = true
                position += 1
                c = ch(position)
                skipSeparationSpace(allowComments: true)
                try composeNode(parentIndent: nodeIndent, context: .flowIn, allowToSeek: false, allowCompact: true)
                valueNode = result
            }

            if isMapping {
                try storeMappingPair(&map, &overridable, keyTag: keyTag, key: keyNode, value: valueNode)
            } else if isPair {
                var pair = YAMLMapping()
                var pairOverridable = Set<String>()
                try storeMappingPair(&pair, &pairOverridable, keyTag: keyTag, key: keyNode, value: valueNode)
                items.append(.mapping(pair))
            } else {
                items.append(keyNode ?? .null)
            }

            skipSeparationSpace(allowComments: true)
            c = ch(position)
            if c == 0x2C {
                readNext = true
                position += 1
                c = ch(position)
            } else {
                readNext = false
            }
        }
        throw fail("unexpected end of the stream within a flow collection")
    }

    private mutating func readBlockSequence(nodeIndent: Int) throws -> Bool {
        let savedTag = tag, savedAnchor = anchor
        var items: [YAMLValue] = []
        var detected = false

        if firstTabInLine != -1 { return false }
        if let name = anchor { storeAnchor(name, .sequence(items)) }

        var c = ch(position)
        while c != 0 {
            if firstTabInLine != -1 { throw fail("tab characters must not be used in indentation") }
            if c != 0x2D { break }
            if !Self.isWsOrEol(ch(position + 1)) { break }

            detected = true
            position += 1

            if skipSeparationSpace(allowComments: true) > 0, lineIndent <= nodeIndent {
                items.append(.null)
                c = ch(position)
                continue
            }

            let startLine = line
            try composeNode(parentIndent: nodeIndent, context: .blockIn, allowToSeek: false, allowCompact: true)
            items.append(result ?? .null)
            skipSeparationSpace(allowComments: true)
            c = ch(position)

            if (line == startLine || lineIndent > nodeIndent) && c != 0 {
                throw fail("bad indentation of a sequence entry")
            } else if lineIndent < nodeIndent {
                break
            }
        }

        if detected {
            tag = savedTag
            anchor = savedAnchor
            kind = .sequence
            result = .sequence(items)
            return true
        }
        return false
    }

    private mutating func readBlockMapping(nodeIndent: Int, flowIndent: Int) throws -> Bool {
        let savedTag = tag, savedAnchor = anchor
        var map = YAMLMapping()
        var overridable = Set<String>()
        var keyTag: String?, keyNode: YAMLValue?, valueNode: YAMLValue?
        var atExplicitKey = false, detected = false, allowCompact = false

        if firstTabInLine != -1 { return false }
        if let name = anchor { storeAnchor(name, .mapping(map)) }

        var c = ch(position)
        while c != 0 {
            if !atExplicitKey && firstTabInLine != -1 { throw fail("tab characters must not be used in indentation") }

            let following = ch(position + 1)
            let startLine = line

            if (c == 0x3F || c == 0x3A) && Self.isWsOrEol(following) {
                if c == 0x3F {
                    if atExplicitKey {
                        try storeMappingPair(&map, &overridable, keyTag: keyTag, key: keyNode, value: nil)
                        keyTag = nil
                        keyNode = nil
                        valueNode = nil
                    }
                    detected = true
                    atExplicitKey = true
                    allowCompact = true
                } else if atExplicitKey {
                    atExplicitKey = false
                    allowCompact = true
                } else {
                    throw fail("incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line")
                }
                position += 1
                c = following
            } else {
                if !(try composeNode(parentIndent: flowIndent, context: .flowOut, allowToSeek: false, allowCompact: true)) { break }

                if line == startLine {
                    c = ch(position)
                    while Self.isWhiteSpace(c) {
                        position += 1
                        c = ch(position)
                    }
                    if c == 0x3A {
                        position += 1
                        c = ch(position)
                        if !Self.isWsOrEol(c) {
                            throw fail("a whitespace character is expected after the key-value separator within a block mapping")
                        }
                        if atExplicitKey {
                            try storeMappingPair(&map, &overridable, keyTag: keyTag, key: keyNode, value: nil)
                            keyTag = nil
                            keyNode = nil
                            valueNode = nil
                        }
                        detected = true
                        atExplicitKey = false
                        allowCompact = false
                        keyTag = tag
                        keyNode = result
                    } else if detected {
                        throw fail("can not read an implicit mapping pair; a colon is missed")
                    } else {
                        tag = savedTag
                        anchor = savedAnchor
                        return true
                    }
                } else if detected {
                    throw fail("can not read a block mapping entry; a multiline key may not be an implicit key")
                } else {
                    tag = savedTag
                    anchor = savedAnchor
                    return true
                }
            }

            if line == startLine || lineIndent > nodeIndent {
                if try composeNode(parentIndent: nodeIndent, context: .blockOut, allowToSeek: true, allowCompact: allowCompact) {
                    if atExplicitKey {
                        keyNode = result
                    } else {
                        valueNode = result
                    }
                }
                if !atExplicitKey {
                    try storeMappingPair(&map, &overridable, keyTag: keyTag, key: keyNode, value: valueNode)
                    keyTag = nil
                    keyNode = nil
                    valueNode = nil
                }
                skipSeparationSpace(allowComments: true)
                c = ch(position)
            }

            if (line == startLine || lineIndent > nodeIndent) && c != 0 {
                throw fail("bad indentation of a mapping entry")
            } else if lineIndent < nodeIndent {
                break
            }
        }

        if atExplicitKey {
            try storeMappingPair(&map, &overridable, keyTag: keyTag, key: keyNode, value: nil)
        }
        if detected {
            tag = savedTag
            anchor = savedAnchor
            kind = .mapping
            result = .mapping(map)
        }
        return detected
    }

    // MARK: Properties

    private mutating func readTagProperty() throws -> Bool {
        var isVerbatim = false, isNamed = false
        var handle = ""
        var name: [UInt16] = []
        var c = ch(position)

        if c != 0x21 { return false }
        if tag != nil { throw fail("duplication of a tag property") }
        position += 1
        c = ch(position)

        if c == 0x3C {
            isVerbatim = true
            position += 1
            c = ch(position)
        } else if c == 0x21 {
            isNamed = true
            handle = "!!"
            position += 1
            c = ch(position)
        } else {
            handle = "!"
        }

        var start = position
        if isVerbatim {
            repeat {
                position += 1
                c = ch(position)
            } while c != 0 && c != 0x3E
            if position < length {
                name = Array(input[start..<position])
                position += 1
            } else {
                throw fail("unexpected end of the stream within a verbatim tag")
            }
        } else {
            while c != 0 && !Self.isWsOrEol(c) {
                if c == 0x21 {
                    // A named handle (`!e!name`) is never declared here, so it ends in an undeclared-handle error either way.
                    if isNamed { throw fail("tag suffix cannot contain exclamation marks") }
                    handle = Self.text(Array(input[(start - 1)...position]))
                    isNamed = true
                    start = position + 1
                }
                position += 1
                c = ch(position)
            }
            name = Array(input[start..<position])
            if name.contains(where: Self.isFlowIndicator) { throw fail("tag suffix cannot contain flow indicator characters") }
        }

        let tagName = Self.text(name)
        if isVerbatim {
            tag = tagName
        } else if handle == "!" {
            tag = "!" + tagName
        } else if handle == "!!" {
            tag = "tag:yaml.org,2002:" + tagName
        } else {
            throw fail("undeclared tag handle \"\(handle)\"")
        }
        return true
    }

    private mutating func readAnchorProperty() throws -> Bool {
        guard ch(position) == 0x26 else { return false }
        if anchor != nil { throw fail("duplication of an anchor property") }
        position += 1
        let start = position
        var c = ch(position)
        while c != 0 && !Self.isWsOrEol(c) && !Self.isFlowIndicator(c) {
            position += 1
            c = ch(position)
        }
        if position == start { throw fail("name of an anchor node must contain at least one character") }
        anchor = Self.text(Array(input[start..<position]))
        return true
    }

    private mutating func readAlias() throws -> Bool {
        guard ch(position) == 0x2A else { return false }
        position += 1
        let start = position
        var c = ch(position)
        while c != 0 && !Self.isWsOrEol(c) && !Self.isFlowIndicator(c) {
            position += 1
            c = ch(position)
        }
        if position == start { throw fail("name of an alias node must contain at least one character") }
        let name = Self.text(Array(input[start..<position]))
        guard let value = anchors[name] else { throw fail("unidentified alias \"\(name)\"") }
        if case .null = value { result = nil } else { result = value }
        skipSeparationSpace(allowComments: true)
        return true
    }

    /// Reads `&anchor !tag` in front of an implicit key as part of that key, not of the mapping it starts.
    private mutating func tryReadBlockMappingFromProperty(_ propertyStart: Snapshot, nodeIndent: Int, flowIndent: Int) throws -> Bool {
        let fallback = snapshot()
        let savedAnchors = anchors
        restore(propertyStart)
        tag = nil
        anchor = nil
        kind = nil
        result = nil
        if try readBlockMapping(nodeIndent: nodeIndent, flowIndent: flowIndent), kind == .mapping { return true }
        anchors = savedAnchors
        restore(fallback)
        return false
    }

    // MARK: Nodes

    /// The type that an explicit `!!tag` names, and whether its value is a scalar or a collection.
    private static func explicitType(_ tag: String) -> (name: String, kind: Kind)? {
        let prefix = "tag:yaml.org,2002:"
        guard tag.hasPrefix(prefix) else { return nil }
        let name = String(tag.dropFirst(prefix.count))
        switch name {
        case "str", "null", "bool", "int", "float", "timestamp", "merge", "binary": return (name, .scalar)
        case "seq", "omap", "pairs": return (name, .sequence)
        case "map", "set": return (name, .mapping)
        default: return nil
        }
    }

    @discardableResult
    private mutating func composeNode(parentIndent: Int, context: Context, allowToSeek: Bool, allowCompact: Bool) throws -> Bool {
        var indentStatus = 1
        var atNewLine = false
        var hasContent = false
        var propertyStart: Snapshot?

        if depth >= Self.maxDepth { throw fail("nesting exceeded maxDepth") }
        if Self.remainingStack() < Self.stackReserve { throw fail("nested too deeply for this thread's stack") }
        depth += 1
        defer { depth -= 1 }

        tag = nil
        anchor = nil
        kind = nil
        result = nil

        let allowBlockStyles = context == .blockOut || context == .blockIn
        let allowBlockScalars = allowBlockStyles
        var allowBlockCollections = allowBlockStyles

        func status(_ indent: Int, _ parent: Int) -> Int { indent > parent ? 1 : (indent == parent ? 0 : -1) }

        if allowToSeek, skipSeparationSpace(allowComments: true) > 0 {
            atNewLine = true
            indentStatus = status(lineIndent, parentIndent)
        }

        if indentStatus == 1 {
            while true {
                let c = ch(position)
                let propertyState = snapshot()

                // A second property token after a line break can be the first key of a nested mapping.
                if atNewLine && ((c == 0x21 && tag != nil) || (c == 0x26 && anchor != nil)) { break }
                if !(try readTagProperty()) {
                    if !(try readAnchorProperty()) { break }
                }
                if propertyStart == nil { propertyStart = propertyState }

                if skipSeparationSpace(allowComments: true) > 0 {
                    atNewLine = true
                    allowBlockCollections = allowBlockStyles
                    indentStatus = status(lineIndent, parentIndent)
                } else {
                    allowBlockCollections = false
                }
            }
        }

        if allowBlockCollections { allowBlockCollections = atNewLine || allowCompact }

        if indentStatus == 1 || context == .blockOut {
            let flowIndent = (context == .flowIn || context == .flowOut) ? parentIndent : parentIndent + 1
            let blockIndent = position - lineStart

            if indentStatus == 1 {
                var found = false
                if allowBlockCollections {
                    if try readBlockSequence(nodeIndent: blockIndent) {
                        found = true
                    } else if try readBlockMapping(nodeIndent: blockIndent, flowIndent: flowIndent) {
                        found = true
                    }
                }
                if !found, try readFlowCollection(nodeIndent: flowIndent) { found = true }

                if found {
                    hasContent = true
                } else {
                    let c = ch(position)
                    if let start = propertyStart, allowBlockStyles, !allowBlockCollections, c != 0x7C, c != 0x3E,
                        try tryReadBlockMappingFromProperty(start, nodeIndent: start.position - start.lineStart, flowIndent: flowIndent)
                    {
                        hasContent = true
                    } else if try (allowBlockScalars && readBlockScalar(nodeIndent: flowIndent)) || readSingleQuotedScalar(nodeIndent: flowIndent)
                        || readDoubleQuotedScalar(nodeIndent: flowIndent)
                    {
                        hasContent = true
                    } else if try readAlias() {
                        hasContent = true
                        if tag != nil || anchor != nil { throw fail("alias node should not have any properties") }
                    } else if try readPlainScalar(nodeIndent: flowIndent, withinFlow: context == .flowIn) {
                        hasContent = true
                        if tag == nil { tag = "?" }
                    }
                    if let name = anchor { storeAnchor(name, result) }
                }
            } else if indentStatus == 0 {
                // Block sequences may sit at their parent mapping key's indent.
                if allowBlockCollections { hasContent = try readBlockSequence(nodeIndent: blockIndent) }
            }
        }

        if tag == nil {
            if let name = anchor { storeAnchor(name, result) }
        } else if tag == "?" {
            if result != nil, kind != .scalar { throw fail("unacceptable node kind for !<?> tag; it should be \"scalar\"") }
            if case .string(let raw)? = result, let (resolvedTag, value) = YAMLScalars.resolve(raw) {
                if case .null = value { result = nil } else { result = value }
                tag = resolvedTag
                if let name = anchor { storeAnchor(name, result) }
            }
        } else if tag != "!" {
            guard let type = Self.explicitType(tag!) else { throw fail("unknown tag !<\(tag!)>") }
            if result != nil, type.kind != kind { throw fail("unacceptable node kind for !<\(tag!)> tag") }
            var raw: String?
            if case .string(let text)? = result, type.kind == .scalar { raw = text }
            switch type.name {
            case "str":
                result = .string(raw ?? "")
            case "null":
                guard raw == nil || YAMLScalars.isNull(raw!) else { throw fail("cannot resolve a node with !<\(tag!)> explicit tag") }
                result = nil
            case "bool":
                guard let text = raw, let flag = YAMLScalars.boolean(text) else { throw fail("cannot resolve a node with !<\(tag!)> explicit tag") }
                result = .bool(flag)
            case "int":
                guard let text = raw, let number = YAMLScalars.integer(text) else { throw fail("cannot resolve a node with !<\(tag!)> explicit tag") }
                result = .number(number)
            case "float":
                guard let text = raw, let number = YAMLScalars.float(text) else { throw fail("cannot resolve a node with !<\(tag!)> explicit tag") }
                result = .number(number)
            case "timestamp":
                guard let text = raw, let milliseconds = YAMLScalars.timestamp(text) else { throw fail("cannot resolve a node with !<\(tag!)> explicit tag") }
                result = .timestamp(milliseconds)
            case "merge":
                guard raw == nil || raw == "<<" else { throw fail("cannot resolve a node with !<\(tag!)> explicit tag") }
            case "seq", "omap", "pairs":
                if result == nil { result = .sequence([]) }
            case "map", "set":
                if result == nil { result = .mapping(YAMLMapping()) }
            default:
                break
            }
            if let name = anchor { storeAnchor(name, result) }
        }

        return tag != nil || anchor != nil || hasContent
    }

    // MARK: Documents

    private mutating func readDocument() throws {
        var hasDirectives = false
        anchors = [:]
        version = nil

        while ch(position) != 0 {
            skipSeparationSpace(allowComments: true)
            var c = ch(position)
            if lineIndent > 0 || c != 0x25 { break }

            hasDirectives = true
            position += 1
            c = ch(position)
            var start = position
            while c != 0 && !Self.isWsOrEol(c) {
                position += 1
                c = ch(position)
            }
            let name = Self.text(Array(input[start..<position]))
            var arguments: [String] = []
            if name.isEmpty { throw fail("directive name must not be less than one character in length") }

            while c != 0 {
                while Self.isWhiteSpace(c) {
                    position += 1
                    c = ch(position)
                }
                if c == 0x23 {
                    repeat {
                        position += 1
                        c = ch(position)
                    } while c != 0 && !Self.isEol(c)
                    break
                }
                if Self.isEol(c) { break }
                start = position
                while c != 0 && !Self.isWsOrEol(c) {
                    position += 1
                    c = ch(position)
                }
                arguments.append(Self.text(Array(input[start..<position])))
            }
            if c != 0 { try readLineBreak() }

            switch name {
            case "YAML":
                if version != nil { throw fail("duplication of %YAML directive") }
                guard arguments.count == 1 else { throw fail("YAML directive accepts exactly one argument") }
                let parts = arguments[0].split(separator: ".", omittingEmptySubsequences: false)
                guard parts.count == 2, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }) else {
                    throw fail("ill-formed argument of the YAML directive")
                }
                version = arguments[0]
                if parts[0] != "1" { throw fail("unacceptable YAML version of the document") }
            case "TAG":
                throw fail("%TAG directives are not supported")
            default:
                break
            }
        }

        skipSeparationSpace(allowComments: true)

        if lineIndent == 0 && ch(position) == 0x2D && ch(position + 1) == 0x2D && ch(position + 2) == 0x2D {
            position += 3
            skipSeparationSpace(allowComments: true)
        } else if hasDirectives {
            throw fail("directives end mark is expected")
        }

        try composeNode(parentIndent: lineIndent - 1, context: .blockOut, allowToSeek: false, allowCompact: true)
        skipSeparationSpace(allowComments: true)

        documents.append(result)

        if position == lineStart && testDocumentSeparator() {
            if ch(position) == 0x2E {
                position += 3
                skipSeparationSpace(allowComments: true)
            }
            return
        }
        if position < length - 1 { throw fail("end of the stream or a document separator is expected") }
    }
}
