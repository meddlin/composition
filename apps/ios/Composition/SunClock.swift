import CompositionCore
import Foundation
import Observation

/// "Follow the sun": the sunrise and sunset times the scheme follows, and how light the app should be at a moment (build plan, M3†). The scheme asks
/// `level(at:)` every half minute while it is in force; this keeps the times fresh. It asks the network only while the scheme is chosen and a city is
/// saved, as the desktop does, and never to say anything about the person: the city is one they typed.
///
/// First paint cannot wait for the network, so the last launch's times are kept (in the app's defaults, not in `settings.json`, whose backup must stay
/// the desktop's) and used until a fresh answer arrives; with nothing saved, or no city, the scheme runs on 6:30 AM and 6:30 PM.
@MainActor @Observable
final class SunClock {
    /// What the scheme follows now: real times, or the stand-ins.
    private(set) var schedule: SunSchedule
    /// The saved city and the pair of colours, as `settings.json` has them.
    private(set) var location: SavedLocation?

    private let service: SunService
    private var following = false
    private var loop: Task<Void, Never>?
    private var lastRefresh = Date.distantPast

    /// How often to ask again when real times are missing or used up (the desktop's `REFRESH_MS`).
    private static let refreshEvery: TimeInterval = 10 * 60
    private static let defaultsKey = "sun.lastTimes.v1"

    init(service: SunService = SunService()) {
        self.service = service
        schedule = SunSchedule.from([], location: nil, now: Date().timeIntervalSince1970 * 1000)
    }

    /// The service the Appearance sheet looks a city up with.
    var lookup: SunService { service }

    // MARK: Level

    /// How light the app should be at `date`, from 0 (dark) to 1 (light).
    func level(at date: Date) -> Double {
        #if DEBUG || EDITOR_TEST_HOOKS
        // `-sunLevel 0.5` holds the scheme at one point of the fade, for screenshots and the UI tests.
        if UserDefaults.standard.object(forKey: "sunLevel") != nil { return min(1, max(0, UserDefaults.standard.double(forKey: "sunLevel"))) }
        #endif
        return Sun.level(schedule.events, now: date.timeIntervalSince1970 * 1000)
    }

    /// Today's sunrise and sunset at the saved city, when the times are real and the zone is known; nil otherwise.
    func todaysTimes(now: Date = Date()) -> SunDayTimes? {
        guard let location, !schedule.estimated else { return nil }
        return SunLookup.todaysTimes(schedule.events, timeZone: location.timezone, now: now.timeIntervalSince1970 * 1000)
    }

    // MARK: Following

    /// Called when the settings are read: the saved city, and whether the scheme is the one in force. Following starts the refresh loop (and a first
    /// refresh at once); not following stops it and leaves the network alone.
    func configure(location newLocation: SavedLocation?, following shouldFollow: Bool) {
        let moved = newLocation != location
        location = newLocation
        if moved {
            lastRefresh = .distantPast
            schedule = firstPaint(for: newLocation)
        }
        following = shouldFollow
        if shouldFollow { startLoop() } else { stopLoop() }
    }

    /// The app came to the front: if the times are used up or were only estimates, ask again without waiting for the next turn of the loop.
    func resume() {
        guard following else { return }
        Task { await refreshIfNeeded(force: false) }
    }

    private func startLoop() {
        guard loop == nil else {
            Task { await refreshIfNeeded(force: true) }
            return
        }
        loop = Task { [weak self] in
            await self?.refreshIfNeeded(force: true)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await self?.refreshIfNeeded(force: false)
            }
        }
    }

    private func stopLoop() {
        loop?.cancel()
        loop = nil
    }

    /// `SunThemeSync`'s rule: ask when told to (the scheme or the city just changed), or when a city is saved and its times could not be loaded or have
    /// run out, at most every ten minutes.
    private func refreshIfNeeded(force: Bool) async {
        let now = Date()
        let due = force || ((schedule.retry || schedule.isExhausted(now: now.timeIntervalSince1970 * 1000)) && now.timeIntervalSince(lastRefresh) >= Self.refreshEvery)
        guard due, following else { return }
        lastRefresh = now
        let place = location
        let next = await service.resolve(place, now: now.timeIntervalSince1970 * 1000)
        // The city may have been changed while the answer was on its way.
        guard place == location else { return }
        schedule = next
        if !next.estimated, let place { remember(next.events, for: place) }
    }

    // MARK: The last launch's times

    private func firstPaint(for place: SavedLocation?) -> SunSchedule {
        let now = Date().timeIntervalSince1970 * 1000
        if let place, let events = remembered(for: place), !events.isEmpty {
            Task { await service.seed(events, for: place) }
            return SunSchedule.from(events, location: place, now: now)
        }
        return SunSchedule.from([], location: place, now: now)
    }

    private static func key(_ place: SavedLocation) -> String { "\(place.latitude),\(place.longitude)" }

    private func remember(_ events: [SunEvent], for place: SavedLocation) {
        let stored: [String: Any] = ["key": Self.key(place), "events": events.map { ["at": $0.at, "kind": $0.kind.rawValue] }]
        UserDefaults.standard.set(stored, forKey: Self.defaultsKey)
    }

    private func remembered(for place: SavedLocation) -> [SunEvent]? {
        guard let stored = UserDefaults.standard.dictionary(forKey: Self.defaultsKey), stored["key"] as? String == Self.key(place),
            let list = stored["events"] as? [[String: Any]]
        else { return nil }
        return list.compactMap { entry in
            guard let at = entry["at"] as? Double, let kind = (entry["kind"] as? String).flatMap(SunEvent.Kind.init(rawValue:)) else { return nil }
            return SunEvent(at: at, kind: kind)
        }
    }
}
