import Foundation
import Testing

@testable import CompositionCore

// "Follow the sun" against the desktop's own code. fixtures/conformance/sun.json holds what `sunSchedule.ts`, `sunPairs.ts`, `sunTimes.ts` and `globals.css` make of
// a long list of inputs (apps/web/src/lib/composition/sunConformance.test.ts writes it, and `conformance.sh` checks the desktop still makes the same
// file). The file is committed, so a plain `swift test` replays it. See fixtures/conformance/README.md.

private let corpus: JSONValue? = corpusDirectory
    .flatMap { try? String(contentsOf: $0.appendingPathComponent("sun.json"), encoding: .utf8) }
    .flatMap { try? JSONValue(parsing: $0) }

private func section(_ name: String) throws -> [JSONValue] {
    let corpus = try #require(corpus, "fixtures/conformance/sun.json is missing or is not JSON")
    return try #require(corpus.objectValue?[name]?.arrayValue, "section \(name)")
}

private func object(_ value: JSONValue?) -> JSONObject { value?.objectValue ?? JSONObject() }

private func events(_ value: JSONValue?) -> [SunEvent] {
    (value?.arrayValue ?? []).map { SunEvent(at: object($0)["at"]?.doubleValue ?? .nan, kind: SunEvent.Kind(rawValue: object($0)["kind"]?.stringValue ?? "") ?? .sunrise) }
}

private func schedule(_ value: JSONValue?) -> SunSchedule {
    let o = object(value)
    return SunSchedule(
        events: events(o["events"]), level: o["level"]?.doubleValue ?? .nan, estimated: { if case .bool(let b)? = o["estimated"] { b } else { false } }(),
        retry: { if case .bool(let b)? = o["retry"] { b } else { false } }())
}

private func location(_ value: JSONValue?) -> SavedLocation? {
    guard let o = value?.objectValue, let name = o["name"]?.stringValue, let latitude = o["latitude"]?.doubleValue, let longitude = o["longitude"]?.doubleValue,
        let timezone = o["timezone"]?.stringValue
    else { return nil }
    return SavedLocation(name: name, latitude: latitude, longitude: longitude, timezone: timezone)
}

/// A calendar whose zone is the one the desktop's machine-local `Date` methods ran in.
private func calendar(_ zone: String) throws -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try #require(TimeZone(identifier: zone), "the zone \(zone)")
    return calendar
}

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

/// The requests a fake network was given.
private final class Requests: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [String] = []
    func add(_ url: String) { lock.lock(); urls.append(url); lock.unlock() }
    func take() -> [String] { lock.lock(); defer { lock.unlock() }; let out = urls; urls = []; return out }
}

/// A network that answers as the fixture's spec says.
private func network(_ spec: JSONValue?, _ requests: Requests) -> SunFetch {
    let o = object(spec)
    let kind = o["kind"]?.stringValue ?? "throw"
    let status = o["status"]?.integerValue ?? 500
    let body = Data((o["body"] ?? .null).serialized().utf8)
    return { url in
        requests.add(url.absoluteString)
        await Task.yield()
        switch kind {
        case "status": return SunResponse(status: status, body: Data())
        case "badjson": return SunResponse(status: 200, body: Data("not json".utf8))
        case "ok": return SunResponse(status: 200, body: body)
        default: throw URLError(.notConnectedToInternet)
        }
    }
}

@Suite("Follow the sun against the desktop", .enabled(if: corpus != nil, "fixtures/conformance/sun.json is not there"))
struct SunConformanceTests {
    @Test("the ramp, the flip point and the five pairs are the desktop's")
    func constantsAndPairs() throws {
        let constants = object(try #require(corpus?.objectValue?["constants"]))
        #expect(Sun.rampHalfWidth == constants["rampHalfWidthMs"]?.doubleValue)
        #expect(Sun.inkFlipLevel == constants["inkFlipLevel"]?.doubleValue)
        #expect(SunPairName.default.rawValue == constants["defaultSunPair"]?.stringValue)

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

    @Test("how light it should be, over event lists in every order and moments on both sides of every ramp")
    func levels() throws {
        var different: [String] = []
        var checked = 0
        for (index, list) in try section("levels").map(object).enumerated() {
            let list_events = events(list["events"])
            for entry in list["nows"]?.arrayValue ?? [] {
                guard let pair = entry.arrayValue, let now = pair[0].doubleValue, let level = pair[1].doubleValue else { continue }
                checked += 1
                let ours = Sun.level(list_events, now: now)
                if ours != level { different.append("list \(index) at \(now): ours \(ours), desktop \(level)") }
            }
        }
        #expect(checked > 600)
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

    @Test("the stand-in 06:30 and 18:30 are on the machine's clock, across the days its clocks change")
    func fallback() throws {
        let rows = try section("fallback").map(object)
        #expect(rows.count >= 150)
        var different: [String] = []
        for row in rows {
            let zone = try #require(row["timeZone"]?.stringValue), now = try #require(row["now"]?.doubleValue)
            let ours = Sun.fallbackEvents(now: now, calendar: try calendar(zone))
            let theirs = events(row["events"])
            if ours != theirs { different.append("\(zone) at \(now): ours \(ours.map(\.at)), desktop \(theirs.map(\.at))") }
        }
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(4))")
    }

    @Test("today's sunrise and sunset are the ones that fall on today's date in the city's own zone, on its own clock")
    func todays() throws {
        let rows = try section("todays").map(object)
        #expect(rows.count > 100)
        var different: [String] = []
        for row in rows {
            let zone = try #require(row["timeZone"]?.stringValue), now = try #require(row["now"]?.doubleValue)
            let ours = SunLookup.todaysTimes(events(row["events"]), timeZone: zone, now: now)
            if row["throws"] == .bool(true) {
                // The desktop throws a RangeError for a zone it does not know; here it is nothing to show.
                #expect(ours == nil, "\(zone) is not a zone")
                continue
            }
            let times = object(row["times"])
            let theirs = SunDayTimes(sunrise: times["sunrise"]?.stringValue, sunset: times["sunset"]?.stringValue)
            if ours != theirs { different.append("\(zone) at \(now): ours \(String(describing: ours)), desktop \(theirs)") }
        }
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(4))")
    }

    @Test("the city lookup asks for what the desktop asks for and makes the same of the answer")
    func geocode() async throws {
        let rows = try section("geocode").map(object)
        #expect(rows.count >= 30)
        var different: [String] = []
        for row in rows {
            let query = try #require(row["query"]?.stringValue)
            let requests = Requests()
            var ours: JSONValue
            do {
                if let found = try await SunLookup.geocode(query, fetch: network(row["fetch"], requests)) {
                    ours = .object(JSONObject(["name": .string(found.name), "latitude": .number(found.latitude), "longitude": .number(found.longitude), "timezone": .string(found.timezone)]))
                } else {
                    ours = .null
                }
            } catch {
                ours = .object(JSONObject(["throws": .bool(true)]))
            }
            let asked = requests.take()
            let theirs = row["result"] ?? .null
            if ours != theirs { different.append("\(query.debugDescription): ours \(ours.serialized()), desktop \(theirs.serialized())") }
            let wanted = (row["requests"]?.arrayValue ?? []).compactMap(\.stringValue)
            if asked != wanted { different.append("\(query.debugDescription) asked \(asked), desktop \(wanted)") }
        }
        #expect(different.isEmpty, "\(different.count) differ: \(different.prefix(4))")
    }

    @Test("the sun-time cache: six hours, two minutes of backoff, one request for simultaneous callers, and what a city's forecast is turned into")
    func loads() async throws {
        let scenarios = try section("loads").map(object)
        #expect(scenarios.count >= 10)
        let utc = try calendar("UTC")
        var different: [String] = []
        for scenario in scenarios {
            let name = scenario["name"]?.stringValue ?? "?"
            let requests = Requests()
            // A service per scenario, whose network is the fixture's step's: the service is told the network once, so a box holds the current one.
            let box = NetworkBox()
            let fresh = SunService(fetch: { url in try await box.current()(url) })
            for (index, step) in (scenario["steps"]?.arrayValue ?? []).map(object).enumerated() {
                box.set(network(step["fetch"], requests))
                let now = try #require(step["now"]?.doubleValue)
                let place = location(step["location"])
                let op = step["op"]?.stringValue ?? ""
                let label = "\(name) / step \(index) (\(op))"
                switch op {
                case "load":
                    let ours = await fresh.loadEvents(try #require(place), now: now)
                    if ours != events(step["events"]) { different.append("\(label): events \(ours.map(\.at)), desktop \(events(step["events"]).map(\.at))") }
                case "loadMany":
                    let count = step["count"]?.integerValue ?? 1
                    let place = try #require(place)
                    let all = await withTaskGroup(of: [SunEvent].self) { group in
                        for _ in 0..<count { group.addTask { await fresh.loadEvents(place, now: now) } }
                        return await group.reduce(into: [[SunEvent]]()) { $0.append($1) }
                    }
                    let theirs = (step["many"]?.arrayValue ?? []).map { events($0) }
                    if all != theirs { different.append("\(label): \(all.map { $0.count }) events, desktop \(theirs.map { $0.count })") }
                case "resolve":
                    let ours = await fresh.resolve(place, now: now, calendar: utc)
                    let theirs = schedule(step["schedule"])
                    if ours != theirs { different.append("\(label): level \(ours.level) estimated \(ours.estimated) retry \(ours.retry), desktop \(theirs.level) \(theirs.estimated) \(theirs.retry)") }
                case "cached":
                    let ours = await fresh.cachedSchedule(place, now: now, calendar: utc)
                    let theirs = schedule(step["schedule"])
                    if ours != theirs { different.append("\(label): level \(ours.level) estimated \(ours.estimated) retry \(ours.retry), desktop \(theirs.level) \(theirs.estimated) \(theirs.retry)") }
                default:
                    Issue.record("unknown op \(op)")
                }
                let asked = requests.take()
                let wanted = (step["requests"]?.arrayValue ?? []).compactMap(\.stringValue)
                if asked != wanted { different.append("\(label): asked \(asked.count) times \(asked), desktop \(wanted.count) \(wanted)") }
            }
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

/// Holds the network a scenario's current step uses, so one service lives through all of a scenario's steps.
private final class NetworkBox: @unchecked Sendable {
    private let lock = NSLock()
    private var fetch: SunFetch = { _ in throw URLError(.notConnectedToInternet) }
    func set(_ next: @escaping SunFetch) { lock.lock(); fetch = next; lock.unlock() }
    func current() -> SunFetch { lock.lock(); defer { lock.unlock() }; return fetch }
}
