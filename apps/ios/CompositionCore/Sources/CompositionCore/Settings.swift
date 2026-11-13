import Foundation

// The settings that travel with a backup (build plan, Step 1; docs/ipad-build-plan.md, G5): favorites, the colour scheme and the
// saved city, read from and written to `settings.json` in the data folder, which is the desktop's file of the same name.
//
// The desktop keeps far more in that file (to-dos, plugins, panels, the AI helper's server, column sizes), and a restore
// **replaces** the desktop's settings with the backup's, filling what is missing with defaults. So the iPad never writes a file
// of its own making when it has one from the desktop: it reads the file as JSON, changes the keys it uses, and writes every other
// key back as it came. A file it has to start from nothing holds only what it has set.

public enum FavoriteKind: String, Sendable, Equatable {
    case group
    case note
}

/// A pinned group or note, as the desktop's `favorites.ts` has it: in pin order, no duplicates.
public struct Favorite: Equatable, Hashable, Sendable {
    public var kind: FavoriteKind
    public var id: Int64

    public init(_ kind: FavoriteKind, _ id: Int64) { (self.kind, self.id) = (kind, id) }
}

extension DataLocation {
    /// The settings a backup carries.
    public var settingsURL: URL { directory.appendingPathComponent(BackupNames.settings) }
}

public final class SettingsStore: @unchecked Sendable {
    /// The desktop's schemes, which are the only names its settings file may hold (it falls back to `dark` for anything else).
    public static let themeNames = ["dark", "light", "forest", "wine", "cream", "auto"]
    public static let defaultTheme = "dark"

    private let url: URL
    private let lock = NSLock()

    public init(location: DataLocation) { url = location.settingsURL }

    // MARK: Reading

    public func favorites() -> [Favorite] { locked { Self.parseFavorites($0["favorites"]) } }

    public func isFavorite(_ kind: FavoriteKind, _ id: Int64) -> Bool { favorites().contains(Favorite(kind, id)) }

    public func theme() -> String { locked { Self.parseTheme($0["theme"]) } }

    /// The four hours Follow the sun moves at (`parseSunHours`): all four valid and in order round the clock, or the defaults.
    public func sunHours() -> SunHours { locked { SunHours(settingsValue: $0["sunHours"]) } }

    /// The light and dark colours Follow the sun moves between; the classic pair for anything the file does not name.
    public func sunPair() -> SunPairName { locked { SunPairName(settingsValue: $0["sunPair"]) } }

    /// Whether the Reading List plugin is on: the desktop's `plugins["reading-list"]`, off unless the file says `true`.
    public func readingListEnabled() -> Bool { locked { PluginSettings.readingListEnabled(settingsValue: $0["plugins"]) } }

    // MARK: Writing

    public func setFavorites(_ favorites: [Favorite]) throws {
        try edit { $0["favorites"] = favorites.map { ["type": $0.kind.rawValue, "id": NSNumber(value: $0.id)] as [String: Any] } }
    }

    /// Pins the item at the end of the list, or unpins it if it was already pinned; returns the new list.
    @discardableResult
    public func toggleFavorite(_ kind: FavoriteKind, _ id: Int64) throws -> [Favorite] {
        var result: [Favorite] = []
        try edit { object in
            var current = Self.parseFavorites(object["favorites"])
            let item = Favorite(kind, id)
            if let index = current.firstIndex(of: item) { current.remove(at: index) } else { current.append(item) }
            object["favorites"] = current.map { ["type": $0.kind.rawValue, "id": NSNumber(value: $0.id)] as [String: Any] }
            result = current
        }
        return result
    }

    /// Sets the colour scheme to one of the desktop's six names; any other name is refused (the desktop would read it as `dark`).
    public func setTheme(_ name: String) throws {
        guard Self.themeNames.contains(name) else { throw SettingsError.unknownTheme(name) }
        try edit { $0["theme"] = name }
    }

    /// Keeps the hours Follow the sun moves at. Hours that do not go round the clock in order are refused (`SunHours.problem`) and nothing is written.
    public func setSunHours(_ hours: SunHours) throws {
        if let problem = hours.problem { throw SettingsError.unusableSunHours(problem) }
        try edit { $0["sunHours"] = hours.settingsObject }
    }

    /// Turns the Reading List plugin on or off. The other plugins' entries (the desktop's to-do list, RSS Reader, Contacts) are kept as
    /// they were; a `plugins` value that is not an object is replaced, as the desktop's parser would have ignored it.
    public func setReadingListEnabled(_ enabled: Bool) throws {
        try edit { object in
            var plugins = object["plugins"] as? [String: Any] ?? [:]
            plugins[ReadingLinks.pluginId] = enabled
            object["plugins"] = plugins
        }
    }

    // MARK: The file

    /// The settings object as it is on disk, or an empty one when there is no file or it is not a JSON object.
    private func readObject() -> [String: Any] {
        guard let data = try? Data(contentsOf: url), data.count <= BackupNames.maxJSONBytes,
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return [:] }
        return object
    }

    func locked<T>(_ body: ([String: Any]) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body(readObject())
    }

    /// Changes the keys `body` touches and writes the object back, every other key as it was (but for a stale `location`, below). Written to a temporary name and
    /// renamed, so the file is never half written.
    func edit(_ body: (inout [String: Any]) -> Void) throws {
        lock.lock()
        defer { lock.unlock() }
        var object = readObject()
        body(&object)
        // The city an older version kept for Follow the sun is not read any more, and goes with the next write (the desktop's rewrite of the file drops it too).
        object.removeValue(forKey: "location")
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    // MARK: Reading what came off disk (the desktop's parsers, which never throw)

    /// `Number.isSafeInteger`: a JSON number that is a whole number within ±(2^53 − 1), and not a boolean.
    static func safeInteger(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double == double.rounded(.towardZero), abs(double) <= 9_007_199_254_740_991 else { return nil }
        return Int64(double)
    }

    /// `parseFavorites`: whatever came off disk, reduced to well-formed entries with duplicates dropped.
    static func parseFavorites(_ value: Any?) -> [Favorite] {
        guard let entries = value as? [Any] else { return [] }
        var result: [Favorite] = []
        for entry in entries {
            guard let object = entry as? [String: Any], let type = object["type"] as? String, let kind = FavoriteKind(rawValue: type),
                let id = safeInteger(object["id"])
            else { continue }
            let item = Favorite(kind, id)
            if !result.contains(item) { result.append(item) }
        }
        return result
    }

    static func parseTheme(_ value: Any?) -> String {
        if let name = value as? String, themeNames.contains(name) { return name }
        return defaultTheme
    }
}

public enum SettingsError: Error, Equatable, LocalizedError {
    case unknownTheme(String)
    case unusableSunHours(String)

    public var errorDescription: String? {
        switch self {
        case .unknownTheme(let name): "“\(name)” is not one of the colour schemes."
        case .unusableSunHours(let reason): reason
        }
    }
}
