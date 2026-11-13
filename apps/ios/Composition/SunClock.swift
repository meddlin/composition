import CompositionCore
import Foundation
import Observation

/// "Follow the sun": the four hours the person set by hand, and how light the app should be at a moment (`Sun.level`). The scheme asks `level(at:)` every half
/// minute while it is in force (`ThemedRoot`). There is nothing to fetch and nothing to keep fresh: the level is a function of the time of day on the iPad's own
/// clock and these four times, so the app makes no network request for it, or for anything else.
@MainActor @Observable
final class SunClock {
    /// The hours as `settings.json` has them (the defaults when none are saved).
    private(set) var hours = SunHours.default

    init() {
        // Earlier versions kept the last launch's sunrise and sunset here, for the first paint of a scheme that asked a weather service for them.
        UserDefaults.standard.removeObject(forKey: "sun.lastTimes.v1")
    }

    /// How light the app should be at `date`, from 0 (dark) to 1 (light).
    func level(at date: Date) -> Double {
        #if DEBUG || EDITOR_TEST_HOOKS
        // `-sunLevel 0.5` holds the scheme at one point of the fade, for screenshots and the UI tests.
        if UserDefaults.standard.object(forKey: "sunLevel") != nil { return min(1, max(0, UserDefaults.standard.double(forKey: "sunLevel"))) }
        #endif
        return Sun.level(hours, now: date.timeIntervalSince1970 * 1000)
    }

    /// Called when the settings are read: the saved hours.
    func configure(hours newHours: SunHours) { hours = newHours }
}
