import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The rules under four M3 screens: the header image, the heading rail's outline, the Images page's clean-up and the home page's lists. The expectations of the
// home page's text helpers are the cases of the desktop's homeListing.test.ts and headerImageSource.ts.

private let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])

@Suite("Header image")
struct HeaderImageSourceTests {
    @Test("a stored picture is named, a web address is kept as written, anything else is no header image")
    func resolving() {
        #expect(HeaderImageSource.resolve("app_data/trip-map-3f9c2a71b0de.png") == .stored(name: "trip-map-3f9c2a71b0de.png"))
        #expect(HeaderImageSource.resolve("./app_data/a.JPG") == .stored(name: "a.JPG"))
        #expect(HeaderImageSource.resolve("https://example.com/a b.png") == nil, "a space ends the address")
        #expect(HeaderImageSource.resolve("https://example.com/a.png") == .web("https://example.com/a.png"))
        #expect(HeaderImageSource.resolve("HTTP://x.y") == .web("HTTP://x.y"))
        for nothing in ["", "data:image/png;base64,AAAA", "app_data/../x.png", "app_data/x.txt", "a stray word", "ftp://x.y/a.png", "https://"] {
            #expect(HeaderImageSource.resolve(nothing) == nil, "\(nothing)")
        }
    }

    @Test("the picker marks the stored picture the frontmatter names, and none for a web address")
    func storedName() {
        #expect(HeaderImageSource.storedName(of: "app_data/a.png") == "a.png")
        #expect(HeaderImageSource.storedName(of: "https://x.y/a.png") == nil)
        #expect(HeaderImageSource.storedName(of: nil) == nil)
    }

    @Test("setting, changing and removing a header image keeps the rest of the frontmatter, and a layout that is not known reads as full")
    func writing() {
        let note = "---\ntitle: Trip\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-02T00:00:00.000Z\n---\n\nBody\n"
        let fallback = (title: "Trip", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z")
        let with = NoteFrontmatter.withHeaderImage(note, HeaderImage(image: "app_data/a.png", layout: .centered), fallback: fallback)
        let parsed = NoteFrontmatter.parse(with)
        #expect(parsed.frontmatter?.headerImage == HeaderImage(image: "app_data/a.png", layout: .centered))
        #expect(parsed.frontmatter?.title == "Trip" && parsed.body == "\nBody\n")
        let changed = NoteFrontmatter.withHeaderImage(with, HeaderImage(image: "app_data/b.png", layout: .full), fallback: fallback)
        #expect(NoteFrontmatter.parse(changed).frontmatter?.headerImage == HeaderImage(image: "app_data/b.png", layout: .full))
        let removed = NoteFrontmatter.parse(NoteFrontmatter.withHeaderImage(changed, nil, fallback: fallback))
        #expect(removed.frontmatter?.headerImage == nil && removed.frontmatter?.title == "Trip" && removed.body == "\nBody\n", "removing it leaves the title and the text")
        #expect(!NoteFrontmatter.withHeaderImage(changed, nil, fallback: fallback).contains("headerImage"), "and no trace of either key")
        let odd = note.replacingOccurrences(of: "---\n\nBody", with: "headerImage: app_data/a.png\nheaderImageLayout: sideways\n---\n\nBody")
        #expect(NoteFrontmatter.parse(odd).frontmatter?.headerImage?.layout == .full)
    }
}

@Suite("Outline")
struct NoteOutlineTests {
    @Test("a plain note lists its headings in order, with the place of each in the whole text")
    func plain() {
        let text = "---\ntitle: T\n---\n\n# One\n\ntext\n\n## Two *bold*\n\n### Three\n"
        let outline = NoteOutline.make(content: text)
        #expect(outline.map(\.text) == ["One", "Two bold", "Three"])
        #expect(outline.map(\.level) == [1, 2, 3] && outline.map(\.ordinal) == [0, 1, 2])
        let offsets = outline.compactMap(\.offset)
        #expect(offsets.count == 3)
        let units = Array(text.utf16)
        for (offset, level) in zip(offsets, [1, 2, 3]) {
            #expect(units[offset] == 0x23, "the first character is the #")
            #expect(units[offset..<(offset + level)].allSatisfy { $0 == 0x23 })
        }
    }

    @Test("a # inside a code fence is no heading, and a setext heading is one")
    func fencesAndSetext() {
        let text = "```\n# not a heading\n```\n\nTitle\n=====\n\n## After\n"
        let outline = NoteOutline.make(content: text)
        #expect(outline.map(\.text) == ["Title", "After"] && outline.map(\.level) == [1, 2])
        #expect(outline.first?.offset == (text as NSString).range(of: "Title").location)
    }

    @Test("offsets count UTF-16 units, so text before a heading in another script or an emoji does not shift it")
    func utf16() {
        let text = "日本語 🙂 first line\n\n## Section\n"
        let outline = NoteOutline.make(content: text)
        #expect(outline.count == 1 && outline[0].offset == (text as NSString).range(of: "## Section").location)
    }

    @Test("a note with no headings has no outline, and the heading being read is the last one at or before the top of the view")
    func none() {
        #expect(NoteOutline.make(content: "just words\n").isEmpty)
        #expect(NoteOutline.make(content: "").isEmpty)
        let headings = NoteOutline.make(content: "# A\n\nx\n\n# B\n\ny\n\n# C\n")
        let b = headings[1].offset!
        #expect(NoteOutline.current(in: headings, at: 0)?.text == "A")
        #expect(NoteOutline.current(in: headings, at: b - 1)?.text == "A")
        #expect(NoteOutline.current(in: headings, at: b)?.text == "B")
        #expect(NoteOutline.current(in: headings, at: 10_000)?.text == "C")
        #expect(NoteOutline.current(in: [], at: 5) == nil)
    }

    @Test("the numbering is the preview's: the ordinals are the ones the preview's headings carry")
    func ordinalsAgreeWithThePreview() {
        let text = "# A\n\n## B\n\ntext\n\n## C\n"
        let preview = NotePreview.make(content: text)
        var ordinals: [Int] = []
        func collect(_ blocks: [MdBlock]) { for case .heading(_, let ordinal, _) in blocks { ordinals.append(ordinal) } }
        for case .markdown(let blocks) in preview.blocks { collect(blocks) }
        #expect(ordinals == NoteOutline.make(content: text).map(\.ordinal))
    }
}

@Suite("Clean up images")
struct ImageCleanupTests {
    private func image(_ name: String, used: Int = 0, size: Int = 10) -> StoredImageInfo {
        StoredImageInfo(name: name, size: size, modifiedAt: "2026-01-01T00:00:00.000Z", usedIn: (0..<used).map { ImageUse(id: Int64($0), title: "n\($0)") })
    }

    @Test("the unused are those no note points at, and their sizes add up")
    func unused() {
        let all = [image("a.png", used: 1, size: 5), image("b.png", size: 7), image("c.png", size: 11)]
        #expect(StoredImages.unused(in: all).map(\.name) == ["b.png", "c.png"])
        #expect(StoredImages.totalSize(of: StoredImages.unused(in: all)) == 18)
        #expect(StoredImages.unused(in: []).isEmpty)
    }

    @Test("an unused image goes; one a note points at, in any of the forms a note uses, stays")
    func removal() throws {
        try withScratch { scratch in
            let location = DataLocation(directory: scratch.directory)
            guard case .stored(let name) = StoredImages.store(noteTitle: "Trip", fileName: "map.png", data: png, in: location) else { Issue.record("not stored"); return }
            let path = location.imagesURL.appendingPathComponent(name).path
            for text in ["![map](app_data/\(name))", "<Image src=\"app_data/\(name)\" />", "<Ink src=\"app_data/\(name)\" />", "---\ntitle: T\nheaderImage: app_data/\(name)\n---\n"] {
                #expect(StoredImages.remove(named: name, in: location, liveNotes: [NoteText(id: 1, title: "T", content: text)], trashedTexts: []) == .usedByNotes(1), "\(text)")
                #expect(FileManager.default.fileExists(atPath: path))
            }
            #expect(StoredImages.remove(named: name, in: location, liveNotes: [NoteText(id: 1, title: "T", content: "![x](app_data/other.png)")], trashedTexts: ["![](app_data/\(name))"]) == .usedInTrash)
            #expect(FileManager.default.fileExists(atPath: path), "a note in the Trash Can can come back, so its picture stays")
            #expect(StoredImages.remove(named: name, in: location, liveNotes: [], trashedTexts: []) == .removed)
            #expect(!FileManager.default.fileExists(atPath: path))
            #expect(StoredImages.remove(named: name, in: location, liveNotes: [], trashedTexts: []) == .notFound, "already gone")
        }
    }

    @Test("a name that is not a plain image file name deletes nothing, whatever it points at")
    func hostileNames() throws {
        try withScratch { scratch in
            let location = DataLocation(directory: scratch.directory)
            let outside = scratch.directory.appendingPathComponent("composition.db")
            try Data("x".utf8).write(to: outside)
            for name in ["../composition.db", "../../etc/hosts", "a/b.png", "", ".", "..", "x.txt", ".hidden.png.tmp"] {
                #expect(StoredImages.remove(named: name, in: location, liveNotes: [], trashedTexts: []) == .notFound, "\(name)")
            }
            #expect(FileManager.default.fileExists(atPath: outside.path))
        }
    }

    @Test("the text of the notes in the Trash Can is what the Images page checks before it deletes")
    func trashedTexts() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let id = try database.pool.write { db -> Int64 in
                try db.execute(
                    sql: "INSERT INTO notes (title, content, tags, description, created_at, updated_at) VALUES ('T', '![](app_data/a.png)', '', '', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')")
                return db.lastInsertedRowID
            }
            #expect(try database.trashedNoteTexts().isEmpty)
            try database.trashNote(id: id)
            #expect(try database.trashedNoteTexts() == ["![](app_data/a.png)"])
            #expect(try database.noteTexts().isEmpty, "a trashed note is not a live one: the desktop's “not used” would call its pictures unused")
        }
    }
}

@Suite("Home page")
struct HomeListingTests {
    private func note(_ id: Int64, _ updatedAt: String) -> NoteSummary { NoteSummary(id: id, title: "n\(id)", notebookId: 1, updatedAt: updatedAt) }

    @Test("recent notes are the newest edits first, the later id first on a tie, and capped")
    func recent() {
        let notes = [note(1, "2026-01-01T00:00:00Z"), note(2, "2026-03-01T00:00:00Z"), note(3, "2026-02-01T00:00:00Z"), note(4, "2026-03-01T00:00:00Z")]
        #expect(HomeListing.recent(notes).map(\.id) == [4, 2, 3, 1])
        #expect(HomeListing.recent(notes, limit: 2).map(\.id) == [4, 2])
        #expect(HomeListing.recent(notes, limit: 0).isEmpty && HomeListing.recent([]).isEmpty)
        let many = (1...30).map { note(Int64($0), "2026-01-\(String(format: "%02d", $0))T00:00:00Z") }
        #expect(HomeListing.recent(many).count == HomeListing.recentLimit)
    }

    @Test("pinned groups and notes come in the order they were pinned, and a pin whose target is gone is skipped")
    func pinned() {
        let groups = [NoteGroup(id: 5, name: "G5", notebookId: 1)]
        let notes = [note(1, "a"), note(2, "b")]
        let favorites = [Favorite(.note, 2), Favorite(.group, 5), Favorite(.note, 99), Favorite(.group, 98), Favorite(.note, 1)]
        let items = HomeListing.pinned(favorites: favorites, groups: groups, notes: notes)
        #expect(items == [.note(notes[1]), .group(groups[0]), .note(notes[0])])
    }

    @Test("the excerpt drops frontmatter and markup, and truncates")
    func excerpt() {
        #expect(HomeListing.excerpt(of: "---\ntitle: T\n---\n# Heading\n\nSome **bold** and a [link](http://x.y).") == "Heading Some bold and a link.")
        #expect(HomeListing.excerpt(of: String(repeating: "a", count: 200), max: 10) == "aaaaaaaaaa…")
        #expect(HomeListing.excerpt(of: "```swift\nlet x = 1\n```\n\n![pic](app_data/a.png)\n- item one\n> quoted _text_ `code`") == "item one quoted text code")
        #expect(HomeListing.excerpt(of: "") == "")
    }

    @Test("a card's line comes from the note's text in the database, for just the notes asked for")
    func excerptsFromTheDatabase() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let ids = try database.pool.write { db -> [Int64] in
                try ["---\ntitle: A\n---\n# Heading\n\nSome **bold** words", "plain note", "third"].map { content in
                    try db.execute(sql: "INSERT INTO notes (title, content, tags, description, created_at, updated_at) VALUES ('T', ?, '', '', 'c', 'u')", arguments: [content])
                    return db.lastInsertedRowID
                }
            }
            let found = try database.excerpts(of: [ids[0], ids[1], 9_999])
            #expect(found == [ids[0]: "Heading Some bold words", ids[1]: "plain note"])
            #expect(try database.excerpts(of: []).isEmpty)
        }
    }

    @Test("relative time reads as the desktop's does, and a month or more is left for a date")
    func relativeTime() {
        let now = try! Date("2026-10-23T12:00:00Z", strategy: Date.ISO8601FormatStyle())
        #expect(HomeListing.relativeTime("2026-10-23T11:59:30Z", now: now) == "just now")
        #expect(HomeListing.relativeTime("2026-10-23T11:30:00Z", now: now) == "30 min ago")
        #expect(HomeListing.relativeTime("2026-10-23T07:00:00Z", now: now) == "5 hr ago")
        #expect(HomeListing.relativeTime("2026-10-22T11:00:00Z", now: now) == "1 day ago")
        #expect(HomeListing.relativeTime("2026-10-20T11:00:00.123Z", now: now) == "3 days ago", "the fractional seconds the desktop writes")
        #expect(HomeListing.relativeTime("2026-09-01T00:00:00.000Z", now: now) == nil)
        #expect(HomeListing.relativeTime("not a time", now: now) == nil)
        #expect(HomeListing.relativeTime("2026-10-23T13:00:00Z", now: now) == "just now", "a clock a little ahead")
    }
}
