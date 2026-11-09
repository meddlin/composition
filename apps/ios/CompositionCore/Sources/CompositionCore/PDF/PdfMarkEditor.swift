import Foundation

// The marks of one PDF as the reader changes them, with undo and redo (docs/pdf-markup-plan.md, "Notes and citations" and the desktop's
// `documentMarks.ts`): a serial queue (an actor, so the database is read and written off the main thread and one change finishes before the next
// starts) and a history of create, delete and change steps, 200 deep. The history is in memory only: it lasts until the PDF is closed. Undoing a
// delete brings the mark back with its uuid, so a note's citation of it works again.

public actor PdfMarkEditor {
    /// How many steps are kept.
    public static let depth = 200

    /// What the reader shows after a change: every mark of the PDF, and whether undo and redo have anything to do.
    public struct State: Equatable, Sendable {
        public var marks: [PdfMark]
        public var canUndo: Bool
        public var canRedo: Bool
    }

    private enum Step: Sendable {
        case created([PdfMark])
        case deleted([PdfMark])
        case changed(before: PdfMark, after: PdfMark)
    }

    private let store: NoteStore
    public nonisolated let documentId: Int64
    private var undoSteps: [Step] = []
    private var redoSteps: [Step] = []

    public init(store: NoteStore, documentId: Int64) {
        self.store = store
        self.documentId = documentId
    }

    public var state: State { get throws { State(marks: try store.database.annotations(documentId: documentId), canUndo: !undoSteps.isEmpty, canRedo: !redoSteps.isEmpty) } }

    // MARK: Changes

    /// Makes marks (one selection is one call: a selection over pages is one record each, tied together). Throws `InvalidMarkError` when one breaks the rules.
    @discardableResult
    public func add(_ inputs: [PdfMarkInput]) throws -> State {
        let made = try store.addAnnotations(documentId: documentId, inputs)
        if !made.isEmpty { record(.created(made)) }
        return try state
    }

    /// Deletes a mark and the rest of its selection.
    @discardableResult
    public func delete(id: Int64) throws -> State {
        let removed = try store.deleteAnnotation(id: id)
        if !removed.isEmpty { record(.deleted(removed)) }
        return try state
    }

    /// Changes a mark's colour, comment or words (see `PdfMarkChanges`).
    @discardableResult
    public func update(id: Int64, changes: PdfMarkChanges) throws -> State {
        guard let before = try store.database.annotation(id: id), let after = try store.updateAnnotation(id: id, changes: changes) else { return try state }
        // Saying the colour it already has changes only the time the mark was touched: that is not a step.
        if before.sameContent(as: after) { return try state }
        record(.changed(before: before, after: after))
        return try state
    }

    private func record(_ step: Step) {
        undoSteps.append(step)
        if undoSteps.count > Self.depth { undoSteps.removeFirst(undoSteps.count - Self.depth) }
        redoSteps = []
    }

    // MARK: Undo and redo

    /// Takes back the last change; does nothing when there is none.
    @discardableResult
    public func undo() throws -> State {
        guard let step = undoSteps.last else { return try state }
        let opposite = try apply(inverseOf: step)
        undoSteps.removeLast()
        redoSteps.append(opposite)
        return try state
    }

    /// Puts back what undo took back.
    @discardableResult
    public func redo() throws -> State {
        guard let step = redoSteps.last else { return try state }
        let opposite = try apply(inverseOf: step)
        redoSteps.removeLast()
        undoSteps.append(opposite)
        return try state
    }

    /// Does the opposite of a step, and returns the step that does it again (a restored mark may have a new id, so the step is made anew).
    private func apply(inverseOf step: Step) throws -> Step {
        switch step {
        case .created(let marks):
            let removed = try store.deleteAnnotation(id: marks[0].id)
            return .deleted(removed.isEmpty ? marks : removed)
        case .deleted(let marks):
            return .created(try store.restoreAnnotations(documentId: documentId, marks))
        case .changed(let before, let after):
            let restored = try store.updateAnnotation(id: after.id, changes: Self.changes(making: before, from: after)) ?? after
            return .changed(before: after, after: restored)
        }
    }

    /// What has to change to turn `current` into `wanted`: colour, comment and a typed note's words (a text mark's rectangles and quote do not change).
    private static func changes(making wanted: PdfMark, from current: PdfMark) -> PdfMarkChanges {
        PdfMarkChanges(color: wanted.color, comment: wanted.comment, body: wanted.kind == .text ? wanted.body : nil)
    }
}

extension PdfMark {
    /// The same colour, comment, words and place: what a person sees, whatever time the mark was touched.
    fileprivate func sameContent(as other: PdfMark) -> Bool {
        color == other.color && comment == other.comment && quote == other.quote && rects == other.rects && body == other.body
    }
}
