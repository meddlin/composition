// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentsApi, PdfDocument } from "@/lib/composition/documentsApi";
import { createDocumentsStore } from "@/lib/composition/documentsStore";
import { createWorkspaceStore, type WorkspaceDeps } from "../notes/workspaceStore";
import type { Note } from "../notes/types";
import type { PdfPanelState } from "./kinds";
import type { PdfPairing } from "../pdf/PdfReader";
import { PanelGrid, type PanelHost } from "./PanelGrid";

// pdf.js needs a real browser; what the panel does around the reader is what is under test.
let lastPairing: PdfPairing | undefined;
// The note panel is tested on its own; here it only has to be there for the PDF to be paired with.
vi.mock("../notes/NotePane", () => ({ NotePane: () => <div data-testid="note-pane" /> }));
vi.mock("../pdf/PdfReader", () => ({
  PdfReader: ({ document, pairing }: { document: PdfDocument; pairing?: PdfPairing }) => {
    lastPairing = pairing;
    return <div data-testid="reader">reading {document.fileName}</div>;
  },
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
afterEach(cleanup);

const doc = (id: number): PdfDocument => ({ id, uuid: String(id).padStart(32, "0"), noteId: id + 10, fileName: `book${id}.pdf`, size: 10, pageCount: 0, viewState: {}, createdAt: "x" });

const host: PanelHost = {
  ratio: 0.5,
  onRatioChange: vi.fn(),
  onRatioCommit: vi.fn(),
  onCreateNote: vi.fn(),
  onNewNoteFromText: vi.fn(),
  onDropNote: vi.fn(),
  onOpenNoteBeside: vi.fn(),
  sidebar: {
    groupError: null,
    onToggleFavorite: vi.fn(),
    onSelectGroup: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onMoveGroup: vi.fn(),
    onPlaceNote: vi.fn(),
    onPlaceGroup: vi.fn(),
    onMoveNoteToGroup: vi.fn(),
    onMoveGroupToNotebook: vi.fn(),
  },
};

/** A workspace whose only panel is a PDF panel about document `documentId`, and a backend that lists `documents`. */
function setup(documentId: number | null, listDocuments: DocumentsApi["listDocuments"]) {
  const api = { listDocuments } as DocumentsApi;
  const store = createWorkspaceStore({ notes: [], groups: [] }, {} as WorkspaceDeps, undefined, { panels: {}, documents: createDocumentsStore(api) });
  const [panelId] = Object.keys(store.getSnapshot().panels.byId);
  store.setPanelKind(panelId, "pdf");
  store.setPanelState(panelId, { documentId, noteId: null, follow: true });
  render(<PanelGrid store={store} host={host} />);
  return store;
}

describe("a PDF panel", () => {
  it("shows the reader for its PDF, named by the file", async () => {
    setup(2, async () => [doc(1), doc(2)]);

    expect(await screen.findByTestId("reader")).toBeTruthy();
    expect(screen.getByTestId("reader").textContent).toBe("reading book2.pdf");
    expect(screen.getByRole("region", { name: "PDF: book2.pdf" })).toBeTruthy();
  });

  it("says so, while the PDFs load and when its PDF is gone", async () => {
    setup(9, async () => [doc(1)]);

    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByText("This PDF is no longer in the library.")).toBeTruthy();
    expect(screen.queryByTestId("reader")).toBeNull();
  });

  it("is told so when it has no PDF at all", async () => {
    setup(null, async () => [doc(1)]);

    expect(await screen.findByText("This PDF is no longer in the library.")).toBeTruthy();
  });

  it("says why the PDFs could not be read", async () => {
    setup(1, async () => Promise.reject(new Error("The database is locked.")));

    expect(await screen.findByText("The database is locked.")).toBeTruthy();
  });

  it("starts a new reader when its panel is turned to another PDF", async () => {
    const store = setup(1, async () => [doc(1), doc(2)]);
    await screen.findByText("reading book1.pdf");
    const [panelId] = Object.keys(store.getSnapshot().panels.byId);

    act(() => store.setPanelState(panelId, { documentId: 2 }));

    await waitFor(() => expect(screen.getByTestId("reader").textContent).toBe("reading book2.pdf"));
  });
});

describe("a PDF panel beside notes", () => {
  const note = (id: number, title: string, content = ""): Note => ({ id, title, content, tags: "", description: "", createdAt: "x", updatedAt: "x", groupId: null, notebookId: 1 });
  const book = doc(1);

  async function paired() {
    const notes = [note(11, "Textbook"), note(5, "Chapter 3", `> q\n> — [Book, p. 4](pdf:${book.uuid}#p=4)`), note(6, "Unrelated")];
    const api = { listDocuments: async () => [book] } as DocumentsApi;
    const store = createWorkspaceStore({ notes, groups: [] }, { deleteNote: vi.fn(async () => {}) } as unknown as WorkspaceDeps, undefined, { panels: {}, documents: createDocumentsStore(api) });
    await store.documents.load();
    store.openNote(11);
    render(<PanelGrid store={store} host={host} />);
    await screen.findByTestId("reader");
    const { panels } = store.getSnapshot();
    const pdfPanelId = Object.keys(panels.byId).find((id) => panels.byId[id].kind === "pdf")!;
    const stateOf = () => store.getSnapshot().panels.byId[pdfPanelId].state as PdfPanelState;
    return { store, stateOf, pdfPanelId };
  }

  it("hands the reader its title, the notes that cite it, and the note it is paired with", async () => {
    await paired();

    expect(lastPairing?.title).toBe("Textbook");
    expect(lastPairing?.noteId).toBe(11);
    expect(lastPairing?.noteTitle).toBe("Textbook");
    expect(lastPairing?.follow).toBe(false);
    expect(lastPairing?.citations).toEqual([
      { noteId: 11, title: "Textbook", owner: true, pages: [], marks: [] },
      { noteId: 5, title: "Chapter 3", owner: false, pages: [4], marks: [] },
    ]);
  });

  it("writes Quote and Cite to the paired note, at its end when no editor has it open", async () => {
    const { store } = await paired();

    expect(lastPairing?.insert("> quote", "block")).toBe(true);

    expect(store.getSnapshot().notes.find((n) => n.id === 11)?.content).toBe("> quote\n");
  });

  it("switches between staying with its note and following the note in use", async () => {
    const { stateOf } = await paired();

    act(() => lastPairing?.onToggleFollow());

    await waitFor(() => expect(stateOf()).toMatchObject({ follow: true, noteId: null }));
  });

  it("shows a note from the Notes tab beside the PDF, and pairs the PDF with it", async () => {
    const { store, stateOf } = await paired();

    act(() => lastPairing?.onOpenNote(5));

    await waitFor(() => expect(stateOf()).toMatchObject({ follow: false, noteId: 5 }));
    const { panels } = store.getSnapshot();
    expect(Object.values(panels.byId).some((panel) => panel.kind === "note" && (panel.state as { noteId: number }).noteId === 5)).toBe(true);
  });

  it("drops what a followed link asked, once the reader says it has shown it", async () => {
    const { store, stateOf, pdfPanelId } = await paired();
    store.setPanelState(pdfPanelId, { ...stateOf(), goTo: { page: 4, mark: null, seq: 9 } });
    await waitFor(() => expect(lastPairing?.goTo).toEqual({ page: 4, mark: null, seq: 9 }));

    act(() => lastPairing?.onGoToDone(9));

    await waitFor(() => expect(stateOf().goTo).toBeUndefined());
  });

  it("is not paired when its PDF's own note is gone, such as in the Trash Can", async () => {
    const { store } = await paired();

    act(() => store.removeNote(11));

    await waitFor(() => expect(lastPairing).toBeUndefined());
  });
});
