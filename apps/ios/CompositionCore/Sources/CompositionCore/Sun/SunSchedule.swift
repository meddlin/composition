import Foundation

// "Follow the sun": how light the app should be at a moment, from the four hours a person set by hand (`SunHours`). A port of the desktop's
// `sunSchedule.ts`, checked against it by `SunConformanceTests` over `fixtures/conformance/sun.json`. The level is 0 (fully dark) to 1 (fully light) and
// is a function of the time of day on the wall clock alone, with no events and no calendar. Measured forward from "starts getting lighter", it eases
// from 0 to 1 over the span to "fully light from", holds 1 until "starts getting darker", eases back to 0 over the span to "fully dark from", and holds 0
// round to the start. A fade may cross midnight.
//
// Everything is whole milliseconds (the time of day, the spans), so this divides the same two integers the TypeScript does and gets the same level.

public enum Sun {
    public static let millisecondsPerMinute: Int64 = 60 * 1000
    public static let millisecondsPerDay: Int64 = 24 * 60 * millisecondsPerMinute

    /// Text flips between its dark-scheme and light-scheme colour at this level rather than cross-fading: a blend of the two inks is unreadable
    /// against the half-way background. The classic pair's point; the other pairs have their own (`SunPairName.inkFlipLevel`).
    public static let inkFlipLevel = 0.45

    public enum Tone: String, Sendable {
        case light
        case dark
    }

    /// `msOfLocalDay`: the milliseconds since midnight on the wall clock of `timeZone` (the device's own by default) at `now` (epoch milliseconds). A day
    /// with a clock change is as long as the clock says: the time of day just follows the wall.
    public static func msOfLocalDay(now: Double, timeZone: TimeZone = .current) -> Int64 {
        // A `Date` holds whole milliseconds here, as a JavaScript one does.
        let whole = Int64(now.rounded(.towardZero))
        let offset = Int64(timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: Double(whole) / 1000)))
        let local = whole + offset * 1000
        return ((local % millisecondsPerDay) + millisecondsPerDay) % millisecondsPerDay
    }

    /// `levelAtTimeOfDay`: the level at a time of day, in milliseconds since midnight (0 up to a day). Hours that do not go round the clock in order describe
    /// no day: they read as the defaults, as a settings file's do.
    public static func level(_ hours: SunHours, msOfDay: Int64) -> Double {
        guard hours.goesRoundTheClock else { return level(.default, msOfDay: msOfDay) }
        let perMinute = millisecondsPerMinute, perDay = millisecondsPerDay
        let minutesPerDay = Int64(SunHours.minutesPerDay)
        // Measure everything forward from "starts getting lighter", which is 0.
        func since(_ minute: Int) -> Int64 { ((Int64(minute - hours.lightenFrom) % minutesPerDay + minutesPerDay) % minutesPerDay) * perMinute }
        let rise = since(hours.lightFrom), fall = since(hours.darkenFrom), dark = since(hours.darkFrom)
        let at = ((msOfDay - Int64(hours.lightenFrom) * perMinute) % perDay + perDay) % perDay

        func smoothstep(_ progress: Double) -> Double { progress * progress * (3 - 2 * progress) }
        if at < rise { return smoothstep(Double(at) / Double(rise)) }
        if at < fall { return 1 }
        if at < dark { return 1 - smoothstep(Double(at - fall) / Double(dark - fall)) }
        return 0
    }

    /// `sunLevel`: how light the app should be at `now` (epoch milliseconds), 0 (dark) to 1 (light), on the device's clock.
    public static func level(_ hours: SunHours, now: Double, timeZone: TimeZone = .current) -> Double {
        level(hours, msOfDay: msOfLocalDay(now: now, timeZone: timeZone))
    }

    /// `toneForLevel`: which of the pair's two palettes the text takes.
    public static func tone(forLevel level: Double, flipLevel: Double = inkFlipLevel) -> Tone {
        level >= flipLevel ? .light : .dark
    }

    /// The `--auto-light` the desktop writes on its page: the level as a percentage with one decimal, `(level * 100).toFixed(1)`.
    public static func autoLight(_ level: Double) -> String { "\(toFixed1(level * 100))%" }

    /// `autoLight` as the share (0 to 1) the surfaces blend by: the page blends by the rounded percentage it writes, not by the level.
    public static func autoLightShare(_ level: Double) -> Double { (Double(toFixed1(level * 100)) ?? level * 100) / 100 }

    /// `Number.prototype.toFixed(1)` for a number from 0 to 100: the nearest tenth of the exact value, a tie going up (`printf` would
    /// round a tie to even, which differs for 12.25 and the like).
    static func toFixed1(_ value: Double) -> String {
        // 25 decimals are more than a double between 0 and 100 can need to be told apart from a tie.
        let exact = String(format: "%.25f", max(0, value))
        guard let dot = exact.firstIndex(of: ".") else { return exact }
        let whole = String(exact[..<dot])
        let decimals = Array(exact[exact.index(after: dot)...])
        var tenths = Int(String(whole) + String(decimals[0])) ?? 0
        if let second = decimals.dropFirst().first, second >= "5" { tenths += 1 }
        return "\(tenths / 10).\(tenths % 10)"
    }
}
