import Foundation

// City lookup and sunrise/sunset times from Open-Meteo (https://open-meteo.com), which is free for non-commercial use and needs no key: a port of
// the desktop's `sunTimes.ts`. The network is a closure (`SunFetch`), so `SunConformanceTests` can drive the same canned answers through this and
// through the TypeScript and compare what each asks for and what each makes of the reply.

/// What a fetch brings back: the HTTP status and the body.
public struct SunResponse: Sendable {
    public var status: Int
    public var body: Data

    public init(status: Int, body: Data) { (self.status, self.body) = (status, body) }

    /// `Response.ok`
    var isOK: Bool { (200...299).contains(status) }
}

public typealias SunFetch = @Sendable (URL) async throws -> SunResponse

/// How far through a day's sun it is: the clock times, in the city's own zone, of the sunrise and the sunset that fall on today's date there.
public struct SunDayTimes: Equatable, Sendable {
    public var sunrise: String?
    public var sunset: String?

    public init(sunrise: String? = nil, sunset: String? = nil) { (self.sunrise, self.sunset) = (sunrise, sunset) }

    /// The desktop's words for a city: "sunrise 6:42 AM, sunset 5:21 PM", or that the sun does not rise or set today.
    public var summary: String {
        let parts = [sunrise.map { "sunrise \($0)" }, sunset.map { "sunset \($0)" }].compactMap { $0 }
        return parts.isEmpty ? "the sun doesn't rise or set there today" : parts.joined(separator: ", ")
    }
}

/// `SunSchedule`: the events, how light it should be now, and whether they are real times for the saved city.
public struct SunSchedule: Equatable, Sendable {
    public var events: [SunEvent]
    /// How light the app should be, 0 (dark) to 1 (light).
    public var level: Double
    /// True when `events` are stand-ins rather than real times for the saved city.
    public var estimated: Bool
    /// Worth asking the server again soon: a city is saved but its times couldn't be loaded.
    public var retry: Bool

    public init(events: [SunEvent], level: Double, estimated: Bool, retry: Bool) {
        (self.events, self.level, self.estimated, self.retry) = (events, level, estimated, retry)
    }

    /// `scheduleFrom`: real times when there are any, else the stand-ins (and a retry when a city is saved).
    public static func from(_ events: [SunEvent], location: SavedLocation?, now: Double, calendar: Calendar = .current) -> SunSchedule {
        if events.isEmpty {
            let standIn = Sun.fallbackEvents(now: now, calendar: calendar)
            return SunSchedule(events: standIn, level: Sun.level(standIn, now: now), estimated: true, retry: location != nil)
        }
        return SunSchedule(events: events, level: Sun.level(events, now: now), estimated: false, retry: false)
    }

    /// The real times have run out: nothing is left that could still change the level.
    public func isExhausted(now: Double) -> Bool { !events.contains { $0.at + Sun.rampHalfWidth > now } }
}

public enum SunLookup {
    static let geocodingURL = "https://geocoding-api.open-meteo.com/v1/search"
    static let forecastURL = "https://api.open-meteo.com/v1/forecast"

    /// `URLSearchParams`: application/x-www-form-urlencoded, in the order given. A space is `+`; letters, digits and `*-._` stay.
    static func query(_ pairs: [(String, String)]) -> String {
        func encode(_ text: String) -> String {
            var out = ""
            for byte in text.utf8 {
                switch byte {
                case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                    UInt8(ascii: "*"), UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"):
                    out.unicodeScalars.append(Unicode.Scalar(byte))
                case UInt8(ascii: " "):
                    out += "+"
                default:
                    out += String(format: "%%%02X", byte)
                }
            }
            return out
        }
        return pairs.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&")
    }

    static func geocodeAddress(_ query: String) -> URL {
        URL(string: geocodingURL + "?" + Self.query([("name", query), ("count", "1"), ("language", "en"), ("format", "json")]))!
    }

    static func forecastAddress(_ location: SavedLocation) -> URL {
        URL(
            string: forecastURL + "?"
                + query([
                    ("latitude", JavaScriptText.numberString(location.latitude)), ("longitude", JavaScriptText.numberString(location.longitude)),
                    ("daily", "sunrise,sunset"),
                    // Epoch seconds: unambiguous no matter which timezone the city is in.
                    ("timeformat", "unixtime"), ("timezone", "auto"), ("past_days", "1"), ("forecast_days", "3"),
                ]))!
    }

    struct BadAnswer: Error {}

    /// `getJson`: a failed status, a body that is not JSON, or a fetch that throws are all the same to the caller.
    static func json(_ url: URL, fetch: SunFetch) async throws -> JSONValue {
        let response = try await fetch(url)
        guard response.isOK else { throw BadAnswer() }
        return try JSONValue(parsing: String(decoding: response.body, as: UTF8.self))
    }

    /// `geocodeCity`: "Austin, TX" resolved to its best match, or nil when nothing matches. Throws if the service is unreachable.
    public static func geocode(_ query: String, fetch: SunFetch) async throws -> SavedLocation? {
        let data = try await json(geocodeAddress(query), fetch: fetch)
        // `data.results?.[0]`: a null body is a TypeError, and results may be an object with a "0" member.
        if case .null = data { throw BadAnswer() }
        let first: JSONValue?
        switch data.objectValue?["results"] {
        case .array(let results): first = results.first
        case .object(let results): first = results["0"]
        default: first = nil
        }
        guard let match = first?.objectValue, let name = match["name"]?.stringValue, let latitude = match["latitude"]?.doubleValue,
            let longitude = match["longitude"]?.doubleValue, let timezone = match["timezone"]?.stringValue
        else { return nil }
        let parts = [JSONValue.string(name), match["admin1"], match["country"]].compactMap { $0 }.compactMap(Self.truthyText)
        return SavedLocation(name: parts.joined(separator: ", "), latitude: latitude, longitude: longitude, timezone: timezone)
    }

    /// `.filter(Boolean).join(", ")` over values that should be strings: what such a value becomes, or nil where it is dropped.
    private static func truthyText(_ value: JSONValue) -> String? {
        switch value {
        case .string(let text): text.isEmpty ? nil : text
        case .number(let number): number == 0 ? nil : JavaScriptText.numberString(number)
        case .bool(let flag): flag ? "true" : nil
        case .null: nil
        case .array, .object: nil
        }
    }

    /// `fetchSunEvents`: one forecast turned into ordered events in epoch milliseconds, dropping the days the sun does not rise or set (a null).
    static func events(_ location: SavedLocation, fetch: SunFetch) async throws -> [SunEvent] {
        let data = try await json(forecastAddress(location), fetch: fetch)
        if case .null = data { throw BadAnswer() }
        let daily = data.objectValue?["daily"]?.objectValue
        var events: [SunEvent] = []
        for kind in [SunEvent.Kind.sunrise, .sunset] {
            // `for (const seconds of data.daily?.[kind] ?? [])`: a list is walked, a string is walked a character at a time (none is a number),
            // nothing is nothing, and anything else is not iterable, which is an error.
            switch daily?[kind.rawValue] {
            case .array(let times):
                for case .number(let seconds) in times where seconds.isFinite { events.append(SunEvent(at: seconds * 1000, kind: kind)) }
            case nil, .null, .string:
                break
            default:
                throw BadAnswer()
            }
        }
        // A stable sort by time.
        return events.enumerated().sorted { $0.element.at != $1.element.at ? $0.element.at < $1.element.at : $0.offset < $1.offset }.map(\.element)
    }

    /// `todaysSunTimes`: the sunrise and sunset that fall on today's date in the city's own time zone. Nil for a zone the system does not know (the
    /// desktop throws a `RangeError` there).
    public static func todaysTimes(_ events: [SunEvent], timeZone identifier: String, now: Double) -> SunDayTimes? {
        guard let zone = TimeZone(identifier: identifier) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        func parts(_ milliseconds: Double) -> DateComponents {
            // A `Date` holds whole milliseconds.
            let whole = milliseconds.rounded(.towardZero)
            return calendar.dateComponents([.year, .month, .day, .hour, .minute], from: Date(timeIntervalSince1970: whole / 1000))
        }
        let today = parts(now)
        func sameDay(_ other: DateComponents) -> Bool { (other.year, other.month, other.day) == (today.year, today.month, today.day) }
        func clock(_ other: DateComponents) -> String {
            let hour = other.hour ?? 0, minute = other.minute ?? 0
            return "\(hour % 12 == 0 ? 12 : hour % 12):\(String(format: "%02d", minute)) \(hour < 12 ? "AM" : "PM")"
        }
        var result = SunDayTimes()
        for event in events {
            let when = parts(event.at)
            guard sameDay(when) else { continue }
            switch event.kind {
            case .sunrise: result.sunrise = clock(when)
            case .sunset: result.sunset = clock(when)
            }
        }
        return result
    }
}

/// The cache and the requests around Open-Meteo: an answer is kept for six hours, simultaneous callers share one request, and after a failure the last good
/// answer is served for two minutes before trying again (so being offline doesn't wait out the timeout on every launch).
public actor SunService {
    /// Re-query at most this often; sunrise moves by a minute or two per day.
    static let cacheLifetime: Double = 6 * 60 * 60 * 1000
    /// After a failed lookup, serve the stale answer for this long before trying again.
    static let failureBackoff: Double = 2 * 60 * 1000

    private struct Entry {
        var fetchedAt: Double
        var events: [SunEvent]
    }

    private let fetch: SunFetch
    private var cache: [String: Entry] = [:]
    private var inflight: [String: Task<[SunEvent], Never>] = [:]

    public init(fetch: @escaping SunFetch = SunNetwork.live) { self.fetch = fetch }

    /// `cacheKey`: a city is its latitude and longitude alone.
    private func key(_ location: SavedLocation) -> String {
        "\(JavaScriptText.numberString(location.latitude)),\(JavaScriptText.numberString(location.longitude))"
    }

    public func geocode(_ query: String) async throws -> SavedLocation? { try await SunLookup.geocode(query, fetch: fetch) }

    /// `loadSunEvents`: sunrise and sunset events around now (yesterday through two days ahead). Answers are cached per location. Returns the last
    /// good answer if the service is down, or an empty list if there never was one.
    public func loadEvents(_ location: SavedLocation, now: Double) async -> [SunEvent] {
        let key = key(location)
        let cached = cache[key]
        if let cached, now - cached.fetchedAt < Self.cacheLifetime { return cached.events }
        if let running = inflight[key] { return await running.value }

        let fetch = fetch
        let request = Task {
            let events: [SunEvent]
            do {
                events = try await SunLookup.events(location, fetch: fetch)
                cache[key] = Entry(fetchedAt: now, events: events)
            } catch {
                // Back off, so an offline iPad doesn't wait out the timeout at every launch.
                events = cached?.events ?? []
                cache[key] = Entry(fetchedAt: now - Self.cacheLifetime + Self.failureBackoff, events: events)
            }
            inflight[key] = nil
            return events
        }
        inflight[key] = request
        return await request.value
    }

    /// `resolveSunSchedule`
    public func resolve(_ location: SavedLocation?, now: Double, calendar: Calendar = .current) async -> SunSchedule {
        var events: [SunEvent] = []
        if let location { events = await loadEvents(location, now: now) }
        return SunSchedule.from(events, location: location, now: now, calendar: calendar)
    }

    /// `cachedSunSchedule`: like `resolve` but only from what is already cached, never the network.
    public func cachedSchedule(_ location: SavedLocation?, now: Double, calendar: Calendar = .current) -> SunSchedule {
        let events = location.flatMap { cache[key($0)]?.events } ?? []
        return SunSchedule.from(events, location: location, now: now, calendar: calendar)
    }

    /// What saving a city comes to (the desktop's `saveLocation`, whose words these are).
    public enum CityResult: Equatable, Sendable {
        /// The field was empty: the city is forgotten and the scheme runs on stand-in times.
        case forgotten
        /// The city was found and kept; these are today's times there.
        case saved(name: String, times: SunDayTimes)
        case failed(String)
    }

    /// `saveLocation`: looks the city up (the first match wins, so an ambiguous name needs a qualifier), keeps it in `settings.json`, and says what today's
    /// sunrise and sunset are there so that the person can see the lookup worked. An empty field forgets the city.
    public func saveCity(_ city: String, settings: SettingsStore, now: Double) async -> CityResult {
        let query = JavaScriptText.trim(city)
        if query.isEmpty {
            do { try settings.setLocation(nil) } catch { return .failed("Couldn't save that: \(error.localizedDescription)") }
            return .forgotten
        }
        let found: SavedLocation?
        do { found = try await geocode(query) } catch { return .failed("Couldn't reach the city lookup service. Check your connection and try again.") }
        guard let location = found else { return .failed("Couldn't find a city matching \"\(query)\". Try \"City, State\" or \"City, Country\".") }
        do { try settings.setLocation(location) } catch { return .failed("Couldn't save that: \(error.localizedDescription)") }
        let events = await loadEvents(location, now: now)
        return .saved(name: location.name, times: SunLookup.todaysTimes(events, timeZone: location.timezone, now: now) ?? SunDayTimes())
    }

    /// Puts events found elsewhere (the last launch's) in the cache, so the first paint has the real times; it asks again at once.
    public func seed(_ events: [SunEvent], for location: SavedLocation) {
        guard !events.isEmpty, cache[key(location)] == nil else { return }
        cache[key(location)] = Entry(fetchedAt: -.infinity, events: events)
    }
}

/// The real network: one request, given three seconds in all (the desktop's `AbortSignal.timeout(3000)`), never answered from a local cache.
public enum SunNetwork {
    public static let live: SunFetch = { url in
        try await withThrowingTaskGroup(of: SunResponse.self) { group in
            group.addTask {
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 3)
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                let (data, response) = try await URLSession.shared.data(for: request)
                return SunResponse(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: data)
            }
            group.addTask {
                try await Task.sleep(for: .seconds(3))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }
}
