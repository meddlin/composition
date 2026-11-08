import Foundation

// The writing half of the desktop's YAML library, for the one shape a note's frontmatter takes: a mapping whose values are
// strings or lists of strings (build plan, Step 3). Every note already stored was written by js-yaml's `dump`, and a note
// saved on the iPad must come out byte for byte as the desktop would have saved it, so the choice between plain, quoted and
// block styles, and the folding of long lines, are ports of js-yaml 4's `dumper.js` with the options the desktop passes
// (`noArrayIndent`, `sortKeys: false`, the default width of 80 and indent of 2).

enum YAMLWriter {
    enum Value {
        case string(String)
        case list([String])
    }

    private static let indent = 2
    private static let lineWidth = 80

    /// `yaml.dump(object, { noArrayIndent: true })` of a mapping from strings to strings and lists of strings.
    static func dump(_ pairs: [(key: String, value: Value)]) -> String {
        var result = ""
        for (index, pair) in pairs.enumerated() {
            if index > 0 { result += "\n" }
            result += scalar(pair.key, level: 1, isKey: true)
            switch pair.value {
            case .string(let text):
                result += ": " + scalar(text, level: 1, isKey: false)
            case .list(let items) where items.isEmpty:
                result += ": []"
            case .list(let items):
                // With `noArrayIndent` the dashes sit under the key.
                result += ":"
                for item in items { result += "\n- " + scalar(item, level: 1, isKey: false) }
            }
        }
        return result + "\n"
    }

    // MARK: Scalars

    private enum Style { case plain, single, literal, folded, double }

    /// `writeScalar`.
    private static func scalar(_ text: String, level: Int, isKey: Bool) -> String {
        if text.isEmpty { return "''" }
        if deprecatedBoolean(text) || base60(text) { return "'" + text + "'" }

        let units = Array(text.utf16)
        let spaces = indent * max(1, level)
        let width = max(min(lineWidth, 40), lineWidth - spaces)

        switch chooseStyle(units, singleLineOnly: isKey, width: width, ambiguous: YAMLScalars.readsAsAnotherType(text)) {
        case .plain:
            return text
        case .single:
            return "'" + text.replacingOccurrences(of: "'", with: "''") + "'"
        case .literal:
            return "|" + blockHeader(units) + dropEndingNewline(indentLines(text, spaces))
        case .folded:
            return ">" + blockHeader(units) + dropEndingNewline(indentLines(fold(units, width: width), spaces))
        case .double:
            return "\"" + escape(text) + "\""
        }
    }

    /// The old YAML 1.1 spellings of a boolean, which js-yaml quotes so that other readers keep them as text.
    private static func deprecatedBoolean(_ text: String) -> Bool {
        switch text {
        case "y", "Y", "yes", "Yes", "YES", "on", "On", "ON", "n", "N", "no", "No", "NO", "off", "Off", "OFF": true
        default: false
        }
    }

    /// `/^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/`: a base-60 number such as `12:30`.
    private static func base60(_ text: String) -> Bool {
        let units = Array(text.utf8)
        var index = 0
        func isDigit(_ i: Int) -> Bool { i < units.count && ((units[i] >= 0x30 && units[i] <= 0x39) || units[i] == 0x5F) }
        if index < units.count, units[index] == 0x2D || units[index] == 0x2B { index += 1 }
        guard isDigit(index) else { return false }
        while isDigit(index) { index += 1 }
        var groups = 0
        while index < units.count, units[index] == 0x3A {
            index += 1
            guard isDigit(index) else { return false }
            while isDigit(index) { index += 1 }
            groups += 1
        }
        guard groups > 0 else { return false }
        if index < units.count, units[index] == 0x2E {
            index += 1
            while isDigit(index) { index += 1 }
        }
        return index == units.count
    }

    // MARK: Style

    private static func isPrintable(_ c: Int) -> Bool {
        (c >= 0x20 && c <= 0x7E) || ((c >= 0xA1 && c <= 0xD7FF) && c != 0x2028 && c != 0x2029) || ((c >= 0xE000 && c <= 0xFFFD) && c != 0xFEFF)
            || (c >= 0x10000 && c <= 0x10FFFF)
    }

    private static func isWhitespace(_ c: Int) -> Bool { c == 0x20 || c == 0x09 }

    private static func isNsCharOrWhitespace(_ c: Int) -> Bool { isPrintable(c) && c != 0xFEFF && c != 0x0D && c != 0x0A }

    private static func isPlainSafe(_ c: Int, previous: Int?) -> Bool {
        let nsOrSpace = isNsCharOrWhitespace(c)
        let ns = nsOrSpace && !isWhitespace(c)
        let safe = nsOrSpace && c != 0x23 && !(previous == 0x3A && !ns)
        let hashAfterChar = previous.map { isNsCharOrWhitespace($0) && !isWhitespace($0) && c == 0x23 } ?? false
        let colonBeforeChar = previous == 0x3A && ns
        return safe || hashAfterChar || colonBeforeChar
    }

    private static func isPlainSafeFirst(_ c: Int) -> Bool {
        guard isPrintable(c), c != 0xFEFF, !isWhitespace(c) else { return false }
        // The YAML indicators: - ? : , [ ] { } # & * ! | = > ' " % @ `
        let indicators: [Int] = [0x2D, 0x3F, 0x3A, 0x2C, 0x5B, 0x5D, 0x7B, 0x7D, 0x23, 0x26, 0x2A, 0x21, 0x7C, 0x3D, 0x3E, 0x27, 0x22, 0x25, 0x40, 0x60]
        return !indicators.contains(c)
    }

    private static func isPlainSafeLast(_ c: Int) -> Bool { !isWhitespace(c) && c != 0x3A }

    /// `String.prototype.codePointAt`, with the length of the unit run it spans.
    private static func codePoint(_ units: [UInt16], _ index: Int) -> (value: Int, width: Int) {
        let first = Int(units[index])
        if first >= 0xD800 && first <= 0xDBFF && index + 1 < units.count {
            let second = Int(units[index + 1])
            if second >= 0xDC00 && second <= 0xDFFF { return ((first - 0xD800) * 0x400 + second - 0xDC00 + 0x10000, 2) }
        }
        return (first, 1)
    }

    /// Whether a block scalar needs an indentation indicator: it starts with newlines and then a space.
    private static func needsIndentIndicator(_ units: [UInt16]) -> Bool {
        var index = 0
        while index < units.count, units[index] == 0x0A { index += 1 }
        return index < units.count && units[index] == 0x20
    }

    /// `chooseScalarStyle`.
    private static func chooseStyle(_ units: [UInt16], singleLineOnly: Bool, width: Int, ambiguous: Bool) -> Style {
        var previous: Int?
        var hasLineBreak = false, hasFoldableLine = false
        var previousLineBreak = -1
        var plain = isPlainSafeFirst(codePoint(units, 0).value) && isPlainSafeLast(codePoint(units, units.count - 1).value)

        var index = 0
        while index < units.count {
            let (c, step) = codePoint(units, index)
            if c == 0x0A && !singleLineOnly {
                hasLineBreak = true
                // A foldable line is too long and not more indented.
                hasFoldableLine = hasFoldableLine || (index - previousLineBreak - 1 > width && units[previousLineBreak + 1] != 0x20)
                previousLineBreak = index
            } else if !isPrintable(c) {
                return .double
            }
            plain = plain && isPlainSafe(c, previous: previous)
            previous = c
            index += step
        }
        if !singleLineOnly {
            hasFoldableLine = hasFoldableLine || (index - previousLineBreak - 1 > width && units[previousLineBreak + 1] != 0x20)
        }

        if !hasLineBreak && !hasFoldableLine {
            return plain && !ambiguous ? .plain : .single
        }
        // The indentation indicator is one digit, and the indent here is 2, so it always fits.
        return hasFoldableLine ? .folded : .literal
    }

    private static func blockHeader(_ units: [UInt16]) -> String {
        let indicator = needsIndentIndicator(units) ? String(indent) : ""
        let clip = units.last == 0x0A
        let keep = clip && (units.count >= 2 && units[units.count - 2] == 0x0A || units == [0x0A])
        let chomp = keep ? "+" : (clip ? "" : "-")
        return indicator + chomp + "\n"
    }

    private static func dropEndingNewline(_ text: String) -> String { text.hasSuffix("\n") ? String(text.dropLast()) : text }

    /// Indents every line except the empty ones.
    private static func indentLines(_ text: String, _ spaces: Int) -> String {
        let pad = String(repeating: " ", count: spaces)
        var result = ""
        var line = ""
        for character in text.unicodeScalars {
            line.unicodeScalars.append(character)
            if character == "\n" {
                if line != "\n" { result += pad }
                result += line
                line = ""
            }
        }
        if !line.isEmpty { result += pad + line }
        return result
    }

    // MARK: Folding

    /// `foldString`: lines longer than `width` are broken at spaces; runs of newlines keep their meaning when read folded.
    private static func fold(_ units: [UInt16], width: Int) -> String {
        let count = units.count
        let firstBreak = units.firstIndex(of: 0x0A) ?? count
        var result = foldLine(Array(units[0..<firstBreak]), width: width)
        var previousMoreIndented = units.first == 0x0A || units.first == 0x20

        // The rest: each chunk is newlines followed by one content line.
        var index = firstBreak
        while index < count {
            var newlineEnd = index
            while newlineEnd < count, units[newlineEnd] == 0x0A { newlineEnd += 1 }
            var lineEnd = newlineEnd
            while lineEnd < count, units[lineEnd] != 0x0A { lineEnd += 1 }
            let prefix = units[index..<newlineEnd]
            let line = Array(units[newlineEnd..<lineEnd])
            let moreIndented = line.first == 0x20
            result += String(decoding: prefix, as: UTF16.self)
            if !previousMoreIndented && !moreIndented && !line.isEmpty { result += "\n" }
            result += foldLine(line, width: width)
            previousMoreIndented = moreIndented
            index = lineEnd
        }
        return result
    }

    /// `foldLine`: greedy breaking, picking the longest line under the limit each time, otherwise the shortest line over it.
    private static func foldLine(_ line: [UInt16], width: Int) -> String {
        if line.isEmpty || line[0] == 0x20 { return String(decoding: line, as: UTF16.self) }

        // Break points are a space followed by a non-space.
        var breaks: [Int] = []
        var i = 0
        while i + 1 < line.count {
            if line[i] == 0x20 && line[i + 1] != 0x20 {
                breaks.append(i)
                i += 2
            } else {
                i += 1
            }
        }

        var start = 0
        var curr = 0
        var result = ""
        for next in breaks {
            // Keep the invariant: curr - start <= width.
            if next - start > width {
                let end = curr > start ? curr : next
                result += "\n" + String(decoding: line[start..<end], as: UTF16.self)
                start = end + 1
            }
            curr = next
        }
        result += "\n"
        if line.count - start > width && curr > start {
            result += String(decoding: line[start..<curr], as: UTF16.self) + "\n" + String(decoding: line[(curr + 1)...], as: UTF16.self)
        } else {
            result += String(decoding: line[start...], as: UTF16.self)
        }
        return String(result.dropFirst())
    }

    // MARK: Double quotes

    private static let escapes: [Int: String] = [
        0x00: "\\0", 0x07: "\\a", 0x08: "\\b", 0x09: "\\t", 0x0A: "\\n", 0x0B: "\\v", 0x0C: "\\f", 0x0D: "\\r", 0x1B: "\\e",
        0x22: "\\\"", 0x5C: "\\\\", 0x85: "\\N", 0xA0: "\\_", 0x2028: "\\L", 0x2029: "\\P",
    ]

    private static func escape(_ text: String) -> String {
        var result = ""
        for scalar in text.unicodeScalars {
            let c = Int(scalar.value)
            if let sequence = escapes[c] {
                result += sequence
            } else if isPrintable(c) {
                result.unicodeScalars.append(scalar)
            } else {
                let hex = String(c, radix: 16, uppercase: true)
                let (marker, digits) = c <= 0xFF ? ("x", 2) : (c <= 0xFFFF ? ("u", 4) : ("U", 8))
                result += "\\" + marker + String(repeating: "0", count: digits - hex.count) + hex
            }
        }
        return result
    }
}
