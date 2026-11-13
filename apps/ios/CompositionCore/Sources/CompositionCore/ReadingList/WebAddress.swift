import Foundation

// The part of the WHATWG URL Standard (https://url.spec.whatwg.org/) that the desktop's Reading List leans on through `new URL()`:
// an absolute address, with no base, parsed and written back the way a browser (and Node) does. The Reading List stores the
// written form, and two links are the same link when those strings are equal, so the iPad must write exactly what the desktop
// writes. `fixtures/conformance/reading-list.json` holds what Node answered for a long list of links; `ReadingListConformanceTests`
// replays it.
//
// What is here: the scheme, user name and password (only to say whether there are any), the host (a name, made ASCII through
// Foundation's IDNA where it is not, an IPv4 address in any of its spellings, an IPv6 address), the port, the path with its dot
// segments resolved, and the query, each percent-encoded with the standard's sets. The fragment is dropped, since the Reading List
// drops it. What is not: relative addresses (there is never a base), `file:` (the Reading List refuses it first), and encodings
// other than UTF-8.

/// An absolute address as the URL Standard parses it, without its fragment.
struct WebAddress: Equatable, Sendable {
    /// Lowercase, without the colon: `https`.
    var scheme: String
    var username: String
    var password: String
    /// As it is written back: a lowercase ASCII name, `127.0.0.1`, `[2001:db8::1]`, or for a scheme that is not special the host as given.
    /// Nil when there is no host at all (`mailto:a@b.com`).
    var host: String?
    /// Nil when there is none, or it is the scheme's own (443 for https).
    var port: Int?
    /// Written out: `/a/b`, `/` at the least for a special scheme.
    var path: String
    /// Without the `?`; nil when there is no `?`, empty when there is one with nothing after it.
    var query: String?

    /// The address written back, fragment left out: what `URL.href` is once `hash` is set to "".
    var href: String {
        var out = scheme + ":"
        if let host {
            out += "//"
            out += host
            if let port { out += ":\(port)" }
        }
        out += path
        if let query { out += "?" + query }
        return out
    }

    /// `URL.hostname`: the host without the port; empty when there is none.
    var hostname: String { host ?? "" }

    /// The schemes the standard treats specially, with their own ports. `file` is special too but is never parsed here.
    static let specialSchemes: [String: Int] = ["http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21]

    /// Parses `input` as `new URL(input)` would (no base), or nil where it would throw.
    static func parse(_ input: String) -> WebAddress? {
        var chars = Array(input.unicodeScalars)
        // Leading and trailing C0 controls and spaces go, and every tab and new line anywhere.
        while let first = chars.first, first.value <= 0x20 { chars.removeFirst() }
        while let last = chars.last, last.value <= 0x20 { chars.removeLast() }
        chars.removeAll { $0 == "\t" || $0 == "\n" || $0 == "\r" }

        // The scheme: a letter, then letters, digits, + - and ., then a colon.
        guard let first = chars.first, first.isASCIILetter else { return nil }
        var index = 1
        while index < chars.count, chars[index].isASCIILetter || chars[index].isASCIIDigit || "+-.".unicodeScalars.contains(chars[index]) { index += 1 }
        guard index < chars.count, chars[index] == ":" else { return nil }
        let scheme = String(String.UnicodeScalarView(chars[0..<index])).lowercased()
        var rest = Array(chars[(index + 1)...])
        if let hash = rest.firstIndex(of: "#") { rest = Array(rest[..<hash]) }

        if scheme == "file" { return nil }
        let special = specialSchemes[scheme] != nil
        let isSlash: (Unicode.Scalar) -> Bool = { $0 == "/" || (special && $0 == "\\") }

        var authority: [Unicode.Scalar]
        var remaining: [Unicode.Scalar]
        if special {
            // Any number of slashes (and backslashes) after the colon, even none.
            let start = rest.firstIndex { !isSlash($0) } ?? rest.endIndex
            let body = Array(rest[start...])
            let end = body.firstIndex { isSlash($0) || $0 == "?" } ?? body.endIndex
            authority = Array(body[..<end])
            remaining = Array(body[end...])
        } else if rest.count >= 2, rest[0] == "/", rest[1] == "/" {
            let body = Array(rest[2...])
            let end = body.firstIndex { $0 == "/" || $0 == "?" } ?? body.endIndex
            authority = Array(body[..<end])
            remaining = Array(body[end...])
        } else {
            // No authority: an opaque path (`mailto:a@b.com`), or a path that starts with one slash.
            return opaque(scheme: scheme, rest: rest)
        }

        // A user name and password come before the last @.
        var username = "", password = ""
        if let at = authority.lastIndex(of: "@") {
            let userinfo = Array(authority[..<at])
            authority = Array(authority[(at + 1)...])
            // "https://a@" has a user and no host.
            if authority.isEmpty { return nil }
            if let colon = userinfo.firstIndex(of: ":") {
                username = String(String.UnicodeScalarView(userinfo[..<colon]))
                password = String(String.UnicodeScalarView(userinfo[(colon + 1)...]))
            } else {
                username = String(String.UnicodeScalarView(userinfo))
            }
        }

        // The host ends at the first colon outside brackets; the port follows it.
        var hostChars: [Unicode.Scalar] = []
        var portChars: [Unicode.Scalar]?
        var inBrackets = false
        for (offset, char) in authority.enumerated() {
            if char == "[" { inBrackets = true }
            if char == "]" { inBrackets = false }
            if char == ":", !inBrackets {
                portChars = Array(authority[(offset + 1)...])
                break
            }
            hostChars.append(char)
        }
        if hostChars.isEmpty {
            // A special scheme needs a host; any scheme refuses a port, a user or a password with no host before it.
            if special || portChars != nil || authority.contains(":") { return nil }
            if username != "" || password != "" { return nil }
        }
        guard let host = hostChars.isEmpty ? "" : parseHost(hostChars, special: special) else { return nil }

        var port: Int?
        if let portChars, !portChars.isEmpty {
            guard portChars.allSatisfy(\.isASCIIDigit) else { return nil }
            var value = 0
            for digit in portChars {
                value = value * 10 + Int(digit.value - 0x30)
                if value > 65_535 { return nil }
            }
            port = value == specialSchemes[scheme] ? nil : value
        }

        let question = remaining.firstIndex(of: "?")
        let pathChars = question.map { Array(remaining[..<$0]) } ?? remaining
        let query = question.map { Array(remaining[($0 + 1)...]) }
        let path: String
        if special || !pathChars.isEmpty {
            path = resolvePath(pathChars, special: special)
        } else {
            path = ""
        }
        let querySet = special ? Self.specialQuerySet : Self.querySet
        return WebAddress(
            scheme: scheme, username: username, password: password, host: host, port: port, path: path,
            query: query.map { percentEncode($0, keeping: querySet) })
    }

    /// An address with no authority: `mailto:a@b.com`, `foo:/x`.
    private static func opaque(scheme: String, rest: [Unicode.Scalar]) -> WebAddress {
        let question = rest.firstIndex(of: "?")
        let pathChars = question.map { Array(rest[..<$0]) } ?? rest
        let query = question.map { Array(rest[($0 + 1)...]) }
        let path = pathChars.first == "/" ? resolvePath(pathChars, special: false) : percentEncode(pathChars, keeping: Self.c0ControlSet)
        return WebAddress(scheme: scheme, username: "", password: "", host: nil, port: nil, path: path, query: query.map { percentEncode($0, keeping: Self.querySet) })
    }

    // MARK: The path

    /// The path's segments with `.` and `..` (and their percent-encoded spellings) resolved, each segment percent-encoded.
    private static func resolvePath(_ chars: [Unicode.Scalar], special: Bool) -> String {
        var body = chars[...]
        if let first = body.first, first == "/" || (special && first == "\\") { body = body.dropFirst() }
        var segments: [String] = []
        let pieces = body.split(omittingEmptySubsequences: false) { $0 == "/" || (special && $0 == "\\") }
        for (offset, piece) in pieces.enumerated() {
            let isLast = offset == pieces.count - 1
            let text = String(String.UnicodeScalarView(piece))
            if isDoubleDot(text) {
                if !segments.isEmpty { segments.removeLast() }
                if isLast { segments.append("") }
            } else if isSingleDot(text) {
                if isLast { segments.append("") }
            } else {
                segments.append(percentEncode(Array(piece), keeping: pathSet))
            }
        }
        return segments.map { "/" + $0 }.joined()
    }

    private static func isSingleDot(_ segment: String) -> Bool { segment == "." || segment.lowercased() == "%2e" }

    private static func isDoubleDot(_ segment: String) -> Bool {
        [".." , ".%2e", "%2e.", "%2e%2e"].contains(segment.lowercased())
    }

    // MARK: Percent-encoding

    /// The code points a set leaves alone: printable ASCII but for the listed ones. Everything outside is written as UTF-8 escapes.
    private static func asciiSet(excluding excluded: String) -> Set<UInt32> {
        Set((0x21...0x7e).map(UInt32.init)).subtracting(excluded.unicodeScalars.map(\.value))
    }

    /// The C0 control set keeps printable ASCII and space.
    static let c0ControlSet = asciiSet(excluding: "").union([0x20])
    static let querySet = asciiSet(excluding: "\"#<>")
    static let specialQuerySet = asciiSet(excluding: "\"#<>'")
    static let pathSet = asciiSet(excluding: "\"#<>?`{}^")

    static func percentEncode(_ chars: [Unicode.Scalar], keeping: Set<UInt32>) -> String {
        var out = ""
        for char in chars {
            if keeping.contains(char.value) {
                out.unicodeScalars.append(char)
            } else {
                for byte in String(char).utf8 { out += String(format: "%%%02X", byte) }
            }
        }
        return out
    }

    /// `%XX` sequences turned back into bytes; a `%` not followed by two hex digits stays as it is.
    static func percentDecode(_ text: String) -> [UInt8] {
        let bytes = Array(text.utf8)
        var out: [UInt8] = []
        var index = 0
        while index < bytes.count {
            if bytes[index] == UInt8(ascii: "%"), index + 2 < bytes.count, let high = hexValue(bytes[index + 1]), let low = hexValue(bytes[index + 2]) {
                out.append(high << 4 | low)
                index += 3
            } else {
                out.append(bytes[index])
                index += 1
            }
        }
        return out
    }

    private static func hexValue(_ byte: UInt8) -> UInt8? {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): byte - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): byte - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): byte - UInt8(ascii: "A") + 10
        default: nil
        }
    }

    // MARK: The host

    /// Forbidden in any host (tab and new lines are gone by now).
    private static let forbiddenHost = Set("\u{0}\t\n\r #/:<>?@[\\]^|".unicodeScalars.map(\.value))

    /// Forbidden in a domain: those, the C0 controls, `%` and DEL.
    private static func isForbiddenInDomain(_ char: Unicode.Scalar) -> Bool {
        forbiddenHost.contains(char.value) || char.value <= 0x1f || char == "%" || char.value == 0x7f
    }

    /// The host as it is written back, or nil when the standard refuses it.
    private static func parseHost(_ chars: [Unicode.Scalar], special: Bool) -> String? {
        if chars.first == "[" {
            guard chars.last == "]", chars.count >= 2, let pieces = parseIPv6(Array(chars[1..<(chars.count - 1)])) else { return nil }
            return "[" + serializeIPv6(pieces) + "]"
        }
        if !special {
            guard !chars.contains(where: { $0 != "%" && forbiddenHost.contains($0.value) }) else { return nil }
            return percentEncode(chars, keeping: c0ControlSet)
        }
        let domain = String(decoding: percentDecode(String(String.UnicodeScalarView(chars))), as: UTF8.self)
        guard let ascii = domainToASCII(domain), !ascii.isEmpty else { return nil }
        guard !ascii.unicodeScalars.contains(where: isForbiddenInDomain) else { return nil }
        if endsInANumber(ascii) {
            guard let address = parseIPv4(ascii) else { return nil }
            return [24, 16, 8, 0].map { String(address >> $0 & 0xff) }.joined(separator: ".")
        }
        return ascii
    }

    /// UTS #46 ToASCII as the standard asks for it. A plain ASCII name with no `xn--` label is only lowercased; anything else goes
    /// through Foundation's IDNA (`URLComponents`), which maps, normalises and Punycode-encodes as Node does (checked by the corpus).
    private static func domainToASCII(_ domain: String) -> String? {
        let isASCII = domain.unicodeScalars.allSatisfy(\.isASCII)
        let lowered = isASCII ? domain.lowercased() : domain
        if isASCII, !lowered.split(separator: ".", omittingEmptySubsequences: false).contains(where: { $0.hasPrefix("xn--") }) {
            return lowered
        }
        // Whatever ASCII the name holds is only lowercased by the mapping, so a forbidden character is refused here, before Foundation
        // could read it as the end of the host.
        guard !lowered.unicodeScalars.contains(where: { $0.isASCII && isForbiddenInDomain($0) }) else { return nil }
        guard let encoded = URLComponents(string: "https://" + lowered + "/")?.encodedHost, !encoded.isEmpty else { return nil }
        return encoded
    }

    /// Whether the last label (a trailing dot aside) is a number, which makes the whole host an IPv4 address or nothing.
    private static func endsInANumber(_ host: String) -> Bool {
        var parts = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if parts.last == "" {
            if parts.count == 1 { return false }
            parts.removeLast()
        }
        guard let last = parts.last, !last.isEmpty else { return false }
        if last.unicodeScalars.allSatisfy(\.isASCIIDigit) { return true }
        return ipv4Number(last) != nil
    }

    /// One part of an IPv4 address: decimal, hexadecimal after `0x`, octal after a leading `0`. Capped, as anything that large fails anyway.
    private static func ipv4Number(_ text: String) -> UInt64? {
        guard !text.isEmpty else { return nil }
        var digits = Substring(text)
        var radix: UInt64 = 10
        if digits.hasPrefix("0x") || digits.hasPrefix("0X") {
            radix = 16
            digits = digits.dropFirst(2)
        } else if digits.count >= 2, digits.hasPrefix("0") {
            radix = 8
            digits = digits.dropFirst()
        }
        if digits.isEmpty { return 0 }
        var value: UInt64 = 0
        for char in digits {
            guard let digit = char.hexDigitValue, UInt64(digit) < radix, char.isASCII else { return nil }
            value = min(value * radix + UInt64(digit), 1 << 40)
        }
        return value
    }

    private static func parseIPv4(_ host: String) -> UInt32? {
        var parts = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if parts.last == "", parts.count > 1 { parts.removeLast() }
        guard parts.count <= 4 else { return nil }
        var numbers: [UInt64] = []
        for part in parts {
            guard let number = ipv4Number(part) else { return nil }
            numbers.append(number)
        }
        guard let last = numbers.last, numbers.dropLast().allSatisfy({ $0 <= 255 }) else { return nil }
        guard last < UInt64(1) << (8 * (5 - numbers.count)) else { return nil }
        var address = last
        for (offset, number) in numbers.dropLast().enumerated() { address += number << (8 * (3 - offset)) }
        return UInt32(address)
    }

    /// The standard's IPv6 parser, step for step: eight pieces, one `::`, an IPv4 tail in the last two.
    private static func parseIPv6(_ input: [Unicode.Scalar]) -> [UInt16]? {
        var address = [UInt16](repeating: 0, count: 8)
        var pieceIndex = 0
        var compress: Int?
        var pointer = 0
        func char(_ at: Int) -> Unicode.Scalar? { at < input.count ? input[at] : nil }

        if char(pointer) == ":" {
            guard char(pointer + 1) == ":" else { return nil }
            pointer += 2
            pieceIndex += 1
            compress = pieceIndex
        }
        while let c = char(pointer) {
            guard pieceIndex != 8 else { return nil }
            if c == ":" {
                guard compress == nil else { return nil }
                pointer += 1
                pieceIndex += 1
                compress = pieceIndex
                continue
            }
            var value: UInt32 = 0
            var length = 0
            while length < 4, let c = char(pointer), let digit = Character(c).hexDigitValue, c.isASCII {
                value = value * 16 + UInt32(digit)
                pointer += 1
                length += 1
            }
            if char(pointer) == "." {
                guard length != 0 else { return nil }
                pointer -= length
                guard pieceIndex <= 6 else { return nil }
                var numbersSeen = 0
                while let c = char(pointer) {
                    var piece: UInt32?
                    if numbersSeen > 0 {
                        guard c == ".", numbersSeen < 4 else { return nil }
                        pointer += 1
                    }
                    guard let d = char(pointer), d.isASCIIDigit else { return nil }
                    while let d = char(pointer), d.isASCIIDigit {
                        let number = d.value - 0x30
                        if let current = piece {
                            guard current != 0 else { return nil }
                            piece = current * 10 + number
                        } else {
                            piece = number
                        }
                        guard piece! <= 255 else { return nil }
                        pointer += 1
                    }
                    address[pieceIndex] = address[pieceIndex] &* 0x100 &+ UInt16(piece!)
                    numbersSeen += 1
                    if numbersSeen == 2 || numbersSeen == 4 { pieceIndex += 1 }
                }
                guard numbersSeen == 4 else { return nil }
                break
            } else if char(pointer) == ":" {
                pointer += 1
                guard char(pointer) != nil else { return nil }
            } else if char(pointer) != nil {
                return nil
            }
            address[pieceIndex] = UInt16(value)
            pieceIndex += 1
        }
        if let compress {
            var swaps = pieceIndex - compress
            pieceIndex = 7
            while pieceIndex != 0, swaps > 0 {
                address.swapAt(pieceIndex, compress + swaps - 1)
                pieceIndex -= 1
                swaps -= 1
            }
        } else if pieceIndex != 8 {
            return nil
        }
        return address
    }

    /// Lowercase hex, the first longest run of two or more zero pieces written as `::`.
    private static func serializeIPv6(_ address: [UInt16]) -> String {
        var compress: Int?
        var bestLength = 1
        var index = 0
        while index < 8 {
            if address[index] == 0 {
                var end = index
                while end < 8, address[end] == 0 { end += 1 }
                if end - index > bestLength {
                    bestLength = end - index
                    compress = index
                }
                index = end
            } else {
                index += 1
            }
        }
        var out = ""
        var ignoreZero = false
        for (offset, piece) in address.enumerated() {
            if ignoreZero, piece == 0 { continue }
            ignoreZero = false
            if compress == offset {
                out += offset == 0 ? "::" : ":"
                ignoreZero = true
                continue
            }
            out += String(piece, radix: 16)
            if offset != 7 { out += ":" }
        }
        return out
    }
}

extension Unicode.Scalar {
    var isASCIILetter: Bool { ("a"..."z").contains(self) || ("A"..."Z").contains(self) }
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}
