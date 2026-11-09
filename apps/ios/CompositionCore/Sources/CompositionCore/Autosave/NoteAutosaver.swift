import Foundation
import os

// Saving what is typed, for one note (build plan, Step 4; spike S6): the one write path from an editor to the database.
//
//   * Every edit is noted at once, in memory and in the note's draft file (`NoteDrafts`), which is what survives if iOS ends the
//     app in the middle of a sentence.
//   * The database is written after a pause in typing (`quiet`), and at the latest `longest` seconds after the first unsaved
//     change, so a long burst of typing is still saved on the way. Writing is `NoteStore.saveNoteContent`: the frontmatter is
//     reconciled into the columns and the search index follows.
//   * `flush()` writes now and waits, for the moments the app may be about to stop: leaving the foreground, a scene closing, the
//     note being closed, a backup being made.
//   * A save that fails is tried again, and what was typed is kept in the draft meanwhile.
//
// Saves run one at a time on a queue of their own, so typing never waits for the database.

/// Something that can be cancelled before it fires.
public protocol AutosaveTimer: Sendable {
    func cancel()
}

/// What the autosaver uses to wait, so that a test can move time by hand.
public protocol AutosaveScheduler: Sendable {
    /// A clock that only moves forward, in seconds.
    var now: TimeInterval { get }
    func schedule(after seconds: TimeInterval, _ work: @escaping @Sendable () -> Void) -> any AutosaveTimer
}

/// The real clock: `DispatchQueue.asyncAfter`.
public struct DispatchAutosaveScheduler: AutosaveScheduler {
    private final class Timer: AutosaveTimer, @unchecked Sendable {
        let item: DispatchWorkItem
        init(_ item: DispatchWorkItem) { self.item = item }
        func cancel() { item.cancel() }
    }

    private let queue: DispatchQueue

    public init(queue: DispatchQueue = DispatchQueue(label: "composition.autosave.clock", qos: .utility)) { self.queue = queue }

    public var now: TimeInterval { ProcessInfo.processInfo.systemUptime }

    public func schedule(after seconds: TimeInterval, _ work: @escaping @Sendable () -> Void) -> any AutosaveTimer {
        let item = DispatchWorkItem(block: work)
        queue.asyncAfter(deadline: .now() + seconds, execute: item)
        return Timer(item)
    }
}

public final class NoteAutosaver: Sendable {
    public struct Timing: Sendable, Equatable {
        /// How long typing must pause before the note is saved.
        public var quiet: TimeInterval
        /// The most a stretch of unsaved typing may wait.
        public var longest: TimeInterval
        /// How long to wait before trying again after a save fails.
        public var retry: TimeInterval

        public init(quiet: TimeInterval = 0.8, longest: TimeInterval = 5, retry: TimeInterval = 3) {
            (self.quiet, self.longest, self.retry) = (quiet, longest, retry)
        }
    }

    private struct State {
        /// What the last successful save was given.
        var saved: String
        /// The newest text the editor has handed over.
        var latest: String
        /// Counts the edits, so that a save can tell whether more typing arrived while it ran.
        var revision = 0
        var firstUnsavedAt: TimeInterval?
        var timer: (any AutosaveTimer)?
    }

    private struct Handlers {
        var saved: (@Sendable (NoteDetail) -> Void)?
        var failed: (@Sendable (any Error) -> Void)?
    }

    public let noteId: Int64
    private let uuid: String
    private let store: NoteStore
    private let drafts: NoteDrafts?
    private let timing: Timing
    private let scheduler: any AutosaveScheduler
    private let queue: DispatchQueue
    private let state: OSAllocatedUnfairLock<State>
    private let handlers = OSAllocatedUnfairLock(initialState: Handlers())

    /// `note` is the note as it was loaded: its text is what the database holds, so typing it back is not a change.
    public init(store: NoteStore, note: NoteDetail, drafts: NoteDrafts? = nil, timing: Timing = Timing(), scheduler: any AutosaveScheduler = DispatchAutosaveScheduler()) {
        self.store = store
        noteId = note.id
        uuid = note.uuid
        self.drafts = drafts
        self.timing = timing
        self.scheduler = scheduler
        queue = DispatchQueue(label: "composition.autosave.\(note.id)", qos: .utility)
        state = OSAllocatedUnfairLock(initialState: State(saved: note.content, latest: note.content))
    }

    /// Called (on the saving queue) after each successful save, with the note as stored: its frontmatter may have been rewritten.
    public func onSaved(_ handler: (@Sendable (NoteDetail) -> Void)?) { handlers.withLock { $0.saved = handler } }

    /// Called (on the saving queue) when a save fails. It is tried again, unless the note is gone.
    public func onFailure(_ handler: (@Sendable (any Error) -> Void)?) { handlers.withLock { $0.failed = handler } }

    /// The newest text handed over.
    public var text: String { state.withLock { $0.latest } }

    /// Whether what was typed is not yet in the database.
    public var hasUnsavedChanges: Bool { state.withLock { $0.latest != $0.saved } }

    // MARK: Editing

    /// The editor's text is now `text`. Cheap; call it on every change.
    public func edit(_ text: String) {
        state.withLock { state in
            if text == state.latest { return }
            state.latest = text
            state.revision += 1
            state.timer?.cancel()
            state.timer = nil
            if text == state.saved {
                // Typed back to what is stored: nothing to save, and nothing to keep.
                state.firstUnsavedAt = nil
                drafts?.remove(noteId: noteId)
                return
            }
            drafts?.write(NoteDraft(noteId: noteId, uuid: uuid, text: text))
            let now = scheduler.now
            let first = state.firstUnsavedAt ?? now
            state.firstUnsavedAt = first
            state.timer = schedule(after: min(timing.quiet, max(0, timing.longest - (now - first))))
        }
    }

    /// Saves what is unsaved now and waits for it. Returns whether nothing unsaved is left; if not, the draft file has it.
    @discardableResult
    public func flush() -> Bool {
        state.withLock { state in
            state.timer?.cancel()
            state.timer = nil
        }
        queue.sync { save() }
        if hasUnsavedChanges { drafts?.waitUntilIdle() }
        return !hasUnsavedChanges
    }

    /// Waits for a save already under way, without starting one. For tests.
    func waitUntilIdle() { queue.sync {} }

    // MARK: Saving

    /// Must be called with the state lock held.
    private func schedule(after seconds: TimeInterval) -> any AutosaveTimer {
        scheduler.schedule(after: seconds) { [weak self] in
            guard let self else { return }
            queue.async { self.save() }
        }
    }

    /// Runs on `queue`.
    private func save() {
        let job: (text: String, revision: Int)? = state.withLock { state in
            state.timer?.cancel()
            state.timer = nil
            state.firstUnsavedAt = nil
            return state.latest == state.saved ? nil : (state.latest, state.revision)
        }
        guard let job else { return }
        do {
            let note = try store.saveNoteContent(id: noteId, content: job.text)
            state.withLock { state in
                state.saved = job.text
                // Only when nothing was typed meanwhile: otherwise the draft already holds something newer.
                if job.revision == state.revision { drafts?.remove(noteId: noteId) }
            }
            handlers.withLock { $0.saved }?(note)
        } catch {
            if case StoreError.notFound = error {
                // The note is gone (trashed or deleted elsewhere): trying again cannot help. The draft stays.
            } else {
                state.withLock { state in
                    if state.timer == nil {
                        state.firstUnsavedAt = scheduler.now
                        state.timer = schedule(after: timing.retry)
                    }
                }
            }
            handlers.withLock { $0.failed }?(error)
        }
    }
}
