import Foundation

// JSON that keeps what it was given. A PDF mark stores JSON in three columns (`rects`, `body`, `view_state`), and an ink mark's
// body is whatever strokes the drawing code made: it must come back as it went in, members in their order and numbers written
// the way JavaScript's `JSON.stringify` writes them (`JavaScriptText.numberString`), so the same mark is the same text on the desktop and on the iPad.
// `JSONSerialization` loses the order of an object's members and formats numbers its own way, which is why this exists.

public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object(JSONObject)

    public var doubleValue: Double? {
        if case .number(let value) = self { value } else { nil }
    }

    /// A whole number a JavaScript `Number.isSafeInteger` accepts, or nil.
    public var integerValue: Int? {
        guard case .number(let value) = self, value.isFinite, value == value.rounded(.towardZero), abs(value) <= 9_007_199_254_740_991 else { return nil }
        return Int(value)
    }

    public var stringValue: String? {
        if case .string(let value) = self { value } else { nil }
    }

    public var objectValue: JSONObject? {
        if case .object(let value) = self { value } else { nil }
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let value) = self { value } else { nil }
    }
}

/// An object whose members keep the order they were written in. Two objects are equal when they hold the same members, in
/// whatever order, as JSON means it.
public struct JSONObject: Equatable, Sendable {
    public struct Member: Equatable, Sendable {
        public let key: String
        public let value: JSONValue
        public init(_ key: String, _ value: JSONValue) { (self.key, self.value) = (key, value) }
    }

    public private(set) var members: [Member]

    /// A key given twice keeps its first place and its last value, as `JSON.parse` does.
    public init(_ members: [Member] = []) {
        var placed: [String: Int] = [:]
        var unique: [Member] = []
        for member in members {
            if let at = placed[member.key] {
                unique[at] = member
            } else {
                placed[member.key] = unique.count
                unique.append(member)
            }
        }
        self.members = unique
    }

    public init(_ pairs: KeyValuePairs<String, JSONValue>) {
        self.init(pairs.map { Member($0.key, $0.value) })
    }

    public subscript(key: String) -> JSONValue? {
        members.first { $0.key == key }?.value
    }

    public static func == (lhs: JSONObject, rhs: JSONObject) -> Bool {
        lhs.members.count == rhs.members.count && lhs.members.allSatisfy { rhs[$0.key] == $0.value }
    }
}

public struct JSONParseError: Error, Equatable {
    public let offset: Int
}

// MARK: Reading

extension JSONValue {
    /// Strict JSON: no comments, no trailing commas, one value and nothing after it. A number too large for a double is refused
    /// (it has no JSON form to write back), and a lone surrogate in a string becomes U+FFFD, which a Swift string cannot hold.
    public init(parsing text: String) throws {
        var parser = Parser(bytes: Array(text.utf8))
        parser.skipSpace()
        self = try parser.value()
        parser.skipSpace()
        guard parser.index == parser.bytes.count else { throw JSONParseError(offset: parser.index) }
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0
        var depth = 0
        /// Deeper than any real mark; stops a damaged or hostile file from overflowing the stack.
        static let maxDepth = 256

        init(bytes: [UInt8]) { self.bytes = bytes }

        var fail: JSONParseError { JSONParseError(offset: index) }

        mutating func skipSpace() {
            while index < bytes.count, [0x20, 0x09, 0x0a, 0x0d].contains(bytes[index]) { index += 1 }
        }

        mutating func value() throws -> JSONValue {
            guard index < bytes.count else { throw fail }
            switch bytes[index] {
            case UInt8(ascii: "{"): return try object()
            case UInt8(ascii: "["): return try array()
            case UInt8(ascii: "\""): return .string(try string())
            case UInt8(ascii: "t"): try literal("true"); return .bool(true)
            case UInt8(ascii: "f"): try literal("false"); return .bool(false)
            case UInt8(ascii: "n"): try literal("null"); return .null
            default: return .number(try number())
            }
        }

        mutating func literal(_ word: String) throws {
            let expected = Array(word.utf8)
            guard index + expected.count <= bytes.count, Array(bytes[index..<index + expected.count]) == expected else { throw fail }
            index += expected.count
        }

        mutating func object() throws -> JSONValue {
            depth += 1
            defer { depth -= 1 }
            guard depth <= Self.maxDepth else { throw fail }
            index += 1
            var members: [JSONObject.Member] = []
            skipSpace()
            if index < bytes.count, bytes[index] == UInt8(ascii: "}") { index += 1; return .object(JSONObject()) }
            while true {
                skipSpace()
                guard index < bytes.count, bytes[index] == UInt8(ascii: "\"") else { throw fail }
                let key = try string()
                skipSpace()
                guard index < bytes.count, bytes[index] == UInt8(ascii: ":") else { throw fail }
                index += 1
                skipSpace()
                members.append(JSONObject.Member(key, try value()))
                skipSpace()
                guard index < bytes.count else { throw fail }
                if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                guard bytes[index] == UInt8(ascii: "}") else { throw fail }
                index += 1
                return .object(JSONObject(members))
            }
        }

        mutating func array() throws -> JSONValue {
            depth += 1
            defer { depth -= 1 }
            guard depth <= Self.maxDepth else { throw fail }
            index += 1
            var items: [JSONValue] = []
            skipSpace()
            if index < bytes.count, bytes[index] == UInt8(ascii: "]") { index += 1; return .array([]) }
            while true {
                skipSpace()
                items.append(try value())
                skipSpace()
                guard index < bytes.count else { throw fail }
                if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                guard bytes[index] == UInt8(ascii: "]") else { throw fail }
                index += 1
                return .array(items)
            }
        }

        mutating func string() throws -> String {
            index += 1
            var raw: [UInt8] = []
            while true {
                guard index < bytes.count else { throw fail }
                let byte = bytes[index]
                index += 1
                switch byte {
                case UInt8(ascii: "\""):
                    return String(decoding: raw, as: UTF8.self)
                case 0x00..<0x20:
                    index -= 1
                    throw fail
                case UInt8(ascii: "\\"):
                    guard index < bytes.count else { throw fail }
                    let escape = bytes[index]
                    index += 1
                    switch escape {
                    case UInt8(ascii: "\""): raw.append(UInt8(ascii: "\""))
                    case UInt8(ascii: "\\"): raw.append(UInt8(ascii: "\\"))
                    case UInt8(ascii: "/"): raw.append(UInt8(ascii: "/"))
                    case UInt8(ascii: "b"): raw.append(0x08)
                    case UInt8(ascii: "f"): raw.append(0x0c)
                    case UInt8(ascii: "n"): raw.append(0x0a)
                    case UInt8(ascii: "r"): raw.append(0x0d)
                    case UInt8(ascii: "t"): raw.append(0x09)
                    case UInt8(ascii: "u"): raw.append(contentsOf: Array(String(try unicodeEscape()).utf8))
                    default:
                        index -= 1
                        throw fail
                    }
                default:
                    raw.append(byte)
                }
            }
        }

        /// What follows `\u`: four hex digits, and a second `\uXXXX` when the first is a high surrogate.
        mutating func unicodeEscape() throws -> Unicode.Scalar {
            let first = try hex4()
            if (0xd800...0xdbff).contains(first) {
                if index + 1 < bytes.count, bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u") {
                    let saved = index
                    index += 2
                    let second = try hex4()
                    if (0xdc00...0xdfff).contains(second) {
                        return Unicode.Scalar(0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)) ?? "\u{fffd}"
                    }
                    index = saved
                }
                return "\u{fffd}"
            }
            return Unicode.Scalar(first) ?? "\u{fffd}"
        }

        mutating func hex4() throws -> UInt32 {
            guard index + 4 <= bytes.count else { throw fail }
            var value: UInt32 = 0
            for _ in 0..<4 {
                guard let digit = Self.hexDigit(bytes[index]) else { throw fail }
                value = value * 16 + digit
                index += 1
            }
            return value
        }

        static func hexDigit(_ byte: UInt8) -> UInt32? {
            switch byte {
            case 0x30...0x39: UInt32(byte - 0x30)
            case 0x61...0x66: UInt32(byte - 0x61 + 10)
            case 0x41...0x46: UInt32(byte - 0x41 + 10)
            default: nil
            }
        }

        /// `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`
        mutating func number() throws -> Double {
            let start = index
            func digits(_ parser: inout Parser) -> Int {
                var count = 0
                while parser.index < parser.bytes.count, (0x30...0x39).contains(parser.bytes[parser.index]) { parser.index += 1; count += 1 }
                return count
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: "-") { index += 1 }
            guard index < bytes.count, (0x30...0x39).contains(bytes[index]) else { throw fail }
            if bytes[index] == UInt8(ascii: "0") { index += 1 } else { _ = digits(&self) }
            if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
                index += 1
                guard digits(&self) > 0 else { throw fail }
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: "e") || bytes[index] == UInt8(ascii: "E") {
                index += 1
                if index < bytes.count, bytes[index] == UInt8(ascii: "+") || bytes[index] == UInt8(ascii: "-") { index += 1 }
                guard digits(&self) > 0 else { throw fail }
            }
            guard let value = Double(String(decoding: bytes[start..<index], as: UTF8.self)), value.isFinite else {
                index = start
                throw fail
            }
            return value
        }
    }
}

// MARK: Writing

extension JSONValue {
    /// Compact, members in their order, as `JSON.stringify` writes it (a number that is not finite, which JSON cannot hold, is `null`).
    public func serialized() -> String {
        var out = ""
        write(to: &out)
        return out
    }

    private func write(to out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let value): out += value ? "true" : "false"
        case .number(let value): out += value.isFinite ? JavaScriptText.numberString(value) : "null"
        case .string(let value): Self.write(value, to: &out)
        case .array(let items):
            out += "["
            for (index, item) in items.enumerated() {
                if index > 0 { out += "," }
                item.write(to: &out)
            }
            out += "]"
        case .object(let object):
            out += "{"
            for (index, member) in object.members.enumerated() {
                if index > 0 { out += "," }
                Self.write(member.key, to: &out)
                out += ":"
                member.value.write(to: &out)
            }
            out += "}"
        }
    }

    private static func write(_ text: String, to out: inout String) {
        out += "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0c}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case _ where scalar.value < 0x20: out += "\\u" + String(format: "%04x", scalar.value)
            default: out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
    }
}
