import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentsApi, ImportPdfResult, PdfDocument } from "@/lib/composition/documentsApi";
import { fakeDocumentsApi } from "@/lib/composition/__fixtures__/documentsApi";
import { createDocumentsStore } from "@/lib/composition/documentsStore";
import * as frontmatter from "@/lib/composition/frontmatter";
import type { PdfPanelState } from "../panels/kinds";
import { panelIds } from "../panels/layoutTree";
import { focusedPanelId } from "../panels/panelsState";
import { registerNoteInserter } from "./noteInsertions";
import type { Note } from "./types";
import { createWorkspaceStore, type WorkspaceDeps, type WorkspaceStore } from "./workspaceStore";

const note = (id: number, over: Partial<Note> = {}): Note => ({
  id,
  title: `Note ${id}`,
  content: "",
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  notebookId: 1,
  ...over,
});
const pdf = (id: number, noteId: number): PdfDocument => ({ id, uuid: String(id).padStart(32, "0"), noteId, fileName: `book${id}.pdf`, size: 10, pageCount: 0, viewState: {}, createdAt: "x" });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(notes: Note[], documents: PdfDocument[], over: Partial<DocumentsApi> = {}, grid = true) {
  const api = fakeDocumentsApi({ listDocuments: vi.fn(async () => documents), ...over });
  const store = createWorkspaceStore({ notes, groups: [] }, { deleteNote: vi.fn(async () => {}) } as unknown as WorkspaceDeps, undefined, {
    documents: createDocumentsStore(api),
    ...(grid ? { panels: {} } : {}),
  });
  return { store, api };
}

const kinds = (store: WorkspaceStore) => panelIds(store.getSnapshot().panels.windows.main.layout).map((id) => store.getSnapshot().panels.byId[id].kind);
const focusedKind = (store: WorkspaceStore) => store.getSnapshot().panels.byId[focusedPanelId(store.getSnapshot().panels.windows.main)].kind;

describe("opening a note that owns a PDF", () => {
  it("opens the PDF beside it, which is focused", async () => {
    const { store } = setup([note(1), note(2)], [pdf(10, 2)]);
    await store.documents.load();

    store.openNote(2);

    expect(kinds(store)).toEqual(["pdf", "note"]);
    expect(focusedKind(store)).toBe("pdf");
  });

  it("opens an ordinary note on its own, as it always did", async () => {
    const { store } = setup([note(1), note(2)], [pdf(10, 2)]);
    await store.documents.load();

    store.openNote(1);

    expect(kinds(store)).toEqual(["note"]);
  });

  it("opens a note on its own until the PDFs have been read, which the sidebar waits for", () => {
    const { store } = setup([note(2)], [pdf(10, 2)]);

    store.openNote(2);

    expect(kinds(store)).toEqual(["note"]);
  });

  it("does not open a PDF in the web app's row of panes, which has no panels", async () => {
    const { store } = setup([note(1), note(2)], [pdf(10, 2)], {}, false);
    await store.documents.load();

    expect(() => store.openNote(2)).not.toThrow();
    expect(store.getSnapshot().panes.panes.some((p) => p.noteId === 2)).toBe(false);
  });
});

describe("importing a PDF", () => {
  const target = { groupId: null, notebookId: 1 };

  it("puts the note it made first in the list and opens it with its PDF", async () => {
    const made = note(5, { title: "Designing Data" });
    const result: ImportPdfResult = { note: made as never, document: pdf(50, 5) };
    const { store, api } = setup([note(1)], [], { importPdf: vi.fn(async () => result) });

    const answer = await store.importPdf(target);

    expect(api.importPdf).toHaveBeenCalledWith(target);
    expect(answer).toBe(result);
    expect(store.getSnapshot().notes.map((n) => n.id)).toEqual([5, 1]);
    expect(kinds(store)).toEqual(["pdf", "note"]);
    expect(store.documents.forNote(5)?.id).toBe(50);
  });

  it("leaves everything as it was when the picker is cancelled, the file is refused or it is a duplicate", async () => {
    for (const result of [{ canceled: true }, { error: "x.txt: this doesn't look like a PDF." }, { duplicate: { token: "t", fileName: "a.pdf", existing: [] } }] as ImportPdfResult[]) {
      const { store } = setup([note(1)], [], { importPdf: vi.fn(async () => result) });
      const before = store.getSnapshot();

      expect(await store.importPdf(target)).toBe(result);

      expect(store.getSnapshot().notes).toBe(before.notes);
      expect(store.getSnapshot().panels).toBe(before.panels);
    }
  });

  it("imports a duplicate as a separate copy and opens that", async () => {
    const result: ImportPdfResult = { note: note(6) as never, document: pdf(60, 6) };
    const { store, api } = setup([note(1)], [], { importPdfCopy: vi.fn(async () => result) });

    await store.importPdfCopy({ token: "tok", fileName: "a.pdf", existing: [], target });

    expect(api.importPdfCopy).toHaveBeenCalledWith("tok", target);
    expect(store.getSnapshot().notes.map((n) => n.id)).toEqual([6, 1]);
    expect(kinds(store)).toEqual(["pdf", "note"]);
  });

  it("has nothing to import with in a workspace that has no PDFs, and says so", async () => {
    const store = createWorkspaceStore({ notes: [], groups: [] }, {} as WorkspaceDeps);

    expect(store.documents.available).toBe(false);
    expect(await store.importPdf(target)).toEqual({ error: "PDFs are only available in the desktop app." });
  });
});

describe("following a pdf: link", () => {
  const book = pdf(10, 2);
  const mark = "m".repeat(32);
  const pdfPanel = (store: WorkspaceStore) => {
    const { panels } = store.getSnapshot();
    const id = panelIds(panels.windows.main.layout).find((panelId) => panels.byId[panelId].kind === "pdf");
    return id === undefined ? undefined : { id, state: panels.byId[id].state as PdfPanelState };
  };
  const notePanelOf = (store: WorkspaceStore, noteId: number) => {
    const { panels } = store.getSnapshot();
    return panelIds(panels.windows.main.layout).find((id) => panels.byId[id].kind === "note" && (panels.byId[id].state as { noteId: number }).noteId === noteId)!;
  };

  async function open() {
    const made = setup([note(1), note(2)], [book]);
    await made.store.documents.load();
    made.store.openNote(1);
    return { ...made, from: notePanelOf(made.store, 1) };
  }

  it("opens the PDF beside the note the link is in, paired with it, asking it for the page and the mark", async () => {
    const { store, from } = await open();

    store.openLinkedPdf({ uuid: book.uuid, page: 44, mark }, from);

    expect(kinds(store)).toEqual(["pdf", "note"]);
    expect(pdfPanel(store)?.state).toEqual({ documentId: 10, noteId: 1, follow: false, goTo: { page: 44, mark, seq: 1 } });
    expect(notePanelOf(store, 1)).toBe(from);
  });

  it("makes each followed link a new ask of the PDF panel the window already shows, and does not open a second", async () => {
    const { store, from } = await open();

    store.openLinkedPdf({ uuid: book.uuid, page: 4, mark: null }, from);
    store.openLinkedPdf({ uuid: book.uuid, page: 4, mark: null }, from);

    expect(kinds(store)).toEqual(["pdf", "note"]);
    expect(pdfPanel(store)?.state.goTo?.seq).toBe(2);
  });

  it("only opens the PDF for a link to the whole of it", async () => {
    const { store, from } = await open();

    store.openLinkedPdf({ uuid: book.uuid, page: null, mark: null }, from);

    expect(pdfPanel(store)?.state.goTo).toBeUndefined();
  });

  it("does nothing for a PDF that is not here, or whose note is in the Trash Can", async () => {
    const { store, from } = await open();
    const before = store.getSnapshot().panels;

    store.openLinkedPdf({ uuid: "f".repeat(32), page: 4, mark: null }, from);
    expect(store.getSnapshot().panels).toBe(before);

    store.removeNote(2);
    store.openLinkedPdf({ uuid: book.uuid, page: 4, mark: null }, from);
    expect(pdfPanel(store)).toBeUndefined();
  });

  it("drops the ask once it is answered, but only that one", async () => {
    const { store, from } = await open();
    store.openLinkedPdf({ uuid: book.uuid, page: 4, mark: null }, from);
    store.openLinkedPdf({ uuid: book.uuid, page: 9, mark: null }, from);
    const panel = pdfPanel(store)!;

    store.clearPdfGoTo(panel.id, 1);
    expect(pdfPanel(store)?.state.goTo?.page).toBe(9);
    store.clearPdfGoTo(panel.id, 2);
    expect(pdfPanel(store)?.state.goTo).toBeUndefined();
  });

  it("switches the PDF between staying with its note and following the note in use", async () => {
    const { store, from } = await open();
    store.openLinkedPdf({ uuid: book.uuid, page: 4, mark: null }, from);
    const panel = pdfPanel(store)!;

    store.setPdfFollow(panel.id, true);
    expect(pdfPanel(store)?.state).toMatchObject({ noteId: null, follow: true });
    store.setPdfFollow(panel.id, false);
    expect(pdfPanel(store)?.state).toMatchObject({ noteId: 1, follow: false });
  });

  it("shows a note in the PDF's paired note panel and pins the PDF to it", async () => {
    const { store, from } = await open();
    store.openLinkedPdf({ uuid: book.uuid, page: 4, mark: null }, from);
    const panel = pdfPanel(store)!;

    store.openNoteForPdf(panel.id, 2);

    expect(notePanelOf(store, 2)).toBe(from);
    expect(pdfPanel(store)?.state).toMatchObject({ noteId: 2, follow: false });
    store.openNoteForPdf(panel.id, 99);
    expect(pdfPanel(store)?.state).toMatchObject({ noteId: 2 });
  });
});

describe("a new note for a PDF", () => {
  const book = pdf(10, 2);

  function setupWithDeps() {
    const created = vi.fn(async (title: string, groupId: number | null, notebookId: number | null) =>
      note(9, { title, groupId, notebookId: notebookId ?? 1, content: frontmatter.generate(title, { createdAt: "x", updatedAt: "x" }) }),
    );
    const saved = vi.fn(async (id: number, content: string) => note(id, { title: "Notes on Textbook", groupId: 4, notebookId: 3, content }));
    const store = createWorkspaceStore({ notes: [note(2, { title: "Textbook", groupId: 4, notebookId: 3 })], groups: [] }, { createNote: created, saveNoteContent: saved } as unknown as WorkspaceDeps, undefined, {
      documents: createDocumentsStore(fakeDocumentsApi({ listDocuments: vi.fn(async () => [book]) })),
      panels: {},
    });
    return { store, created, saved };
  }

  it("is made in the group of the PDF's own note, its first line a link to the PDF, and shown beside the PDF, which is pinned to it", async () => {
    const { store, created, saved } = setupWithDeps();
    await store.documents.load();
    store.openNote(2);
    const pdfPanelId = panelIds(store.getSnapshot().panels.windows.main.layout)[0];

    const made = await store.newNoteForPdf(10, pdfPanelId);

    expect(created).toHaveBeenCalledWith("Notes on Textbook", 4, 3);
    const content = saved.mock.calls[0][1];
    expect(frontmatter.parse(content)[1]).toBe(`[Textbook](pdf:${book.uuid})\n\n`);
    expect(made?.id).toBe(9);
    expect(store.getSnapshot().notes.map((n) => n.id)).toEqual([9, 2]);
    const { panels } = store.getSnapshot();
    expect(panels.byId[pdfPanelId].state).toMatchObject({ noteId: 9, follow: false });
    expect(panelIds(panels.windows.main.layout).map((id) => panels.byId[id].kind)).toEqual(["pdf", "note"]);
  });

  it("is nothing for a PDF that is not here", async () => {
    const { store, created } = setupWithDeps();
    await store.documents.load();

    expect(await store.newNoteForPdf(99, "p1")).toBeNull();
    expect(created).not.toHaveBeenCalled();
  });
});

describe("putting Markdown into a note", () => {
  it("hands it to the editor that has the note open", () => {
    const { store } = setup([note(1)], []);
    const inserter = vi.fn();
    const unregister = registerNoteInserter(1, inserter);

    expect(store.insertIntoNote(1, "> q", "block")).toBe(true);

    expect(inserter).toHaveBeenCalledWith("> q", "block");
    unregister();
  });

  it("adds it to the end of a note that is not open, to be saved like any edit", () => {
    const { store } = setup([note(1, { content: "text" })], []);

    expect(store.insertIntoNote(1, "[x](pdf:y)", "inline")).toBe(true);

    expect(store.getSnapshot().notes[0].content).toBe("text\n\n[x](pdf:y)\n");
  });

  it("says no for a note that is not there, such as one in the Trash Can", () => {
    const { store } = setup([note(1)], []);
    store.removeNote(1);

    expect(store.insertIntoNote(1, "x", "block")).toBe(false);
    expect(store.insertIntoNote(99, "x", "block")).toBe(false);
  });
});
