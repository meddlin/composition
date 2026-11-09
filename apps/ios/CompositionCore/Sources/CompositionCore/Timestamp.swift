import Foundation

/// The timestamps the desktop writes: `new Date().toISOString()`, e.g. `2026-11-05T20:53:20.123Z` (UTC, always
/// milliseconds, always 24 characters). They are compared as strings in SQL (`deleted_at < ?`), so the format must match
/// exactly, and the arithmetic on them (the Trash Can's 60 days) is done on whole milliseconds with integer math, not
/// through `Date`, whose floating point seconds can lose a millisecond on the way back to a string.
enum Timestamp {
    static let millisecondsPerDay: Int64 = 86_400_000

    /// `date` as the desktop would write it, to the nearest millisecond.
    static func now(_ date: Date = Date()) -> String {
        string(milliseconds: milliseconds(of: date))
    }

    static func milliseconds(of date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    static func date(milliseconds: Int64) -> Date {
        Date(timeIntervalSince1970: Double(milliseconds) / 1000)
    }

    /// Milliseconds since 1970 for a string in exactly the `toISOString` form, or nil for anything else.
    static func milliseconds(from string: String) -> Int64? {
        let b = Array(string.utf8)
        guard b.count == 24, b[4] == 0x2d, b[7] == 0x2d, b[10] == 0x54, b[13] == 0x3a, b[16] == 0x3a, b[19] == 0x2e, b[23] == 0x5a
        else { return nil }
        func number(_ range: Range<Int>) -> Int64? {
            var value: Int64 = 0
            for index in range {
                guard (0x30...0x39).contains(b[index]) else { return nil }
                value = value * 10 + Int64(b[index] - 0x30)
            }
            return value
        }
        guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10), let hour = number(11..<13),
            let minute = number(14..<16), let second = number(17..<19), let millisecond = number(20..<23),
            (1...12).contains(month), hour < 24, minute < 60, second < 60
        else { return nil }
        guard day >= 1, day <= daysInMonth(year: year, month: month) else { return nil }
        let days = daysFromCivil(year: year, month: month, day: day)
        return (days * 86_400 + hour * 3600 + minute * 60 + second) * 1000 + millisecond
    }

    /// The `toISOString` text for a moment.
    static func string(milliseconds: Int64) -> String {
        let days = floorDivide(milliseconds, millisecondsPerDay)
        let inDay = milliseconds - days * millisecondsPerDay
        let (year, month, day) = civilFromDays(days)
        let hour = inDay / 3_600_000, minute = inDay / 60_000 % 60, second = inDay / 1000 % 60, millisecond = inDay % 1000
        func pad(_ value: Int64, _ width: Int) -> String {
            let digits = String(value)
            return String(repeating: "0", count: max(0, width - digits.count)) + digits
        }
        return "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))T\(pad(hour, 2)):\(pad(minute, 2)):\(pad(second, 2)).\(pad(millisecond, 3))Z"
    }

    // MARK: Calendar arithmetic (Howard Hinnant's days-from-civil algorithms, proleptic Gregorian)

    private static func floorDivide(_ a: Int64, _ b: Int64) -> Int64 {
        let quotient = a / b
        return (a % b != 0 && (a < 0) != (b < 0)) ? quotient - 1 : quotient
    }

    private static func isLeap(_ year: Int64) -> Bool { year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) }

    static func daysInMonth(year: Int64, month: Int64) -> Int64 {
        month == 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].contains(month) ? 30 : 31
    }

    static func daysFromCivil(year: Int64, month: Int64, day: Int64) -> Int64 {
        let y = month <= 2 ? year - 1 : year
        let era = floorDivide(y, 400)
        let yearOfEra = y - era * 400
        let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    private static func civilFromDays(_ days: Int64) -> (year: Int64, month: Int64, day: Int64) {
        let z = days + 719_468
        let era = floorDivide(z, 146_097)
        let dayOfEra = z - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let monthIndex = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * monthIndex + 2) / 5 + 1
        let month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9
        return (yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }
}
