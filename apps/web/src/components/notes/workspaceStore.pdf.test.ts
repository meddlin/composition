import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentsApi, ImportPdfResult, PdfDocument } from "@/lib/composition/documentsApi";
import { fakeDocumentsApi } from "@/lib/composition/__fixtures__/documentsApi";
import { createDocumentsStore } from "@/lib/composition/documentsStore";
import { panelIds } from "../panels/layoutTree";
import { focusedPanelId } from "../panels/panelsState";
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
  const store = createWorkspaceStore({ notes, groups: [] }, {} as WorkspaceDeps, undefined, {
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
