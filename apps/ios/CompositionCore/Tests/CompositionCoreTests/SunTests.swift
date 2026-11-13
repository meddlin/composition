import Foundation
import Testing

@testable import CompositionCore

// Follow the sun, beyond what the desktop's fixture pins (SunConformanceTests): the scheme the app wears at a level, and what keeping the four hours does to
// the settings file.

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

    // MARK: The hours

    private func at(_ clock: String) -> Int64 { Int64(SunHours.parseClock(clock)!) * Sun.millisecondsPerMinute }

    @Test("with the default hours it is what the scheme did before they were set by hand: 06:30 and 18:30, a 90-minute fade centred on each")
    func defaultHoursAreTheOldStandIns() {
        func old(_ clock: String, around event: String, rising: Bool) -> Double? {
            let progress = Double(at(clock) - at(event) + 45 * 60_000) / Double(90 * 60_000)
            guard progress >= 0, progress <= 1 else { return nil }
            let eased = progress * progress * (3 - 2 * progress)
            return rising ? eased : 1 - eased
        }
        for clock in ["05:45", "06:00", "06:20", "06:30", "06:55", "07:15"] { #expect(Sun.level(.default, msOfDay: at(clock)) == old(clock, around: "06:30", rising: true), "\(clock)") }
        for clock in ["17:45", "18:10", "18:30", "18:50", "19:15"] { #expect(Sun.level(.default, msOfDay: at(clock)) == old(clock, around: "18:30", rising: false), "\(clock)") }
        #expect(Sun.level(.default, msOfDay: at("12:00")) == 1 && Sun.level(.default, msOfDay: at("03:00")) == 0 && Sun.level(.default, msOfDay: at("23:00")) == 0)
    }

    @Test("a day that begins in the evening, and a fade that crosses midnight, are fine")
    func aDayFromAnyStart() {
        let night = SunHours(lightenFrom: 19 * 60, lightFrom: 20 * 60, darkenFrom: 5 * 60, darkFrom: 6 * 60)
        #expect(night.goesRoundTheClock)
        #expect(Sun.level(night, msOfDay: at("12:00")) == 0 && Sun.level(night, msOfDay: at("23:00")) == 1 && Sun.level(night, msOfDay: at("00:00")) == 1)
        #expect(abs(Sun.level(night, msOfDay: at("19:30")) - 0.5) < 1e-12 && abs(Sun.level(night, msOfDay: at("05:30")) - 0.5) < 1e-12)
        let across = SunHours(lightenFrom: 9 * 60, lightFrom: 10 * 60, darkenFrom: 23 * 60 + 30, darkFrom: 30)
        #expect(Sun.level(across, msOfDay: at("23:00")) == 1 && abs(Sun.level(across, msOfDay: at("00:00")) - 0.5) < 1e-12 && Sun.level(across, msOfDay: at("00:45")) == 0)
    }

    @Test("hours that do not go once round the clock in order are refused, and read as the defaults when they come off disk")
    func refusedHours() {
        let backwards = SunHours(lightenFrom: 8 * 60, lightFrom: 7 * 60, darkenFrom: 18 * 60, darkFrom: 19 * 60)
        #expect(!backwards.goesRoundTheClock && backwards.problem == SunHours.orderError)
        #expect(Sun.level(backwards, msOfDay: at("06:30")) == Sun.level(.default, msOfDay: at("06:30")))
        let twice = SunHours(lightenFrom: 6 * 60, lightFrom: 18 * 60, darkenFrom: 7 * 60, darkFrom: 19 * 60)
        #expect(!twice.goesRoundTheClock, "two times round the clock")
        let same = SunHours(lightenFrom: 6 * 60, lightFrom: 6 * 60, darkenFrom: 18 * 60, darkFrom: 20 * 60)
        #expect(!same.goesRoundTheClock, "two hours the same")
        #expect(SunHours(lightenFrom: 0, lightFrom: 1, darkenFrom: 2, darkFrom: 3).goesRoundTheClock && SunHours(lightenFrom: 1437, lightFrom: 1438, darkenFrom: 1439, darkFrom: 0).goesRoundTheClock)
    }

    @Test("the milliseconds since midnight follow the wall clock across a clock change")
    func wallClockAcrossAClockChange() throws {
        let chicago = try #require(TimeZone(identifier: "America/Chicago"))
        // 2026-03-08, 08:00 UTC: 02:00 CST becomes 03:00 CDT.
        let springForward = Date.utcMilliseconds(2026, 2, 8, 8, 0)
        #expect(Sun.msOfLocalDay(now: springForward - 1, timeZone: chicago) == 2 * 3_600_000 - 1)
        #expect(Sun.msOfLocalDay(now: springForward, timeZone: chicago) == 3 * 3_600_000)
        #expect(Sun.msOfLocalDay(now: Date.utcMilliseconds(2026, 10, 9, 0, 0), timeZone: try #require(TimeZone(identifier: "UTC"))) == 0)
    }

    // MARK: Keeping them

    @Test("saving hours keeps them, and every other key in the file")
    func savingHours() throws {
        try withScratch { scratch in
            let (store, location) = try settings(scratch, file: #"{"theme":"auto","sunPair":"mint-forest","panels":{"version":2}}"#)
            #expect(store.sunHours() == .default, "nothing saved yet reads as the defaults")
            let evening = SunHours(lightenFrom: 19 * 60, lightFrom: 20 * 60, darkenFrom: 5 * 60, darkFrom: 6 * 60)

            try store.setSunHours(evening)

            #expect(store.sunHours() == evening)
            #expect(store.appearance() == Appearance(scheme: .sun, sunPair: .mintForest), "the scheme and the pair are as they were")
            let written = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: location.settingsURL)) as? [String: Any])
            #expect(written["panels"] != nil)
            #expect(written["sunHours"] as? NSDictionary == ["lightenFrom": "19:00", "lightFrom": "20:00", "darkenFrom": "05:00", "darkFrom": "06:00"] as NSDictionary)
        }
    }

    @Test("hours that are not in order are refused with the reason, and the saved ones stay")
    func refusingHours() throws {
        try withScratch { scratch in
            let (store, location) = try settings(scratch, file: #"{"sunHours":{"lightenFrom":"06:00","lightFrom":"07:00","darkenFrom":"18:30","darkFrom":"20:00"}}"#)
            let before = try Data(contentsOf: location.settingsURL)

            #expect(throws: SettingsError.unusableSunHours(SunHours.orderError)) {
                try store.setSunHours(SunHours(lightenFrom: 8 * 60, lightFrom: 7 * 60, darkenFrom: 18 * 60, darkFrom: 19 * 60))
            }

            #expect(store.sunHours() == SunHours(lightenFrom: 6 * 60, lightFrom: 7 * 60, darkenFrom: 18 * 60 + 30, darkFrom: 20 * 60))
            #expect(try Data(contentsOf: location.settingsURL) == before, "nothing was written")
        }
    }

    @Test("a city an older version saved is not read, and is gone the next time settings are written")
    func theOldCityGoes() throws {
        try withScratch { scratch in
            let (store, location) = try settings(
                scratch,
                file: #"{"theme":"auto","sunPair":"cream-amber","location":{"name":"Austin","latitude":30.27,"longitude":-97.74,"timezone":"America/Chicago"},"panels":{"version":2}}"#)
            #expect(store.sunHours() == .default && store.appearance() == Appearance(scheme: .sun, sunPair: .creamAmber), "the city changes nothing")
            let onDisk = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: location.settingsURL)) as? [String: Any])
            #expect(onDisk["location"] != nil, "reading leaves the file alone")

            try store.setSunPair(.mintForest)  // any write

            let written = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: location.settingsURL)) as? [String: Any])
            #expect(written["location"] == nil, "the city is gone")
            #expect(written["panels"] != nil && written["theme"] as? String == "auto" && written["sunPair"] as? String == "mint-forest", "everything else is as it was")
        }
    }
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
