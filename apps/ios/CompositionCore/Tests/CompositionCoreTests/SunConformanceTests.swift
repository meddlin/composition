import Foundation
import Testing

@testable import CompositionCore

// "Follow the sun" against the desktop's own code. fixtures/conformance/sun.json holds what `sunHours.ts`, `sunSchedule.ts`, `sunPairs.ts` and `globals.css`
// make of a long list of inputs (apps/web/src/lib/composition/sunConformance.test.ts writes it, and `conformance.sh` checks the desktop still makes the same
// file). The file is committed, so a plain `swift test` replays it. See fixtures/conformance/README.md.

private let corpus: JSONValue? = corpusDirectory
    .flatMap { try? String(contentsOf: $0.appendingPathComponent("sun.json"), encoding: .utf8) }
    .flatMap { try? JSONValue(parsing: $0) }

private func section(_ name: String) throws -> [JSONValue] {
    let corpus = try #require(corpus, "fixtures/conformance/sun.json is missing or is not JSON")
    return try #require(corpus.objectValue?[name]?.arrayValue, "section \(name)")
}

private func object(_ value: JSONValue?) -> JSONObject { value?.objectValue ?? JSONObject() }

/// A JSON value as `JSONSerialization` hands it over, which is what the settings parsers are given.
private func foundation(_ value: JSONValue) -> Any {
    switch value {
    case .null: NSNull()
    case .bool(let flag): NSNumber(value: flag)
    case .number(let number): NSNumber(value: number)
    case .string(let text): text
    case .array(let items): items.map(foundation)
    case .object(let members): Dictionary(members.members.map { ($0.key, foundation($0.value)) }, uniquingKeysWith: { $1 })
    }
}

private func zone(_ name: String) throws -> TimeZone { try #require(TimeZone(identifier: name), "the zone \(name)") }

private func hours(_ value: JSONValue?) -> SunHours { SunHours(settingsValue: value.map(foundation)) }

@Suite("Follow the sun against the desktop", .enabled(if: corpus != nil, "fixtures/conformance/sun.json is not there"))
struct SunConformanceTests {
    @Test("the flip point, the defaults and the five pairs are the desktop's")
    func constantsAndPairs() throws {
        let constants = object(try #require(corpus?.objectValue?["constants"]))
        #expect(Sun.inkFlipLevel == constants["inkFlipLevel"]?.doubleValue)
        #expect(Sun.millisecondsPerDay == constants["msPerDay"]?.integerValue.map(Int64.init))
        #expect(SunPairName.default.rawValue == constants["defaultSunPair"]?.stringValue)
        #expect(SunHours.default == hours(constants["defaultHours"]), "the default hours")
        #expect(SunHours.default.settingsObject as NSDictionary == foundation(constants["defaultHours"] ?? .null) as? NSDictionary)

        let pairs = try section("pairs").map(object)
        #expect(pairs.count == 5 && SunPairName.allCases.count == 5)
        for (pair, expected) in zip(SunPairName.allCases, pairs) {
            #expect(pair.rawValue == expected["name"]?.stringValue)
            #expect(pair.label == expected["label"]?.stringValue, "\(pair) label")
            #expect(pair.dayName == expected["day"]?.stringValue && pair.nightName == expected["night"]?.stringValue, "\(pair) palettes")
            #expect(pair.inkFlipLevel == expected["inkFlipLevel"]?.doubleValue, "\(pair) flip point")
        }
    }

    @Test("what names a pair, and the flip point of anything else, are the desktop's")
    func pairProbes() throws {
        let probes = try section("pairProbes").map(object)
        #expect(probes.count >= 15)
        for probe in probes {
            let value = foundation(probe["value"] ?? .null)
            #expect(SunPairName.isName(value) == (probe["isName"] == .bool(true)), "isSunPairName(\(value))")
            #expect(SunPairName(settingsValue: value).inkFlipLevel == probe["inkFlipLevel"]?.doubleValue, "inkFlipLevelOf(\(value))")
        }
    }

    @Test("HH:MM is read, and written, as the desktop reads and writes it")
    func clocks() throws {
        let rows = try section("clocks").map(object)
        #expect(rows.count >= 25)
        for row in rows {
            let value = foundation(row["value"] ?? .null)
            let minutes = SunHours.parseClock(value)
            #expect(minutes == row["minutes"]?.integerValue, "parseClock(\(value))")
            #expect(minutes.map(SunHours.formatClock) == row["written"]?.stringValue, "formatClock(parseClock(\(value)))")
        }
    }

    @Test("a set of hours is accepted, refused with the desktop's words, or read as the defaults, as the desktop does")
    func hourSets() throws {
        let rows = try section("hourSets").map(object)
        #expect(rows.count >= 25)
        for row in rows {
            let value = foundation(row["value"] ?? .null)
            let label = "\(value)"
            switch SunHours.validate(value) {
            case .success(let found):
                #expect(row["valid"] == .bool(true), "\(label) is valid here, not on the desktop")
                #expect(found.settingsObject as NSDictionary == foundation(row["hours"] ?? .null) as? NSDictionary, "\(label) hours")
                #expect(row["error"] == .null)
            case .failure(let refusal):
                #expect(row["valid"] == .bool(false), "\(label) is refused here, not on the desktop")
                #expect(refusal.message == row["error"]?.stringValue, "\(label) words")
            }
            #expect(SunHours(settingsValue: value).settingsObject as NSDictionary == foundation(row["parsed"] ?? .null) as? NSDictionary, "\(label) as read from a settings file")
        }
    }

    @Test("how light it should be, over many sets of hours, at every edge of a fade and between")
    func levels() throws {
        var different: [String] = []
        var checked = 0
        for (index, set) in try section("levels").map(object).enumerated() {
            let set_hours = hours(set["hours"])
            for entry in set["nows"]?.arrayValue ?? [] {
                guard let pair = entry.arrayValue, let ms = pair[0].integerValue, let level = pair[1].doubleValue else { continue }
                checked += 1
                let ours = Sun.level(set_hours, msOfDay: Int64(ms))
                if ours != level { different.append("set \(index) at \(ms) ms: ours \(ours), desktop \(level)") }
            }
        }
        #expect(checked > 2000)
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(8))")
    }

    @Test("the tone each level takes, for the classic flip point and the others")
    func tones() throws {
        let rows = try section("tones").map(object)
        #expect(rows.count > 300)
        for row in rows {
            let level = try #require(row["level"]?.doubleValue)
            let flip = row["flip"]?.doubleValue
            let tone = Sun.tone(forLevel: level, flipLevel: flip ?? Sun.inkFlipLevel)
            #expect(tone.rawValue == row["tone"]?.stringValue, "level \(level) flip \(String(describing: flip))")
        }
    }

    @Test("the percentage the page writes is toFixed(1) of the level, ties going up")
    func autoLight() throws {
        let rows = try section("autoLight").map(object)
        #expect(rows.count > 800)
        var different: [String] = []
        for row in rows {
            let level = try #require(row["level"]?.doubleValue)
            let expected = try #require(row["autoLight"]?.stringValue)
            if Sun.autoLight(level) != expected { different.append("\(level): ours \(Sun.autoLight(level)), desktop \(expected)") }
        }
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(8))")
        // The ties `printf` rounds the other way.
        #expect(Sun.autoLight(0.1225) == "12.3%" && Sun.autoLight(0.5) == "50.0%" && Sun.autoLight(1) == "100.0%" && Sun.autoLight(0) == "0.0%")
    }

    @Test("the time of day on the wall clock is the desktop's in fourteen zones, across the days and the instants their clocks change")
    func wallClock() throws {
        let rows = try section("wallClock").map(object)
        #expect(rows.count >= 200)
        var different: [String] = []
        for row in rows {
            let name = try #require(row["timeZone"]?.stringValue), now = try #require(row["now"]?.doubleValue)
            let ours = Sun.msOfLocalDay(now: now, timeZone: try zone(name))
            let theirs = row["ms"]?.integerValue
            if ours != theirs.map(Int64.init) { different.append("\(name) at \(now): ours \(ours), desktop \(String(describing: theirs))") }
        }
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(4))")
    }

    @Test("the five pairs' palettes are globals.css's, token for token, and their surfaces blend between the day's and the night's")
    func palettes() throws {
        let palettes = object(try #require(corpus?.objectValue?["palettes"]))
        let blends = object(try #require(corpus?.objectValue?["blends"]))
        for pair in SunPairName.allCases {
            for (tone, theme) in [("light", pair.day), ("dark", pair.night)] {
                let expected = object(object(palettes[pair.rawValue])[tone])
                let label = "\(pair.rawValue) \(tone)"
                #expect((expected["colorScheme"]?.stringValue == "dark") == theme.isDark, "\(label) color-scheme")
                let tokens: [(String, ThemeColor)] = [
                    ("background", theme.background), ("foreground", theme.foreground), ("surface", theme.surface), ("panel", theme.panel), ("brand", theme.brand),
                    ("brand-dim", theme.brandDim), ("highlight", theme.highlight), ("warning", theme.warning), ("error", theme.error), ("success", theme.success), ("link", theme.link),
                ]
                for (name, color) in tokens { #expect(color.hex == expected[name]?.stringValue, "\(label) --\(name)") }
                #expect(theme.markAlpha == expected["markAlpha"]?.doubleValue, "\(label) --mark-alpha")
                let syntax = object(expected["syntax"])
                let ours: [(String, ThemeColor)] = [
                    ("comment", theme.syntax.comment), ("keyword", theme.syntax.keyword), ("string", theme.syntax.string), ("number", theme.syntax.number),
                    ("function", theme.syntax.function), ("type", theme.syntax.type), ("attr", theme.syntax.attr),
                ]
                #expect(Set(syntax.members.map(\.key)) == Set(ours.map(\.0)))
                for (name, color) in ours { #expect(color.hex == syntax[name]?.stringValue, "\(label) --syntax-\(name)") }
            }
            let blend = object(blends[pair.rawValue])
            let ends: [(String, ThemeColor, ThemeColor)] = [
                ("background", pair.day.background, pair.night.background), ("surface", pair.day.surface, pair.night.surface), ("panel", pair.day.panel, pair.night.panel),
            ]
            for (name, day, night) in ends {
                #expect(day.hex == object(blend[name])["day"]?.stringValue && night.hex == object(blend[name])["night"]?.stringValue, "\(pair.rawValue) \(name) blend")
            }
        }
        // The five palettes the stylesheet declares for the sun alone, and only those, are the ones a scheme cannot be chosen by name.
        #expect(Theme.sunOnly.map(\.name) == ["amber", "mint", "blush", "sky", "midnight"])
        #expect(Set(Theme.sunOnly.map(\.name)).isDisjoint(with: Theme.all.map(\.name)))
    }
}
