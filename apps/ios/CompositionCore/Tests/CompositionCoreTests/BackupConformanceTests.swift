import CryptoKit
import Foundation
import GRDB
import Testing

@testable import CompositionCore

// Backups against the desktop's own code, in both directions (see ConformanceTests.swift for how to run them):
//
//   desktop -> Swift   desktop-backup*.tar.gz are made by the real `createBackup`. Swift restores each and must find
//                      exactly what the desktop says it put in: the notes and their uuids, the Trash Can, every file by hash.
//   Swift -> desktop   Swift then backs up what it restored, to swift-backup*.tar.gz plus a description of it. The
//                      TypeScript side restores those with the real `stageBackup` and `applyStagedBackup`, opens the
//                      result with the real `db.ts`, and compares (apps/web/scripts/conformance-fixtures.test.ts).

/// What a data directory holds. The desktop writes this as `*.expected.json`; Swift writes the same shape for its own backups.
private struct Expected: Codable, Equatable {
    struct Note: Codable, Equatable {
        var id: Int64
        var uuid: String
        var title: String
    }
    var counts: BackupCounts
    var notes: [Note]
    var trashedNotes: [Note]
    var files: [String: String]
}

@Suite("Backups against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct BackupConformanceTests {
    private func describe(_ location: DataLocation, counts: BackupCounts) throws -> Expected {
        let notes = try rawConnection(location.databaseURL).read { db -> ([Expected.Note], [Expected.Note]) in
            func rows(_ table: String) throws -> [Expected.Note] {
                try Row.fetchAll(db, sql: "SELECT id, uuid, title FROM \(table) ORDER BY id")
                    .map { Expected.Note(id: $0["id"], uuid: $0["uuid"], title: $0["title"]) }
            }
            return (try rows("notes"), try rows("trashed_notes"))
        }
        var files: [String: String] = [:]
        for folder in [BackupNames.imageDirectory, BackupNames.attachmentDirectory] {
            let directory = location.directory.appendingPathComponent(folder)
            for name in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] {
                files["\(folder)/\(name)"] = try sha256(of: directory.appendingPathComponent(name))
            }
        }
        return Expected(counts: counts, notes: notes.0, trashedNotes: notes.1, files: files)
    }

    /// About a hundred operations of every kind: a notebook, groups and sub-groups, notes in them, saves that rewrite the
    /// frontmatter, moves and placements, deletions and restores. Returns how many more notes, groups and trashed notes there are.
    private func editALot(_ store: NoteStore) throws -> (notes: Int, groups: Int, trashedNotes: Int) {
        var clock = Date(timeIntervalSince1970: 1_800_000_000)
        func tick() -> Date {
            clock.addTimeInterval(1)
            return clock
        }
        let notebook = try store.createNotebook(name: "Ops", now: tick())
        var groups: [NoteGroup] = []
        for index in 0..<8 {
            let parent = index % 3 == 2 ? groups[index - 1].id : nil
            groups.append(try store.createGroup(name: "Group \(index)", parentId: parent, notebookId: notebook.id, now: tick()))
        }
        var notes: [NoteDetail] = []
        for index in 0..<40 {
            notes.append(try store.createNote(title: "Op note \(index): colon", groupId: groups[index % groups.count].id, now: tick()))
        }
        for note in notes.prefix(20) {
            _ = try store.saveNoteContent(id: note.id, content: "---\ntitle: Edited \(note.id)\ntags: a, b\n---\n# Heading\n\nBody \(note.id)\n", now: tick())
        }
        for (index, note) in notes.enumerated() where index % 4 == 0 {
            _ = try store.placeNote(id: note.id, groupId: groups[(index + 1) % groups.count].id, before: nil)
        }
        for note in notes.prefix(5) { _ = try store.moveNote(id: note.id, toGroup: nil) }
        for group in groups.suffix(3) { _ = try? store.moveGroup(id: group.id, parentId: groups[0].id, now: tick()) }
        _ = try store.placeGroup(id: groups[1].id, parentId: nil, before: groups[0].id, now: tick())
        _ = try store.renameGroup(id: groups[0].id, name: "Renamed", now: tick())
        for note in notes[30..<40] { try store.deleteNote(id: note.id, now: tick()) }
        for note in notes[30..<33] { _ = try store.restoreNote(id: note.id) }
        return (notes: 40 - 10 + 3, groups: 8, trashedNotes: 10 - 3)
    }

    @Test("restores a backup the desktop made, and backs up the result for the desktop to restore", arguments: ["desktop-backup", "desktop-backup-large"])
    func desktopToSwiftAndBack(name: String) throws {
        let directory = try #require(conformanceDirectory)
        let archive = directory.appendingPathComponent("\(name).tar.gz")
        try #require(FileManager.default.fileExists(atPath: archive.path), "missing \(name).tar.gz: run the desktop step first")
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("\(name).expected.json")))

        try withScratch { scratch in
            // Desktop -> Swift
            let target = DataLocation(directory: scratch.directory.appendingPathComponent("ipad", isDirectory: true))
            let staged = try Backup.stage(archive, in: target)
            #expect(staged.counts == expected.counts, "the counts Swift reads from the database match the desktop's own")
            try Backup.apply(staged, to: target)

            let database = try CompositionDatabase.open(in: target)  // the Swift schema pass runs on the desktop's database
            let restored = try describe(target, counts: staged.counts)
            #expect(restored.notes == expected.notes, "same notes, ids and uuids")
            #expect(restored.trashedNotes == expected.trashedNotes)
            #expect(restored.files == expected.files, "every image and attachment, byte for byte")
            #expect(!restored.files.isEmpty && !expected.notes.isEmpty)

            // Settings: the desktop's file arrives whole, the iPad reads it, and changes only the favorites.
            let original = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("\(name).settings.json"))) as? [String: Any])
            let arrived = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: target.settingsURL)) as? [String: Any])
            #expect(NSDictionary(dictionary: arrived) == NSDictionary(dictionary: original), "settings.json arrives as the desktop wrote it")
            let settings = SettingsStore(location: target)
            #expect(settings.favorites() == [Favorite(.note, 1), Favorite(.group, 1)] && settings.theme() == "forest")
            #expect(settings.sunHours() == SunHours(lightenFrom: 19 * 60, lightFrom: 20 * 60, darkenFrom: 5 * 60, darkFrom: 6 * 60), "the hours the desktop saved are the iPad's")
            try settings.toggleFavorite(.note, 1)  // unpin
            try settings.toggleFavorite(.note, 2)  // pin
            #expect(settings.favorites() == [Favorite(.group, 1), Favorite(.note, 2)])

            // A hundred edits through the store, on the desktop's own database, before it is backed up again: the desktop has to
            // restore the result as well, and find every row.
            let edits = try editALot(NoteStore(database: database))

            // Swift -> desktop
            let output = directory.appendingPathComponent(name.replacingOccurrences(of: "desktop", with: "swift") + ".tar.gz")
            try? FileManager.default.removeItem(at: output)
            let summary = try Backup.create(database: database, location: target, to: output)
            var changed = expected.counts
            changed.notes += edits.notes
            changed.groups += edits.groups
            changed.trashedNotes += edits.trashedNotes
            #expect(summary.counts == changed, "the counts follow the edits")
            try database.close()

            let description = try describe(target, counts: summary.counts)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(description).write(to: output.deletingPathExtension().deletingPathExtension().appendingPathExtension("expected.json"))
        }
    }
}
