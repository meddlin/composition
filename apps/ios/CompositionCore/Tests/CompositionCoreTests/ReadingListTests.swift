import Foundation
import Testing

@testable import CompositionCore

// What the conformance corpus does not reach: the plugin switch written back into the desktop's settings file, the link a refusal
// names, and links surviving a backup. The rules themselves are pinned against the desktop in ReadingListConformanceTests.

@Suite("The Reading List: the plugin switch and the store")
struct ReadingListTests {
    private func location(_ scratch: Scratch) -> DataLocation {
        DataLocation(directory: scratch.directory.appendingPathComponent("data", isDirectory: true))
    }

    private func object(_ url: URL) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    @Test("the switch is off with no file, and on and off again by the iPad's own hand")
    func switchWithNoFile() throws {
        try withScratch { scratch in
            let store = SettingsStore(location: location(scratch))
            #expect(!store.readingListEnabled())
            try store.setReadingListEnabled(true)
            #expect(store.readingListEnabled())
            #expect(try object(location(scratch).settingsURL)["plugins"] as? NSDictionary == ["reading-list": true] as NSDictionary)
            try store.setReadingListEnabled(false)
            #expect(!store.readingListEnabled())
        }
    }

    @Test("turning it on keeps the desktop's other plugins and every other key as they were")
    func keepsTheOtherPlugins() throws {
        try withScratch { scratch in
            let place = location(scratch)
            try FileManager.default.createDirectory(at: place.directory, withIntermediateDirectories: true)
            let desktop = #"{"theme":"forest","plugins":{"todo":false,"rss":true,"contacts":true},"todos":{"weekStart":1}}"#
            try Data(desktop.utf8).write(to: place.settingsURL)
            let store = SettingsStore(location: place)
            #expect(!store.readingListEnabled())

            try store.setReadingListEnabled(true)
            let after = try object(place.settingsURL)
            #expect(after["plugins"] as? NSDictionary == ["todo": false, "rss": true, "contacts": true, "reading-list": true] as NSDictionary)
            #expect(after["theme"] as? String == "forest")
            #expect(after["todos"] as? NSDictionary == ["weekStart": 1] as NSDictionary)
        }
    }

    @Test("a plugins value that is not an object is replaced, as the desktop would have ignored it")
    func replacesAPluginsValueThatIsNotAnObject() throws {
        try withScratch { scratch in
            let place = location(scratch)
            try FileManager.default.createDirectory(at: place.directory, withIntermediateDirectories: true)
            try Data(#"{"plugins":[true]}"#.utf8).write(to: place.settingsURL)
            let store = SettingsStore(location: place)
            try store.setReadingListEnabled(true)
            #expect(store.readingListEnabled())
        }
    }

    @Test("a link already in the list is refused with that link, so the screen can show it")
    func duplicateNamesTheLink() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let first = try database.addReadingItem("example.com/a")
            #expect(throws: ReadingListError.alreadyListed(first)) { try database.addReadingItem("HTTPS://EXAMPLE.COM/a#later") }
            #expect(throws: ReadingListError.badLink(.notWeb)) { try database.addReadingItem("javascript:alert(1)") }
            #expect(throws: ReadingListError.gone) { try database.setReadingItemRead(id: 99, read: true) }
            #expect(try database.readingItems() == [first])
        }
    }

    /// The one case the corpus leaves out, because the JavaScript runtimes disagree on it: Node 22 leaves a `^` in a path as it is, while
    /// Node 24 and 26 (and so, almost certainly, the desktop app's Electron) write %5E. The iPad follows the newer answer.
    @Test("a ^ in a link's path is written as %5E, as Node 24 and later write it")
    func caretInAPath() {
        #expect(ReadingLinks.normalize("https://example.com/a^b?c^d") == .success("https://example.com/a%5Eb?c^d"))
    }

    @Test("the ids keep counting after a delete, as the desktop's AUTOINCREMENT does")
    func idsAreNotReused() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            let first = try database.addReadingItem("https://example.com/1")
            try database.deleteReadingItem(id: first.id)
            let second = try database.addReadingItem("https://example.com/1")
            #expect(second.id == first.id + 1)
        }
    }

    @Test("links travel in a backup and come back out of it")
    func linksTravelInABackup() throws {
        try withScratch { scratch in
            let from = DataLocation(directory: scratch.directory.appendingPathComponent("from", isDirectory: true))
            let to = DataLocation(directory: scratch.directory.appendingPathComponent("to", isDirectory: true))
            let archive = scratch.directory.appendingPathComponent("backup.tar.gz")
            do {
                let database = try CompositionDatabase.open(in: from)
                let item = try database.addReadingItem("https://example.com/kept")
                try database.setReadingItemTitle(id: item.id, title: "Kept")
                try database.setReadingItemRead(id: item.id, read: true)
                _ = try Backup.create(database: database, location: from, to: archive)
            }
            try Backup.apply(try Backup.stage(archive, in: to), to: to)
            let restored = try CompositionDatabase.open(in: to)
            #expect(try restored.readingItems().map { [$0.url, $0.title, String($0.read)] } == [["https://example.com/kept", "Kept", "true"]])
        }
    }
}
