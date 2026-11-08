import { describe, expect, it, vi } from "vitest";
import { createMarksController, type MarksDeps } from "./documentMarks";
import type { PdfAnnotation } from "./documentsApi";
import type { AnnotationChanges, PdfAnnotationInput } from "./pdfMarkup";

/** A backend that keeps marks in memory and behaves as the real one does: ids and uuids it makes, a selection deleted whole. */
function memoryBackend(initial: PdfAnnotation[] = []) {
  let rows = [...initial];
  let nextId = Math.max(0, ...initial.map((r) => r.id)) + 1;
  const make = (documentId: number, input: PdfAnnotationInput, groupUuid: string | null): PdfAnnotation => ({
    id: nextId++,
    uuid: String(nextId).padStart(32, "a"),
    documentId,
    page: input.page,
    kind: input.kind,
    color: input.color,
    rects: (input.rects as PdfAnnotation["rects"]) ?? null,
    quote: input.quote ?? "",
    comment: input.comment ?? "",
    body: input.body ?? null,
    groupUuid,
    createdAt: "t0",
    updatedAt: "t0",
  });
  const deps = {
    listAnnotations: vi.fn(async (documentId: number) => rows.filter((r) => r.documentId === documentId)),
    addAnnotations: vi.fn(async (documentId: number, inputs: PdfAnnotationInput[]) => {
      const group = inputs.length > 1 ? "g".repeat(32) : null;
      const made = inputs.map((input) => make(documentId, input, group));
      rows.push(...made);
      return made;
    }),
    updateAnnotation: vi.fn(async (id: number, changes: AnnotationChanges) => {
      const found = rows.find((r) => r.id === id);
      if (!found) return null;
      const next = { ...found, ...changes, updatedAt: "t1" } as PdfAnnotation;
      rows = rows.map((r) => (r.id === id ? next : r));
      return next;
    }),
    deleteAnnotation: vi.fn(async (id: number) => {
      const found = rows.find((r) => r.id === id);
      if (!found) return [];
      const gone = found.groupUuid ? rows.filter((r) => r.groupUuid === found.groupUuid) : [found];
      rows = rows.filter((r) => !gone.includes(r));
      return gone;
    }),
    restoreAnnotations: vi.fn(async (_documentId: number, back: PdfAnnotation[]) => {
      for (const row of back) if (!rows.some((r) => r.uuid === row.uuid)) rows.push(row);
      return back;
    }),
  } satisfies MarksDeps;
  return { deps, rows: () => rows };
}

const input = (page: number, extra: Partial<PdfAnnotationInput> = {}): PdfAnnotationInput => ({ page, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]], quote: `q${page}`, ...extra });

function setup(initial: PdfAnnotation[] = []) {
  const backend = memoryBackend(initial);
  const notify = vi.fn();
  const controller = createMarksController(backend.deps, notify);
  const view = (documentId = 1) => controller.snapshot()[documentId];
  return { ...backend, controller, notify, view };
}

describe("loading", () => {
  it("reads a PDF's marks once, in page order, and says so while it reads and when it fails", async () => {
    const { controller, view, deps } = setup();
    await controller.make(1, [input(5)]);
    await controller.make(1, [input(2)]);
    controller.load(2);
    expect(view(2).status).toBe("loading");
    await controller.load(2);
    await controller.load(2);

    expect(deps.listAnnotations).toHaveBeenCalledTimes(1);
    expect(view(2).status).toBe("ready");

    await controller.load(1, true);
    expect(view(1).items.map((m) => m.page)).toEqual([2, 5]);
  });

  it("reports a failure to read, and tries again on the next ask", async () => {
    const { controller, view, deps } = setup();
    deps.listAnnotations.mockRejectedValueOnce(new Error("disk"));

    await controller.load(1);
    expect(view().status).toBe("error");
    expect(view().error).toBe("disk");

    await controller.load(1);
    expect(view().status).toBe("ready");
  });
});

describe("making marks", () => {
  it("shows the marks the backend made, one per page, and lets them be undone", async () => {
    const { controller, view } = setup();

    const result = await controller.make(1, [input(3), input(4)]);

    expect(result.marks).toHaveLength(2);
    expect(view().items.map((m) => m.page)).toEqual([3, 4]);
    expect(view()).toMatchObject({ undoCount: 1, redoCount: 0 });
  });

  it("says why it could not, and changes nothing", async () => {
    const { controller, view, deps } = setup();
    deps.addAnnotations.mockRejectedValueOnce(new Error("A highlight needs at least one rectangle."));

    expect(await controller.make(1, [input(3)])).toEqual({ error: "A highlight needs at least one rectangle." });
    expect(view()).toBeUndefined();
  });

  it("undoes a selection that crossed pages as one step, and redoes it with the same uuids", async () => {
    const { controller, view, rows } = setup();
    const { marks } = await controller.make(1, [input(3), input(4)]);

    await controller.undo(1);
    expect(view().items).toEqual([]);
    expect(rows()).toEqual([]);
    expect(view()).toMatchObject({ undoCount: 0, redoCount: 1 });

    await controller.redo(1);
    expect(view().items.map((m) => m.uuid)).toEqual(marks!.map((m) => m.uuid));
    expect(view()).toMatchObject({ undoCount: 1, redoCount: 0 });
  });
});

describe("changing a mark", () => {
  const start = async () => {
    const context = setup();
    const { marks } = await context.controller.make(1, [input(1, { comment: "first" })]);
    return { ...context, mark: marks![0] };
  };

  it("shows the change once it is kept, and undoes it to what was there before", async () => {
    const { controller, view, mark } = await start();

    expect(await controller.change(mark, { color: "pink", comment: "second" })).toEqual({});
    expect(view().items[0]).toMatchObject({ color: "pink", comment: "second" });

    await controller.undo(1);
    expect(view().items[0]).toMatchObject({ color: "yellow", comment: "first" });
    await controller.redo(1);
    expect(view().items[0]).toMatchObject({ color: "pink", comment: "second" });
  });

  it("puts back only the fields that were changed", async () => {
    const { controller, view, mark } = await start();
    await controller.change(mark, { color: "blue" });
    await controller.change(view().items[0], { comment: "later" });

    await controller.undo(1);

    expect(view().items[0]).toMatchObject({ color: "blue", comment: "first" });
  });

  it("says why it could not, and for a mark that is gone", async () => {
    const { controller, view, mark, deps } = await start();
    deps.updateAnnotation.mockRejectedValueOnce(new Error("A comment can be at most 500 characters."));

    expect(await controller.change(mark, { comment: "x" })).toEqual({ error: "A comment can be at most 500 characters." });
    expect(await controller.change({ ...mark, id: 999 }, { color: "pink" })).toEqual({ error: "That mark is gone." });
    expect(view().items[0].comment).toBe("first");
    expect(view().undoCount).toBe(1);
  });
});

describe("deleting a mark", () => {
  it("removes the whole selection, and undoing puts it back as it was", async () => {
    const { controller, view } = setup();
    const { marks } = await controller.make(1, [input(1), input(2)]);

    await controller.remove(marks![0]);
    expect(view().items).toEqual([]);

    await controller.undo(1);
    expect(view().items).toEqual(marks);
    await controller.redo(1);
    expect(view().items).toEqual([]);
  });

  it("does nothing, and remembers nothing, for a mark already gone", async () => {
    const { controller, view } = setup();
    const { marks } = await controller.make(1, [input(1)]);
    await controller.remove(marks![0]);

    expect(await controller.remove(marks![0])).toEqual({});
    expect(view().undoCount).toBe(2);
  });
});

describe("history", () => {
  it("starts again after a new change: what was undone can no longer be redone", async () => {
    const { controller, view } = setup();
    await controller.make(1, [input(1)]);
    await controller.undo(1);
    expect(view().redoCount).toBe(1);

    await controller.make(1, [input(2)]);

    expect(view().redoCount).toBe(0);
    await controller.redo(1);
    expect(view().items.map((m) => m.page)).toEqual([2]);
  });

  it("keeps each PDF's own", async () => {
    const { controller, view } = setup();
    await controller.make(1, [input(1)]);
    await controller.make(2, [input(1)]);

    await controller.undo(1);

    expect(view(1).items).toEqual([]);
    expect(view(2).items).toHaveLength(1);
    expect(view(2).undoCount).toBe(1);
  });

  it("does nothing when there is nothing to undo or redo", async () => {
    const { controller, deps } = setup();

    expect(await controller.undo(1)).toEqual({});
    expect(await controller.redo(1)).toEqual({});
    expect(deps.deleteAnnotation).not.toHaveBeenCalled();
  });

  it("keeps the last 200 steps", async () => {
    const { controller, view } = setup();
    for (let i = 0; i < 205; i++) await controller.make(1, [input(i)]);

    expect(view().undoCount).toBe(200);
  });

  it("keeps the step, and says why, when undoing fails", async () => {
    const { controller, view, deps } = setup();
    await controller.make(1, [input(1)]);
    deps.deleteAnnotation.mockRejectedValueOnce(new Error("disk"));

    expect(await controller.undo(1)).toEqual({ error: "disk" });
    expect(view()).toMatchObject({ undoCount: 1, redoCount: 0, error: "disk" });
    expect(view().items).toHaveLength(1);

    expect(await controller.undo(1)).toEqual({});
    expect(view().items).toEqual([]);
  });

  it("runs the changes to a PDF one after another, even when they are asked for together", async () => {
    const { controller, view } = setup();
    await controller.make(1, [input(1)]);

    await Promise.all([controller.undo(1), controller.redo(1), controller.undo(1)]);

    expect(view().items).toEqual([]);
    expect(view()).toMatchObject({ undoCount: 0, redoCount: 1 });
  });
});

it("tells the store each time something changes", async () => {
  const { controller, notify } = setup();

  await controller.make(1, [input(1)]);

  expect(notify).toHaveBeenCalled();
});
