import type { DocumentsApi, PdfAnnotation } from "./documentsApi";
import type { AnnotationChanges, PdfAnnotationInput } from "./pdfMarkup";

/** What the marks of a PDF need from the backend. */
export type MarksDeps = Pick<DocumentsApi, "listAnnotations" | "addAnnotations" | "updateAnnotation" | "deleteAnnotation" | "restoreAnnotations">;

/** The marks of one PDF as the reader shows them, and how much can be undone or redone. */
export type DocumentMarks = {
  status: "loading" | "ready" | "error";
  /** In page order, and the order they were made within a page. */
  items: PdfAnnotation[];
  error: string | null;
  undoCount: number;
  redoCount: number;
};

export const NO_MARKS: DocumentMarks = { status: "loading", items: [], error: null, undoCount: 0, redoCount: 0 };

/** What a person did to a PDF's marks, with what it takes to take it back. */
type Step =
  | { kind: "create"; rows: PdfAnnotation[] }
  | { kind: "delete"; rows: PdfAnnotation[] }
  | { kind: "update"; id: number; before: AnnotationChanges; after: AnnotationChanges };

/** How many steps are kept to undo. Marking a textbook takes thousands of steps; going back a few hundred is plenty. */
const HISTORY_LIMIT = 200;

const reason = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
const byPage = (a: PdfAnnotation, b: PdfAnnotation) => a.page - b.page || a.id - b.id;
const KEYS = ["color", "comment", "quote", "rects", "body"] as const;

/** What a mark held, for the fields `changes` names: what to put back to undo that change. */
function before(mark: PdfAnnotation, changes: AnnotationChanges): AnnotationChanges {
  const kept: Record<string, unknown> = {};
  for (const key of KEYS) if (key in changes) kept[key] = mark[key];
  return kept as AnnotationChanges;
}

/**
 * The marks of the PDFs, with undo and redo per PDF for as long as the page is open: a step is a change a person made (a
 * selection marked, a comment written, a mark deleted), and undoing it does the opposite through the backend, so what is
 * on screen is always what is stored. A delete is undone by putting the marks back with their own uuids (a note's citation
 * of a mark names it by uuid). Changes to one PDF run one after another, so a quick double click on Undo does not tangle.
 */
export function createMarksController(deps: MarksDeps, notify: () => void) {
  let marks: Record<number, DocumentMarks> = {};
  const history = new Map<number, { undo: Step[]; redo: Step[] }>();
  const queues = new Map<number, Promise<unknown>>();

  const stacks = (documentId: number) => {
    let found = history.get(documentId);
    if (!found) history.set(documentId, (found = { undo: [], redo: [] }));
    return found;
  };

  function set(documentId: number, next: Partial<DocumentMarks>) {
    const current = marks[documentId] ?? NO_MARKS;
    const { undo, redo } = stacks(documentId);
    marks = { ...marks, [documentId]: { ...current, ...next, undoCount: undo.length, redoCount: redo.length } };
    notify();
  }

  const items = (documentId: number) => (marks[documentId] ?? NO_MARKS).items;
  const withRows = (documentId: number, rows: PdfAnnotation[]) => {
    const ids = new Set(rows.map((r) => r.id));
    return [...items(documentId).filter((m) => !ids.has(m.id)), ...rows].sort(byPage);
  };
  const withoutRows = (documentId: number, rows: PdfAnnotation[]) => {
    const ids = new Set(rows.map((r) => r.id));
    return items(documentId).filter((m) => !ids.has(m.id));
  };

  /** Runs `work` once the PDF's earlier changes have finished. */
  function inOrder<T>(documentId: number, work: () => Promise<T>): Promise<T> {
    const run = (queues.get(documentId) ?? Promise.resolve()).then(work, work);
    queues.set(documentId, run.catch(() => undefined));
    return run;
  }

  function remember(documentId: number, step: Step) {
    const { undo, redo } = stacks(documentId);
    undo.push(step);
    if (undo.length > HISTORY_LIMIT) undo.shift();
    redo.length = 0;
  }

  async function load(documentId: number, force = false): Promise<void> {
    if (!force && marks[documentId] && marks[documentId].status !== "error") return;
    if (!marks[documentId]) set(documentId, { status: "loading", error: null });
    try {
      set(documentId, { status: "ready", items: (await deps.listAnnotations(documentId)).sort(byPage), error: null });
    } catch (error) {
      set(documentId, { status: "error", error: reason(error) });
    }
  }

  /** Makes the marks of one selection. Resolves with them, or with why it could not. */
  function make(documentId: number, inputs: PdfAnnotationInput[]): Promise<{ marks?: PdfAnnotation[]; error?: string }> {
    return inOrder(documentId, async () => {
      try {
        const rows = await deps.addAnnotations(documentId, inputs);
        remember(documentId, { kind: "create", rows });
        set(documentId, { items: withRows(documentId, rows) });
        return { marks: rows };
      } catch (error) {
        return { error: reason(error) };
      }
    });
  }

  /** Changes a mark. Nothing is shown until the backend has kept it. */
  function change(mark: PdfAnnotation, changes: AnnotationChanges): Promise<{ error?: string }> {
    return inOrder(mark.documentId, async () => {
      try {
        const saved = await deps.updateAnnotation(mark.id, changes);
        if (!saved) return { error: "That mark is gone." };
        remember(mark.documentId, { kind: "update", id: mark.id, before: before(mark, changes), after: changes });
        set(mark.documentId, { items: withRows(mark.documentId, [saved]) });
        return {};
      } catch (error) {
        return { error: reason(error) };
      }
    });
  }

  /** Deletes a mark and the other parts of its selection. */
  function remove(mark: PdfAnnotation): Promise<{ error?: string }> {
    return inOrder(mark.documentId, async () => {
      try {
        const rows = await deps.deleteAnnotation(mark.id);
        if (rows.length === 0) return {};
        remember(mark.documentId, { kind: "delete", rows });
        set(mark.documentId, { items: withoutRows(mark.documentId, rows) });
        return {};
      } catch (error) {
        return { error: reason(error) };
      }
    });
  }

  async function apply(documentId: number, step: Step, direction: "undo" | "redo"): Promise<void> {
    const forwards = direction === "redo";
    if (step.kind === "update") {
      const saved = await deps.updateAnnotation(step.id, forwards ? step.after : step.before);
      if (saved) set(documentId, { items: withRows(documentId, [saved]) });
      return;
    }
    // A created selection is undone by deleting it and redone by putting it back; a deleted one the other way round.
    const putBack = (step.kind === "create") === forwards;
    if (putBack) {
      const rows = await deps.restoreAnnotations(documentId, step.rows);
      set(documentId, { items: withRows(documentId, rows) });
    } else {
      const removed = await deps.deleteAnnotation(step.rows[0].id);
      set(documentId, { items: withoutRows(documentId, removed.length > 0 ? removed : step.rows) });
    }
  }

  /** Takes back the last change to a PDF's marks, or does it again after an undo. Resolves with why it could not, if so. */
  function step(documentId: number, direction: "undo" | "redo"): Promise<{ error?: string }> {
    return inOrder(documentId, async () => {
      const { undo, redo } = stacks(documentId);
      const from = direction === "undo" ? undo : redo;
      const to = direction === "undo" ? redo : undo;
      const taken = from.pop();
      if (!taken) return {};
      try {
        await apply(documentId, taken, direction);
        to.push(taken);
        set(documentId, {});
        return {};
      } catch (error) {
        from.push(taken);
        set(documentId, { error: reason(error) });
        return { error: reason(error) };
      }
    });
  }

  return {
    snapshot: () => marks,
    load,
    make,
    change,
    remove,
    undo: (documentId: number) => step(documentId, "undo"),
    redo: (documentId: number) => step(documentId, "redo"),
  };
}

export type MarksController = ReturnType<typeof createMarksController>;
