import Foundation

// What the desktop's YAML library (js-yaml 4, the default schema) makes of an unquoted word, and the JavaScript text behaviours
// the desktop's frontmatter code leans on (build plan, Step 3; docs/ipad-build-plan.md). Both the reader and the writer use it:
// the reader to turn `true` into a boolean and `2026-11-06` into a date, the writer to know which strings it must quote so that
// they read back as strings.

/// A parsed YAML value, as js-yaml hands it to the desktop's `frontmatter.ts`.
enum YAMLValue {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    /// A JavaScript `Date`, in milliseconds since 1970. js-yaml makes one of every unquoted date and timestamp.
    case timestamp(Double)
    case sequence([YAMLValue])
    case mapping(YAMLMapping)
}

/// A YAML mapping in the order it was written, with js-yaml's rule that keys are compared as strings.
struct YAMLMapping {
    private(set) var pairs: [(key: String, value: YAMLValue)] = []
    private var positions: [String: Int] = [:]

    func has(_ key: String) -> Bool { positions[key] != nil }

    subscript(key: String) -> YAMLValue? { positions[key].map { pairs[$0].value } }

    mutating func set(_ key: String, _ value: YAMLValue) {
        if let position = positions[key] {
            pairs[position].value = value
        } else {
            positions[key] = pairs.count
            pairs.append((key, value))
        }
    }
}

/// The YAML 1.1 / js-yaml scalar types that an unquoted word can resolve to, tried in js-yaml's order: null, boolean, integer,
/// float, timestamp, merge key. Anything else is a string.
enum YAMLScalars {
    static let mergeTag = "tag:yaml.org,2002:merge"

    /// The type an unquoted `text` resolves to and its value; nil when it is a plain string.
    static func resolve(_ text: String) -> (tag: String, value: YAMLValue)? {
        if isNull(text) { return ("tag:yaml.org,2002:null", .null) }
        if let value = boolean(text) { return ("tag:yaml.org,2002:bool", .bool(value)) }
        if let value = integer(text) { return ("tag:yaml.org,2002:int", .number(value)) }
        if let value = float(text) { return ("tag:yaml.org,2002:float", .number(value)) }
        if let value = timestamp(text) { return ("tag:yaml.org,2002:timestamp", .timestamp(value)) }
        if text == "<<" { return (mergeTag, .string(text)) }
        return nil
    }

    /// Whether a string would be read back as something other than itself if it were written unquoted.
    static func readsAsAnotherType(_ text: String) -> Bool { resolve(text) != nil }

    static func isNull(_ text: String) -> Bool { text == "~" || text == "null" || text == "Null" || text == "NULL" }

    static func boolean(_ text: String) -> Bool? {
        switch text {
        case "true", "True", "TRUE": true
        case "false", "False", "FALSE": false
        default: nil
        }
    }

    /// `int.js`: decimal digits, or `0b`, `0o`, `0x` digits, with an optional sign; the value must be finite.
    static func integer(_ text: String) -> Double? {
        let units = Array(text.utf8)
        let count = units.count
        if count == 0 { return nil }
        var index = 0
        func at(_ i: Int) -> UInt8 { i < count ? units[i] : 0 }
        if at(0) == 0x2D || at(0) == 0x2B { index = 1 }
        let negative = at(0) == 0x2D
        var ch = at(index)
        func finish(_ magnitude: Double) -> Double? {
            let value = negative ? -magnitude : magnitude
            return value.isFinite ? value : nil
        }
        if ch == 0x30 {
            if index + 1 == count { return 0 }
            index += 1
            ch = at(index)
            let radix: Double? = ch == 0x62 ? 2 : (ch == 0x78 ? 16 : (ch == 0x6F ? 8 : nil))
            if let radix {
                index += 1
                var magnitude = 0.0
                var hasDigits = false
                while index < count {
                    guard let digit = digitValue(units[index]), Double(digit) < radix else { return nil }
                    magnitude = magnitude * radix + Double(digit)
                    hasDigits = true
                    index += 1
                }
                return hasDigits ? finish(magnitude) : nil
            }
        }
        var magnitude = 0.0
        var hasDigits = false
        // The digits before `index` (a sign, or the leading zero) add nothing to the value.
        while index < count {
            guard units[index] >= 0x30 && units[index] <= 0x39 else { return nil }
            magnitude = magnitude * 10 + Double(units[index] - 0x30)
            hasDigits = true
            index += 1
        }
        return hasDigits ? finish(magnitude) : nil
    }

    private static func digitValue(_ unit: UInt8) -> Int? {
        switch unit {
        case 0x30...0x39: Int(unit - 0x30)
        case 0x41...0x46: Int(unit - 0x41 + 10)
        case 0x61...0x66: Int(unit - 0x61 + 10)
        default: nil
        }
    }

    /// `float.js`: `2.5`, `2.5e4`, `5.`, `.5`, `1e3`, and the `.inf`, `.nan` family, with an optional sign on all but `.nan`.
    static func float(_ text: String) -> Double? {
        let units = Array(text.utf8)
        let count = units.count
        func at(_ i: Int) -> UInt8 { i < count ? units[i] : 0 }
        func isDigit(_ i: Int) -> Bool { at(i) >= 0x30 && at(i) <= 0x39 }
        var index = 0

        // .inf, .nan
        var specialStart = 0
        if at(0) == 0x2D || at(0) == 0x2B { specialStart = 1 }
        let rest = String(decoding: units[min(specialStart, count)...], as: UTF8.self)
        if rest == ".inf" || rest == ".Inf" || rest == ".INF" { return at(0) == 0x2D ? -.infinity : .infinity }
        if specialStart == 0, rest == ".nan" || rest == ".NaN" || rest == ".NAN" { return .nan }

        // [-+]?[0-9]+(\.[0-9]*)?([eE][-+]?[0-9]+)?   or   \.[0-9]+([eE][-+]?[0-9]+)?
        if at(index) == 0x2D || at(index) == 0x2B { index += 1 }
        if isDigit(index) {
            while isDigit(index) { index += 1 }
            if at(index) == 0x2E {
                index += 1
                while isDigit(index) { index += 1 }
            }
        } else if specialStart == 0, at(index) == 0x2E, isDigit(index + 1) {
            index += 1
            while isDigit(index) { index += 1 }
        } else {
            return nil
        }
        if at(index) == 0x65 || at(index) == 0x45 {
            index += 1
            if at(index) == 0x2D || at(index) == 0x2B { index += 1 }
            guard isDigit(index) else { return nil }
            while isDigit(index) { index += 1 }
        }
        guard index == count, let value = Double(text.hasSuffix(".") ? text + "0" : text), value.isFinite else { return nil }
        return value
    }

    /// `timestamp.js`: `YYYY-MM-DD`, or a date and time with an optional fraction and zone, as milliseconds since 1970.
    /// Out-of-range parts roll over, as `Date.UTC` does (`2026-02-30` is the 2nd of March).
    static func timestamp(_ text: String) -> Double? {
        let units = Array(text.utf8)
        let count = units.count
        var index = 0
        func at(_ i: Int) -> UInt8 { i < count ? units[i] : 0 }
        func isDigit(_ i: Int) -> Bool { at(i) >= 0x30 && at(i) <= 0x39 }
        func number(minDigits: Int, maxDigits: Int) -> Int? {
            var value = 0, length = 0
            while length < maxDigits, isDigit(index) {
                value = value * 10 + Int(units[index] - 0x30)
                index += 1
                length += 1
            }
            return length >= minDigits ? value : nil
        }

        guard let year = number(minDigits: 4, maxDigits: 4), at(index) == 0x2D else { return nil }
        index += 1
        // The date-only form needs two digits each; the timestamp form takes one or two.
        let monthStart = index
        guard let month = number(minDigits: 1, maxDigits: 2), at(index) == 0x2D else { return nil }
        index += 1
        let dayStart = index
        guard let day = number(minDigits: 1, maxDigits: 2) else { return nil }
        if index == count {
            guard index - monthStart == 5, dayStart - monthStart == 3 else { return nil }
            return utc(year: year, month: month - 1, day: day, hour: 0, minute: 0, second: 0, millisecond: 0)
        }

        if at(index) == 0x54 || at(index) == 0x74 {
            index += 1
        } else if at(index) == 0x20 || at(index) == 0x09 {
            while at(index) == 0x20 || at(index) == 0x09 { index += 1 }
        } else {
            return nil
        }
        guard let hour = number(minDigits: 1, maxDigits: 2), at(index) == 0x3A else { return nil }
        index += 1
        guard let minute = number(minDigits: 2, maxDigits: 2), at(index) == 0x3A else { return nil }
        index += 1
        guard let second = number(minDigits: 2, maxDigits: 2) else { return nil }

        var millisecond = 0
        if at(index) == 0x2E {
            index += 1
            var fraction = ""
            while isDigit(index) {
                fraction.append(Character(Unicode.Scalar(units[index])))
                index += 1
            }
            if !fraction.isEmpty { millisecond = Int(String((fraction + "00").prefix(3))) ?? 0 }
        }

        var offsetMilliseconds = 0.0
        let beforeZone = index
        while at(index) == 0x20 || at(index) == 0x09 { index += 1 }
        if at(index) == 0x5A {
            index += 1
        } else if at(index) == 0x2D || at(index) == 0x2B {
            let negative = at(index) == 0x2D
            index += 1
            guard let zoneHour = number(minDigits: 1, maxDigits: 2) else { return nil }
            var zoneMinute = 0
            if at(index) == 0x3A {
                index += 1
                guard let value = number(minDigits: 2, maxDigits: 2) else { return nil }
                zoneMinute = value
            }
            offsetMilliseconds = Double((zoneHour * 60 + zoneMinute) * 60_000) * (negative ? -1 : 1)
        } else {
            index = beforeZone
        }
        guard index == count else { return nil }
        guard let utc = utc(year: year, month: month - 1, day: day, hour: hour, minute: minute, second: second, millisecond: millisecond) else { return nil }
        return utc - offsetMilliseconds
    }

    /// `Date.UTC`: the years 0 to 99 mean 1900 to 1999, and every part may exceed its range.
    private static func utc(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int, millisecond: Int) -> Double? {
        let fullYear = (0...99).contains(year) ? 1900 + year : year
        let totalMonths = fullYear * 12 + month
        let normalisedYear = Int((Double(totalMonths) / 12).rounded(.down))
        let normalisedMonth = totalMonths - normalisedYear * 12 + 1
        let days = JavaScriptText.daysFromCivil(year: normalisedYear, month: normalisedMonth, day: 1) + (day - 1)
        let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second
        return Double(seconds) * 1_000 + Double(millisecond)
    }
}

/// The few JavaScript behaviours the desktop's frontmatter code depends on.
enum JavaScriptText {
    /// `String.prototype.trim`: the JavaScript white space and line terminators (not Foundation's set: it has the byte-order
    /// mark and lacks nothing else).
    static func isWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    static func trim(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        var start = 0, end = scalars.count
        while start < end, isWhitespace(scalars[start]) { start += 1 }
        while end > start, isWhitespace(scalars[end - 1]) { end -= 1 }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars[start..<end])
        return String(view)
    }

    /// `Number.prototype.toString()` for the numbers YAML can hold.
    static func numberString(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value == 0 { return "0" }
        if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
        if value < 0 { return "-" + numberString(-value) }

        // Swift prints the shortest digits that read back as the same number, like JavaScript; take them and lay them out
        // by ECMAScript's rules.
        let printed = "\(value)"
        var mantissa = printed
        var exponent = 0
        if let e = printed.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = String(printed[..<e])
            exponent = Int(printed[printed.index(after: e)...]) ?? 0
        }
        var digits = ""
        var pointPosition = mantissa.count
        if let dot = mantissa.firstIndex(of: ".") {
            pointPosition = mantissa.distance(from: mantissa.startIndex, to: dot)
            digits = mantissa.replacingOccurrences(of: ".", with: "")
        } else {
            digits = mantissa
        }
        // value = 0.digits × 10^n
        var n = pointPosition + exponent
        while digits.hasPrefix("0") && digits.count > 1 {
            digits.removeFirst()
            n -= 1
        }
        while digits.hasSuffix("0") && digits.count > 1 { digits.removeLast() }
        let k = digits.count

        if k <= n && n <= 21 { return digits + String(repeating: "0", count: n - k) }
        if 0 < n && n <= 21 {
            let split = digits.index(digits.startIndex, offsetBy: n)
            return String(digits[..<split]) + "." + String(digits[split...])
        }
        if -6 < n && n <= 0 { return "0." + String(repeating: "0", count: -n) + digits }
        let e = n - 1
        let sign = e < 0 ? "-" : "+"
        if k == 1 { return digits + "e" + sign + String(abs(e)) }
        return String(digits.first!) + "." + digits.dropFirst() + "e" + sign + String(abs(e))
    }

    /// `Date.prototype.toISOString()`.
    static func isoString(milliseconds: Double) -> String {
        let total = Int(milliseconds)
        let dayLength = 86_400_000
        var days = total / dayLength
        var inDay = total % dayLength
        if inDay < 0 {
            inDay += dayLength
            days -= 1
        }
        let (year, month, day) = civilFromDays(days)
        func pad(_ number: Int, _ width: Int) -> String {
            let digits = String(number)
            return String(repeating: "0", count: max(0, width - digits.count)) + digits
        }
        let yearText = (0...9999).contains(year) ? pad(year, 4) : (year < 0 ? "-" : "+") + pad(abs(year), 6)
        let time = "\(pad(inDay / 3_600_000, 2)):\(pad(inDay / 60_000 % 60, 2)):\(pad(inDay / 1_000 % 60, 2)).\(pad(inDay % 1_000, 3))"
        return "\(yearText)-\(pad(month, 2))-\(pad(day, 2))T\(time)Z"
    }

    /// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's algorithm); `month` is 1 to 12.
    static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yearOfEra = y - era * 400
        let monthPart = (month + 9) % 12
        let dayOfYear = (153 * monthPart + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    static func civilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let dayOfEra = z - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        let y = yearOfEra + era * 400
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let monthPart = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * monthPart + 2) / 5 + 1
        let month = monthPart < 10 ? monthPart + 3 : monthPart - 9
        return (month <= 2 ? y + 1 : y, month, day)
    }

    /// `String(value)` for what YAML can hold: arrays join their items with commas (a null item is empty), mappings are
    /// `[object Object]`. A date prints as ISO text here; JavaScript prints it in the machine's zone, which no note should depend on.
    /// A list built from aliases of aliases can name more items than fit in memory (the same lists are shared, not copied), so
    /// this stops after 100,000 of them and leaves the rest out.
    static func string(_ value: YAMLValue) -> String {
        var budget = 100_000
        return string(value, &budget)
    }

    private static func string(_ value: YAMLValue, _ budget: inout Int) -> String {
        budget -= 1
        if budget < 0 { return "" }
        switch value {
        case .null: return "null"
        case .bool(let flag): return flag ? "true" : "false"
        case .number(let number): return numberString(number)
        case .string(let text): return text
        case .timestamp(let milliseconds): return isoString(milliseconds: milliseconds)
        case .sequence(let items):
            var parts: [String] = []
            for item in items {
                if budget < 0 { break }
                if case .null = item { parts.append("") } else { parts.append(string(item, &budget)) }
            }
            return parts.joined(separator: ",")
        case .mapping: return "[object Object]"
        }
    }
}
