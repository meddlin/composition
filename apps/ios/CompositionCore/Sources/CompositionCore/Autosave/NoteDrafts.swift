import Foundation
import os

// The safety net under autosave (build plan, Step 4; spike S6): the text of a note that has been typed and is not yet in the
// database, kept in a small file of its own. Saving to the database waits for a pause in typing (a note's frontmatter is
// reconciled and the search index re-written, which is more than a keystroke should cost), so for that pause the typed text
// would be in memory only. If iOS ends the app in that moment, or it crashes, the file is what is left, and the next launch
// puts it into the database (`NoteSessions.recoverDrafts`).
//
// Writing is coalescing and off the caller's thread: an edit says "this is the latest text" and a background queue writes
// whatever is newest until it is caught up, so typing never waits for the disk and a slow write never queues a backlog.

/// A note's unsaved text, as found on disk.
public struct NoteDraft: Codable, Equatable, Sendable {
    public var noteId: Int64
    /// Which note this was for, so that a draft is never applied to a different note that now has the same id.
    public var uuid: String
    public var text: String
}

public final class NoteDrafts: Sendable {
    private enum Intent {
        case write(NoteDraft)
        case remove
    }

    private struct State {
        var intents: [Int64: Intent] = [:]
        var draining = false
    }

    private let directory: URL
    private let queue = DispatchQueue(label: "composition.drafts", qos: .userInitiated)
    private let state = OSAllocatedUnfairLock(initialState: State())

    public init(location: DataLocation) { directory = location.draftsURL }

    // MARK: Writing, in the background

    /// Records the latest unsaved text of a note.
    public func write(_ draft: NoteDraft) { submit(draft.noteId, .write(draft)) }

    /// Forgets a note's draft, in order with the writes before it.
    public func remove(noteId: Int64) { submit(noteId, .remove) }

    /// Returns when everything submitted so far is on disk.
    public func waitUntilIdle() { queue.sync {} }

    private func submit(_ noteId: Int64, _ intent: Intent) {
        let start = state.withLock { state -> Bool in
            state.intents[noteId] = intent  // a newer intent for the same note replaces one not yet written
            if state.draining { return false }
            state.draining = true
            return true
        }
        if start { queue.async { [self] in drain() } }
    }

    private func drain() {
        while true {
            let next = state.withLock { state -> (Int64, Intent)? in
                guard let first = state.intents.first else {
                    state.draining = false
                    return nil
                }
                state.intents[first.key] = nil
                return (first.key, first.value)
            }
            guard let (noteId, intent) = next else { return }
            perform(noteId, intent)
        }
    }

    private func perform(_ noteId: Int64, _ intent: Intent) {
        let file = fileURL(noteId)
        do {
            switch intent {
            case .write(let draft):
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try JSONEncoder().encode(draft).write(to: file, options: .atomic)
            case .remove:
                try? FileManager.default.removeItem(at: file)
            }
        } catch {
            // Best effort: the database save is the real one. A draft that cannot be written costs only the net.
            NSLog("[autosave] could not write the draft of note \(noteId): \(error)")
        }
    }

    // MARK: Reading

    /// Every draft on disk. One that cannot be read (cut off by the kill it was meant to survive) is skipped.
    public func all() -> [NoteDraft] {
        waitUntilIdle()
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.sorted().compactMap { name in
            guard name.hasSuffix(".json"), let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
            return try? JSONDecoder().decode(NoteDraft.self, from: data)
        }
    }

    private func fileURL(_ noteId: Int64) -> URL { directory.appendingPathComponent("\(noteId).json") }
}
