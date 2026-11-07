import Foundation
import os

// The notes that are open for editing, shared by everything that has one open (build plan, Step 4; spike S6).
//
// Two windows showing the same note must not each keep a copy of its text and save over the other: they share one
// `NoteSession`, so the text, the unsaved changes and the saving are one thing, and an edit in one window reaches the other.
// All sessions share one database, so the sessions are the only place that decides what is written. `flushAll` is what the app
// calls when it may be about to stop.

/// One note open for editing: the text, and the autosaver that keeps it in the database.
public final class NoteSession: Sendable {
    public let noteId: Int64
    public let autosaver: NoteAutosaver
    private let observers = OSAllocatedUnfairLock(initialState: [UUID: @Sendable (String) -> Void]())

    init(noteId: Int64, autosaver: NoteAutosaver) {
        self.noteId = noteId
        self.autosaver = autosaver
    }

    /// The newest text.
    public var text: String { autosaver.text }

    /// An editor changed the text. Every observer hears it, the sender included, which ignores a text it already shows.
    public func edit(_ text: String) {
        autosaver.edit(text)
        let handlers = observers.withLock { Array($0.values) }
        for handler in handlers { handler(text) }
    }

    /// Calls `handler`, on the thread that edited, with the new text after each edit. Stops when the returned token is released.
    public func observe(_ handler: @escaping @Sendable (String) -> Void) -> Observation {
        let id = UUID()
        observers.withLock { $0[id] = handler }
        return Observation { [weak self] in self?.observers.withLock { $0[id] = nil } }
    }

    public final class Observation: Sendable {
        private let stop: @Sendable () -> Void
        fileprivate init(_ stop: @escaping @Sendable () -> Void) { self.stop = stop }
        deinit { stop() }
    }
}

public final class NoteSessions: Sendable {
    private struct Entry {
        var session: NoteSession
        var holders: Int
    }

    private let store: NoteStore
    private let drafts: NoteDrafts
    private let timing: NoteAutosaver.Timing
    private let scheduler: any AutosaveScheduler
    private let open = OSAllocatedUnfairLock(initialState: [Int64: Entry]())

    public init(store: NoteStore, drafts: NoteDrafts, timing: NoteAutosaver.Timing = NoteAutosaver.Timing(), scheduler: any AutosaveScheduler = DispatchAutosaveScheduler()) {
        self.store = store
        self.drafts = drafts
        self.timing = timing
        self.scheduler = scheduler
    }

    /// Opens the note for editing, or joins the session another window already has. Every `open` is paired with a `close`.
    /// Throws `StoreError.notFound` for a note that is not there.
    public func open(noteId: Int64) throws -> NoteSession {
        if let existing = open.withLock({ entries -> NoteSession? in
            entries[noteId]?.holders += 1
            return entries[noteId]?.session
        }) {
            return existing
        }
        // Not open yet: a draft left by an earlier run goes into the database first, so what is shown includes it.
        if let draft = drafts.all().first(where: { $0.noteId == noteId }) { _ = try? recover(draft) }
        guard let note = try store.database.note(id: noteId) else { throw StoreError.notFound("Note \(noteId)") }
        let session = NoteSession(noteId: noteId, autosaver: NoteAutosaver(store: store, note: note, drafts: drafts, timing: timing, scheduler: scheduler))
        // Two windows may have raced to open the same note; whoever got in first owns the session.
        return open.withLock { entries -> NoteSession in
            if entries[noteId] != nil {
                entries[noteId]?.holders += 1
                return entries[noteId]!.session
            }
            entries[noteId] = Entry(session: session, holders: 1)
            return session
        }
    }

    /// Lets go of a session. The last holder's close writes whatever is unsaved.
    public func close(_ session: NoteSession) {
        let last = open.withLock { entries -> Bool in
            guard var entry = entries[session.noteId], entry.session === session else { return false }
            entry.holders -= 1
            if entry.holders > 0 {
                entries[session.noteId] = entry
                return false
            }
            entries[session.noteId] = nil
            return true
        }
        if last { session.autosaver.flush() }
    }

    /// Writes everything unsaved, in every open note, and waits. Returns whether nothing is left unsaved (the drafts have it if so).
    @discardableResult
    public func flushAll() -> Bool {
        let sessions = open.withLock { $0.values.map(\.session) }
        var allSaved = true
        for session in sessions where !session.autosaver.flush() { allSaved = false }
        return allSaved
    }

    /// Whether any open note has text that is not in the database yet.
    public var hasUnsavedChanges: Bool { open.withLock { $0.values.contains { $0.session.autosaver.hasUnsavedChanges } } }

    // MARK: After the app was ended

    /// Puts into the database the text that was typed and never saved because the app ended first. Run it when the app starts,
    /// before the notes are listed. Returns the notes it changed.
    @discardableResult
    public func recoverDrafts() -> [Int64] {
        var recovered: [Int64] = []
        for draft in drafts.all() {
            let isOpen = open.withLock { $0[draft.noteId] != nil }
            if isOpen { continue }
            if (try? recover(draft)) == true { recovered.append(draft.noteId) }
        }
        return recovered
    }

    /// Applies one draft. Returns true when it changed the note. A draft for a note that is gone, or that is a different note
    /// now, is discarded; one that fails to save stays for the next run.
    private func recover(_ draft: NoteDraft) throws -> Bool {
        guard let note = try store.database.note(id: draft.noteId), note.uuid == draft.uuid else {
            drafts.remove(noteId: draft.noteId)
            return false
        }
        defer { drafts.waitUntilIdle() }
        if note.content == draft.text {
            drafts.remove(noteId: draft.noteId)
            return false
        }
        _ = try store.saveNoteContent(id: draft.noteId, content: draft.text)
        drafts.remove(noteId: draft.noteId)
        return true
    }
}
