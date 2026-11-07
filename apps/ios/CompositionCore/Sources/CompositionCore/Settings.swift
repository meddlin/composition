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

/// The city whose sunrise and sunset drive the "Follow the sun" scheme.
public struct SavedLocation: Equatable, Sendable {
    public var name: String
    public var latitude: Double
    public var longitude: Double
    public var timezone: String

    public init(name: String, latitude: Double, longitude: Double, timezone: String) {
        (self.name, self.latitude, self.longitude, self.timezone) = (name, latitude, longitude, timezone)
    }
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

    public func location() -> SavedLocation? { locked { Self.parseLocation($0["location"]) } }

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

    public func setLocation(_ location: SavedLocation?) throws {
        try edit {
            if let location {
                $0["location"] = ["name": location.name, "latitude": location.latitude, "longitude": location.longitude, "timezone": location.timezone] as [String: Any]
            } else {
                $0.removeValue(forKey: "location")
            }
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

    /// Changes the keys `body` touches and writes the object back, every other key as it was. Written to a temporary name and
    /// renamed, so the file is never half written.
    func edit(_ body: (inout [String: Any]) -> Void) throws {
        lock.lock()
        defer { lock.unlock() }
        var object = readObject()
        body(&object)
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

    /// `parseLocation`: a name and a time zone that are not empty, a latitude within ±90 and a longitude within ±180.
    static func parseLocation(_ value: Any?) -> SavedLocation? {
        guard let object = value as? [String: Any], let name = object["name"] as? String, !name.isEmpty,
            let timezone = object["timezone"] as? String, !timezone.isEmpty,
            let latitude = number(object["latitude"]), abs(latitude) <= 90,
            let longitude = number(object["longitude"]), abs(longitude) <= 180
        else { return nil }
        return SavedLocation(name: name, latitude: latitude, longitude: longitude, timezone: timezone)
    }

    /// A JSON number (`typeof value === "number"`): not a boolean, not a string.
    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }
}

public enum SettingsError: Error, Equatable, LocalizedError {
    case unknownTheme(String)

    public var errorDescription: String? {
        switch self {
        case .unknownTheme(let name): "“\(name)” is not one of the colour schemes."
        }
    }
}
