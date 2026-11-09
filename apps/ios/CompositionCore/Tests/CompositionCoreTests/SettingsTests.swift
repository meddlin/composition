import Foundation
import Testing

@testable import CompositionCore

@Suite("Settings: favorites, scheme and city")
struct SettingsTests {
    private func location(_ scratch: Scratch, _ name: String = "data") -> DataLocation {
        DataLocation(directory: scratch.directory.appendingPathComponent(name, isDirectory: true))
    }

    /// A settings file like the desktop's, with keys the iPad does not use.
    private let desktopSettings = """
        {"theme":"forest","sidebarWidth":321,"editorRatio":0.4,"favorites":[{"type":"note","id":1}],
         "location":{"name":"Reykjavik","latitude":64.1466,"longitude":-21.9426,"timezone":"Atlantic/Reykjavik"},
         "todos":{"weekStart":1},"plugins":{"todo":true,"reader":false},"panels":{"version":2,"cells":[1,2,3]},
         "assistant":{"host":"http://localhost:11434"}}
        """

    private func object(_ url: URL) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    @Test("favorites are pinned at the end, unpinned by pinning again, and kept in order")
    func favorites() throws {
        try withScratch { scratch throws in
            let store = SettingsStore(location: location(scratch))
            #expect(store.favorites().isEmpty && !store.isFavorite(.note, 1))
            #expect(try store.toggleFavorite(.note, 1) == [Favorite(.note, 1)])
            #expect(try store.toggleFavorite(.group, 1) == [Favorite(.note, 1), Favorite(.group, 1)])
            #expect(try store.toggleFavorite(.note, 1) == [Favorite(.group, 1)], "unpinned")
            #expect(try store.toggleFavorite(.note, 2) == [Favorite(.group, 1), Favorite(.note, 2)])
            #expect(store.favorites() == [Favorite(.group, 1), Favorite(.note, 2)], "read back from the file")
            #expect(store.isFavorite(.note, 2) && !store.isFavorite(.note, 1))
        }
    }

    @Test("a change leaves every key the iPad does not use as the desktop wrote it")
    func keepsTheDesktopsKeys() throws {
        try withScratch { scratch in
            let place = location(scratch)
            try FileManager.default.createDirectory(at: place.directory, withIntermediateDirectories: true)
            try Data(desktopSettings.utf8).write(to: place.settingsURL)
            let before = try object(place.settingsURL)

            let store = SettingsStore(location: place)
            #expect(store.favorites() == [Favorite(.note, 1)] && store.theme() == "forest")
            #expect(store.location() == SavedLocation(name: "Reykjavik", latitude: 64.1466, longitude: -21.9426, timezone: "Atlantic/Reykjavik"))
            try store.toggleFavorite(.group, 7)
            try store.setTheme("cream")

            var after = try object(place.settingsURL)
            #expect((after["favorites"] as? [[String: Any]])?.count == 2)
            #expect(after["theme"] as? String == "cream")
            for key in ["favorites", "theme"] { after[key] = nil }
            var expected = before
            for key in ["favorites", "theme"] { expected[key] = nil }
            #expect(NSDictionary(dictionary: after) == NSDictionary(dictionary: expected), "sidebarWidth, location, todos, plugins, panels and the assistant are untouched")
        }
    }

    @Test("the colour scheme is one of the desktop's six, and a city can be set and cleared")
    func themeAndCity() throws {
        try withScratch { scratch in
            let store = SettingsStore(location: location(scratch))
            #expect(store.theme() == "dark", "the desktop's default when nothing is set")
            for name in SettingsStore.themeNames { try store.setTheme(name); #expect(store.theme() == name) }
            #expect(throws: SettingsError.unknownTheme("system")) { try store.setTheme("system") }
            #expect(store.theme() == "auto", "a refused name changes nothing")

            let city = SavedLocation(name: "Oslo", latitude: 59.9139, longitude: 10.7522, timezone: "Europe/Oslo")
            try store.setLocation(city)
            #expect(store.location() == city)
            try store.setLocation(nil)
            #expect(store.location() == nil)
        }
    }

    @Test("a file that is not a JSON object is read as empty and replaced on the first change")
    func damagedFile() throws {
        try withScratch { scratch in
            let place = location(scratch)
            try FileManager.default.createDirectory(at: place.directory, withIntermediateDirectories: true)
            for junk in ["not json", "[1,2,3]", "null", ""] {
                try Data(junk.utf8).write(to: place.settingsURL)
                let store = SettingsStore(location: place)
                #expect(store.favorites().isEmpty && store.theme() == "dark" && store.location() == nil)
            }
            try SettingsStore(location: place).toggleFavorite(.note, 3)
            #expect(try object(place.settingsURL)["favorites"] != nil)
        }
    }

    // MARK: In a backup

    @Test("a backup carries the settings file as it is, and a restore writes it back as it is")
    func backupRoundTrip() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try populate(source)
            try Data(desktopSettings.utf8).write(to: source.settingsURL)
            let file = scratch.directory.appendingPathComponent("backup.tar.gz")
            _ = try Backup.create(database: database, location: source, to: file)

            let target = location(scratch, "target")
            let staged = try Backup.stage(file, in: target)
            #expect(staged.settings == Data(desktopSettings.utf8), "the file as it was")
            try Backup.apply(staged, to: target)
            #expect(try Data(contentsOf: target.settingsURL) == Data(desktopSettings.utf8))
            try CompositionDatabase.open(in: target).close()
        }
    }

    @Test("a backup without settings leaves the current ones alone, and one with them replaces them")
    func restoreAndSettings() throws {
        try withScratch { scratch in
            // A backup with no settings file (an iPad that never had one).
            let bare = location(scratch, "bare")
            let bareFile = scratch.directory.appendingPathComponent("bare.tar.gz")
            _ = try Backup.create(database: try populate(bare), location: bare, to: bareFile)

            let target = location(scratch, "target")
            _ = try populate(target)
            try Data(#"{"theme":"wine","favorites":[{"type":"note","id":9}]}"#.utf8).write(to: target.settingsURL)

            let staged = try Backup.stage(bareFile, in: target)
            #expect(staged.settings == nil)
            try Backup.apply(staged, to: target)
            #expect(SettingsStore(location: target).theme() == "wine", "kept: the desktop does the same for a backup without settings")

            // One with settings replaces them whole.
            let withSettings = location(scratch, "with")
            let database = try populate(withSettings)
            try Data(#"{"theme":"light"}"#.utf8).write(to: withSettings.settingsURL)
            let file = scratch.directory.appendingPathComponent("with.tar.gz")
            _ = try Backup.create(database: database, location: withSettings, to: file)
            try Backup.apply(try Backup.stage(file, in: target), to: target)
            #expect(SettingsStore(location: target).theme() == "light" && SettingsStore(location: target).favorites().isEmpty)
        }
    }

    @Test("an oversized or non-object settings file is left out of a backup")
    func unusableSettings() throws {
        try withScratch { scratch in
            let source = location(scratch, "source")
            let database = try populate(source)
            let file = scratch.directory.appendingPathComponent("backup.tar.gz")
            for junk in [Data("[1]".utf8), Data("nope".utf8), Data(repeating: 0x20, count: 1024 * 1024 + 10)] {
                try junk.write(to: source.settingsURL)
                _ = try Backup.create(database: database, location: source, to: file)
                #expect(try Backup.stage(file, in: location(scratch, "t\(junk.count)")).settings == nil)
            }
        }
    }
}
