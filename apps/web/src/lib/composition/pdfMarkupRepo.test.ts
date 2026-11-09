import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-pdfmarks-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const UUID = /^[0-9a-f]{32}$/;
/** Matched by name: the modules are loaded afresh for every test (vi.resetModules), so the class itself is not the same one. */
const INVALID = expect.objectContaining({ name: "InvalidMarkError" });

/** A note that owns a PDF of `pageCount` pages (0: not counted yet). */
async function setup(pageCount = 10) {
  const notes = await import("./notesRepo");
  const documents = await import("./documentsRepo");
  const marks = await import("./pdfMarkupRepo");
  const note = notes.createNote("Textbook", "");
  const document = documents.addDocument({ noteId: note.id, fileName: "book.pdf", storedName: "abc-book.pdf", sha256: "a".repeat(64), size: 10, pageCount });
  return { notes, documents, marks, note, document };
}

const highlight = (page = 0, extra: Record<string, unknown> = {}) =>
  ({ page, kind: "highlight", color: "yellow", rects: [[10, 10, 100, 30]], quote: "a line", ...extra }) as const;

describe("a PDF row", () => {
  it("is found by id, by uuid, by its note and by its hash", async () => {
    const { documents, note, document } = await setup();

    expect(document.uuid).toMatch(UUID);
    expect(documents.getDocument(document.id)).toEqual(document);
    expect(documents.getDocumentByUuid(document.uuid)).toEqual(document);
    expect(documents.getDocumentForNote(note.id)).toEqual(document);
    expect(documents.findDocumentsBySha256("a".repeat(64))).toEqual([document]);
    expect(documents.getDocument(9999)).toBeNull();
    expect(documents.getDocumentByUuid("0".repeat(32))).toBeNull();
    expect(documents.getDocumentForNote(9999)).toBeNull();
    expect(documents.findDocumentsBySha256("b".repeat(64))).toEqual([]);
  });

  it("is given only to a live note, and to a note that has none", async () => {
    const { documents, note } = await setup();
    const input = { fileName: "x.pdf", storedName: "x", sha256: "c".repeat(64), size: 1, pageCount: 1 };

    expect(() => documents.addDocument({ noteId: note.id, ...input })).toThrow(documents.DocumentOwnerError);
    expect(() => documents.addDocument({ noteId: 9999, ...input })).toThrow("That note no longer exists.");
    expect(() => documents.addDocument({ noteId: note.id, ...input })).toThrow("That note already has a PDF.");
  });

  it("remembers where the reader was, keeping what it knows and dropping the rest", async () => {
    const { documents, document } = await setup();

    documents.setViewState(document.id, { page: 4, zoom: 1.5, darkPages: true, scrollTop: 10 } as never);
    expect(documents.getDocument(document.id)?.viewState).toEqual({ page: 4, zoom: 1.5, darkPages: true });

    documents.setViewState(document.id, { page: -3 });
    expect(documents.getDocument(document.id)?.viewState).toEqual({});
  });
});

describe("marks", () => {
  it("are stored with a uuid and both times, and read back as they went in", async () => {
    const { marks, document } = await setup();

    const mark = marks.addAnnotation(document.id, highlight(2, { comment: "check this" }));

    expect(mark).toEqual({
      id: expect.any(Number),
      uuid: expect.stringMatching(UUID),
      documentId: document.id,
      page: 2,
      kind: "highlight",
      color: "yellow",
      rects: [[10, 10, 100, 30]],
      quote: "a line",
      comment: "check this",
      body: null,
      groupUuid: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(mark.createdAt).toBe(mark.updatedAt);
    expect(marks.getAnnotation(mark.id)).toEqual(mark);
    expect(marks.getAnnotationByUuid(mark.uuid)).toEqual(mark);
  });

  it("keep a text note's box and text, and ink's strokes, as JSON", async () => {
    const { marks, document } = await setup();
    const note = marks.addAnnotation(document.id, { page: 0, kind: "text", color: "orange", body: { rect: [200, 100, 400, 160], text: "Spike note", fontSize: 12 } });
    const ink = marks.addAnnotation(document.id, { page: 0, kind: "ink", color: "black", body: { strokes: [[[1, 2], [3, 4]]] } });

    expect(marks.getAnnotation(note.id)).toEqual(expect.objectContaining({ rects: null, body: { rect: [200, 100, 400, 160], text: "Spike note", fontSize: 12 } }));
    expect(marks.getAnnotation(ink.id)).toEqual(expect.objectContaining({ rects: null, body: { strokes: [[[1, 2], [3, 4]]] } }));
  });

  it("are listed for the whole PDF in page order, or for one page in the order they were made", async () => {
    const { marks, document } = await setup();
    const a = marks.addAnnotation(document.id, highlight(5));
    const b = marks.addAnnotation(document.id, highlight(1));
    const c = marks.addAnnotation(document.id, highlight(5));

    expect(marks.listAnnotations(document.id).map((m) => m.id)).toEqual([b.id, a.id, c.id]);
    expect(marks.listAnnotations(document.id, 5).map((m) => m.id)).toEqual([a.id, c.id]);
    expect(marks.listAnnotations(document.id, 9)).toEqual([]);
  });

  it("must be on a page the PDF has, once its pages are counted", async () => {
    const { marks, document } = await setup(3);

    expect(() => marks.addAnnotation(document.id, highlight(3))).toThrow("This PDF has 3 pages; page 3 is past the end.");
    expect(marks.addAnnotation(document.id, highlight(2)).page).toBe(2);
    expect(() => marks.addAnnotation(9999, highlight(0))).toThrow("That PDF no longer exists.");
  });

  it("may be on any page of a PDF whose pages have not been counted", async () => {
    const { marks, document } = await setup(0);

    expect(marks.addAnnotation(document.id, highlight(800)).page).toBe(800);
  });

  it("refuse what is invalid, and store nothing", async () => {
    const { marks, document } = await setup();

    expect(() => marks.addAnnotation(document.id, { ...highlight(0), color: "red" })).toThrow(INVALID);
    expect(() => marks.addAnnotation(document.id, { ...highlight(0), rects: [] })).toThrow(INVALID);
    expect(marks.listAnnotations(document.id)).toEqual([]);
  });

  describe("that a selection crossed pages with", () => {
    it("are one record per page, joined by one group uuid", async () => {
      const { marks, document } = await setup();

      const parts = marks.addAnnotationGroup(document.id, [highlight(3), highlight(4, { rects: [[0, 0, 5, 5]], quote: "next page" })]);

      expect(parts.map((p) => p.page)).toEqual([3, 4]);
      expect(parts[0].groupUuid).toMatch(UUID);
      expect(parts[1].groupUuid).toBe(parts[0].groupUuid);
      expect(parts[0].uuid).not.toBe(parts[1].uuid);
    });

    it("are an ordinary mark, with no group, when it is only one", async () => {
      const { marks, document } = await setup();

      const [only] = marks.addAnnotationGroup(document.id, [highlight(3)]);

      expect(only.groupUuid).toBeNull();
      expect(marks.addAnnotationGroup(document.id, [])).toEqual([]);
    });

    it("are all stored or none: a bad part stores nothing", async () => {
      const { marks, document } = await setup(5);

      expect(() => marks.addAnnotationGroup(document.id, [highlight(4), highlight(5)])).toThrow("past the end");
      expect(() => marks.addAnnotationGroup(document.id, [highlight(1), { ...highlight(2), color: "red" }])).toThrow(INVALID);
      expect(marks.listAnnotations(document.id)).toEqual([]);
    });

    it("are deleted together, because the reader shows one highlight", async () => {
      const { marks, document } = await setup();
      const parts = marks.addAnnotationGroup(document.id, [highlight(3), highlight(4)]);
      const alone = marks.addAnnotation(document.id, highlight(3));

      const removed = marks.deleteAnnotation(parts[1].id);

      expect(removed.map((m) => m.id)).toEqual(parts.map((m) => m.id));
      expect(marks.listAnnotations(document.id).map((m) => m.id)).toEqual([alone.id]);
    });
  });

  describe("when changed", () => {
    it("take the new color, comment, quote or rectangles, and a later updated time", async () => {
      const { marks, document } = await setup();
      const mark = marks.addAnnotation(document.id, highlight(1));
      const { getDb } = await import("./db");
      getDb().prepare("UPDATE pdf_annotations SET created_at = '2000-01-01T00:00:00.000Z', updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(mark.id);

      const changed = marks.updateAnnotation(mark.id, { color: "pink", comment: "line one\nline two", quote: "new quote", rects: [[1, 2, 3, 4]] });

      expect(changed).toEqual(
        expect.objectContaining({ id: mark.id, uuid: mark.uuid, page: 1, kind: "highlight", color: "pink", comment: "line one line two", quote: "new quote", rects: [[1, 2, 3, 4]], createdAt: "2000-01-01T00:00:00.000Z" }),
      );
      expect(changed!.updatedAt > "2000-01-01T00:00:00.000Z").toBe(true);
    });

    it("keep what the changes do not name", async () => {
      const { marks, document } = await setup();
      const mark = marks.addAnnotation(document.id, highlight(1, { comment: "keep me" }));

      const changed = marks.updateAnnotation(mark.id, { color: "blue" });

      expect(changed).toEqual(expect.objectContaining({ color: "blue", comment: "keep me", quote: "a line", rects: [[10, 10, 100, 30]] }));
    });

    it("can clear a comment, and move a text note", async () => {
      const { marks, document } = await setup();
      const mark = marks.addAnnotation(document.id, highlight(1, { comment: "x" }));
      const text = marks.addAnnotation(document.id, { page: 0, kind: "text", color: "yellow", body: { rect: [0, 0, 10, 10], text: "hi" } });

      expect(marks.updateAnnotation(mark.id, { comment: "" })?.comment).toBe("");
      expect(marks.updateAnnotation(text.id, { body: { rect: [20, 20, 30, 30], text: "hello" } })?.body).toEqual({ rect: [20, 20, 30, 30], text: "hello" });
    });

    it("are refused when the result is invalid, and the mark stays as it was", async () => {
      const { marks, document } = await setup();
      const mark = marks.addAnnotation(document.id, highlight(1));

      expect(() => marks.updateAnnotation(mark.id, { color: "red" })).toThrow(INVALID);
      expect(() => marks.updateAnnotation(mark.id, { rects: null })).toThrow(INVALID);
      expect(() => marks.updateAnnotation(mark.id, { body: { text: "x" } })).toThrow(INVALID);
      expect(marks.getAnnotation(mark.id)).toEqual(mark);
    });

    it("answer null for a mark that is gone", async () => {
      const { marks } = await setup();

      expect(marks.updateAnnotation(9999, { color: "blue" })).toBeNull();
    });
  });

  it("are deleted one at a time, and a second delete finds nothing", async () => {
    const { marks, document } = await setup();
    const a = marks.addAnnotation(document.id, highlight(1));
    const b = marks.addAnnotation(document.id, highlight(1));

    expect(marks.deleteAnnotation(a.id).map((m) => m.id)).toEqual([a.id]);
    expect(marks.deleteAnnotation(a.id)).toEqual([]);
    expect(marks.listAnnotations(document.id).map((m) => m.id)).toEqual([b.id]);
  });
});

describe("putting deleted marks back", () => {
  it("restores a mark exactly as it was: its uuid, id, times and every field", async () => {
    const { marks, document } = await setup();
    const original = marks.addAnnotation(document.id, highlight(2, { comment: "check this" }));
    marks.deleteAnnotation(original.id);

    const [restored] = marks.restoreAnnotations(document.id, [original]);

    expect(restored).toEqual(original);
    expect(marks.getAnnotationByUuid(original.uuid)).toEqual(original);
    expect(marks.listAnnotations(document.id)).toEqual([original]);
  });

  it("restores a whole selection that crossed pages, still tied together", async () => {
    const { marks, document } = await setup();
    const parts = marks.addAnnotationGroup(document.id, [highlight(3), highlight(4)]);
    const removed = marks.deleteAnnotation(parts[0].id);

    const restored = marks.restoreAnnotations(document.id, removed);

    expect(restored).toEqual(parts);
    expect(new Set(restored.map((r) => r.groupUuid)).size).toBe(1);
  });

  it("does no harm when asked twice, as a redo after an undo may", async () => {
    const { marks, document } = await setup();
    const original = marks.addAnnotation(document.id, highlight(1));
    marks.deleteAnnotation(original.id);

    marks.restoreAnnotations(document.id, [original]);
    marks.restoreAnnotations(document.id, [original]);

    expect(marks.listAnnotations(document.id)).toEqual([original]);
  });

  it("takes a new id when the old one is in use, and keeps the uuid", async () => {
    const { marks, document } = await setup();
    const original = marks.addAnnotation(document.id, highlight(1));
    marks.deleteAnnotation(original.id);
    const { getDb } = await import("./db");
    getDb().prepare("INSERT INTO pdf_annotations (id, document_id, page, kind, color, created_at, updated_at) VALUES (?, ?, 0, 'ink', 'black', 'x', 'x')").run(original.id, document.id);

    const [restored] = marks.restoreAnnotations(document.id, [original]);

    expect(restored.id).not.toBe(original.id);
    expect(restored.uuid).toBe(original.uuid);
  });

  it("refuses a mark that is invalid or has no uuid, and restores none of the others", async () => {
    const { marks, document } = await setup(3);
    const good = marks.addAnnotation(document.id, highlight(1));
    marks.deleteAnnotation(good.id);

    expect(() => marks.restoreAnnotations(document.id, [good, { ...good, uuid: "nope" }])).toThrow(INVALID);
    expect(() => marks.restoreAnnotations(document.id, [good, { ...good, id: 77, uuid: "b".repeat(32), color: "red" }])).toThrow(INVALID);
    expect(() => marks.restoreAnnotations(document.id, [{ ...good, createdAt: "" }])).toThrow(INVALID);
    expect(() => marks.restoreAnnotations(document.id, [{ ...good, page: 9 }])).toThrow("past the end");
    expect(marks.listAnnotations(document.id)).toEqual([]);
  });
});

describe("bookmarks", () => {
  it("have a page, a label and a uuid, and are listed in page order", async () => {
    const { marks, document } = await setup();
    const late = marks.addBookmark(document.id, 7, "Chapter 7");
    const early = marks.addBookmark(document.id, 1);

    expect(late).toEqual({ id: expect.any(Number), uuid: expect.stringMatching(UUID), documentId: document.id, page: 7, label: "Chapter 7", createdAt: expect.any(String) });
    expect(early.label).toBe("");
    expect(marks.listBookmarks(document.id).map((b) => b.id)).toEqual([early.id, late.id]);
    expect(marks.getBookmark(late.id)).toEqual(late);
    expect(marks.getBookmark(9999)).toBeNull();
  });

  it("may be two on one page", async () => {
    const { marks, document } = await setup();

    marks.addBookmark(document.id, 2, "first");
    marks.addBookmark(document.id, 2, "second");

    expect(marks.listBookmarks(document.id).map((b) => b.label)).toEqual(["first", "second"]);
  });

  it("must be on a page the PDF has, with a label that is one short line", async () => {
    const { marks, document } = await setup(3);

    expect(() => marks.addBookmark(document.id, 3)).toThrow("past the end");
    expect(() => marks.addBookmark(document.id, -1)).toThrow(INVALID);
    expect(() => marks.addBookmark(document.id, 1.5)).toThrow(INVALID);
    expect(() => marks.addBookmark(document.id, 0, "x".repeat(201))).toThrow(INVALID);
    expect(marks.addBookmark(document.id, 0, "  two\n lines ").label).toBe("two lines");
    expect(marks.listBookmarks(document.id)).toHaveLength(1);
  });

  it("are renamed and deleted", async () => {
    const { marks, document } = await setup();
    const bookmark = marks.addBookmark(document.id, 2, "old");

    expect(marks.renameBookmark(bookmark.id, "new")?.label).toBe("new");
    expect(marks.renameBookmark(9999, "x")).toBeNull();
    expect(() => marks.renameBookmark(bookmark.id, "y".repeat(201))).toThrow(INVALID);

    marks.deleteBookmark(bookmark.id);
    expect(marks.listBookmarks(document.id)).toEqual([]);
  });
});
