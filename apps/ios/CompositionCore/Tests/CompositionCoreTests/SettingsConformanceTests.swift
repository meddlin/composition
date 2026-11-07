import Foundation
import Testing

@testable import CompositionCore

// Build plan, Step 1: the parts of the desktop's `parseWebSettings` the iPad uses, against the real function. The inputs are
// apps/ios/conformance/settings-cases.json and what the desktop made of each is settings-expected.json (see
// ConformanceTests.swift for how to run this). The backup round trip with settings is in BackupConformanceTests.

private struct Expected: Decodable {
    struct Favorite: Decodable, Equatable { let type: String; let id: Int64 }
    struct City: Decodable, Equatable { let name: String; let latitude: Double; let longitude: Double; let timezone: String }
    let favorites: [[Favorite]]
    let theme: [String]
    let location: [City?]
}

@Suite("Settings against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct SettingsConformanceTests {
    @Test("favorites, themes and cities are read as the desktop reads them")
    func parsers() throws {
        let directory = try #require(conformanceDirectory)
        let cases = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("settings-cases.json"))) as? [String: Any])
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("settings-expected.json")))
        let favorites = try #require(cases["favorites"] as? [Any]), themes = try #require(cases["theme"] as? [Any]), locations = try #require(cases["location"] as? [Any])

        var different: [String] = []
        for (index, value) in favorites.enumerated() {
            let ours = SettingsStore.parseFavorites(value).map { Expected.Favorite(type: $0.kind.rawValue, id: $0.id) }
            if ours != expected.favorites[index] { different.append("  favorites \(String(reflecting: value)): ours \(ours), desktop \(expected.favorites[index])") }
        }
        for (index, value) in themes.enumerated() {
            let ours = SettingsStore.parseTheme(value)
            if ours != expected.theme[index] { different.append("  theme \(String(reflecting: value)): ours \(ours), desktop \(expected.theme[index])") }
        }
        for (index, value) in locations.enumerated() {
            let ours = SettingsStore.parseLocation(value).map { Expected.City(name: $0.name, latitude: $0.latitude, longitude: $0.longitude, timezone: $0.timezone) }
            if ours != expected.location[index] { different.append("  location \(String(reflecting: value)): ours \(String(describing: ours)), desktop \(String(describing: expected.location[index]))") }
        }
        let total = favorites.count + themes.count + locations.count
        print("\nSettings: \(total - different.count) of \(total) inputs read as the desktop reads them")
        for line in different { print(line) }
        #expect(different.isEmpty, "inputs that differ: \(different.count)")
    }
}
