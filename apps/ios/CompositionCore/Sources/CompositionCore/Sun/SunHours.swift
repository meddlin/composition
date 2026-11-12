import Foundation

/// The four hours a person sets by hand for "Follow the sun" (Appearance ▸ Follow the sun): when the scheme starts getting lighter, when it is fully
/// light, when it starts getting darker and when it is fully dark. A port of the desktop's `sunHours.ts`, checked against it by `SunConformanceTests`
/// over `fixtures/conformance/sun.json`.
///
/// They are times on the device's own wall clock (no time zone, no city), kept in `settings.json` as `HH:MM` text on a 24-hour clock under `sunHours`.
/// The four go once round the clock in order, from any starting point, with at least a minute between neighbours.
public struct SunHours: Equatable, Sendable {
    /// Minutes after midnight (0 to 1439).
    public var lightenFrom: Int
    public var lightFrom: Int
    public var darkenFrom: Int
    public var darkFrom: Int

    public init(lightenFrom: Int, lightFrom: Int, darkenFrom: Int, darkFrom: Int) {
        (self.lightenFrom, self.lightFrom, self.darkenFrom, self.darkFrom) = (lightenFrom, lightFrom, darkenFrom, darkFrom)
    }

    /// What the scheme did before the hours were the person's, with no city saved: 06:30 and 18:30 with a 90-minute fade centred on each.
    public static let `default` = SunHours(lightenFrom: 5 * 60 + 45, lightFrom: 7 * 60 + 15, darkenFrom: 17 * 60 + 45, darkFrom: 19 * 60 + 15)

    public static let minutesPerDay = 24 * 60

    /// The keys of the settings object, in the order the hours come.
    static let keys = ["lightenFrom", "lightFrom", "darkenFrom", "darkFrom"]

    public var minutes: [Int] { [lightenFrom, lightFrom, darkenFrom, darkFrom] }

    /// What Settings calls each hour, in the order they come.
    public static let labels = ["Starts getting lighter", "Fully light from", "Starts getting darker", "Fully dark from"]

    public static let formatError = "Each time must be hours and minutes on a 24-hour clock, like 07:15."
    public static let orderError =
        "The four times must follow each other once round the clock (starts getting lighter, fully light, starts getting darker, fully dark), each at least a minute after the one before."

    /// `parseClock`: `"07:15"` as minutes after midnight (435), or nil for anything that is not `HH:MM` on a 24-hour clock (no spaces, no seconds, no other digits).
    public static func parseClock(_ value: Any?) -> Int? {
        guard let text = value as? String else { return nil }
        let bytes = Array(text.utf8)
        guard bytes.count == 5, bytes[2] == UInt8(ascii: ":") else { return nil }
        func digit(_ index: Int) -> Int? { (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(bytes[index]) ? Int(bytes[index]) - 48 : nil }
        guard let tens = digit(0), let ones = digit(1), let minuteTens = digit(3), let minuteOnes = digit(4) else { return nil }
        let hour = tens * 10 + ones, minute = minuteTens * 10 + minuteOnes
        return hour <= 23 && minute <= 59 ? hour * 60 + minute : nil
    }

    /// `formatClock`: minutes after midnight as zero-padded `HH:MM`.
    public static func formatClock(_ minutes: Int) -> String {
        let whole = ((minutes % minutesPerDay) + minutesPerDay) % minutesPerDay
        return String(format: "%02d:%02d", whole / 60, whole % 60)
    }

    /// `goRoundTheClock`: each of the four gaps, measured forward from one hour to the next (the last back to the first), is at least a minute, and together
    /// they make exactly one day, never two.
    public static func goRoundTheClock(_ minutes: [Int]) -> Bool {
        var total = 0
        for index in minutes.indices {
            let gap = ((minutes[(index + 1) % minutes.count] - minutes[index]) % minutesPerDay + minutesPerDay) % minutesPerDay
            if gap < 1 { return false }
            total += gap
        }
        return total == minutesPerDay
    }

    /// Whether these four go round the clock in order (and so describe a day).
    public var goesRoundTheClock: Bool { Self.goRoundTheClock(minutes) }

    /// The reason these four are refused, or nil when they are fine.
    public var problem: String? { goesRoundTheClock ? nil : Self.orderError }

    /// `validateSunHours`: the hours in `value` (a settings file's `sunHours`, as `JSONSerialization` hands it over), or the reason it is refused.
    public static func validate(_ value: Any?) -> Result<SunHours, Refusal> {
        guard let object = value as? [String: Any] else { return .failure(Refusal(message: formatError)) }
        let parsed = keys.map { parseClock(object[$0]) }
        guard parsed.allSatisfy({ $0 != nil }) else { return .failure(Refusal(message: formatError)) }
        let found = SunHours(lightenFrom: parsed[0]!, lightFrom: parsed[1]!, darkenFrom: parsed[2]!, darkFrom: parsed[3]!)
        return found.goesRoundTheClock ? .success(found) : .failure(Refusal(message: orderError))
    }

    public struct Refusal: Error, Equatable, Sendable { public var message: String }

    /// `parseSunHours`: a good set, or the defaults for anything else (all or nothing: a half-valid set does not describe a day).
    public init(settingsValue value: Any?) {
        if case .success(let found) = Self.validate(value) { self = found } else { self = .default }
    }

    /// The object a settings file keeps: the four hours as `HH:MM` text.
    public var settingsObject: [String: Any] {
        ["lightenFrom": Self.formatClock(lightenFrom), "lightFrom": Self.formatClock(lightFrom), "darkenFrom": Self.formatClock(darkenFrom), "darkFrom": Self.formatClock(darkFrom)]
    }
}
