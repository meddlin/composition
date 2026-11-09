import Foundation
import Testing

@testable import CompositionCore

// Follow the sun, beyond what the desktop's fixture pins (SunConformanceTests): the scheme the app wears at a level, what saving a city does, and what the
// cache keeps across launches.

@Suite("Follow the sun")
struct SunTests {
    private func settings(_ scratch: Scratch, file: String? = nil) throws -> (SettingsStore, DataLocation) {
        let location = DataLocation(directory: scratch.directory.appendingPathComponent("data", isDirectory: true))
        if let file {
            try FileManager.default.createDirectory(at: location.directory, withIntermediateDirectories: true)
            try file.write(to: location.settingsURL, atomically: true, encoding: .utf8)
        }
        return (SettingsStore(location: location), location)
    }

    private func withAsyncScratch(_ body: (Scratch) async throws -> Void) async throws {
        let scratch = try Scratch()
        defer { scratch.remove() }
        try await body(scratch)
    }

    // MARK: The scheme at a level

    @Test("at the ends it is the pair's own palettes, and only the three surfaces blend between them")
    func ends() {
        for pair in SunPairName.allCases {
            let night = Theme.sun(pair: pair, level: 0), day = Theme.sun(pair: pair, level: 1)
            #expect(night.name == "auto" && day.name == "auto" && night.label == "Follow the sun")
            var expectedNight = pair.night, expectedDay = pair.day
            (expectedNight.name, expectedNight.label, expectedDay.name, expectedDay.label) = ("auto", "Follow the sun", "auto", "Follow the sun")
            #expect(night == expectedNight, "\(pair) at night")
            #expect(day == expectedDay, "\(pair) by day")
            #expect(night.isDark && !day.isDark)
        }
    }

    @Test("half way, the surfaces are the average of the two (a half rounds up), and the ink is one palette's outright")
    func middle() {
        let half = Theme.sun(pair: .classic, level: 0.5)
        // (0xf7 + 0x12) / 2 = 132.5 -> 133; (0xf7 + 0x12) is 265 for red, 0xf7 + 0x12 for green and (0xf4 + 0x12) / 2 = 131 for blue.
        #expect(half.background == ThemeColor(red: 133, green: 133, blue: 131))
        #expect(half.foreground == Theme.named("light")!.foreground, "past the flip point at 0.45 the ink is the day's")
        let before = Theme.sun(pair: .classic, level: 0.44)
        #expect(before.foreground == Theme.named("dark")!.foreground && before.brand == Theme.named("dark")!.brand)
        // The page blends by the percentage the desktop writes, one decimal.
        #expect(abs(Sun.autoLightShare(0.12345) - 0.123) < 1e-12 && Sun.autoLightShare(1) == 1 && Sun.autoLightShare(0) == 0)
        // It blends by that percentage, not by the level: 0.233% is 0.2% on the page, which is a step darker on every channel than the level itself would give.
        #expect(Theme.sun(pair: .classic, level: 0.00233).background == ThemeColor(red: 18, green: 18, blue: 18))
        // The cream-amber pair flips later than the classic one.
        #expect(Theme.sun(pair: .creamAmber, level: 0.47).foreground == SunPairName.creamAmber.night.foreground)
        #expect(Theme.sun(pair: .creamAmber, level: 0.5).foreground == SunPairName.creamAmber.day.foreground)
    }

    @Test("the text reads at 4.5 or better except around the middle of the fade, where the desktop's own palettes cannot give it (never under 3)")
    func legibleAlongTheFade() {
        // Half way along the fade the page is a mid grey, which neither the day's dark ink nor the night's light ink reads on at 4.5: the desktop flips
        // the ink where the two read equally, about 3.2. That is the desktop's design, carried over as it is; this pins how bad it gets and for how long
        // (about 14 minutes in each 90-minute fade: levels 0.33 to 0.66), so that a recoloured pair that makes it worse fails here.
        for pair in SunPairName.allCases {
            for step in 0...1000 {
                let level = Double(step) / 1000
                let theme = Theme.sun(pair: pair, level: level)
                for (name, page) in [("background", theme.background), ("surface", theme.surface), ("panel", theme.panel)] {
                    let ratio = ThemeColor.contrast(theme.foreground, page)
                    #expect(ratio >= 3.0, "\(pair) at \(level): text on \(name) reads at \(ratio)")
                    if level <= 0.32 || level >= 0.67 { #expect(ratio >= 4.5, "\(pair) at \(level): text on \(name) reads at \(ratio)") }
                }
            }
        }
    }

    // MARK: The city

    @Test("saving a city looks it up, keeps it and every other key in the file, and says today's times")
    func savingACity() async throws {
        try await withAsyncScratch { scratch in
            let (store, location) = try settings(scratch, file: #"{"theme":"auto","sunPair":"mint-forest","panels":{"version":2}}"#)
            let now = Date.utcMilliseconds(2026, 10, 9, 18)
            let service = SunService(fetch: { url in
                if url.host == "geocoding-api.open-meteo.com" {
                    let body = #"{"results":[{"name":"Austin","admin1":"Texas","country":"United States","latitude":30.26715,"longitude":-97.74306,"timezone":"America/Chicago"}]}"#
                    return SunResponse(status: 200, body: Data(body.utf8))
                }
                // 6:42 am and 5:21 pm in Austin (UTC-6 in November), and the day before and after.
                func at(_ day: Int, _ hour: Int, _ minute: Int) -> Int { Int(Date.utcMilliseconds(2026, 10, day, hour, minute) / 1000) }
                let body = #"{"daily":{"sunrise":[\#(at(8, 12, 42)),\#(at(9, 12, 42)),\#(at(10, 12, 43))],"sunset":[\#(at(8, 23, 21)),\#(at(9, 23, 20)),\#(at(10, 23, 20))]}}"#
                return SunResponse(status: 200, body: Data(body.utf8))
            })
            let result = await service.saveCity("  Austin, TX ", settings: store, now: now)
            #expect(result == .saved(name: "Austin, Texas, United States", times: SunDayTimes(sunrise: "6:42 AM", sunset: "5:20 PM")))
            #expect(store.location()?.timezone == "America/Chicago" && store.location()?.name == "Austin, Texas, United States")
            #expect(store.appearance() == Appearance(scheme: .sun, sunPair: .mintForest), "the scheme and the pair are as they were")
            let written = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: location.settingsURL)) as? [String: Any])
            #expect(written["panels"] != nil)
        }
    }

    @Test("an empty field forgets the city; a city that is not found, or a lookup that cannot be reached, says so and keeps the old one")
    func forgettingAndFailing() async throws {
        try await withAsyncScratch { scratch in
            let (store, _) = try settings(scratch, file: #"{"location":{"name":"Oslo","latitude":59.9,"longitude":10.7,"timezone":"Europe/Oslo"}}"#)
            let nothing = SunService(fetch: { _ in SunResponse(status: 200, body: Data(#"{}"#.utf8)) })
            let unreachable = SunService(fetch: { _ in throw URLError(.notConnectedToInternet) })
            let now = Date.utcMilliseconds(2026, 10, 9, 18)

            #expect(await nothing.saveCity("Nowhereville", settings: store, now: now) == .failed(#"Couldn't find a city matching "Nowhereville". Try "City, State" or "City, Country"."#))
            #expect(await unreachable.saveCity("Oslo", settings: store, now: now) == .failed("Couldn't reach the city lookup service. Check your connection and try again."))
            #expect(store.location()?.name == "Oslo", "a failed lookup keeps the city that was saved")

            #expect(await nothing.saveCity("   ", settings: store, now: now) == .forgotten)
            #expect(store.location() == nil)
        }
    }

    @Test("times seeded from the last launch are what the first paint uses, and are kept when the network fails")
    func seeding() async {
        let place = SavedLocation(name: "Austin", latitude: 30.26715, longitude: -97.74306, timezone: "America/Chicago")
        let now = Date.utcMilliseconds(2026, 10, 9, 18)
        let events = [SunEvent(at: now - 6 * 3_600_000, kind: .sunrise), SunEvent(at: now + 5 * 3_600_000, kind: .sunset)]
        let asked = Counter()
        let service = SunService(fetch: { _ in
            asked.add()
            throw URLError(.notConnectedToInternet)
        })
        await service.seed(events, for: place)

        let first = await service.cachedSchedule(place, now: now)
        #expect(!first.estimated && first.events == events && first.level == 1)
        // Seeded times are not fresh: a lookup still tries (once), and keeps them when it fails.
        #expect(await service.loadEvents(place, now: now) == events)
        #expect(asked.count == 1)
        // Nothing seeded for another city.
        let other = await service.cachedSchedule(SavedLocation(name: "Oslo", latitude: 59.9, longitude: 10.7, timezone: "Europe/Oslo"), now: now)
        #expect(other.estimated && other.retry)
    }

    @Test("times that have run out are noticed, and the words for a day without a sunrise are the desktop's")
    func exhaustedAndSummary() {
        let now = Date.utcMilliseconds(2026, 10, 9, 18)
        let used = SunSchedule(events: [SunEvent(at: now - 1_800_000, kind: .sunset)], level: 0, estimated: false, retry: false)
        #expect(!used.isExhausted(now: now), "the sunset was half an hour ago: its ramp ends in a quarter of one")
        #expect(used.isExhausted(now: now + 15 * 60_000), "once the ramp of the last event is over, nothing is left to change the level")
        #expect(SunDayTimes().summary == "the sun doesn't rise or set there today")
        #expect(SunDayTimes(sunrise: "6:42 AM").summary == "sunrise 6:42 AM")
        #expect(SunDayTimes(sunrise: "6:42 AM", sunset: "5:21 PM").summary == "sunrise 6:42 AM, sunset 5:21 PM")
    }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func add() { lock.lock(); value += 1; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return value }
}

extension Date {
    /// Epoch milliseconds of a UTC moment, as the JavaScript `Date.UTC` gives it.
    static func utcMilliseconds(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Double {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = calendar.date(from: DateComponents(year: year, month: month + 1, day: day, hour: hour, minute: minute))!
        return date.timeIntervalSince1970 * 1000
    }
}
