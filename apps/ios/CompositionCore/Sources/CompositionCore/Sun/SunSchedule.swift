import Foundation

// "Follow the sun": how light the app should be at a moment, from a city's sunrises and sunsets. A port of the desktop's `sunSchedule.ts`,
// checked against it by `SunConformanceTests` over `fixtures/conformance/sun.json`. The level is 0 (fully dark) to 1 (fully light); it
// ramps up across a window centred on each sunrise and back down across one centred on each sunset, and holds steady the rest of the time.

/// A sunrise or a sunset. `at` is epoch milliseconds, as the desktop's `SunEvent.at` is (a JavaScript number).
public struct SunEvent: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case sunrise
        case sunset
    }

    public var at: Double
    public var kind: Kind

    public init(at: Double, kind: Kind) { (self.at, self.kind) = (at, kind) }
}

public enum Sun {
    /// The ramp extends this far before and after each event (90 minutes end to end).
    public static let rampHalfWidth: Double = 45 * 60 * 1000

    /// Text flips between its dark-scheme and light-scheme colour at this level rather than cross-fading: a blend of the two inks is unreadable
    /// against the half-way background. The classic pair's point; the other pairs have their own (`SunPairName.inkFlipLevel`).
    public static let inkFlipLevel = 0.45

    public enum Tone: String, Sendable {
        case light
        case dark
    }

    /// `sunLevel`: events in any order (equal times keep the order they came in, as JavaScript's stable sort does).
    public static func level(_ events: [SunEvent], now: Double) -> Double {
        let sorted = events.enumerated().sorted { $0.element.at != $1.element.at ? $0.element.at < $1.element.at : $0.offset < $1.offset }.map(\.element)

        var previous: SunEvent?
        for event in sorted {
            let progress = (now - event.at + rampHalfWidth) / (2 * rampHalfWidth)
            if progress >= 0 && progress <= 1 {
                let eased = progress * progress * (3 - 2 * progress)
                return event.kind == .sunrise ? eased : 1 - eased
            }
            if progress < 0 { break }
            previous = event
        }

        if let previous { return previous.kind == .sunrise ? 1 : 0 }
        // Before every known event: it's night if the next one is a sunrise.
        guard let next = sorted.first else { return 0 }
        return next.kind == .sunrise ? 0 : 1
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

    /// `fallbackSunEvents`: stand-ins for when the real times are unavailable (no city saved, or the lookup failed and nothing is cached): 06:30 and
    /// 18:30 on the machine's clock, for yesterday, today and tomorrow.
    public static func fallbackEvents(now: Double, calendar: Calendar = .current) -> [SunEvent] {
        let moment = Date(timeIntervalSince1970: now / 1000)
        var events: [SunEvent] = []
        for dayOffset in [-1, 0, 1] {
            let day = calendar.date(byAdding: .day, value: dayOffset, to: moment) ?? moment
            func at(_ hour: Int, _ minute: Int) -> Double {
                var parts = calendar.dateComponents([.year, .month, .day], from: day)
                (parts.hour, parts.minute, parts.second) = (hour, minute, 0)
                return (calendar.date(from: parts) ?? day).timeIntervalSince1970 * 1000
            }
            events.append(SunEvent(at: at(6, 30), kind: .sunrise))
            events.append(SunEvent(at: at(18, 30), kind: .sunset))
        }
        return events
    }
}
