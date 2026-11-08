// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentsApi, PdfDocument } from "@/lib/composition/documentsApi";
import { createDocumentsStore } from "@/lib/composition/documentsStore";
import { createWorkspaceStore, type WorkspaceDeps } from "../notes/workspaceStore";
import { PanelGrid, type PanelHost } from "./PanelGrid";

// pdf.js needs a real browser; what the panel does around the reader is what is under test.
vi.mock("../pdf/PdfReader", () => ({ PdfReader: ({ document }: { document: PdfDocument }) => <div data-testid="reader">reading {document.fileName}</div> }));

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
  store.setPanelState(panelId, { documentId });
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
