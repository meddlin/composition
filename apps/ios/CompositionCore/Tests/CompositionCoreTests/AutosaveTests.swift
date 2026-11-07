import Foundation
import Testing

@testable import CompositionCore

// Build plan, Step 4 (spike S6): what is typed reaches the database, and survives the app being ended. The timing is moved by
// hand (`ManualScheduler`), so none of this waits on a clock.

/// Time that moves only when told to.
final class ManualScheduler: AutosaveScheduler, @unchecked Sendable {
    private final class Timer: AutosaveTimer, @unchecked Sendable {
        let due: TimeInterval
        let work: @Sendable () -> Void
        var cancelled = false
        init(due: TimeInterval, work: @escaping @Sendable () -> Void) { (self.due, self.work) = (due, work) }
        func cancel() { cancelled = true }
    }

    private let lock = NSLock()
    private var clock: TimeInterval = 0
    private var timers: [Timer] = []

    var now: TimeInterval { lock.withLock { clock } }

    /// Timers that have not fired and not been cancelled.
    var pending: Int { lock.withLock { timers.filter { !$0.cancelled }.count } }

    func schedule(after seconds: TimeInterval, _ work: @escaping @Sendable () -> Void) -> any AutosaveTimer {
        lock.withLock {
            let timer = Timer(due: clock + seconds, work: work)
            timers.append(timer)
            return timer
        }
    }

    /// Moves time forward, firing what falls due along the way, in order.
    func advance(by seconds: TimeInterval) {
        let target = now + seconds
        while true {
            let next = lock.withLock { () -> Timer? in
                let due = timers.filter { !$0.cancelled && $0.due <= target }.min { $0.due < $1.due }
                if let due {
                    clock = max(clock, due.due)
                    timers.removeAll { $0 === due }
                }
                return due
            }
            guard let next else { break }
            next.work()
        }
        lock.withLock { clock = target }
    }
}

@Suite("Autosave: typed text reaches the database and survives the app being ended")
struct AutosaveTests {
    private struct Setup {
        let store: NoteStore
        let database: CompositionDatabase
        let drafts: NoteDrafts
        let location: DataLocation
        let scheduler: ManualScheduler
        let note: NoteDetail

        func autosaver(timing: NoteAutosaver.Timing = NoteAutosaver.Timing()) -> NoteAutosaver {
            NoteAutosaver(store: store, note: note, drafts: drafts, timing: timing, scheduler: scheduler)
        }

        func content() throws -> String { try #require(try database.note(id: note.id)).content }
    }

    private func setup(_ scratch: Scratch) throws -> Setup {
        let database = try CompositionDatabase.open(at: scratch.databaseURL)
        let store = NoteStore(database: database)
        let location = DataLocation(directory: scratch.directory)
        return Setup(store: store, database: database, drafts: NoteDrafts(location: location), location: location, scheduler: ManualScheduler(), note: try store.createNote(title: "Typed"))
    }

    // MARK: The autosaver

    @Test("typing is saved after a pause, not before")
    func savesAfterAPause() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let autosaver = s.autosaver()
            autosaver.edit("---\ntitle: Typed\n---\nfirst")
            s.scheduler.advance(by: 0.5)
            autosaver.waitUntilIdle()
            #expect(try s.content() == s.note.content, "not yet")
            #expect(autosaver.hasUnsavedChanges)
            s.scheduler.advance(by: 0.4)
            autosaver.waitUntilIdle()
            #expect(try s.content().hasSuffix("---\nfirst"))
            #expect(!autosaver.hasUnsavedChanges)
        }
    }

    @Test("a pause that never comes still saves, after the longest wait")
    func savesAtTheLongestWait() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let autosaver = s.autosaver()
            let saves = SaveCounter()
            autosaver.onSaved { _ in saves.add() }
            for step in 0..<20 {  // one change every half second: the pause is never long enough
                autosaver.edit("---\ntitle: Typed\n---\nword \(step)")
                s.scheduler.advance(by: 0.5)
                autosaver.waitUntilIdle()
            }
            #expect(saves.count >= 1 && saves.count <= 3, "saved on the way, not on every change: \(saves.count)")
            #expect(try s.content().contains("word "))
        }
    }

    @Test("flush writes at once and waits")
    func flushes() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let autosaver = s.autosaver()
            autosaver.edit("---\ntitle: Typed\n---\nabout to be backgrounded")
            #expect(autosaver.flush())
            #expect(try s.content().hasSuffix("about to be backgrounded"))
            #expect(s.scheduler.pending == 0, "the pause is over")
        }
    }

    @Test("typing the stored text back is not a change")
    func typingBack() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let autosaver = s.autosaver()
            let saves = SaveCounter()
            autosaver.onSaved { _ in saves.add() }
            autosaver.edit(s.note.content + "x")
            autosaver.edit(s.note.content)
            s.scheduler.advance(by: 10)
            autosaver.waitUntilIdle()
            #expect(saves.count == 0 && !autosaver.hasUnsavedChanges)
            #expect(s.drafts.all().isEmpty, "and no draft is kept for it")
        }
    }

    @Test("the typed text is on disk at once, and the draft goes when the save has it")
    func draftLifecycle() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let autosaver = s.autosaver()
            autosaver.edit("---\ntitle: Typed\n---\nin flight")
            #expect(s.drafts.all() == [NoteDraft(noteId: s.note.id, uuid: s.note.uuid, text: "---\ntitle: Typed\n---\nin flight")])
            #expect(autosaver.flush())
            #expect(s.drafts.all().isEmpty)
        }
    }

    @Test("more typing during a save is not lost, and its draft is kept")
    func typingDuringASave() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let autosaver = s.autosaver()
            // The edit arrives as the save finishes: the handler runs on the saving queue, after the database write.
            autosaver.onSaved { _ in autosaver.edit("---\ntitle: Typed\n---\nsecond") }
            autosaver.edit("---\ntitle: Typed\n---\nfirst")
            s.scheduler.advance(by: 1)
            autosaver.waitUntilIdle()
            #expect(autosaver.hasUnsavedChanges)
            #expect(s.drafts.all().map(\.text) == ["---\ntitle: Typed\n---\nsecond"])
            autosaver.onSaved(nil)
            #expect(autosaver.flush())
            #expect(try s.content().hasSuffix("second"))
        }
    }

    @Test("a save that fails keeps the text in the draft and tries again")
    func failing() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            let autosaver = s.autosaver()
            let failures = SaveCounter()
            autosaver.onFailure { _ in failures.add() }
            try s.database.close()  // every save fails from here on
            autosaver.edit("---\ntitle: Typed\n---\nnot saved")
            #expect(!autosaver.flush(), "it says so")
            #expect(failures.count == 1 && autosaver.hasUnsavedChanges)
            #expect(s.scheduler.pending == 1, "a retry is waiting")
            #expect(s.drafts.all().map(\.text) == ["---\ntitle: Typed\n---\nnot saved"])
        }
    }

    @Test("a note that is gone is not retried, and its draft stays")
    func goneNote() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let autosaver = s.autosaver()
            try s.database.trashNote(id: s.note.id)
            autosaver.edit("---\ntitle: Typed\n---\ntoo late")
            #expect(!autosaver.flush())
            #expect(s.scheduler.pending == 0)
            #expect(s.drafts.all().count == 1)
        }
    }

    // MARK: Being ended

    @Test("text typed just before the app was ended is put into the database on the next launch")
    func recoveredAfterKill() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            do {
                let autosaver = s.autosaver()
                autosaver.edit("---\ntitle: Typed\n---\nlast words before the kill")
                s.drafts.waitUntilIdle()  // the draft write is what the kill must not beat
                // The autosaver, the timer and everything in memory are gone; only the files are left.
            }
            #expect(try s.content() == s.note.content, "the database never got it")

            let relaunched = NoteSessions(store: s.store, drafts: NoteDrafts(location: s.location), scheduler: ManualScheduler())
            #expect(relaunched.recoverDrafts() == [s.note.id])
            #expect(try s.content().hasSuffix("last words before the kill"))
            #expect(NoteDrafts(location: s.location).all().isEmpty)
            #expect(relaunched.recoverDrafts().isEmpty, "once only")
        }
    }

    @Test("a draft that does not belong to a note any more is discarded, never applied")
    func staleDrafts() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            s.drafts.write(NoteDraft(noteId: s.note.id, uuid: "not-this-note", text: "wrong note"))
            s.drafts.write(NoteDraft(noteId: 9999, uuid: "nobody", text: "no such note"))
            let sessions = NoteSessions(store: s.store, drafts: s.drafts, scheduler: s.scheduler)
            #expect(sessions.recoverDrafts().isEmpty)
            #expect(try s.content() == s.note.content)
            #expect(s.drafts.all().isEmpty)
        }
    }

    @Test("a draft that cuts off mid-write is ignored")
    func damagedDraft() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            try FileManager.default.createDirectory(at: s.location.draftsURL, withIntermediateDirectories: true)
            try Data("{\"noteId\": 1, \"uu".utf8).write(to: s.location.draftsURL.appendingPathComponent("1.json"))
            #expect(s.drafts.all().isEmpty)
            #expect(NoteSessions(store: s.store, drafts: s.drafts, scheduler: s.scheduler).recoverDrafts().isEmpty)
        }
    }

    @Test("opening a note finishes saving what an earlier run left in its draft")
    func openingRecovers() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            s.drafts.write(NoteDraft(noteId: s.note.id, uuid: s.note.uuid, text: "---\ntitle: Typed\n---\nleft behind"))
            let sessions = NoteSessions(store: s.store, drafts: s.drafts, scheduler: s.scheduler)
            let session = try sessions.open(noteId: s.note.id)
            #expect(session.text.hasSuffix("left behind"))
            sessions.close(session)
        }
    }

    @Test("a restore removes the drafts, which belonged to the database it replaced")
    func restoreClearsDrafts() throws {
        try withScratch { scratch in
            let source = DataLocation(directory: scratch.directory.appendingPathComponent("source", isDirectory: true))
            let database = try populate(source)
            let file = scratch.directory.appendingPathComponent("backup.tar.gz")
            _ = try Backup.create(database: database, location: source, to: file)

            let target = DataLocation(directory: scratch.directory.appendingPathComponent("target", isDirectory: true))
            try populate(target).close()
            let drafts = NoteDrafts(location: target)
            drafts.write(NoteDraft(noteId: 1, uuid: "x", text: "stale"))
            drafts.waitUntilIdle()
            #expect(FileManager.default.fileExists(atPath: target.draftsURL.path))
            try Backup.apply(try Backup.stage(file, in: target), to: target)
            #expect(!FileManager.default.fileExists(atPath: target.draftsURL.path))
        }
    }

    // MARK: Sessions

    @Test("two windows on one note share its text, and only the last to close saves it")
    func sharedSession() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let sessions = NoteSessions(store: s.store, drafts: s.drafts, scheduler: s.scheduler)
            let first = try sessions.open(noteId: s.note.id)
            let second = try sessions.open(noteId: s.note.id)
            #expect(first === second)

            let heard = HeardText()
            let observation = second.observe { heard.set($0) }
            first.edit("---\ntitle: Typed\n---\ntyped in the first window")
            #expect(heard.text == "---\ntitle: Typed\n---\ntyped in the first window")
            #expect(second.text == first.text)

            sessions.close(first)
            #expect(try s.content() == s.note.content, "the other window still has it open")
            sessions.close(second)
            #expect(try s.content().hasSuffix("typed in the first window"))
            withExtendedLifetime(observation) {}
        }
    }

    @Test("flushAll saves every open note")
    func flushAll() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let other = try s.store.createNote(title: "Other")
            let sessions = NoteSessions(store: s.store, drafts: s.drafts, scheduler: s.scheduler)
            let one = try sessions.open(noteId: s.note.id)
            let two = try sessions.open(noteId: other.id)
            one.edit("---\ntitle: Typed\n---\none")
            two.edit("---\ntitle: Other\n---\ntwo")
            #expect(sessions.hasUnsavedChanges)
            #expect(sessions.flushAll())
            #expect(!sessions.hasUnsavedChanges)
            #expect(try s.content().hasSuffix("one") && (try #require(try s.database.note(id: other.id)).content.hasSuffix("two")))
        }
    }

    @Test("opening a note that is not there says so")
    func openMissing() throws {
        try withScratch { scratch in
            let s = try setup(scratch)
            defer { try? s.database.close() }
            let sessions = NoteSessions(store: s.store, drafts: s.drafts, scheduler: s.scheduler)
            #expect(throws: StoreError.notFound("Note 404")) { try sessions.open(noteId: 404) }
        }
    }

    // MARK: Real time

    @Test("a thousand edits in a burst, on the real clock, end up in the database whole")
    func burstOnTheRealClock() throws {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            let store = NoteStore(database: database)
            let note = try store.createNote(title: "Burst")
            let drafts = NoteDrafts(location: DataLocation(directory: scratch.directory))
            let autosaver = NoteAutosaver(store: store, note: note, drafts: drafts, timing: NoteAutosaver.Timing(quiet: 0.02, longest: 0.1, retry: 0.1))
            var text = "---\ntitle: Burst\n---\n"
            for index in 0..<1000 {
                text += "line \(index) of a long paragraph typed quickly\n"
                autosaver.edit(text)
                if index % 100 == 0 { Thread.sleep(forTimeInterval: 0.03) }
            }
            #expect(autosaver.flush())
            #expect(try #require(try database.note(id: note.id)).content.hasSuffix("line 999 of a long paragraph typed quickly\n"))
            #expect(drafts.all().isEmpty, "the same instance, which waits for its own pending removals")
        }
    }
}

final class SaveCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.withLock { value } }
    func add() { lock.withLock { value += 1 } }
}

final class HeardText: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    var text: String? { lock.withLock { value } }
    func set(_ text: String) { lock.withLock { value = text } }
}
